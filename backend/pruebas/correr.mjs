// Corre las pruebas del servidor de la biblioteca.
//
//   npm test                    todas
//   npm test -- horas url-qr    solo esas
//   npm test -- --detalle       muestra todo lo que imprime cada prueba (sin esto, solo cuando falla)
//
// Las pruebas no tocan los datos de desarrollo: cada una arranca su propio servidor en un puerto libre, con una carpeta de datos
// temporal y claves de prueba. Nada sale a internet (el correo se prueba con servidores falsos en esta computadora).
//
// Para correrlas contra PostgreSQL en vez de archivos, define DATABASE_URL_PRUEBA con una base SOLO de pruebas (su nombre debe
// llevar «prueba» o «test»): antes de cada prueba se borra el esquema `biblioteca` de esa base.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BACKEND, ENTORNO_LIMPIO, arrancarServidor, carpetaTemporal } from './servidor.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SITIO = path.join(BACKEND, '..', 'frontend', 'dist', 'index.html');
const require = createRequire(import.meta.url);

// `servidor`: la prueba usa un servidor que arranca este programa (su dirección llega en BASE). `fases`: se corre una vez por fase,
// reiniciando el servidor entre una y otra con los mismos datos. `sitio`: necesita el sitio compilado (frontend/dist).
// `modulos`: paquetes de desarrollo que necesita. `base`: solo corre con DATABASE_URL_PRUEBA (prueba el almacenamiento en PostgreSQL). Las demás arrancan sus propios servidores o prueban un módulo directamente.
const PRUEBAS = [
  { nombre: 'propuesta', servidor: true, fases: ['escribir', 'verificar'] },
  { nombre: 'solvencia-fotos' },
  { nombre: 'guia-solvencia', servidor: true, fases: ['escribir', 'verificar'] },
  { nombre: 'sanciones' },
  { nombre: 'horas', servidor: true },
  { nombre: 'fin-de-semana' },
  { nombre: 'url-qr', servidor: true },
  { nombre: 'pdf', servidor: true },
  { nombre: 'proteccion', servidor: true, sitio: true },
  { nombre: 'kioscos', sitio: true },
  { nombre: 'cabeceras', sitio: true },
  { nombre: 'claves' },
  { nombre: 'sesiones' },
  { nombre: 'respaldo' },
  { nombre: 'busqueda' },
  { nombre: 'campos' },
  { nombre: 'enlaces' },
  { nombre: 'salida' },
  { nombre: 'penalizacion' },
  { nombre: 'estadisticas' },
  { nombre: 'entregas' },
  { nombre: 'keepalive' },
  { nombre: 'aviso-correo' },
  { nombre: 'correo', modulos: ['smtp-server', 'mailparser'] },
  { nombre: 'gmail-panel' },
  { nombre: 'postgres', base: true },
];

const BASE_DE_PRUEBA = String(process.env.DATABASE_URL_PRUEBA || '').trim();

// Con PostgreSQL, cada prueba empieza con la base vacía.
async function vaciarBaseDePrueba() {
  if (!BASE_DE_PRUEBA) return;
  const nombre = new URL(BASE_DE_PRUEBA).pathname.slice(1).toLowerCase();
  if (!/prueba|test/.test(nombre)) {
    throw new Error(`DATABASE_URL_PRUEBA apunta a la base «${nombre}»: por seguridad su nombre debe llevar «prueba» o «test» (las pruebas borran sus datos)`);
  }
  const { Client } = require('pg');
  const cliente = new Client({ connectionString: BASE_DE_PRUEBA });
  await cliente.connect();
  try {
    await cliente.query('drop schema if exists biblioteca cascade');
  } finally {
    await cliente.end();
  }
}

function correrArchivo(archivo, env) {
  return new Promise((resolver) => {
    const salida = [];
    const hijo = spawn(process.execPath, [archivo], { cwd: AQUI, env: { ...process.env, ...ENTORNO_LIMPIO, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    hijo.stdout.on('data', (d) => salida.push(String(d)));
    hijo.stderr.on('data', (d) => salida.push(String(d)));
    hijo.once('exit', (codigo) => resolver({ codigo, salida: salida.join('') }));
  });
}

function faltantes(prueba) {
  const motivos = [];
  if (prueba.sitio && !fs.existsSync(SITIO)) motivos.push('falta el sitio compilado (corre «npm run build» dentro de frontend)');
  if (prueba.base && !BASE_DE_PRUEBA) motivos.push('necesita una base de datos de pruebas (define DATABASE_URL_PRUEBA)');
  (prueba.modulos ?? []).forEach((modulo) => {
    try {
      require.resolve(modulo);
    } catch {
      motivos.push(`falta el paquete ${modulo} (corre «npm install» dentro de backend)`);
    }
  });
  return motivos;
}

// La última línea con contenido es el resumen que imprime cada prueba.
const resumen = (salida) => salida.trim().split('\n').filter((l) => l.trim()).pop()?.trim() ?? '';

async function correr(prueba, detalle) {
  const archivo = path.join(AQUI, `${prueba.nombre}.mjs`);
  const datos = carpetaTemporal(prueba.nombre);
  const partes = [];
  let bien = true;
  try {
    if (prueba.servidor) await vaciarBaseDePrueba();
    for (const fase of prueba.fases ?? [null]) {
      const servidor = prueba.servidor ? await arrancarServidor({ datos, sitio: prueba.sitio, env: { DATABASE_URL: BASE_DE_PRUEBA } }) : null;
      try {
        const r = await correrArchivo(archivo, { ...(servidor ? { BASE: servidor.base } : {}), ...(fase ? { FASE: fase } : {}) });
        partes.push(r.salida);
        if (r.codigo !== 0) {
          bien = false;
          if (servidor) partes.push(`--- consola del servidor ---\n${servidor.consola()}`);
          break;
        }
      } finally {
        if (servidor) await servidor.parar();
      }
    }
  } catch (error) {
    bien = false;
    partes.push(String(error.stack || error));
  } finally {
    fs.rmSync(datos, { recursive: true, force: true });
  }
  const salida = partes.join('\n');
  console.log(`${bien ? ' bien ' : 'FALLA '} ${prueba.nombre.padEnd(12)} ${bien ? resumen(salida) : ''}`);
  if (!bien || detalle) console.log(`${salida.trimEnd()}\n`);
  return bien;
}

const argumentos = process.argv.slice(2);
const detalle = argumentos.includes('--detalle');
const pedidas = argumentos.filter((a) => !a.startsWith('--'));
const desconocidas = pedidas.filter((n) => !PRUEBAS.some((p) => p.nombre === n));
if (desconocidas.length > 0) {
  console.error(`No conozco estas pruebas: ${desconocidas.join(', ')}. Las que hay: ${PRUEBAS.map((p) => p.nombre).join(', ')}`);
  process.exit(2);
}

console.log(`Pruebas del servidor (${BASE_DE_PRUEBA ? 'con PostgreSQL' : 'con archivos'})\n`);
let fallas = 0;
let omitidas = 0;
for (const prueba of PRUEBAS.filter((p) => pedidas.length === 0 || pedidas.includes(p.nombre))) {
  const motivos = faltantes(prueba);
  if (motivos.length > 0) {
    omitidas += 1;
    console.log(`omitida ${prueba.nombre.padEnd(12)} ${motivos.join('; ')}`);
  } else if (!(await correr(prueba, detalle))) {
    fallas += 1;
  }
}
console.log(`\n${fallas === 0 ? 'Todo bien' : `${fallas} con fallas`}${omitidas > 0 ? ` · ${omitidas} omitidas` : ''}`);
process.exit(fallas === 0 ? 0 : 1);
