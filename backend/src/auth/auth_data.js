const crypto = require('node:crypto');
const almacen = require('../../utils/almacen');
const cuentasData = require('./cuentas_data');
const configuracion = require('../configuracion/configuracion_data');

const HORAS_DE_SESION = 8;
// Un rol cuya sesión no se cierra por inactividad (configuración: «nunca») tiene sesiones de 30 días que se renuevan solas con el uso.
const DIAS_DE_SESION_SIN_CIERRE = 30;
const HORA_MS = 60 * 60 * 1000;

const sinCierre = (rol) => configuracion.minutosDeInactividad(rol) === 0;
const duracionDeSesion = (rol) => (sinCierre(rol) ? DIAS_DE_SESION_SIN_CIERRE * 24 : HORAS_DE_SESION) * HORA_MS;
const MAXIMO_DE_INTENTOS = 5;
const MINUTOS_DE_BLOQUEO = 5;
const MAXIMO_DE_SESIONES = 500;

// Las sesiones se guardan en el almacén para que reiniciar el servidor (o publicar una versión) no saque al personal. De cada una
// se guarda la huella de su ficha de acceso (SHA-256), nunca la ficha: quien lea lo guardado no puede entrar con ello.
const huellaDe = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

const sesiones = new Map(); // huella de la ficha -> { usuario, nombre, rol, expiraEn }
const intentos = new Map(); // usuario -> { cantidad, desde }

function guardar() {
  almacen.guardar('sesiones', { sesiones: [...sesiones].map(([huella, sesion]) => ({ huella, ...sesion })) });
}

// Al arrancar se recupera lo guardado. Solo valen las sesiones sin vencer de cuentas que siguen activas; el nombre y el rol se toman
// de la cuenta, que es la que manda. Si en este arranque se restableció la clave de una cuenta, sus sesiones se cierran.
{
  const guardadas = almacen.cargar('sesiones', { sesiones: [] }).sesiones;
  const restablecidas = cuentasData.restablecimiento().usuarios;
  guardadas.forEach(({ huella, usuario, expiraEn }) => {
    const cuenta = cuentasData.obtener(usuario);
    if (typeof huella !== 'string' || !cuenta || !cuenta.activa || !(expiraEn > Date.now()) || restablecidas.includes(usuario)) return;
    sesiones.set(huella, { usuario, nombre: cuenta.nombre, rol: cuenta.rol, expiraEn });
  });
  if (sesiones.size !== guardadas.length) guardar();
}

function quitarVencidas() {
  const ahora = Date.now();
  let quitadas = 0;
  sesiones.forEach((sesion, huella) => {
    if (sesion.expiraEn < ahora) {
      sesiones.delete(huella);
      quitadas += 1;
    }
  });
  return quitadas;
}

function bloqueado(usuario) {
  const registro = intentos.get(usuario);
  if (!registro) return false;
  if (Date.now() - registro.desde > MINUTOS_DE_BLOQUEO * 60 * 1000) {
    intentos.delete(usuario);
    return false;
  }
  return registro.cantidad >= MAXIMO_DE_INTENTOS;
}

function anotarFallo(usuario) {
  // Quien prueba muchos usuarios inventados no debe llenar la memoria: se descartan los registros ya vencidos.
  if (intentos.size > 500) {
    const limite = Date.now() - MINUTOS_DE_BLOQUEO * 60 * 1000;
    intentos.forEach((registro, clave) => {
      if (registro.desde < limite) intentos.delete(clave);
    });
  }
  const registro = intentos.get(usuario) || { cantidad: 0, desde: Date.now() };
  registro.cantidad += 1;
  intentos.set(usuario, registro);
}

// Comprueba usuario y clave aplicando el bloqueo por intentos fallidos. Devuelve { cuenta } si son correctos,
// { bloqueado: true } si hubo demasiados intentos, o {} si no coinciden.
function comprobarClave(usuario, clave) {
  const nombre = String(usuario || '').trim().toLowerCase();
  if (bloqueado(nombre)) return { bloqueado: true };

  const cuenta = cuentasData.verificar(nombre, clave);
  if (!cuenta) {
    anotarFallo(nombre);
    return {};
  }
  intentos.delete(nombre);
  return { cuenta };
}

// Devuelve { sesion } si las credenciales son correctas, { bloqueado: true } si hubo demasiados
// intentos fallidos, o {} si no coinciden (o si la cuenta está desactivada).
function iniciarSesion(usuario, clave) {
  const { cuenta, bloqueado: enBloqueo } = comprobarClave(usuario, clave);
  if (enBloqueo) return { bloqueado: true };
  if (!cuenta) return {};

  cuentasData.registrarAcceso(cuenta.usuario);
  quitarVencidas();
  // Tope de sesiones guardadas: si se llena, se cierran las que vencen antes.
  if (sesiones.size >= MAXIMO_DE_SESIONES) {
    [...sesiones].sort(([, a], [, b]) => a.expiraEn - b.expiraEn).slice(0, sesiones.size - MAXIMO_DE_SESIONES + 1).forEach(([huella]) => sesiones.delete(huella));
  }
  const token = crypto.randomBytes(32).toString('hex');
  const datos = { usuario: cuenta.usuario, nombre: cuenta.nombre, rol: cuenta.rol };
  sesiones.set(huellaDe(token), { ...datos, expiraEn: Date.now() + duracionDeSesion(cuenta.rol) });
  guardar();
  return { sesion: { token, ...datos, rolNombre: cuentasData.ROLES[cuenta.rol], minutosDeInactividad: configuracion.minutosDeInactividad(cuenta.rol) } };
}

function sesionDeToken(token) {
  if (!token) return null;
  const huella = huellaDe(token);
  const sesion = sesiones.get(huella);
  if (!sesion) return null;
  const ahora = Date.now();
  if (sesion.expiraEn < ahora) {
    sesiones.delete(huella);
    guardar();
    return null;
  }
  // La duración sigue a la configuración actual: sin cierre, se renueva con el uso (como mucho una vez por hora, para no guardar en
  // cada petición); si el administrador vuelve a poner un límite, la sesión larga se acorta a las horas normales.
  const duracion = duracionDeSesion(sesion.rol);
  if (sinCierre(sesion.rol) && ahora + duracion - sesion.expiraEn > HORA_MS) {
    sesion.expiraEn = ahora + duracion;
    guardar();
  } else if (!sinCierre(sesion.rol) && sesion.expiraEn > ahora + duracion) {
    sesion.expiraEn = ahora + duracion;
    guardar();
  }
  return sesion;
}

function cerrarSesion(token) {
  if (sesiones.delete(huellaDe(token))) guardar();
}

// Cierra todas las sesiones de una cuenta (por ejemplo, al desactivarla o cambiarle el rol o la clave),
// menos la del token indicado, para no sacar a quien está haciendo el cambio sobre su propia cuenta.
function cerrarSesionesDe(usuario, { excepto } = {}) {
  const huellaExcepto = excepto ? huellaDe(excepto) : null;
  let cerradas = 0;
  sesiones.forEach((sesion, huella) => {
    if (sesion.usuario === usuario && huella !== huellaExcepto) {
      sesiones.delete(huella);
      cerradas += 1;
    }
  });
  if (cerradas > 0) guardar();
}

function actualizarNombreEnSesiones(usuario, nombre) {
  let cambiadas = 0;
  sesiones.forEach((sesion) => {
    if (sesion.usuario === usuario && sesion.nombre !== nombre) {
      sesion.nombre = nombre;
      cambiadas += 1;
    }
  });
  if (cambiadas > 0) guardar();
}

module.exports = {
  comprobarClave,
  iniciarSesion,
  sesionDeToken,
  cerrarSesion,
  cerrarSesionesDe,
  actualizarNombreEnSesiones,
};
