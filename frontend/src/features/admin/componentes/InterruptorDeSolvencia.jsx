import { useEffect, useState } from 'react';
import { Globe, MonitorSmartphone } from 'lucide-react';
import { adminApi } from '../adminApi';
import { getErrorMessage } from '../../../shared/api/axiosClient';
import GuiaDeSolvencia from './GuiaDeSolvencia';

const CANALES = [
  { canal: 'web', nombre: 'En la web', icono: Globe, apagada: 'El formulario no aparece en el sitio' },
  { canal: 'kiosco', nombre: 'En los kioscos', icono: MonitorSmartphone, apagada: 'El kiosco muestra los pasos y un QR para el celular' },
];

// Habilitar o deshabilitar el trámite de solvencia, sin ir a Configuración (es el mismo ajuste). Donde se apaga, desaparece del menú y del
// inicio la opción del formulario y queda «Cómo hacer tu solvencia».
export default function InterruptorDeSolvencia() {
  const [disponible, setDisponible] = useState(null);
  const [guardando, setGuardando] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi
      .configuracion()
      .then((res) => setDisponible(res.data.data.solvenciaDisponible))
      .catch((err) => setError(getErrorMessage(err, 'No se pudo leer si el trámite está habilitado')));
  }, []);

  async function cambiar(canal) {
    setGuardando(canal);
    setError('');
    try {
      const res = await adminApi.guardarConfiguracion({ solvenciaDisponible: { [canal]: !disponible[canal] } });
      setDisponible(res.data.data.solvenciaDisponible);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo cambiar'));
    } finally {
      setGuardando('');
    }
  }

  if (!disponible) return error ? <p className="text-sm text-secondary">{error}</p> : null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-white px-4 py-3" aria-labelledby="tramite-de-solvencia">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="tramite-de-solvencia" className="text-sm font-bold text-slate-900">
          Trámite de solvencia
        </h2>
        <p className="text-xs text-slate-500">Donde lo deshabilites, en su lugar queda «Cómo hacer tu solvencia» con los pasos y el video.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {CANALES.map(({ canal, nombre, icono: Icono, apagada }) => {
          const activo = disponible[canal] !== false;
          return (
            <div key={canal} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${activo ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-300 bg-amber-50'}`}>
              <Icono size={18} className={activo ? 'text-emerald-700' : 'text-amber-700'} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">{nombre}</p>
                <p className="text-xs text-slate-600">{activo ? 'Recibiendo solicitudes' : apagada}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={activo}
                aria-label={`${activo ? 'Deshabilitar' : 'Habilitar'} el trámite de solvencia ${nombre.toLowerCase()}`}
                disabled={Boolean(guardando)}
                onClick={() => cambiar(canal)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 ${
                  activo ? 'bg-emerald-600' : 'bg-slate-300'
                }`}
              >
                <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${activo ? 'left-6' : 'left-1'}`} />
              </button>
            </div>
          );
        })}
      </div>
      {error ? <p className="text-xs font-medium text-secondary">{error}</p> : null}
      <GuiaDeSolvencia />
    </section>
  );
}
