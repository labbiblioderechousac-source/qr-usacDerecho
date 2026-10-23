const correo = require('../../utils/correo');
const conexionGmail = require('../../utils/conexionGmail');
const notificaciones = require('../notificaciones/notificaciones');
const { registrar } = require('../actividad/actividad_data');
const { correoValido } = require('../../utils/codigos');
const { RUTA_DEL_PANEL } = require('../../utils/rutas');
const { ok, fail } = require('../../utils/httpResponse');

// Estado del correo y envío de prueba (solo el administrador). El correo se configura con las variables del servidor (ver
// backend/.env.example); lo único que se hace desde aquí es conectar la cuenta de Gmail (el permiso de Google), para que renovarlo no
// obligue a tocar las variables.

// Una prueba manda un correo de verdad a la dirección que se escriba: se limita para que no sirva para llenar una bandeja.
const ESPERA_ENTRE_PRUEBAS_MS = 5000;
const ultimaPrueba = new Map(); // usuario -> cuándo hizo la última

function getCorreo(req, res) {
  const estado = correo.estado();
  // La dirección de regreso se muestra para copiarla en Google Cloud: tiene que estar autorizada en el cliente «Aplicación web».
  return ok(res, { ...estado, gmail: { ...estado.gmail, direccionDeRegreso: conexionGmail.direccionDeRegreso(req) }, recientes: correo.recientes(20) });
}

const clienteDeGoogle = () => ({
  clienteId: String(process.env.GMAIL_CLIENT_ID || '').trim(),
  clienteSecreto: String(process.env.GMAIL_CLIENT_SECRET || '').trim(),
});

// Desde dónde se abrió el panel, para volver ahí después de Google (en desarrollo, el sitio y el servidor están en puertos distintos).
function origenDelPanel(req) {
  try {
    const origen = new URL(req.get('origin') || `${req.protocol}://${req.get('host')}`);
    return ['http:', 'https:'].includes(origen.protocol) ? origen.origin : '';
  } catch {
    return '';
  }
}

// Paso 1: el panel pide la dirección de Google y lleva ahí a la persona.
function postConectarGmail(req, res) {
  const { clienteId, clienteSecreto } = clienteDeGoogle();
  if (!clienteId || !clienteSecreto) {
    return fail(res, 'Faltan GMAIL_CLIENT_ID y GMAIL_CLIENT_SECRET en las variables del servidor: sin el cliente de Google no se puede conectar.', 409);
  }
  const url = conexionGmail.iniciar({
    clienteId,
    regreso: conexionGmail.direccionDeRegreso(req),
    volverA: `${origenDelPanel(req)}${RUTA_DEL_PANEL}/correo`,
    usuario: req.sesion.usuario,
  });
  return ok(res, { url });
}

// Paso 2: Google trae de vuelta a la persona (sin la sesión del panel, que no viaja en esta visita: el pedido se reconoce por `state`).
// Se guarda la conexión y se vuelve a la sección Correo, que muestra cómo terminó.
async function getVolverDeGmail(req, res) {
  const resultado = await conexionGmail.completar({
    codigo: String(req.query.code ?? ''),
    estado: String(req.query.state ?? ''),
    error: req.query.error ? String(req.query.error) : '',
    ...clienteDeGoogle(),
  });
  if (resultado.ok) {
    registrar({ usuario: resultado.usuario, rol: 'administrador' }, 'correo.gmail', `conectó Gmail${resultado.cuenta ? ` con ${resultado.cuenta}` : ''}`);
    correo.verificar().catch(() => {}); // pide ya el primer token: así se sabe enseguida si la conexión sirve
  }
  return res.redirect(303, `${resultado.volverA || `${RUTA_DEL_PANEL}/correo`}?gmail=${resultado.ok ? 'conectado' : 'error'}`);
}

function postDesconectarGmail(req, res) {
  conexionGmail.desconectar();
  registrar(req.sesion, 'correo.gmail', 'quitó la conexión de Gmail del panel');
  return ok(res, correo.estado(), 'Se quitó la conexión de Gmail del panel');
}

async function postVerificar(req, res) {
  return ok(res, await correo.verificar());
}

async function postPrueba(req, res) {
  const para = String(req.body?.para ?? '').trim();
  if (!correoValido(para)) {
    return fail(res, 'Escribe un correo válido para enviar la prueba');
  }
  const usuario = req.sesion.usuario;
  if (Date.now() - (ultimaPrueba.get(usuario) ?? 0) < ESPERA_ENTRE_PRUEBAS_MS) {
    return fail(res, 'Espera unos segundos antes de enviar otra prueba', 429);
  }
  ultimaPrueba.set(usuario, Date.now());

  try {
    const mensaje = await correo.enviarCorreo({ para, ...notificaciones.mensajeDePrueba({ quien: req.sesion.nombre || usuario }) });
    registrar(req.sesion, 'correo.prueba', `${para}: ${mensaje.simulado ? 'simulado' : `enviado por ${mensaje.via}`}`);
    return ok(
      res,
      { para, simulado: mensaje.simulado, via: mensaje.via },
      mensaje.simulado ? 'Correo simulado: no salió de verdad' : 'Correo de prueba enviado'
    );
  } catch (error) {
    registrar(req.sesion, 'correo.prueba', `${para}: falló`);
    return fail(res, error.message, 502);
  }
}

module.exports = { getCorreo, postVerificar, postPrueba, postConectarGmail, getVolverDeGmail, postDesconectarGmail };
