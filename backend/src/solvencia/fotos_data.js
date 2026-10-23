const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const almacen = require('../../utils/almacen');
const base = require('../../utils/postgres');
const { rechazo } = require('../../utils/errores');

// Fotos de una solicitud de solvencia: el comprobante (boleta de depósito) y la orden de pago.
//
// La persona las sube con el formulario, ya comprimidas por el navegador (unos 1600 px de ancho, 200 a 300 KB). Mientras la solicitud
// está pendiente viven en la base de datos (tabla `biblioteca.fotos_solvencia`), o en la carpeta de datos si el servidor trabaja con
// archivos, para que el administrador las vea en el panel. Al aprobar o rechazar, el panel las guarda en la PC de la biblioteca
// (C:\solvencias\comprobante y C:\solvencias\orden_de_pago) y aquí se borran: la base de datos solo guarda las pendientes. En la
// solicitud quedan para siempre el nombre del archivo, su hash (para detectar un comprobante repetido) y la fecha de subida.

const TIPOS = { comprobante: 'Comprobante de pago', orden_de_pago: 'Orden de pago' };
const CON_ARTICULO = { comprobante: 'del comprobante de pago', orden_de_pago: 'de la orden de pago' };

const MAXIMO_BYTES = 1024 * 1024; // el navegador las deja en 200 a 300 KB: 1 MB es el tope para una foto que no se pudo comprimir
const MINIMO_BYTES = 1024; // menos que esto no es una foto legible

// Se reconoce el tipo por el contenido del archivo, no por su nombre ni por lo que diga el navegador.
const FORMATOS = [
  { mime: 'image/jpeg', extension: 'jpg', es: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', extension: 'png', es: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', extension: 'webp', es: (b) => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];

const formatoDe = (contenido) => FORMATOS.find((f) => f.es(contenido)) ?? null;

// Llega como data URL («data:image/webp;base64,...») o como base64 sin más.
function leerFoto(valor, tipo) {
  const nombre = TIPOS[tipo];
  if (typeof valor !== 'string' || !valor) throw rechazo(`Falta la foto ${CON_ARTICULO[tipo]}`);
  const texto = valor.replace(/^data:[^,]{0,100};base64,/, '');
  if (texto.length > Math.ceil((MAXIMO_BYTES * 4) / 3) + 4) throw rechazo(`${nombre}: la foto pesa más de 1 MB. Toma la foto de nuevo o usa otra imagen`);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(texto)) throw rechazo(`${nombre}: el archivo no es una imagen válida`);
  const contenido = Buffer.from(texto, 'base64');
  if (contenido.length < MINIMO_BYTES) throw rechazo(`${nombre}: la imagen está vacía o es demasiado pequeña para leerse`);
  if (contenido.length > MAXIMO_BYTES) throw rechazo(`${nombre}: la foto pesa más de 1 MB. Toma la foto de nuevo o usa otra imagen`);
  const formato = formatoDe(contenido);
  if (!formato) throw rechazo(`${nombre}: solo se aceptan fotos JPG, PNG o WebP`);
  return { tipo, mime: formato.mime, extension: formato.extension, contenido, hash: crypto.createHash('sha256').update(contenido).digest('hex') };
}

// Las dos fotos de una solicitud. Con `obligatorias` (desde la web) tienen que venir las dos; si no (desde un kiosco, donde no hay
// cámara), pueden faltar las dos, pero no una sola.
function leerFotos(fotos, { obligatorias }) {
  const recibidas = fotos && typeof fotos === 'object' ? fotos : {};
  const tipos = Object.keys(TIPOS);
  if (!obligatorias && tipos.every((tipo) => !recibidas[tipo])) return null;
  return Object.fromEntries(tipos.map((tipo) => [tipo, leerFoto(recibidas[tipo], tipo)]));
}

// "María José López" -> "Maria_Jose_Lopez": sin tildes, sin ñ, sin espacios ni signos, para que el nombre del archivo sirva en cualquier
// sistema.
function sinTildes(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Nombre + carné + fecha de subida: Maria_Lopez_202312345_2026-10-22.webp. Así se reconoce de quién es y no choca con el de otra
// persona con el mismo nombre (el comprobante y la orden van en carpetas distintas, por eso pueden llamarse igual).
function nombreDeArchivo({ solicitante, identificacion, fecha }, extension) {
  return `${sinTildes(solicitante) || 'Solicitante'}_${sinTildes(identificacion) || 'sin_carne'}_${fecha}.${extension}`;
}

// --- Dónde viven mientras están pendientes ----------------------------------------------------------------------------

const carpetaLocal = () => path.join(almacen.carpeta(), 'fotos-solvencia');
const archivoLocal = (solicitud, tipo) => path.join(carpetaLocal(), `${solicitud}-${tipo}`);

async function guardar(solicitud, fotos) {
  for (const foto of Object.values(fotos)) {
    if (almacen.usaBaseDeDatos()) {
      await almacen.enLaCola(() => base.guardarFoto({ solicitud, tipo: foto.tipo, mime: foto.mime, hash: foto.hash, contenido: foto.contenido }));
    } else {
      fs.mkdirSync(carpetaLocal(), { recursive: true });
      fs.writeFileSync(archivoLocal(solicitud, foto.tipo), foto.contenido);
    }
  }
}

// { mime, contenido } o null si ya no está (la solicitud se resolvió).
async function leer(solicitud, tipo) {
  if (!TIPOS[tipo]) return null;
  if (almacen.usaBaseDeDatos()) return almacen.enLaCola(() => base.leerFoto(solicitud, tipo));
  try {
    const contenido = fs.readFileSync(archivoLocal(solicitud, tipo));
    return { mime: formatoDe(contenido)?.mime ?? 'application/octet-stream', contenido };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function borrar(solicitud) {
  if (almacen.usaBaseDeDatos()) {
    await almacen.enLaCola(() => base.borrarFotos(solicitud));
    return;
  }
  Object.keys(TIPOS).forEach((tipo) => fs.rmSync(archivoLocal(solicitud, tipo), { force: true }));
}

// Si el servidor se apagó justo después de resolver una solicitud, sus fotos pudieron quedar guardadas: al arrancar se borran las de
// las solicitudes que ya no están pendientes (o que no existen).
async function limpiarResueltas(idsPendientes) {
  const pendientes = new Set(idsPendientes);
  let ids;
  if (almacen.usaBaseDeDatos()) {
    ids = await almacen.enLaCola(() => base.solicitudesConFotos());
  } else {
    try {
      ids = [...new Set(fs.readdirSync(carpetaLocal()).map((nombre) => nombre.replace(/-(comprobante|orden_de_pago)$/, '')))];
    } catch {
      ids = [];
    }
  }
  const sobrantes = ids.filter((id) => !pendientes.has(id));
  for (const id of sobrantes) await borrar(id);
  return sobrantes.length;
}

// Cuántas fotos esperan revisión y cuánto ocupan.
async function resumen() {
  if (almacen.usaBaseDeDatos()) return almacen.enLaCola(() => base.resumenDeFotos());
  try {
    const nombres = fs.readdirSync(carpetaLocal());
    return { fotos: nombres.length, bytes: nombres.reduce((suma, nombre) => suma + fs.statSync(path.join(carpetaLocal(), nombre)).size, 0) };
  } catch {
    return { fotos: 0, bytes: 0 };
  }
}

module.exports = { TIPOS, MAXIMO_BYTES, leerFotos, nombreDeArchivo, sinTildes, guardar, leer, borrar, limpiarResueltas, resumen };
