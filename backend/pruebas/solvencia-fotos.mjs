// Solicitudes de solvencia con las fotos del pago (comprobante y orden de pago): validación de las fotos, quién las puede ver, el aviso de
// un comprobante repetido, la revisión (aprobar con la constancia en PDF adjunta, rechazar con el motivo), que al resolver salgan del
// sistema y la sesión de la administración sin cierre por inactividad. El correo va a una API falsa (con la forma de la de Resend).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { arrancarServidor, carpetaTemporal, cliente, comprobador, pausa, puertoLibre } from './servidor.mjs';

const { ok, terminar } = comprobador();

async function apiFalsa() {
  const recibidos = [];
  const servidor = http.createServer((req, res) => {
    let texto = '';
    req.on('data', (d) => (texto += d));
    req.on('end', () => {
      recibidos.push(JSON.parse(texto));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'x' }));
    });
  });
  const puerto = await puertoLibre();
  await new Promise((r) => servidor.listen(puerto, '127.0.0.1', r));
  return { recibidos, url: `http://127.0.0.1:${puerto}/emails`, parar: () => new Promise((r) => { servidor.closeAllConnections(); servidor.close(r); }) };
}

// «Fotos» de prueba: la firma de cada formato y relleno (el servidor reconoce el tipo por el contenido, no la dibuja).
const FIRMAS = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]),
  gif: Buffer.from('GIF89a'),
};
function foto(formato = 'jpeg', relleno = 1, bytes = 3000) {
  const b = Buffer.alloc(bytes, relleno);
  FIRMAS[formato].copy(b);
  return `data:image/${formato};base64,${b.toString('base64')}`;
}

function proximoDiaHabil() {
  const d = new Date();
  d.setDate(d.getDate() + 2);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
let carne = 202300000;
const solicitud = (cambios = {}) => ({
  solicitante: 'María José Núñez',
  identificacion: String((carne += 1)),
  cui: '2456789010101',
  programa: 'Licenciatura en Ciencias Jurídicas y Sociales',
  motivo: 'Grado',
  correo: 'maria@ejemplo.com',
  ordenDePago: '88123456',
  fechaPapeleria: proximoDiaHabil(),
  esEstudiante: true,
  fotos: { comprobante: foto('jpeg', 1), orden_de_pago: foto('webp', 2) },
  ...cambios,
});
const enLaPc = { comprobante: 'solvencias/comprobante/Maria_Jose_Nunez.jpg', orden_de_pago: 'solvencias/orden_de_pago/Maria_Jose_Nunez.webp' };

async function pedirBinario(base, ruta, token) {
  const r = await fetch(`${base}/api${ruta}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { estado: r.status, tipo: r.headers.get('content-type'), cache: r.headers.get('cache-control'), contenido: Buffer.from(await r.arrayBuffer()) };
}

const datos = carpetaTemporal('solvencia-fotos');
const carpetaDeFotos = path.join(datos, 'fotos-solvencia');
const correo = await apiFalsa();
const ENV = { CORREO_API: 'resend', CORREO_API_KEY: 're_prueba', CORREO_REMITENTE: 'biblioteca@prueba.test', CORREO_API_URL: correo.url, CORREO_ESPERA_CONFIRMACION_MS: '3000' };
try {
  let servidor = await arrancarServidor({ datos, env: ENV });
  let { api, entrar } = cliente(servidor.base);
  let admin = await entrar('admin');
  const circ = await entrar('circulacion');
  try {
    console.log('Las reglas dicen cómo deben ser las fotos');
    const reglas = (await api('GET', '/solvencia/reglas')).datos;
    ok(reglas.fotos?.tipos?.comprobante && reglas.fotos?.maximoBytes === 1024 * 1024, 'traen los tipos de foto y el peso máximo');

    console.log('Fotos que no se aceptan');
    const casos = [
      ['sin fotos desde la web', { fotos: undefined }, /Falta la foto del comprobante/],
      ['con una sola foto', { fotos: { comprobante: foto() } }, /Falta la foto de la orden de pago/],
      ['un GIF', { fotos: { comprobante: foto('gif'), orden_de_pago: foto() } }, /solo se aceptan fotos JPG, PNG o WebP/],
      ['un archivo que no es imagen', { fotos: { comprobante: `data:image/jpeg;base64,${Buffer.alloc(3000, 65).toString('base64')}`, orden_de_pago: foto() } }, /solo se aceptan/],
      ['una imagen casi vacía', { fotos: { comprobante: foto('jpeg', 1, 200), orden_de_pago: foto() } }, /demasiado pequeña/],
      ['una foto de más de 1 MB', { fotos: { comprobante: foto('jpeg', 1, 1024 * 1024 + 10), orden_de_pago: foto() } }, /más de 1 MB/],
      ['texto que no es base64', { fotos: { comprobante: 'data:image/jpeg;base64,esto no es base64!!', orden_de_pago: foto() } }, /no es una imagen válida/],
      ['desde un kiosco con una sola foto', { kiosco: 'k1', fotos: { comprobante: foto() } }, /Falta la foto de la orden de pago/],
    ];
    for (const [nombre, cambios, patron] of casos) {
      const r = await api('POST', '/solvencia', { cuerpo: solicitud(cambios) });
      ok(r.estado === 400 && patron.test(r.error ?? ''), `${nombre} -> 400 «${r.error}»`);
    }
    ok(!fs.existsSync(carpetaDeFotos) || fs.readdirSync(carpetaDeFotos).length === 0, 'las solicitudes rechazadas no dejan fotos guardadas');
    ok((await api('GET', '/solvencia', { token: admin })).datos.length === 0, 'ni solicitudes registradas');

    console.log('Una solicitud con sus dos fotos');
    const primera = await api('POST', '/solvencia', { cuerpo: solicitud() });
    const hoy = primera.datos?.creadoEn ? new Date(primera.datos.creadoEn).toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' }) : '';
    ok(primera.estado === 200 && primera.datos.id === 'SOL-001', `se registra (${primera.estado} ${primera.error ?? ''})`);
    ok(primera.datos.fotos?.comprobante?.archivo === `Maria_Jose_Nunez_${primera.datos.identificacion}_${hoy}.jpg`, `el archivo se nombra con nombre, carné y fecha, sin tildes ni ñ (${primera.datos.fotos?.comprobante?.archivo})`);
    ok(primera.datos.fotos?.orden_de_pago?.archivo.endsWith('.webp') && primera.datos.fotos.orden_de_pago.mime === 'image/webp', 'la extensión sale del contenido de la foto (WebP)');
    ok(/^[0-9a-f]{64}$/.test(primera.datos.fotos?.comprobante?.hash ?? ''), 'guarda el hash de cada foto');
    ok(primera.datos.fotos?.comprobante?.enRevision === true, 'y que la foto espera revisión');
    ok(fs.readdirSync(carpetaDeFotos).sort().join() === 'SOL-001-comprobante,SOL-001-orden_de_pago', 'las fotos se guardan mientras está pendiente');
    const confirmacion = correo.recibidos.at(-1);
    ok(/Solicitud de solvencia SOL-001 recibida/.test(confirmacion?.subject ?? '') && /Comprobante de pago y orden de pago/.test(confirmacion?.text ?? ''), 'el correo de recibida menciona las fotos');
    ok(!confirmacion?.attachments, 'y no adjunta nada');

    const segunda = await api('POST', '/solvencia', { cuerpo: solicitud({ solicitante: 'Otra Persona', fotos: { comprobante: foto('jpeg', 1), orden_de_pago: foto('png', 3) } }) });
    const tercera = await api('POST', '/solvencia', { cuerpo: solicitud({ solicitante: 'Desde El Kiosco', kiosco: 'k2', fotos: undefined }) });
    ok(segunda.estado === 200 && tercera.estado === 200 && !tercera.datos.fotos, 'desde un kiosco se puede enviar sin fotos');
    const grande = await api('POST', '/solvencia', { cuerpo: solicitud({ solicitante: 'Fotos Grandes', fotos: { comprobante: foto('jpeg', 4, 900 * 1024), orden_de_pago: foto('png', 5, 900 * 1024) } }) });
    ok(grande.estado === 200, `dos fotos de 900 KB caben en una solicitud (${grande.estado} ${grande.error ?? ''})`);

    console.log('Lo que ve el panel');
    const lista = (await api('GET', '/solvencia', { token: admin })).datos;
    ok(JSON.stringify(lista.find((s) => s.id === 'SOL-002')?.fotosRepetidas) === JSON.stringify({ comprobante: ['SOL-001'] }), 'avisa que el comprobante de SOL-002 ya se usó en SOL-001');
    ok(!lista.find((s) => s.id === 'SOL-003')?.fotosRepetidas, 'una solicitud sin fotos no tiene avisos');
    const resumen = (await api('GET', '/solvencia/resumen', { token: admin })).datos;
    ok(resumen.pendientes === 4 && resumen.recientes[0].id === 'SOL-004' && resumen.recientes[0].solicitante === 'Fotos Grandes', 'el resumen trae las últimas que llegaron, para el aviso con voz');

    console.log('Quién ve las fotos');
    const vista = await pedirBinario(servidor.base, '/solvencia/SOL-001/fotos/comprobante', admin);
    ok(vista.estado === 200 && vista.tipo === 'image/jpeg' && vista.contenido.length === 3000 && vista.contenido[0] === 0xff, 'la administración ve la foto tal como se subió');
    ok(/no-store/.test(vista.cache ?? ''), 'sin guardarse en la caché del navegador');
    ok((await pedirBinario(servidor.base, '/solvencia/SOL-001/fotos/comprobante', circ)).estado === 403, 'circulación no ve las fotos (403)');
    ok((await pedirBinario(servidor.base, '/solvencia/SOL-001/fotos/comprobante')).estado === 401, 'sin sesión tampoco (401)');
    ok((await pedirBinario(servidor.base, '/solvencia/SOL-001/fotos/otra', admin)).estado === 404, 'un tipo de foto que no existe -> 404');
    ok((await pedirBinario(servidor.base, '/solvencia/SOL-003/fotos/comprobante', admin)).estado === 404, 'una solicitud sin fotos -> 404');
    ok((await api('PATCH', '/solvencia/SOL-001/aprobar', { token: circ, cuerpo: { guardadas: enLaPc } })).estado === 403, 'circulación no aprueba (403)');

    console.log('Las fotos pendientes sobreviven a un reinicio');
    await pausa(500);
    await servidor.parar();
    servidor = await arrancarServidor({ datos, env: ENV });
    ({ api, entrar } = cliente(servidor.base));
    admin = await entrar('admin');
    ok((await pedirBinario(servidor.base, '/solvencia/SOL-002/fotos/orden_de_pago', admin)).tipo === 'image/png', 'siguen ahí después de reiniciar');

    console.log('Aprobar');
    ok((await api('PATCH', '/solvencia/SOL-001/aprobar', { token: admin, cuerpo: {} })).estado === 400, 'sin haberlas guardado en la PC no se aprueba (400)');
    ok((await api('PATCH', '/solvencia/SOL-001/aprobar', { token: admin, cuerpo: { guardadas: { comprobante: '../../etc/x.jpg', orden_de_pago: 'a.jpg' } } })).estado === 400, 'una ruta con «..» no vale (400)');
    ok((await api('PATCH', '/solvencia/SOL-001/aprobar', { token: admin, cuerpo: { guardadas: { comprobante: 'a.jpg' } } })).estado === 400, 'faltando una de las dos tampoco (400)');
    ok((await api('PATCH', '/solvencia/SOL-001/fotos/comprobante', { token: admin })).estado === 404, 'la foto sigue (aún no se resolvió)');
    const antes = correo.recibidos.length;
    const aprobada = await api('PATCH', '/solvencia/SOL-001/aprobar', { token: admin, cuerpo: { guardadas: enLaPc } });
    ok(aprobada.estado === 200 && aprobada.datos.estado === 'aprobada', `se aprueba (${aprobada.estado} ${aprobada.error ?? ''})`);
    ok(aprobada.datos.revisadaPor?.usuario === 'admin' && aprobada.datos.atendidaEn, 'queda quién la revisó y cuándo');
    ok(aprobada.datos.fotos.comprobante.guardadaEn === enLaPc.comprobante && aprobada.datos.fotos.comprobante.enRevision === false, 'y dónde quedó cada foto en la PC');
    ok(aprobada.datos.fotos.comprobante.hash === primera.datos.fotos.comprobante.hash, 'el hash se conserva (para detectar comprobantes repetidos después)');
    ok(aprobada.datos.correoDeResolucion === 'enviado', `el correo de aprobada sale (${aprobada.datos.correoDeResolucion})`);
    ok(!fs.readdirSync(carpetaDeFotos).some((n) => n.startsWith('SOL-001-')), 'las fotos salen del sistema');
    ok((await pedirBinario(servidor.base, '/solvencia/SOL-001/fotos/comprobante', admin)).estado === 404, 'y ya no se pueden pedir');
    const aprobadaCorreo = correo.recibidos.slice(antes).find((c) => /aprobada/.test(c.subject));
    ok(aprobadaCorreo?.subject === 'Solvencia de biblioteca aprobada – María José Núñez', `asunto formal (${aprobadaCorreo?.subject})`);
    ok(/Estimado\(a\) María José Núñez:/.test(aprobadaCorreo?.text ?? '') && /ha sido aprobada/.test(aprobadaCorreo?.text ?? ''), 'con el texto acordado');
    const adjunto = aprobadaCorreo?.attachments?.[0];
    ok(adjunto?.filename === 'Constancia_solvencia_SOL-001_Maria_Jose_Nunez.pdf', `adjunta la constancia (${adjunto?.filename})`);
    const pdf = Buffer.from(adjunto?.content ?? '', 'base64');
    ok(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.length > 5000, `y es un PDF (${pdf.length} bytes)`);
    ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length === 1, 'de una sola hoja');
    ok((await api('PATCH', '/solvencia/SOL-001/aprobar', { token: admin, cuerpo: { guardadas: enLaPc } })).estado === 409, 'aprobarla otra vez -> 409');
    const constancia = await pedirBinario(servidor.base, '/solvencia/SOL-001/constancia', admin);
    ok(constancia.estado === 200 && constancia.tipo === 'application/pdf' && constancia.contenido.subarray(0, 5).toString() === '%PDF-', 'la constancia se puede volver a descargar desde el panel');

    console.log('Rechazar');
    ok((await api('PATCH', '/solvencia/SOL-002/rechazar', { token: admin, cuerpo: { guardadas: enLaPc } })).estado === 400, 'sin motivo no se rechaza (400)');
    const rechazada = await api('PATCH', '/solvencia/SOL-002/rechazar', { token: admin, cuerpo: { observacion: '  El comprobante de pago ya fue presentado   en otra solicitud.  ', guardadas: enLaPc } });
    ok(rechazada.estado === 200 && rechazada.datos.estado === 'rechazada' && rechazada.datos.observacion === 'El comprobante de pago ya fue presentado en otra solicitud.', 'se rechaza con el motivo (limpio de espacios)');
    const rechazoCorreo = correo.recibidos.at(-1);
    ok(rechazoCorreo?.subject === 'Solicitud de solvencia de biblioteca – Requiere corrección', `asunto del rechazo (${rechazoCorreo?.subject})`);
    ok(/ya fue presentado en otra solicitud/.test(rechazoCorreo?.text ?? '') && /enviar nuevamente su solicitud/.test(rechazoCorreo?.text ?? ''), 'con el motivo y la invitación a enviarla de nuevo');
    ok(/WhatsApp/.test(rechazoCorreo?.text ?? ''), 'y cómo comunicarse con la biblioteca');
    ok(!rechazoCorreo?.attachments, 'sin constancia');
    ok((await pedirBinario(servidor.base, '/solvencia/SOL-002/constancia', admin)).estado === 409, 'una rechazada no tiene constancia (409)');
    ok((await api('PATCH', '/solvencia/SOL-003/aprobar', { token: admin, cuerpo: {} })).estado === 200, 'una solicitud del kiosco (sin fotos) se aprueba sin guardar nada en la PC');

    const actividad = (await api('GET', '/admin/actividad?limite=50', { token: admin })).datos.registros.map((r) => r.accion);
    ok(actividad.includes('solicitud.aprobada') && actividad.includes('solicitud.rechazada'), 'aprobar y rechazar quedan en la actividad del personal');

    console.log('Fotos de solicitudes ya resueltas que quedaron guardadas');
    fs.writeFileSync(path.join(carpetaDeFotos, 'SOL-001-comprobante'), 'quedó por un apagón');
    await pausa(500);
    await servidor.parar();
    servidor = await arrancarServidor({ datos, env: ENV });
    ({ api, entrar } = cliente(servidor.base));
    admin = await entrar('admin');
    await pausa(300);
    ok(!fs.existsSync(path.join(carpetaDeFotos, 'SOL-001-comprobante')), 'se borran solas al arrancar');
    ok(fs.existsSync(path.join(carpetaDeFotos, 'SOL-004-comprobante')), 'las de una pendiente se quedan');
  } finally {
    await servidor.parar();
  }

  console.log('Sesión de la administración sin cierre por inactividad');
  servidor = await arrancarServidor({ datos: carpetaTemporal('solvencia-sesion') });
  try {
    const { api: llamar } = cliente(servidor.base);
    const login = async (usuario, clave) => (await llamar('POST', '/auth/login', { cuerpo: { usuario, clave } })).datos;
    const sesionAdmin = await login('admin', 'Admin-prueba-1');
    const sesionCirc = await login('circulacion', 'Circ-prueba-1');
    ok(sesionAdmin.minutosDeInactividad === 0, 'la administración no tiene cierre por inactividad (de entrada)');
    ok(sesionCirc.minutosDeInactividad === 20, 'circulación sigue con 20 minutos');
    ok((await llamar('PATCH', '/admin/configuracion', { token: sesionAdmin.token, cuerpo: { minutosDeInactividad: { circulacion: 7 } } })).estado === 400, 'un valor que no está en la lista -> 400');
    ok((await llamar('PATCH', '/admin/configuracion', { token: sesionAdmin.token, cuerpo: { minutosDeInactividad: { jefe: 0 } } })).estado === 400, 'un rol que no existe -> 400');
    const cambio = await llamar('PATCH', '/admin/configuracion', { token: sesionAdmin.token, cuerpo: { minutosDeInactividad: { circulacion: 60, administrador: 0 } } });
    ok(cambio.estado === 200 && cambio.datos.minutosDeInactividad.circulacion === 60, 'la administración cambia el tiempo de circulación');
    ok((await llamar('GET', '/auth/me', { token: sesionCirc.token })).datos.minutosDeInactividad === 60, 'y circulación lo recibe al volver a abrir el panel');
    ok((await llamar('PATCH', '/admin/configuracion', { token: sesionCirc.token, cuerpo: { minutosDeInactividad: { circulacion: 0 } } })).estado === 403, 'circulación no puede cambiarlo (403)');
    const registro = (await llamar('GET', '/admin/actividad?limite=10', { token: sesionAdmin.token })).datos.registros.find((r) => r.accion === 'configuracion.cambiada');
    ok(/cierre de sesión por inactividad \(circulación\): 20 min → 60 min/.test(registro?.detalle ?? ''), `queda en la actividad (${registro?.detalle})`);
  } finally {
    await servidor.parar();
  }
} finally {
  await correo.parar();
  fs.rmSync(datos, { recursive: true, force: true });
}
terminar();
