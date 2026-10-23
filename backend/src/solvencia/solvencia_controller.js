const {
  MOTIVOS,
  DIAS_MAXIMOS_DE_ANTICIPACION,
  entregaEstimada,
  crear,
  listar,
  buscarSolicitud,
  aprobar,
  rechazar,
  resumen,
} = require('./solvencia_data');
const fotosData = require('./fotos_data');
const guia = require('./guia_data');
const { constanciaDeSolvencia, nombreDeLaConstancia } = require('./constancia_pdf');
const notificaciones = require('../notificaciones/notificaciones');
const configuracion = require('../configuracion/configuracion_data');
const { registrar } = require('../actividad/actividad_data');
const { ok, fail, notFound } = require('../../utils/httpResponse');

function getMotivos(req, res) {
  return ok(res, MOTIVOS);
}

// Lo que el formulario necesita saber: los motivos, con cuántos días de anticipación se pide, cuándo se entregaría una solicitud
// enviada en este momento y cuánto puede pesar cada foto.
function getReglas(req, res) {
  return ok(res, {
    motivos: MOTIVOS,
    diasMaximosDeAnticipacion: DIAS_MAXIMOS_DE_ANTICIPACION,
    entregaSiEnviasAhora: entregaEstimada(),
    fotos: { tipos: fotosData.TIPOS, maximoBytes: fotosData.MAXIMO_BYTES },
    // Dónde está el formulario: el sitio quita la opción del menú donde la administración lo apagó.
    disponible: configuracion.solvenciaDisponible(),
  });
}

async function postSolicitud(req, res) {
  try {
    const solicitud = await crear(req.body);
    // El comprobante sale por correo sin pedirlo; si falla, la solicitud sigue registrada.
    const correoDeConfirmacion = await notificaciones.confirmarPorCorreo(solicitud.correo, () => notificaciones.solvenciaRecibida(solicitud));
    return ok(res, { ...solicitud, correoDeConfirmacion }, 'Solicitud registrada');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

function getSolicitudes(req, res) {
  return ok(res, listar());
}

// Una foto de una solicitud pendiente, solo para el administrador y nunca por una dirección pública: el panel la pide con su sesión.
async function getFoto(req, res) {
  const solicitud = buscarSolicitud(req.params.id);
  const datos = solicitud?.fotos?.[req.params.tipo];
  if (!datos) return notFound(res, 'Esa solicitud no tiene esa foto');
  try {
    const foto = await fotosData.leer(solicitud.id, req.params.tipo);
    if (!foto) return notFound(res, `La foto ya no está en el sistema: se guardó en la PC de la biblioteca (${datos.guardadaEn ?? datos.archivo})`);
    res.set({
      'Content-Type': foto.mime,
      'Content-Disposition': `inline; filename="${datos.archivo}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.send(foto.contenido);
  } catch (err) {
    console.error(`[solvencia] No se pudo leer la foto ${req.params.tipo} de ${solicitud.id}: ${err.message}`);
    return fail(res, 'No se pudo leer la foto. Inténtalo de nuevo en un momento', 500);
  }
}

async function constanciaDe(solicitud) {
  return { nombre: nombreDeLaConstancia(solicitud, fotosData.sinTildes), contenido: await constanciaDeSolvencia(solicitud) };
}

// La constancia de una solicitud aprobada, para descargarla o imprimirla desde el panel (la misma que salió por correo).
async function getConstancia(req, res) {
  const solicitud = buscarSolicitud(req.params.id);
  if (!solicitud) return notFound(res, 'Solicitud no encontrada');
  if (solicitud.estado !== 'aprobada') return fail(res, 'Solo las solicitudes aprobadas tienen constancia', 409);
  try {
    const { nombre, contenido } = await constanciaDe(solicitud);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}"`, 'Cache-Control': 'private, no-store' });
    return res.send(contenido);
  } catch (err) {
    return fail(res, `No se pudo generar la constancia: ${err.message}`, 500);
  }
}

// Al aprobar, a la persona le llega su constancia en PDF; al rechazar, el motivo. La respuesta dice cómo le fue a ese correo
// (enviado, simulado, fallido o pendiente), para que el panel lo avise.
async function patchAprobar(req, res) {
  try {
    const solicitud = await aprobar(req.params.id, req.sesion, { guardadas: req.body?.guardadas });
    if (!solicitud) return notFound(res, 'Solicitud no encontrada');
    registrar(req.sesion, 'solicitud.aprobada', `${solicitud.id}: ${solicitud.solicitante}`);
    const correoDeResolucion = await notificaciones.confirmarPorCorreo(solicitud.correo, async () => {
      try {
        return await notificaciones.solvenciaAprobada(solicitud, await constanciaDe(solicitud));
      } catch (err) {
        console.error(`[solvencia] No se pudo armar la constancia de ${solicitud.id}: ${err.message}`);
        return null;
      }
    });
    return ok(res, { ...solicitud, correoDeResolucion }, 'Solicitud aprobada');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

async function patchRechazar(req, res) {
  try {
    const solicitud = await rechazar(req.params.id, req.body?.observacion, req.sesion, { guardadas: req.body?.guardadas });
    if (!solicitud) return notFound(res, 'Solicitud no encontrada');
    registrar(req.sesion, 'solicitud.rechazada', `${solicitud.id}: ${solicitud.observacion}`);
    const correoDeResolucion = await notificaciones.confirmarPorCorreo(solicitud.correo, () => notificaciones.solvenciaRechazada(solicitud));
    return ok(res, { ...solicitud, correoDeResolucion }, 'Solicitud rechazada');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

function getResumen(req, res) {
  return ok(res, resumen());
}

// La guía «Cómo hacer tu solvencia» (videos y pasos): la lee cualquiera; solo el administrador la cambia.
function getGuia(req, res) {
  return ok(res, guia.obtener());
}

function putGuia(req, res) {
  try {
    const nueva = guia.actualizar(req.body, req.sesion);
    registrar(req.sesion, 'solvencia.guia', `${nueva.videos.length} videos y ${nueva.pasos.length} pasos`);
    return ok(res, nueva, 'Guía guardada');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

function postRestaurarGuia(req, res) {
  const original = guia.restaurar(req.sesion);
  registrar(req.sesion, 'solvencia.guia', 'volvió a los videos y pasos originales');
  return ok(res, original, 'Se volvió a la guía original');
}

module.exports = { getMotivos, getReglas, postSolicitud, getSolicitudes, getFoto, getConstancia, patchAprobar, patchRechazar, getResumen, getGuia, putGuia, postRestaurarGuia };
