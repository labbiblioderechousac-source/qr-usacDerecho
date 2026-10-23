import { useState } from 'react';
import { Gavel } from 'lucide-react';
import { reservasApi } from '../../reservas/reservasApi';
import { getErrorMessage } from '../../../shared/api/axiosClient';
import AlertBanner from '../../../shared/components/AlertBanner';
import Button from '../../../shared/components/Button';
import Modal from '../../../shared/components/Modal';
import { Select, Textarea } from '../../../shared/components/FormField';

const DURACIONES = [
  [2, '2 horas'],
  [4, '4 horas'],
  [8, '8 horas'],
  [24, '1 día'],
  [48, '2 días'],
  [72, '3 días'],
  [168, '1 semana'],
];

const MOTIVOS_FRECUENTES = [
  'Mal uso del lugar de estudio',
  'Ruido o mal comportamiento en la sala',
  'Dejó el lugar sucio o con daños',
  'Uso indebido del equipo o del mobiliario',
  'Ocupó un lugar que no reservó',
];

// Sanción a mano: la persona queda sin poder reservar el tiempo elegido. Si dejó correo en alguna reserva, se le avisa con el motivo, y
// sus reservas de ese tiempo se cancelan. `persona`: { identificacion, solicitante, reservaId? }.
export default function ModalDeSancion({ persona, onCerrar, onHecho }) {
  const [horas, setHoras] = useState(48);
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState('');

  async function sancionar(e) {
    e.preventDefault();
    setTrabajando(true);
    setError('');
    try {
      const res = await reservasApi.sancionar({ identificacion: persona.identificacion, horas, motivo: motivo.trim(), reservaId: persona.reservaId });
      onHecho(res.data.data);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo registrar la sanción'));
      setTrabajando(false);
    }
  }

  return (
    <Modal
      open
      title="Sancionar en el servicio de reservas"
      onClose={trabajando ? undefined : onCerrar}
      ancho="max-w-lg"
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={trabajando}>
            Cancelar
          </Button>
          <Button variant="primary" type="submit" form="form-sancion" icon={Gavel} disabled={trabajando || motivo.trim().length < 3}>
            {trabajando ? 'Registrando...' : 'Sancionar'}
          </Button>
        </>
      }
    >
      <form id="form-sancion" onSubmit={sancionar} className="flex flex-col gap-4">
        <p className="text-sm text-slate-700">
          <b>{persona.solicitante}</b> (carné <span className="font-mono">{persona.identificacion}</span>) no podrá reservar ningún lugar de estudio durante el tiempo que
          elijas. Sus reservas de ese tiempo se cancelan y, si dejó su correo, le llega el aviso con el motivo.
        </p>
        <AlertBanner>{error}</AlertBanner>
        <Select label="Tiempo sin poder reservar" value={horas} onChange={(e) => setHoras(Number(e.target.value))}>
          {DURACIONES.map(([valor, texto]) => (
            <option key={valor} value={valor}>
              {texto}
            </option>
          ))}
        </Select>
        <div className="flex flex-col gap-2">
          <Textarea label="Motivo" required rows={3} maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} hint="Se le envía a la persona y queda en la actividad del personal." />
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_FRECUENTES.map((texto) => (
              <button
                key={texto}
                type="button"
                onClick={() => setMotivo(texto)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${motivo === texto ? 'border-primary bg-blue-50 text-primary' : 'border-border bg-white text-slate-600 hover:border-primary hover:text-primary'}`}
              >
                {texto}
              </button>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}
