// Sanciones a mano del personal, «Liberar a los que no llegaron» y el interruptor de la solicitud de solvencia (web y kiosco).
// Se usa un RELOJ FALSO sobre un lunes futuro, como en penalizacion.mjs.
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

process.env.DATA_DIR = path.join(os.tmpdir(), `sanciones-${Date.now()}`);
process.env.TZ = 'America/Guatemala';
const require = createRequire(import.meta.url);
const R = require('../src/reservas/reservas_data.js');
const configuracion = require('../src/configuracion/configuracion_data.js');
const solvencia = require('../src/solvencia/solvencia_data.js');
const notificaciones = require('../src/notificaciones/notificaciones.js');

let fallos = 0;
let comprobaciones = 0;
const ok = (cond, msg) => {
  comprobaciones += 1;
  if (!cond) {
    fallos += 1;
    console.log('  FALLA:', msg);
  }
};
const lanza = (fn) => {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
};

const dos = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const lunes = (() => {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d;
})();
const dia = (masDias) => iso(new Date(lunes.getTime() + masDias * 24 * 3600 * 1000));
const LUNES = dia(0);
const MARTES = dia(1);
const VIERNES = dia(4);
const a = (fecha, hora) => new Date(`${fecha}T${hora}`); // reloj falso
const reservar = (persona, fecha, hora, horaFin, recursoId, extra = {}) =>
  R.crearReserva({ tipo: 'estacion', recursoId, fecha, hora, horaFin, solicitante: `Persona ${persona}`, identificacion: persona, ...extra });
const sesion = { usuario: 'circulacion', nombre: 'Circulación' };

console.log('Sanción a mano');
const primera = reservar('2020-ana', LUNES, '09:00', '10:00', 'est-1', { correo: 'ana@ejemplo.com' });
const otraDelLunes = reservar('2020-ana', LUNES, '15:00', '16:00', 'est-2');
const delViernes = reservar('2020-ana', VIERNES, '09:00', '10:00', 'est-3');
const deOtra = reservar('2020-beto', LUNES, '15:00', '16:00', 'est-4');
ok(lanza(() => R.sancionar({ identificacion: '2020-ana', horas: 0, motivo: 'Ruido' }, sesion, a(LUNES, '08:00')))?.estado === 400, '0 horas no vale');
ok(lanza(() => R.sancionar({ identificacion: '2020-ana', horas: 169, motivo: 'Ruido' }, sesion, a(LUNES, '08:00')))?.estado === 400, 'más de una semana no vale');
ok(lanza(() => R.sancionar({ identificacion: '2020-ana', horas: 24, motivo: 'ab' }, sesion, a(LUNES, '08:00')))?.estado === 400, 'el motivo es obligatorio');
ok(lanza(() => R.sancionar({ identificacion: 'nadie', horas: 24, motivo: 'Ruido' }, sesion, a(LUNES, '08:00')))?.estado === 404, 'un carné sin reservas -> 404');
const { sancion, canceladas } = R.sancionar({ identificacion: ' 2020-ANA ', horas: 48, motivo: '  Mal  uso del lugar ', reservaId: primera.id }, sesion, a(LUNES, '08:00'));
ok(sancion.id === 'S-001' && sancion.horas === 48 && sancion.motivo === 'Mal uso del lugar', `se registra (${sancion.id}, ${sancion.motivo})`);
ok(sancion.solicitante === 'Persona 2020-ana' && sancion.correo === 'ana@ejemplo.com', 'toma el nombre y el correo de sus reservas');
ok(sancion.hasta === a(MIERCOLES(), '08:00').toISOString(), 'dura 48 horas desde que se puso');
ok(sancion.por.usuario === 'circulacion', 'queda quién la puso');
ok(canceladas.map((c) => c.id).sort().join() === [primera.id, otraDelLunes.id].sort().join(), 'cancela sus reservas de ese tiempo');
ok(R.buscarReserva(delViernes.id).estado === 'reservado', 'la del viernes (fuera de la sanción) sigue');
ok(R.buscarReserva(deOtra.id).estado === 'reservado', 'las de otra persona no se tocan');
ok(R.buscarReserva(primera.id).motivoCancelacion === 'sancion' && R.buscarReserva(primera.id).canceladaPorSancion === 'S-001', 'la cancelación dice que fue por la sanción');
const bloqueo = R.bloqueoDe('2020-ana', a(LUNES, '12:00'));
ok(bloqueo?.tipo === 'sancion' && bloqueo.sancion.id === 'S-001', 'mientras dura, la persona está bloqueada');
ok(!R.bloqueoDe('2020-ana', a(dia(2), '08:01')), 'y deja de estarlo al terminar');
const lista = R.penalizaciones(a(LUNES, '12:00'));
ok(lista.some((p) => p.tipo === 'sancion' && p.sancionId === 'S-001' && p.motivo === 'Mal uso del lugar' && p.canceladas.length === 2), 'aparece en «Sin poder reservar»');
const mensaje = notificaciones.mensajeDeSancion(sancion, canceladas);
ok(/Sanción en el servicio de reservas/.test(mensaje.asunto) && /Mal uso del lugar/.test(mensaje.texto) && /48 horas/.test(mensaje.texto), 'el correo dice el motivo y cuánto dura');
ok(lanza(() => R.quitarSancion('S-001', sesion, a(dia(3), '08:00')))?.estado === 409, 'una sanción que ya terminó no se quita');
const quitada = R.quitarSancion('S-001', sesion, a(LUNES, '12:00'));
ok(quitada.quitada?.por === 'circulacion' && !R.bloqueoDe('2020-ana', a(LUNES, '12:01')), 'al quitarla, ya puede reservar');
ok(R.listarSanciones()[0].id === 'S-001', 'el historial la conserva aunque se haya quitado');
ok(lanza(() => R.quitarSancion('S-001', sesion, a(LUNES, '12:05')))?.estado === 409, 'quitarla dos veces -> 409');

console.log('Liberar a los que no llegaron');
const avisos = [];
R.cuandoSePenalice((p) => avisos.push(p));
const noLlega = reservar('2020-carla', MARTES, '09:00', '10:00', 'est-6', { correo: 'carla@ejemplo.com' });
const llega = reservar('2020-dani', MARTES, '09:00', '10:00', 'est-7');
const masTarde = reservar('2020-eva', MARTES, '11:00', '12:00', 'est-8');
const otroDia = reservar('2020-fede', dia(2), '09:00', '10:00', 'est-9');
R.avanzarEstado(llega.id, a(MARTES, '09:02'));
const liberadas = R.liberarNoLlegaron(a(MARTES, '09:05'));
ok(liberadas.length === 1 && liberadas[0].id === noLlega.id, `libera solo a quien no llegó y ya empezó su hora (${liberadas.map((r) => r.id).join(', ')})`);
const libre = R.buscarReserva(noLlega.id);
ok(libre.estado === 'liberada' && libre.motivoLiberacion === 'no_presentado' && libre.liberadaPorElPersonal === true, 'queda liberada por no presentarse');
ok(libre.penalizadoHasta === new Date(a(MARTES, '09:05').getTime() + 48 * 3600 * 1000).toISOString(), 'con la penalización de la configuración, desde ese momento');
// (a esa hora el sistema también libera sola la reserva del lunes de 2020-beto, que ya pasó: también se avisa)
ok(avisos.filter((p) => p.reserva.id === noLlega.id).length === 1, 'y se avisa igual que cuando el sistema la libera solo');
ok(R.buscarReserva(llega.id).estado === 'en_uso', 'quien llegó sigue adentro');
ok(R.buscarReserva(masTarde.id).estado === 'reservado' && R.buscarReserva(otroDia.id).estado === 'reservado', 'las que no han empezado no se tocan');
ok(R.liberarNoLlegaron(a(MARTES, '09:06')).length === 0, 'una segunda vez ya no hay nadie por liberar');
ok(R.bloqueoDe('2020-carla', a(MARTES, '10:00'))?.tipo === 'falta', 'quien no llegó queda sin poder reservar');

console.log('Interruptor de la solicitud de solvencia');
ok(JSON.stringify(configuracion.solvenciaDisponible()) === JSON.stringify({ web: true, kiosco: true }), 'de entrada está en la web y en los kioscos');
const { cambios } = configuracion.actualizar({ solvenciaDisponible: { kiosco: false } }, sesion);
ok(cambios.some((c) => /solvencia en los kioscos: desactivada/.test(c)), `queda en la bitácora (${cambios.join('; ')})`);
ok(lanza(() => configuracion.actualizar({ solvenciaDisponible: { kiosco: 'no' } }, sesion))?.estado === 400, 'solo acepta sí o no');
ok(lanza(() => configuracion.actualizar({ solvenciaDisponible: { telefono: true } }, sesion))?.estado === 400, 'y solo web o kiosco');
const datos = { solicitante: 'Ana', identificacion: '202300001', cui: '2456789010101', programa: 'Licenciatura', motivo: 'Grado', correo: 'a@b.co', ordenDePago: '1234', fechaPapeleria: dia(1), esEstudiante: true };
const desdeKiosco = await solvencia.crear({ ...datos, kiosco: 'k1' }).catch((e) => e);
ok(desdeKiosco?.estado === 403 && /kiosco/.test(desdeKiosco.message), `desde el kiosco apagado no se puede (${desdeKiosco?.message})`);
const desdeLaWeb = await solvencia.crear({ ...datos }).catch((e) => e);
ok(desdeLaWeb?.estado === 400 && /foto/.test(desdeLaWeb.message), 'desde la web sigue (y pide las fotos)');
configuracion.actualizar({ solvenciaDisponible: { web: false, kiosco: true } }, sesion);
const webApagada = await solvencia.crear({ ...datos }).catch((e) => e);
ok(webApagada?.estado === 403 && /pausada/.test(webApagada.message), 'con la web apagada, la web no recibe solicitudes');

function MIERCOLES() {
  return dia(2);
}

console.log(`${comprobaciones} comprobaciones: ${fallos === 0 ? 'TODO BIEN' : `${fallos} FALLAS`}`);
process.exit(fallos === 0 ? 0 : 1);
