// «Cómo hacer tu solvencia» editable desde el panel: los videos (pegando el enlace de YouTube de cualquier forma) y los pasos. Corre en
// dos fases con el mismo servidor reiniciado: en la segunda, lo guardado sigue ahí.
import { cliente, comprobador, pausa } from './servidor.mjs';

const { api, entrar } = cliente(process.env.BASE);
const { ok, terminar } = comprobador();
const admin = await entrar('admin');
const circulacion = await entrar('circulacion');

const VIDEOS = [
  { enlace: 'https://youtu.be/PMQuj1tNq0s?si=abc123', titulo: '  Tutorial   nuevo ' },
  { enlace: 'https://www.youtube.com/watch?v=HaVEv74BTS4&t=10s', titulo: 'Presentación' },
  { enlace: 'youtube.com/shorts/dQw4w9WgXcQ', titulo: 'Un corto' },
  { enlace: 'aqz-KE-bpKQ', titulo: 'Solo el código' },
];
const PASOS = [
  { titulo: 'Paga la orden', texto: 'En el banco, con la orden de SIIF.' },
  { titulo: 'Llena el formulario', texto: 'Con tus datos y las dos fotos.', conFormulario: true },
  { titulo: 'Espera tu correo', texto: 'Llega con la constancia.', conFormulario: 'si' },
];

if (process.env.FASE === 'escribir') {
  console.log('La guía original');
  let r = await api('GET', '/solvencia/guia');
  ok(r.estado === 200 && r.datos.videos.length === 2 && r.datos.pasos.length === 6, `sin sesión se lee la guía original (${r.estado})`);
  ok(r.datos.videos[0].id === 'HaVEv74BTS4' && r.datos.actualizadaEn === null, 'el primer video es la presentación de la biblioteca');
  ok(r.datos.pasos.filter((p) => p.conFormulario).length === 1, 'un solo paso lleva el botón del formulario');

  console.log('Quién la cambia');
  ok((await api('PUT', '/solvencia/guia', { cuerpo: { videos: VIDEOS, pasos: PASOS } })).estado === 401, 'sin sesión no');
  ok((await api('PUT', '/solvencia/guia', { token: circulacion, cuerpo: { videos: VIDEOS, pasos: PASOS } })).estado === 403, 'circulación no');

  console.log('Lo que no se acepta (y no cambia nada)');
  const rechaza = async (cuerpo, patron, que) => {
    const res = await api('PUT', '/solvencia/guia', { token: admin, cuerpo });
    ok(res.estado === 400 && patron.test(res.error ?? ''), `${que} (${res.estado} ${res.error})`);
  };
  await rechaza({ videos: [{ enlace: 'https://vimeo.com/123456', titulo: 'Otro sitio' }], pasos: PASOS }, /Video 1: pega el enlace de YouTube/, 'un video que no es de YouTube');
  await rechaza({ videos: [{ enlace: 'https://youtu.be/corto', titulo: 'Mal' }], pasos: PASOS }, /Video 1/, 'un enlace de YouTube sin el código del video');
  await rechaza({ videos: [...VIDEOS, VIDEOS[0]], pasos: PASOS }, /hasta 4 videos/, 'más de 4 videos');
  await rechaza({ videos: VIDEOS, pasos: [] }, /de 1 a 12 pasos/, 'sin pasos');
  await rechaza({ videos: VIDEOS, pasos: Array.from({ length: 13 }, () => PASOS[0]) }, /de 1 a 12 pasos/, 'más de 12 pasos');
  await rechaza({ videos: VIDEOS, pasos: [{ titulo: 'ab', texto: 'Texto del paso' }] }, /Paso 1, título/, 'un título de paso muy corto');
  await rechaza({ videos: VIDEOS, pasos: [PASOS[0], { titulo: 'Bien', texto: 'x'.repeat(601) }] }, /Paso 2, explicación/, 'una explicación demasiado larga');
  await rechaza({ videos: [{ enlace: 'aqz-KE-bpKQ', titulo: '' }], pasos: PASOS }, /Video 1, título/, 'un video sin título');
  await rechaza({ pasos: PASOS }, /Faltan los videos o los pasos/, 'sin la lista de videos');
  r = await api('GET', '/solvencia/guia');
  ok(r.datos.videos.length === 2 && r.datos.pasos.length === 6 && r.datos.actualizadaEn === null, 'después de los rechazos la guía sigue igual');

  console.log('Guardar');
  r = await api('PUT', '/solvencia/guia', { token: admin, cuerpo: { videos: VIDEOS, pasos: PASOS } });
  ok(r.estado === 200, `el administrador la guarda (${r.estado} ${r.error ?? ''})`);
  ok(
    JSON.stringify(r.datos.videos.map((v) => v.id)) === JSON.stringify(['PMQuj1tNq0s', 'HaVEv74BTS4', 'dQw4w9WgXcQ', 'aqz-KE-bpKQ']),
    `cada enlace queda como el código del video (${r.datos.videos.map((v) => v.id)})`,
  );
  ok(r.datos.videos[0].titulo === 'Tutorial nuevo', `los espacios de más se quitan («${r.datos.videos[0].titulo}»)`);
  ok(r.datos.pasos[1].conFormulario === true && !('conFormulario' in r.datos.pasos[2]) && !('conFormulario' in r.datos.pasos[0]), 'el botón del formulario solo queda donde vale true');
  ok(r.datos.actualizadaPor === 'admin' && Boolean(r.datos.actualizadaEn), 'queda quién y cuándo');
  const actividad = await api('GET', '/admin/actividad', { token: admin });
  ok((actividad.datos?.registros ?? []).some((a) => a.accion === 'solvencia.guia' && /4 videos y 3 pasos/.test(a.detalle)), 'queda en la actividad del personal');
  await pausa(800); // el servidor guarda 0,3 s después del último cambio, y entre fases se apaga de golpe
} else {
  console.log('Después de reiniciar el servidor');
  let r = await api('GET', '/solvencia/guia');
  ok(r.estado === 200 && r.datos.videos.length === 4 && r.datos.pasos.length === 3, `lo guardado sigue (${r.datos?.videos?.length} videos, ${r.datos?.pasos?.length} pasos)`);
  ok(r.datos.videos[0].id === 'PMQuj1tNq0s' && r.datos.pasos[0].titulo === 'Paga la orden', 'en el mismo orden');

  console.log('Volver a los originales');
  ok((await api('POST', '/solvencia/guia/restaurar', { token: circulacion })).estado === 403, 'circulación no puede');
  r = await api('POST', '/solvencia/guia/restaurar', { token: admin });
  ok(r.estado === 200 && r.datos.videos.length === 2 && r.datos.pasos.length === 6, `el administrador vuelve a la guía original (${r.estado})`);
  ok(r.datos.videos[1].id === 'PMQuj1tNq0s' && r.datos.actualizadaPor === 'admin', 'con los dos videos de la biblioteca, y queda quién lo hizo');
  r = await api('GET', '/solvencia/guia');
  ok(r.datos.pasos[3].conFormulario === true, 'la página pública ya muestra la original');
}

terminar();
