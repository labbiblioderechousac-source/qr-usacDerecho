// Auditoría de la protección de rutas del servidor (puerto 4002): cada ruta del personal se prueba sin sesión y con cada rol.
const BASE = process.env.BASE || 'http://localhost:4002';
let fallos = 0;
let comprobaciones = 0;
const ok = (cond, msg) => {
  comprobaciones += 1;
  if (!cond) {
    fallos += 1;
    console.log('  FALLA:', msg);
  }
};

async function llamar(metodo, ruta, { token, cuerpo } = {}) {
  const r = await fetch(`${BASE}/api${ruta}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  return { estado: r.status, cabeceras: r.headers };
}

const CLAVES = { admin: 'Admin-prueba-1', circulacion: 'Circ-prueba-1', tesis: 'Tesis-prueba-1', consulta: 'Consulta-prueba-1' };
async function entrar(usuario) {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ usuario, clave: CLAVES[usuario] }) });
  return (await r.json()).data.token;
}
const fichas = Object.fromEntries(await Promise.all(Object.keys(CLAVES).map(async (rol) => [rol, await entrar(rol)])));

// [método, ruta, roles que sí entran, cuerpo inofensivo]. Los cuerpos y los códigos están hechos para que, si la ruta se abre, responda
// 400 o 404 sin cambiar nada: lo que se comprueba es la puerta, no la operación.
const TODOS = ['admin', 'circulacion', 'tesis', 'consulta'];
const CIRC = ['admin', 'circulacion'];
const TESIS = ['admin', 'tesis'];
const SOLO_ADMIN = ['admin'];
const RUTAS = [
  ['GET', '/admin/resumen', TODOS],
  ['GET', '/admin/usuarios', CIRC],
  ['GET', '/admin/tesis', TESIS],
  ['GET', '/admin/catalogo', TESIS],
  ['POST', '/admin/catalogo/importar', TESIS, {}],
  ['POST', '/admin/catalogo', TESIS, {}],
  ['PATCH', '/admin/catalogo/NO-EXISTE', TESIS, {}],
  ['DELETE', '/admin/catalogo/NO-EXISTE', SOLO_ADMIN],
  ['PATCH', '/admin/tesis/NO-EXISTE/documento', TESIS, {}],
  ['GET', '/admin/qr', TESIS],
  ['PATCH', '/admin/qr/NO-EXISTE', TESIS, { activo: true }],
  ['POST', '/admin/qr/NO-EXISTE/verificar', TESIS, {}],
  ['GET', '/admin/qr/revision', TESIS],
  ['POST', '/admin/qr/revision', TESIS, {}],
  ['GET', '/admin/estadisticas', ['admin', 'consulta']],
  ['GET', '/admin/estadisticas/excel', ['admin', 'consulta']],
  ['GET', '/admin/personal', SOLO_ADMIN],
  ['POST', '/admin/personal', SOLO_ADMIN, {}],
  ['PATCH', '/admin/personal/nadie', SOLO_ADMIN, {}],
  ['POST', '/admin/personal/nadie/clave', SOLO_ADMIN, {}],
  ['GET', '/admin/configuracion', SOLO_ADMIN],
  ['PATCH', '/admin/configuracion', SOLO_ADMIN, { toleranciaMinutos: 'no es un número' }],
  ['GET', '/admin/actividad', SOLO_ADMIN],
  ['GET', '/admin/almacenamiento', SOLO_ADMIN],
  ['GET', '/admin/respaldo', SOLO_ADMIN],
  ['POST', '/admin/respaldo/enviar', SOLO_ADMIN, {}],
  ['GET', '/admin/correo', SOLO_ADMIN],
  ['POST', '/admin/correo/verificar', SOLO_ADMIN, {}],
  ['POST', '/admin/correo/prueba', SOLO_ADMIN, {}],
  ['GET', '/admin/horarios', SOLO_ADMIN],
  ['PUT', '/admin/horarios', SOLO_ADMIN, {}],
  ['POST', '/admin/horarios/cierres', SOLO_ADMIN, {}],
  ['DELETE', '/admin/horarios/cierres/C-999', SOLO_ADMIN],
  ['GET', '/reservas', CIRC],
  ['GET', '/reservas/resumen', CIRC],
  ['PATCH', '/reservas/item/R-999/avanzar', CIRC],
  ['PATCH', '/reservas/item/R-999/cancelar', CIRC],
  ['PATCH', '/reservas/item/R-999/liberar', CIRC],
  ['GET', '/reservas/penalizaciones', CIRC],
  ['PATCH', '/reservas/item/R-999/quitar-penalizacion', CIRC],
  ['POST', '/reservas/sanciones', CIRC, {}],
  ['GET', '/reservas/sanciones', CIRC],
  ['PATCH', '/reservas/sanciones/S-999/quitar', CIRC],
  ['POST', '/reservas/liberar-no-llegaron', CIRC, {}],
  ['GET', '/solvencia', CIRC],
  ['GET', '/solvencia/resumen', CIRC],
  ['GET', '/solvencia/SOL-999/fotos/comprobante', SOLO_ADMIN],
  ['GET', '/solvencia/SOL-999/constancia', SOLO_ADMIN],
  ['PATCH', '/solvencia/SOL-999/aprobar', SOLO_ADMIN, {}],
  ['PATCH', '/solvencia/SOL-999/rechazar', SOLO_ADMIN, {}],
  ['PUT', '/solvencia/guia', SOLO_ADMIN, {}],
  ['POST', '/solvencia/guia/restaurar', SOLO_ADMIN, {}],
  ['POST', '/admin/correo/gmail/conectar', SOLO_ADMIN, {}],
  ['POST', '/admin/correo/gmail/desconectar', SOLO_ADMIN, {}],
  ['GET', '/auth/me', TODOS],
  ['POST', '/auth/cambiar-clave', TODOS, {}],
];

console.log(`Rutas del personal: ${RUTAS.length} rutas, sin sesión y con cada uno de los 4 roles`);
for (const [metodo, ruta, permitidos, cuerpo] of RUTAS) {
  const etiqueta = `${metodo} ${ruta}`;
  const anonimo = await llamar(metodo, ruta, { cuerpo });
  ok(anonimo.estado === 401, `${etiqueta} sin sesión debe dar 401 y dio ${anonimo.estado}`);
  const invalida = await llamar(metodo, ruta, { token: 'ficha-inventada', cuerpo });
  ok(invalida.estado === 401, `${etiqueta} con una ficha inventada debe dar 401 y dio ${invalida.estado}`);
  for (const rol of TODOS) {
    const r = await llamar(metodo, ruta, { token: fichas[rol], cuerpo });
    if (permitidos.includes(rol)) ok(r.estado !== 401 && r.estado !== 403, `${etiqueta} con ${rol} debe entrar y dio ${r.estado}`);
    else ok(r.estado === 403, `${etiqueta} con ${rol} debe dar 403 y dio ${r.estado}`);
  }
}

console.log('Rutas públicas que no deben pedir sesión ni mostrar datos de personas');
for (const [metodo, ruta] of [
  ['GET', '/tesis'],
  ['GET', '/horarios/semana'],
  ['GET', '/horarios/dias?desde=2026-10-08&hasta=2026-10-09'],
  ['GET', '/horarios/dia?fecha=2026-10-08'],
  ['GET', '/reservas/condiciones'],
  ['GET', '/reservas/cubiculo/disponibilidad?fecha=2026-10-12'],
  ['GET', '/solvencia/reglas'],
  ['GET', '/solvencia/motivos'],
  ['GET', '/solvencia/guia'],
]) {
  const r = await llamar(metodo, ruta);
  ok(r.estado === 200, `${metodo} ${ruta} es pública y debe dar 200; dio ${r.estado}`);
}
// La vuelta desde Google es pública (esa visita no lleva la sesión), pero sin un pedido vigente no hace nada: regresa al panel con error.
const vuelta = await fetch(`${BASE}/api/admin/correo/gmail/volver?state=inventado&code=x`, { redirect: 'manual' });
ok(vuelta.status === 303 && /\/correo\?gmail=error$/.test(vuelta.headers.get('location') ?? ''), `la vuelta de Google sin pedido regresa con error (${vuelta.status} ${vuelta.headers.get('location')})`);
const lista = await (await fetch(`${BASE}/api/reservas/cubiculo/disponibilidad?fecha=2026-10-12`)).text();
ok(!/identificacion|solicitante|correo|codigoConfirmacion/.test(lista), 'la disponibilidad pública no trae datos de las personas');

console.log('Rutas que no existen');
ok((await llamar('GET', '/admin/no-existe', { token: fichas.admin })).estado === 404, 'una ruta de la API que no existe da 404');
ok((await llamar('GET', '/no-existe')).estado === 404, 'otra también');

console.log('Cabeceras de protección');
const verificar = async (ruta, esperado, etiqueta, opciones = {}) => {
  const r = await fetch(`${BASE}${ruta}`, opciones);
  for (const [cabecera, valor] of Object.entries(esperado)) {
    const real = r.headers.get(cabecera);
    ok(valor === null ? real === null : real === valor, `${etiqueta}: ${cabecera} debe ser «${valor}» y es «${real}»`);
  }
  return r;
};
await verificar('/privateAccess/resumen', { 'x-robots-tag': 'noindex, nofollow', 'x-frame-options': 'SAMEORIGIN', 'x-content-type-options': 'nosniff' }, 'el panel');
await verificar('/PrivateAccess/resumen', { 'x-robots-tag': 'noindex, nofollow' }, 'el panel con otras mayúsculas');
await verificar('/privateaccess', { 'x-robots-tag': 'noindex, nofollow' }, 'la raíz del panel en minúsculas');
await verificar('/admin/resumen', { 'x-robots-tag': null }, '/admin ya no es el panel (es una dirección cualquiera del sitio)');
await verificar('/api/auth/me', { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' }, 'la sesión');
await verificar('/api/admin/resumen', { 'cache-control': 'no-store' }, 'la API del personal', { headers: { Authorization: `Bearer ${fichas.admin}` } });
await verificar('/api/reservas', { 'cache-control': 'no-store' }, 'una lista con ficha de acceso', { headers: { Authorization: `Bearer ${fichas.circulacion}` } });
await verificar('/', { 'x-robots-tag': null }, 'el sitio público se puede indexar');
const robots = await (await fetch(`${BASE}/robots.txt`)).text();
ok(/Disallow: \/api/.test(robots) && !/privateAccess|\/admin/i.test(robots), 'robots.txt pide no indexar /api y no nombra el panel (es un archivo público)');

console.log('Cerrar sesión invalida la ficha');
const salida = await llamar('POST', '/auth/logout', { token: fichas.consulta });
ok(salida.estado === 200, 'cerrar sesión responde 200');
ok((await llamar('GET', '/auth/me', { token: fichas.consulta })).estado === 401, 'la ficha cerrada ya no sirve');

console.log(`\n${comprobaciones} comprobaciones: ${fallos === 0 ? 'TODO BIEN' : `${fallos} FALLAS`}`);
process.exit(fallos === 0 ? 0 : 1);
