// La biblioteca trabaja en hora de Guatemala: los horarios, las reservas y la entrega de solvencias dependen de ella.
// Si el servidor donde se instale usa otra zona (casi todos usan UTC), así igual se calculan bien.
process.env.TZ = process.env.TZ || 'America/Guatemala';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

// Los ajustes locales, como las claves del panel del personal, viven en backend/.env (no se sube a git; el modelo
// es backend/.env.example). Si el archivo no existe se usa el entorno tal cual, y lo que ya venga definido en el
// entorno tiene prioridad sobre el archivo. Debe cargarse antes que el resto del código, que lee esas variables.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const express = require('express');
const cors = require('cors');

const almacen = require('./utils/almacen');
const { descripcionDelCorreo, comprobarAlArrancar } = require('./utils/correo');
const { mantenerDespierto } = require('./utils/mantenerDespierto');
const { limitar, soloEscrituras, dentroDelLimite } = require('./utils/limitador');
const { fail } = require('./utils/httpResponse');
const { crearComprobadorDeDirecciones } = require('./utils/redes');
const { RUTA_DEL_PANEL } = require('./utils/rutas');

// Las direcciones se comparan sin importar mayúsculas, porque el navegador y el servidor las resuelven igual (/PrivateAccess y
// /privateaccess llevan al mismo panel): si no, una letra en mayúscula esquivaría el candado de los kioscos.
const empiezaCon = (ruta, base) => {
  const minuscula = ruta.toLowerCase();
  return minuscula === base.toLowerCase() || minuscula.startsWith(`${base.toLowerCase()}/`);
};
const esDelPanel = (ruta) => empiezaCon(ruta, RUTA_DEL_PANEL);
const esApiDelPersonal = (ruta) => empiezaCon(ruta, '/api/admin') || empiezaCon(ruta, '/api/auth');

// Política de contenido (CSP): le dice al navegador de dónde puede cargar cosas una página del sitio. Si alguien lograra colar un
// script en una página (en un título, en una URL...), el navegador no lo ejecuta: solo corren los scripts que sirve este servidor.
// Lo que se permite es lo que el sitio usa de verdad; si se agrega algo de otro origen (un mapa, un video), hay que sumarlo aquí.
// CSP=0 la apaga (por si un navegador viejo diera problemas).
const POLITICA_DE_CONTENIDO = [
  "default-src 'self'",
  "script-src 'self'", // ni scripts en línea ni de otros sitios
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", // React pone estilos en línea (tamaños, posiciones); las tipografías son de Google Fonts
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://i.ytimg.com", // las miniaturas de YouTube en el editor de «Cómo hacer tu solvencia»
  "connect-src 'self'", // el sitio solo habla con este servidor
  "frame-src 'self' https: http:", // el visor muestra el documento de la tesis, que puede estar en cualquier sitio
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'", // ningún otro sitio puede mostrar este dentro de un marco
].join('; ');

// HSTS: una vez que el navegador entró por HTTPS, durante este tiempo no acepta volver a HTTP (seis meses). HSTS=0 lo apaga.
const SEGUNDOS_DE_HSTS = 180 * 24 * 60 * 60;

// La aplicación se arma dentro de una función porque los módulos de datos leen lo guardado en cuanto se cargan: hay que cargarlos
// después de iniciar el almacén (con una base de datos, iniciarlo toma un momento y es asíncrono).
function crearApp() {
  const catalogRoutes = require('./src/catalog/catalog_routes');
  const { getEnlaceCorto } = require('./src/catalog/catalog_controller');
  const reservasRoutes = require('./src/reservas/reservas_routes');
  const solvenciaRoutes = require('./src/solvencia/solvencia_routes');
  const adminRoutes = require('./src/admin/admin_routes');
  const eventosRoutes = require('./src/eventos/eventos_routes');
  const authRoutes = require('./src/auth/auth_routes');
  const comprobantesRoutes = require('./src/comprobantes/comprobantes_routes');
  const horariosRoutes = require('./src/horarios/horarios_routes');

  const app = express();
  app.disable('x-powered-by');

  // Detrás de un proxy (nginx, un servicio en la nube) hay que indicarlo para que los límites de uso cuenten a cada
  // persona y no al proxy. TRUST_PROXY puede ser un número (cuántos proxys hay) o una dirección.
  if (process.env.TRUST_PROXY) {
    app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
  }

  const conPolitica = !['0', 'false', 'no'].includes(String(process.env.CSP ?? '').trim().toLowerCase());
  const conHsts = !['0', 'false', 'no'].includes(String(process.env.HSTS ?? '').trim().toLowerCase());
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN'); // ningún otro sitio puede mostrar este dentro de un marco (clickjacking)
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // La política va en las páginas del sitio, no en la API: sus respuestas no son páginas, y el visor de PDF del navegador no
    // muestra un documento que llegue con una política propia.
    if (conPolitica && !empiezaCon(req.path, '/api') && req.path !== '/health') res.set('Content-Security-Policy', POLITICA_DE_CONTENIDO);
    // Solo cuando la visita llegó por HTTPS (detrás de un proxy, eso se sabe con TRUST_PROXY): mandarla por HTTP no sirve, y a una
    // instalación sin HTTPS la dejaría sin acceso.
    if (conHsts && req.secure) res.set('Strict-Transport-Security', `max-age=${SEGUNDOS_DE_HSTS}`);
    next();
  });

  // Lo que es del personal no se indexa ni se guarda en cachés: el panel (RUTA_DEL_PANEL) y la API no deben aparecer en buscadores, y las
  // respuestas de la sesión y de la API del personal (o de cualquier petición con ficha de acceso) llevan datos de personas que no deben
  // quedar guardados.
  app.use((req, res, next) => {
    if (esDelPanel(req.path) || empiezaCon(req.path, '/api')) res.set('X-Robots-Tag', 'noindex, nofollow');
    if (esApiDelPersonal(req.path) || req.get('Authorization')) res.set('Cache-Control', 'no-store');
    next();
  });

  // Candado de red para los kioscos: las computadoras del público no deben poder llegar al panel del personal, aunque alguien
  // escriba la dirección a mano. Con KIOSCOS_IP (direcciones o rangos separados por coma) a esos equipos se les niega la entrada
  // al panel (RUTA_DEL_PANEL), a su API (/api/admin) y al inicio de sesión del personal (/api/auth). El resto del sitio funciona igual.
  // Detrás de un proxy hay que indicar TRUST_PROXY para que la dirección sea la del equipo y no la del proxy.
  const esKiosco = crearComprobadorDeDirecciones(process.env.KIOSCOS_IP);
  if (esKiosco.hayLista) {
    app.use((req, res, next) => {
      if (!esKiosco(req.ip)) return next();
      if (esDelPanel(req.path)) return res.redirect('/');
      if (esApiDelPersonal(req.path)) {
        return fail(res, 'Este equipo no tiene acceso al panel del personal', 403);
      }
      return next();
    });
  }

  // CORS: con CORS_ORIGIN (una o varias direcciones separadas por coma) solo esos sitios pueden usar la API desde un
  // navegador. Si el frontend se sirve desde este mismo servidor no hace falta. Sin la variable se acepta cualquier origen,
  // que es cómodo para desarrollar pero no para publicar.
  const origenesPermitidos = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors(origenesPermitidos.length > 0 ? { origin: origenesPermitidos } : undefined));

  // La importación del catálogo trae miles de filas, y una solicitud de solvencia trae dos fotos (de hasta 1 MB cada una, en base64):
  // son las únicas peticiones que pueden ser grandes.
  app.use('/api/admin/catalogo/importar', express.json({ limit: '8mb' }));
  app.post('/api/solvencia', express.json({ limit: '3mb' }));
  app.use(express.json({ limit: '100kb' }));

  // Límites de uso: evitan que un programa llene la biblioteca de reservas o solicitudes falsas. Solo cuentan las
  // peticiones que escriben datos; consultar es libre.
  // Cada servicio lleva su propia cuenta. LIMITE_ESCRITURAS cambia cuántas se permiten por minuto (30 por defecto).
  const porMinuto = Number(process.env.LIMITE_ESCRITURAS) || 30;
  app.use('/api/auth/login', soloEscrituras(limitar({ ventanaMs: 5 * 60 * 1000, maximo: 30, mensaje: 'Demasiados intentos de inicio de sesión. Espera unos minutos.' })));
  app.use('/api/reservas', soloEscrituras(limitar({ maximo: porMinuto })));
  app.use('/api/solvencia', soloEscrituras(limitar({ maximo: porMinuto })));
  app.use('/api/comprobantes', soloEscrituras(limitar({ maximo: Math.max(Math.floor(porMinuto / 3), 1) }))); // cada una manda un correo
  app.use('/api/eventos', soloEscrituras(limitar({ maximo: porMinuto * 4 })));

  app.get('/health', (req, res) => res.json({ success: true, data: 'ok' }));

  app.use('/api/tesis', catalogRoutes);
  app.use('/api/reservas', reservasRoutes);
  app.use('/api/solvencia', solvenciaRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/eventos', eventosRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/comprobantes', comprobantesRoutes);
  app.use('/api', horariosRoutes);

  app.use('/api', (req, res) => fail(res, 'Ruta no encontrada', 404));

  // Enlace corto de los códigos QR: /r/<código de la tesis> abre su URL (ver getEnlaceCorto). Nunca se niega, pero una misma
  // dirección que lo pida sin parar deja de sumar escaneos a las estadísticas.
  const cabeEnElLimite = dentroDelLimite({ maximo: porMinuto * 4 });
  app.get('/r/:id', (req, res) => getEnlaceCorto(req, res, { contar: cabeEnElLimite(req) }));

  // Para publicar, el mismo servidor entrega el sitio ya compilado (frontend/dist). Se activa con NODE_ENV=production
  // o SERVE_FRONTEND=1, siempre que exista esa carpeta (se genera con "npm run build" dentro de frontend).
  const carpetaDelSitio = path.join(__dirname, '..', 'frontend', 'dist');
  if ((process.env.NODE_ENV === 'production' || process.env.SERVE_FRONTEND === '1') && fs.existsSync(carpetaDelSitio)) {
    app.use(
      express.static(carpetaDelSitio, {
        index: false,
        setHeaders: (res, archivo) => {
          // Los archivos de /assets llevan su huella en el nombre: pueden guardarse un año. El resto se revisa siempre.
          res.set('Cache-Control', archivo.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache');
        },
      })
    );
    // Cualquier otra dirección es una página del sitio: la resuelve el navegador (React Router). Una dirección con extensión
    // (/logo.png, /favicon.ico) es un archivo que no existe, no una página: esa se responde como no encontrada.
    app.get(/^(?!\/health).*/, (req, res) => {
      if (path.extname(req.path)) return fail(res, 'Ruta no encontrada', 404);
      res.set('Cache-Control', 'no-cache');
      return res.sendFile(path.join(carpetaDelSitio, 'index.html'));
    });
  }

  app.use((req, res) => fail(res, 'Ruta no encontrada', 404));

  // Errores que no se previeron: el cuerpo mal formado o demasiado grande se explica; el resto se anota en la consola
  // del servidor y a la persona solo se le dice que algo falló.
  app.use((error, req, res, next) => {
    if (error.type === 'entity.parse.failed') return fail(res, 'El cuerpo de la petición no es JSON válido', 400);
    if (error.type === 'entity.too.large') return fail(res, 'La petición es demasiado grande', 413);
    console.error(error);
    return fail(res, 'Ocurrió un error en el servidor', 500);
  });

  return app;
}

// Una cuenta sin clave definida recibe una clave temporal; se muestra aquí, en la consola, y en ningún otro lado.
function avisarClavesTemporales() {
  const { retirarClavesTemporales, restablecimiento } = require('./src/auth/cuentas_data');
  const { pedido, usuarios } = restablecimiento();
  if (pedido) {
    console.warn(
      `\n[panel del personal] RESTABLECER_CLAVES está activa: ${usuarios.length > 0 ? `se restableció la clave de ${usuarios.join(', ')}` : 'ninguna clave cambió'}.` +
        ' Quita esa variable ahora: mientras siga puesta, cada reinicio vuelve a poner las claves de CLAVE_* sobre las que se cambien en el panel.\n'
    );
  }
  const temporales = retirarClavesTemporales();
  if (temporales.length === 0) return;
  console.warn('\n[panel del personal] Hay cuentas sin clave definida: usan una clave temporal, válida hasta que se reinicie el servidor.');
  temporales.forEach(({ usuario, variable, clave }) => {
    console.warn(`  ${usuario.padEnd(12)} ${clave}   (para fijarla: ${variable} en backend/.env)`);
  });
  console.warn('  Copia backend/.env.example como backend/.env y escribe tus claves para que no cambien.\n');
}

// Mientras el servidor espera su turno con la base de datos solo responde que está iniciando. /health dice que sí para que la plataforma
// no dé por fallida la publicación mientras la copia anterior termina de apagarse.
function responderMientrasArranca(req, res) {
  const esSalud = req.url.split('?')[0] === '/health';
  res.writeHead(esSalud ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Retry-After': '5' });
  res.end(JSON.stringify(esSalud ? { success: true, data: 'iniciando' } : { success: false, error: 'El servidor se está iniciando. Inténtalo de nuevo en unos segundos.' }));
}

async function arrancar() {
  const puerto = process.env.PORT || 4001;
  let aplicacion = null;
  const servidor = http.createServer((req, res) => (aplicacion ? aplicacion(req, res) : responderMientrasArranca(req, res)));
  const escuchar = () =>
    new Promise((resolver, rechazar) => {
      servidor.once('error', rechazar);
      servidor.listen(puerto, () => {
        servidor.off('error', rechazar);
        resolver();
      });
    });

  // Con una base de datos puede haber que esperar el turno de otra copia del servidor que se está apagando: se abre el puerto desde ya.
  if (almacen.usaBaseDeDatos()) await escuchar();
  await almacen.iniciar({
    esperaDelTurnoMs: Number(process.env.ESPERA_DEL_TURNO_S) * 1000 || undefined,
    alEsperarElTurno: () => console.log('[base de datos] Esperando a que otra copia del servidor termine de apagarse...'),
  });
  aplicacion = crearApp();
  if (!servidor.listening) await escuchar();

  console.log(`Servidor escuchando en el puerto ${puerto}`);
  console.log(`  Zona horaria: ${process.env.TZ} · correo: ${descripcionDelCorreo()} · datos: ${almacen.descripcion()}`);
  avisarClavesTemporales();
  require('./src/respaldo/respaldo_data').iniciar();
  require('./src/catalog/revision_de_enlaces').iniciar();
  require('./src/solvencia/solvencia_data')
    .limpiarFotosResueltas()
    .then((borradas) => borradas > 0 && console.log(`[solvencia] Se borraron las fotos de ${borradas} solicitudes ya resueltas`))
    .catch((error) => console.warn(`[solvencia] No se pudieron revisar las fotos guardadas: ${error.message}`));
  mantenerDespierto();
  comprobarAlArrancar().catch((error) => console.warn(`[correo] No se pudo comprobar el correo: ${error.message}`));
}

if (require.main === module) {
  arrancar().catch((error) => {
    console.error(`No se pudo iniciar el servidor: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { crearApp, arrancar };
