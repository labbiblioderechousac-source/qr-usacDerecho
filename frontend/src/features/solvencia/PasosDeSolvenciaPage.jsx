import { Link } from 'react-router-dom';
import { QRCodeCanvas } from 'qrcode.react';
import { ArrowRight, Clock, Smartphone } from 'lucide-react';
import Nota from '../../shared/components/Nota';
import Page from '../../shared/components/Page';
import { LIBRARY } from '../../shared/config/library';
import { useSolvenciaDisponible } from '../../shared/config/useServicios';
import { useKiosco } from '../../shared/kiosco/KioscoContext';

// Cómo pedir la solvencia, con el proceso que la biblioteca publica en su sitio (sección Solvencias) y sus dos videos. En el kiosco
// de la entrada, donde no hay cámara para las fotos del pago, además muestra un código QR que abre el formulario en el celular.

const PASOS = [
  {
    titulo: 'Genera la orden de pago',
    texto: 'Entra a SIIF USAC (siif.usac.edu.gt) con tu usuario y genera la orden de pago de la solvencia de biblioteca.',
  },
  {
    titulo: 'Paga la orden en el banco',
    texto: 'Cancélala en una agencia de Banrural, Bantrab o G&T Continental. Guarda la boleta de depósito: le tomarás una foto.',
  },
  {
    titulo: 'Verifica la orden y la boleta',
    texto:
      'El número de orden de pago debe ser el mismo en la orden y en la boleta de depósito, y en el detalle de pago debe aparecer «Biblioteca (De mi Unidad Académica) – Solvencia de Biblioteca».',
  },
  {
    titulo: 'Llena el formulario y sube las fotos',
    texto:
      'Escribe tus datos tal como aparecen en tu DPI, el número de la orden y la fecha en que presentarás tu papelería, y sube una foto de la boleta de depósito y otra de la orden de pago.',
    formulario: true,
  },
  {
    titulo: 'Revisa tu correo',
    texto:
      'En unos minutos te llega la confirmación con los datos que enviaste. Si no llega en 5 minutos, revisa que el correo estuviera bien escrito y envía una nueva solicitud.',
  },
  {
    titulo: 'Recibe tu solvencia en PDF',
    texto: 'La biblioteca revisa el pago y te envía la constancia de solvencia por correo, en el horario de entrega. Imprímela para tus trámites.',
  },
];

const HORARIOS = [
  ['De 08:00 a 13:00', 'ese mismo día a las 15:00'],
  ['De 13:01 a 17:00', 'ese mismo día a las 18:00'],
  ['Después de las 17:00', 'a las 14:00 del siguiente día hábil'],
  ['Antes de las 08:00', 'ese mismo día a las 14:00'],
];

const VIDEOS = [
  { id: 'HaVEv74BTS4', titulo: 'Presentación del servicio de solvencias' },
  { id: 'PMQuj1tNq0s', titulo: 'Tutorial: cómo pedir tu solvencia' },
];

// El video se ve dentro de la página. `sandbox` sin ventanas emergentes: desde el kiosco nadie puede salir a YouTube con un clic.
function Video({ id, titulo }) {
  return (
    <figure className="flex flex-col gap-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-ink">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?rel=0`}
          title={titulo}
          loading="lazy"
          allow="encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          sandbox="allow-scripts allow-same-origin allow-presentation"
          className="absolute inset-0 h-full w-full"
        />
      </div>
      <figcaption className="text-sm font-semibold text-slate-700">{titulo}</figcaption>
    </figure>
  );
}

function CodigoParaElCelular({ direccion }) {
  return (
    <div className="flex flex-col items-center gap-5 rounded-2xl border-2 border-primary bg-white p-6 text-center shadow-card sm:flex-row sm:text-left">
      <div className="shrink-0 rounded-xl bg-white p-3 ring-1 ring-border">
        <QRCodeCanvas value={direccion} size={176} level="M" fgColor="#0f172a" bgColor="#ffffff" />
      </div>
      <div className="flex flex-col gap-2">
        <p className="flex items-center justify-center gap-2 font-display text-xl font-semibold text-slate-900 sm:justify-start">
          <Smartphone size={22} className="text-primary" aria-hidden="true" /> Hazla desde tu celular
        </p>
        <p className="text-slate-700">
          Escanea el código con la cámara de tu celular: se abre el formulario de solvencia y ahí puedes tomar las fotos de la boleta de depósito
          y de la orden de pago.
        </p>
        <p className="break-all font-mono text-xs text-slate-500">{direccion}</p>
      </div>
    </div>
  );
}

export default function PasosDeSolvenciaPage() {
  const { kiosco } = useKiosco();
  const { disponible } = useSolvenciaDisponible();
  const direccionDelFormulario = `${window.location.origin}/solvencia`;

  return (
    <Page
      crumbs={[{ etiqueta: 'Inicio', to: '/' }, { etiqueta: 'Cómo pedir tu solvencia' }]}
      title="Cómo pedir tu solvencia"
      subtitle="Paz y salvo bibliotecario: los pasos, los horarios de entrega y los videos de la biblioteca."
      ancho="formulario"
    >
      <div className="flex flex-col gap-8">
        {!disponible ? (
          <Nota tono="aviso" titulo={kiosco ? 'En este kiosco no se hace la solicitud' : 'La solicitud en línea está pausada'}>
            {kiosco
              ? 'Escanea el código de abajo con tu celular para hacerla ahí y subir las fotos del pago.'
              : 'Por el momento no se reciben solicitudes desde el sitio. Consulta en el mostrador de la biblioteca.'}
          </Nota>
        ) : null}

        {kiosco ? <CodigoParaElCelular direccion={direccionDelFormulario} /> : null}

        <Nota tono="info" titulo="Antes de empezar">
          El servicio es solo para estudiantes de la {LIBRARY.facultad} del Campus Central. Envía tu solicitud con al menos 24 horas y como máximo 7
          días de anticipación a la fecha en que presentarás tu papelería. Revisa bien tus datos: si la solvencia sale con un error en el nombre, el
          CUI, el carné o la fecha, <b>no hay reposición</b> y habría que pagar y tramitarla de nuevo.
        </Nota>

        <section aria-labelledby="pasos-titulo" className="flex flex-col gap-4">
          <h2 id="pasos-titulo" className="font-display text-2xl font-semibold text-slate-900">
            Los pasos
          </h2>
          <ol className="flex flex-col gap-3">
            {PASOS.map((paso, i) => (
              <li key={paso.titulo} className="flex gap-4 rounded-2xl border border-border bg-white p-5 shadow-card">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary font-display text-lg font-bold text-white">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold text-slate-900">{paso.titulo}</h3>
                  <p className="mt-1 text-slate-700">{paso.texto}</p>
                  {paso.formulario && disponible ? (
                    <Link to="/solvencia" className="mt-3 inline-flex items-center gap-1.5 font-semibold text-primary hover:underline">
                      Ir al formulario <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  ) : null}
                  {paso.formulario && kiosco ? <p className="mt-2 text-sm text-slate-500">En el kiosco: usa el código de arriba para hacerlo desde tu celular.</p> : null}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="horarios-titulo" className="flex flex-col gap-3 rounded-2xl border border-border bg-white p-5 shadow-card">
          <h2 id="horarios-titulo" className="flex items-center gap-2 font-display text-2xl font-semibold text-slate-900">
            <Clock size={22} className="text-action" aria-hidden="true" /> Cuándo llega tu solvencia
          </h2>
          <p className="text-slate-700">Se entrega de lunes a viernes; los días de asueto no hay entrega. Depende de la hora a la que envías la solicitud:</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[320px] text-left">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4 font-semibold">Si la envías</th>
                  <th className="py-2 font-semibold">La recibes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {HORARIOS.map(([envio, entrega]) => (
                  <tr key={envio}>
                    <td className="py-2.5 pr-4 font-semibold text-slate-900">{envio}</td>
                    <td className="py-2.5 text-slate-700">{entrega}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="videos-titulo" className="flex flex-col gap-4">
          <div>
            <h2 id="videos-titulo" className="font-display text-2xl font-semibold text-slate-900">
              Videos de la biblioteca
            </h2>
            <p className="mt-1 text-slate-700">Los mismos que la biblioteca publica en su página de Solvencias, con estos pasos.</p>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {VIDEOS.map((video) => (
              <Video key={video.id} {...video} />
            ))}
          </div>
        </section>

        {disponible ? (
          <div className="flex flex-col items-start gap-3 rounded-2xl bg-blue-50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-blue-950">¿Ya pagaste y tienes las fotos de la boleta y de la orden?</p>
            <Link to="/solvencia" className="inline-flex items-center gap-2 rounded-md bg-action px-6 py-3 font-semibold text-white shadow-sm hover:bg-action-dark">
              Hacer mi solicitud <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </div>
        ) : null}
      </div>
    </Page>
  );
}
