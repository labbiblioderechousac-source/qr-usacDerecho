const almacen = require('../../utils/almacen');
const { rechazo } = require('../../utils/errores');
const { generarCodigoConfirmacion, correoValido } = require('../../utils/codigos');
const { esFechaISO, fechaLocal, minutosDelDia, sumarDias } = require('../../utils/fechas');
const horarios = require('../horarios/horarios_data');
const fotosData = require('./fotos_data');

// Solvencias de biblioteca (paz y salvo). Siguen el proceso que la biblioteca publica en su sitio: la persona genera la
// orden de pago en SIIF, la paga en el banco, llena la solicitud con sus datos y el número de esa orden, y sube la foto del
// comprobante (la boleta de depósito) y la de la orden de pago. La administración la revisa y la aprueba (le llega su solvencia
// en PDF por correo) o la rechaza con un motivo. La entrega se promete en un horario que depende de cuándo se envió la solicitud.
//
// Estados: pendiente -> aprobada o rechazada. (Las solicitudes guardadas por versiones anteriores pueden estar «en_revision»: se
// tratan como pendientes.)
const MOTIVOS = ['Grado', 'Certificado de paz y salvo', 'Retiro del programa', 'Otro'];

// La solicitud se envía con al menos un día de anticipación a la fecha en que se presentará la papelería, y con un máximo de siete.
const DIAS_MAXIMOS_DE_ANTICIPACION = 7;

const FORMATO_DE_CARNE = /^[0-9A-Za-z-]{5,15}$/;
const FORMATO_DE_CUI = /^\d{13}$/;
const FORMATO_DE_ORDEN_DE_PAGO = /^[0-9A-Za-z-]{4,20}$/;

const estado = almacen.cargar('solvencia', { solicitudes: [], contador: 0 });
const solicitudes = estado.solicitudes;

function guardar() {
  almacen.guardar('solvencia', estado);
}

function siguienteCodigo() {
  estado.contador += 1;
  return `SOL-${String(estado.contador).padStart(3, '0')}`;
}

function kioscoValido(kiosco) {
  return typeof kiosco === 'string' && /^[0-9A-Za-z_-]{1,10}$/.test(kiosco) ? kiosco : null;
}

// Cuándo se entrega la solvencia según la hora en que se envió la solicitud (horarios que publica la biblioteca):
//   de 08:00 a 13:00 -> ese mismo día a las 15:00        de 13:01 a 17:00 -> ese mismo día a las 18:00
//   más tarde, o antes de las 08:00 -> a las 14:00 del siguiente día hábil (si se envía de madrugada, ese mismo día)
// Solo se entrega de lunes a viernes y no en días de asueto, así que los fines de semana y los cierres pasan al siguiente día hábil.
function entregaEstimada(ahora = new Date()) {
  const hoy = fechaLocal(ahora);
  const minutos = minutosDelDia(ahora);
  if (horarios.esDiaHabil(hoy)) {
    if (minutos < 8 * 60) return { fecha: hoy, hora: '14:00' };
    if (minutos <= 13 * 60) return { fecha: hoy, hora: '15:00' };
    if (minutos <= 17 * 60) return { fecha: hoy, hora: '18:00' };
  }
  return { fecha: horarios.siguienteDiaHabil(hoy), hora: '14:00' };
}

function textoObligatorio(valor, nombre, minimo, maximo) {
  const texto = String(valor ?? '').trim().replace(/\s+/g, ' ');
  if (texto.length < minimo || texto.length > maximo) {
    throw rechazo(`${nombre}: escribe entre ${minimo} y ${maximo} caracteres`);
  }
  return texto;
}

function validar({ solicitante, identificacion, cui, programa, motivo, correo, ordenDePago, fechaPapeleria, esEstudiante }, ahora) {
  const nombre = textoObligatorio(solicitante, 'Nombre completo', 3, 80);

  const carne = String(identificacion ?? '').trim();
  if (!FORMATO_DE_CARNE.test(carne)) {
    throw rechazo('Escribe tu número de carné (de 5 a 15 letras o números)');
  }

  const cuiLimpio = String(cui ?? '').replace(/\s+/g, '');
  if (!FORMATO_DE_CUI.test(cuiLimpio)) {
    throw rechazo('El CUI (el número de tu DPI) tiene 13 números');
  }

  const carrera = textoObligatorio(programa, 'Programa académico', 3, 120);
  if (!MOTIVOS.includes(motivo)) {
    throw rechazo('Elige el motivo de la solvencia');
  }

  const correoLimpio = String(correo ?? '').trim();
  if (!correoValido(correoLimpio)) {
    throw rechazo('Escribe un correo válido: ahí recibirás la confirmación y la solvencia');
  }

  const orden = String(ordenDePago ?? '').trim();
  if (!FORMATO_DE_ORDEN_DE_PAGO.test(orden)) {
    throw rechazo('Escribe el número de tu orden de pago (de 4 a 20 letras o números)');
  }

  if (esEstudiante !== true) {
    throw rechazo('Este servicio es para estudiantes de la Facultad de Ciencias Jurídicas y Sociales del Campus Central: confírmalo para continuar');
  }

  const hoy = fechaLocal(ahora);
  if (!esFechaISO(fechaPapeleria)) {
    throw rechazo('Indica la fecha en la que presentarás tu papelería');
  }
  if (fechaPapeleria <= hoy) {
    throw rechazo('La solicitud debe enviarse con al menos un día de anticipación a la fecha en que presentarás tu papelería');
  }
  if (fechaPapeleria > sumarDias(hoy, DIAS_MAXIMOS_DE_ANTICIPACION)) {
    throw rechazo(`Solo puedes solicitar la solvencia con un máximo de ${DIAS_MAXIMOS_DE_ANTICIPACION} días de anticipación`);
  }
  if (!horarios.esDiaHabil(fechaPapeleria)) {
    throw rechazo('Esa fecha no es un día hábil de entrega (las solvencias se entregan de lunes a viernes, salvo asuetos): elige otra');
  }

  return { solicitante: nombre, identificacion: carne.toUpperCase(), cui: cuiLimpio, programa: carrera, motivo, correo: correoLimpio, ordenDePago: orden.toUpperCase(), fechaPapeleria };
}

// Crea la solicitud. Desde la web las dos fotos son obligatorias; desde un kiosco (sin cámara) pueden faltar: el personal revisa los
// papeles en el mostrador. Las fotos se guardan antes que la solicitud: si no se pudieran guardar, la solicitud no se registra.
async function crear(datos, ahora = new Date()) {
  const limpios = validar(datos, ahora);
  const kiosco = kioscoValido(datos.kiosco);
  const fotos = fotosData.leerFotos(datos.fotos, { obligatorias: !kiosco });
  const id = siguienteCodigo();
  const subidaEn = ahora.toISOString();
  if (fotos) await fotosData.guardar(id, fotos);
  const solicitud = {
    id,
    ...limpios,
    ...(kiosco ? { kiosco } : {}),
    codigoConfirmacion: generarCodigoConfirmacion(),
    entregaEstimada: entregaEstimada(ahora),
    estado: 'pendiente',
    creadoEn: subidaEn,
    ...(fotos
      ? {
          fotos: Object.fromEntries(
            Object.values(fotos).map((foto) => [
              foto.tipo,
              {
                archivo: fotosData.nombreDeArchivo({ ...limpios, fecha: fechaLocal(ahora) }, foto.extension),
                mime: foto.mime,
                bytes: foto.contenido.length,
                hash: foto.hash,
                subidaEn,
                enRevision: true, // la foto está en la base de datos esperando que la administración la revise
              },
            ])
          ),
        }
      : {}),
  };
  solicitudes.push(solicitud);
  guardar();
  return solicitud;
}

const estaPendiente = (solicitud) => ['pendiente', 'en_revision'].includes(solicitud.estado);

// En qué otras solicitudes aparece la misma foto (mismo hash): un comprobante de pago que alguien ya usó.
function repetidasDe(solicitud) {
  const avisos = {};
  Object.entries(solicitud.fotos ?? {}).forEach(([tipo, foto]) => {
    const otras = solicitudes.filter((s) => s.id !== solicitud.id && Object.values(s.fotos ?? {}).some((f) => f.hash === foto.hash)).map((s) => s.id);
    if (otras.length > 0) avisos[tipo] = otras;
  });
  return avisos;
}

// Lo que ve el panel: cada solicitud con el aviso de fotos repetidas, sin tocar la guardada.
function listar() {
  return solicitudes
    .slice()
    .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
    .map((s) => {
      const repetidas = repetidasDe(s);
      return Object.keys(repetidas).length > 0 ? { ...s, fotosRepetidas: repetidas } : s;
    });
}

function buscarSolicitud(id) {
  return solicitudes.find((s) => s.id === id) || null;
}

// Antes de resolver una solicitud con fotos, el panel las guarda en la PC de la biblioteca y dice dónde quedaron
// («solvencias/comprobante/Maria_Lopez_...webp»). Sin eso no se resuelve: al resolverla se borran de la base de datos y se perderían.
function anotarDondeSeGuardaron(solicitud, guardadas) {
  const conFotos = Object.entries(solicitud.fotos ?? {}).filter(([, foto]) => foto.enRevision);
  if (conFotos.length === 0) return;
  const rutas = guardadas && typeof guardadas === 'object' ? guardadas : {};
  conFotos.forEach(([tipo]) => {
    const ruta = String(rutas[tipo] ?? '').trim();
    if (!ruta || ruta.length > 260 || ruta.includes('..') || !/^[\w .()/\\:-]+$/.test(ruta)) {
      throw rechazo('Primero hay que guardar las fotos en la PC de la biblioteca (carpeta de solvencias): sin eso no se puede resolver la solicitud');
    }
  });
  conFotos.forEach(([tipo, foto]) => {
    foto.guardadaEn = String(rutas[tipo]).trim();
    foto.enRevision = false;
  });
}

// Aprueba o rechaza: queda quién lo hizo y cuándo, y las fotos salen de la base de datos (ya están en la PC).
async function resolver(solicitud, estado, sesion, guardadas) {
  anotarDondeSeGuardaron(solicitud, guardadas);
  solicitud.estado = estado;
  solicitud.atendidaEn = new Date().toISOString();
  solicitud.revisadaPor = { usuario: sesion?.usuario ?? null, nombre: sesion?.nombre ?? null };
  guardar();
  if (solicitud.fotos) {
    try {
      await fotosData.borrar(solicitud.id);
    } catch (error) {
      // Quedan guardadas; se borran solas en el próximo arranque (limpiarFotosResueltas).
      console.error(`[solvencia] No se pudieron borrar las fotos de ${solicitud.id}: ${error.message}`);
    }
  }
  return solicitud;
}

function exigirPendiente(solicitud) {
  if (!estaPendiente(solicitud)) throw rechazo(`La solicitud ${solicitud.id} ya fue ${solicitud.estado}`, 409);
}

async function aprobar(id, sesion, { guardadas } = {}) {
  const solicitud = buscarSolicitud(id);
  if (!solicitud) return null;
  exigirPendiente(solicitud);
  delete solicitud.observacion;
  return resolver(solicitud, 'aprobada', sesion, guardadas);
}

// Rechaza una solicitud. El motivo es obligatorio: le llega a la persona por correo para que corrija y envíe una nueva solicitud.
async function rechazar(id, observacion, sesion, { guardadas } = {}) {
  const solicitud = buscarSolicitud(id);
  if (!solicitud) return null;
  exigirPendiente(solicitud);
  const motivo = String(observacion ?? '').trim().replace(/\s+/g, ' ');
  if (motivo.length < 3 || motivo.length > 500) {
    throw rechazo('Escribe el motivo del rechazo (de 3 a 500 caracteres): se le enviará a la persona por correo');
  }
  solicitud.observacion = motivo;
  return resolver(solicitud, 'rechazada', sesion, guardadas);
}

// Las fotos guardadas de solicitudes que ya no están pendientes se borran (ver fotos_data.limpiarResueltas).
function limpiarFotosResueltas() {
  return fotosData.limpiarResueltas(solicitudes.filter(estaPendiente).map((s) => s.id));
}

function resumen() {
  const pendientes = solicitudes.filter(estaPendiente);
  return {
    total: solicitudes.length,
    pendientes: pendientes.length,
    // Las últimas que llegaron, para que el panel avise (con voz) cuando entra una nueva.
    recientes: pendientes
      .slice()
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
      .slice(0, 10)
      .map(({ id, solicitante, creadoEn }) => ({ id, solicitante, creadoEn })),
  };
}

module.exports = {
  MOTIVOS,
  DIAS_MAXIMOS_DE_ANTICIPACION,
  entregaEstimada,
  crear,
  listar,
  buscarSolicitud,
  aprobar,
  rechazar,
  limpiarFotosResueltas,
  resumen,
};
