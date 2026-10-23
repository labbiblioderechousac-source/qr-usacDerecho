const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

// Conexión del almacén con PostgreSQL (Supabase o cualquier otro). Se usa una sola conexión, que escribe los datos y además
// sostiene el «turno»: un candado de aviso de PostgreSQL que solo una copia del servidor puede tener a la vez. Hace falta porque el
// servidor trabaja con sus datos en memoria y los guarda enteros: dos copias escribiendo se pisarían los cambios. Al publicar una
// versión nueva las dos conviven unos segundos; la nueva espera su turno hasta que la vieja termina y suelta la conexión.
//
// Con Supabase hay que usar la cadena del «Session pooler» (puerto 5432): la conexión directa solo funciona por IPv6, y el modo
// «transaction» (puerto 6543) no sostiene candados.

const CLAVE_DEL_TURNO = '7410112024'; // número fijo que identifica a esta aplicación entre los candados de aviso de PostgreSQL
const INTENTOS_DE_CONEXION = Number(process.env.DATABASE_INTENTOS) || 6;
const ESPERA_ENTRE_INTENTOS_MS = 2000;
const LATIDO_MS = 30 * 1000;
const CONSULTA_REAL_CADA_MS = 6 * 60 * 60 * 1000; // una lectura de verdad, para que un proyecto gratuito no se pause por inactividad

let cliente = null;
let conectado = false;
let tengoElTurno = false;
let destino = '';
let alPerderElTurno = () => {};
let temporizadorDelLatido = null;
let ultimaConsultaReal = 0;
let reconectando = null;

const pausa = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

// Al pegar la variable en una plataforma (Render, Railway...) es fácil arrastrar el nombre («DATABASE_URL=postgresql://...») o unas
// comillas: se quitan antes de leerla.
function limpiarUrl(valor) {
  let texto = String(valor ?? '').trim();
  texto = texto.replace(/^DATABASE_URL\s*=\s*/i, '').trim();
  const comillas = texto.match(/^(["'])([\s\S]*)\1$/);
  if (comillas) texto = comillas[2].trim();
  // Si al pegarla se perdió el «postgresql:» del principio (queda «//usuario:clave@servidor...»), se repone.
  if (/^\/\/[^/]/.test(texto)) texto = `postgresql:${texto}`;
  return texto;
}

// Qué tiene de raro una dirección que no se pudo leer, sin mostrar nunca la clave (solo el principio, que es el tipo de dirección).
function pistasDeUrl(texto) {
  const pistas = [];
  if (!/^postgres(ql)?:\/\//i.test(texto)) pistas.push(`empieza con «${texto.slice(0, 12)}…» y debe empezar con postgresql://`);
  if (/\s/.test(texto)) pistas.push('tiene espacios o saltos de línea');
  if (/\[YOUR-PASSWORD\]/i.test(texto)) pistas.push('todavía dice [YOUR-PASSWORD]: cámbialo por la contraseña de la base');
  return pistas.length > 0 ? ` Revisa el valor: ${pistas.join('; ')}.` : '';
}

function leerUrl() {
  const texto = limpiarUrl(process.env.DATABASE_URL);
  if (!texto) throw new Error('Falta DATABASE_URL');
  let url;
  try {
    url = new URL(texto);
  } catch {
    throw new Error(
      'DATABASE_URL no parece una dirección de PostgreSQL. Debe ser postgresql://usuario:clave@servidor:5432/base (si la clave lleva símbolos como # o @, hay que escribirlos con % y su código).' +
        pistasDeUrl(texto),
    );
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error('DATABASE_URL debe empezar con postgresql://');
  }
  return url;
}

function leerCertificado(valor) {
  return valor.includes('-----BEGIN') ? valor : fs.readFileSync(valor, 'utf8');
}

// Cómo se cifra la conexión. En esta computadora (localhost) sin cifrar; en cualquier otro servidor, cifrada. Supabase firma con su
// propia autoridad, que Node no conoce: sin DATABASE_SSL_CA (el certificado de Supabase) se cifra sin verificar quién responde.
function opciones(url) {
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  const modo = String(url.searchParams.get('sslmode') || process.env.DATABASE_SSL || '').trim().toLowerCase();
  url.searchParams.delete('sslmode');
  let ssl;
  if (['disable', 'false', '0', 'no'].includes(modo) || (local && !modo)) ssl = false;
  else if (process.env.DATABASE_SSL_CA) ssl = { ca: leerCertificado(process.env.DATABASE_SSL_CA), rejectUnauthorized: true };
  else ssl = { rejectUnauthorized: false };
  return {
    connectionString: url.toString(),
    ssl,
    application_name: 'biblioteca-opac',
    connectionTimeoutMillis: 10000,
    query_timeout: 60000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };
}

// Explica un error de conexión sin mostrar nunca la clave.
function mensajeSeguro(error) {
  const codigo = error?.code;
  const texto = String(error?.message ?? error);
  if (codigo === '28P01' || /password authentication failed/i.test(texto)) return 'el usuario o la clave de la base de datos no son correctos (revisa DATABASE_URL)';
  if (codigo === '22P05' || /has no equivalent in encoding/i.test(texto)) return 'la base de datos no puede guardar un carácter (su codificación no es UTF8): crea la base con codificación UTF8';
  if (codigo === '3D000') return 'esa base de datos no existe (revisa el nombre al final de DATABASE_URL)';
  if (codigo === 'ENOTFOUND') return 'no se encontró el servidor de la base de datos (revisa la dirección en DATABASE_URL)';
  if (codigo === 'ENETUNREACH' || codigo === 'EHOSTUNREACH') {
    return 'no hay ruta hasta el servidor de la base de datos. Con Supabase, usa la cadena «Session pooler» (la conexión directa solo funciona por IPv6)';
  }
  if (codigo === 'ECONNREFUSED') return 'el servidor de la base de datos rechazó la conexión (revisa el puerto y que esté encendido)';
  if (codigo === 'ETIMEDOUT' || /timeout/i.test(texto)) return 'la base de datos tardó demasiado en responder';
  if (/tenant or user not found/i.test(texto)) return 'Supabase no encuentra el proyecto o el usuario (el usuario debe ser postgres.<referencia-del-proyecto>)';
  return texto;
}

function describirDestino(url) {
  return `${url.hostname}:${url.port || 5432}${url.pathname}`;
}

async function conectar() {
  const url = leerUrl();
  destino = describirDestino(url);
  const nuevo = new Client(opciones(url));
  const perdido = () => {
    if (cliente === nuevo) {
      conectado = false;
      tengoElTurno = false;
    }
  };
  nuevo.on('error', (error) => {
    console.error(`[base de datos] La conexión falló: ${mensajeSeguro(error)}`);
    perdido();
  });
  nuevo.on('end', perdido);
  await nuevo.connect();
  cliente = nuevo;
  conectado = true;
  tengoElTurno = false;
}

async function abrir({ intentos = INTENTOS_DE_CONEXION } = {}) {
  let ultimo = null;
  for (let intento = 1; intento <= intentos; intento += 1) {
    try {
      await conectar();
      return;
    } catch (error) {
      ultimo = error;
      if (error.message?.startsWith('DATABASE_URL') || error.message === 'Falta DATABASE_URL') throw error;
      console.warn(`[base de datos] No se pudo conectar (intento ${intento} de ${intentos}): ${mensajeSeguro(error)}`);
      if (intento < intentos) await pausa(ESPERA_ENTRE_INTENTOS_MS * intento);
    }
  }
  throw new Error(`No se pudo conectar con la base de datos (${destino}): ${mensajeSeguro(ultimo)}`);
}

async function probarTurno() {
  const { rows } = await cliente.query('select pg_try_advisory_lock($1::bigint) as ok', [CLAVE_DEL_TURNO]);
  tengoElTurno = rows[0].ok === true;
  return tengoElTurno;
}

// Espera su turno hasta `esperaMaxMs`. `alEsperar` se llama una vez si hay que esperar (para avisarlo en la consola).
async function tomarElTurno({ esperaMaxMs = 120000, alEsperar } = {}) {
  const limite = Date.now() + esperaMaxMs;
  let avisado = false;
  for (;;) {
    if (await probarTurno()) return;
    if (Date.now() >= limite) {
      throw new Error('Otra copia del servidor sigue usando esta base de datos. Solo puede haber una a la vez: apaga la otra o espera a que termine.');
    }
    if (!avisado) {
      avisado = true;
      if (alEsperar) alEsperar();
    }
    await pausa(ESPERA_ENTRE_INTENTOS_MS);
  }
}

// La biblioteca guarda texto con tildes, comillas y símbolos (como la flecha de la actividad): la base de datos tiene que ser UTF8. Con otra
// codificación (por ejemplo WIN1252, la de algunas instalaciones de PostgreSQL en Windows) unos textos no se podrían guardar. Mejor avisarlo al
// arrancar, con el remedio, que fallar a medias después.
async function comprobarCodificacion() {
  const { rows } = await cliente.query("select current_setting('server_encoding') as codificacion");
  const codificacion = String(rows[0].codificacion);
  if (codificacion.toUpperCase() !== 'UTF8') {
    throw new Error(
      `La base de datos usa la codificación ${codificacion} y la biblioteca necesita UTF8 (con otra, algunos textos no se pueden guardar). ` +
        "Crea la base con codificación UTF8: en pgAdmin, clic derecho en Databases > Create > Database, pestaña Definition: Encoding UTF8, Template template0, " +
        "Collation C y Character type C. O con SQL: CREATE DATABASE biblioteca WITH ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0;"
    );
  }
}

async function prepararEsquema() {
  await comprobarCodificacion();
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'esquema.sql'), 'utf8');
  await cliente.query('begin');
  try {
    await cliente.query(sql);
    await cliente.query('commit');
  } catch (error) {
    await cliente.query('rollback').catch(() => {});
    throw error;
  }
}

// Los documentos tal como están en `biblioteca.almacen`: nombre -> valor.
async function leerTodo() {
  const { rows } = await cliente.query('select nombre, valor from biblioteca.almacen');
  return new Map(rows.map((fila) => [fila.nombre, fila.valor]));
}

// Los registros de las colecciones (las listas largas, que se guardan con una fila por registro): colección -> filas en su orden.
// El texto de cada registro viene tal como lo entrega PostgreSQL; quien llama lo convierte.
async function leerRegistros() {
  const { rows } = await cliente.query('select coleccion, id, orden, datos from biblioteca.registros order by coleccion, orden');
  const colecciones = new Map();
  rows.forEach((fila) => {
    if (!colecciones.has(fila.coleccion)) colecciones.set(fila.coleccion, []);
    colecciones.get(fila.coleccion).push({ id: fila.id, orden: Number(fila.orden), datos: fila.datos });
  });
  return colecciones;
}

// Si la conexión se cayó, la vuelve a abrir y retoma el turno. Si el turno ya lo tiene otra copia, esta se apaga (alPerderElTurno):
// seguir escribiendo pisaría sus datos.
async function asegurarConexion() {
  if (conectado && tengoElTurno) return;
  if (!reconectando) {
    reconectando = (async () => {
      try {
        if (cliente) await cliente.end().catch(() => {});
        await abrir({ intentos: 2 });
        if (!(await probarTurno())) {
          alPerderElTurno();
          throw new Error('Otra copia del servidor tomó el turno de la base de datos');
        }
      } finally {
        reconectando = null;
      }
    })();
  }
  await reconectando;
}

async function escribir(nombre, texto) {
  await asegurarConexion();
  await cliente.query(
    'insert into biblioteca.almacen (nombre, valor, actualizado) values ($1, $2::jsonb, now()) ' +
      'on conflict (nombre) do update set valor = excluded.valor, actualizado = now()',
    [nombre, texto]
  );
}

const FILAS_POR_TANDA = 500;

// Guarda una colección: en una sola transacción escribe el resto del documento (`texto`, sin la lista), agrega o cambia las filas de
// `cambiadas` ([{ id, orden, texto }]) y borra las de `borradas` (ids). Con `reemplazar` borra antes todas las filas de la colección.
// Así un cambio en un registro escribe ese registro y no la lista entera.
async function escribirColeccion(nombre, texto, { cambiadas = [], borradas = [], reemplazar = false } = {}) {
  await asegurarConexion();
  await cliente.query('begin');
  try {
    if (reemplazar) await cliente.query('delete from biblioteca.registros where coleccion = $1', [nombre]);
    for (let i = 0; i < borradas.length; i += 5000) {
      await cliente.query('delete from biblioteca.registros where coleccion = $1 and id = any($2::text[])', [nombre, borradas.slice(i, i + 5000)]);
    }
    for (let i = 0; i < cambiadas.length; i += FILAS_POR_TANDA) {
      const tanda = cambiadas.slice(i, i + FILAS_POR_TANDA);
      await cliente.query(
        'insert into biblioteca.registros (coleccion, id, orden, datos, actualizado) ' +
          'select $1, t.id, t.orden, t.datos::jsonb, now() from unnest($2::text[], $3::bigint[], $4::text[]) as t(id, orden, datos) ' +
          'on conflict (coleccion, id) do update set orden = excluded.orden, datos = excluded.datos, actualizado = now()',
        [nombre, tanda.map((fila) => fila.id), tanda.map((fila) => fila.orden), tanda.map((fila) => fila.texto)]
      );
    }
    await cliente.query(
      'insert into biblioteca.almacen (nombre, valor, actualizado) values ($1, $2::jsonb, now()) ' +
        'on conflict (nombre) do update set valor = excluded.valor, actualizado = now()',
      [nombre, texto]
    );
    await cliente.query('commit');
  } catch (error) {
    await cliente.query('rollback').catch(() => {});
    throw error;
  }
}

// Fotos de las solicitudes de solvencia que esperan revisión (ver src/solvencia/fotos_data.js). Viven aquí solo mientras la solicitud está
// pendiente: al aprobarla o rechazarla se guardan en la PC de la biblioteca y se borran de la base de datos.
async function guardarFoto({ solicitud, tipo, mime, hash, contenido }) {
  await asegurarConexion();
  await cliente.query(
    'insert into biblioteca.fotos_solvencia (solicitud, tipo, mime, hash, bytes, contenido, subida) values ($1, $2, $3, $4, $5, $6, now()) ' +
      'on conflict (solicitud, tipo) do update set mime = excluded.mime, hash = excluded.hash, bytes = excluded.bytes, contenido = excluded.contenido, subida = now()',
    [solicitud, tipo, mime, hash, contenido.length, contenido]
  );
}

async function leerFoto(solicitud, tipo) {
  await asegurarConexion();
  const { rows } = await cliente.query('select mime, contenido from biblioteca.fotos_solvencia where solicitud = $1 and tipo = $2', [solicitud, tipo]);
  return rows[0] ? { mime: rows[0].mime, contenido: rows[0].contenido } : null;
}

async function borrarFotos(solicitud) {
  await asegurarConexion();
  await cliente.query('delete from biblioteca.fotos_solvencia where solicitud = $1', [solicitud]);
}

async function solicitudesConFotos() {
  await asegurarConexion();
  const { rows } = await cliente.query('select distinct solicitud from biblioteca.fotos_solvencia');
  return rows.map((fila) => fila.solicitud);
}

// Cuántas fotos esperan revisión y cuánto ocupan, para la sección «Datos y respaldo».
async function resumenDeFotos() {
  await asegurarConexion();
  const { rows } = await cliente.query('select count(*) as fotos, coalesce(sum(bytes), 0) as bytes from biblioteca.fotos_solvencia');
  return { fotos: Number(rows[0].fotos), bytes: Number(rows[0].bytes) };
}

// Cada documento con su tamaño, cuándo se guardó por última vez y, si es una colección, cuántos registros tiene.
async function resumen() {
  const { rows } = await cliente.query(
    'select a.nombre, pg_column_size(a.valor) + coalesce(r.bytes, 0) as bytes, greatest(a.actualizado, r.actualizado) as actualizado, r.registros ' +
      'from biblioteca.almacen a left join (' +
      '  select coleccion, count(*) as registros, sum(pg_column_size(datos)) as bytes, max(actualizado) as actualizado from biblioteca.registros group by coleccion' +
      ') r on r.coleccion = a.nombre order by a.nombre'
  );
  return rows.map((fila) => ({
    nombre: fila.nombre,
    bytes: Number(fila.bytes),
    actualizadoEn: fila.actualizado.toISOString(),
    ...(fila.registros === null ? {} : { registros: Number(fila.registros) }),
  }));
}

// Mantiene viva la conexión y comprueba que sigue teniendo el turno. De vez en cuando hace una lectura de verdad: un proyecto gratuito de
// Supabase se pausa tras una semana sin actividad.
function iniciarLatido() {
  if (temporizadorDelLatido) return;
  temporizadorDelLatido = setInterval(async () => {
    try {
      await asegurarConexion();
      if (Date.now() - ultimaConsultaReal > CONSULTA_REAL_CADA_MS) {
        await cliente.query('select count(*) from biblioteca.almacen');
        ultimaConsultaReal = Date.now();
      } else {
        await cliente.query('select 1');
      }
    } catch (error) {
      console.error(`[base de datos] Latido fallido: ${mensajeSeguro(error)}`);
    }
  }, LATIDO_MS);
  temporizadorDelLatido.unref();
}

// Cerrar la conexión suelta el turno enseguida: la copia siguiente puede empezar sin esperar.
async function cerrar() {
  clearInterval(temporizadorDelLatido);
  temporizadorDelLatido = null;
  tengoElTurno = false;
  conectado = false;
  if (cliente) await cliente.end().catch(() => {});
  cliente = null;
}

module.exports = {
  abrir,
  tomarElTurno,
  prepararEsquema,
  leerTodo,
  leerRegistros,
  escribir,
  escribirColeccion,
  guardarFoto,
  leerFoto,
  borrarFotos,
  solicitudesConFotos,
  resumenDeFotos,
  resumen,
  iniciarLatido,
  cerrar,
  mensajeSeguro,
  destino: () => destino,
  estaConectado: () => conectado && tengoElTurno,
  alPerderElTurno: (funcion) => {
    alPerderElTurno = funcion;
  },
  // Para el importador: intenta el turno una sola vez, sin esperar.
  probarTurno,
};
