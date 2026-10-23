const { avisarPorCorreo } = require('../../utils/correo');
const { plantilla } = require('../../utils/plantillaCorreo');
const biblioteca = require('../../utils/biblioteca');
const configuracion = require('../configuracion/configuracion_data');

// Los correos que el sistema manda a las personas: el comprobante de una reserva o de una solicitud de solvencia (propuesta,
// sección 4.5.5, "comprobante digital"). Aquí solo se redacta el mensaje (texto y HTML, ver utils/plantillaCorreo.js); el envío
// (real o simulado) lo hace utils/correo.js.

function fechaYHora(iso) {
  const d = new Date(iso);
  const dos = (n) => String(n).padStart(2, '0');
  return { fecha: `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`, hora: `${dos(d.getHours())}:${dos(d.getMinutes())}` };
}

// "jueves 8 de octubre de 2026" a partir de "2026-10-08".
function fechaLarga(fecha) {
  return new Date(`${fecha}T12:00:00`).toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// "lunes 19 de octubre a las 09:15" a partir de un momento ISO.
function momentoLargo(iso) {
  const { hora } = fechaYHora(iso);
  return `${new Date(iso).toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '')} a las ${hora}`;
}

// Lo que se le dice a quien reserva sobre no presentarse: se libera la reserva y, si hay castigo, cuántas horas queda sin reservar.
// Es el mismo texto que muestra el comprobante en pantalla (frontend/src/shared/components/Comprobante.jsx).
function avisoDeTolerancia() {
  const horas = configuracion.horasDePenalizacion();
  return `Si no te presentas dentro de ${configuracion.toleranciaMinutos()} minutos del inicio, la reserva se libera${
    horas > 0 ? ` y no podrás reservar ningún lugar de estudio durante ${horas} horas` : ''
  }.`;
}

// --- Mensajes -------------------------------------------------------------------------------------------------------

function mensajeDeReserva(r) {
  const { fecha, hora } = fechaYHora(r.creadoEn);
  const horas = `de ${r.hora} a ${r.horaFin}${r.duracion > 1 ? ` (${r.duracion} horas)` : ''}`;
  return {
    tipo: 'reserva',
    asunto: `Confirmación de reserva ${r.id}`,
    ...plantilla({
      titulo: 'Confirmación de reserva',
      previa: `${r.recursoNombre}, ${fechaLarga(r.fecha)}, ${horas}`,
      filas: [
        ['Fecha de la operación', `${fecha} · ${hora}`],
        ['Número de reserva', r.id, 'codigo'],
        ['Código de confirmación', r.codigoConfirmacion, 'codigo'],
        ['Lugar', r.recursoNombre],
        ['Horario de uso', `${fechaLarga(r.fecha)}, ${horas}`],
        ['A nombre de', r.solicitante],
      ],
      parrafos: [
        `Presenta el número de reserva o el código de confirmación en el mostrador. ${avisoDeTolerancia()} La biblioteca puede cancelar una reserva si se incumple el reglamento del servicio.`,
      ],
    }),
  };
}

function mensajeDeSolvencia(s) {
  const { fecha, hora } = fechaYHora(s.creadoEn);
  const entrega = s.entregaEstimada ? `${fechaLarga(s.entregaEstimada.fecha)}, a las ${s.entregaEstimada.hora}` : null;
  return {
    tipo: 'solvencia',
    asunto: `Solicitud de solvencia ${s.id} recibida`,
    ...plantilla({
      titulo: 'Solicitud de solvencia recibida',
      previa: `Solicitud ${s.id}: ${s.motivo}`,
      filas: [
        ['Fecha de la operación', `${fecha} · ${hora}`],
        ['Número de solicitud', s.id, 'codigo'],
        ['Código de confirmación', s.codigoConfirmacion, 'codigo'],
        ['Motivo', s.motivo],
        ['Solicitante', s.solicitante],
        ...(s.identificacion ? [['Carné', s.identificacion]] : []),
        ...(s.fechaPapeleria ? [['Presentas tu papelería el', fechaLarga(s.fechaPapeleria)]] : []),
        ...(entrega ? [['Entrega estimada', entrega]] : []),
        ...(s.fotos ? [['Fotos recibidas', 'Comprobante de pago y orden de pago']] : []),
      ],
      parrafos: [
        'Tu solicitud será revisada por el personal de la biblioteca. Cuando se apruebe recibirás en este correo tu constancia de solvencia en PDF; si hubiera algo que corregir, te escribiremos con el motivo.',
        'Revisa que tus datos estén correctos: si la solvencia se emite con datos incorrectos (nombres, CUI, carné o fecha) no hay reposición y habría que pagar y tramitarla de nuevo.',
      ],
    }),
  };
}

// Fecha de un momento ISO en hora de la biblioteca: "22/10/2026".
const soloFecha = (iso) => fechaYHora(iso).fecha;

// Correos formales de la revisión (los textos los acordó la biblioteca): la persona recibe su solvencia o el motivo del rechazo.
function mensajeDeSolvenciaAprobada(s) {
  return {
    tipo: 'solvencia_aprobada',
    asunto: `Solvencia de biblioteca aprobada – ${s.solicitante}`,
    ...plantilla({
      titulo: 'Solvencia de biblioteca aprobada',
      previa: `Adjuntamos su constancia de solvencia (solicitud ${s.id})`,
      introduccion: [
        `Estimado(a) ${s.solicitante}:`,
        `Por este medio le informamos que su solicitud de solvencia de biblioteca, presentada el ${soloFecha(s.creadoEn)}, ha sido aprobada, luego de verificar el comprobante de pago y la orden de pago correspondientes.`,
        'Adjunto a este correo encontrará su constancia de solvencia en PDF, la cual podrá imprimir y presentar en los trámites que la requieran.',
      ],
      filas: [
        ['Número de solicitud', s.id, 'codigo'],
        ['Carné', s.identificacion],
        ['Fecha de aprobación', soloFecha(s.atendidaEn)],
        ...(s.fechaPapeleria ? [['Presenta su papelería el', fechaLarga(s.fechaPapeleria)]] : []),
      ],
      parrafos: ['Atentamente,', `${biblioteca.nombre}\n${biblioteca.facultad}`],
    }),
  };
}

function mensajeDeSolvenciaRechazada(s) {
  return {
    tipo: 'solvencia_rechazada',
    asunto: 'Solicitud de solvencia de biblioteca – Requiere corrección',
    ...plantilla({
      titulo: 'Su solicitud de solvencia requiere corrección',
      previa: `Solicitud ${s.id}: ${s.observacion}`,
      introduccion: [
        `Estimado(a) ${s.solicitante}:`,
        `Le informamos que su solicitud de solvencia de biblioteca, presentada el ${soloFecha(s.creadoEn)}, no pudo ser aprobada por el siguiente motivo:`,
      ],
      filas: [
        ['Motivo', s.observacion],
        ['Número de solicitud', s.id, 'codigo'],
        ['Carné', s.identificacion],
      ],
      parrafos: [
        'Le solicitamos corregir lo indicado y enviar nuevamente su solicitud a través del sistema, adjuntando el comprobante de pago y la orden de pago legibles.',
        `Para cualquier consulta puede comunicarse con nosotros por ${biblioteca.contacto}.`,
        'Atentamente,',
        `${biblioteca.nombre}\n${biblioteca.facultad}`,
      ],
    }),
  };
}

// Cuando el personal cancela o libera una reserva, quien dejó su correo se entera y sabe que puede reservar de nuevo.
function mensajeDeReservaCancelada(r) {
  return {
    tipo: 'reserva_cancelada',
    asunto: `Reserva ${r.id} cancelada`,
    ...plantilla({
      titulo: 'Tu reserva fue cancelada',
      previa: `${r.recursoNombre}, ${fechaLarga(r.fecha)}`,
      filas: [
        ['Número de reserva', r.id, 'codigo'],
        ['Lugar', r.recursoNombre],
        ['Horario', `${fechaLarga(r.fecha)}, de ${r.hora} a ${r.horaFin}`],
        ['A nombre de', r.solicitante],
      ],
      parrafos: ['La biblioteca canceló esta reserva y el lugar quedó disponible para otras personas. Si todavía lo necesitas, puedes hacer una reserva nueva en el kiosco o en el sitio.'],
    }),
  };
}

function mensajeDeReservaLiberada(r) {
  return {
    tipo: 'reserva_liberada',
    asunto: `Reserva ${r.id} liberada`,
    ...plantilla({
      titulo: 'Tu reserva se liberó',
      previa: `${r.recursoNombre}, ${fechaLarga(r.fecha)}`,
      filas: [
        ['Número de reserva', r.id, 'codigo'],
        ['Lugar', r.recursoNombre],
        ['Horario', `${fechaLarga(r.fecha)}, de ${r.hora} a ${r.horaFin}`],
        ['A nombre de', r.solicitante],
      ],
      parrafos: [
        'El personal de la biblioteca liberó este lugar porque no te presentaste a tiempo o porque avisaste que no ibas a llegar. Ya está disponible para otras personas. Si todavía lo necesitas, puedes hacer una reserva nueva en el kiosco o en el sitio.',
      ],
    }),
  };
}

// Quien no se presentó queda unas horas sin poder reservar: se le dice hasta cuándo y qué reservas suyas se cancelaron por eso.
function mensajeDeNoPresentado(r, canceladas = []) {
  const horas = r.horasDePenalizacion;
  return {
    tipo: 'reserva_no_presentado',
    asunto: `No te presentaste a tu reserva ${r.id}`,
    ...plantilla({
      titulo: 'No te presentaste a tu reserva',
      previa: `Podrás volver a reservar desde el ${momentoLargo(r.penalizadoHasta)}`,
      filas: [
        ['Número de reserva', r.id, 'codigo'],
        ['Lugar', r.recursoNombre],
        ['Horario', `${fechaLarga(r.fecha)}, de ${r.hora} a ${r.horaFin}`],
        ['A nombre de', r.solicitante],
        ['Puedes volver a reservar desde el', momentoLargo(r.penalizadoHasta)],
        ...(canceladas.length > 0
          ? [['Reservas canceladas', canceladas.map((c) => `${c.id}: ${c.recursoNombre}, ${fechaLarga(c.fecha)}, de ${c.hora} a ${c.horaFin}`).join('; ')]]
          : []),
      ],
      parrafos: [
        `No te presentaste dentro del tiempo de tolerancia, así que la reserva se liberó y el lugar quedó para otra persona. Por eso no podrás reservar ningún lugar de estudio durante ${horas} horas${canceladas.length > 0 ? ', y las reservas que tenías en ese tiempo se cancelaron' : ''}.`,
        'Si crees que es un error, consulta en el mostrador de la biblioteca.',
      ],
    }),
  };
}

// Para que el administrador compruebe desde el panel que el servidor sí puede enviar correos.
function mensajeDePrueba({ quien, cuando = new Date() }) {
  const { fecha, hora } = fechaYHora(cuando.toISOString());
  return {
    tipo: 'prueba',
    asunto: 'Correo de prueba de la biblioteca',
    ...plantilla({
      titulo: 'Correo de prueba',
      previa: 'Si lees esto, el correo de la biblioteca funciona.',
      filas: [
        ['Enviado por', quien],
        ['Fecha', `${fecha} · ${hora}`],
      ],
      parrafos: ['Si recibiste este mensaje, el servidor de la biblioteca puede enviar correos: los comprobantes de reservas y de solicitudes llegarán a quien los pida.'],
    }),
  };
}

// Los textos planos, tal como los pide el envío de comprobantes.
const textoDeReserva = (r) => mensajeDeReserva(r).texto;
const textoDeSolvencia = (s) => mensajeDeSolvencia(s).texto;

// --- Envíos ---------------------------------------------------------------------------------------------------------

// Si la persona dejó un correo al reservar, se le manda el comprobante sin que tenga que pedirlo.
function reservaConfirmada(reserva) {
  return avisarPorCorreo({ para: reserva.correo, ...mensajeDeReserva(reserva) });
}

function solvenciaRecibida(solicitud) {
  return avisarPorCorreo({ para: solicitud.correo, ...mensajeDeSolvencia(solicitud) });
}

// `constancia`: { nombre, contenido (Buffer del PDF) }.
function solvenciaAprobada(solicitud, constancia) {
  return avisarPorCorreo({
    para: solicitud.correo,
    ...mensajeDeSolvenciaAprobada(solicitud),
    adjuntos: [{ nombre: constancia.nombre, contenido: constancia.contenido, tipo: 'application/pdf' }],
  });
}

function solvenciaRechazada(solicitud) {
  return avisarPorCorreo({ para: solicitud.correo, ...mensajeDeSolvenciaRechazada(solicitud) });
}

// Cuánto se espera el correo de confirmación antes de responder: así la pantalla puede decir si salió o si falló. Si el servicio de
// correo tarda más, el envío sigue por su cuenta y la pantalla dice que va en camino (CORREO_ESPERA_CONFIRMACION_MS es para las pruebas).
const ESPERA_DE_LA_CONFIRMACION_MS = Number(process.env.CORREO_ESPERA_CONFIRMACION_MS) || 6000;

// Manda el comprobante de una reserva o una solicitud recién hecha y dice cómo le fue, para mostrarlo en pantalla:
//   null        no dejó correo
//   'enviado'   salió (puede tardar unos minutos en llegar a la bandeja)
//   'simulado'  el correo de la biblioteca no está configurado: no salió
//   'fallido'   el servicio de correo lo rechazó o no respondió
//   'pendiente' el servicio tarda: el envío sigue en segundo plano
async function confirmarPorCorreo(para, enviar) {
  if (!para) return null;
  let reloj;
  const espera = new Promise((resolver) => {
    reloj = setTimeout(() => resolver('pendiente'), ESPERA_DE_LA_CONFIRMACION_MS);
  });
  const resultado = await Promise.race([enviar(), espera]);
  clearTimeout(reloj);
  if (resultado === 'pendiente') return 'pendiente';
  if (!resultado) return 'fallido';
  return resultado.simulado ? 'simulado' : 'enviado';
}

function reservaCancelada(reserva) {
  return avisarPorCorreo({ para: reserva.correo, ...mensajeDeReservaCancelada(reserva) });
}

function reservaLiberada(reserva) {
  return avisarPorCorreo({ para: reserva.correo, ...mensajeDeReservaLiberada(reserva) });
}

// Si la reserva a la que faltó no tenía correo, se usa el de alguna de las que se cancelaron.
function noSePresento({ reserva, canceladas }) {
  const para = reserva.correo || canceladas.find((c) => c.correo)?.correo;
  return avisarPorCorreo({ para, ...mensajeDeNoPresentado(reserva, canceladas) });
}

module.exports = {
  mensajeDeReserva,
  mensajeDeReservaCancelada,
  mensajeDeReservaLiberada,
  mensajeDeNoPresentado,
  mensajeDeSolvencia,
  mensajeDeSolvenciaAprobada,
  mensajeDeSolvenciaRechazada,
  mensajeDePrueba,
  textoDeReserva,
  textoDeSolvencia,
  reservaConfirmada,
  confirmarPorCorreo,
  reservaCancelada,
  reservaLiberada,
  noSePresento,
  solvenciaRecibida,
  solvenciaAprobada,
  solvenciaRechazada,
};
