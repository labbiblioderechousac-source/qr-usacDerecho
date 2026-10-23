const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const base = require('./postgres');

// Almacén de datos del sistema: cada tipo de dato (reservas, solicitudes, cuentas, catálogo...) es un documento JSON con nombre. Los
// módulos de datos lo cargan al arrancar (`cargar`), trabajan con él en memoria y piden guardarlo cuando cambia (`guardar`).
//
// Dónde se guarda depende de una variable del servidor:
//  - Con DATABASE_URL, en PostgreSQL (Supabase u otro): una fila por documento en `biblioteca.almacen` (ver backend/sql/esquema.sql).
//    Las listas largas (las de COLECCIONES: tesis, reservas, solicitudes y eventos) van aparte, con una fila por registro en
//    `biblioteca.registros`: así cambiar una reserva escribe esa reserva y no todas. Al arrancar `iniciar` trae todo a memoria; después
//    `cargar` lee de ahí. Los datos sobreviven a cada publicación del servidor y se pueden ver y exportar desde el panel de Supabase.
//    Solo puede haber una copia del servidor a la vez.
//  - Sin ella, en archivos JSON dentro de la carpeta de datos: backend/data, o la que indique DATA_DIR. Sirve para desarrollar y para
//    un servidor propio con disco que se conserve. Hay que incluir la carpeta en las copias de seguridad.
//
// En los dos casos escribir tarda un instante: varios cambios seguidos se guardan una sola vez, y al apagar el servidor se guarda lo
// que quede pendiente.

const usaBaseDeDatos = () => Boolean(String(process.env.DATABASE_URL || '').trim());

const pausa = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// --- Archivos --------------------------------------------------------------------------------------------------------

function carpeta() {
  return process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
}

function archivo(nombre) {
  return path.join(carpeta(), `${nombre}.json`);
}

// Devuelve lo guardado, o `inicial` si todavía no hay nada. Un archivo dañado detiene el arranque a propósito:
// seguir con datos vacíos y luego guardar encima borraría lo que pudiera recuperarse.
function leerArchivo(nombre, inicial) {
  try {
    return JSON.parse(fs.readFileSync(archivo(nombre), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return inicial;
    throw new Error(`No se pudo leer ${archivo(nombre)}: ${error.message}`);
  }
}

function escribirArchivo(nombre, valor) {
  fs.mkdirSync(carpeta(), { recursive: true });
  const destino = archivo(nombre);
  const temporal = `${destino}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(valor));
  fs.renameSync(temporal, destino); // reemplazo completo: nunca queda un archivo a medias
}

// --- Estado común ----------------------------------------------------------------------------------------------------

const documentos = new Map(); // la copia de trabajo de cada documento (el mismo objeto que usa su módulo)

// Documentos cuya lista se guarda con una fila por registro: en qué campo está la lista y qué campo identifica a cada registro.
// Para los módulos nada cambia: siguen cargando y guardando el documento entero.
const COLECCIONES = {
  catalogo: { campo: 'tesis', clave: 'id' },
  reservas: { campo: 'reservas', clave: 'id' },
  solvencia: { campo: 'solicitudes', clave: 'id' },
  eventos: { campo: 'eventos', clave: 'id' },
};
const escritas = new Map(); // colección -> Map(id -> { huella, orden }): lo que ya está en la base de datos, para escribir solo lo que cambió
const huellaDe = (texto) => crypto.createHash('md5').update(texto).digest('base64');
const pendientes = new Map(); // nombre -> { valor, temporizador }
let iniciado = false;
let cola = Promise.resolve(); // las escrituras a la base de datos van una tras otra
let ultimoGuardado = null;
let ultimoError = null;
const reintentos = new Map();
let enVuelo = 0; // escrituras que ya salieron hacia la base de datos y todavía no terminan

// Con una base de datos hay que traer lo guardado antes de que los módulos de datos lo pidan; con archivos no hace falta nada.
async function iniciar({ esperaDelTurnoMs, alEsperarElTurno } = {}) {
  if (iniciado) return;
  if (usaBaseDeDatos()) {
    try {
      await base.abrir();
      await base.tomarElTurno({ esperaMaxMs: esperaDelTurnoMs, alEsperar: alEsperarElTurno });
      await base.prepararEsquema();
      await traerDeLaBase();
    } catch (error) {
      await base.cerrar();
      throw error;
    }
    base.alPerderElTurno(() => {
      console.error('[base de datos] Otra copia del servidor tomó el turno: esta se apaga para no pisar sus datos.');
      process.exit(1);
    });
    base.iniciarLatido();
  }
  iniciado = true;
}

// Trae a memoria lo guardado y arma cada colección con sus filas. Un documento que todavía trae su lista adentro (guardado por una
// versión anterior, o recién importado) se pasa a filas en ese momento: su lista manda sobre las filas que hubiera.
async function traerDeLaBase() {
  const guardados = await base.leerTodo();
  const registros = await base.leerRegistros();
  const porPasar = [];
  guardados.forEach((valor, nombre) => {
    const coleccion = COLECCIONES[nombre];
    if (coleccion && valor && typeof valor === 'object') {
      if (Array.isArray(valor[coleccion.campo])) {
        porPasar.push(nombre);
      } else {
        const filas = registros.get(nombre) ?? [];
        valor[coleccion.campo] = filas.map((fila) => fila.datos);
        escritas.set(nombre, new Map(filas.map((fila) => [fila.id, { huella: huellaDe(JSON.stringify(fila.datos)), orden: fila.orden }])));
      }
    }
    documentos.set(nombre, valor);
  });
  for (const nombre of porPasar) {
    await escribirEnBase(nombre, documentos.get(nombre), { reemplazar: true });
    console.log(`[base de datos] «${nombre}» pasó a guardarse con una fila por registro (${documentos.get(nombre)[COLECCIONES[nombre].campo].length})`);
  }
}

// Qué hay que escribir para que las filas de una colección queden como `lista`: las que cambiaron o son nuevas y las que ya no están.
// El orden de la lista se conserva con un número que solo crece: quitar un registro no obliga a tocar los demás.
// Devuelve null si algún registro no tiene identificador o está repetido: esa lista no se puede guardar por filas.
function planDeColeccion(nombre, { clave }, lista, reemplazar) {
  const antes = reemplazar ? new Map() : escritas.get(nombre) ?? new Map();
  let mayor = 0;
  antes.forEach(({ orden }) => {
    if (orden > mayor) mayor = orden;
  });
  const filas = [];
  const vistos = new Set();
  let anterior = 0;
  let enOrden = true;
  for (const registro of lista) {
    const valor = registro?.[clave];
    const id = typeof valor === 'string' || typeof valor === 'number' ? String(valor) : '';
    if (!id || vistos.has(id)) return null;
    vistos.add(id);
    const texto = JSON.stringify(registro);
    const huella = huellaDe(texto);
    const previo = antes.get(id);
    const orden = previo ? previo.orden : (mayor += 1);
    if (orden <= anterior) enOrden = false;
    anterior = orden;
    const cambio = !previo || previo.huella !== huella;
    filas.push({ id, huella, orden, previo, registro, texto: cambio ? texto : null });
  }
  // Si alguien reordenó la lista, se numera de nuevo entera.
  if (!enOrden) {
    filas.forEach((fila, i) => {
      fila.orden = i + 1;
    });
  }
  const despues = new Map();
  const cambiadas = [];
  filas.forEach((fila) => {
    despues.set(fila.id, { huella: fila.huella, orden: fila.orden });
    if (fila.texto !== null || fila.previo.orden !== fila.orden) {
      cambiadas.push({ id: fila.id, orden: fila.orden, texto: fila.texto ?? JSON.stringify(fila.registro) });
    }
  });
  const borradas = [...antes.keys()].filter((id) => !vistos.has(id));
  return { despues, cambios: { cambiadas, borradas, reemplazar } };
}

async function escribirEnBase(nombre, valor, { reemplazar = false } = {}) {
  const coleccion = COLECCIONES[nombre];
  const lista = coleccion && valor && typeof valor === 'object' ? valor[coleccion.campo] : null;
  if (!Array.isArray(lista)) {
    await base.escribir(nombre, JSON.stringify(valor));
    return;
  }
  const plan = planDeColeccion(nombre, coleccion, lista, reemplazar);
  if (!plan) {
    // No debería pasar; si pasa, no se pierde nada: la lista se guarda entera dentro del documento, como antes.
    console.warn(`[base de datos] «${nombre}» tiene registros sin identificador o repetidos: por ahora se guarda como un solo documento`);
    await base.escribirColeccion(nombre, JSON.stringify(valor), { reemplazar: true });
    escritas.delete(nombre);
    return;
  }
  const { [coleccion.campo]: _lista, ...resto } = valor;
  await base.escribirColeccion(nombre, JSON.stringify(resto), plan.cambios);
  escritas.set(nombre, plan.despues);
}

function cargar(nombre, inicial) {
  if (!usaBaseDeDatos()) {
    documentos.set(nombre, leerArchivo(nombre, inicial));
    return documentos.get(nombre);
  }
  if (!iniciado) {
    throw new Error(`El almacén no está iniciado: «${nombre}» se pidió antes de abrir la base de datos (falta llamar a iniciar)`);
  }
  if (!documentos.has(nombre)) {
    // Lo que todavía no estaba en la base de datos (la primera vez que arranca) se guarda enseguida con sus valores iniciales,
    // para que no quede nada solo en memoria y todo se pueda ver desde el panel de la base de datos.
    guardarEnBase(nombre, inicial, 300);
  }
  return documentos.get(nombre);
}

// --- Guardar: archivos -----------------------------------------------------------------------------------------------

function guardarEnArchivo(nombre, valor, esperaMs) {
  documentos.set(nombre, valor);
  const previo = pendientes.get(nombre);
  if (previo) clearTimeout(previo.temporizador);
  const temporizador = setTimeout(() => {
    pendientes.delete(nombre);
    escribirArchivo(nombre, valor);
    ultimoGuardado = new Date().toISOString();
  }, esperaMs);
  temporizador.unref();
  pendientes.set(nombre, { valor, temporizador });
}

// Escribe ya lo que esté pendiente (al apagar el servidor).
function guardarPendientes() {
  pendientes.forEach(({ valor, temporizador }, nombre) => {
    clearTimeout(temporizador);
    try {
      escribirArchivo(nombre, valor);
    } catch (error) {
      console.error(`No se pudo guardar ${nombre}: ${error.message}`);
    }
  });
  pendientes.clear();
}

// --- Guardar: base de datos ------------------------------------------------------------------------------------------

function encolar(nombre) {
  cola = cola.then(() => escribirPendiente(nombre)).catch(() => {});
  return cola;
}

// Otras operaciones con la base de datos (las fotos de las solvencias) van en la misma fila que las escrituras del almacén: la conexión es
// una sola y así nunca caen dentro de una transacción a medias. Devuelve el resultado de `tarea` (o su error).
function enLaCola(tarea) {
  const resultado = cola.then(tarea);
  cola = resultado.catch(() => {});
  return resultado;
}

async function escribirPendiente(nombre) {
  const item = pendientes.get(nombre);
  if (!item) return;
  clearTimeout(item.temporizador);
  pendientes.delete(nombre);
  enVuelo += 1;
  try {
    await escribirEnBase(nombre, item.valor);
    ultimoGuardado = new Date().toISOString();
    ultimoError = null;
    reintentos.delete(nombre);
  } catch (error) {
    ultimoError = { fecha: new Date().toISOString(), documento: nombre, mensaje: base.mensajeSeguro(error) };
    console.error(`[base de datos] No se pudo guardar «${nombre}»: ${ultimoError.mensaje}`);
    if (!pendientes.has(nombre)) {
      // Nadie guardó una versión más nueva mientras tanto: se vuelve a intentar con la actual, cada vez más despacio.
      const intento = (reintentos.get(nombre) ?? 0) + 1;
      reintentos.set(nombre, intento);
      const temporizador = setTimeout(() => encolar(nombre), Math.min(5000 * 2 ** (intento - 1), 60000));
      temporizador.unref();
      pendientes.set(nombre, { valor: item.valor, temporizador });
    }
  } finally {
    enVuelo -= 1;
  }
}

function guardarEnBase(nombre, valor, esperaMs) {
  documentos.set(nombre, valor);
  const previo = pendientes.get(nombre);
  if (previo) clearTimeout(previo.temporizador);
  const temporizador = setTimeout(() => encolar(nombre), esperaMs);
  temporizador.unref();
  pendientes.set(nombre, { valor, temporizador });
}

// Guarda poco después del último cambio: varios cambios seguidos se escriben una sola vez. `valor` es el mismo objeto que usa el
// módulo, así que se escribe tal como esté al momento de guardar. Los datos que cambian muy seguido y pesan más (como los eventos
// de uso) pueden pedir una espera mayor.
function guardar(nombre, valor, esperaMs = 300) {
  if (usaBaseDeDatos()) guardarEnBase(nombre, valor, esperaMs);
  else guardarEnArchivo(nombre, valor, esperaMs);
}

// Lo que quede pendiente se escribe ya. Con base de datos espera a que termine, hasta `limiteMs`.
async function vaciar(limiteMs = 8000) {
  if (!usaBaseDeDatos()) {
    guardarPendientes();
    return;
  }
  [...pendientes.keys()].forEach((nombre) => encolar(nombre));
  await Promise.race([cola, pausa(limiteMs)]);
}

async function apagar() {
  await vaciar();
  if (usaBaseDeDatos()) await base.cerrar();
}

process.on('exit', () => {
  if (!usaBaseDeDatos()) guardarPendientes();
});
['SIGINT', 'SIGTERM'].forEach((senal) => {
  process.on(senal, () => {
    apagar()
      .catch((error) => console.error(`No se pudo guardar al apagar: ${error.message}`))
      .finally(() => process.exit(0));
  });
});
// nodemon reinicia el servidor con SIGUSR2: se guarda y se le devuelve la señal para que pueda continuar.
process.once('SIGUSR2', () => {
  apagar()
    .catch((error) => console.error(`No se pudo guardar al reiniciar: ${error.message}`))
    .finally(() => process.kill(process.pid, 'SIGUSR2'));
});

// --- Para el panel: dónde está todo y un respaldo ------------------------------------------------------------------

function descripcion() {
  return usaBaseDeDatos() ? `PostgreSQL (${base.destino() || 'sin conectar'})` : `archivos en ${carpeta()}`;
}

function archivosDeDatos() {
  try {
    return fs
      .readdirSync(carpeta())
      .filter((nombre) => nombre.endsWith('.json'))
      .map((nombre) => nombre.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

// Qué hay guardado y cómo va: cada documento con su tamaño y su última escritura, lo que espera para guardarse y el último error.
async function situacion() {
  let lista;
  if (usaBaseDeDatos()) {
    try {
      lista = await base.resumen();
    } catch (error) {
      lista = [...documentos.keys()].sort().map((nombre) => ({ nombre, bytes: Buffer.byteLength(JSON.stringify(documentos.get(nombre))), actualizadoEn: null }));
      ultimoError = ultimoError ?? { fecha: new Date().toISOString(), documento: null, mensaje: base.mensajeSeguro(error) };
    }
  } else {
    lista = archivosDeDatos()
      .sort()
      .map((nombre) => {
        const datos = fs.statSync(archivo(nombre));
        return { nombre, bytes: datos.size, actualizadoEn: datos.mtime.toISOString() };
      });
  }
  return {
    modo: usaBaseDeDatos() ? 'postgres' : 'archivos',
    destino: usaBaseDeDatos() ? base.destino() : carpeta(),
    conectado: usaBaseDeDatos() ? base.estaConectado() : null,
    documentos: lista,
    pendientes: pendientes.size + enVuelo,
    ultimoGuardado,
    ultimoError,
  };
}

// Todos los documentos juntos, para el respaldo: lo que el servidor tiene ahora mismo en memoria, que incluye lo que todavía no
// se terminó de guardar y lo que nunca cambió desde sus valores iniciales. Con archivos se suman los que haya en la carpeta y
// ningún módulo haya cargado.
function respaldo() {
  const sueltos = usaBaseDeDatos() ? [] : archivosDeDatos().filter((nombre) => !documentos.has(nombre)).map((nombre) => [nombre, leerArchivo(nombre, null)]);
  // Una copia: quien arma el respaldo le quita cosas, y no debe tocar lo que usan los módulos.
  return structuredClone(Object.fromEntries([...sueltos, ...documentos.entries()].sort(([a], [b]) => a.localeCompare(b))));
}

// Para el importador (con el servidor apagado y la base ya abierta): escribe un documento tal cual, reemplazando lo que hubiera.
// Una colección queda de una vez con una fila por registro.
function escribirDirecto(nombre, valor) {
  return escribirEnBase(nombre, valor, { reemplazar: true });
}

module.exports = { usaBaseDeDatos, iniciar, cargar, guardar, guardarPendientes, vaciar, apagar, descripcion, situacion, respaldo, escribirDirecto, enLaCola, carpeta };
