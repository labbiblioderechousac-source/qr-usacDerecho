import { useEffect } from 'react';
import { reservasApi } from '../reservas/reservasApi';
import { anunciar } from './useAvisosDeSolvencia';

// Avisa en la PC del mostrador cuando un lugar se libera porque la persona no llegó a su reserva («Se liberó la Estación 4: Ana Pérez no
// llegó»), con voz y notificación según lo que esa PC eligió. Para quien atiende las reservas: administración y circulación.

const CADA_CUANTO_MS = 30 * 1000;
const CLAVE_AVISADAS = 'reservas_liberadas_avisadas';

// El panel escucha este evento para volver a cargar las reservas cuando se libera un lugar.
export const EVENTO_LUGAR_LIBERADO = 'lugar-liberado';

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

function textoDelAviso(liberadas) {
  if (liberadas.length === 1) return `Se liberó ${liberadas[0].recursoNombre}: ${liberadas[0].solicitante} no llegó a su reserva.`;
  return `Se liberaron ${liberadas.length} lugares de personas que no llegaron a su reserva.`;
}

export function useAvisosDeReservas(rol) {
  useEffect(() => {
    if (!['administrador', 'circulacion'].includes(rol)) return undefined;
    let vigente = true;

    async function revisar() {
      try {
        const { data } = await reservasApi.resumen();
        if (!vigente) return;
        const recientes = data.data.liberadasRecientes ?? [];
        const avisadas = leerAvisadas();
        if (avisadas === null) {
          guardarAvisadas(new Set(recientes.map((r) => r.id))); // la primera vez no se anuncia lo que ya pasó
          return;
        }
        const nuevas = recientes.filter((r) => !avisadas.has(r.id)).reverse();
        if (nuevas.length === 0) return;
        nuevas.forEach((r) => avisadas.add(r.id));
        guardarAvisadas(avisadas);
        anunciar(textoDelAviso(nuevas));
        window.dispatchEvent(new CustomEvent(EVENTO_LUGAR_LIBERADO, { detail: nuevas }));
      } catch {
        // sin conexión: se vuelve a intentar en la próxima vuelta
      }
    }

    revisar();
    const intervalo = setInterval(revisar, CADA_CUANTO_MS);
    return () => {
      vigente = false;
      clearInterval(intervalo);
    };
  }, [rol]);
}
