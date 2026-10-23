const { RECURSOS, CONDICIONES } = require('./recursos_data');
const configuracion = require('../configuracion/configuracion_data');
const horarios = require('../horarios/horarios_data');
const almacen = require('../../utils/almacen');
const { rechazo } = require('../../utils/errores');
const { esFechaISO, fechaLocal, minutosDelDia, sumarDias } = require('../../utils/fechas');
const { generarCodigoConfirmacion, correoValido } = require('../../utils/codigos');

// Las reservas se guardan en el almacén de datos (ver utils/almacen.js): no se pierden al reiniciar el servidor.
const estado = almacen.cargar('reservas', { reservas: [], contador: 0 });
const reservas = estado.reservas;
// Sanciones que pone el personal a mano (además de la automática por no presentarse): ver «Sanciones del personal», más abajo.
if (!Array.isArray(estado.sanciones)) estado.sanciones = [];
const sanciones = estado.sanciones;

function guardar() {
  almacen.guardar('reservas', estado);
}

function siguienteCodigo() {
  estado.contador += 1;
  return String(estado.contador).padStart(3, '0');
}

function recursosDe(tipo) {
  return RECURSOS[tipo] || [];
}

// Una reserva cancelada o liberada (por no presentarse o por decisión del personal) ya no ocupa el lugar
// ni cuenta para el tope diario de la persona.
const ESTADOS_SIN_OCUPAR = ['cancelado', 'liberada'];
const vigente = (r) => !ESTADOS_SIN_OCUPAR.includes(r.estado);

const horaEntera = (numero) => `${String(numero).padStart(2, '0')}:00`;

// Horas que ocupa una reserva ya hecha: `duracion` horas seguidas desde `hora`. Se calcula sin mirar los horarios
// de hoy, porque el administrador puede cambiarlos después y una reserva existente no debe dejar de ocupar su lugar.
function franjasDeReserva(reserva) {
  const inicio = Number(reserva.hora.slice(0, 2));
  return Array.from({ length: reserva.duracion }, (_, i) => horaEntera(inicio + i));
}

// Horas que cubriría una reserva nueva si cabe en el horario de ese día: `duracion` horas seguidas desde `hora`, todas
// dentro de las horas reservables (las que dejan fuera, por ejemplo, el cierre del mediodía). Si no cabe, devuelve menos.
function franjasCubiertas(fecha, hora, duracion) {
  const delDia = horarios.franjasDeReserva(fecha);
  if (!delDia.includes(hora)) return [];
  const inicio = Number(hora.slice(0, 2));
  const cubiertas = [];
  for (let i = 0; i < duracion && delDia.includes(horaEntera(inicio + i)); i += 1) {
    cubiertas.push(horaEntera(inicio + i));
  }
  return cubiertas;
}

function horaFinal(franjas) {
  return horaEntera(Number(franjas[franjas.length - 1].slice(0, 2)) + 1);
}

function momentoDeReserva(reserva, hora) {
  const [anio, mes, dia] = reserva.fecha.split('-').map(Number);
  const [horas, minutos] = hora.split(':').map(Number);
  return new Date(anio, mes - 1, dia, horas, minutos, 0, 0);
}

const inicioDeReserva = (reserva) => momentoDeReserva(reserva, reserva.hora);
const finDeReserva = (reserva) => momentoDeReserva(reserva, reserva.horaFin);

// El carné, el correo o el documento se comparan sin importar mayúsculas ni espacios de más: «AB123» y «ab123 » son la misma persona.
const mismaPersona = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// --- Penalización por no presentarse ---------------------------------------------------------------------------------
// Quien no se presenta a una reserva (se libera sola al pasar la tolerancia) queda unas horas sin poder reservar ningún lugar de
// estudio: 48 por defecto, las fija el administrador en la configuración. Se cuentan desde que venció la tolerancia, aunque el
// servidor se dé cuenta más tarde. Las otras reservas que esa persona tenía para ese tiempo se cancelan, y el lugar queda libre para
// otra persona. El personal puede quitar la penalización (por ejemplo, si avisó y no se registró el aviso).
const HORA_MS = 60 * 60 * 1000;
const avisosDePenalizacion = [];

// Para que el controlador avise por correo: `fn({ reserva, canceladas })` se llama cada vez que alguien queda penalizado.
function cuandoSePenalice(fn) {
  avisosDePenalizacion.push(fn);
}

function penalizar(reserva, vencioEn, horas) {
  const hasta = new Date(vencioEn.getTime() + horas * HORA_MS);
  reserva.penalizadoHasta = hasta.toISOString();
  reserva.horasDePenalizacion = horas;
  const canceladas = reservas.filter(
    (r) =>
      r !== reserva &&
      r.estado === 'reservado' &&
      mismaPersona(r.identificacion, reserva.identificacion) &&
      inicioDeReserva(r).getTime() >= vencioEn.getTime() &&
      inicioDeReserva(r).getTime() < hasta.getTime()
  );
  canceladas.forEach((r) => {
    r.estado = 'cancelado';
    r.canceladaEn = new Date().toISOString();
    r.motivoCancelacion = 'penalizacion';
    r.canceladaPorFaltaEn = reserva.id;
  });
  return { reserva, canceladas };
}

const penalizacionVigente = (r, ahora) => Boolean(r.penalizadoHasta) && !r.penalizacionQuitada && new Date(r.penalizadoHasta).getTime() > ahora.getTime();

// La penalización que tiene ahora una persona (la que termina más tarde, si faltó a más de una), o null.
function penalizacionDe(identificacion, ahora = new Date()) {
  return (
    reservas
      .filter((r) => penalizacionVigente(r, ahora) && mismaPersona(r.identificacion, identificacion))
      .sort((a, b) => b.penalizadoHasta.localeCompare(a.penalizadoHasta))[0] ?? null
  );
}

// --- Sanciones del personal ----------------------------------------------------------------------------------------
// Además de la penalización automática, el personal puede sancionar a mano a una persona (por ejemplo, por mal uso de un cubículo):
// elige cuántas horas queda sin poder reservar y escribe el motivo. Como con la penalización, las reservas que tenía en ese tiempo se
// cancelan, y la sanción se puede quitar.
const HORAS_MAXIMAS_DE_SANCION = 168;
const sancionVigente = (s, ahora) => !s.quitada && new Date(s.hasta).getTime() > ahora.getTime();

// La sanción vigente de una persona (la que termina más tarde), o null.
function sancionDe(identificacion, ahora = new Date()) {
  return (
    sanciones
      .filter((s) => sancionVigente(s, ahora) && mismaPersona(s.identificacion, identificacion))
      .sort((a, b) => b.hasta.localeCompare(a.hasta))[0] ?? null
  );
}

// Lo que impide reservar a una persona ahora: { tipo: 'falta', reserva, hasta } o { tipo: 'sancion', sancion, hasta }, el que dura más.
function bloqueoDe(identificacion, ahora = new Date()) {
  const falta = penalizacionDe(identificacion, ahora);
  const sancion = sancionDe(identificacion, ahora);
  if (falta && (!sancion || falta.penalizadoHasta >= sancion.hasta)) return { tipo: 'falta', reserva: falta, hasta: falta.penalizadoHasta };
  if (sancion) return { tipo: 'sancion', sancion, hasta: sancion.hasta };
  return null;
}

function sancionar({ identificacion, horas, motivo, reservaId } = {}, sesion, ahora = new Date()) {
  const documento = String(identificacion ?? '').trim();
  if (!documento) throw rechazo('Indica el carné o la identificación de la persona');
  const cuantas = Number(horas);
  if (!Number.isInteger(cuantas) || cuantas < 1 || cuantas > HORAS_MAXIMAS_DE_SANCION) {
    throw rechazo(`La sanción debe ser de 1 a ${HORAS_MAXIMAS_DE_SANCION} horas sin poder reservar`);
  }
  const texto = String(motivo ?? '').trim().replace(/\s+/g, ' ');
  if (texto.length < 3 || texto.length > 300) throw rechazo('Escribe el motivo de la sanción (de 3 a 300 caracteres)');
  // El nombre y el correo salen de sus reservas (la más reciente): así el aviso le llega aunque el personal solo sepa el carné.
  const suyas = reservas.filter((r) => mismaPersona(r.identificacion, documento)).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
  if (suyas.length === 0) throw rechazo('No hay reservas con ese carné: revisa que esté bien escrito', 404);
  const relacionada = reservaId ? suyas.find((r) => r.id === reservaId) : null;
  estado.contadorDeSanciones = (estado.contadorDeSanciones ?? 0) + 1;
  const hasta = new Date(ahora.getTime() + cuantas * HORA_MS);
  const sancion = {
    id: `S-${String(estado.contadorDeSanciones).padStart(3, '0')}`,
    identificacion: suyas[0].identificacion,
    solicitante: suyas[0].solicitante,
    ...(suyas.find((r) => r.correo) ? { correo: suyas.find((r) => r.correo).correo } : {}),
    ...(relacionada ? { reservaId: relacionada.id, recursoNombre: relacionada.recursoNombre } : {}),
    motivo: texto,
    horas: cuantas,
    desde: ahora.toISOString(),
    hasta: hasta.toISOString(),
    por: { usuario: sesion?.usuario ?? null, nombre: sesion?.nombre ?? null },
  };
  sanciones.push(sancion);
  const canceladas = reservas.filter(
    (r) => r.estado === 'reservado' && mismaPersona(r.identificacion, documento) && inicioDeReserva(r).getTime() >= ahora.getTime() && inicioDeReserva(r).getTime() < hasta.getTime()
  );
  canceladas.forEach((r) => {
    r.estado = 'cancelado';
    r.canceladaEn = ahora.toISOString();
    r.motivoCancelacion = 'sancion';
    r.canceladaPorSancion = sancion.id;
  });
  guardar();
  return { sancion, canceladas };
}

function quitarSancion(id, sesion, ahora = new Date()) {
  const sancion = sanciones.find((s) => s.id === id);
  if (!sancion) return null;
  if (!sancionVigente(sancion, ahora)) throw rechazo('Esa sanción ya terminó o ya se quitó', 409);
  sancion.quitada = { en: ahora.toISOString(), por: sesion?.usuario ?? null };
  guardar();
  return sancion;
}

// Todas las sanciones del personal (vigentes, terminadas y quitadas), la más reciente primero: el historial de cada carné.
function listarSanciones() {
  return sanciones.slice().sort((a, b) => b.desde.localeCompare(a.desde));
}

// Quién no puede reservar ahora (por no presentarse o por una sanción), el que termina primero arriba: el personal lo ve en el panel.
function penalizaciones(ahora = new Date()) {
  liberarVencidas(ahora);
  const faltas = reservas
    .filter((r) => penalizacionVigente(r, ahora))
    .map((r) => ({
      tipo: 'falta',
      reservaId: r.id,
      solicitante: r.solicitante,
      identificacion: r.identificacion,
      recursoNombre: r.recursoNombre,
      fecha: r.fecha,
      hora: r.hora,
      horaFin: r.horaFin,
      hasta: r.penalizadoHasta,
      canceladas: reservas.filter((c) => c.canceladaPorFaltaEn === r.id).map((c) => c.id),
    }));
  const manuales = sanciones
    .filter((s) => sancionVigente(s, ahora))
    .map((s) => ({
      tipo: 'sancion',
      sancionId: s.id,
      solicitante: s.solicitante,
      identificacion: s.identificacion,
      motivo: s.motivo,
      horas: s.horas,
      por: s.por,
      desde: s.desde,
      hasta: s.hasta,
      canceladas: reservas.filter((c) => c.canceladaPorSancion === s.id).map((c) => c.id),
    }));
  return [...faltas, ...manuales].sort((a, b) => a.hasta.localeCompare(b.hasta));
}

function quitarPenalizacion(id, sesion, ahora = new Date()) {
  const reserva = buscarReserva(id);
  if (!reserva) return null;
  if (!penalizacionVigente(reserva, ahora)) {
    throw rechazo('Esa reserva no tiene una penalización vigente', 409);
  }
  reserva.penalizacionQuitada = { en: ahora.toISOString(), por: sesion?.usuario ?? null };
  guardar();
  return reserva;
}

// "lunes 19 de octubre" y "lunes 19 de octubre a las 09:15", para los avisos.
const diaLegible = (d) => d.toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
function momentoLegible(iso) {
  const d = new Date(iso);
  return `${diaLegible(d)} a las ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Pone al día las reservas según la hora que es, y se revisa cada vez que se consulta:
//  - Si quien reservó no se presenta dentro de la tolerancia (no se "sella el ingreso"), la reserva se libera sola y el lugar
//    vuelve a estar disponible (propuesta, sección 4.5.2). Los minutos de tolerancia los fija el administrador. Además, esa persona
//    queda penalizada (ver arriba).
//  - Si la persona está adentro y su hora terminó, la reserva se da por finalizada: el personal no tiene que cerrarla a mano.
function liberarVencidas(ahora = new Date()) {
  const tolerancia = configuracion.toleranciaMinutos() * 60 * 1000;
  const horasDeCastigo = configuracion.horasDePenalizacion();
  const penalizadas = [];
  let huboCambios = false;
  reservas.forEach((reserva) => {
    if (reserva.estado === 'reservado' && ahora.getTime() >= inicioDeReserva(reserva).getTime() + tolerancia) {
      reserva.estado = 'liberada';
      reserva.liberadaEn = ahora.toISOString();
      reserva.motivoLiberacion = 'no_presentado';
      if (horasDeCastigo > 0) penalizadas.push(penalizar(reserva, new Date(inicioDeReserva(reserva).getTime() + tolerancia), horasDeCastigo));
      huboCambios = true;
    } else if (reserva.estado === 'en_uso' && ahora.getTime() >= finDeReserva(reserva).getTime()) {
      reserva.estado = 'finalizado';
      reserva.salidaEn = finDeReserva(reserva).toISOString();
      reserva.salidaAutomatica = true;
      huboCambios = true;
    }
  });
  if (huboCambios) guardar();
  penalizadas.forEach((penalizada) =>
    avisosDePenalizacion.forEach((avisar) => {
      try {
        avisar(penalizada);
      } catch (err) {
        console.error('No se pudo avisar de una penalización:', err.message);
      }
    })
  );
}

function horasOcupadas(tipo, recursoId, fecha) {
  return reservas
    .filter((r) => r.tipo === tipo && r.recursoId === recursoId && r.fecha === fecha && vigente(r))
    .flatMap(franjasDeReserva);
}

// Las reservas vigentes de una persona ese día, en cualquier lugar de estudio.
function reservasDePersona(identificacion, fecha) {
  return reservas.filter((r) => r.fecha === fecha && vigente(r) && mismaPersona(r.identificacion, identificacion));
}

// Cada lugar con las horas de ese día y si están libres. Los días de cierre y las horas fuera de las ventanas de reserva
// no aparecen: si la biblioteca no atiende, la lista de horas viene vacía.
function disponibilidad(tipo, fecha) {
  liberarVencidas();
  const delDia = horarios.franjasDeReserva(fecha);
  return recursosDe(tipo).map((recurso) => {
    const ocupadas = horasOcupadas(tipo, recurso.id, fecha);
    return {
      ...recurso,
      franjas: delDia.map((hora) => ({ hora, disponible: !ocupadas.includes(hora) })),
    };
  });
}

// Cuántas horas dura una reserva (de cualquier lugar de estudio): se elige desde qué hora hasta qué hora (`horaFin`, una hora entera,
// p. ej. "13:00"), o se indica la duración en horas (`duracion`). Sin ninguna de las dos es de una hora.
function horasDeReserva({ hora, horaFin, duracion }) {
  if (horaFin !== undefined && horaFin !== null && horaFin !== '') {
    if (!/^([01]\d|2[0-3]):00$/.test(String(horaFin))) {
      throw rechazo('La hora final debe ser una hora entera, por ejemplo 13:00');
    }
    const horas = Number(String(horaFin).slice(0, 2)) - Number(hora.slice(0, 2));
    if (horas < 1) {
      throw rechazo('La hora final debe ser posterior a la hora de inicio');
    }
    return horas;
  }
  if (duracion === undefined || duracion === null || duracion === '') return 1;
  const horas = Number(duracion);
  if (!Number.isInteger(horas) || horas < 1) {
    throw rechazo('La duración de la reserva debe ser de al menos una hora');
  }
  return horas;
}

// Reglas de las reservas: horas enteras, hasta un máximo de horas por reserva y por persona al día entre todos los lugares de
// estudio (el administrador los fija en la configuración).
function validarLimites({ fecha, horas, identificacion }) {
  const { maxHorasPorReserva, maxHorasPorDia } = configuracion.limitesDeHoras();
  if (horas > maxHorasPorReserva) {
    throw rechazo(`Una reserva puede ser de ${maxHorasPorReserva} horas como máximo; elige una hora final más cercana`);
  }

  const yaReservadas = reservasDePersona(identificacion, fecha).reduce((total, r) => total + r.duracion, 0);
  if (yaReservadas + horas > maxHorasPorDia) {
    throw rechazo(
      `Superarías el máximo de ${maxHorasPorDia} horas de reservas al día por persona (ya tienes ${yaReservadas}). Elige menos horas u otro día.`
    );
  }
}

// Cómo se nombra cada lugar en los avisos («Este cubículo ya está reservado…», «Esta silla ya está reservada…»).
const LUGAR = {
  cubiculo: { este: 'Este cubículo', reservado: 'reservado', otro: 'otro cubículo' },
  estacion: { este: 'Esta estación', reservado: 'reservada', otro: 'otra estación' },
  sala_lectura: { este: 'Esta silla', reservado: 'reservada', otro: 'otra silla' },
};

function kioscoValido(kiosco) {
  return typeof kiosco === 'string' && /^[0-9A-Za-z_-]{1,10}$/.test(kiosco) ? kiosco : null;
}

function crearReserva({ tipo, recursoId, fecha, hora, horaFin, solicitante, identificacion, correo, kiosco, duracion }) {
  liberarVencidas();
  if (configuracion.reservasPausadas(tipo)) {
    throw rechazo(configuracion.mensajeDePausa(tipo), 503);
  }
  const recurso = recursosDe(tipo).find((r) => r.id === recursoId);
  if (!recurso) {
    throw rechazo('Ese recurso no existe', 404);
  }
  if (!esFechaISO(fecha)) {
    throw rechazo('La fecha de la reserva no es válida');
  }
  // No se reserva en el pasado ni demasiado adelante. Una hora de hoy se puede reservar mientras no se acabe su tolerancia:
  // después, la reserva se liberaría sola al instante.
  const hoy = fechaLocal();
  if (fecha < hoy) {
    throw rechazo('No puedes reservar en una fecha que ya pasó');
  }
  if (fecha > sumarDias(hoy, CONDICIONES.diasMaximosDeAnticipacion)) {
    throw rechazo(`Solo puedes reservar hasta ${CONDICIONES.diasMaximosDeAnticipacion} días adelante`);
  }
  const cierre = horarios.cierreDe(fecha);
  if (cierre) {
    throw rechazo(`La biblioteca está cerrada ese día (${cierre.motivo}). Elige otra fecha.`, 409);
  }
  if (!horarios.franjasDeReserva(fecha).includes(hora)) {
    throw rechazo('Esa hora no está dentro del horario de reservas de ese día');
  }
  if (fecha === hoy && minutosDelDia() >= Number(hora.slice(0, 2)) * 60 + configuracion.toleranciaMinutos()) {
    throw rechazo('Esa hora ya pasó: elige una hora posterior');
  }

  const documento = String(identificacion || '').trim();
  if (!documento) {
    throw rechazo('Indica tu carné, correo institucional o documento para reservar');
  }
  const bloqueo = bloqueoDe(documento);
  if (bloqueo?.tipo === 'falta') {
    const falta = bloqueo.reserva;
    throw rechazo(
      `No puedes reservar hasta el ${momentoLegible(falta.penalizadoHasta)}: no te presentaste a tu reserva ${falta.id} (${falta.recursoNombre}, ${diaLegible(momentoDeReserva(falta, falta.hora))} a las ${falta.hora}). Si crees que es un error, consulta en el mostrador de la biblioteca.`,
      403
    );
  }
  if (bloqueo?.tipo === 'sancion') {
    throw rechazo(
      `No puedes reservar hasta el ${momentoLegible(bloqueo.hasta)}: la biblioteca te sancionó (${bloqueo.sancion.motivo}). Si crees que es un error, consulta en el mostrador de la biblioteca.`,
      403
    );
  }
  const correoLimpio = String(correo || '').trim();
  if (correoLimpio && !correoValido(correoLimpio)) {
    throw rechazo('El correo no es válido');
  }

  // Todos los lugares de estudio se reservan por horas: de la hora de inicio a la hora final.
  const horas = horasDeReserva({ hora, horaFin, duracion });
  validarLimites({ fecha, horas, identificacion: documento });

  const cubiertas = franjasCubiertas(fecha, hora, horas);
  if (cubiertas.length < horas) {
    throw rechazo('Ese horario no cabe en el horario de reservas de ese día: la reserva debe quedar dentro de las horas que se ofrecen (sin cruzar la pausa del mediodía)');
  }
  const ocupadas = horasOcupadas(tipo, recursoId, fecha);
  if (cubiertas.some((franja) => ocupadas.includes(franja))) {
    const lugar = LUGAR[tipo];
    throw rechazo(`${lugar.este} ya está ${lugar.reservado} en ese horario. Intenta con ${lugar.otro} o cambia la hora.`, 409);
  }
  // Una persona no puede estar en dos lugares de estudio a la vez.
  const horasDeLaPersona = reservasDePersona(documento, fecha).flatMap(franjasDeReserva);
  if (cubiertas.some((franja) => horasDeLaPersona.includes(franja))) {
    throw rechazo('Ya tienes otro lugar de estudio reservado en ese horario');
  }

  const reserva = {
    id: `R-${siguienteCodigo()}`,
    tipo,
    recursoId,
    recursoNombre: recurso.nombre,
    fecha,
    hora,
    horaFin: horaFinal(cubiertas),
    duracion: horas,
    solicitante,
    identificacion: documento,
    ...(correoLimpio ? { correo: correoLimpio } : {}),
    ...(kioscoValido(kiosco) ? { kiosco: kioscoValido(kiosco) } : {}),
    codigoConfirmacion: generarCodigoConfirmacion(),
    estado: 'reservado',
    creadoEn: new Date().toISOString(),
  };
  reservas.push(reserva);
  guardar();
  return reserva;
}

function listarReservas({ tipo } = {}) {
  liberarVencidas();
  return reservas
    .filter((r) => !tipo || r.tipo === tipo)
    .slice()
    .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn));
}

function buscarReserva(id) {
  return reservas.find((r) => r.id === id) || null;
}

const SIGUIENTE_ESTADO = { reservado: 'en_uso', en_uso: 'finalizado' };

// Quien se va antes de que termine su reserva deja libres las horas que no usó, para que otra persona las reserve. La hora que ya
// empezó cuenta como usada (las reservas son de horas enteras) y siempre queda al menos una hora. Solo cuenta si la reserva es de
// hoy: una de otro día no libera nada con salir.
function liberarHorasSinUsar(reserva, ahora) {
  if (reserva.fecha !== fechaLocal(ahora)) return;
  const inicio = Number(reserva.hora.slice(0, 2));
  const fin = Number(reserva.horaFin.slice(0, 2));
  const horaActual = ahora.getHours() + ahora.getMinutes() / 60 + ahora.getSeconds() / 3600;
  const nuevoFin = Math.max(Math.ceil(horaActual), inicio + 1);
  if (nuevoFin >= fin) return;
  reserva.horaFinOriginal = reserva.horaFin;
  reserva.horaFin = horaEntera(nuevoFin);
  reserva.duracion = nuevoFin - inicio;
  reserva.salioAntes = true;
}

// Sella el ingreso (reservado → en uso) o la salida (en uso → finalizado). Al sellar la salida de alguien que se va antes de que
// termine su hora, las horas que no usó quedan libres. `ahora` solo se cambia en las pruebas.
function avanzarEstado(id, ahora = new Date()) {
  liberarVencidas(ahora);
  const reserva = buscarReserva(id);
  if (!reserva) return null;
  const siguiente = SIGUIENTE_ESTADO[reserva.estado];
  if (!siguiente) return reserva;
  if (siguiente === 'en_uso') {
    reserva.ingresoEn = ahora.toISOString();
  } else {
    reserva.salidaEn = ahora.toISOString();
    liberarHorasSinUsar(reserva, ahora);
  }
  reserva.estado = siguiente;
  guardar();
  return reserva;
}

// Cancela una reserva que sigue vigente (esperando a la persona o con ella adentro). Una ya finalizada, liberada o cancelada no
// se toca: es parte del historial.
function cancelarReserva(id) {
  liberarVencidas();
  const reserva = buscarReserva(id);
  if (!reserva) return null;
  if (!['reservado', 'en_uso'].includes(reserva.estado)) {
    throw rechazo('Solo se puede cancelar una reserva que sigue reservada o en uso', 409);
  }
  reserva.estado = 'cancelado';
  reserva.canceladaEn = new Date().toISOString();
  guardar();
  return reserva;
}

// El personal libera a mano un lugar reservado (por ejemplo, si avisaron que no llegarán):
// vuelve a estar disponible para los usuarios.
function liberarReserva(id) {
  liberarVencidas();
  const reserva = buscarReserva(id);
  if (!reserva) return null;
  if (reserva.estado !== 'reservado') {
    throw rechazo('Solo se puede liberar una reserva que sigue en estado reservado', 409);
  }
  reserva.estado = 'liberada';
  reserva.liberadaEn = new Date().toISOString();
  reserva.motivoLiberacion = 'manual';
  guardar();
  return reserva;
}

// El personal libera de una vez los lugares de quienes no han llegado y ya pasó su hora de inicio, sin esperar a que termine la
// tolerancia. Es lo mismo que haría el sistema al vencer la tolerancia: el lugar queda libre y la persona queda penalizada por no
// presentarse (para liberar sin castigo a quien avisó, está «No llegó» en cada reserva).
function liberarNoLlegaron(ahora = new Date()) {
  liberarVencidas(ahora);
  const hoy = fechaLocal(ahora);
  const horasDeCastigo = configuracion.horasDePenalizacion();
  const pendientes = reservas.filter((r) => r.estado === 'reservado' && r.fecha === hoy && ahora.getTime() >= inicioDeReserva(r).getTime());
  const penalizadas = [];
  pendientes.forEach((reserva) => {
    reserva.estado = 'liberada';
    reserva.liberadaEn = ahora.toISOString();
    reserva.motivoLiberacion = 'no_presentado';
    reserva.liberadaPorElPersonal = true;
    if (horasDeCastigo > 0) penalizadas.push(penalizar(reserva, ahora, horasDeCastigo));
  });
  if (pendientes.length > 0) guardar();
  penalizadas.forEach((penalizada) =>
    avisosDePenalizacion.forEach((avisar) => {
      try {
        avisar(penalizada);
      } catch (err) {
        console.error('No se pudo avisar de una penalización:', err.message);
      }
    })
  );
  return pendientes;
}

// Cuántos lugares de cada tipo hay ocupados en esta hora: con la persona adentro, o reservados y esperando a que llegue.
function ocupacionAhora(ahora = new Date()) {
  const hoy = fechaLocal(ahora);
  const horaActual = ahora.getHours();
  const porTipo = Object.fromEntries(Object.keys(RECURSOS).map((tipo) => [tipo, { total: RECURSOS[tipo].length, enUso: 0, esperando: 0 }]));
  reservas.forEach((r) => {
    if (r.fecha !== hoy || !['reservado', 'en_uso'].includes(r.estado) || !porTipo[r.tipo]) return;
    if (horaActual < Number(r.hora.slice(0, 2)) || horaActual >= Number(r.horaFin.slice(0, 2))) return; // no cubre esta hora
    porTipo[r.tipo][r.estado === 'en_uso' ? 'enUso' : 'esperando'] += 1;
  });
  return porTipo;
}

function resumen() {
  liberarVencidas();
  const hoy = fechaLocal();
  return {
    lugares: ocupacionAhora(),
    total: reservas.length,
    hoy: reservas.filter((r) => r.fecha === hoy).length,
    activas: reservas.filter((r) => ['reservado', 'en_uso'].includes(r.estado)).length,
    // Las de hoy que el personal todavía tiene que atender (esperando a la persona o con la persona adentro): el aviso del menú.
    porAtenderHoy: reservas.filter((r) => r.fecha === hoy && ['reservado', 'en_uso'].includes(r.estado)).length,
    liberadas: reservas.filter((r) => r.estado === 'liberada').length,
    // Los lugares que se liberaron en la última hora porque la persona no llegó: el panel lo avisa (con voz, si se quiere).
    liberadasRecientes: reservas
      .filter((r) => r.estado === 'liberada' && r.motivoLiberacion === 'no_presentado' && r.liberadaEn && Date.now() - new Date(r.liberadaEn).getTime() < HORA_MS)
      .sort((a, b) => b.liberadaEn.localeCompare(a.liberadaEn))
      .slice(0, 10)
      .map(({ id, solicitante, recursoNombre, liberadaEn }) => ({ id, solicitante, recursoNombre, liberadaEn })),
  };
}

module.exports = {
  recursosDe,
  liberarVencidas,
  disponibilidad,
  crearReserva,
  listarReservas,
  buscarReserva,
  avanzarEstado,
  cancelarReserva,
  liberarReserva,
  franjasDeReserva,
  ocupacionAhora,
  resumen,
  cuandoSePenalice,
  penalizacionDe,
  penalizaciones,
  quitarPenalizacion,
  bloqueoDe,
  sancionar,
  quitarSancion,
  listarSanciones,
  liberarNoLlegaron,
  HORAS_MAXIMAS_DE_SANCION,
};
