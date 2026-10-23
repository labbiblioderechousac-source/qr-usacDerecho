// Estadísticas de uso de los servicios (propuesta, sección 4.5.7). Se calculan al pedirlas, a partir de las
// reservas, las solicitudes y el registro de eventos; no se guarda nada aparte.
//
// El administrador elige el período: un día, una semana, un mes, un año, todo o un rango de fechas (`desde` y `hasta`, ambos
// incluidos). Las reservas cuentan por el día en que se usa el lugar; las solicitudes y los eventos (búsquedas, consultas, accesos
// por QR, comprobantes, sesiones de kiosco), por el día en que ocurrieron, en hora de la biblioteca.
const { listar: listarEventos } = require('../eventos/eventos_data');
const { listarReservas, franjasDeReserva } = require('../reservas/reservas_data');
const { listar: listarSolicitudes } = require('../solvencia/solvencia_data');
const { TESIS } = require('../catalog/catalog_data');
const { todasLasFranjas } = require('../horarios/horarios_data');
const { rechazo } = require('../../utils/errores');
const { esFechaISO, fechaLocal } = require('../../utils/fechas');

const DIAS_DE_LA_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const ORDEN_DE_LOS_DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

function contar(eventos, tipo) {
  return eventos.filter((e) => e.tipo === tipo).length;
}

// Valida el período pedido. Sin fechas es todo lo registrado; con una sola, ese lado queda abierto.
function periodo({ desde, hasta } = {}) {
  const limpio = (valor, nombre) => {
    if (valor === undefined || valor === null || valor === '') return null;
    if (!esFechaISO(String(valor))) throw rechazo(`La fecha «${nombre}» no es válida: escríbela así, 2026-10-19`);
    return String(valor);
  };
  const inicio = limpio(desde, 'desde');
  const fin = limpio(hasta, 'hasta');
  if (inicio && fin && fin < inicio) throw rechazo('La fecha final no puede ser anterior a la inicial');
  return { desde: inicio, hasta: fin };
}

// Cómo terminaron las reservas del período: el personal ve cuántas se usaron y cuántas personas no llegaron.
function resultadoDeLasReservas(reservas) {
  const cuantas = (condicion) => reservas.filter(condicion).length;
  return {
    total: reservas.length,
    atendidas: cuantas((r) => r.estado === 'finalizado' || r.estado === 'en_uso'),
    pendientes: cuantas((r) => r.estado === 'reservado'),
    noSePresentaron: cuantas((r) => r.estado === 'liberada' && r.motivoLiberacion === 'no_presentado'),
    liberadasPorElPersonal: cuantas((r) => r.estado === 'liberada' && r.motivoLiberacion !== 'no_presentado'),
    canceladas: cuantas((r) => r.estado === 'cancelado'),
    penalizaciones: cuantas((r) => Boolean(r.penalizadoHasta)),
    horasReservadas: reservas.filter((r) => r.estado !== 'cancelado').reduce((total, r) => total + (Number(r.duracion) || 0), 0),
  };
}

function calcular(filtro) {
  const { desde, hasta } = periodo(filtro);
  const dentro = (fecha) => (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
  const ocurrioDentro = (x) => dentro(fechaLocal(new Date(x.creadoEn)));

  const eventos = listarEventos().filter(ocurrioDentro);
  const reservas = listarReservas().filter((r) => dentro(r.fecha));
  const solicitudes = listarSolicitudes().filter(ocurrioDentro);
  const reservasVigentes = reservas.filter((r) => r.estado !== 'cancelado');

  // Demanda por hora: cada reserva suma una vez en cada hora que ocupa.
  const porHora = todasLasFranjas().map((hora) => ({
    hora,
    total: reservasVigentes.filter((r) => franjasDeReserva(r).includes(hora)).length,
  }));

  const porDia = ORDEN_DE_LOS_DIAS.map((dia) => ({
    dia,
    total: reservasVigentes.filter((r) => DIAS_DE_LA_SEMANA[new Date(`${r.fecha}T12:00:00`).getDay()] === dia).length,
  }));

  const tesisMasConsultadas = TESIS.map((t) => ({
    id: t.id,
    titulo: t.titulo,
    consultas: eventos.filter((e) => e.tesisId === t.id && (e.tipo === 'consulta_digital' || e.tipo === 'descarga_digital')).length,
    accesosQr: eventos.filter((e) => e.tesisId === t.id && e.tipo === 'acceso_qr').length,
  }))
    .filter((t) => t.consultas + t.accesosQr > 0)
    .sort((a, b) => b.consultas + b.accesosQr - (a.consultas + a.accesosQr))
    .slice(0, 5);

  const kioscos = [...new Set(eventos.filter((e) => e.tipo === 'sesion_kiosco' && e.kiosco).map((e) => e.kiosco))]
    .sort()
    .map((kiosco) => ({
      kiosco,
      sesiones: eventos.filter((e) => e.tipo === 'sesion_kiosco' && e.kiosco === kiosco).length,
      operaciones: [...reservas, ...solicitudes].filter((x) => x.kiosco === kiosco).length,
    }));

  return {
    generadoEn: new Date().toISOString(),
    periodo: { desde, hasta },
    totales: {
      busquedasOpac: contar(eventos, 'busqueda_opac'),
      consultasDigitales: contar(eventos, 'consulta_digital'),
      descargasDigitales: contar(eventos, 'descarga_digital'),
      accesosQr: contar(eventos, 'acceso_qr'),
      reservasCubiculos: reservas.filter((r) => r.tipo === 'cubiculo').length,
      reservasEspacios: reservas.filter((r) => r.tipo !== 'cubiculo').length,
      solicitudesSolvencia: solicitudes.length,
      sesionesKiosco: contar(eventos, 'sesion_kiosco'),
    },
    reservas: resultadoDeLasReservas(reservas),
    comprobantes: {
      generados: reservas.length + solicitudes.length,
      impresos: contar(eventos, 'comprobante_impreso'),
      porCorreo: contar(eventos, 'comprobante_correo'),
    },
    porHora,
    porDia,
    tesisMasConsultadas,
    kioscos,
  };
}

// --- Excel: las mismas estadísticas, día por día y lugar por lugar -----------------------------------------------------
// Un libro con estas hojas, del período elegido: Resumen; Por día (una fila por día con todo lo que pasó); Cubículos, Estaciones y Sala
// de lectura (cuántas veces se usó cada lugar cada día); Tesis (consultas, descargas y escaneos de QR de cada tesis); Horas (demanda por
// hora y por día de la semana). Un «uso» de un lugar es una reserva que no se canceló ni se liberó (la persona llegó, o todavía la espera).
// No lleva nombres ni carnés: son estadísticas.

const { RECURSOS } = require('../reservas/recursos_data');

const MAXIMO_DE_DIAS = 3700; // unos diez años: más que eso no cabe bien en una hoja

const dosCifras = (n) => String(n).padStart(2, '0');
const fechaLegible = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const siguienteDia = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${dosCifras(d.getMonth() + 1)}-${dosCifras(d.getDate())}`;
};
const diaDeLaSemana = (iso) => DIAS_DE_LA_SEMANA[new Date(`${iso}T12:00:00`).getDay()];
const esFinDeSemana = (iso) => [0, 6].includes(new Date(`${iso}T12:00:00`).getDay());
const seUso = (r) => !['cancelado', 'liberada'].includes(r.estado);

// "Mesa 1 · Silla 3" -> "Mesa 1": la sala de lectura se cuenta por mesa.
const mesaDe = (recurso) => String(recurso.nombre).split('·')[0].trim();

function nombreDelPeriodo(desde, hasta) {
  if (desde && hasta) return desde === hasta ? `del ${fechaLegible(desde)}` : `del ${fechaLegible(desde)} al ${fechaLegible(hasta)}`;
  if (desde) return `desde el ${fechaLegible(desde)}`;
  if (hasta) return `hasta el ${fechaLegible(hasta)}`;
  return 'de todo lo registrado';
}

function hojasDelExcel(filtro) {
  const estadisticas = calcular(filtro);
  const { desde, hasta } = estadisticas.periodo;
  const dentro = (fecha) => (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
  const diaDe = (x) => fechaLocal(new Date(x.creadoEn));

  const eventos = listarEventos().filter((e) => dentro(diaDe(e)));
  const reservas = listarReservas().filter((r) => dentro(r.fecha));
  const solicitudes = listarSolicitudes().filter((s) => dentro(diaDe(s)));
  const aprobadas = listarSolicitudes().filter((s) => s.estado === 'aprobada' && s.atendidaEn && dentro(fechaLocal(new Date(s.atendidaEn))));

  // Los días de la hoja: los del período; sin fechas, del primer al último día con algo registrado.
  const conDatos = [...reservas.map((r) => r.fecha), ...eventos.map(diaDe), ...solicitudes.map(diaDe)].sort();
  const hoy = fechaLocal();
  const primero = desde ?? conDatos[0] ?? hoy;
  const ultimo = hasta ?? (conDatos.length > 0 && conDatos[conDatos.length - 1] > hoy ? conDatos[conDatos.length - 1] : hoy);
  const dias = [];
  for (let dia = primero; dia <= ultimo && dias.length < MAXIMO_DE_DIAS; dia = siguienteDia(dia)) dias.push(dia);

  // Conteos por día, de una pasada.
  const porDia = new Map(dias.map((d) => [d, {}]));
  const sumar = (dia, clave, cantidad = 1) => {
    const fila = porDia.get(dia);
    if (fila) fila[clave] = (fila[clave] ?? 0) + cantidad;
  };
  eventos.forEach((e) => sumar(diaDe(e), e.tipo));
  reservas.forEach((r) => {
    if (seUso(r)) {
      sumar(r.fecha, `uso_${r.tipo}`);
      sumar(r.fecha, `lugar_${r.tipo === 'sala_lectura' ? mesaDe({ nombre: r.recursoNombre }) : r.recursoId}`);
      sumar(r.fecha, 'horas', Number(r.duracion) || 0);
    }
    if (r.estado === 'liberada' && r.motivoLiberacion === 'no_presentado') sumar(r.fecha, 'no_llegaron');
  });
  solicitudes.forEach((s) => sumar(diaDe(s), 'solicitudes'));
  aprobadas.forEach((s) => sumar(fechaLocal(new Date(s.atendidaEn)), 'aprobadas'));

  const fila = (dia, valores) => ({ valores: [fechaLegible(dia), diaDeLaSemana(dia), ...valores], sombreada: esFinDeSemana(dia) });
  const columnasDeFecha = [
    { titulo: 'Fecha', ancho: 12 },
    { titulo: 'Día', ancho: 11 },
  ];
  const nota = 'Biblioteca «Francisco Rolando Velázquez González» · Fines de semana sombreados.';
  const titulo = (texto) => `${texto} ${nombreDelPeriodo(desde, hasta)}`;

  const tipoDeDia = [
    ['busqueda_opac', 'Búsquedas en el catálogo'],
    ['consulta_digital', 'Consultas de tesis'],
    ['descarga_digital', 'Descargas de tesis'],
    ['acceso_qr', 'Escaneos de QR'],
    ['uso_cubiculo', 'Cubículos (usos)'],
    ['uso_estacion', 'Estaciones (usos)'],
    ['uso_sala_lectura', 'Sala de lectura (sillas)'],
    ['horas', 'Horas reservadas'],
    ['no_llegaron', 'No llegaron'],
    ['solicitudes', 'Solicitudes de solvencia'],
    ['aprobadas', 'Solvencias aprobadas'],
    ['sesion_kiosco', 'Sesiones de kiosco'],
    ['comprobante_impreso', 'Comprobantes impresos'],
  ];

  const hojaPorLugar = (nombre, columnas) => ({
    nombre,
    titulo: titulo(`${nombre}: usos por día`),
    nota: 'Cuántas veces se usó cada lugar cada día (reservas que no se cancelaron ni se liberaron).',
    columnas: [...columnasDeFecha, ...columnas.map(({ titulo: t }) => ({ titulo: t, ancho: 11 })), { titulo: 'Total del día', ancho: 12 }],
    filas: dias.map((dia) => {
      const valores = columnas.map(({ clave }) => porDia.get(dia)[`lugar_${clave}`] ?? 0);
      return fila(dia, [...valores, valores.reduce((a, b) => a + b, 0)]);
    }),
    totales: true,
  });

  const mesas = [...new Set(RECURSOS.sala_lectura.map(mesaDe))];
  const tesis = TESIS.map((t) => {
    const deEsta = eventos.filter((e) => e.tesisId === t.id);
    const consultas = deEsta.filter((e) => e.tipo === 'consulta_digital').length;
    const descargas = deEsta.filter((e) => e.tipo === 'descarga_digital').length;
    const qr = deEsta.filter((e) => e.tipo === 'acceso_qr').length;
    return { valores: [t.id, t.titulo, t.autor ?? '', t.anio ? Number(t.anio) || t.anio : '', consultas, descargas, qr, consultas + descargas + qr] };
  })
    .filter((t) => t.valores[7] > 0)
    .sort((a, b) => b.valores[7] - a.valores[7]);

  const { totales, reservas: resultado, comprobantes } = estadisticas;
  return [
    {
      nombre: 'Resumen',
      titulo: titulo('Estadísticas de la biblioteca'),
      nota: `Generado el ${fechaLegible(fechaLocal())}. Las reservas cuentan por el día en que se usa el lugar; lo demás, por el día en que ocurrió.`,
      columnas: [
        { titulo: 'Dato', ancho: 42 },
        { titulo: 'Cantidad', ancho: 12 },
      ],
      filas: [
        ['Búsquedas en el catálogo (OPAC)', totales.busquedasOpac],
        ['Consultas de tesis digitales', totales.consultasDigitales],
        ['Descargas de tesis digitales', totales.descargasDigitales],
        ['Escaneos de códigos QR', totales.accesosQr],
        ['Reservas de cubículos', totales.reservasCubiculos],
        ['Reservas de estaciones y sala de lectura', totales.reservasEspacios],
        ['Reservas usadas (la persona llegó)', resultado.atendidas],
        ['Reservas a las que no llegaron', resultado.noSePresentaron],
        ['Reservas canceladas', resultado.canceladas],
        ['Horas reservadas', resultado.horasReservadas],
        ['Solicitudes de solvencia', totales.solicitudesSolvencia],
        ['Sesiones de kiosco', totales.sesionesKiosco],
        ['Comprobantes impresos', comprobantes.impresos],
        ['Comprobantes enviados por correo', comprobantes.porCorreo],
      ].map((valores) => ({ valores })),
    },
    {
      nombre: 'Por día',
      titulo: titulo('Uso de la biblioteca día por día'),
      nota,
      columnas: [...columnasDeFecha, ...tipoDeDia.map(([, t]) => ({ titulo: t, ancho: 13 }))],
      filas: dias.map((dia) => fila(dia, tipoDeDia.map(([clave]) => porDia.get(dia)[clave] ?? 0))),
      totales: true,
    },
    hojaPorLugar(
      'Cubículos',
      RECURSOS.cubiculo.map((r) => ({ clave: r.id, titulo: r.nombre }))
    ),
    hojaPorLugar(
      'Estaciones',
      RECURSOS.estacion.map((r) => ({ clave: r.id, titulo: r.nombre }))
    ),
    hojaPorLugar(
      'Sala de lectura',
      mesas.map((mesa) => ({ clave: mesa, titulo: mesa }))
    ),
    {
      nombre: 'Tesis',
      titulo: titulo('Tesis consultadas'),
      nota: tesis.length === 0 ? 'Ninguna tesis se consultó, descargó ni escaneó en este período.' : 'De la más consultada a la menos consultada.',
      columnas: [
        { titulo: 'Código', ancho: 14 },
        { titulo: 'Título', ancho: 60 },
        { titulo: 'Autor', ancho: 30 },
        { titulo: 'Año', ancho: 8 },
        { titulo: 'Consultas', ancho: 11 },
        { titulo: 'Descargas', ancho: 11 },
        { titulo: 'Escaneos de QR', ancho: 11 },
        { titulo: 'Total', ancho: 9 },
      ],
      filas: tesis,
      totales: true,
    },
    {
      nombre: 'Horas',
      titulo: titulo('Demanda de las reservas por hora y por día de la semana'),
      nota: 'Cada reserva suma una vez en cada hora que ocupa.',
      columnas: [
        { titulo: 'Hora o día', ancho: 16 },
        { titulo: 'Reservas', ancho: 12 },
      ],
      filas: [...estadisticas.porHora.map((h) => ({ valores: [h.hora, h.total] })), ...estadisticas.porDia.map((d) => ({ valores: [d.dia, d.total], sombreada: true }))],
    },
  ];
}

// Nombre del archivo: Estadisticas_2026-09-01_a_2026-09-30.xlsx
function nombreDelExcel(filtro) {
  const { desde, hasta } = periodo(filtro);
  return `Estadisticas_${desde ?? 'inicio'}_a_${hasta ?? fechaLocal()}.xlsx`;
}

module.exports = { calcular, hojasDelExcel, nombreDelExcel };
