// El comprobante sale por correo solo, al reservar o al pedir la solvencia, y la respuesta dice cómo le fue al envío para que la pantalla
// no tenga que pedirle al estudiante que lo mande otra vez. El correo va a una API falsa (con la forma de la de Resend).
import fs from 'node:fs';
import http from 'node:http';
import { arrancarServidor, carpetaTemporal, cliente, comprobador, puertoLibre } from './servidor.mjs';

const { ok, terminar } = comprobador();

async function apiFalsa() {
  const recibidos = [];
  const comportamiento = { estado: 200, colgar: false };
  const servidor = http.createServer((req, res) => {
    let texto = '';
    req.on('data', (d) => (texto += d));
    req.on('end', () => {
      recibidos.push(JSON.parse(texto));
      if (comportamiento.colgar) return; // no contesta nunca
      res.writeHead(comportamiento.estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(comportamiento.estado < 300 ? { id: 'x' } : { message: 'You can only send testing emails to your own email address' }));
    });
  });
  const puerto = await puertoLibre();
  await new Promise((r) => servidor.listen(puerto, '127.0.0.1', r));
  return { recibidos, comportamiento, url: `http://127.0.0.1:${puerto}/emails`, parar: () => new Promise((r) => { servidor.closeAllConnections(); servidor.close(r); }) };
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
const reserva = (api, extra = {}) =>
  api('POST', '/reservas/estacion', { cuerpo: { recursoId: `est-${(carne % 30) + 1}`, fecha: LUNES, hora: '09:00', solicitante: 'Ana Pérez', identificacion: `2019${String((carne += 1)).padStart(5, '0')}`, ...extra } });

const datos = carpetaTemporal('aviso-correo');
const api = await apiFalsa();
try {
  console.log('Sin servicio de correo configurado');
  let servidor = await arrancarServidor({ datos });
  try {
    const { api: llamar } = cliente(servidor.base);
    const conCorreo = await reserva(llamar, { correo: 'ana@ejemplo.com' });
    ok(conCorreo.estado === 200 && conCorreo.datos.correoDeConfirmacion === 'simulado', `con correo pero sin servicio: «simulado» (${conCorreo.datos?.correoDeConfirmacion})`);
    const sinCorreo = await reserva(llamar);
    ok(sinCorreo.estado === 200 && sinCorreo.datos.correoDeConfirmacion === null, `sin correo: nada que avisar (${sinCorreo.datos?.correoDeConfirmacion})`);
  } finally {
    await servidor.parar();
  }

  console.log('Con el servicio de correo funcionando');
  const CON_API = { CORREO_API: 'resend', CORREO_API_KEY: 're_prueba', CORREO_REMITENTE: 'onboarding@resend.dev', CORREO_API_URL: api.url, CORREO_ESPERA_CONFIRMACION_MS: '1500' };
  servidor = await arrancarServidor({ datos, env: CON_API });
  try {
    const { api: llamar } = cliente(servidor.base);
    const enviada = await reserva(llamar, { correo: 'ana@ejemplo.com' });
    ok(enviada.estado === 200 && enviada.datos.correoDeConfirmacion === 'enviado', `la reserva dice que el comprobante salió (${enviada.datos?.correoDeConfirmacion})`);
    ok(api.recibidos.length === 1 && api.recibidos[0].to?.[0] === 'ana@ejemplo.com', 'y salió un solo correo, a esa dirección, sin que nadie lo pidiera');
    ok(/Confirmación de reserva/.test(api.recibidos[0].subject ?? ''), `con el asunto de la confirmación (${api.recibidos[0].subject})`);

    const solvencia = await llamar('POST', '/solvencia', {
      cuerpo: { solicitante: 'Luis Ramírez', identificacion: '201955321', cui: '2456 78901 0101', programa: 'Licenciatura en Ciencias Jurídicas y Sociales', motivo: 'Grado', correo: 'luis@ejemplo.com', ordenDePago: '88123456', fechaPapeleria: LUNES, esEstudiante: true, kiosco: 'k1' },
    });
    ok(solvencia.estado === 200 && solvencia.datos.correoDeConfirmacion === 'enviado', `la solicitud de solvencia también (${solvencia.estado} ${solvencia.datos?.correoDeConfirmacion ?? solvencia.error})`);

    console.log('Si el servicio rechaza el correo');
    api.comportamiento.estado = 422;
    const rechazada = await reserva(llamar, { correo: 'otra.persona@ejemplo.com' });
    ok(rechazada.estado === 200 && rechazada.datos.id, 'la reserva se hace igual');
    ok(rechazada.datos.correoDeConfirmacion === 'fallido', `y dice que el correo no salió, para que la pantalla lo avise (${rechazada.datos?.correoDeConfirmacion})`);

    console.log('Si el servicio no contesta');
    api.comportamiento.colgar = true;
    const antes = Date.now();
    const lenta = await reserva(llamar, { correo: 'ana@ejemplo.com' });
    const segundos = (Date.now() - antes) / 1000;
    ok(lenta.estado === 200 && lenta.datos.correoDeConfirmacion === 'pendiente', `la reserva no se queda esperando: dice que el correo va en camino (${lenta.datos?.correoDeConfirmacion})`);
    ok(segundos < 4, `y responde enseguida (${segundos.toFixed(1)} s)`);
  } finally {
    await servidor.parar();
  }
} finally {
  await api.parar();
  fs.rmSync(datos, { recursive: true, force: true });
}
terminar();
