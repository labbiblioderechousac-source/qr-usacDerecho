// Envío de correos del sistema (comprobantes de reservas y solicitudes, avisos del personal).
//
// Según lo que el servidor tenga configurado (ver backend/.env.example), el correo sale por uno de tres caminos:
//   1. API HTTPS de un servicio de correo. No usa puertos SMTP: sirve en las plataformas que los bloquean (Railway en sus planes
//      Free, Trial y Hobby; Render en los servicios gratuitos). Puede ser:
//        - CORREO_API=gmail: la API de Gmail con una cuenta de Google propia (gratis). Usa GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET y
//          GMAIL_REFRESH_TOKEN; este último lo genera `npm run token-gmail` y no vence (ver README, «Correo con Gmail»). También se
//          puede conectar desde el panel (Correo → «Conectar Gmail», ver conexionGmail.js): esa conexión vale más que
//          GMAIL_REFRESH_TOKEN y, si CORREO_API está vacía, basta para enviar con Gmail.
//        - CORREO_API=brevo o resend, con CORREO_API_KEY.
//   2. SMTP (SMTP_HOST y las que lo acompañan), por ejemplo el de Gmail, Microsoft 365 o el de la propia universidad.
//   3. Simulado: sin nada de lo anterior, los mensajes se arman completos y se guardan en la bandeja, pero no salen. Así todo
//      funciona igual en pruebas y demostraciones sin mandar correos reales.
// El camino se decide en cada envío, así que el administrador puede ver en el panel (Correo) cuál está activo y probarlo.
const biblioteca = require('./biblioteca');
const conexionGmail = require('./conexionGmail');
const { htmlDeTexto } = require('./plantillaCorreo');

const MAXIMO_EN_BANDEJA = 200;
const bandeja = []; // últimos correos (reales, simulados y fallidos), el más reciente primero
let contador = 0;
let ultimoEnvio = null; // { enviadoEn, para, via } del último correo que salió de verdad
let ultimoError = null; // { fecha, para, mensaje } del último que falló

// Un servidor de correo que no responde no debe dejar colgada a la persona que espera su comprobante.
const ESPERA_DE_CONEXION_MS = 8000;
const ESPERA_DE_RESPUESTA_MS = 15000;

const PROVEEDORES_API = {
  brevo: {
    nombre: 'Brevo',
    url: 'https://api.brevo.com/v3/smtp/email',
    peticion: ({ clave, remitente, para, asunto, texto, html, adjuntos }) => ({
      cabeceras: { 'api-key': clave, 'Content-Type': 'application/json', Accept: 'application/json' },
      cuerpo: {
        sender: { name: remitente.nombre, email: remitente.correo },
        to: [{ email: para }],
        subject: asunto,
        textContent: texto,
        htmlContent: html,
        ...(adjuntos.length > 0 ? { attachment: adjuntos.map((a) => ({ name: a.nombre, content: a.contenido.toString('base64') })) } : {}),
      },
    }),
  },
  resend: {
    nombre: 'Resend',
    url: 'https://api.resend.com/emails',
    peticion: ({ clave, remitente, para, asunto, texto, html, adjuntos }) => ({
      cabeceras: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      cuerpo: {
        from: `${remitente.nombre.replace(/["<>,]/g, '')} <${remitente.correo}>`,
        to: [para],
        subject: asunto,
        text: texto,
        html,
        ...(adjuntos.length > 0 ? { attachments: adjuntos.map((a) => ({ filename: a.nombre, content: a.contenido.toString('base64') })) } : {}),
      },
    }),
  },
};

// Gmail no recibe una clave fija: con el refresh token se pide a Google un token de acceso que dura una hora, se guarda en memoria
// y se pide otro un poco antes de que venza. El refresh token no vence mientras la app de Google esté «En producción».
const GMAIL = {
  nombre: 'Gmail',
  urlDelToken: 'https://oauth2.googleapis.com/token',
  urlDeEnvio: 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media',
};
const MARGEN_DEL_TOKEN_MS = 2 * 60 * 1000;
let tokenDeGmail = { huella: '', valor: '', venceEn: 0, cuenta: null };
let gmailAnulado = null; // { fecha, mensaje } si Google dejó de aceptar la conexión: el panel lo muestra en rojo hasta que vuelva a servir

// "Nombre" <correo@dominio> o solo correo@dominio. Devuelve { nombre, correo } o null si no tiene forma de remitente.
function parsearRemitente(texto) {
  const t = String(texto ?? '').trim();
  const conNombre = t.match(/^"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (conNombre) return { nombre: conNombre[1].trim() || biblioteca.nombre, correo: conNombre[2] };
  if (/^[^\s<>@]+@[^\s<>@]+$/.test(t)) return { nombre: biblioteca.nombre, correo: t };
  return null;
}

function booleano(valor) {
  const v = String(valor ?? '').trim().toLowerCase();
  if (['1', 'true', 'si', 'sí'].includes(v)) return true;
  if (['0', 'false', 'no'].includes(v)) return false;
  return null;
}

// Lee la configuración del correo desde las variables de entorno y señala lo que está mal. `modo` es lo que realmente se usará.
function leerConfiguracion() {
  const avisos = [];
  const claveApi = String(process.env.CORREO_API_KEY || '').trim();
  const host = String(process.env.SMTP_HOST || '').trim();
  const puerto = Number(process.env.SMTP_PORT) || 587;
  const usuario = String(process.env.SMTP_USER || '').trim();
  // Al pegar la variable a mano en una plataforma se puede colar la línea siguiente (por una comilla sin cerrar): vale solo la primera.
  const textoRemitente = String(process.env.CORREO_REMITENTE || process.env.SMTP_FROM || '').split(/\r?\n/)[0].trim();
  const clienteId = String(process.env.GMAIL_CLIENT_ID || '').trim();
  const clienteSecreto = String(process.env.GMAIL_CLIENT_SECRET || '').trim();
  const delPanel = conexionGmail.leer({ clienteId, clienteSecreto });
  const gmail = {
    clienteId,
    clienteSecreto,
    refreshToken: delPanel?.refreshToken || String(process.env.GMAIL_REFRESH_TOKEN || '').trim(),
    desdeElPanel: Boolean(delPanel?.refreshToken),
  };
  if (delPanel?.problema) avisos.push(delPanel.problema);
  const api = String(process.env.CORREO_API || '').trim().toLowerCase() || (gmail.desdeElPanel ? 'gmail' : '');
  if (gmail.desdeElPanel && api !== 'gmail') {
    avisos.push(`Gmail está conectado desde el panel, pero CORREO_API vale «${api}»: el correo sale por ese servicio. Déjala vacía o en gmail para usar Gmail.`);
  }

  let modo = 'simulado';
  if (api === 'gmail') {
    const faltan = [['GMAIL_CLIENT_ID', gmail.clienteId], ['GMAIL_CLIENT_SECRET', gmail.clienteSecreto], ['GMAIL_REFRESH_TOKEN', gmail.refreshToken]]
      .filter(([, valor]) => !valor)
      .map(([nombre]) => nombre);
    if (faltan.length === 1 && faltan[0] === 'GMAIL_REFRESH_TOKEN') {
      avisos.push('Gmail no está conectado: pulsa «Conectar Gmail» en el panel (Correo) o genera GMAIL_REFRESH_TOKEN con «npm run token-gmail».');
    } else if (faltan.length > 0) {
      avisos.push(`Para enviar con Gmail falta ${faltan.join(', ')}. Se generan con «npm run token-gmail» (ver README, «Correo con Gmail»).`);
    } else modo = 'api';
  } else if (api) {
    if (!PROVEEDORES_API[api]) avisos.push(`CORREO_API vale «${api}» y no es un servicio conocido: usa gmail, brevo o resend.`);
    else if (!claveApi) avisos.push('Falta CORREO_API_KEY: sin la clave de la API no se puede enviar.');
    else modo = 'api';
  }
  if (modo === 'simulado' && host) modo = 'smtp';

  let remitente = textoRemitente ? parsearRemitente(textoRemitente) : null;
  if (textoRemitente && !remitente) {
    avisos.push('CORREO_REMITENTE no tiene un formato válido. Ejemplo: "Biblioteca Derecho" <biblioteca@ejemplo.edu.gt>');
  }
  if (!remitente && modo === 'smtp') {
    // Muchos servicios de SMTP usan el correo como usuario: si lo parece, también sirve de remitente.
    remitente = parsearRemitente(usuario);
    if (!remitente && !textoRemitente) {
      avisos.push('Falta CORREO_REMITENTE: el usuario de SMTP no es un correo y el servicio exige un remitente verificado.');
    }
  }
  if (!remitente && modo === 'api' && api === 'gmail') {
    // Conectada desde el panel, la cuenta se ve en la tarjeta de Gmail: no hace falta avisarlo.
    if (!gmail.desdeElPanel) avisos.push('Sin un CORREO_REMITENTE válido, el correo sale desde la cuenta de Gmail con la que se generó el token y con el nombre de la biblioteca.');
  } else if (!remitente && modo === 'api' && !textoRemitente) {
    avisos.push('Falta CORREO_REMITENTE: la API solo envía desde un remitente que hayas verificado en el servicio.');
  }
  if (modo === 'simulado' && process.env.NODE_ENV === 'production') {
    avisos.push('El correo está en modo simulado: los comprobantes por correo NO salen. Configura SMTP o una API de correo para que salgan de verdad.');
  }

  const seguro = booleano(process.env.SMTP_SECURE);
  return {
    modo,
    api,
    claveApi,
    host,
    puerto,
    seguro: seguro === null ? puerto === 465 : seguro,
    usuario,
    clave: process.env.SMTP_PASS,
    gmail,
    remitente,
    avisos,
    espera: Number(process.env.CORREO_TIEMPO_MS) || ESPERA_DE_RESPUESTA_MS,
  };
}

let transporteEnUso = { huella: '', objeto: null };

// nodemailer solo se carga si hay SMTP configurado. El transporte se reutiliza mientras no cambie la configuración.
function obtenerTransporte(config) {
  const huella = JSON.stringify([config.host, config.puerto, config.seguro, config.usuario, config.clave, config.espera]);
  if (transporteEnUso.huella === huella) return transporteEnUso.objeto;
  const nodemailer = require('nodemailer');
  transporteEnUso = {
    huella,
    objeto: nodemailer.createTransport({
      host: config.host,
      port: config.puerto,
      secure: config.seguro,
      auth: config.usuario ? { user: config.usuario, pass: config.clave } : undefined,
      connectionTimeout: ESPERA_DE_CONEXION_MS,
      greetingTimeout: ESPERA_DE_CONEXION_MS,
      socketTimeout: config.espera,
    }),
  };
  return transporteEnUso.objeto;
}

const ERRORES_DE_CONEXION = ['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EDNS', 'EHOSTUNREACH', 'ENETUNREACH', 'EAI_AGAIN'];

function recortar(texto, largo = 220) {
  const limpio = String(texto ?? '').replace(/\s+/g, ' ').trim();
  return limpio.length > largo ? `${limpio.slice(0, largo)}…` : limpio;
}

// Convierte el error de nodemailer en una explicación que el administrador entienda y pueda corregir.
function mensajeDeSmtp(error, config) {
  const donde = `${config.host}:${config.puerto}`;
  if (error.code === 'EAUTH') {
    return `El servidor de correo (${donde}) rechazó el usuario o la clave. Revisa SMTP_USER y SMTP_PASS${error.response ? `. Respondió: ${recortar(error.response)}` : ''}`;
  }
  if (ERRORES_DE_CONEXION.includes(error.code)) {
    return `No se pudo conectar con ${donde} (${error.code}). Revisa SMTP_HOST y SMTP_PORT. Si la plataforma bloquea los puertos de correo, usa una API de correo (CORREO_API).`;
  }
  if (error.code === 'EENVELOPE') {
    return `El servidor de correo rechazó la dirección: ${recortar(error.response || error.message)}`;
  }
  if (error.code === 'ETLS' || /wrong version number|ssl|tls/i.test(error.message)) {
    return `No se pudo abrir la conexión segura con ${donde}. Prueba con SMTP_PORT=587 (o 465 con SMTP_SECURE=true). ${recortar(error.message)}`;
  }
  return recortar(error.response || error.message);
}

async function detalleDeRespuesta(respuesta) {
  const texto = await respuesta.text().catch(() => '');
  try {
    const json = JSON.parse(texto);
    return recortar(json.message || json.error?.message || json.error || json.name || texto);
  } catch {
    return recortar(texto);
  }
}

function mensajeDeApi(proveedor, estado, detalle) {
  const cola = detalle ? `: ${detalle}` : '';
  if (estado === 401 || estado === 403) return `${proveedor.nombre} rechazó la clave de la API (CORREO_API_KEY)${cola}`;
  if (estado === 400 || estado === 422) return `${proveedor.nombre} rechazó el mensaje. Casi siempre es porque el remitente no está verificado en el servicio${cola}`;
  if (estado === 429) return `${proveedor.nombre} dice que se alcanzó el límite de envíos${cola}`;
  if (estado >= 500) return `${proveedor.nombre} no está respondiendo bien (error ${estado})${cola}`;
  return `${proveedor.nombre} respondió con el error ${estado}${cola}`;
}

async function enviarPorApi(config, { para, asunto, texto, html, adjuntos }) {
  const proveedor = PROVEEDORES_API[config.api];
  const { cabeceras, cuerpo } = proveedor.peticion({ clave: config.claveApi, remitente: config.remitente, para, asunto, texto, html, adjuntos });
  let respuesta;
  try {
    // CORREO_API_URL existe solo para las pruebas automáticas (apunta a un servidor falso en esta misma computadora).
    respuesta = await fetch(process.env.CORREO_API_URL || proveedor.url, {
      method: 'POST',
      headers: cabeceras,
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(config.espera),
    });
  } catch (error) {
    const causa = error.name === 'TimeoutError' ? 'tardó demasiado en responder' : error.cause?.code || error.message;
    throw new Error(`No se pudo conectar con ${proveedor.nombre} (${causa}). Revisa que el servidor tenga salida a internet.`);
  }
  if (!respuesta.ok) {
    throw new Error(mensajeDeApi(proveedor, respuesta.status, await detalleDeRespuesta(respuesta)));
  }
}

// Gmail envía siempre desde la cuenta del token: si CORREO_REMITENTE falta o está mal escrito, se usa esa cuenta (cuando ya se conoce).
function remitenteEfectivo(config) {
  if (config.remitente || config.modo !== 'api' || config.api !== 'gmail' || !tokenDeGmail.cuenta) return config.remitente;
  return { nombre: biblioteca.nombre, correo: tokenDeGmail.cuenta };
}

function nombreDelServicio(config) {
  return config.api === 'gmail' ? GMAIL.nombre : PROVEEDORES_API[config.api].nombre;
}

const { cuentaDelIdToken } = conexionGmail;

// Pide a Google un token de acceso nuevo con el refresh token (o devuelve el que ya hay si todavía sirve).
const huellaDeGmail = (config) => JSON.stringify([config.gmail.clienteId, config.gmail.clienteSecreto, config.gmail.refreshToken]);

async function tokenDeAccesoDeGmail(config, { renovar = false } = {}) {
  const huella = huellaDeGmail(config);
  if (!renovar && tokenDeGmail.huella === huella && Date.now() < tokenDeGmail.venceEn - MARGEN_DEL_TOKEN_MS) return tokenDeGmail.valor;
  let respuesta;
  try {
    // GMAIL_TOKEN_URL existe solo para las pruebas automáticas, como CORREO_API_URL.
    respuesta = await fetch(process.env.GMAIL_TOKEN_URL || GMAIL.urlDelToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.gmail.clienteId,
        client_secret: config.gmail.clienteSecreto,
        refresh_token: config.gmail.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(config.espera),
    });
  } catch (error) {
    const causa = error.name === 'TimeoutError' ? 'tardó demasiado en responder' : error.cause?.code || error.message;
    throw new Error(`No se pudo conectar con Google (${causa}). Revisa que el servidor tenga salida a internet.`);
  }
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok || !datos.access_token) {
    // Si Google anuló el refresh token o el cliente, también anuló los tokens de acceso que había dado: no se sigue usando el guardado.
    if (['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(datos.error)) tokenDeGmail = { huella: '', valor: '', venceEn: 0, cuenta: null };
    const detalle = recortar(datos.error_description || datos.error || `error ${respuesta.status}`);
    let mensaje = `Google no entregó el token de acceso: ${detalle}`;
    if (datos.error === 'invalid_grant' && config.gmail.desdeElPanel) {
      mensaje =
        `Google ya no acepta la conexión de Gmail hecha desde el panel (${detalle}): alguien quitó el acceso o cambió la contraseña de la ` +
        'cuenta. Vuelve a conectarla con «Conectar Gmail» (Correo).';
    } else if (datos.error === 'invalid_grant') {
      mensaje =
        `Google ya no acepta GMAIL_REFRESH_TOKEN (${detalle}). Conéctalo de nuevo con «Conectar Gmail» en el panel (Correo) o genera uno ` +
        'nuevo con «npm run token-gmail». Si pasa cada 7 días, la app de Google está en modo «Prueba»: en Google Cloud, «Pantalla de ' +
        'consentimiento de OAuth» (Público), pulsa «Publicar app» para que el token no venza.';
    } else if (datos.error === 'invalid_client' || datos.error === 'unauthorized_client') {
      mensaje = `Google rechazó GMAIL_CLIENT_ID o GMAIL_CLIENT_SECRET (${detalle}). Cópialos otra vez desde Google Cloud, «Credenciales».`;
    }
    if (['invalid_grant', 'invalid_client', 'unauthorized_client'].includes(datos.error)) gmailAnulado = { huella, fecha: new Date().toISOString(), mensaje };
    throw new Error(mensaje);
  }
  gmailAnulado = null;
  tokenDeGmail = {
    huella,
    valor: datos.access_token,
    venceEn: Date.now() + (Number(datos.expires_in) || 3600) * 1000,
    cuenta: cuentaDelIdToken(datos.id_token) ?? (tokenDeGmail.huella === huella ? tokenDeGmail.cuenta : null),
  };
  return tokenDeGmail.valor;
}

// Arma el mensaje completo (MIME, con texto, HTML y adjuntos) con nodemailer, sin conectarse a ningún servidor.
async function mensajeMime(config, { para, asunto, texto, html, adjuntos }) {
  const nodemailer = require('nodemailer');
  const armador = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const { message } = await armador.sendMail({
    from: { name: config.remitente.nombre, address: config.remitente.correo },
    to: para,
    subject: asunto,
    text: texto,
    html,
    attachments: adjuntos.map((a) => ({ filename: a.nombre, content: a.contenido, contentType: a.tipo })),
  });
  return message;
}

async function enviarPorGmail(config, mensaje) {
  const cuerpo = await mensajeMime(config, mensaje);
  // Si Google invalida el token de acceso antes de tiempo (401), se pide uno nuevo y se intenta una vez más.
  for (let intento = 0; intento < 2; intento += 1) {
    const token = await tokenDeAccesoDeGmail(config, { renovar: intento > 0 });
    let respuesta;
    try {
      respuesta = await fetch(process.env.CORREO_API_URL || GMAIL.urlDeEnvio, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'message/rfc822' },
        body: cuerpo,
        signal: AbortSignal.timeout(config.espera),
      });
    } catch (error) {
      const causa = error.name === 'TimeoutError' ? 'tardó demasiado en responder' : error.cause?.code || error.message;
      throw new Error(`No se pudo conectar con Gmail (${causa}). Revisa que el servidor tenga salida a internet.`);
    }
    if (respuesta.ok) return;
    if (respuesta.status === 401 && intento === 0) continue;
    const detalle = await detalleDeRespuesta(respuesta);
    if (respuesta.status === 403) {
      throw new Error(
        `Gmail no dejó enviar: ${detalle}. Revisa que la «Gmail API» esté habilitada en el proyecto de Google Cloud y que el token se haya generado con el permiso de enviar correo.`,
      );
    }
    if (respuesta.status === 429) throw new Error(`Gmail dice que se alcanzó el límite de envíos (unos 500 al día en una cuenta gratuita): ${detalle}`);
    throw new Error(mensajeDeApi(GMAIL, respuesta.status, detalle));
  }
}

async function enviarPorSmtp(config, { para, asunto, texto, html, adjuntos }) {
  try {
    await obtenerTransporte(config).sendMail({
      from: { name: config.remitente.nombre, address: config.remitente.correo },
      to: para,
      subject: asunto,
      text: texto,
      html,
      attachments: adjuntos.map((a) => ({ filename: a.nombre, content: a.contenido, contentType: a.tipo })),
    });
  } catch (error) {
    throw new Error(mensajeDeSmtp(error, config));
  }
}

function guardarEnBandeja(registro) {
  bandeja.unshift(registro);
  if (bandeja.length > MAXIMO_EN_BANDEJA) bandeja.length = MAXIMO_EN_BANDEJA;
}

// Envía un correo. `texto` es obligatorio; `html` es opcional (si falta se arma uno sencillo). `tipo` solo sirve para que el
// panel muestre de qué era el correo. `adjuntos` es una lista de { nombre, contenido (Buffer), tipo }. Devuelve el registro con `simulado: true` si no salió de verdad y, si el envío real
// falla, lanza el error (con un mensaje legible): quien llama decide si avisar a la persona o seguir.
async function enviarCorreo({ para, asunto, texto, html, tipo = 'otro', adjuntos = [] }) {
  const config = leerConfiguracion();
  const registro = {
    id: (contador += 1),
    para,
    asunto,
    tipo,
    cuerpo: texto,
    enviadoEn: new Date().toISOString(),
    simulado: config.modo === 'simulado',
    via: config.modo === 'api' ? config.api : config.modo,
    estado: config.modo === 'simulado' ? 'simulado' : 'enviado',
  };
  try {
    if (config.modo === 'api' && config.api === 'gmail' && !config.remitente) {
      await tokenDeAccesoDeGmail(config); // así se conoce la cuenta
      config.remitente = remitenteEfectivo(config);
    }
    if (config.modo !== 'simulado' && !config.remitente) {
      throw new Error('Falta CORREO_REMITENTE: no se sabe desde qué dirección enviar.');
    }
    const mensaje = { para, asunto, texto, html: html ?? htmlDeTexto(texto), adjuntos };
    if (config.modo === 'smtp') await enviarPorSmtp(config, mensaje);
    else if (config.modo === 'api' && config.api === 'gmail') await enviarPorGmail(config, mensaje);
    else if (config.modo === 'api') await enviarPorApi(config, mensaje);
  } catch (error) {
    registro.estado = 'fallido';
    registro.error = error.message;
    ultimoError = { fecha: registro.enviadoEn, para, mensaje: error.message };
    guardarEnBandeja(registro);
    throw error;
  }
  if (!registro.simulado) ultimoEnvio = { enviadoEn: registro.enviadoEn, para, via: registro.via };
  guardarEnBandeja(registro);
  return registro;
}

// Para avisos que no deben detener lo que se estaba haciendo: si el correo falla, se anota en la consola y se sigue.
async function avisarPorCorreo(datos) {
  if (!datos.para) return null;
  try {
    return await enviarCorreo(datos);
  } catch (error) {
    console.error(`No se pudo enviar el correo "${datos.asunto}" a ${datos.para}: ${error.message}`);
    return null;
  }
}

function ocultarUsuario(usuario) {
  const [antes, despues] = String(usuario).split('@');
  const visible = antes.slice(0, 2);
  return despues ? `${visible}***@${despues}` : `${visible}***`;
}

function describir(config) {
  if (config.modo === 'api') return `API de ${nombreDelServicio(config)}`;
  if (config.modo === 'smtp') return `SMTP (${config.host}:${config.puerto})`;
  return 'simulado (no sale ningún correo)';
}

// Lo que el panel muestra del correo. Nunca incluye claves.
function estado() {
  const config = leerConfiguracion();
  return {
    modo: config.modo,
    descripcion: describir(config),
    servidor: config.modo === 'smtp' ? `${config.host}:${config.puerto}` : config.modo === 'api' ? nombreDelServicio(config) : null,
    conexionSegura: config.modo === 'smtp' ? config.seguro : null,
    usuario: config.modo === 'smtp' && config.usuario ? ocultarUsuario(config.usuario) : null,
    // SMTP y Gmail se pueden comprobar sin mandar nada; Brevo y Resend no.
    verificable: config.modo === 'smtp' || (config.modo === 'api' && config.api === 'gmail'),
    remitente: remitenteEfectivo(config) ? `${remitenteEfectivo(config).nombre} <${remitenteEfectivo(config).correo}>` : null,
    avisos: config.avisos,
    ultimoEnvio,
    ultimoError,
    // Para el botón «Conectar Gmail»: si se puede (hace falta el cliente de Google en las variables), de dónde sale la conexión en uso
    // y si Google la anuló (solo si es la misma que sigue configurada: una conexión nueva no hereda el aviso de la anterior).
    gmail: {
      puedeConectar: Boolean(config.gmail.clienteId && config.gmail.clienteSecreto),
      enUso: config.modo === 'api' && config.api === 'gmail',
      origen: config.gmail.desdeElPanel ? 'panel' : config.gmail.refreshToken ? 'variables' : null,
      cuenta: config.api === 'gmail' && tokenDeGmail.huella === huellaDeGmail(config) ? tokenDeGmail.cuenta : null,
      anulada: gmailAnulado && gmailAnulado.huella === huellaDeGmail(config) ? { fecha: gmailAnulado.fecha, mensaje: gmailAnulado.mensaje } : null,
      ...conexionGmail.resumen(),
    },
  };
}

// Los últimos correos, sin su contenido (que lleva nombres y carnés de las personas), para la tabla del panel.
function recientes(limite = 20) {
  return bandeja.slice(0, limite).map(({ id, para, asunto, tipo, enviadoEn, estado: situacion, via, error }) => ({
    id,
    para,
    asunto,
    tipo,
    enviadoEn,
    estado: situacion,
    via,
    ...(error ? { error } : {}),
  }));
}

// Comprueba la conexión y las credenciales sin mandar ningún correo. SMTP abre la conexión; Gmail pide un token de acceso con el
// refresh token. Brevo y Resend no tienen una comprobación así: ahí sirve el correo de prueba.
async function verificar() {
  const config = leerConfiguracion();
  if (config.modo === 'simulado') {
    return { ok: false, mensaje: 'El correo está en modo simulado: no hay conexión que comprobar.' };
  }
  if (config.modo === 'api' && config.api === 'gmail') {
    try {
      await tokenDeAccesoDeGmail(config, { renovar: true });
    } catch (error) {
      return { ok: false, mensaje: error.message };
    }
    const cuenta = tokenDeGmail.cuenta;
    const remitente = config.remitente?.correo;
    if (cuenta && remitente && cuenta.toLowerCase() !== remitente.toLowerCase()) {
      return {
        ok: true,
        mensaje: `Google aceptó las credenciales de ${cuenta}, pero CORREO_REMITENTE es ${remitente}: Gmail enviará como ${cuenta} salvo que ${remitente} sea un alias de esa cuenta.`,
      };
    }
    return { ok: true, mensaje: `Google aceptó las credenciales${cuenta ? ` de ${cuenta}` : ''}: el correo puede salir por Gmail.` };
  }
  if (config.modo === 'api') {
    return { ok: null, mensaje: `Con la API de ${PROVEEDORES_API[config.api].nombre} no se puede comprobar sin enviar: usa «Enviar correo de prueba».` };
  }
  try {
    await obtenerTransporte(config).verify();
    const donde = `${config.host}:${config.puerto}`;
    return { ok: true, mensaje: config.usuario ? `Conexión con ${donde} y credenciales correctas.` : `Conexión con ${donde} correcta (el servidor no pide usuario).` };
  } catch (error) {
    return { ok: false, mensaje: mensajeDeSmtp(error, config) };
  }
}

// Al arrancar: dice en la consola cómo quedó el correo y, si es SMTP o Gmail, comprueba las credenciales sin detener el arranque.
async function comprobarAlArrancar() {
  const config = leerConfiguracion();
  config.avisos.forEach((aviso) => console.warn(`[correo] ${aviso}`));
  if (config.modo !== 'smtp' && !(config.modo === 'api' && config.api === 'gmail')) return;
  const resultado = await verificar();
  if (resultado.ok) console.log(`[correo] ${resultado.mensaje}`);
  else console.warn(`[correo] No se pudo verificar la conexión: ${resultado.mensaje}`);
}

function descripcionDelCorreo() {
  return describir(leerConfiguracion());
}

module.exports = {
  enviarCorreo,
  avisarPorCorreo,
  descripcionDelCorreo,
  comprobarAlArrancar,
  estado,
  recientes,
  verificar,
};
