// «Conectar Gmail» desde el panel (Correo), con un Google FALSO en esta computadora (nada sale a internet): el ida y vuelta de OAuth,
// que la conexión se guarde cifrada y valga más que GMAIL_REFRESH_TOKEN, el aviso cuando Google la anula y volver a conectarla.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { arrancarServidor, carpetaTemporal, cliente, comprobador, pausa, puertoLibre } from './servidor.mjs';

const { ok, terminar } = comprobador();
const PERMISOS = 'https://www.googleapis.com/auth/gmail.send openid https://www.googleapis.com/auth/userinfo.email';
const idToken = (email) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.y`;

// Imita a Google: /token cambia un código por un refresh token («refresh-del-panel-1», «-2»...) o un refresh token por un token de
// acceso, y /envio recibe el correo. `comportamiento` cambia lo que responde.
async function iniciarGoogle() {
  const puerto = await puertoLibre();
  const pedidos = [];
  const envios = [];
  const comportamiento = { codigo: null, refresh: null };
  let entregados = 0;
  const servidor = http.createServer((req, res) => {
    const partes = [];
    req.on('data', (d) => partes.push(d));
    req.on('end', () => {
      const cuerpo = Buffer.concat(partes).toString();
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/token') {
        const datos = Object.fromEntries(new URLSearchParams(cuerpo));
        pedidos.push(datos);
        const respuesta =
          datos.grant_type === 'authorization_code'
            ? comportamiento.codigo ?? { access_token: 'acceso-0', refresh_token: `refresh-del-panel-${(entregados += 1)}`, scope: PERMISOS, id_token: idToken('panel@gmail.com') }
            : comportamiento.refresh ?? { access_token: `acceso-${pedidos.length}`, expires_in: 3599, id_token: idToken(datos.refresh_token === 'refresh-variables' ? 'variables@gmail.com' : 'panel@gmail.com') };
        res.writeHead(respuesta.error ? 400 : 200);
        res.end(JSON.stringify(respuesta));
        return;
      }
      envios.push({ autorizacion: req.headers.authorization, cuerpo });
      res.writeHead(200);
      res.end(JSON.stringify({ id: 'm1' }));
    });
  });
  await new Promise((r) => servidor.listen(puerto, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${puerto}`, pedidos, envios, comportamiento, parar: () => servidor.close() };
}

const google = await iniciarGoogle();
const datos = carpetaTemporal('gmail-panel');
const CLIENTE = { GMAIL_CLIENT_ID: 'cliente-web.apps.googleusercontent.com', GMAIL_CLIENT_SECRET: 'secreto-web', GMAIL_TOKEN_URL: `${google.url}/token`, CORREO_API_URL: `${google.url}/envio` };

let srv = null;
let api = null;
let admin = null;
async function arrancar(env) {
  if (srv) {
    await pausa(800); // el servidor guarda 0,3 s después del último cambio
    await srv.parar();
  }
  srv = await arrancarServidor({ datos, env });
  ({ api } = cliente(srv.base));
  admin = await cliente(srv.base).entrar('admin');
}

// Pide la dirección de Google como lo hace el panel y devuelve el `state` y el desafío PKCE que van en ella.
async function pedirConexion(origen) {
  const r = await fetch(`${srv.base}/api/admin/correo/gmail/conectar`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json', ...(origen ? { Origin: origen } : {}) },
  });
  const json = await r.json();
  const url = new URL(json.data?.url ?? 'http://nada');
  return { estado: r.status, url, state: url.searchParams.get('state'), desafio: url.searchParams.get('code_challenge') };
}

// Lo que hace el navegador al volver de Google.
async function volver(parametros) {
  const r = await fetch(`${srv.base}/api/admin/correo/gmail/volver?${new URLSearchParams(parametros)}`, { redirect: 'manual' });
  return { estado: r.status, destino: r.headers.get('location') ?? '' };
}

const estadoDelCorreo = async () => (await api('GET', '/admin/correo', { token: admin })).datos;

try {
  console.log('Sin conectar');
  await arrancar(CLIENTE);
  let e = await estadoDelCorreo();
  ok(e.modo === 'simulado' && e.gmail.puedeConectar === true && e.gmail.enUso === false && e.gmail.conexion === null, 'con el cliente pero sin conexión: simulado y se puede conectar');
  ok(e.gmail.direccionDeRegreso === `${srv.base}/api/admin/correo/gmail/volver`, `muestra la dirección de regreso para Google Cloud (${e.gmail.direccionDeRegreso})`);

  console.log('La dirección de Google');
  const circ = await cliente(srv.base).entrar('circulacion');
  ok((await api('POST', '/admin/correo/gmail/conectar', { token: circ })).estado === 403, 'circulación no puede conectar');
  let pedido = await pedirConexion('http://localhost:5174');
  const p = pedido.url.searchParams;
  ok(pedido.estado === 200 && pedido.url.origin === 'https://accounts.google.com', `lleva a Google (${pedido.url.origin})`);
  ok(p.get('client_id') === CLIENTE.GMAIL_CLIENT_ID && p.get('redirect_uri') === e.gmail.direccionDeRegreso && p.get('response_type') === 'code', 'con el cliente y la dirección de regreso');
  ok(p.get('scope').includes('gmail.send') && p.get('access_type') === 'offline' && /consent/.test(p.get('prompt')), 'pide solo enviar correo, con permiso permanente');
  ok(p.get('code_challenge_method') === 'S256' && pedido.desafio?.length === 43 && pedido.state?.length >= 32, 'con PKCE y un state largo');

  console.log('Volver sin un pedido válido, o sin dar permiso');
  let v = await volver({ state: 'inventado', code: 'x' });
  ok(v.estado === 303 && v.destino === '/privateAccess/correo?gmail=error', `un state inventado regresa con error (${v.destino})`);
  ok(/venció o ya se usó/.test((await estadoDelCorreo()).gmail.ultimoIntento?.mensaje ?? ''), 'y el panel dice por qué');
  v = await volver({ state: pedido.state, error: 'access_denied' });
  ok(v.destino === 'http://localhost:5174/privateAccess/correo?gmail=error', `vuelve al panel desde donde se pidió (${v.destino})`);
  ok(/no se dio el permiso/.test((await estadoDelCorreo()).gmail.ultimoIntento?.mensaje ?? ''), 'el panel dice que no se dio el permiso');
  ok(google.pedidos.length === 0, 'sin pedirle nada a Google');

  console.log('Conectar');
  pedido = await pedirConexion();
  v = await volver({ state: pedido.state, code: 'codigo-1' });
  ok(v.estado === 303 && v.destino.endsWith('/privateAccess/correo?gmail=conectado'), `vuelve con todo listo (${v.destino})`);
  const cambio = google.pedidos.find((x) => x.grant_type === 'authorization_code');
  ok(cambio?.code === 'codigo-1' && cambio.client_secret === 'secreto-web' && cambio.redirect_uri === `${srv.base}/api/admin/correo/gmail/volver`, 'cambia el código con el secreto y la misma dirección');
  ok(crypto.createHash('sha256').update(cambio?.code_verifier ?? '').digest('base64url') === pedido.desafio, 'con el verificador PKCE que corresponde');
  ok((await volver({ state: pedido.state, code: 'codigo-1' })).destino.endsWith('gmail=error'), 'el mismo state no sirve dos veces');
  await pausa(300);
  e = await estadoDelCorreo();
  ok(e.modo === 'api' && e.descripcion === 'API de Gmail' && e.gmail.enUso && e.gmail.origen === 'panel', `ya envía por Gmail sin CORREO_API (${e.modo}, ${e.gmail.origen})`);
  ok(e.gmail.conexion?.cuenta === 'panel@gmail.com' && e.gmail.conexion?.conectadaPor === 'admin', 'muestra la cuenta y quién la conectó');
  ok(/panel@gmail\.com/.test(e.remitente ?? ''), `el remitente es esa cuenta (${e.remitente})`);
  ok(e.avisos.length === 0, `sin avisos (${e.avisos})`);
  const guardado = fs.readFileSync(path.join(datos, 'conexion_gmail.json'), 'utf8');
  ok(!guardado.includes('refresh-del-panel') && /"token": ?"v1\./.test(guardado), 'el permiso se guarda cifrado');
  const actividad = await api('GET', '/admin/actividad', { token: admin });
  ok(actividad.datos.registros.some((a) => a.accion === 'correo.gmail' && /panel@gmail\.com/.test(a.detalle)), 'queda en la actividad');

  console.log('Enviar con la conexión del panel');
  let r = await api('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'alguien@ejemplo.com' } });
  ok(r.estado === 200 && r.datos?.via === 'gmail', `la prueba sale por Gmail (${r.estado} ${r.error ?? ''})`);
  // Las cabeceras largas (el nombre de la biblioteca) siguen en la línea siguiente: se juntan antes de buscar.
  const cabeceras = (google.envios[0]?.cuerpo ?? '').split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, ' ');
  ok(google.envios.length === 1 && /^From: .*<panel@gmail\.com>/m.test(cabeceras), 'desde la cuenta conectada');
  ok(google.pedidos.some((x) => x.grant_type === 'refresh_token' && x.refresh_token === 'refresh-del-panel-1'), 'con el permiso que dio Google');

  console.log('Después de reiniciar, y con GMAIL_REFRESH_TOKEN también en las variables');
  await arrancar({ ...CLIENTE, CORREO_API: 'gmail', GMAIL_REFRESH_TOKEN: 'refresh-variables' });
  e = await estadoDelCorreo();
  ok(e.gmail.origen === 'panel' && e.gmail.conexion?.cuenta === 'panel@gmail.com', 'la conexión sigue y vale más que la de las variables');
  google.pedidos.length = 0;
  r = await api('POST', '/admin/correo/verificar', { token: admin });
  ok(r.datos?.ok === true && google.pedidos.at(-1)?.refresh_token === 'refresh-del-panel-1', `comprueba con la del panel (${r.datos?.mensaje})`);

  console.log('Si Google la anula');
  google.comportamiento.refresh = { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' };
  r = await api('POST', '/admin/correo/verificar', { token: admin });
  ok(r.datos?.ok === false && /Conectar Gmail/.test(r.datos.mensaje) && !/npm run/.test(r.datos.mensaje), `dice que se vuelva a conectar desde el panel (${r.datos?.mensaje})`);
  e = await estadoDelCorreo();
  ok(e.gmail.anulada && /Conectar Gmail/.test(e.gmail.anulada.mensaje), 'el panel lo marca como desconectada');
  r = await api('POST', '/admin/correo/prueba', { token: admin, cuerpo: { para: 'alguien@ejemplo.com' } });
  ok(r.estado === 502 && !/refresh-del-panel/.test(r.error ?? ''), 'el correo falla sin mostrar el permiso');

  console.log('Volver a conectar');
  google.comportamiento.refresh = null;
  pedido = await pedirConexion();
  v = await volver({ state: pedido.state, code: 'codigo-2' });
  ok(v.destino.endsWith('gmail=conectado'), 'se vuelve a conectar con el botón');
  await pausa(300);
  e = await estadoDelCorreo();
  ok(e.gmail.anulada === null && e.gmail.enUso, 'el aviso rojo se quita');
  r = await api('POST', '/admin/correo/verificar', { token: admin }); // (el correo de prueba espera 5 s entre uno y otro)
  ok(r.datos?.ok === true && google.pedidos.at(-1)?.refresh_token === 'refresh-del-panel-2', 'y Google acepta el permiso nuevo');

  console.log('Lo que Google puede negar al conectar');
  google.comportamiento.codigo = { access_token: 'a', refresh_token: 'r', scope: 'openid email', id_token: idToken('panel@gmail.com') };
  pedido = await pedirConexion();
  await volver({ state: pedido.state, code: 'codigo-3' });
  e = await estadoDelCorreo();
  ok(/Falta el permiso de enviar correos/.test(e.gmail.ultimoIntento?.mensaje ?? ''), 'sin la casilla de enviar correos, lo explica');
  google.comportamiento.codigo = { access_token: 'a', scope: PERMISOS };
  pedido = await pedirConexion();
  await volver({ state: pedido.state, code: 'codigo-4' });
  ok(/permiso permanente/.test((await estadoDelCorreo()).gmail.ultimoIntento?.mensaje ?? ''), 'sin refresh token, dice cómo arreglarlo');
  google.comportamiento.codigo = { error: 'invalid_client', error_description: 'Unauthorized' };
  pedido = await pedirConexion();
  await volver({ state: pedido.state, code: 'codigo-5' });
  ok(/GMAIL_CLIENT_ID o GMAIL_CLIENT_SECRET/.test((await estadoDelCorreo()).gmail.ultimoIntento?.mensaje ?? ''), 'un cliente equivocado se explica');
  e = await estadoDelCorreo();
  ok(e.gmail.conexion?.cuenta === 'panel@gmail.com' && e.gmail.enUso, 'los intentos fallidos no tocan la conexión que había');
  google.comportamiento.codigo = null;

  console.log('Si cambia el cliente de Google');
  await arrancar({ ...CLIENTE, GMAIL_CLIENT_SECRET: 'otro-secreto' });
  e = await estadoDelCorreo();
  ok(e.modo === 'simulado' && e.avisos.some((a) => /cambió GMAIL_CLIENT_SECRET/.test(a)), `con otro secreto la conexión no se lee y se explica (${e.avisos})`);
  await arrancar({ ...CLIENTE, GMAIL_CLIENT_ID: 'otro-cliente.apps.googleusercontent.com' });
  e = await estadoDelCorreo();
  ok(e.avisos.some((a) => /cambió GMAIL_CLIENT_ID/.test(a)), 'con otro cliente, también');

  console.log('Quitar la conexión');
  await arrancar({ ...CLIENTE, CORREO_API: 'gmail', GMAIL_REFRESH_TOKEN: 'refresh-variables' });
  r = await api('POST', '/admin/correo/gmail/desconectar', { token: admin });
  ok(r.estado === 200 && r.datos.gmail.conexion === null && r.datos.gmail.origen === 'variables', 'vuelve al permiso de las variables');
  await pausa(600);
  ok(!fs.readFileSync(path.join(datos, 'conexion_gmail.json'), 'utf8').includes('v1.'), 'y lo guardado se borra');

  console.log('Sin el cliente de Google en las variables');
  await arrancar({});
  r = await api('POST', '/admin/correo/gmail/conectar', { token: admin });
  ok(r.estado === 409 && /GMAIL_CLIENT_ID/.test(r.error ?? ''), `no se puede conectar y se dice qué falta (${r.estado})`);
  ok((await estadoDelCorreo()).gmail.puedeConectar === false, 'el panel lo sabe');
} finally {
  await srv?.parar();
  google.parar();
  fs.rmSync(datos, { recursive: true, force: true });
}

terminar();
