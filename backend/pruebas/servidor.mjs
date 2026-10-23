// Lo que comparten las pruebas: arrancar un servidor de la biblioteca aparte (puerto libre, datos temporales, claves de prueba),
// llamarlo y contar comprobaciones.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Claves de las cuatro cuentas iniciales en los servidores de prueba.
export const CLAVE_DE = { admin: 'Admin-prueba-1', circulacion: 'Circ-prueba-1', tesis: 'Tesis-prueba-1', consulta: 'Consulta-prueba-1' };
const CLAVES = { CLAVE_ADMIN: CLAVE_DE.admin, CLAVE_CIRCULACION: CLAVE_DE.circulacion, CLAVE_TESIS: CLAVE_DE.tesis, CLAVE_CONSULTA: CLAVE_DE.consulta };

// Lo que haya en el entorno de quien corre las pruebas no debe colarse en los servidores de prueba.
export const ENTORNO_LIMPIO = Object.fromEntries(
  [
    'DATABASE_URL', 'NODE_ENV', 'KIOSCOS_IP', 'TRUST_PROXY', 'CORS_ORIGIN', 'KEEPALIVE_URL', 'RENDER_EXTERNAL_URL', 'RESTABLECER_CLAVES', 'CSP', 'HSTS', 'RESPALDO_CORREO', 'RESPALDO_DIAS', 'RESPALDO_MAX_MB', 'RESPALDO_PRIMERA_REVISION_S', 'VERIFICAR_ENLACES_DIAS', 'VERIFICAR_ENLACES_PAUSA_MS', 'VERIFICAR_ENLACES_PRIMERA_S', 'VERIFICAR_ENLACES_REINTENTO_MS',
    'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_SECURE', 'CORREO_API', 'CORREO_API_KEY', 'CORREO_REMITENTE', 'CORREO_API_URL', 'CORREO_ESPERA_CONFIRMACION_MS', 'CORREO_TIEMPO_MS',
    'GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_TOKEN_URL', 'GMAIL_URL_DE_REGRESO',
  ].map((n) => [n, ''])
);

export const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

export function puertoLibre() {
  return new Promise((resolver, rechazar) => {
    const s = net.createServer();
    s.once('error', rechazar);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolver(port));
    });
  });
}

export function carpetaTemporal(nombre) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `biblioteca-prueba-${nombre}-`));
}

// Arranca un servidor y espera a que atienda. `datos` es su carpeta de datos (la misma carpeta en dos arranques seguidos conserva
// lo guardado); `env` agrega o cambia variables. Devuelve su dirección, su consola y cómo apagarlo.
// Apagarlo lo corta de golpe: lo que se cambió en el último instante puede no haberse guardado (el servidor guarda 0,3 s después del
// último cambio); una prueba que reinicia para comprobar lo guardado debe esperar antes con `pausa`.
export async function arrancarServidor({ datos, sitio = false, env = {} } = {}) {
  const puerto = await puertoLibre();
  const salida = [];
  const hijo = spawn(process.execPath, ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, ...ENTORNO_LIMPIO, ...CLAVES, PORT: String(puerto), DATA_DIR: datos, LIMITE_ESCRITURAS: '1000', SERVE_FRONTEND: sitio ? '1' : '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  hijo.stdout.on('data', (d) => salida.push(String(d)));
  hijo.stderr.on('data', (d) => salida.push(String(d)));
  const terminado = new Promise((resolver) => hijo.once('exit', resolver));
  const base = `http://localhost:${puerto}`;
  const parar = async () => {
    hijo.kill();
    await terminado;
  };
  for (let i = 0; i < 100; i += 1) {
    if (hijo.exitCode !== null) break;
    try {
      // «iniciando» es la respuesta mientras espera a la base de datos: todavía no atiende.
      const r = await fetch(`${base}/health`);
      if (r.ok && (await r.json()).data === 'ok') return { base, parar, salida, consola: () => salida.join('') };
    } catch {
      // todavía no abre el puerto
    }
    await pausa(150);
  }
  await parar();
  throw new Error(`El servidor de prueba no arrancó:\n${salida.join('')}`);
}

// Llamadas a la API de un servidor: `api('POST', '/reservas/estacion', { token, cuerpo })` y `entrar('admin')`.
export function cliente(base) {
  const api = async (metodo, ruta, { token, cuerpo } = {}) => {
    const r = await fetch(`${base}/api${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    return { estado: r.status, datos: json.data, error: json.error, cabeceras: r.headers };
  };
  const entrar = async (usuario, clave = CLAVE_DE[usuario]) => (await api('POST', '/auth/login', { cuerpo: { usuario, clave } })).datos?.token ?? null;
  return { api, entrar };
}

// Cuenta comprobaciones; solo imprime las que fallan. `terminar()` imprime el resumen y termina el proceso.
export function comprobador() {
  let total = 0;
  let fallos = 0;
  const ok = (condicion, descripcion) => {
    total += 1;
    if (!condicion) {
      fallos += 1;
      console.log('  FALLA:', descripcion);
    }
  };
  const terminar = () => {
    console.log(`${total} comprobaciones: ${fallos === 0 ? 'TODO BIEN' : `${fallos} FALLAS`}`);
    process.exit(fallos === 0 ? 0 : 1);
  };
  return { ok, terminar };
}
