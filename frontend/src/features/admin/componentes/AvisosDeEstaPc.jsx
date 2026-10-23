import { useState } from 'react';
import { BellRing, Volume2 } from 'lucide-react';
import { Checkbox } from '../../../shared/components/FormField';
import { anunciar, guardarPreferencias, leerPreferencias } from '../useAvisosDeSolvencia';

// Si esta PC avisa con voz y con una notificación de Windows (cuando llega una solicitud de solvencia, o cuando un lugar se libera porque
// alguien no llegó). Cada PC elige: se guarda en su navegador.
export default function AvisosDeEstaPc({ titulo, ejemplo }) {
  const [preferencias, setPreferencias] = useState(leerPreferencias);
  const [permiso, setPermiso] = useState(() => ('Notification' in window ? Notification.permission : 'no_se_puede'));

  function cambiar(campo, valor) {
    const nuevas = { ...preferencias, [campo]: valor };
    setPreferencias(nuevas);
    guardarPreferencias(nuevas);
  }

  async function permitirNotificaciones() {
    setPermiso(await Notification.requestPermission());
  }

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-white px-4 py-3 text-sm">
      <span className="flex items-center gap-2 font-semibold text-slate-900">
        <BellRing size={18} className="text-primary" aria-hidden="true" /> {titulo}
      </span>
      <Checkbox checked={preferencias.voz} onChange={(e) => cambiar('voz', e.target.checked)}>
        Con voz
      </Checkbox>
      <Checkbox checked={preferencias.notificacion} onChange={(e) => cambiar('notificacion', e.target.checked)}>
        Notificación de Windows
      </Checkbox>
      {preferencias.notificacion && permiso === 'default' ? (
        <button type="button" onClick={permitirNotificaciones} className="text-xs font-semibold text-primary hover:underline">
          Permitir notificaciones
        </button>
      ) : null}
      {preferencias.notificacion && permiso === 'denied' ? <span className="text-xs text-amber-700">El navegador tiene bloqueadas las notificaciones de este sitio.</span> : null}
      <button type="button" onClick={() => anunciar(`Así suena el aviso: ${ejemplo}`, preferencias)} className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
        <Volume2 size={14} aria-hidden="true" /> Probar aviso
      </button>
    </div>
  );
}
