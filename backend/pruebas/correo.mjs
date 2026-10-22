// Pruebas del correo con servidores FALSOS en esta computadora (nada sale a internet): un SMTP y una API que imitan a los reales.
// Cada escenario arranca su propio servidor de la biblioteca, con datos temporales y sin ninguna variable de correo heredada.
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');

const BACKEND = fileURLToPath(new URL('..', import.meta.url));
const CUENTAS = { admin: 'Admin-prueba-1', circulacion: 'Circ-prueba-1', tesis: 'Tesis-prueba-1', consulta: 'Consulta-prueba-1' };
const CLAVE_NUEVA = 'Clave-Larga-Segura-7';

let fallos = 0;
let comprobaciones = 0;
const ok = (cond, msg) => {
  comprobaciones += 1;
  if (!cond) {
    fallos += 1;
    console.log('  FALLA:', msg);
  }
};
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Servidor de la biblioteca ---------------------------------------------------------------------------------------

const SIN_CORREO = { SMTP_HOST: '', SMTP_PORT: '', SMTP_USER: '', SMTP_PASS: '', SMTP_FROM: '', SMTP_SECURE: '', CORREO_API: '', CORREO_API_KEY: '', CORREO_REMITENTE: '', CORREO_API_URL: '', CORREO_TIEMPO_MS: '', GMAIL_CLIENT_ID: '', GMAIL_CLIENT_SECRET: '', GMAIL_REFRESH_TOKEN: '', GMAIL_TOKEN_URL: '', NODE_ENV: '' };

async function iniciar(puerto, env = {}) {
  const salida = [];
  const hijo = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      ...SIN_CORREO,
      PORT: String(puerto),
      DATA_DIR: path.join(os.tmpdir(), `correo-${puerto}-${Date.now()}`),
      CLAVE_ADMIN: CUENTAS.admin,
      CLAVE_CIRCULACION: CUENTAS.circulacion,
      CLAVE_TESIS: CUENTAS.tesis,
      CLAVE_CONSULTA: CUENTAS.consulta,
      LIMITE_ESCRITURAS: '1000',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  hijo.stdout.on('data', (d) => salida.push(String(d)));
  hijo.stderr.on('data', (d) => salida.push(String(d)));
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`http://localhost:${puerto}/health`)).ok) break;
    } catch {
      /* todavía no arranca */
    }
    await pausa(200);
  }
  const base = `http://localhost:${puerto}/api`;
  const llamar = async (metodo, ruta, { token, cuerpo } = {}) => {
    const r = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    return { estado: r.status, datos: json.data, error: json.error, mensaje: json.message };
  };
  const entrar = async (usuario, clave = CUENTAS[usuario]) => (await llamar('POST', '/auth/login', { cuerpo: { usuario, clave } })).datos?.token;
  // Cada prueba de correo tiene su espera de 5 s por cuenta: para varias seguidas se crean otros administradores.
  let n = 0;
  const otroAdmin = async (admin) => {
    n += 1;
    const usuario = `extra${n}`;
    await llamar('POST', '/admin/personal', { token: admin, cuerpo: { usuario, nombre: `Admin ${n}`, rol: 'administrador', clave: CLAVE_NUEVA } });
    return entrar(usuario, CLAVE_NUEVA);
  };
  return { hijo, salida, llamar, entrar, otroAdmin, parar: () => hijo.kill() };
}

function proximoDia(diaDeLaSemana, desdeHoy = 3) {
  const d = new Date();
  d.setDate(d.getDate() + desdeHoy);
  while (d.getDay() !== diaDeLaSemana) d.setDate(d.getDate() + 1);
  const dos = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
const LUNES = proximoDia(1);
let carne = 0;
const reservar = (srv, extra = {}) =>
  srv.llamar('POST', '/reservas/cubiculo', {
    cuerpo: { recursoId: 'cub-1', fecha: LUNES, hora: '08:00', horaFin: '09:00', solicitante: 'Ana Pérez', identificacion: `carne-${(carne += 1)}`, ...extra },
  });

// --- Servidores falsos -----------------------------------------------------------------------------------------------

function iniciarSmtp(puerto, { auth } = {}) {
  const recibidos = [];
  const servidor = new SMTPServer({
    disabledCommands: ['STARTTLS'],
    authOptional: !auth,
    allowInsecureAuth: true,
    onAuth(credenciales, sesion, cb) {
      if (!auth || (credenciales.username === auth.usuario && credenciales.password === auth.clave)) return cb(null, { user: credenciales.username });
      return cb(new Error('Invalid login'));
    },
    onData(stream, sesion, cb) {
      simpleParser(stream)
        .then((correo) => {
          recibidos.push({ correo, sobre: sesion.envelope, usuario: sesion.user });
          cb();
        })
        .catch(cb);
    },
  });
  return new Promise((resolve) => servidor.listen(puerto, '127.0.0.1', () => resolve({ servidor, recibidos, parar: () => new Promise((r) => servidor.close(r)) })));
}

async function esperarCorreos(recibidos, cuantos, ms = 3000) {
  for (let i = 0; i < ms / 100 && recibidos.length < cuantos; i += 1) await pausa(100);
  return recibidos.length >= cuantos;
}

function iniciarApi(puerto) {
  const peticiones = [];
  const comportamiento = { estado: 200, cuerpo: { id: 'abc' }, colgar: false };
  const servidor = http.createServer((req, res) => {
    let texto = '';
    req.on('data', (d) => (texto += d));
    req.on('end', () => {
      let cuerpo = null;
      try {
        cuerpo = texto ? JSON.parse(texto) : null;
      } catch {
        /* no era JSON */
      }
      peticiones.push({ metodo: req.method, url: req.url, cabeceras: req.headers, cuerpo });
      if (comportamiento.colgar) return; // nunca responde
      res.writeHead(comportamiento.estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(comportamiento.cuerpo));
    });
  });
  return new Promise((resolve) => servidor.listen(puerto, '127.0.0.1', () => resolve({ servidor, peticiones, comportamiento, parar: () => servidor.closeAllConnections?.() ?? servidor.close() })));
}

// --- Escenarios ------------------------------------------------------------------------------------------------------

async function simulado() {
  console.log('Modo simulado (sin nada configurado)');
  const srv = await iniciar(4021);
  try {
    const admin = await srv.entrar('admin');
    let r = await srv.llamar('GET', '/admin/correo', { token: admin });
    ok(r.estado === 200 && r.datos.modo === 'simulado', 'el estado dice «simulado»');
    ok(r.datos.avisos.length === 0, 'fuera de producción, el modo simulado no es un aviso');
    ok(Array.isArray(r.datos.recientes) && r.datos.recientes.length === 0, 'no hay correos recientes al empezar');
    ok(!JSON.stringify(r.datos).match(/clave|password|pass/i), 'el estado no menciona claves');

    console.log('  Quién puede ver y probar el correo');
    for (const [metodo, ruta, cuerpo] of [['GET', '/admin/correo'], ['POST', '/admin/correo/verificar', {}], ['POST', '/admin/correo/prueba', { para: 'a@b.co' }]]) {
      ok((await srv.llamar(metodo, ruta, { cuerpo })).estado === 401, `${metodo} ${ruta} sin sesión da 401`);
      for (const rol of ['circulacion', 'tesis', 'consulta']) {
        const otro = await srv.entrar(rol);
        ok((await srv.llamar(metodo, ruta, { token: otro, cuerpo })).estado === 403, `${metodo} ${ruta} con ${rol} da 403`);
      }
    }

    console.log('  Correo de prueba');
    r = await srv.llamar('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'no-es-un-correo' } });
    ok(r.estado === 400, 'una dirección inválida se rechaza (400)');
    r = await srv.llamar('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 200 && r.datos.simulado === true && r.datos.via === 'simulado', 'la prueba queda simulada');
    r = await srv.llamar('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 429, 'otra prueba enseguida se frena (429)');
    r = await srv.llamar('POST', '/admin/correo/verificar', { token: admin, cuerpo: {} });
    ok(r.estado === 200 && r.datos.ok === false && /simulado/.test(r.datos.mensaje), 'verificar explica que no hay conexión que comprobar');

    console.log('  Reservas y comprobantes');
    const reserva = await reservar(srv, { correo: 'ana@ejemplo.com' });
    ok(reserva.estado === 200, 'se crea una reserva con correo');
    await pausa(300);
    r = await srv.llamar('GET', '/admin/correo', { token: admin });
    const tipos = r.datos.recientes.map((c) => `${c.tipo}:${c.estado}`);
    ok(tipos.includes('reserva:simulado') && tipos.includes('prueba:simulado'), `la bandeja registra reserva y prueba (${tipos.join(', ')})`);
    ok(r.datos.recientes.every((c) => !('cuerpo' in c)), 'la lista del panel no trae el contenido de los correos');
    r = await srv.llamar('POST', '/comprobantes/enviar', { cuerpo: { tipo: 'reserva', id: reserva.datos.id, codigo: reserva.datos.codigoConfirmacion, correo: 'otra@ejemplo.com' } });
    ok(r.estado === 200 && r.datos.simulado === true, 'el comprobante a pedido responde «simulado» (la pantalla lo explica)');
    r = await srv.llamar('POST', '/comprobantes/enviar', { cuerpo: { tipo: 'reserva', id: reserva.datos.id, codigo: 'ZZZZZZ', correo: 'otra@ejemplo.com' } });
    ok(r.estado === 404, 'con un código equivocado no se manda nada (404)');
    r = await srv.llamar('GET', '/admin/actividad', { token: admin });
    ok(r.datos.registros.some((x) => x.accion === 'correo.prueba'), 'la prueba queda en la actividad del personal');
  } finally {
    srv.parar();
  }

  console.log('  En producción sin correo configurado');
  const prod = await iniciar(4022, { NODE_ENV: 'production' });
  try {
    const admin = await prod.entrar('admin');
    const r = await prod.llamar('GET', '/admin/correo', { token: admin });
    ok(r.datos.avisos.some((a) => /simulado/i.test(a) && /NO salen/.test(a)), 'avisa que los comprobantes por correo no salen');
    ok(prod.salida.join('').includes('[correo]'), 'y también lo dice en la consola al arrancar');
  } finally {
    prod.parar();
  }
}

async function porSmtp() {
  console.log('Modo SMTP (servidor SMTP falso)');
  const smtp = await iniciarSmtp(2525);
  const srv = await iniciar(4023, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2525', CORREO_REMITENTE: '"Biblioteca de Prueba" <biblioteca@prueba.test>' });
  try {
    const admin = await srv.entrar('admin');
    let r = await srv.llamar('GET', '/admin/correo', { token: admin });
    ok(r.datos.modo === 'smtp' && r.datos.servidor === '127.0.0.1:2525', 'el estado dice SMTP y el servidor');
    ok(r.datos.remitente === 'Biblioteca de Prueba <biblioteca@prueba.test>', 'muestra el remitente');
    r = await srv.llamar('POST', '/admin/correo/verificar', { token: admin, cuerpo: {} });
    ok(r.datos.ok === true, 'verificar comprueba la conexión sin mandar correo');
    ok(smtp.recibidos.length === 0, 'y no mandó ningún mensaje');

    r = await srv.llamar('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 200 && r.datos.simulado === false && r.datos.via === 'smtp', 'la prueba sale por SMTP');
    ok(await esperarCorreos(smtp.recibidos, 1), 'el servidor SMTP recibió el correo');
    const prueba = smtp.recibidos[0]?.correo;
    ok(prueba?.from.value[0].address === 'biblioteca@prueba.test' && prueba?.from.value[0].name === 'Biblioteca de Prueba', 'remitente con nombre y dirección');
    ok(prueba?.to.value[0].address === 'persona@ejemplo.com', 'destinatario correcto');
    ok(prueba?.subject === 'Correo de prueba de la biblioteca', 'asunto correcto');
    ok(/Correo de prueba/.test(prueba?.text ?? ''), 'trae la parte de texto');
    ok(/<h1/.test(prueba?.html ?? '') && /lang="es"/.test(prueba?.html ?? ''), 'trae la parte HTML');

    console.log('  Confirmación de reserva (texto y HTML)');
    const reserva = await reservar(srv, { correo: 'ana@ejemplo.com', solicitante: '<script>alert(1)</script> & "Ana"' });
    ok(reserva.estado === 200, 'la reserva se crea');
    ok(await esperarCorreos(smtp.recibidos, 2), 'llega la confirmación');
    const conf = smtp.recibidos[1]?.correo;
    ok(conf?.subject === `Confirmación de reserva ${reserva.datos.id}`, 'asunto con el número de reserva');
    ok(/Lugar: Cubículo 1/.test(conf?.text ?? ''), 'el texto dice el lugar (Cubículo 1)');
    ok((conf?.text ?? '').includes(reserva.datos.codigoConfirmacion), 'el texto trae el código de confirmación');
    ok((conf?.html ?? '').includes(reserva.datos.codigoConfirmacion) && /Cubículo 1/.test(conf?.html ?? ''), 'el HTML trae el código y el lugar');
    ok(!/<script>/i.test(conf?.html ?? '') && /&lt;script&gt;/.test(conf?.html ?? ''), 'el nombre se escapa en el HTML (no se cuela código)');
    ok(/de 08:00 a 09:00/.test(conf?.text ?? ''), 'trae la hora de uso');

    console.log('  Comprobante a pedido');
    r = await srv.llamar('POST', '/comprobantes/enviar', { cuerpo: { tipo: 'reserva', id: reserva.datos.id, codigo: reserva.datos.codigoConfirmacion, correo: 'otra@ejemplo.com' } });
    ok(r.estado === 200 && r.datos.simulado === false, 'se envía de verdad');
    ok(await esperarCorreos(smtp.recibidos, 3), 'llega el comprobante');
    ok(smtp.recibidos[2]?.sobre.rcptTo[0].address === 'otra@ejemplo.com', 'a la dirección que se pidió');

    r = await srv.llamar('GET', '/admin/correo', { token: admin });
    ok(r.datos.ultimoEnvio?.via === 'smtp', 'el panel sabe cuál fue el último envío');
    ok(r.datos.recientes.some((c) => c.tipo === 'comprobante' && c.estado === 'enviado'), 'la lista marca el comprobante como enviado');

    console.log('  Si el servidor de correo se cae');
    await smtp.parar();
    const admin2 = await srv.otroAdmin(admin);
    r = await srv.llamar('POST', '/admin/correo/prueba', { token: admin2, cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 502 && /No se pudo conectar con 127\.0\.0\.1:2525/.test(r.error ?? ''), `la prueba falla con un mensaje claro (${r.error})`);
    r = await srv.llamar('POST', '/admin/correo/verificar', { token: admin, cuerpo: {} });
    ok(r.datos.ok === false && /No se pudo conectar/.test(r.datos.mensaje), 'verificar también lo dice');
    const otra = await reservar(srv, { correo: 'luis@ejemplo.com', recursoId: 'cub-2' });
    ok(otra.estado === 200, 'una reserva con correo se crea aunque el correo falle');
    r = await srv.llamar('POST', '/comprobantes/enviar', { cuerpo: { tipo: 'reserva', id: otra.datos.id, codigo: otra.datos.codigoConfirmacion, correo: 'x@ejemplo.com' } });
    ok(r.estado === 502 && /No se pudo enviar el correo/.test(r.error ?? ''), 'el comprobante a pedido avisa del fallo (502) sin detalles técnicos');
    ok(!/127\.0\.0\.1|ECONN/.test(r.error ?? ''), 'a la persona no se le muestran datos del servidor');
    await pausa(300);
    r = await srv.llamar('GET', '/admin/correo', { token: admin });
    ok(r.datos.recientes.filter((c) => c.estado === 'fallido').length >= 3, 'el panel registra los envíos fallidos');
    ok(r.datos.ultimoError?.mensaje?.includes('No se pudo conectar'), 'y el último error');
  } finally {
    srv.parar();
    await smtp.parar().catch(() => {});
  }
}

async function smtpConClave() {
  console.log('SMTP con usuario y clave');
  const smtp = await iniciarSmtp(2526, { auth: { usuario: 'biblioteca@prueba.test', clave: 'clave-buena' } });
  const bueno = await iniciar(4024, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2526', SMTP_USER: 'biblioteca@prueba.test', SMTP_PASS: 'clave-buena' });
  const malo = await iniciar(4025, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2526', SMTP_USER: 'biblioteca@prueba.test', SMTP_PASS: 'clave-mala' });
  try {
    const admin = await bueno.entrar('admin');
    let r = await bueno.llamar('GET', '/admin/correo', { token: admin });
    ok(r.datos.remitente === 'Biblioteca «Francisco Rolando Velázquez González» <biblioteca@prueba.test>', 'sin remitente propio usa el usuario SMTP (que es un correo)');
    ok(r.datos.usuario === 'bi***@prueba.test', 'el usuario SMTP se muestra a medias');
    ok(!JSON.stringify(r.datos).includes('clave-buena'), 'la clave nunca aparece');
    r = await bueno.llamar('POST', '/admin/correo/verificar', { token: admin, cuerpo: {} });
    ok(r.datos.ok === true, 'con la clave buena, verificar funciona');
    r = await bueno.llamar('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 200 && (await esperarCorreos(smtp.recibidos, 1)) && smtp.recibidos[0].usuario === 'biblioteca@prueba.test', 'y el correo sale autenticado');

    const adminMalo = await malo.entrar('admin');
    r = await malo.llamar('POST', '/admin/correo/verificar', { token: adminMalo, cuerpo: {} });
    ok(r.datos.ok === false && /rechazó el usuario o la clave/.test(r.datos.mensaje), `con la clave mala, verificar lo explica (${r.datos.mensaje})`);
    r = await malo.llamar('POST', '/admin/correo/prueba', { token: adminMalo, cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 502 && /SMTP_USER y SMTP_PASS/.test(r.error ?? ''), 'la prueba dice qué variables revisar');
    ok(!JSON.stringify(r).includes('clave-mala'), 'sin repetir la clave');
    ok(malo.salida.join('').includes('[correo] No se pudo verificar'), 'al arrancar con la clave mala lo avisa en la consola');
  } finally {
    bueno.parar();
    malo.parar();
    await smtp.parar();
  }
}

async function sinRespuesta() {
  console.log('Servidor que acepta la conexión pero no responde');
  const mudo = net.createServer(() => {}); // abre la conexión y no dice nada
  await new Promise((r) => mudo.listen(2527, '127.0.0.1', r));
  const srv = await iniciar(4026, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '2527', CORREO_REMITENTE: 'biblioteca@prueba.test', CORREO_TIEMPO_MS: '700' });
  try {
    const admin = await srv.entrar('admin');
    const inicio = Date.now();
    const r = await srv.llamar('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 502, `la prueba termina con error (${r.estado}) y no se queda colgada`);
    ok(Date.now() - inicio < 12000, `tardó ${Date.now() - inicio} ms`);
  } finally {
    srv.parar();
    mudo.close();
  }
}

async function porApi(proveedor) {
  console.log(`Modo API de ${proveedor === 'brevo' ? 'Brevo' : 'Resend'} (API falsa)`);
  const api = await iniciarApi(proveedor === 'brevo' ? 4031 : 4032);
  const puertoApi = proveedor === 'brevo' ? 4031 : 4032;
  const srv = await iniciar(proveedor === 'brevo' ? 4033 : 4034, {
    CORREO_API: proveedor,
    CORREO_API_KEY: 'clave-secreta-de-la-api',
    CORREO_REMITENTE: '"Biblioteca de Prueba" <biblioteca@prueba.test>',
    CORREO_API_URL: `http://127.0.0.1:${puertoApi}/envio`,
    CORREO_TIEMPO_MS: '800',
  });
  try {
    const admin = await srv.entrar('admin');
    let r = await srv.llamar('GET', '/admin/correo', { token: admin });
    ok(r.datos.modo === 'api' && r.datos.descripcion === `API de ${proveedor === 'brevo' ? 'Brevo' : 'Resend'}`, 'el estado dice que usa la API');
    ok(!JSON.stringify(r.datos).includes('clave-secreta-de-la-api'), 'la clave de la API nunca aparece');
    r = await srv.llamar('POST', '/admin/correo/verificar', { token: admin, cuerpo: {} });
    ok(r.datos.ok === null && /correo de prueba/i.test(r.datos.mensaje), 'verificar explica que con la API se usa el correo de prueba');
    ok(api.peticiones.length === 0, 'y no llamó a la API');

    api.comportamiento.estado = proveedor === 'brevo' ? 201 : 200;
    api.comportamiento.cuerpo = proveedor === 'brevo' ? { messageId: '<1@x>' } : { id: 'abc' };
    r = await srv.llamar('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 200 && r.datos.via === proveedor && r.datos.simulado === false, 'la prueba sale por la API');
    const p = api.peticiones[0];
    ok(p?.metodo === 'POST' && p?.cabeceras['content-type'] === 'application/json', 'es un POST con JSON');
    if (proveedor === 'brevo') {
      ok(p?.cabeceras['api-key'] === 'clave-secreta-de-la-api', 'Brevo: la clave va en la cabecera api-key');
      ok(p?.cuerpo?.sender?.email === 'biblioteca@prueba.test' && p?.cuerpo?.sender?.name === 'Biblioteca de Prueba', 'Brevo: sender con nombre y correo');
      ok(p?.cuerpo?.to?.[0]?.email === 'persona@ejemplo.com', 'Brevo: to con el destinatario');
      ok(p?.cuerpo?.subject === 'Correo de prueba de la biblioteca', 'Brevo: subject');
      ok(/<h1/.test(p?.cuerpo?.htmlContent ?? '') && /Correo de prueba/.test(p?.cuerpo?.textContent ?? ''), 'Brevo: htmlContent y textContent');
    } else {
      ok(p?.cabeceras.authorization === 'Bearer clave-secreta-de-la-api', 'Resend: la clave va como Bearer');
      ok(p?.cuerpo?.from === 'Biblioteca de Prueba <biblioteca@prueba.test>', 'Resend: from con nombre y correo');
      ok(Array.isArray(p?.cuerpo?.to) && p.cuerpo.to[0] === 'persona@ejemplo.com', 'Resend: to es una lista');
      ok(/<h1/.test(p?.cuerpo?.html ?? '') && /Correo de prueba/.test(p?.cuerpo?.text ?? ''), 'Resend: html y text');
    }

    console.log('  Respuestas de error de la API');
    const casos = [
      [401, { code: 'unauthorized', message: 'Key not found' }, /rechazó la clave de la API/, /Key not found/],
      [403, { name: 'restricted_api_key', message: 'sin permiso' }, /rechazó la clave de la API/, /sin permiso/],
      [400, { code: 'invalid_parameter', message: 'sender not valid' }, /rechazó el mensaje/, /remitente no está verificado/],
      [422, { name: 'validation_error', message: 'domain not verified' }, /rechazó el mensaje/, /domain not verified/],
      [429, { message: 'too many' }, /límite de envíos/, /too many/],
      [500, { message: 'oops' }, /no está respondiendo bien/, /500/],
    ];
    for (const [estado, cuerpo, patron, detalle] of casos) {
      api.comportamiento.estado = estado;
      api.comportamiento.cuerpo = cuerpo;
      const otro = await srv.otroAdmin(admin);
      r = await srv.llamar('POST', '/admin/correo/prueba', { token: otro, cuerpo: { para: 'persona@ejemplo.com' } });
      ok(r.estado === 502 && patron.test(r.error ?? '') && detalle.test(r.error ?? ''), `API ${estado}: «${r.error}»`);
      ok(!/clave-secreta-de-la-api/.test(r.error ?? ''), `API ${estado}: sin repetir la clave`);
    }

    console.log('  La API no responde');
    api.comportamiento.colgar = true;
    const ultimo = await srv.otroAdmin(admin);
    const inicio = Date.now();
    r = await srv.llamar('POST', '/admin/correo/prueba', { token: ultimo, cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 502 && /tardó demasiado/.test(r.error ?? ''), `se corta por tiempo (${r.error})`);
    ok(Date.now() - inicio < 6000, `en ${Date.now() - inicio} ms`);
  } finally {
    srv.parar();
    api.parar();
    api.servidor.close();
  }
}

// Imita a Google: /token cambia el refresh token por un token de acceso («acceso-1», «acceso-2»...) y /envio recibe el mensaje MIME.
function iniciarGoogle(puerto) {
  const tokens = [];
  const envios = [];
  const comportamiento = { tokenEstado: 200, tokenCuerpo: null, envioEstado: 200, envioCuerpo: { id: 'm1' }, anulados: new Set() };
  const servidor = http.createServer((req, res) => {
    const partes = [];
    req.on('data', (d) => partes.push(d));
    req.on('end', async () => {
      const cuerpo = Buffer.concat(partes);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/token') {
        tokens.push(Object.fromEntries(new URLSearchParams(cuerpo.toString())));
        const idToken = `x.${Buffer.from(JSON.stringify({ email: 'biblioteca@gmail.com' })).toString('base64url')}.y`;
        res.writeHead(comportamiento.tokenEstado);
        res.end(JSON.stringify(comportamiento.tokenCuerpo ?? { access_token: `acceso-${tokens.length}`, expires_in: 3599, id_token: idToken }));
        return;
      }
      envios.push({ cabeceras: req.headers, correo: await simpleParser(cuerpo).catch(() => null) });
      if (comportamiento.anulados.has(req.headers.authorization)) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: { code: 401, message: 'Invalid Credentials' } }));
        return;
      }
      res.writeHead(comportamiento.envioEstado);
      res.end(JSON.stringify(comportamiento.envioCuerpo));
    });
  });
  return new Promise((resolve) => servidor.listen(puerto, '127.0.0.1', () => resolve({ tokens, envios, comportamiento, parar: () => servidor.close() })));
}

async function porGmail() {
  console.log('Modo API de Gmail (Google falso)');
  const google = await iniciarGoogle(4035);
  const env = {
    CORREO_API: 'gmail',
    GMAIL_CLIENT_ID: 'cliente.apps.googleusercontent.com',
    GMAIL_CLIENT_SECRET: 'secreto-del-cliente',
    GMAIL_REFRESH_TOKEN: 'refresh-token-secreto',
    CORREO_REMITENTE: '"Biblioteca de Prueba" <biblioteca@gmail.com>',
    GMAIL_TOKEN_URL: 'http://127.0.0.1:4035/token',
    CORREO_API_URL: 'http://127.0.0.1:4035/envio',
  };
  const srv = await iniciar(4036, env);
  try {
    const admin = await srv.entrar('admin');
    let r = await srv.llamar('GET', '/admin/correo', { token: admin });
    ok(r.datos.modo === 'api' && r.datos.descripcion === 'API de Gmail' && r.datos.verificable === true, 'el estado dice Gmail y que se puede comprobar');
    ok(!/refresh-token-secreto|secreto-del-cliente/.test(JSON.stringify(r.datos)), 'ni el token ni el secreto aparecen');
    ok(google.tokens.length === 1 && /credenciales de biblioteca@gmail\.com/.test(srv.salida.join('')), 'al arrancar comprueba las credenciales');

    r = await srv.llamar('POST', '/admin/correo/verificar', { token: admin, cuerpo: {} });
    ok(r.datos.ok === true && /biblioteca@gmail\.com/.test(r.datos.mensaje), `verificar pide un token y dice la cuenta (${r.datos.mensaje})`);
    const t = google.tokens.at(-1);
    ok(t?.grant_type === 'refresh_token' && t?.refresh_token === 'refresh-token-secreto' && t?.client_id === env.GMAIL_CLIENT_ID, 'el token se pide con el refresh token');
    ok(google.envios.length === 0, 'verificar no manda ningún correo');

    const emitidos = google.tokens.length;
    r = await srv.llamar('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 200 && r.datos.via === 'gmail' && r.datos.simulado === false, 'la prueba sale por Gmail');
    const e = google.envios[0];
    ok(e?.cabeceras.authorization === `Bearer acceso-${emitidos}` && google.tokens.length === emitidos, 'reutiliza el token de acceso vigente');
    ok(e?.cabeceras['content-type'] === 'message/rfc822', 'manda el mensaje MIME tal cual');
    ok(e?.correo?.from.value[0].address === 'biblioteca@gmail.com' && e?.correo?.from.value[0].name === 'Biblioteca de Prueba', 'remitente con nombre');
    ok(e?.correo?.to.value[0].address === 'persona@ejemplo.com' && e?.correo?.subject === 'Correo de prueba de la biblioteca', 'destinatario y asunto');
    ok(/<h1/.test(e?.correo?.html ?? '') && /Correo de prueba/.test(e?.correo?.text ?? ''), 'trae HTML y texto');

    console.log('  Confirmación de reserva');
    const reserva = await reservar(srv, { correo: 'ana@ejemplo.com' });
    await pausa(500);
    const conf = google.envios.find((x) => x.correo?.subject === `Confirmación de reserva ${reserva.datos?.id}`);
    ok(conf && (conf.correo.text ?? '').includes(reserva.datos.codigoConfirmacion), 'la confirmación sale por Gmail con su código');

    console.log('  Token de acceso anulado antes de tiempo');
    google.comportamiento.anulados.add(`Bearer acceso-${google.tokens.length}`);
    const antes = google.tokens.length;
    r = await srv.llamar('POST', '/admin/correo/prueba', { token: await srv.otroAdmin(admin), cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 200 && google.tokens.length === antes + 1, `con un 401 pide otro token y vuelve a intentar (${r.estado} ${r.error ?? ''})`);

    console.log('  Refresh token anulado (app en modo «Prueba» o acceso quitado)');
    google.comportamiento.tokenEstado = 400;
    google.comportamiento.tokenCuerpo = { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' };
    r = await srv.llamar('POST', '/admin/correo/verificar', { token: admin, cuerpo: {} });
    ok(r.datos.ok === false && /npm run token-gmail/.test(r.datos.mensaje) && /Publicar app/.test(r.datos.mensaje), `verificar explica cómo arreglarlo (${r.datos.mensaje})`);
    r = await srv.llamar('POST', '/admin/correo/prueba', { token: await srv.otroAdmin(admin), cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 502 && /GMAIL_REFRESH_TOKEN/.test(r.error ?? '') && !/refresh-token-secreto/.test(r.error ?? ''), 'la prueba falla con el mismo consejo, sin mostrar el token');

    console.log('  Cliente equivocado y envío rechazado');
    google.comportamiento.tokenCuerpo = { error: 'invalid_client', error_description: 'The OAuth client was not found.' };
    r = await srv.llamar('POST', '/admin/correo/verificar', { token: admin, cuerpo: {} });
    ok(r.datos.ok === false && /GMAIL_CLIENT_ID o GMAIL_CLIENT_SECRET/.test(r.datos.mensaje), 'un cliente equivocado se explica');
    google.comportamiento.tokenEstado = 200;
    google.comportamiento.tokenCuerpo = null;
    google.comportamiento.envioEstado = 403;
    google.comportamiento.envioCuerpo = { error: { code: 403, message: 'Gmail API has not been used in project 123' } };
    await srv.llamar('POST', '/admin/correo/verificar', { token: admin, cuerpo: {} }); // vuelve a tener un token de acceso válido
    r = await srv.llamar('POST', '/admin/correo/prueba', { token: await srv.otroAdmin(admin), cuerpo: { para: 'persona@ejemplo.com' } });
    ok(r.estado === 502 && /Gmail API has not been used/.test(r.error ?? '') && /habilitada/.test(r.error ?? ''), `un 403 dice qué revisar (${r.error})`);
  } finally {
    srv.parar();
    google.parar();
  }

  console.log('  Gmail sin CORREO_REMITENTE, o con la variable mal pegada');
  const otroGoogle = await iniciarGoogle(4038);
  const sinRemitente = { ...env, CORREO_REMITENTE: '', GMAIL_TOKEN_URL: 'http://127.0.0.1:4038/token', CORREO_API_URL: 'http://127.0.0.1:4038/envio' };
  const mal = '"Biblioteca de Prueba <biblioteca@gmail.com>\nRESPALDO_CORREO=biblioteca@gmail.com"';
  for (const [nombre, valor, puerto] of [['sin remitente', '', 4039], ['comilla sin cerrar y otra línea', mal, 4040]]) {
    const s = await iniciar(puerto, { ...sinRemitente, CORREO_REMITENTE: valor });
    try {
      const admin = await s.entrar('admin');
      let r = await s.llamar('GET', '/admin/correo', { token: admin });
      ok(/biblioteca@gmail\.com/.test(r.datos.remitente ?? ''), `${nombre}: el panel muestra el remitente (${r.datos.remitente})`);
      r = await s.llamar('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'persona@ejemplo.com' } });
      ok(r.estado === 200 && r.datos.via === 'gmail', `${nombre}: la prueba sale (${r.estado} ${r.error ?? ''})`);
      const de = otroGoogle.envios.at(-1)?.correo?.from.value[0];
      ok(de?.address === 'biblioteca@gmail.com', `${nombre}: sale desde la cuenta de Gmail (${de?.address})`);
      if (!valor) ok(de?.name === 'Biblioteca «Francisco Rolando Velázquez González»', `sin remitente: con el nombre de la biblioteca (${de?.name})`);
      else ok(de?.name === 'Biblioteca de Prueba', `mal pegada: conserva el nombre escrito (${de?.name})`);
    } finally {
      s.parar();
    }
  }
  otroGoogle.parar();

  console.log('  Gmail sin todas sus variables');
  const incompleto = await iniciar(4037, { CORREO_API: 'gmail', GMAIL_CLIENT_ID: 'x', CORREO_REMITENTE: 'b@gmail.com' });
  try {
    const admin = await incompleto.entrar('admin');
    const r = await incompleto.llamar('GET', '/admin/correo', { token: admin });
    ok(r.datos.modo === 'simulado' && r.datos.avisos.some((a) => /GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN/.test(a) && /token-gmail/.test(a)), 'avisa qué falta y cómo generarlo');
  } finally {
    incompleto.parar();
  }
}

async function configuracionIncompleta() {
  console.log('Configuración incompleta o equivocada');
  const casos = [
    ['CORREO_API desconocida', { CORREO_API: 'mailchimp', CORREO_API_KEY: 'x' }, /no es un servicio conocido/],
    ['API sin clave', { CORREO_API: 'brevo', CORREO_REMITENTE: 'b@prueba.test' }, /Falta CORREO_API_KEY/],
    ['API sin remitente', { CORREO_API: 'brevo', CORREO_API_KEY: 'x' }, /Falta CORREO_REMITENTE/],
    ['remitente con mal formato', { SMTP_HOST: '127.0.0.1', CORREO_REMITENTE: 'esto no es un correo' }, /formato válido/],
    ['SMTP con usuario que no es correo y sin remitente', { SMTP_HOST: '127.0.0.1', SMTP_USER: 'apikey', SMTP_PASS: 'x' }, /Falta CORREO_REMITENTE/],
  ];
  let puerto = 4051;
  for (const [nombre, env, aviso] of casos) {
    const srv = await iniciar(puerto, env);
    puerto += 1;
    try {
      const admin = await srv.entrar('admin');
      const r = await srv.llamar('GET', '/admin/correo', { token: admin });
      ok(r.datos.avisos.some((a) => aviso.test(a)), `${nombre}: avisa (${r.datos.avisos.join(' | ')})`);
      if (/sin remitente|API sin remitente|usuario que no es correo/.test(nombre)) {
        const p = await srv.llamar('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'persona@ejemplo.com' } });
        ok(p.estado === 502 && /Falta CORREO_REMITENTE/.test(p.error ?? ''), `${nombre}: la prueba dice qué falta`);
      }
      if (/desconocida|sin clave/.test(nombre)) ok(r.datos.modo === 'simulado', `${nombre}: sigue simulado, sin romper nada`);
    } finally {
      srv.parar();
    }
  }
}

try {
  await simulado();
  await porSmtp();
  await smtpConClave();
  await sinRespuesta();
  await porApi('brevo');
  await porApi('resend');
  await porGmail();
  await configuracionIncompleta();
} finally {
  console.log(`\n${comprobaciones} comprobaciones: ${fallos === 0 ? 'TODO BIEN' : `${fallos} FALLAS`}`);
}
process.exit(fallos === 0 ? 0 : 1);
