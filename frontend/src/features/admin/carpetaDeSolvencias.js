// La carpeta de solvencias en la PC de la administración (por ejemplo C:\solvencias), donde quedan para siempre las fotos de cada
// solicitud al aprobarla o rechazarla:
//
//   solvencias/
//   ├── comprobante/      Maria_Lopez_202312345_2026-10-22.webp
//   └── orden_de_pago/    Maria_Lopez_202312345_2026-10-22.webp
//
// El servidor está en internet y no puede escribir en esa PC: lo hace el navegador (Chrome o Edge en computadora), con permiso de la
// persona. La primera vez se elige la carpeta; el navegador la recuerda (se guarda en IndexedDB) y solo vuelve a pedir permiso de vez
// en cuando. Si la carpeta elegida no se llama «solvencias», se crea esa carpeta adentro. Las subcarpetas se crean solas.

const BASE = 'biblioteca-panel';
const TABLA = 'carpetas';
const CLAVE = 'solvencias';
export const SUBCARPETAS = { comprobante: 'comprobante', orden_de_pago: 'orden_de_pago' };

export const sePuedeGuardarEnLaPc = () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

function abrirBase() {
  return new Promise((resolver, fallar) => {
    const pedido = indexedDB.open(BASE, 1);
    pedido.onupgradeneeded = () => pedido.result.createObjectStore(TABLA);
    pedido.onsuccess = () => resolver(pedido.result);
    pedido.onerror = () => fallar(pedido.error);
  });
}

async function enLaBase(modo, operar) {
  const base = await abrirBase();
  try {
    return await new Promise((resolver, fallar) => {
      const pedido = operar(base.transaction(TABLA, modo).objectStore(TABLA));
      pedido.onsuccess = () => resolver(pedido.result);
      pedido.onerror = () => fallar(pedido.error);
    });
  } finally {
    base.close();
  }
}

const leerCarpeta = () => enLaBase('readonly', (tabla) => tabla.get(CLAVE)).catch(() => null);
const recordarCarpeta = (carpeta) => enLaBase('readwrite', (tabla) => tabla.put(carpeta, CLAVE));

// 'no_se_puede' (otro navegador), 'sin_carpeta', 'sin_permiso' (hay que darlo con un clic) o 'lista'; y el nombre de la carpeta.
export async function estadoDeLaCarpeta() {
  if (!sePuedeGuardarEnLaPc()) return { estado: 'no_se_puede', nombre: null };
  const carpeta = await leerCarpeta();
  if (!carpeta) return { estado: 'sin_carpeta', nombre: null };
  const permiso = await carpeta.queryPermission({ mode: 'readwrite' });
  return { estado: permiso === 'granted' ? 'lista' : 'sin_permiso', nombre: carpeta.name };
}

// Abre el selector de carpetas (tiene que ser con un clic de la persona). Devuelve el nombre de la carpeta de solvencias.
export async function elegirCarpeta() {
  const elegida = await window.showDirectoryPicker({ id: 'solvencias', mode: 'readwrite', startIn: 'documents' });
  const raiz = elegida.name.toLowerCase() === 'solvencias' ? elegida : await elegida.getDirectoryHandle('solvencias', { create: true });
  await Promise.all(Object.values(SUBCARPETAS).map((nombre) => raiz.getDirectoryHandle(nombre, { create: true })));
  await recordarCarpeta(raiz);
  return raiz.name;
}

// Pide el permiso de escritura si el navegador lo olvidó (también tiene que ser con un clic). true si se puede escribir.
export async function pedirPermiso() {
  const carpeta = await leerCarpeta();
  if (!carpeta) return false;
  if ((await carpeta.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await carpeta.requestPermission({ mode: 'readwrite' })) === 'granted';
}

// Un nombre que no pise un archivo que ya está: Maria_Lopez_..._2026-10-22.webp, después ..._2026-10-22_2.webp, etc.
async function nombreLibre(carpeta, nombre) {
  const punto = nombre.lastIndexOf('.');
  const base = punto > 0 ? nombre.slice(0, punto) : nombre;
  const extension = punto > 0 ? nombre.slice(punto) : '';
  for (let n = 1; n < 1000; n += 1) {
    const candidato = n === 1 ? nombre : `${base}_${n}${extension}`;
    try {
      await carpeta.getFileHandle(candidato);
    } catch (error) {
      if (error.name === 'NotFoundError') return candidato;
      throw error;
    }
  }
  throw new Error(`Ya hay demasiados archivos llamados ${nombre}`);
}

// Guarda una foto en su subcarpeta (la crea si no existe) y devuelve dónde quedó: «solvencias/comprobante/Maria_...webp».
export async function guardarEnLaPc(tipo, nombre, contenido) {
  const raiz = await leerCarpeta();
  if (!raiz) throw new Error('Primero elige la carpeta de solvencias de esta PC (botón «Elegir carpeta»).');
  if (!(await pedirPermiso())) throw new Error('El navegador no dio permiso para guardar en la carpeta de solvencias.');
  const carpeta = await raiz.getDirectoryHandle(SUBCARPETAS[tipo], { create: true });
  const libre = await nombreLibre(carpeta, nombre);
  const archivo = await carpeta.getFileHandle(libre, { create: true });
  const escritor = await archivo.createWritable();
  await escritor.write(contenido);
  await escritor.close();
  return `${raiz.name}/${SUBCARPETAS[tipo]}/${libre}`;
}
