const almacen = require('../../utils/almacen');
const { rechazo } = require('../../utils/errores');

// La página «Cómo hacer tu solvencia» del sitio y del kiosco: los videos y los pasos. Arrancan con lo que la biblioteca publica en su
// sitio (sección Solvencias) y el administrador los cambia desde el panel, sin tocar el código: pegar el enlace de otro video de YouTube,
// cambiar el texto de un paso, agregar, quitar o reordenar. Siempre se puede volver a los originales.

const MAXIMO_DE_VIDEOS = 4;
const MAXIMO_DE_PASOS = 12;

const ORIGINAL = {
  videos: [
    { id: 'HaVEv74BTS4', titulo: 'Presentación del servicio de solvencias' },
    { id: 'PMQuj1tNq0s', titulo: 'Tutorial: cómo hacer tu solvencia' },
  ],
  pasos: [
    { titulo: 'Genera la orden de pago', texto: 'Entra a SIIF USAC (siif.usac.edu.gt) con tu usuario y genera la orden de pago de la solvencia de biblioteca.' },
    { titulo: 'Paga la orden en el banco', texto: 'Cancélala en una agencia de Banrural, Bantrab o G&T Continental. Guarda la boleta de depósito: le tomarás una foto.' },
    {
      titulo: 'Verifica la orden y la boleta',
      texto:
        'El número de orden de pago debe ser el mismo en la orden y en la boleta de depósito, y en el detalle de pago debe aparecer «Biblioteca (De mi Unidad Académica) – Solvencia de Biblioteca».',
    },
    {
      titulo: 'Llena el formulario y sube las fotos',
      texto:
        'Escribe tus datos tal como aparecen en tu DPI, el número de la orden y la fecha en que presentarás tu papelería, y sube una foto de la boleta de depósito y otra de la orden de pago.',
      conFormulario: true,
    },
    {
      titulo: 'Revisa tu correo',
      texto: 'En unos minutos te llega la confirmación con los datos que enviaste. Si no llega en 5 minutos, revisa que el correo estuviera bien escrito y envía una nueva solicitud.',
    },
    { titulo: 'Recibe tu solvencia en PDF', texto: 'La biblioteca revisa el pago y te envía la constancia de solvencia por correo, en el horario de entrega. Imprímela para tus trámites.' },
  ],
};

const copia = (valor) => JSON.parse(JSON.stringify(valor));
const estado = almacen.cargar('guia_de_solvencia', { ...copia(ORIGINAL), actualizadaEn: null, actualizadaPor: null });

function guardar() {
  almacen.guardar('guia_de_solvencia', estado);
}

// Un video de YouTube se puede pegar como enlace de cualquier forma (youtube.com/watch?v=..., youtu.be/..., /embed/..., /shorts/...) o
// solo su código de 11 caracteres. Se guarda el código.
function idDeYoutube(valor) {
  const texto = String(valor ?? '').trim();
  if (/^[\w-]{11}$/.test(texto)) return texto;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'youtube-nocookie.com'].includes(host)) {
    id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1] ?? null;
  }
  return id && /^[\w-]{11}$/.test(id.slice(0, 11)) ? id.slice(0, 11) : null;
}

function texto(valor, nombre, minimo, maximo) {
  const limpio = String(valor ?? '').trim().replace(/\s+/g, ' ');
  if (limpio.length < minimo || limpio.length > maximo) throw rechazo(`${nombre}: escribe de ${minimo} a ${maximo} caracteres`);
  return limpio;
}

function obtener() {
  return { videos: copia(estado.videos), pasos: copia(estado.pasos), actualizadaEn: estado.actualizadaEn, actualizadaPor: estado.actualizadaPor };
}

// Valida todo antes de cambiar: o se guarda la guía completa, o nada.
function actualizar({ videos, pasos } = {}, sesion) {
  if (!Array.isArray(videos) || !Array.isArray(pasos)) throw rechazo('Faltan los videos o los pasos');
  if (videos.length > MAXIMO_DE_VIDEOS) throw rechazo(`Pueden ser hasta ${MAXIMO_DE_VIDEOS} videos`);
  if (pasos.length < 1 || pasos.length > MAXIMO_DE_PASOS) throw rechazo(`Tiene que haber de 1 a ${MAXIMO_DE_PASOS} pasos`);
  const nuevosVideos = videos.map((v, i) => {
    const id = idDeYoutube(v?.enlace ?? v?.id);
    if (!id) throw rechazo(`Video ${i + 1}: pega el enlace de YouTube del video (por ejemplo https://youtu.be/HaVEv74BTS4)`);
    return { id, titulo: texto(v?.titulo, `Video ${i + 1}, título`, 3, 80) };
  });
  const nuevosPasos = pasos.map((p, i) => ({
    titulo: texto(p?.titulo, `Paso ${i + 1}, título`, 3, 80),
    texto: texto(p?.texto, `Paso ${i + 1}, explicación`, 3, 600),
    ...(p?.conFormulario === true ? { conFormulario: true } : {}),
  }));
  estado.videos = nuevosVideos;
  estado.pasos = nuevosPasos;
  estado.actualizadaEn = new Date().toISOString();
  estado.actualizadaPor = sesion?.usuario ?? null;
  guardar();
  return obtener();
}

function restaurar(sesion) {
  estado.videos = copia(ORIGINAL.videos);
  estado.pasos = copia(ORIGINAL.pasos);
  estado.actualizadaEn = new Date().toISOString();
  estado.actualizadaPor = sesion?.usuario ?? null;
  guardar();
  return obtener();
}

module.exports = { obtener, actualizar, restaurar, idDeYoutube, ORIGINAL, MAXIMO_DE_VIDEOS, MAXIMO_DE_PASOS };
