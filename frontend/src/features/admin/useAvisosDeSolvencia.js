import { useEffect } from 'react';
import { solvenciaApi } from '../solvencia/solvenciaApi';

// Avisos en la PC de la administración cuando llega una solicitud de solvencia: lo dice en voz alta («Llegó una nueva solicitud de
// solvencia de María López») y muestra una notificación del sistema. Funciona mientras el panel esté abierto en esa PC, aunque la
// pestaña esté en segundo plano o la ventana minimizada. Cada PC elige si quiere voz y notificación (se guarda en ese navegador).

const CADA_CUANTO_MS = 20 * 1000;
const CLAVE_AVISADAS = 'solvencias_avisadas';
const CLAVE_PREFERENCIAS = 'avisos_de_solvencia';

// El panel escucha este evento para volver a cargar la lista cuando llega una solicitud.
export const EVENTO_SOLVENCIA_NUEVA = 'solvencia-nueva';

export function leerPreferencias() {
  try {
    return { voz: true, notificacion: true, ...JSON.parse(localStorage.getItem(CLAVE_PREFERENCIAS)) };
  } catch {
    return { voz: true, notificacion: true };
  }
}

export function guardarPreferencias(preferencias) {
  try {
    localStorage.setItem(CLAVE_PREFERENCIAS, JSON.stringify(preferencias));
  } catch {
    // sin almacenamiento: vale mientras la página siga abierta
  }
}

// Las que ya se avisaron, para no repetirlas (también entre pestañas). null: es la primera vez en este navegador.
function leerAvisadas() {
  try {
    const guardadas = JSON.parse(localStorage.getItem(CLAVE_AVISADAS));
    return Array.isArray(guardadas) ? new Set(guardadas) : null;
  } catch {
    return null;
  }
}

function guardarAvisadas(avisadas) {
  try {
    localStorage.setItem(CLAVE_AVISADAS, JSON.stringify([...avisadas].slice(-200)));
  } catch {
    // sin almacenamiento: puede repetir un aviso al recargar
  }
}

function decir(texto) {
  if (!('speechSynthesis' in window)) return;
  const dicho = new SpeechSynthesisUtterance(texto);
  const voces = window.speechSynthesis.getVoices();
  const voz = voces.find((v) => /^es[-_](GT|MX|US|419)/i.test(v.lang)) ?? voces.find((v) => /^es/i.test(v.lang));
  if (voz) dicho.voice = voz;
  dicho.lang = voz?.lang ?? 'es-MX';
  dicho.rate = 0.95;
  window.speechSynthesis.cancel(); // si quedó algo a medias, este aviso va primero
  window.speechSynthesis.speak(dicho);
}

function notificar(texto) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const aviso = new Notification('Solvencias · Biblioteca', { body: texto, icon: '/icono-biblioteca.png', tag: 'solvencia-nueva', renotify: true });
  aviso.onclick = () => {
    window.focus();
    aviso.close();
  };
}

export function anunciar(texto, preferencias = leerPreferencias()) {
  if (preferencias.voz) decir(texto);
  if (preferencias.notificacion) notificar(texto);
}

export function textoDelAviso(nuevas) {
  if (nuevas.length === 1) return `Llegó una nueva solicitud de solvencia de ${nuevas[0].solicitante}.`;
  return `Llegaron ${nuevas.length} nuevas solicitudes de solvencia.`;
}

// Solo para la administración, que es quien las resuelve.
export function useAvisosDeSolvencia(rol) {
  useEffect(() => {
    if (rol !== 'administrador') return undefined;
    let vigente = true;

    async function revisar() {
      try {
        const { data } = await solvenciaApi.resumen();
        if (!vigente) return;
        const recientes = data.data.recientes ?? [];
        const avisadas = leerAvisadas();
        if (avisadas === null) {
          // La primera vez no se anuncia lo que ya estaba esperando: solo lo que llegue desde ahora.
          guardarAvisadas(new Set(recientes.map((r) => r.id)));
          return;
        }
        const nuevas = recientes.filter((r) => !avisadas.has(r.id)).reverse();
        if (nuevas.length === 0) return;
        nuevas.forEach((r) => avisadas.add(r.id));
        guardarAvisadas(avisadas);
        anunciar(textoDelAviso(nuevas));
        window.dispatchEvent(new CustomEvent(EVENTO_SOLVENCIA_NUEVA, { detail: nuevas }));
      } catch {
        // sin conexión: se vuelve a intentar en la próxima vuelta
      }
    }

    revisar();
    // Con la pestaña en segundo plano el navegador frena los temporizadores a una vez por minuto: el aviso llega igual, un poco después.
    const intervalo = setInterval(revisar, CADA_CUANTO_MS);
    return () => {
      vigente = false;
      clearInterval(intervalo);
    };
  }, [rol]);
}
