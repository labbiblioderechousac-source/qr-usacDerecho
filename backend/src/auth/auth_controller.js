const { iniciarSesion, comprobarClave, cerrarSesion, cerrarSesionesDe } = require('./auth_data');
const cuentasData = require('./cuentas_data');
const configuracion = require('../configuracion/configuracion_data');
const { tokenDe } = require('./auth_middleware');
const { registrar } = require('../actividad/actividad_data');
const { ok, fail } = require('../../utils/httpResponse');

const MENSAJE_DE_BLOQUEO = 'Demasiados intentos fallidos. Espera unos minutos e inténtalo de nuevo';

function postLogin(req, res) {
  const { usuario, clave } = req.body;
  if (!usuario || !clave) {
    return fail(res, 'Escribe tu usuario y tu clave');
  }
  const { sesion, bloqueado } = iniciarSesion(usuario, clave);
  if (bloqueado) {
    return fail(res, MENSAJE_DE_BLOQUEO, 429);
  }
  if (!sesion) {
    return fail(res, 'Usuario o clave incorrectos', 401);
  }
  registrar(sesion, 'acceso.iniciado');
  return ok(res, sesion, 'Sesión iniciada');
}

function postLogout(req, res) {
  registrar(req.sesion, 'acceso.cerrado');
  cerrarSesion(tokenDe(req));
  return ok(res, { cerrada: true });
}

// Quién es y tras cuántos minutos sin actividad se le cierra la sesión (0: nunca): el panel lo vuelve a pedir para seguir la configuración.
function getMe(req, res) {
  const { usuario, nombre, rol } = req.sesion;
  return ok(res, { usuario, nombre, rol, rolNombre: cuentasData.ROLES[rol], minutosDeInactividad: configuracion.minutosDeInactividad(rol) });
}

// Cada persona del personal puede cambiar su propia clave. Se pide la actual para que nadie con una sesión ajena
// abierta pueda quedarse con la cuenta, y las demás sesiones de esa cuenta se cierran.
function postCambiarClave(req, res) {
  const { claveActual, claveNueva } = req.body;
  if (!claveActual || !claveNueva) {
    return fail(res, 'Escribe tu clave actual y la clave nueva');
  }
  const { cuenta, bloqueado } = comprobarClave(req.sesion.usuario, claveActual);
  if (bloqueado) {
    return fail(res, MENSAJE_DE_BLOQUEO, 429);
  }
  // Un 400 y no un 401: con un 401 el panel entendería que la sesión terminó.
  if (!cuenta) {
    return fail(res, 'La clave actual no es correcta', 400);
  }
  try {
    cuentasData.cambiarClave(cuenta.usuario, claveNueva);
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
  cerrarSesionesDe(cuenta.usuario, { excepto: tokenDe(req) });
  registrar(req.sesion, 'cuenta.clave', 'Cambió su propia clave');
  return ok(res, { cambiada: true }, 'Clave actualizada');
}

module.exports = { postLogin, postLogout, getMe, postCambiarClave };
