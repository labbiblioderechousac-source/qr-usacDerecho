import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Mail, Printer } from 'lucide-react';
import Badge from './Badge';
import Button from './Button';
import AlertBanner from './AlertBanner';
import { Input } from './FormField';
import { LIBRARY } from '../config/library';
import { comprobantesApi } from '../api/comprobantesApi';
import { getErrorMessage } from '../api/axiosClient';
import { useKiosco } from '../kiosco/KioscoContext';
import { fechaLarga, fechaYHora } from '../utils/fechas';

// Constancia de una operación (propuesta, sección 4.5.5): se ve en pantalla con el mismo diseño y los mismos datos que el correo que
// recibe la persona (backend/utils/plantillaCorreo.js y notificaciones.js), se puede imprimir y se puede enviar por correo. Sirve para
// reservas y para solicitudes de solvencia. En el kiosco se imprime como ticket angosto (impresora térmica); en el sitio, la misma hoja
// que se ve en pantalla.

const TITULOS = { reserva: 'Confirmación de reserva', solvencia: 'Solicitud de solvencia recibida' };

// [etiqueta, valor, 'codigo'?]: con 'codigo', el valor se resalta como en el correo (números y códigos de confirmación).
function filasDe(tipo, r) {
  if (tipo === 'reserva') {
    return [
      ['Número de reserva', r.id, 'codigo'],
      ['Código de confirmación', r.codigoConfirmacion, 'codigo'],
      ['Lugar', r.recursoNombre],
      ...(r.modalidadNombre ? [['Tipo de reserva', r.modalidadNombre]] : []),
      ['Horario de uso', `${fechaLarga(r.fecha)}, de ${r.hora} a ${r.horaFin}${r.duracion > 1 ? ` (${r.duracion} horas)` : ''}`],
      ['A nombre de', r.solicitante],
    ];
  }
  if (tipo === 'solvencia') {
    return [
      ['Número de solicitud', r.id, 'codigo'],
      ['Código de confirmación', r.codigoConfirmacion, 'codigo'],
      ['Motivo', r.motivo],
      ['Solicitante', r.solicitante],
      ...(r.identificacion ? [['Carné', r.identificacion]] : []),
      ...(r.programa ? [['Programa', r.programa]] : []),
      ...(r.ordenDePago ? [['Orden de pago', r.ordenDePago]] : []),
      ...(r.fechaPapeleria ? [['Presentas tu papelería el', fechaLarga(r.fechaPapeleria)]] : []),
      ...(r.entregaEstimada ? [['Entrega estimada', `${fechaLarga(r.entregaEstimada.fecha)}, a las ${r.entregaEstimada.hora}`]] : []),
      ...(r.fotos ? [['Fotos recibidas', 'Comprobante de pago y orden de pago']] : []),
    ];
  }
  return [];
}

function instruccionesDe(tipo, toleranciaMinutos, horasDePenalizacion) {
  if (tipo === 'reserva') {
    const castigo = horasDePenalizacion > 0 ? ` y no podrás reservar ningún lugar de estudio durante ${horasDePenalizacion} horas` : '';
    const tolerancia = toleranciaMinutos ? ` Si no te presentas dentro de ${toleranciaMinutos} minutos del inicio, la reserva se libera${castigo}.` : '';
    return `Presenta el número de reserva o el código de confirmación en el mostrador.${tolerancia} La biblioteca puede cancelar una reserva si se incumple el reglamento del servicio.`;
  }
  return 'Tu solicitud será revisada por el personal de la biblioteca. Cuando se apruebe recibirás en tu correo tu constancia de solvencia en PDF; si hubiera algo que corregir, te escribiremos con el motivo. Revisa que tus datos estén correctos: si la solvencia se emite con datos incorrectos (nombres, CUI, carné o fecha) no hay reposición y habría que pagar y tramitarla de nuevo.';
}

// La hoja del comprobante, igual al correo: franja azul con la biblioteca, línea roja, el título, los datos y las indicaciones.
function Hoja({ titulo, operacion, filas, estado, instrucciones }) {
  return (
    <article className="mx-auto w-full max-w-[600px] overflow-hidden rounded-xl border border-border bg-white text-slate-900">
      <header className="bg-primary-dark px-6 py-5 text-white sm:px-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-200">{LIBRARY.facultad}</p>
        <p className="mt-1 font-display text-xl font-bold leading-snug">{LIBRARY.nombre}</p>
      </header>
      <div className="h-1 bg-action" aria-hidden="true" />

      <div className="px-6 py-6 sm:px-7">
        <h2 className="flex items-center gap-2 font-display text-[22px] font-semibold leading-snug text-primary">
          <CheckCircle2 size={22} className="shrink-0" aria-hidden="true" />
          {titulo}
        </h2>
        <dl className="mt-3.5 border-y border-border py-1.5">
          {[['Fecha de la operación', `${operacion.fecha} · ${operacion.hora}`], ...filas].map(([etiqueta, valor, estilo]) => (
            <div key={etiqueta} className="grid gap-x-3.5 py-[7px] sm:grid-cols-[36%_1fr]">
              <dt className="text-[13px] text-slate-600">{etiqueta}</dt>
              <dd className={`min-w-0 break-words ${estilo === 'codigo' ? 'font-mono text-[17px] font-bold tracking-wide' : 'text-[15px]'}`}>{valor}</dd>
            </div>
          ))}
          <div className="grid items-center gap-x-3.5 py-[7px] sm:grid-cols-[36%_1fr]">
            <dt className="text-[13px] text-slate-600">Estado</dt>
            <dd>
              <Badge tone={estado.tono} dot>
                {estado.texto}
              </Badge>
            </dd>
          </div>
        </dl>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">{instrucciones}</p>
      </div>

      <footer className="bg-surface px-6 py-4 text-xs leading-relaxed text-slate-600 sm:px-7">
        Guarda este comprobante: lleva tu número y tu código de confirmación.
        <br />
        {LIBRARY.universidad}
      </footer>
    </article>
  );
}

// Lo que sale por la impresora térmica del kiosco: un ticket angosto de 80 mm, con los mismos datos.
function Ticket({ titulo, operacion, filas, instrucciones }) {
  return (
    <div style={{ width: '72mm', fontFamily: 'monospace', fontSize: '11px', lineHeight: 1.45, color: '#000' }}>
      <p style={{ textAlign: 'center', fontWeight: 700, fontSize: '12px' }}>{LIBRARY.nombre}</p>
      <p style={{ textAlign: 'center' }}>{LIBRARY.facultad}</p>
      <hr style={{ border: 0, borderTop: '1px dashed #000', margin: '6px 0' }} />
      <p style={{ textAlign: 'center', fontWeight: 700 }}>{titulo.toUpperCase()}</p>
      <p style={{ textAlign: 'center' }}>
        Fecha: {operacion.fecha}  Hora: {operacion.hora}
      </p>
      <hr style={{ border: 0, borderTop: '1px dashed #000', margin: '6px 0' }} />
      {filas.map(([etiqueta, valor]) => (
        <p key={etiqueta}>
          <b>{etiqueta}:</b> {valor}
        </p>
      ))}
      <hr style={{ border: 0, borderTop: '1px dashed #000', margin: '6px 0' }} />
      <p>{instrucciones}</p>
      <p style={{ textAlign: 'center', marginTop: '8px' }}>Gracias por usar la biblioteca.</p>
    </div>
  );
}

export default function Comprobante({ tipo, registro, toleranciaMinutos, horasDePenalizacion = 0, textoNueva, onNueva }) {
  const { kiosco, registrarEvento } = useKiosco();
  const [imprimiendo, setImprimiendo] = useState(false);
  // Si dejó su correo, el servidor ya le mandó el comprobante al registrar la operación y dice cómo le fue (`correoDeConfirmacion`):
  // la pantalla solo lo cuenta. El campo para enviarlo aparece si no dejó correo, si el envío falló o si lo pide para otro correo.
  const aviso = registro.correoDeConfirmacion;
  const [otroCorreo, setOtroCorreo] = useState(false);
  const [correo, setCorreo] = useState(aviso === 'fallido' || aviso === undefined ? registro.correo || '' : '');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(null);
  const [error, setError] = useState('');

  const avisoAutomatico = {
    enviado: (
      <>
        Te enviamos este comprobante a <b>{registro.correo}</b>. Si no lo ves en unos minutos, revisa la carpeta de correo no deseado.
      </>
    ),
    pendiente: (
      <>
        Estamos enviando este comprobante a <b>{registro.correo}</b>; puede tardar unos minutos. Revisa también la carpeta de correo no deseado.
      </>
    ),
    fallido: (
      <>
        No pudimos enviar el comprobante a <b>{registro.correo}</b>. Revisa que el correo esté bien escrito y vuelve a intentarlo, o imprime
        este comprobante.
      </>
    ),
    simulado: (
      <>
        El correo de la biblioteca todavía no está activo, así que este comprobante no te llegará por correo: imprímelo o anota tu número y tu
        código.
      </>
    ),
  }[aviso];
  const mostrarFormulario = !registro.correo || aviso === undefined || aviso === 'fallido' || otroCorreo;

  const titulo = TITULOS[tipo];
  const operacion = fechaYHora(registro.creadoEn);
  const filas = filasDe(tipo, registro);
  const instrucciones = instruccionesDe(tipo, toleranciaMinutos, horasDePenalizacion);
  const estado = tipo === 'reserva' ? { tono: 'status', texto: 'Reservado' } : { tono: 'warning', texto: 'Pendiente de revisión' };
  const hoja = <Hoja titulo={titulo} operacion={operacion} filas={filas} estado={estado} instrucciones={instrucciones} />;
  // En el kiosco sale el ticket de la impresora térmica; en el sitio, la hoja tal como se ve.
  const conTicket = Boolean(kiosco);

  // Lo impreso se dibuja solo mientras se imprime; `afterprint` avisa cuando termina o se cancela.
  useEffect(() => {
    if (!imprimiendo) return undefined;
    const clase = conTicket ? 'imprimiendo-ticket' : 'imprimiendo-comprobante';
    document.body.classList.add(clase);
    const terminar = () => setImprimiendo(false);
    window.addEventListener('afterprint', terminar, { once: true });
    window.print();
    return () => {
      window.removeEventListener('afterprint', terminar);
      document.body.classList.remove(clase);
    };
  }, [imprimiendo, conTicket]);

  function imprimir() {
    registrarEvento('comprobante_impreso');
    setImprimiendo(true);
  }

  async function enviarPorCorreo(e) {
    e.preventDefault();
    setEnviando(true);
    setError('');
    setEnviado(null);
    try {
      const res = await comprobantesApi.enviar({
        tipo,
        id: registro.id,
        codigo: registro.codigoConfirmacion,
        correo,
        kiosco,
      });
      setEnviado(res.data.data);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo enviar el comprobante'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="entrar flex flex-col gap-4">
      {hoja}

      <div className="mx-auto flex w-full max-w-[600px] flex-col gap-3 rounded-xl border border-border bg-white p-5">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="brand" icon={Printer} onClick={imprimir}>
            Imprimir comprobante
          </Button>
          {onNueva ? (
            <button type="button" onClick={onNueva} className="text-sm font-bold text-primary hover:underline">
              {textoNueva}
            </button>
          ) : null}
        </div>

        {avisoAutomatico ? (
          <p className={`flex items-start gap-2 text-sm leading-relaxed ${aviso === 'fallido' ? 'text-amber-900' : 'text-slate-700'}`} role="status">
            <Mail size={16} className={`mt-0.5 shrink-0 ${aviso === 'fallido' ? 'text-amber-600' : 'text-primary'}`} aria-hidden="true" />
            <span>
              {avisoAutomatico}
              {(aviso === 'enviado' || aviso === 'pendiente') && !otroCorreo ? (
                <>
                  {' '}
                  <button type="button" onClick={() => setOtroCorreo(true)} className="font-semibold text-primary hover:underline">
                    Enviarlo a otro correo
                  </button>
                </>
              ) : null}
            </span>
          </p>
        ) : null}

        {mostrarFormulario ? (
          <form onSubmit={enviarPorCorreo} className="campos-grandes flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="sm:w-80">
              <Input
                label={registro.correo ? 'Enviar el comprobante a este correo' : '¿Lo quieres por correo? Escribe tu correo'}
                type="email"
                required
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                placeholder="correo@ejemplo.com"
              />
            </div>
            <Button type="submit" variant="secondary" icon={Mail} disabled={enviando || !correo.trim()} className="sm:h-12">
              {enviando ? 'Enviando...' : 'Enviar por correo'}
            </Button>
          </form>
        ) : null}
        <AlertBanner>{error}</AlertBanner>
        {enviado ? (
          <p className="text-sm text-slate-700">
            {enviado.simulado ? (
              <>
                El correo a <b>{enviado.para}</b> no pudo entregarse porque el servicio de correo de la biblioteca todavía no está activo. Imprime este comprobante o
                guarda tu número de solicitud.
              </>
            ) : (
              <>
                Comprobante enviado a <b>{enviado.para}</b>. Si no lo ves en unos minutos, revisa la carpeta de correo no deseado.
              </>
            )}
          </p>
        ) : null}
      </div>

      {imprimiendo
        ? createPortal(
            conTicket ? (
              <div id="ticket-impresion">
                <Ticket titulo={titulo} operacion={operacion} filas={filas} instrucciones={instrucciones} />
              </div>
            ) : (
              <div id="comprobante-impresion">{hoja}</div>
            ),
            document.body
          )
        : null}
    </div>
  );
}
