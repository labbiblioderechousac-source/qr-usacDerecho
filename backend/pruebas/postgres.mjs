// Pruebas del almacenamiento en PostgreSQL con una base de datos REAL: arranque y esquema, una fila por registro, el paso desde el
// formato anterior, persistencia tras matar el servidor, el turno entre copias, el apagado ordenado, la caída y recuperación de la base,
// el respaldo, el importador y los mensajes de error.
// Necesita DATABASE_URL_PRUEBA: una base SOLO de pruebas (se vacía). Uso: npm test -- postgres
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BACKEND, CLAVE_DE as CUENTAS, ENTORNO_LIMPIO, puertoLibre } from './servidor.mjs';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { crearZip } = require('../utils/zip.js');

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SIN_CORREO = { ...ENTORNO_LIMPIO, DATA_DIR: '' };

let fallos = 0;
let comprobaciones = 0;
const ok = (cond, msg) => {
  comprobaciones += 1;
  if (!cond) {
    fallos += 1;
    console.log('  FALLA:', msg);
  }
};
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// --- La base de datos de prueba ----------------------------------------------------------------------------------------

function baseDePrueba() {
  const url = String(process.env.DATABASE_URL_PRUEBA || '').trim();
  if (!url) {
    console.log('Falta DATABASE_URL_PRUEBA: estas pruebas necesitan una base de datos PostgreSQL solo de pruebas.');
    process.exit(1);
  }
  const partes = new URL(url);
  const nombre = partes.pathname.slice(1);
  if (!/prueba|test/i.test(nombre)) {
    console.log(`DATABASE_URL_PRUEBA apunta a la base «${nombre}»: por seguridad su nombre debe llevar «prueba» o «test».`);
    process.exit(1);
  }
  // La misma dirección con otra base, otra clave u otro puerto.
  const con = (cambios) => {
    const otra = new URL(url);
    Object.assign(otra, cambios);
    return otra.toString();
  };
  return { url, nombre, puerto: Number(partes.port) || 5432, servidor: partes.hostname, clave: decodeURIComponent(partes.password), con };
}

async function consultar(url, sql, params = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}
const limpiar = (url) => consultar(url, 'drop schema if exists biblioteca cascade');

// --- Servidor de la biblioteca ----------------------------------------------------------------------------------------

function servidor(puerto, url, env = {}) {
  const salida = [];
  const hijo = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    env: {
      ...process.env,
      ...SIN_CORREO,
      PORT: String(puerto),
      DATABASE_URL: url,
      CLAVE_ADMIN: CUENTAS.admin,
      CLAVE_CIRCULACION: CUENTAS.circulacion,
      CLAVE_TESIS: CUENTAS.tesis,
      CLAVE_CONSULTA: CUENTAS.consulta,
      LIMITE_ESCRITURAS: '1000',
      KEEPALIVE: '0',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const estado = { salio: false, codigo: null };
  hijo.stdout.on('data', (d) => salida.push(String(d)));
  hijo.stderr.on('data', (d) => salida.push(String(d)));
  hijo.on('exit', (codigo) => {
    estado.salio = true;
    estado.codigo = codigo;
  });
  const base = `http://localhost:${puerto}`;
  const llamar = async (metodo, ruta, { token, cuerpo } = {}) => {
    const r = await fetch(`${base}${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
    const texto = await r.text();
    let json = {};
    try {
      json = JSON.parse(texto);
    } catch {
      /* no era JSON */
    }
    return { estado: r.status, datos: json.data, error: json.error, texto, cabeceras: r.headers };
  };
  const listo = async (ms = 30000) => {
    for (let i = 0; i < ms / 200; i += 1) {
      if (estado.salio) return false;
      try {
        const r = await fetch(`${base}/health`);
        if (r.ok && (await r.json()).data === 'ok') return true;
      } catch {
        /* todavía no */
      }
      await pausa(200);
    }
    return false;
  };
  const entrar = async (usuario) => (await llamar('POST', '/api/auth/login', { cuerpo: { usuario, clave: CUENTAS[usuario] } })).datos?.token;
  return { hijo, salida, estado, llamar, listo, entrar, matar: () => hijo.kill(), log: () => salida.join('') };
}

async function esperarSalida(srv, ms) {
  for (let i = 0; i < ms / 100 && !srv.estado.salio; i += 1) await pausa(100);
  return srv.estado.salio;
}

function proximoLunes() {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
const LUNES = proximoLunes();
let carne = 0;
const reservar = (srv, extra = {}) =>
  srv.llamar('POST', '/api/reservas/cubiculo', {
    cuerpo: { recursoId: 'cub-1', fecha: LUNES, hora: '08:00', horaFin: '09:00', solicitante: 'Ana Pérez', identificacion: `carne-${(carne += 1)}`, ...extra },
  });

// --- Escenarios --------------------------------------------------------------------------------------------------------

async function arranqueYEsquema(bd) {
  console.log('Arranque, esquema y privacidad');
  await limpiar(bd.url);
  // Como en Supabase: roles públicos que NO deben ver nada de lo guardado.
  await consultar(
    bd.url,
    "do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; end $$"
  );
  const s = servidor(4111, bd.url);
  try {
    ok(await s.listo(), 'el servidor arranca contra PostgreSQL');
    ok(s.log().includes(`datos: PostgreSQL (${bd.servidor}:${bd.puerto}/${bd.nombre})`), 'la consola dice dónde guarda los datos (sin usuario ni clave)');
    ok(!s.log().includes(`${bd.clave}@`), 'la clave de la base de datos no sale en la consola');
    await pausa(1200);
    const docs = (await consultar(bd.url, 'select nombre from biblioteca.almacen order by nombre')).map((f) => f.nombre);
    ok(
      JSON.stringify(docs) ===
        JSON.stringify(['actividad', 'catalogo', 'conexion_gmail', 'configuracion', 'cuentas', 'eventos', 'guia_de_solvencia', 'horarios', 'reservas', 'respaldos', 'sesiones', 'solvencia']),
      `se guardan los 12 documentos al arrancar (${docs.join(', ')})`
    );
    const vistas = (await consultar(bd.url, "select table_name from information_schema.views where table_schema='biblioteca' order by 1")).map((f) => f.table_name);
    ok(vistas.length === 7 && vistas.includes('v_reservas') && vistas.includes('v_tesis'), `se crean las siete vistas (${vistas.join(', ')})`);
    ok(Number((await consultar(bd.url, 'select count(*) as n from biblioteca.v_tesis'))[0].n) === 7, 'v_tesis muestra las 7 tesis de ejemplo desde el primer arranque');
    const columnas = (await consultar(bd.url, "select column_name from information_schema.columns where table_schema='biblioteca' and table_name='v_cuentas'")).map((f) => f.column_name);
    ok(!columnas.some((c) => /hash|sal|clave/.test(c)), `v_cuentas no muestra claves (columnas: ${columnas.join(', ')})`);
    const rls = await consultar(bd.url, "select relname, relrowsecurity from pg_class where oid in ('biblioteca.almacen'::regclass, 'biblioteca.registros'::regclass)");
    ok(rls.length === 2 && rls.every((t) => t.relrowsecurity === true), 'las dos tablas tienen la seguridad por filas activada');
    for (const rol of ['anon', 'authenticated']) {
      const f = (
        await consultar(
          bd.url,
          "select has_schema_privilege($1, 'biblioteca', 'USAGE') as esquema, (has_table_privilege($1, 'biblioteca.almacen', 'SELECT') or has_table_privilege($1, 'biblioteca.registros', 'SELECT')) as tabla, has_table_privilege($1, 'biblioteca.v_cuentas', 'SELECT') as vista",
          [rol]
        )
      )[0];
      ok(!f.esquema && !f.tabla && !f.vista, `el rol público «${rol}» no tiene acceso a nada (${JSON.stringify(f)})`);
    }
    const catalogo = await s.llamar('GET', '/api/tesis');
    ok(catalogo.estado === 200 && catalogo.datos.total === 7, 'el catálogo responde con sus 7 tesis');
  } finally {
    s.matar();
    await esperarSalida(s, 3000);
  }
}

async function persistencia(bd) {
  console.log('Persistencia tras matar el servidor');
  await limpiar(bd.url);
  const s1 = servidor(4112, bd.url);
  let reserva;
  try {
    ok(await s1.listo(), 'arranca el primer servidor');
    const admin = await s1.entrar('admin');
    reserva = await reservar(s1, { correo: 'ana@ejemplo.com' });
    ok(reserva.estado === 200, 'se crea una reserva');
    const sol = await s1.llamar('POST', '/api/solvencia', {
      cuerpo: {
        solicitante: 'Luis Ramírez',
        identificacion: '201955321',
        cui: '2456 78901 0101',
        programa: 'Licenciatura en Ciencias Jurídicas y Sociales',
        motivo: 'Grado',
        correo: 'l@usac.edu.gt',
        ordenDePago: '88123456',
        fechaPapeleria: LUNES,
        esEstudiante: true,
        kiosco: 'k1', // sin fotos: las fotos se prueban en pruebas/solvencia-fotos.mjs
      },
    });
    ok(sol.estado === 200, `se crea una solicitud de solvencia (${sol.estado} ${sol.error ?? ''})`);
    ok((await s1.llamar('PATCH', '/api/admin/configuracion', { token: admin, cuerpo: { toleranciaMinutos: 20 } })).estado === 200, 'se cambia la tolerancia a 20');
    ok(
      (await s1.llamar('POST', '/api/admin/horarios/cierres', { token: admin, cuerpo: { desde: LUNES, hasta: LUNES, motivo: 'Prueba de cierre' } })).estado === 201,
      'se registra un cierre'
    );
    await s1.llamar('POST', '/api/admin/personal', { token: admin, cuerpo: { usuario: 'bibliotecario', nombre: 'Bibliotecaria', rol: 'circulacion', clave: 'Clave-Larga-Segura-7' } });
    await pausa(1500); // pasan los 300 ms de espera para guardar

    const r = await consultar(bd.url, 'select reserva, lugar, persona, estado, fecha::text as fecha from biblioteca.v_reservas where reserva = $1', [reserva.datos.id]);
    ok(
      r.length === 1 && r[0].lugar === 'Cubículo 1' && r[0].persona === 'Ana Pérez' && r[0].estado === 'reservado' && r[0].fecha === LUNES,
      `v_reservas muestra la reserva como tabla (${JSON.stringify(r[0])})`
    );
    ok((await consultar(bd.url, 'select persona, carne, estado from biblioteca.v_solicitudes_solvencia'))[0]?.persona === 'Luis Ramírez', 'v_solicitudes_solvencia muestra la solicitud');
    ok((await consultar(bd.url, 'select motivo from biblioteca.v_cierres'))[0]?.motivo === 'Prueba de cierre', 'v_cierres muestra el cierre');
    ok((await consultar(bd.url, "select valor->>'toleranciaMinutos' as t from biblioteca.almacen where nombre='configuracion'"))[0].t === '20', 'la configuración quedó guardada');
    const acciones = (await consultar(bd.url, 'select accion from biblioteca.v_actividad order by fecha')).map((f) => f.accion);
    ok(acciones.filter((a) => a === 'configuracion.cambiada').length === 1, `v_actividad muestra el cambio de configuración (acciones: ${acciones.join(', ')})`);
    ok(Number((await consultar(bd.url, "select count(*) as n from biblioteca.v_cuentas where usuario = 'bibliotecario'"))[0].n) === 1, 'v_cuentas muestra la cuenta nueva');
  } finally {
    s1.matar(); // a la fuerza: sin avisar ni vaciar nada
    await esperarSalida(s1, 3000);
  }

  const s2 = servidor(4113, bd.url);
  try {
    ok(await s2.listo(), 'otro servidor arranca con la misma base de datos');
    const circ = await s2.entrar('circulacion');
    const lista = await s2.llamar('GET', '/api/reservas', { token: circ });
    ok(lista.datos?.some((x) => x.id === reserva.datos.id && x.solicitante === 'Ana Pérez'), 'la reserva sigue ahí tras matar y reiniciar');
    const admin = await s2.entrar('admin');
    ok((await s2.llamar('GET', '/api/admin/configuracion', { token: admin })).datos.toleranciaMinutos === 20, 'la tolerancia sigue en 20');
    ok((await s2.llamar('GET', '/api/solvencia', { token: circ })).datos?.length === 1, 'la solicitud de solvencia sigue ahí');
    const propia = await s2.llamar('POST', '/api/auth/login', { cuerpo: { usuario: 'bibliotecario', clave: 'Clave-Larga-Segura-7' } });
    ok(propia.estado === 200, 'la cuenta creada desde el panel sigue pudiendo entrar');
    ok(!/No se pudo/.test(s2.log()), 'sin errores en la consola');
  } finally {
    s2.matar();
    await esperarSalida(s2, 3000);
  }
}

async function turno(bd) {
  console.log('El turno: una sola copia a la vez');
  await limpiar(bd.url);
  const a = servidor(4121, bd.url);
  let b;
  let c;
  try {
    ok(await a.listo(), 'la primera copia arranca y toma el turno');
    const reservaDeA = await reservar(a);
    await pausa(1200);

    b = servidor(4122, bd.url, { ESPERA_DEL_TURNO_S: '90' });
    await pausa(3500);
    const salud = await fetch('http://localhost:4122/health').then((r) => r.json()).catch(() => null);
    ok(salud?.data === 'iniciando', `la segunda copia contesta /health «iniciando» mientras espera (${JSON.stringify(salud)})`);
    const durante = await b.llamar('GET', '/api/tesis');
    ok(durante.estado === 503 && /iniciando/.test(durante.error ?? ''), `y a lo demás le dice que se está iniciando (${durante.estado})`);
    ok(/Esperando a que otra copia/.test(b.log()), 'la consola avisa que está esperando');
    ok(!b.estado.salio, 'la segunda copia no se cae mientras espera');

    a.matar(); // la primera se apaga: su conexión se cierra y suelta el turno
    ok(await b.listo(30000), 'cuando la primera termina, la segunda toma el turno y queda lista');
    const circ = await b.entrar('circulacion');
    const lista = await b.llamar('GET', '/api/reservas', { token: circ });
    ok(lista.datos?.some((x) => x.id === reservaDeA.datos.id), 'y trae lo que la primera había guardado');

    c = servidor(4123, bd.url, { ESPERA_DEL_TURNO_S: '3' });
    ok(await esperarSalida(c, 15000), 'una tercera copia que espera más de lo permitido termina');
    ok(c.estado.codigo === 1 && /Otra copia del servidor sigue usando esta base de datos/.test(c.log()), `con un mensaje claro y código 1 (${c.estado.codigo})`);

    const otra = await reservar(b, { recursoId: 'cub-2' });
    ok(otra.estado === 200, 'la segunda copia sigue funcionando');
    await pausa(1200);
    b.matar();
    await esperarSalida(b, 3000);
    const d = servidor(4124, bd.url);
    try {
      ok(await d.listo(), 'una cuarta copia arranca al terminar la segunda');
      const lista2 = await d.llamar('GET', '/api/reservas', { token: await d.entrar('circulacion') });
      ok(lista2.datos?.length === 2, `y no se perdió ninguna de las dos reservas (${lista2.datos?.length})`);
    } finally {
      d.matar();
      await esperarSalida(d, 3000);
    }
  } finally {
    for (const s of [a, b, c]) if (s) s.matar();
    await pausa(500);
  }
}

async function apagadoOrdenado(bd) {
  console.log('Apagado ordenado: se guarda lo pendiente');
  await limpiar(bd.url);
  const salida = [];
  const hijo = spawn(process.execPath, [path.join('auxiliar', 'hijo-apagado.cjs')], { cwd: AQUI, env: { ...process.env, ...SIN_CORREO, DATABASE_URL: bd.url }, stdio: ['ignore', 'pipe', 'pipe'] });
  hijo.stdout.on('data', (d) => salida.push(String(d)));
  hijo.stderr.on('data', (d) => salida.push(String(d)));
  const codigo = await new Promise((resolver) => hijo.on('exit', resolver));
  ok(codigo === 0, `el proceso sale con código 0 (${codigo}; ${salida.join('').trim().slice(0, 200)})`);
  const f = await consultar(bd.url, "select valor->>'n' as n from biblioteca.almacen where nombre = 'prueba_apagado'");
  ok(f[0]?.n === '42', 'lo pendiente (con espera de diez minutos) quedó guardado al apagar');
  ok(Number((await consultar(bd.url, "select count(*) as n from pg_locks where locktype = 'advisory'"))[0].n) === 0, 'y el turno quedó libre');
}

// Un puente de red entre el servidor y PostgreSQL que se puede cortar y restablecer: así se simula que la base de datos desaparece
// sin apagar PostgreSQL (en Windows apagarlo con conexiones abiertas deja procesos huérfanos).
function crearPuente(puertoDestino, servidorDestino) {
  const conexiones = new Set();
  let escucha = null;
  const abrir = (puerto) =>
    new Promise((resolver) => {
      escucha = net.createServer((cliente) => {
        const hacia = net.connect(puertoDestino, servidorDestino);
        conexiones.add(cliente);
        conexiones.add(hacia);
        cliente.pipe(hacia);
        hacia.pipe(cliente);
        const cerrar = () => {
          cliente.destroy();
          hacia.destroy();
          conexiones.delete(cliente);
          conexiones.delete(hacia);
        };
        cliente.on('error', cerrar);
        hacia.on('error', cerrar);
        cliente.on('close', cerrar);
        hacia.on('close', cerrar);
      });
      escucha.listen(puerto, '127.0.0.1', resolver);
    });
  const cortar = () =>
    new Promise((resolver) => {
      conexiones.forEach((c) => c.destroy());
      conexiones.clear();
      if (!escucha || !escucha.listening) return resolver();
      return escucha.close(() => resolver());
    });
  return { abrir, cortar };
}

async function caidaYRecuperacion(bd) {
  console.log('La base de datos desaparece y vuelve');
  await limpiar(bd.url);
  const puente = crearPuente(bd.puerto, bd.servidor);
  const puertoDelPuente = await puertoLibre();
  await puente.abrir(puertoDelPuente);
  const urlPorPuente = bd.con({ hostname: '127.0.0.1', port: String(puertoDelPuente) });
  const s = servidor(4131, urlPorPuente);
  try {
    ok(await s.listo(), 'el servidor arranca');
    const admin = await s.entrar('admin');
    await reservar(s);
    await pausa(1200);
    ok((await consultar(bd.url, 'select count(*) as n from biblioteca.v_reservas'))[0].n === '1', 'la primera reserva quedó en la base');

    await puente.cortar();
    const segunda = await reservar(s, { recursoId: 'cub-2' });
    ok(segunda.estado === 200, 'sin base de datos el servidor sigue atendiendo (trabaja en memoria)');
    await pausa(7000);
    const situacion = await s.llamar('GET', '/api/admin/almacenamiento', { token: admin });
    const resumen = JSON.stringify({ e: situacion.datos?.ultimoError?.mensaje?.slice(0, 80), p: situacion.datos?.pendientes });
    ok(situacion.datos?.ultimoError && situacion.datos.pendientes >= 1, `el panel avisa del error y de lo pendiente (${resumen})`);
    ok(situacion.datos?.conectado === false, 'y que no hay conexión');
    ok(/No se pudo guardar/.test(s.log()), 'la consola también lo dice');
    ok((await s.llamar('GET', '/api/tesis')).estado === 200, 'la consulta del catálogo no se afecta');

    await puente.abrir(puertoDelPuente); // la base de datos vuelve
    let guardada = false;
    for (let i = 0; i < 60 && !guardada; i += 1) {
      await pausa(1000);
      guardada = Number((await consultar(bd.url, 'select count(*) as n from biblioteca.v_reservas'))[0].n) === 2;
    }
    ok(guardada, 'al volver la base de datos, lo pendiente se guarda solo (sin reiniciar el servidor)');
    await pausa(2000);
    const despues = await s.llamar('GET', '/api/admin/almacenamiento', { token: admin });
    const estadoFinal = JSON.stringify({ p: despues.datos?.pendientes, c: despues.datos?.conectado, e: despues.datos?.ultimoError?.mensaje?.slice(0, 60) });
    ok(despues.datos?.pendientes === 0 && despues.datos?.conectado === true && despues.datos?.ultimoError === null, `y todo vuelve a la normalidad (${estadoFinal})`);
    const turnos = await consultar(bd.url, "select count(*) as n from pg_locks where locktype = 'advisory'");
    ok(Number(turnos[0].n) === 1, 'el servidor volvió a tener el turno');
  } finally {
    s.matar();
    await esperarSalida(s, 3000);
    await puente.cortar().catch(() => {});
  }
}

async function respaldoYAlmacenamiento(bd) {
  console.log('Almacenamiento y respaldo (API)');
  await limpiar(bd.url);
  const s = servidor(4141, bd.url);
  try {
    ok(await s.listo(), 'arranca');
    const admin = await s.entrar('admin');
    await reservar(s);
    await pausa(1200);
    const st = await s.llamar('GET', '/api/admin/almacenamiento', { token: admin });
    ok(st.estado === 200 && st.datos.modo === 'postgres' && st.datos.conectado === true, 'el panel sabe que usa PostgreSQL y que está conectado');
    ok(st.datos.destino === `${bd.servidor}:${bd.puerto}/${bd.nombre}` && !JSON.stringify(st.datos).includes(`${bd.clave}@`), 'dice dónde, sin usuario ni clave');
    ok(st.datos.documentos.length === 10 && st.datos.documentos.every((d) => d.bytes > 0 && d.actualizadoEn), 'lista los 10 documentos con tamaño y fecha');
    const porNombre = Object.fromEntries(st.datos.documentos.map((d) => [d.nombre, d]));
    ok(porNombre.catalogo.registros === 7 && porNombre.reservas.registros === 1 && porNombre.cuentas.registros === undefined, 'y cuántos registros tiene cada lista');
    const r = await s.llamar('GET', '/api/admin/respaldo', { token: admin });
    ok(r.estado === 200 && /attachment; filename="respaldo-biblioteca-\d{4}-\d{2}-\d{2}\.json"/.test(r.cabeceras.get('content-disposition') ?? ''), 'el respaldo se descarga como archivo');
    const resp = JSON.parse(r.texto);
    ok(resp.version === 1 && Object.keys(resp.documentos).length === 8, 'trae los 8 documentos');
    ok(!/"sal"|"hash"/.test(r.texto), 'las cuentas van sin la sal ni la clave cifrada');
    ok(resp.documentos.reservas.reservas.length === 1, 'y la reserva está en el respaldo');
    const act = await s.llamar('GET', '/api/admin/actividad', { token: admin });
    ok(act.datos.registros.some((x) => x.accion === 'respaldo.descargado'), 'la descarga queda en la actividad');
    for (const rol of ['circulacion', 'tesis', 'consulta']) {
      const t = await s.entrar(rol);
      const a1 = await s.llamar('GET', '/api/admin/respaldo', { token: t });
      const a2 = await s.llamar('GET', '/api/admin/almacenamiento', { token: t });
      ok(a1.estado === 403 && a2.estado === 403, `${rol} no puede ver el almacenamiento ni descargar respaldos (403)`);
    }
    fs.writeFileSync(path.join(os.tmpdir(), 'respaldo-de-prueba.json'), r.texto);
  } finally {
    s.matar();
    await esperarSalida(s, 3000);
  }
}

function importador(url, args = []) {
  return new Promise((resolver) => {
    const salida = [];
    const hijo = spawn(process.execPath, ['scripts/importar-datos.js', ...args], { cwd: BACKEND, env: { ...process.env, ...SIN_CORREO, DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe'] });
    hijo.stdout.on('data', (d) => salida.push(String(d)));
    hijo.stderr.on('data', (d) => salida.push(String(d)));
    hijo.on('exit', (codigo) => resolver({ codigo, texto: salida.join('') }));
  });
}

async function importacion(bd) {
  console.log('Importar lo que ya había en archivos');
  await limpiar(bd.url);
  const carpeta = path.join(os.tmpdir(), `datos-viejos-${Date.now()}`);
  fs.mkdirSync(carpeta, { recursive: true });
  const configuracion = (tolerancia) => ({ toleranciaMinutos: tolerancia, maxHorasPorReserva: 8, maxHorasPorDia: 8, reservasPausadas: { cubiculo: false, estacion: false, sala_lectura: false }, actualizadaEn: null, actualizadaPor: null });
  fs.writeFileSync(
    path.join(carpeta, 'reservas.json'),
    JSON.stringify({
      reservas: [
        { id: 'R-001', tipo: 'cubiculo', recursoId: 'cub-1', recursoNombre: 'Cubículo 1', fecha: LUNES, hora: '10:00', horaFin: '11:00', duracion: 1, solicitante: 'Persona Vieja', identificacion: 'viejo-1', codigoConfirmacion: 'ABC234', estado: 'reservado', creadoEn: new Date().toISOString() },
      ],
      contador: 1,
    })
  );
  fs.writeFileSync(path.join(carpeta, 'configuracion.json'), JSON.stringify(configuracion(25)));

  let r = await importador(bd.url, [carpeta]);
  ok(r.codigo === 0 && /importado reservas/.test(r.texto) && /importado configuracion/.test(r.texto), `importa los archivos de una carpeta (${r.codigo})`);
  ok((await consultar(bd.url, 'select persona from biblioteca.v_reservas'))[0]?.persona === 'Persona Vieja', 'y se ven en las vistas');
  r = await importador(bd.url, [carpeta]);
  ok(r.codigo === 0 && /omitido {3}reservas: ya existe/.test(r.texto), 'una segunda vez no pisa lo que ya hay');
  fs.writeFileSync(path.join(carpeta, 'configuracion.json'), JSON.stringify(configuracion(30)));
  r = await importador(bd.url, [carpeta, '--forzar']);
  ok(r.codigo === 0 && /reemplazó al que había/.test(r.texto), 'con --forzar sí reemplaza');
  ok((await consultar(bd.url, "select valor->>'toleranciaMinutos' as t from biblioteca.almacen where nombre='configuracion'"))[0].t === '30', 'y el valor nuevo quedó');

  console.log('  Con un servidor encendido');
  const s = servidor(4151, bd.url);
  try {
    ok(await s.listo(), 'arranca un servidor con esos datos');
    ok((await s.llamar('GET', '/api/admin/configuracion', { token: await s.entrar('admin') })).datos.toleranciaMinutos === 30, 'el servidor usa los datos importados');
    r = await importador(bd.url, [carpeta, '--forzar']);
    ok(r.codigo === 1 && /Hay un servidor encendido/.test(r.texto), 'importar con un servidor encendido se niega (código 1)');
  } finally {
    s.matar();
    await esperarSalida(s, 3000);
  }

  console.log('  Desde un respaldo del panel');
  await limpiar(bd.url);
  r = await importador(bd.url, [path.join(os.tmpdir(), 'respaldo-de-prueba.json')]);
  ok(r.codigo === 0 && /omitido {3}cuentas: un respaldo no trae las claves/.test(r.texto), `importa un respaldo y omite las cuentas (${r.codigo})`);
  const s2 = servidor(4152, bd.url);
  try {
    ok(await s2.listo(), 'un servidor arranca con lo restaurado');
    const lista = await s2.llamar('GET', '/api/reservas', { token: await s2.entrar('circulacion') });
    ok(lista.datos?.length === 1, 'y trae la reserva del respaldo');
  } finally {
    s2.matar();
    await esperarSalida(s2, 3000);
  }
  ok(Number((await consultar(bd.url, "select count(*) as n from biblioteca.registros where coleccion = 'reservas'"))[0].n) === 1, 'lo importado queda con una fila por registro');

  console.log('  Desde el .zip que llega por correo');
  await limpiar(bd.url);
  const zip = path.join(os.tmpdir(), 'respaldo-de-prueba.zip');
  fs.writeFileSync(zip, crearZip([
    { nombre: 'LEEME.txt', contenido: 'cómo restaurar' },
    { nombre: 'respaldo-biblioteca.json', contenido: fs.readFileSync(path.join(os.tmpdir(), 'respaldo-de-prueba.json')) },
  ]));
  r = await importador(bd.url, [zip]);
  ok(r.codigo === 0 && /importado reservas/.test(r.texto) && /importado catalogo/.test(r.texto), `importa el .zip tal cual (${r.codigo} ${r.texto.split('\n').slice(-3).join(' ')})`);
  ok((await consultar(bd.url, 'select persona from biblioteca.v_reservas'))[0]?.persona === 'Ana Pérez', 'y la reserva se ve en la vista');
  fs.rmSync(zip, { force: true });
}

// Las listas largas se guardan con una fila por registro: cambiar un registro escribe esa fila y no las demás.
async function filasPorRegistro(bd) {
  console.log('Una fila por registro');
  await limpiar(bd.url);
  const filas = (coleccion) => consultar(bd.url, 'select id, orden::int as orden, actualizado from biblioteca.registros where coleccion = $1 order by orden', [coleccion]);
  const s = servidor(4171, bd.url);
  let ordenAntes;
  try {
    ok(await s.listo(), 'arranca');
    const tesis = await s.entrar('tesis');
    const admin = await s.entrar('admin');
    await pausa(1200);
    const alArrancar = await filas('catalogo');
    ok(alArrancar.length === 7 && alArrancar.map((f) => f.orden).join() === '1,2,3,4,5,6,7', `el catálogo de ejemplo queda en 7 filas, en orden (${alArrancar.map((f) => f.orden).join()})`);
    const documento = (await consultar(bd.url, "select valor from biblioteca.almacen where nombre = 'catalogo'"))[0].valor;
    ok(documento.tesis === undefined, 'y el documento del catálogo ya no lleva la lista adentro');

    // Cambiar una tesis: solo su fila se vuelve a escribir.
    await pausa(1100);
    const cambio = await s.llamar('PATCH', '/api/admin/catalogo/T-2023-00098', { token: tesis, cuerpo: { titulo: 'Título cambiado para probar las filas' } });
    ok(cambio.estado === 200, 'se cambia el título de una tesis');
    await pausa(1200);
    const trasCambiar = await filas('catalogo');
    const tocadas = trasCambiar.filter((f, i) => f.actualizado.getTime() !== alArrancar[i].actualizado.getTime()).map((f) => f.id);
    ok(tocadas.join() === 'T-2023-00098', `solo se escribió la fila de esa tesis (${tocadas.join() || 'ninguna'})`);
    ok((await consultar(bd.url, "select titulo from biblioteca.v_tesis where codigo = 'T-2023-00098'"))[0]?.titulo === 'Título cambiado para probar las filas', 'y la vista muestra el cambio');

    // Agregar y quitar: las demás filas no se tocan y el orden se conserva.
    await s.llamar('POST', '/api/admin/catalogo', { token: tesis, cuerpo: { id: 'F-001', titulo: 'Tesis agregada para probar las filas', autor: 'Autora, Una', anio: '2024' } });
    await s.llamar('DELETE', '/api/admin/catalogo/T-2022-00071', { token: admin });
    await pausa(1200);
    const trasQuitar = await filas('catalogo');
    ok(trasQuitar.length === 7 && !trasQuitar.some((f) => f.id === 'T-2022-00071'), 'la tesis borrada ya no tiene fila');
    ok(trasQuitar.at(-1).id === 'F-001' && trasQuitar.at(-1).orden === 8, `la nueva va al final con el número siguiente (${trasQuitar.at(-1).id} ${trasQuitar.at(-1).orden})`);
    const intactas = trasQuitar.filter((f) => f.id !== 'F-001').every((f) => f.actualizado.getTime() === trasCambiar.find((x) => x.id === f.id).actualizado.getTime());
    ok(intactas, 'agregar y quitar no reescribe las demás filas');
    ordenAntes = (await s.llamar('GET', '/api/admin/catalogo?porPagina=100', { token: tesis })).datos.items.map((t) => t.id).join();

    // Reservas: cada una es una fila; cancelar una escribe solo esa.
    const r1 = await reservar(s);
    const r2 = await reservar(s, { recursoId: 'cub-2' });
    await pausa(1200);
    const reservasAntes = await filas('reservas');
    ok(reservasAntes.map((f) => f.id).join() === `${r1.datos.id},${r2.datos.id}`, `cada reserva es una fila (${reservasAntes.map((f) => f.id).join()})`);
    ok((await consultar(bd.url, "select valor from biblioteca.almacen where nombre = 'reservas'"))[0].valor.contador === 2, 'y el contador sigue en el documento');
    await pausa(1100);
    const circ = await s.entrar('circulacion');
    const cancelada = await s.llamar('PATCH', `/api/reservas/item/${r1.datos.id}/cancelar`, { token: circ, cuerpo: {} });
    ok(cancelada.estado === 200, `se cancela la primera (${cancelada.estado} ${cancelada.error ?? ''})`);
    await pausa(1200);
    const reservasDespues = await filas('reservas');
    ok(
      reservasDespues[0].actualizado.getTime() !== reservasAntes[0].actualizado.getTime() && reservasDespues[1].actualizado.getTime() === reservasAntes[1].actualizado.getTime(),
      'solo se escribió la fila de la reserva cancelada'
    );
    ok((await consultar(bd.url, 'select estado from biblioteca.v_reservas where reserva = $1', [r1.datos.id]))[0]?.estado === 'cancelado', 'y la vista la muestra cancelada');

    // Reemplazar todo el catálogo: quedan solo las filas nuevas.
    const reemplazo = await s.llamar('POST', '/api/admin/catalogo/importar', {
      token: admin,
      cuerpo: { reemplazar: true, filas: [1, 2, 3].map((n) => ({ id: `N-00${n}`, titulo: `Tesis nueva número ${n}`, autor: 'Autor, Otro', anio: '2020' })) },
    });
    ok(reemplazo.estado === 200 && reemplazo.datos.creadas === 3, 'se reemplaza todo el catálogo por tres tesis');
    await pausa(1200);
    ok((await filas('catalogo')).map((f) => f.id).join() === 'N-001,N-002,N-003', 'y en la base quedan solo esas tres filas');
    await s.llamar('POST', '/api/admin/catalogo/importar', { token: admin, cuerpo: { reemplazar: true, filas: ordenAntes.split(',').map((id) => ({ id, titulo: `Tesis ${id} otra vez`, autor: 'Autor, Otro', anio: '2021' })) } });
    await pausa(1200);
  } finally {
    s.matar();
    await esperarSalida(s, 3000);
  }

  const s2 = servidor(4172, bd.url);
  try {
    ok(await s2.listo(), 'otro servidor arranca con esas filas');
    const tesis = await s2.entrar('tesis');
    const lista = (await s2.llamar('GET', '/api/admin/catalogo?porPagina=100', { token: tesis })).datos;
    ok(lista.total === 7 && lista.items.every((t) => /otra vez/.test(t.titulo)), 'y arma el catálogo completo desde las filas');
    const reservas = (await s2.llamar('GET', '/api/reservas', { token: await s2.entrar('circulacion') })).datos;
    ok(reservas.length === 2 && reservas.filter((r) => r.estado === 'cancelado').length === 1, 'las reservas también, con su estado');
    const nueva = await reservar(s2, { recursoId: 'cub-3' });
    ok(nueva.datos?.id === 'R-003', `la numeración sigue donde iba (${nueva.datos?.id})`);
    ok(!/pasó a guardarse|sin identificador/.test(s2.log()), 'sin volver a pasar nada de formato');
  } finally {
    s2.matar();
    await esperarSalida(s2, 3000);
  }
}

// Una base de datos guardada por la versión anterior (cada lista dentro de su documento) se pasa sola a filas al arrancar.
async function formatoAnterior(bd) {
  console.log('Datos guardados con el formato anterior');
  await limpiar(bd.url);
  // El primer arranque crea el esquema; después se deja la base como la tendría la versión anterior.
  const s0 = servidor(4173, bd.url);
  ok(await s0.listo(), 'un servidor crea el esquema');
  await pausa(1200);
  s0.matar();
  await esperarSalida(s0, 3000);
  const tesisVieja = (id, titulo) => ({ id, titulo, autor: 'Autor, Viejo', anio: '2019', tipoDocumento: 'tesis_grado', temas: ['Derecho civil'], documentoDigital: { acceso: 'sin_acceso', activo: true, urlExterna: null }, qr: { activo: true } });
  const viejo = {
    catalogo: { tesis: [tesisVieja('V-001', 'Primera tesis del formato anterior'), tesisVieja('V-002', 'Segunda tesis del formato anterior')] },
    reservas: {
      contador: 7,
      reservas: [{ id: 'R-007', tipo: 'cubiculo', recursoId: 'cub-1', recursoNombre: 'Cubículo 1', fecha: LUNES, hora: '10:00', horaFin: '11:00', duracion: 1, solicitante: 'Persona Anterior', identificacion: 'anterior-1', codigoConfirmacion: 'ABC234', estado: 'reservado', creadoEn: new Date().toISOString() }],
    },
    eventos: { eventos: [{ tipo: 'busqueda_opac', kiosco: null, tesisId: null, creadoEn: new Date().toISOString() }, { tipo: 'acceso_qr', kiosco: null, tesisId: 'V-001', creadoEn: new Date().toISOString() }] },
  };
  for (const [nombre, valor] of Object.entries(viejo)) {
    await consultar(bd.url, 'update biblioteca.almacen set valor = $2::jsonb where nombre = $1', [nombre, JSON.stringify(valor)]);
  }
  // Filas que ya no valen (como si se hubiera vuelto un tiempo a la versión anterior): la lista del documento manda.
  await consultar(bd.url, "delete from biblioteca.registros where coleccion in ('reservas', 'eventos')");
  ok(Number((await consultar(bd.url, "select count(*) as n from biblioteca.registros where coleccion = 'catalogo'"))[0].n) === 7, 'quedan filas viejas del catálogo de ejemplo');

  const s = servidor(4174, bd.url);
  try {
    ok(await s.listo(), 'el servidor arranca con esos datos');
    ok(/«catalogo» pasó a guardarse con una fila por registro \(2\)/.test(s.log()) && /«reservas» pasó a guardarse con una fila por registro \(1\)/.test(s.log()), 'la consola dice qué pasó a filas');
    const catalogo = await s.llamar('GET', '/api/tesis');
    ok(catalogo.datos.total === 2 && catalogo.datos.items.every((t) => t.id.startsWith('V-')), `el catálogo es el del documento, no el de las filas viejas (${catalogo.datos.total})`);
    const reservas = (await s.llamar('GET', '/api/reservas', { token: await s.entrar('circulacion') })).datos;
    ok(reservas.length === 1 && reservas[0].solicitante === 'Persona Anterior', 'la reserva sigue');
    await pausa(1500);
    const ids = (await consultar(bd.url, "select id from biblioteca.registros where coleccion = 'catalogo' order by orden")).map((f) => f.id);
    ok(ids.join() === 'V-001,V-002', `en la base quedan solo las filas del documento (${ids.join()})`);
    const documentos = Object.fromEntries((await consultar(bd.url, "select nombre, valor from biblioteca.almacen where nombre in ('catalogo', 'reservas', 'eventos')")).map((f) => [f.nombre, f.valor]));
    ok(documentos.catalogo.tesis === undefined && documentos.reservas.reservas === undefined && documentos.reservas.contador === 7, 'los documentos quedan sin su lista y con lo demás');
    ok((await consultar(bd.url, 'select persona from biblioteca.v_reservas'))[0]?.persona === 'Persona Anterior', 'las vistas muestran lo pasado');
    const eventos = await consultar(bd.url, "select id, datos->>'tipo' as tipo from biblioteca.registros where coleccion = 'eventos' order by orden");
    ok(eventos.length === 2 && eventos.map((e) => e.id).join() === '1,2' && documentos.eventos.eventos === undefined, `los eventos reciben su número y pasan a filas (${eventos.map((e) => e.id).join()})`);
    const nueva = await reservar(s, { recursoId: 'cub-2' });
    ok(nueva.datos?.id === 'R-008', `la numeración de reservas continúa (${nueva.datos?.id})`);
  } finally {
    s.matar();
    await esperarSalida(s, 3000);
  }
}

async function erroresDeConexion(bd) {
  console.log('Errores de conexión: mensajes claros y sin mostrar la clave');
  const casos = [
    ['clave equivocada', bd.con({ password: 'secreta-mala' }), /usuario o la clave de la base de datos no son correctos/, 'secreta-mala'],
    ['base que no existe', bd.con({ pathname: '/no_existe_prueba' }), /esa base de datos no existe/, null],
    ['servidor apagado', `postgres://postgres:otra-clave@127.0.0.1:${await puertoLibre()}/biblioteca`, /rechazó la conexión/, 'otra-clave'],
    ['dirección mal escrita', 'esto no es una direccion', /DATABASE_URL no parece una dirección de PostgreSQL/, null],
    ['otro tipo de dirección', 'mysql://u:p@h/b', /debe empezar con postgresql/, null],
  ];
  for (const [nombre, url, patron, secreto] of casos) {
    const s = servidor(4161, url, { DATABASE_INTENTOS: '1' });
    const salio = await esperarSalida(s, 20000);
    ok(salio && s.estado.codigo === 1, `${nombre}: el servidor termina con código 1`);
    ok(patron.test(s.log()), `${nombre}: explica qué pasó («${s.log().split('\n').find((l) => l.includes('No se pudo')) ?? s.log().slice(0, 140)}»)`);
    ok(secreto === null || !s.log().includes(secreto), `${nombre}: la clave no aparece en la consola`);
    s.matar();
  }
}

async function codificacion(bd) {
  console.log('Una base de datos que no es UTF8 se rechaza con explicación');
  const latin1 = bd.con({ pathname: '/latin1_de_prueba' });
  await consultar(bd.url, 'drop database if exists latin1_de_prueba');
  await consultar(bd.url, "create database latin1_de_prueba encoding 'LATIN1' lc_collate 'C' lc_ctype 'C' template template0");
  const s = servidor(4181, latin1, { DATABASE_INTENTOS: '1' });
  const salio = await esperarSalida(s, 20000);
  ok(salio && s.estado.codigo === 1, 'el servidor no arranca con una base LATIN1 (código 1)');
  ok(/usa la codificación LATIN1 y la biblioteca necesita UTF8/.test(s.log()), 'y explica qué pasa');
  ok(/pgAdmin/.test(s.log()) && /CREATE DATABASE biblioteca WITH ENCODING 'UTF8'/.test(s.log()), 'con los pasos de pgAdmin y el SQL para arreglarlo');
  ok((await consultar(latin1, "select count(*) as n from information_schema.schemata where schema_name = 'biblioteca'"))[0].n === '0', 'sin dejar nada creado en esa base');
  s.matar();
  await esperarSalida(s, 3000);
  await consultar(bd.url, 'drop database if exists latin1_de_prueba').catch(() => {});
}

const ESCENARIOS = {
  arranque: arranqueYEsquema,
  codificacion,
  filas: filasPorRegistro,
  anterior: formatoAnterior,
  persistencia,
  turno,
  apagado: apagadoOrdenado,
  respaldo: respaldoYAlmacenamiento,
  importacion,
  errores: erroresDeConexion,
  caida: caidaYRecuperacion,
};
const elegidos = process.argv.slice(2);
const lista = elegidos.length > 0 ? elegidos : Object.keys(ESCENARIOS);

const bd = baseDePrueba();
try {
  for (const nombre of lista) await ESCENARIOS[nombre](bd);
} finally {
  await limpiar(bd.url).catch(() => {});
  console.log(`\n${comprobaciones} comprobaciones: ${fallos === 0 ? 'TODO BIEN' : `${fallos} FALLAS`}`);
}
process.exit(fallos === 0 ? 0 : 1);
