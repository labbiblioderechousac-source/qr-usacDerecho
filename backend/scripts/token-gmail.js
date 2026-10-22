// Genera el GMAIL_REFRESH_TOKEN para que la biblioteca envíe correos con la API de Gmail (gratis, sin puertos SMTP).
//
//   npm run token-gmail                                   usa GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET de backend/.env
//   npm run token-gmail -- client_secret_XXXX.json        o los toma del archivo JSON que descargas de Google Cloud
//
// Abre el navegador para que entres con la cuenta de Gmail que enviará los correos y aceptes el permiso de «enviar correo en tu
// nombre». Google responde a este mismo equipo (http://127.0.0.1), el script cambia esa respuesta por el refresh token y lo escribe
// en backend/.env junto con CORREO_API=gmail. Al final muestra las variables para copiarlas en Render (o donde se publique).
//
// El refresh token NO vence mientras la app de Google esté «En producción» (Google Cloud > Pantalla de consentimiento de OAuth >
// Público > Publicar app). En modo «Prueba» Google lo anula a los 7 días. Los pasos completos están en el README, «Correo con Gmail».
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const RUTA_ENV = path.join(__dirname, '..', '.env');
try {
  process.loadEnvFile(RUTA_ENV);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

// gmail.send solo deja enviar (no leer el buzón). openid y email sirven para saber con qué cuenta se entró.
const PERMISOS = ['https://www.googleapis.com/auth/gmail.send', 'openid', 'email'];
const URL_DE_AUTORIZACION = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_DEL_TOKEN = 'https://oauth2.googleapis.com/token';
const ESPERA_MS = 5 * 60 * 1000;

function leerCliente(archivo) {
  if (archivo) {
    const json = JSON.parse(fs.readFileSync(archivo, 'utf8'));
    const datos = json.installed || json.web;
    if (!datos?.client_id || !datos?.client_secret) throw new Error(`${archivo} no parece el JSON de un cliente de OAuth de Google.`);
    if (json.web) {
      console.warn('Ojo: ese cliente es de tipo «Aplicación web». Si Google responde «redirect_uri_mismatch», crea uno de tipo «App de escritorio».\n');
    }
    return { id: datos.client_id, secreto: datos.client_secret };
  }
  const id = String(process.env.GMAIL_CLIENT_ID || '').trim();
  const secreto = String(process.env.GMAIL_CLIENT_SECRET || '').trim();
  if (!id || !secreto) {
    throw new Error(
      'Faltan GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET. Escríbelos en backend/.env o pasa el JSON descargado de Google Cloud:\n' +
        '  npm run token-gmail -- ruta/al/client_secret_XXXX.json',
    );
  }
  return { id, secreto };
}

function abrirNavegador(url) {
  const [programa, argumentos] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(programa, argumentos, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    /* si no se puede abrir, la persona copia el enlace */
  }
}

// Abre un servidor en http://127.0.0.1:<puerto libre> que recibe la respuesta de Google. Devuelve esa dirección (la redirección que
// se le da a Google) y una promesa con el código de autorización.
async function escucharRespuesta(estado) {
  let resolver;
  let rechazar;
  const codigo = new Promise((resolve, reject) => {
    resolver = resolve;
    rechazar = reject;
  });
  const servidor = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname !== '/') {
      res.writeHead(404).end();
      return;
    }
    const terminar = (ok, mensaje) => {
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><title>Biblioteca</title><body style="font-family:sans-serif;padding:2rem"><h2>${ok ? 'Listo' : 'No se pudo'}</h2><p>${mensaje}</p></body>`);
      clearTimeout(reloj);
      servidor.close();
    };
    if (url.searchParams.get('error')) {
      terminar(false, 'Google no dio el permiso. Vuelve a la consola para ver qué pasó.');
      rechazar(new Error(`Google respondió «${url.searchParams.get('error')}» (¿cancelaste, o tu cuenta no está entre los usuarios de prueba?).`));
    } else if (url.searchParams.get('state') !== estado || !url.searchParams.get('code')) {
      terminar(false, 'La respuesta no corresponde a esta solicitud.');
      rechazar(new Error('La respuesta de Google no corresponde a esta solicitud. Vuelve a correr el script.'));
    } else {
      terminar(true, 'Ya puedes cerrar esta pestaña y volver a la consola.');
      resolver(url.searchParams.get('code'));
    }
  });
  const reloj = setTimeout(() => {
    servidor.close();
    rechazar(new Error('Pasaron 5 minutos sin respuesta de Google. Vuelve a correr el script.'));
  }, ESPERA_MS);
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  return { redireccion: `http://127.0.0.1:${servidor.address().port}`, codigo };
}

function cuentaDelIdToken(idToken) {
  try {
    return JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64url').toString('utf8')).email || null;
  } catch {
    return null;
  }
}

// Escribe (o reemplaza) las variables en backend/.env sin tocar las demás líneas.
function guardarEnEnv(variables) {
  let texto = fs.existsSync(RUTA_ENV) ? fs.readFileSync(RUTA_ENV, 'utf8') : '';
  const salto = texto.includes('\r\n') ? '\r\n' : '\n';
  for (const [nombre, valor] of Object.entries(variables)) {
    const linea = `${nombre}=${/[\s"'#]/.test(valor) ? `'${valor}'` : valor}`;
    const patron = new RegExp(`^\\s*${nombre}\\s*=.*$`, 'm');
    if (patron.test(texto)) texto = texto.replace(patron, () => linea);
    else texto = `${texto}${texto && !texto.endsWith('\n') ? salto : ''}${linea}${salto}`;
  }
  fs.writeFileSync(RUTA_ENV, texto);
}

async function principal() {
  const archivo = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const cliente = leerCliente(archivo);

  const estado = crypto.randomBytes(16).toString('hex');
  const verificador = crypto.randomBytes(32).toString('base64url');
  const desafio = crypto.createHash('sha256').update(verificador).digest('base64url');

  const { redireccion, codigo: respuestaDeGoogle } = await escucharRespuesta(estado);
  const enlace = `${URL_DE_AUTORIZACION}?${new URLSearchParams({
    client_id: cliente.id,
    redirect_uri: redireccion,
    response_type: 'code',
    scope: PERMISOS.join(' '),
    access_type: 'offline', // pide el refresh token
    prompt: 'consent', // y que lo entregue aunque ya se haya dado permiso antes
    state: estado,
    code_challenge: desafio,
    code_challenge_method: 'S256',
  })}`;

  console.log('Abre este enlace (se intenta abrir solo), entra con la cuenta de Gmail que enviará los correos y acepta:\n');
  console.log(`  ${enlace}\n`);
  console.log('Si Google dice «Google no verificó esta app», pulsa «Avanzado» > «Ir a ... (no seguro)»: es tu propia app.\n');
  abrirNavegador(enlace);

  const codigo = await respuestaDeGoogle;
  const respuesta = await fetch(URL_DEL_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: codigo,
      client_id: cliente.id,
      client_secret: cliente.secreto,
      redirect_uri: redireccion,
      grant_type: 'authorization_code',
      code_verifier: verificador,
    }),
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(`Google no entregó el token: ${datos.error_description || datos.error || respuesta.status}`);
  if (!datos.refresh_token) {
    throw new Error('Google no entregó un refresh token. Quita el acceso de la app en https://myaccount.google.com/permissions y vuelve a correr el script.');
  }
  if (!String(datos.scope || '').includes('gmail.send')) {
    throw new Error('No se aceptó el permiso de enviar correo. Vuelve a correr el script y marca la casilla de Gmail.');
  }

  const cuenta = cuentaDelIdToken(datos.id_token);
  const variables = {
    CORREO_API: 'gmail',
    GMAIL_CLIENT_ID: cliente.id,
    GMAIL_CLIENT_SECRET: cliente.secreto,
    GMAIL_REFRESH_TOKEN: datos.refresh_token,
  };
  if (cuenta && !process.env.CORREO_REMITENTE) variables.CORREO_REMITENTE = `"Biblioteca" <${cuenta}>`;
  guardarEnEnv(variables);

  console.log(`Listo${cuenta ? `: los correos saldrán desde ${cuenta}` : ''}. Se guardó en backend/.env:\n`);
  for (const [nombre, valor] of Object.entries(variables)) console.log(`  ${nombre}=${valor}`);
  if (!variables.CORREO_REMITENTE && !process.env.CORREO_REMITENTE) {
    console.log('  CORREO_REMITENTE="Biblioteca" <la-cuenta@gmail.com>   (escríbela tú: la misma cuenta con la que entraste)');
  }
  console.log('\nPara la versión publicada (Render > Environment), copia esas mismas variables y reinicia el servicio.');
  console.log('Recuerda: si la app de Google sigue en modo «Prueba», el token vence a los 7 días. Publícala para que no venza.');
}

principal().catch((error) => {
  console.error(`\n${error.message}`);
  process.exit(1);
});
