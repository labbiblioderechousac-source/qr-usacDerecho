// Prueba de punta a punta del backend. FASE=escribir hace cambios y FASE=verificar comprueba (tras reiniciar el servidor)
// que los datos se conservaron. BASE es la dirección del servidor de pruebas.
const BASE = `${process.env.BASE || 'http://localhost:4002'}/api`;
const FASE = process.env.FASE || 'escribir';
const CLAVES = { admin: 'Admin-prueba-1', circulacion: 'Circ-prueba-1', tesis: 'Tesis-prueba-1', consulta: 'Consulta-prueba-1' };

let bien = 0;
let mal = 0;
function verificar(descripcion, condicion, extra = '') {
  if (condicion) {
    bien += 1;
    console.log(`  [OK] ${descripcion}`);
  } else {
    mal += 1;
    console.log(`  [FALLA] ${descripcion} ${extra}`);
  }
}

async function api(metodo, ruta, { token, cuerpo } = {}) {
  const res = await fetch(BASE + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // sin cuerpo JSON
  }
  return { estado: res.status, datos: json?.data, error: json?.error, json };
}

const entrar = async (usuario, clave) => (await api('POST', '/auth/login', { cuerpo: { usuario, clave } })).datos?.token;

// Fechas de prueba (hora local): la primera con ese día de la semana que quede al menos `minimo` días adelante.
const dos = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
function proximo(diaSemana, minimo = 3) {
  const d = new Date();
  d.setDate(d.getDate() + minimo);
  while (d.getDay() !== diaSemana) d.setDate(d.getDate() + 1);
  return iso(d);
}
const sumar = (fecha, dias) => {
  const d = new Date(`${fecha}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return iso(d);
};

// Fotos de prueba: los primeros bytes de un JPEG y relleno (el servidor reconoce el tipo por el contenido, no lo dibuja).
const fotoDePrueba = (relleno) => {
  const b = Buffer.alloc(3000, relleno);
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]).copy(b);
  return `data:image/jpeg;base64,${b.toString('base64')}`;
};
const FOTOS = { comprobante: fotoDePrueba(1), orden_de_pago: fotoDePrueba(2) };

const token = {
  admin: await entrar('admin', CLAVES.admin),
  circulacion: await entrar('circulacion', CLAVES.circulacion),
  tesis: await entrar('tesis', CLAVES.tesis),
  consulta: await entrar('consulta', CLAVES.consulta),
};
console.log(`== Servidor de pruebas (${FASE})`);
verificar('las cuentas iniciales entran con las claves del entorno', Object.values(token).every(Boolean));

const lunes = proximo(1, 8);
const sabado = proximo(6, 8);
const domingo = proximo(0, 8);
const martes = proximo(2, 8);

if (FASE === 'escribir') {
  console.log('== Lo que ya no está (no es de la propuesta)');
  for (const ruta of ['/portada', '/tramites/reglas', '/seguimiento']) {
    verificar(`${ruta} ya no existe (404)`, (await api('GET', ruta)).estado === 404);
  }
  verificar('/admin/avisos y /admin/correos ya no existen (404)', (await api('GET', '/admin/avisos', { token: token.admin })).estado === 404 && (await api('GET', '/admin/correos', { token: token.admin })).estado === 404);

  console.log('== Horarios de reserva');
  const diaLunes = await api('GET', `/horarios/dia?fecha=${lunes}`);
  verificar('horas reservables de un lunes: 08-11 y 14-18 (fuera el cierre del mediodía)', JSON.stringify(diaLunes.datos.franjas) === JSON.stringify(['08:00', '09:00', '10:00', '11:00', '14:00', '15:00', '16:00', '17:00', '18:00']), JSON.stringify(diaLunes.datos.franjas));
  const diaSabado = await api('GET', `/horarios/dia?fecha=${sabado}`);
  verificar('horas reservables de un sábado: de 08:00 a 18:00 sin pausa (la última empieza a las 17:00)', JSON.stringify(diaSabado.datos.franjas) === JSON.stringify(['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00']), JSON.stringify(diaSabado.datos.franjas));
  const diaDomingo = await api('GET', `/horarios/dia?fecha=${domingo}`);
  verificar('horas reservables de un domingo: de 08:00 a 13:00 (la última empieza a las 12:00)', JSON.stringify(diaDomingo.datos.franjas) === JSON.stringify(['08:00', '09:00', '10:00', '11:00', '12:00']), JSON.stringify(diaDomingo.datos.franjas));
  verificar('fecha inválida -> 400', (await api('GET', '/horarios/dia?fecha=2026-02-31')).estado === 400);

  console.log('== Horarios y cierres (administrador)');
  verificar('circulación no puede ver los horarios del panel (403)', (await api('GET', '/admin/horarios', { token: token.circulacion })).estado === 403);
  const actuales = (await api('GET', '/admin/horarios', { token: token.admin })).datos;
  verificar('el administrador ve los horarios de reserva y los cierres (sin horario de atención)', actuales.reservas.sabado && Array.isArray(actuales.cierres) && actuales.atencion === undefined);
  const mala1 = await api('PUT', '/admin/horarios', { token: token.admin, cuerpo: { reservas: { ...actuales.reservas, lunes: [['25:00', '12:00']] } } });
  verificar('hora mal escrita -> 400', mala1.estado === 400, mala1.error);
  const mala2 = await api('PUT', '/admin/horarios', { token: token.admin, cuerpo: { reservas: { ...actuales.reservas, lunes: [['08:00', '12:00'], ['11:00', '14:00']] } } });
  verificar('tramos que se cruzan -> 400', mala2.estado === 400, mala2.error);
  const mala3 = await api('PUT', '/admin/horarios', { token: token.admin, cuerpo: { reservas: { ...actuales.reservas, lunes: [['14:00', '13:00']] } } });
  verificar('cierre antes de la apertura -> 400', mala3.estado === 400, mala3.error);
  verificar('si algo es inválido no cambia nada', JSON.stringify((await api('GET', '/horarios/dia?fecha=' + lunes)).datos.franjas) === JSON.stringify(diaLunes.datos.franjas));
  const cambio = await api('PUT', '/admin/horarios', { token: token.admin, cuerpo: { reservas: { ...actuales.reservas, domingo: [['08:00', '10:30']] } } });
  verificar('cambiar el horario de reservas del domingo -> 200', cambio.estado === 200);
  verificar('el cambio rige: domingo solo 08:00 y 09:00', JSON.stringify((await api('GET', `/horarios/dia?fecha=${domingo}`)).datos.franjas) === JSON.stringify(['08:00', '09:00']));
  await api('PUT', '/admin/horarios', { token: token.admin, cuerpo: { reservas: actuales.reservas } });
  verificar('se restauró el horario original', JSON.stringify((await api('GET', `/horarios/dia?fecha=${domingo}`)).datos.franjas) === JSON.stringify(diaDomingo.datos.franjas));

  const cierre = await api('POST', '/admin/horarios/cierres', { token: token.admin, cuerpo: { desde: martes, hasta: martes, motivo: 'Asueto de prueba' } });
  verificar('agregar un cierre -> 201', cierre.estado === 201 && cierre.datos.id.startsWith('C-'));
  verificar('cierre sin motivo -> 400', (await api('POST', '/admin/horarios/cierres', { token: token.admin, cuerpo: { desde: martes, hasta: martes, motivo: '' } })).estado === 400);
  verificar('cierre con fechas al revés -> 400', (await api('POST', '/admin/horarios/cierres', { token: token.admin, cuerpo: { desde: sumar(martes, 3), hasta: martes, motivo: 'Mal' } })).estado === 400);
  const diaCerrado = (await api('GET', `/horarios/dia?fecha=${martes}`)).datos;
  verificar('un día de cierre no tiene horas reservables y explica el motivo', diaCerrado.cerrado === true && diaCerrado.franjas.length === 0 && diaCerrado.motivo === 'Asueto de prueba');
  const reservaEnCierre = await api('POST', '/reservas/estacion', { cuerpo: { recursoId: 'est-1', fecha: martes, hora: '09:00', solicitante: 'Ana', identificacion: '2019001' } });
  verificar('reservar un día de cierre -> 409 con el motivo', reservaEnCierre.estado === 409 && /Asueto de prueba/.test(reservaEnCierre.error || ''), JSON.stringify(reservaEnCierre.json));
  const disponibilidadCerrado = await api('GET', `/reservas/estacion/disponibilidad?fecha=${martes}`);
  verificar('la disponibilidad de un día cerrado viene sin horas', disponibilidadCerrado.datos.every((r) => r.franjas.length === 0));

  console.log('== Reservas ajustadas al horario');
  const reservar = (tipo, datos) => api('POST', `/reservas/${tipo}`, { cuerpo: { solicitante: 'Ana Prueba', identificacion: '2019001', ...datos } });
  verificar('reservar a las 12:00 (cierre del mediodía) -> 400', (await reservar('estacion', { recursoId: 'est-2', fecha: lunes, hora: '12:00' })).estado === 400);
  verificar('reservar a las 13:00 (aún cerrado) -> 400', (await reservar('estacion', { recursoId: 'est-2', fecha: lunes, hora: '13:00' })).estado === 400);
  verificar('reservar a las 19:00 (ya no cabe la hora) -> 400', (await reservar('estacion', { recursoId: 'est-2', fecha: lunes, hora: '19:00' })).estado === 400);
  const conCorreo = await reservar('estacion', { recursoId: 'est-2', fecha: lunes, hora: '14:00', correo: 'ana@usac.edu.gt' });
  verificar('reservar a las 14:00 (con correo) -> 200', conCorreo.estado === 200, JSON.stringify(conCorreo.json));
  verificar('reservar el domingo a las 13:00 (ya cerró) -> 400', (await reservar('estacion', { recursoId: 'est-2', fecha: domingo, hora: '13:00' })).estado === 400);
  verificar('reservar el sábado a las 12:00 (ya no hay pausa) -> 200', (await reservar('estacion', { recursoId: 'est-3', fecha: sabado, hora: '12:00' })).estado === 200);
  verificar('reservar el sábado a las 18:00 (ya cerró) -> 400', (await reservar('estacion', { recursoId: 'est-3', fecha: sabado, hora: '18:00' })).estado === 400);
  const fases = { recursoId: 'cub-1', modalidad: 'fases', duracion: 4 };
  const cruce = await reservar('cubiculo', { ...fases, fecha: lunes, hora: '11:00' });
  verificar('cubículo de 4 horas que cruzaría el cierre del mediodía -> 400', cruce.estado === 400, cruce.error);
  const manana = await reservar('cubiculo', { ...fases, fecha: lunes, hora: '08:00' });
  verificar('cubículo de 4 horas en la mañana (08 a 12) -> 200', manana.estado === 200 && manana.datos.horaFin === '12:00', JSON.stringify(manana.json));
  // Otra persona: con el tope de horas al día entre todos los lugares, la misma Ana ya llegaría a 9 horas ese lunes.
  const tarde = await reservar('cubiculo', { ...fases, recursoId: 'cub-2', fecha: lunes, hora: '15:00', identificacion: '2019002' });
  verificar('cubículo de 4 horas en la tarde (15 a 19) -> 200', tarde.estado === 200 && tarde.datos.horaFin === '19:00', JSON.stringify(tarde.json));
  const disp = await api('GET', `/reservas/cubiculo/disponibilidad?fecha=${lunes}`);
  const cub1 = disp.datos.find((r) => r.id === 'cub-1');
  verificar('la disponibilidad marca ocupadas las 4 horas reservadas', ['08:00', '09:00', '10:00', '11:00'].every((h) => cub1.franjas.find((f) => f.hora === h).disponible === false) && cub1.franjas.find((f) => f.hora === '14:00').disponible === true);

  console.log('== Fechas de las reservas');
  verificar('reservar en una fecha que ya pasó -> 400', (await reservar('estacion', { recursoId: 'est-4', fecha: sumar(iso(new Date()), -1), hora: '09:00' })).estado === 400);
  verificar('reservar a más de 30 días -> 400', (await reservar('estacion', { recursoId: 'est-4', fecha: sumar(iso(new Date()), 45), hora: '09:00' })).estado === 400);
  verificar('fecha mal escrita -> 400', (await reservar('estacion', { recursoId: 'est-4', fecha: '2026-02-31', hora: '09:00' })).estado === 400);

  console.log('== Solvencia con el proceso real');
  const reglas = (await api('GET', '/solvencia/reglas')).datos;
  verificar('las reglas traen motivos, días de anticipación y la entrega si se envía ahora', reglas.motivos.length === 4 && reglas.diasMaximosDeAnticipacion === 7 && /^\d{4}-\d{2}-\d{2}$/.test(reglas.entregaSiEnviasAhora.fecha));
  const hoy = iso(new Date());
  const lunesSolv = proximo(1, 1);
  const solicitud = (cambios = {}) => ({ solicitante: 'Luis Ramírez', identificacion: '201955321', cui: '2456 78901 0101', programa: 'Licenciatura en Ciencias Jurídicas y Sociales', motivo: 'Grado', correo: 'luis@usac.edu.gt', ordenDePago: '88123456', fechaPapeleria: lunesSolv, esEstudiante: true, fotos: FOTOS, ...cambios });
  const fechaFueraDeRango = sumar(hoy, 9);
  const casos = [
    ['sin CUI válido', { cui: '123' }],
    ['sin correo', { correo: '' }],
    ['con correo inválido', { correo: 'no-es-correo' }],
    ['sin orden de pago', { ordenDePago: '' }],
    ['sin confirmar que es estudiante', { esEstudiante: false }],
    ['con fecha de hoy (sin anticipación)', { fechaPapeleria: hoy }],
    ['con fecha a más de 7 días', { fechaPapeleria: fechaFueraDeRango }],
    ['con fecha en fin de semana', { fechaPapeleria: proximo(6, 1) <= sumar(hoy, 7) ? proximo(6, 1) : proximo(0, 1) }],
    ['con motivo inventado', { motivo: 'Cualquiera' }],
    ['con carné muy corto', { identificacion: '12' }],
    ['sin fotos (desde la web)', { fotos: undefined }],
    ['con una sola foto', { fotos: { comprobante: FOTOS.comprobante } }],
  ];
  for (const [nombre, cambios] of casos) {
    const r = await api('POST', '/solvencia', { cuerpo: solicitud(cambios) });
    verificar(`solicitud ${nombre} -> 400`, r.estado === 400, `${r.estado} ${r.error ?? ''}`);
  }
  const buena = await api('POST', '/solvencia', { cuerpo: solicitud() });
  verificar('solicitud correcta -> 200 con número, código y entrega estimada', buena.estado === 200 && buena.datos.id === 'SOL-001' && buena.datos.codigoConfirmacion.length === 6 && buena.datos.entregaEstimada.hora, JSON.stringify(buena.json));
  verificar('el CUI se guarda sin espacios y el carné en mayúsculas', buena.datos.cui === '2456789010101' && buena.datos.identificacion === '201955321');
  const dosVeces = await api('POST', '/solvencia', { cuerpo: solicitud({ identificacion: '201955322', fechaPapeleria: sumar(lunesSolv, 1) <= sumar(hoy, 7) ? lunesSolv : lunesSolv }) });
  verificar('una segunda solicitud también se acepta (SOL-002)', dosVeces.estado === 200 && dosVeces.datos.id === 'SOL-002');
  const enLaPc = { comprobante: 'solvencias/comprobante/Luis_Ramirez.jpg', orden_de_pago: 'solvencias/orden_de_pago/Luis_Ramirez.jpg' };
  verificar('circulación no puede rechazar (solo la administración) -> 403', (await api('PATCH', '/solvencia/SOL-002/rechazar', { token: token.circulacion, cuerpo: { observacion: 'Motivo cualquiera', guardadas: enLaPc } })).estado === 403);
  verificar('rechazar con un motivo demasiado corto -> 400', (await api('PATCH', '/solvencia/SOL-002/rechazar', { token: token.admin, cuerpo: { observacion: 'ab', guardadas: enLaPc } })).estado === 400);
  verificar('rechazar sin motivo -> 400 (el motivo es obligatorio)', (await api('PATCH', '/solvencia/SOL-002/rechazar', { token: token.admin, cuerpo: { guardadas: enLaPc } })).estado === 400);
  verificar('rechazar sin haber guardado las fotos en la PC -> 400', (await api('PATCH', '/solvencia/SOL-002/rechazar', { token: token.admin, cuerpo: { observacion: 'El número no coincide.' } })).estado === 400);
  const rechazada = await api('PATCH', '/solvencia/SOL-002/rechazar', { token: token.admin, cuerpo: { observacion: 'El número de orden de pago no coincide con la boleta.', guardadas: enLaPc } });
  verificar('rechazar con motivo -> 200 y queda escrito, con quién lo revisó', rechazada.estado === 200 && rechazada.datos.estado === 'rechazada' && /boleta/.test(rechazada.datos.observacion) && rechazada.datos.revisadaPor?.usuario === 'admin');
  const tercera = await api('POST', '/solvencia', { cuerpo: solicitud({ identificacion: '201955323', fotos: undefined, kiosco: 'k1' }) });
  verificar('desde un kiosco se puede enviar sin fotos', tercera.estado === 200 && !tercera.datos.fotos, JSON.stringify(tercera.json));
  const sinFotos = await api('PATCH', `/solvencia/${tercera.datos.id}/rechazar`, { token: token.admin, cuerpo: { observacion: 'Faltó presentar la boleta en el mostrador.' } });
  verificar('una solicitud sin fotos se resuelve sin guardar nada en la PC', sinFotos.estado === 200 && sinFotos.datos.estado === 'rechazada');
  const aprobada = await api('PATCH', '/solvencia/SOL-001/aprobar', { token: token.admin, cuerpo: { guardadas: enLaPc } });
  verificar('aprobar -> aprobada y anota dónde quedaron las fotos', aprobada.datos?.estado === 'aprobada' && aprobada.datos.fotos.comprobante.guardadaEn === enLaPc.comprobante, JSON.stringify(aprobada.json));
  verificar('aprobarla otra vez -> 409', (await api('PATCH', '/solvencia/SOL-001/aprobar', { token: token.admin, cuerpo: { guardadas: enLaPc } })).estado === 409);

  console.log('== Comprobantes por correo');
  const compSol = await api('POST', '/comprobantes/enviar', { cuerpo: { tipo: 'solvencia', id: 'SOL-001', codigo: buena.datos.codigoConfirmacion, correo: 'otra@usac.edu.gt' } });
  verificar('el comprobante de una solvencia se puede enviar (simulado sin SMTP)', compSol.estado === 200 && compSol.datos.simulado === true, JSON.stringify(compSol.json));
  verificar('con un código que no es -> 404', (await api('POST', '/comprobantes/enviar', { cuerpo: { tipo: 'solvencia', id: 'SOL-001', codigo: 'XXXXXX', correo: 'otra@usac.edu.gt' } })).estado === 404);
  verificar('de un tipo que ya no existe (tesis_digital) -> 404', (await api('POST', '/comprobantes/enviar', { cuerpo: { tipo: 'tesis_digital', id: 'TD-001', codigo: 'ABCDEF', correo: 'otra@usac.edu.gt' } })).estado === 404);
  verificar('con un correo mal escrito -> 400', (await api('POST', '/comprobantes/enviar', { cuerpo: { tipo: 'solvencia', id: 'SOL-001', codigo: buena.datos.codigoConfirmacion, correo: 'no-es-correo' } })).estado === 400);

  console.log('== Estadísticas');
  const est = (await api('GET', '/admin/estadisticas', { token: token.consulta })).datos;
  verificar('consulta ve las estadísticas y solo las de la propuesta', est.totales.reservasEspacios >= 1 && est.totales.solicitudesSolvencia >= 3 && est.totales.solicitudesTesisDigital === undefined && Array.isArray(est.porHora));
  verificar('circulación no ve las estadísticas (403)', (await api('GET', '/admin/estadisticas', { token: token.circulacion })).estado === 403);

  console.log('== Catálogo');
  const lista = await api('GET', '/tesis?porPagina=3&pagina=2');
  verificar('la búsqueda pública viene paginada', lista.datos.items.length === 3 && lista.datos.total === 7 && lista.datos.pagina === 2 && lista.datos.paginas === 3, JSON.stringify({ n: lista.datos.items.length, total: lista.datos.total, pagina: lista.datos.pagina }));
  verificar('más recientes primero', (await api('GET', '/tesis')).datos.items[0].anio === '2024');
  verificar('una página fuera de rango se acomoda a la última', (await api('GET', '/tesis?pagina=99&porPagina=3')).datos.pagina === 3);
  const nuevaTesis = { id: 'T14119', titulo: 'Adición en el artículo 92 de la ley de protección integral de la niñez', autor: 'Mijangos Vásquez, Carlos Enrique', anio: '2015', tipoDocumento: 'tesis_grado', temas: 'Niñez; Derecho laboral', paginas: 120 };
  verificar('solo tesis y administrador gestionan el catálogo (circulación 403)', (await api('POST', '/admin/catalogo', { token: token.circulacion, cuerpo: nuevaTesis })).estado === 403);
  const creada = await api('POST', '/admin/catalogo', { token: token.tesis, cuerpo: nuevaTesis });
  verificar('agregar una tesis -> 201 con temas separados y valores por defecto', creada.estado === 201 && creada.datos.temas.length === 2 && creada.datos.modalidadAcceso === 'Anaquel cerrado' && creada.datos.documentoDigital.acceso === 'sin_acceso', JSON.stringify(creada.json));
  verificar('código repetido -> 409', (await api('POST', '/admin/catalogo', { token: token.tesis, cuerpo: nuevaTesis })).estado === 409);
  verificar('código inválido -> 400', (await api('POST', '/admin/catalogo', { token: token.tesis, cuerpo: { ...nuevaTesis, id: 'a b/c' } })).estado === 400);
  verificar('año inválido -> 400', (await api('POST', '/admin/catalogo', { token: token.tesis, cuerpo: { ...nuevaTesis, id: 'X1', anio: '15' } })).estado === 400);
  const editada = await api('PATCH', '/admin/catalogo/T14119', { token: token.tesis, cuerpo: { titulo: 'Título corregido de la tesis de prueba', tipoDocumento: 'tesis_posgrado' } });
  verificar('cambiar datos de una tesis -> 200 (el tipo cambia la modalidad)', editada.estado === 200 && editada.datos.modalidad === 'Tesis de posgrado' && editada.datos.autor === nuevaTesis.autor, JSON.stringify(editada.json));
  verificar('la tesis nueva se encuentra en la búsqueda pública', (await api('GET', '/tesis?titulo=corregido')).datos.total === 1);
  verificar('borrar una tesis solo lo hace el administrador (tesis 403)', (await api('DELETE', '/admin/catalogo/T14119', { token: token.tesis })).estado === 403);
  const imp = await api('POST', '/admin/catalogo/importar', { token: token.tesis, cuerpo: { filas: [
    { id: 'T20001', titulo: 'Primera tesis importada de prueba', autor: 'Autora Uno', anio: '2018', tipoDocumento: 'tesis_grado', temas: 'Penal; Procesal' },
    { id: 'T20002', titulo: 'Segunda tesis importada de prueba', autor: 'Autor Dos', anio: '2019' },
    { id: 'T14119', titulo: 'Esta ya existía y se omite', autor: 'Alguien', anio: '2015' },
    { id: 'MAL ID', titulo: 'Fila con código malo', autor: 'Alguien', anio: '2015' },
    { id: 'T20003', titulo: 'Sin autor', autor: '', anio: '2015' },
  ], existentes: 'omitir' } });
  verificar('importar: 2 nuevas, 1 omitida y 2 con errores explicados', imp.estado === 200 && imp.datos.creadas === 2 && imp.datos.omitidas === 1 && imp.datos.totalErrores === 2 && imp.datos.errores[0].fila === 4, JSON.stringify(imp.json));
  const imp2 = await api('POST', '/admin/catalogo/importar', { token: token.tesis, cuerpo: { filas: [{ id: 'T14119', titulo: 'Título actualizado por la importación', autor: 'Mijangos Vásquez, Carlos Enrique', anio: '2015' }], existentes: 'actualizar' } });
  verificar('importar actualizando una existente', imp2.datos.actualizadas === 1 && (await api('GET', '/tesis/T14119')).datos.titulo === 'Título actualizado por la importación');
  verificar('reemplazar todo el catálogo solo lo hace el administrador (tesis 403)', (await api('POST', '/admin/catalogo/importar', { token: token.tesis, cuerpo: { filas: [{ id: 'Z1', titulo: 'Solo una', autor: 'Nadie', anio: '2020' }], reemplazar: true } })).estado === 403);
  verificar('importar sin filas -> 400', (await api('POST', '/admin/catalogo/importar', { token: token.tesis, cuerpo: { filas: [] } })).estado === 400);
  const admList = await api('GET', '/admin/catalogo?q=importada&porPagina=1', { token: token.tesis });
  verificar('el panel busca y pagina el catálogo', admList.datos.total === 2 && admList.datos.items.length === 1 && admList.datos.paginas === 2);
  verificar('el panel filtra por documento digital', (await api('GET', '/admin/catalogo?documento=con&porPagina=50', { token: token.tesis })).datos.items.every((t) => t.documentoDigital.disponible));

  console.log('== Cuenta y configuración que deben sobrevivir al reinicio');
  verificar('crear una cuenta', (await api('POST', '/admin/personal', { token: token.admin, cuerpo: { usuario: 'persistente', nombre: 'Cuenta que se guarda', rol: 'consulta', clave: 'ClaveLarga-123' } })).estado === 201);
  verificar('guardar la configuración', (await api('PATCH', '/admin/configuracion', { token: token.admin, cuerpo: { toleranciaMinutos: 30, reservasPausadas: { sala_lectura: true } } })).estado === 200);
  await api('PATCH', '/admin/personal/circulacion', { token: token.admin, cuerpo: { nombre: 'Circulación (nombre cambiado)' } });
  await new Promise((r) => setTimeout(r, 1500));
} else {
  console.log('== Después de reiniciar el servidor, los datos siguen ahí');
  const cuentas = (await api('GET', '/admin/personal', { token: token.admin })).datos;
  verificar('la cuenta creada sigue y entra con su clave', cuentas.some((c) => c.usuario === 'persistente') && Boolean(await entrar('persistente', 'ClaveLarga-123')));
  verificar('el cambio de nombre de una cuenta inicial se conservó', cuentas.find((c) => c.usuario === 'circulacion').nombre === 'Circulación (nombre cambiado)');
  const conf = (await api('GET', '/admin/configuracion', { token: token.admin })).datos;
  verificar('la configuración se conservó', conf.toleranciaMinutos === 30 && conf.reservasPausadas.sala_lectura === true);
  verificar('las 4 reservas siguen', (await api('GET', '/reservas', { token: token.circulacion })).datos.length === 4);
  const nueva = await api('POST', '/reservas/estacion', { cuerpo: { recursoId: 'est-9', fecha: lunes, hora: '16:00', solicitante: 'Después', identificacion: '2019009' } });
  verificar('una reserva nueva continúa la numeración (R-005)', nueva.estado === 200 && nueva.datos.id === 'R-005', JSON.stringify(nueva.json));
  verificar('las solicitudes de solvencia siguen', (await api('GET', '/solvencia', { token: token.circulacion })).datos.length === 3);
  verificar('los cierres siguen', (await api('GET', `/horarios/dia?fecha=${martes}`)).datos.cerrado === true);
  const cat = await api('GET', '/tesis?porPagina=100');
  verificar('el catálogo con las tesis agregadas e importadas sigue', cat.datos.total === 10 && cat.datos.items.some((t) => t.id === 'T20001'));
  verificar('el documento digital y el QR de una tesis de ejemplo siguen como estaban', (await api('GET', '/tesis/T-2023-00098')).datos.documentoDigital.acceso === 'consulta');
  const act = (await api('GET', '/admin/actividad?limite=500', { token: token.admin })).datos.registros;
  verificar('la bitácora de actividad sigue', act.length > 15 && act.some((r) => r.accion === 'catalogo.importado') && act.some((r) => r.accion === 'horarios.cierre_agregado') && act.some((r) => r.accion === 'solicitud.rechazada'));
}

console.log(`\nResultado (${FASE}): ${bien} bien, ${mal} con fallas`);
process.exit(mal === 0 ? 0 : 1);
