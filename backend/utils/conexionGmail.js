const crypto = require('node:crypto');
const almacen = require('./almacen');

// «Conectar Gmail» desde el panel (Correo). El administrador entra con la cuenta de Google de la biblioteca, Google devuelve un refresh
// token y se guarda aquí, cifrado; el correo lo usa en lugar de GMAIL_REFRESH_TOKEN. Si algún día Google lo anula (alguien quitó el
// acceso, cambió la contraseña de la cuenta...), se vuelve a conectar con un botón, sin tocar las variables del servidor.
// GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET siguen en las variables: son de la app de Google Cloud, no de la cuenta, y no vencen.
//
// El ida y vuelta es el de OAuth para aplicaciones web: el panel pide la dirección de Google, la persona da permiso y Google la manda de
// vuelta a /api/admin/correo/gmail/volver con un código de un solo uso, que el servidor cambia por el refresh token. Para eso, el cliente
// de Google Cloud tiene que ser de tipo «Aplicación web» y tener esa dirección en «URI de redireccionamiento autorizados».

const URL_PARA_AUTORIZAR = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_DEL_TOKEN = 'https://oauth2.googleapis.com/token';
const PERMISO_DE_ENVIO = 'https://www.googleapis.com/auth/gmail.send';
const RUTA_DE_REGRESO = '/api/admin/correo/gmail/volver';
const VIGENCIA_DEL_PEDIDO_MS = 15 * 60 * 1000;
const ESPERA_MS = 15000;

const pedidos = new Map(); // state -> { verificador, regreso, volverA, usuario, creadoEn }
let ultimoIntento = null; // { ok, mensaje, fecha }: cómo terminó la última vuelta desde Google, para que el panel lo diga
let guardada = null;

// Se lee la primera vez que se usa: con una base de datos, el almacén se abre después de cargar este archivo.
function documento() {
  if (!guardada) guardada = almacen.cargar('conexion_gmail', { token: null, clienteId: null, cuenta: null, conectadaEn: null, conectadaPor: null });
  return guardada;
}

// El token se guarda cifrado con una llave que sale de GMAIL_CLIENT_SECRET, que no está en la base de datos: quien viera solo la base
// no podría usarlo. Si cambia el secreto, la conexión guardada ya no se puede leer y hay que volver a conectar.
const llave = (clienteSecreto) => crypto.createHash('sha256').update(`conexion-gmail:${clienteSecreto}`).digest();

function cifrar(texto, clienteSecreto) {
  const iv = crypto.randomBytes(12);
  const cifrador = crypto.createCipheriv('aes-256-gcm', llave(clienteSecreto), iv);
  const cuerpo = Buffer.concat([cifrador.update(texto, 'utf8'), cifrador.final()]);
  return ['v1', iv, cifrador.getAuthTag(), cuerpo].map((parte) => (Buffer.isBuffer(parte) ? parte.toString('base64url') : parte)).join('.');
}

function descifrar(sobre, clienteSecreto) {
  const [version, iv, etiqueta, cuerpo] = String(sobre).split('.');
  if (version !== 'v1' || !cuerpo) return null;
  try {
    const descifrador = crypto.createDecipheriv('aes-256-gcm', llave(clienteSecreto), Buffer.from(iv, 'base64url'));
    descifrador.setAuthTag(Buffer.from(etiqueta, 'base64url'));
    return Buffer.concat([descifrador.update(Buffer.from(cuerpo, 'base64url')), descifrador.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// El correo de la cuenta viene en el id_token (se pide el permiso «email»). Solo se usa para mostrarlo.
function cuentaDelIdToken(idToken) {
  try {
    return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email || null;
  } catch {
    return null;
  }
}

const recortar = (texto, largo = 220) => (String(texto).length > largo ? `${String(texto).slice(0, largo)}...` : String(texto));

// La conexión guardada, lista para usar: { refreshToken, cuenta, conectadaEn, conectadaPor, problema }, o null si no se conectó desde
// el panel. Un refresh token solo sirve con el cliente con el que se dio: si cambió GMAIL_CLIENT_ID, no se usa y se explica.
function leer({ clienteId, clienteSecreto }) {
  const doc = documento();
  if (!doc.token) return null;
  const datos = { cuenta: doc.cuenta, conectadaEn: doc.conectadaEn, conectadaPor: doc.conectadaPor, refreshToken: null, problema: null };
  if (!clienteId || !clienteSecreto) {
    return { ...datos, problema: 'Gmail se conectó desde el panel, pero faltan GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET en las variables del servidor.' };
  }
  if (doc.clienteId !== clienteId) {
    return { ...datos, problema: 'La conexión de Gmail del panel se hizo con otro cliente de Google (cambió GMAIL_CLIENT_ID): vuelve a conectar con «Conectar Gmail».' };
  }
  const refreshToken = descifrar(doc.token, clienteSecreto);
  if (!refreshToken) {
    return { ...datos, problema: 'No se pudo leer la conexión de Gmail del panel (cambió GMAIL_CLIENT_SECRET): vuelve a conectar con «Conectar Gmail».' };
  }
  return { ...datos, refreshToken };
}

// La dirección a la que Google manda de vuelta. GMAIL_URL_DE_REGRESO la fija si el servidor no la deduce bien (un proxy sin TRUST_PROXY
// daría http en lugar de https).
function direccionDeRegreso(req) {
  const fija = String(process.env.GMAIL_URL_DE_REGRESO || '').trim();
  return fija || `${req.protocol}://${req.get('host')}${RUTA_DE_REGRESO}`;
}

function olvidarPedidosVencidos() {
  for (const [clave, pedido] of pedidos) if (Date.now() - pedido.creadoEn > VIGENCIA_DEL_PEDIDO_MS) pedidos.delete(clave);
}

// Arma la dirección de Google para dar el permiso. `state` (de un solo uso) liga la vuelta con este pedido, y PKCE asegura que el código
// que vuelva solo lo pueda cambiar este servidor. `prompt=consent` hace que Google entregue un refresh token nuevo cada vez.
function iniciar({ clienteId, regreso, volverA, usuario }) {
  olvidarPedidosVencidos();
  const estado = crypto.randomBytes(24).toString('base64url');
  const verificador = crypto.randomBytes(48).toString('base64url');
  pedidos.set(estado, { verificador, regreso, volverA, usuario, creadoEn: Date.now() });
  const url = new URL(URL_PARA_AUTORIZAR);
  url.search = new URLSearchParams({
    client_id: clienteId,
    redirect_uri: regreso,
    response_type: 'code',
    scope: `${PERMISO_DE_ENVIO} openid email`,
    access_type: 'offline',
    prompt: 'consent select_account',
    state: estado,
    code_challenge: crypto.createHash('sha256').update(verificador).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

function terminar(ok, mensaje, pedido) {
  ultimoIntento = { ok, mensaje, fecha: new Date().toISOString() };
  return { ok, mensaje, volverA: pedido?.volverA ?? '', usuario: pedido?.usuario ?? null };
}

// La vuelta desde Google: cambia el código por el refresh token y lo guarda. No lanza errores: devuelve { ok, mensaje, volverA, cuenta }.
async function completar({ codigo, estado, error, clienteId, clienteSecreto }) {
  const pedido = pedidos.get(estado);
  pedidos.delete(estado);
  if (!pedido || Date.now() - pedido.creadoEn > VIGENCIA_DEL_PEDIDO_MS) {
    return terminar(false, 'El pedido de conexión venció o ya se usó. Vuelve a pulsar «Conectar Gmail».', null);
  }
  if (error) {
    const motivo = error === 'access_denied' ? 'no se dio el permiso en Google' : `Google respondió «${recortar(error, 80)}»`;
    return terminar(false, `No se conectó: ${motivo}. La conexión anterior sigue igual.`, pedido);
  }
  if (!codigo) return terminar(false, 'Google no devolvió el código de permiso. Vuelve a pulsar «Conectar Gmail».', pedido);

  let respuesta;
  try {
    // GMAIL_TOKEN_URL existe solo para las pruebas automáticas.
    respuesta = await fetch(process.env.GMAIL_TOKEN_URL || URL_DEL_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: codigo,
        client_id: clienteId,
        client_secret: clienteSecreto,
        redirect_uri: pedido.regreso,
        grant_type: 'authorization_code',
        code_verifier: pedido.verificador,
      }),
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch (err) {
    const causa = err.name === 'TimeoutError' ? 'tardó demasiado en responder' : err.cause?.code || err.message;
    return terminar(false, `No se pudo conectar con Google (${causa}). Inténtalo de nuevo en un momento.`, pedido);
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok || !datos.access_token) {
    const detalle = recortar(datos.error_description || datos.error || `error ${respuesta.status}`);
    if (datos.error === 'invalid_client' || datos.error === 'unauthorized_client') {
      return terminar(false, `Google rechazó GMAIL_CLIENT_ID o GMAIL_CLIENT_SECRET (${detalle}). Revisa que sean los del cliente «Aplicación web».`, pedido);
    }
    if (datos.error === 'redirect_uri_mismatch') {
      return terminar(false, `La dirección de regreso no está autorizada en Google Cloud: agrega ${pedido.regreso} al cliente «Aplicación web».`, pedido);
    }
    return terminar(false, `Google no entregó el permiso (${detalle}). Vuelve a pulsar «Conectar Gmail».`, pedido);
  }
  if (!String(datos.scope ?? PERMISO_DE_ENVIO).split(/\s+/).includes(PERMISO_DE_ENVIO)) {
    return terminar(false, 'Falta el permiso de enviar correos: vuelve a conectar y deja marcada la casilla «Enviar correo electrónico en tu nombre».', pedido);
  }
  if (!datos.refresh_token) {
    return terminar(
      false,
      'Google no entregó el permiso permanente. Quita el acceso de la app en myaccount.google.com/permissions (con la cuenta de la biblioteca) y vuelve a conectar.',
      pedido,
    );
  }

  const cuenta = cuentaDelIdToken(datos.id_token);
  Object.assign(documento(), {
    token: cifrar(datos.refresh_token, clienteSecreto),
    clienteId,
    cuenta,
    conectadaEn: new Date().toISOString(),
    conectadaPor: pedido.usuario,
  });
  almacen.guardar('conexion_gmail', documento());
  return { ...terminar(true, `Gmail quedó conectado${cuenta ? ` con ${cuenta}` : ''}: el correo ya sale por esa cuenta.`, pedido), cuenta };
}

// Olvida la conexión del panel (el correo vuelve a usar GMAIL_REFRESH_TOKEN, si está). No se anula en Google: el mismo permiso puede
// estar en uso en las variables, y anularlo allá cortaría también ese.
function desconectar() {
  Object.assign(documento(), { token: null, clienteId: null, cuenta: null, conectadaEn: null, conectadaPor: null });
  almacen.guardar('conexion_gmail', documento());
  ultimoIntento = null;
}

function resumen() {
  const doc = documento();
  return {
    conexion: doc.token ? { cuenta: doc.cuenta, conectadaEn: doc.conectadaEn, conectadaPor: doc.conectadaPor } : null,
    ultimoIntento,
  };
}

module.exports = { leer, iniciar, completar, desconectar, resumen, direccionDeRegreso, cuentaDelIdToken, RUTA_DE_REGRESO };
