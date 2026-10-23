const {
  disponibilidad,
  crearReserva,
  listarReservas,
  avanzarEstado,
  cancelarReserva,
  liberarReserva,
  buscarReserva,
  resumen,
  cuandoSePenalice,
  penalizaciones,
  quitarPenalizacion,
  sancionar,
  quitarSancion,
  listarSanciones,
  liberarNoLlegaron,
} = require('./reservas_data');
const { CONDICIONES } = require('./recursos_data');
const configuracion = require('../configuracion/configuracion_data');
const notificaciones = require('../notificaciones/notificaciones');
const { registrar } = require('../actividad/actividad_data');
const { ok, fail, notFound } = require('../../utils/httpResponse');

const TIPOS_VALIDOS = ['cubiculo', 'estacion', 'sala_lectura'];

// Quien no se presenta a su reserva queda penalizado: si dejó correo se le avisa hasta cuándo, y queda en la bitácora.
cuandoSePenalice(({ reserva, canceladas }) => {
  registrar(
    null,
    'reserva.penalizada',
    `${reserva.id} (${reserva.identificacion}): no se presentó; sin reservar hasta el ${new Date(reserva.penalizadoHasta).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })}${canceladas.length > 0 ? `; canceladas ${canceladas.map((c) => c.id).join(', ')}` : ''}`
  );
  notificaciones.noSePresento({ reserva, canceladas });
});

const TEXTO_DE_ESTADO = { reservado: 'reservado', en_uso: 'en uso', finalizado: 'finalizado' };
const ESTADO_SIGUIENTE = { reservado: 'en_uso', en_uso: 'finalizado' };

function validarTipo(req, res) {
  if (!TIPOS_VALIDOS.includes(req.params.tipo)) {
    fail(res, 'Tipo de recurso invalido', 404);
    return false;
  }
  return true;
}

function getDisponibilidad(req, res) {
  if (!validarTipo(req, res)) return;
  const { fecha } = req.query;
  if (!fecha) return fail(res, 'Debes indicar una fecha');
  return ok(res, disponibilidad(req.params.tipo, fecha));
}

async function postReserva(req, res) {
  if (!validarTipo(req, res)) return;
  const { recursoId, fecha, hora, horaFin, solicitante, identificacion, correo, kiosco, duracion } = req.body;
  if (!recursoId || !fecha || !hora || !solicitante) {
    return fail(res, 'Faltan datos de la reserva');
  }
  try {
    const reserva = crearReserva({
      tipo: req.params.tipo,
      recursoId,
      fecha,
      hora,
      horaFin,
      solicitante,
      identificacion,
      correo,
      kiosco,
      duracion,
    });
    // Si dejó un correo, recibe la confirmación sin pedirla; la respuesta dice cómo le fue al envío. Si el correo falla, la reserva
    // sigue en pie.
    const correoDeConfirmacion = await notificaciones.confirmarPorCorreo(reserva.correo, () => notificaciones.reservaConfirmada(reserva));
    return ok(res, { ...reserva, correoDeConfirmacion }, 'Reserva creada');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

// Condiciones generales de uso que se muestran antes de reservar, con los minutos de tolerancia, los topes de horas de las
// reservas (valen para todos los lugares de estudio) y las reservas pausadas que el administrador tenga en la configuración.
function getCondiciones(req, res) {
  const { maxHorasPorReserva, maxHorasPorDia, ...generales } = CONDICIONES;
  return ok(res, {
    ...generales,
    toleranciaMinutos: configuracion.toleranciaMinutos(),
    horasDePenalizacion: configuracion.horasDePenalizacion(),
    limites: configuracion.limitesDeHoras(),
    pausadas: configuracion.tiposPausados(),
  });
}

function getReservas(req, res) {
  return ok(res, listarReservas({ tipo: req.query.tipo }));
}

function patchAvanzar(req, res) {
  const antes = buscarReserva(req.params.id)?.estado;
  const reserva = avanzarEstado(req.params.id);
  if (!reserva) return notFound(res, 'Reserva no encontrada');
  if (reserva.estado === ESTADO_SIGUIENTE[antes]) {
    if (reserva.salioAntes) {
      registrar(req.sesion, 'reserva.salida_anticipada', `${reserva.id} (${reserva.recursoNombre}): liberó de ${reserva.horaFin} a ${reserva.horaFinOriginal}`);
    } else {
      registrar(req.sesion, 'reserva.avanzada', `${reserva.id}: ${TEXTO_DE_ESTADO[antes]} → ${TEXTO_DE_ESTADO[reserva.estado]}`);
    }
  }
  return ok(res, reserva);
}

// Si la persona dejó su correo, se entera de que su reserva se canceló o se liberó (el correo no detiene la acción).
function patchCancelar(req, res) {
  try {
    const reserva = cancelarReserva(req.params.id);
    if (!reserva) return notFound(res, 'Reserva no encontrada');
    registrar(req.sesion, 'reserva.cancelada', `${reserva.id} (${reserva.recursoNombre})`);
    notificaciones.reservaCancelada(reserva);
    return ok(res, reserva, 'Reserva cancelada');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

function patchLiberar(req, res) {
  try {
    const reserva = liberarReserva(req.params.id);
    if (!reserva) return notFound(res, 'Reserva no encontrada');
    registrar(req.sesion, 'reserva.liberada', `${reserva.id} (${reserva.recursoNombre})`);
    notificaciones.reservaLiberada(reserva);
    return ok(res, reserva, 'Lugar liberado');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

function getPenalizaciones(req, res) {
  return ok(res, penalizaciones());
}

function patchQuitarPenalizacion(req, res) {
  try {
    const reserva = quitarPenalizacion(req.params.id, req.sesion);
    if (!reserva) return notFound(res, 'Reserva no encontrada');
    registrar(req.sesion, 'reserva.penalizacion_quitada', `${reserva.id} (${reserva.identificacion})`);
    return ok(res, reserva, 'Penalización quitada: ya puede reservar');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

// Sanción a mano: la persona queda unas horas sin poder reservar; si dejó correo en alguna reserva, se le avisa con el motivo.
function postSancion(req, res) {
  try {
    const { sancion, canceladas } = sancionar(req.body, req.sesion);
    registrar(
      req.sesion,
      'reserva.sancionada',
      `${sancion.id} (${sancion.identificacion}): ${sancion.horas} h sin reservar · ${sancion.motivo}${canceladas.length > 0 ? `; canceladas ${canceladas.map((c) => c.id).join(', ')}` : ''}`
    );
    notificaciones.sancionPuesta({ sancion, canceladas });
    return ok(res, { ...sancion, canceladas: canceladas.map((c) => c.id) }, 'Sanción registrada');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

function patchQuitarSancion(req, res) {
  try {
    const sancion = quitarSancion(req.params.id, req.sesion);
    if (!sancion) return notFound(res, 'Sanción no encontrada');
    registrar(req.sesion, 'reserva.sancion_quitada', `${sancion.id} (${sancion.identificacion})`);
    return ok(res, sancion, 'Sanción quitada: ya puede reservar');
  } catch (err) {
    return fail(res, err.message, err.estado || 500);
  }
}

function getSanciones(req, res) {
  return ok(res, listarSanciones());
}

function postLiberarNoLlegaron(req, res) {
  const liberadas = liberarNoLlegaron();
  if (liberadas.length > 0) {
    registrar(req.sesion, 'reserva.liberadas_no_llegaron', liberadas.map((r) => `${r.id} (${r.recursoNombre})`).join(', '));
  }
  return ok(res, liberadas, liberadas.length > 0 ? `${liberadas.length} lugares liberados` : 'No había nadie por liberar');
}

function getResumen(req, res) {
  return ok(res, resumen());
}

module.exports = {
  getDisponibilidad,
  getCondiciones,
  postReserva,
  getReservas,
  patchAvanzar,
  patchCancelar,
  patchLiberar,
  getPenalizaciones,
  patchQuitarPenalizacion,
  postSancion,
  patchQuitarSancion,
  getSanciones,
  postLiberarNoLlegaron,
  getResumen,
};
