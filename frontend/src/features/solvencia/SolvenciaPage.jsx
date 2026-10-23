import { useEffect, useRef, useState } from 'react';
import { Check, Send } from 'lucide-react';
import { solvenciaApi } from './solvenciaApi';
import CampoDeFoto from './CampoDeFoto';
import { getErrorMessage } from '../../shared/api/axiosClient';
import { useKiosco } from '../../shared/kiosco/KioscoContext';
import AlertBanner from '../../shared/components/AlertBanner';
import Button from '../../shared/components/Button';
import Comprobante from '../../shared/components/Comprobante';
import Nota from '../../shared/components/Nota';
import Page from '../../shared/components/Page';
import { Checkbox, Input, Select } from '../../shared/components/FormField';
import { LIBRARY } from '../../shared/config/library';
import { diaDeLaSemana, fechaLarga, hoyISO, sumarDias } from '../../shared/utils/fechas';
import { correoValido, hayErrores, soloDigitos, textoEntre } from '../../shared/utils/validaciones';

const CAMPOS_INICIALES = {
  solicitante: '',
  identificacion: '',
  cui: '',
  programa: '',
  motivo: '',
  correo: '',
  ordenDePago: '',
  fechaPapeleria: '',
  esEstudiante: false,
  revise: false,
};

const SIN_FOTOS = { comprobante: null, orden_de_pago: null };

const FOTOS = [
  {
    tipo: 'comprobante',
    etiqueta: 'Foto del comprobante de pago',
    ayuda: 'La boleta de depósito del banco donde pagaste. Que se lea el número de orden de pago.',
  },
  {
    tipo: 'orden_de_pago',
    etiqueta: 'Foto de la orden de pago',
    ayuda: 'La orden que generaste en SIIF. Que se lea el detalle de pago.',
  },
];

const PROGRAMAS = [
  'Licenciatura en Ciencias Jurídicas y Sociales, Abogado y Notario',
  'Maestría en Derecho',
  'Doctorado en Derecho',
];

// El flujo del formulario (propuesta, sección 4.5.4): ingreso de datos, validación, envío y confirmación.
const PASOS = ['Datos', 'Validación', 'Envío', 'Confirmación'];

function Pasos({ actual }) {
  return (
    <ol aria-label="Pasos de la solicitud" className="flex flex-wrap gap-2">
      {PASOS.map((nombre, i) => {
        const hecho = i < actual;
        const activo = i === actual;
        return (
          <li
            key={nombre}
            aria-current={activo ? 'step' : undefined}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
              activo ? 'bg-primary text-white shadow-sm' : hecho ? 'bg-blue-50 text-primary' : 'bg-surface text-slate-500'
            }`}
          >
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${activo ? 'bg-white/25' : hecho ? 'bg-primary text-white' : 'bg-white'}`}>
              {hecho ? <Check size={12} aria-hidden="true" /> : i + 1}
            </span>
            {nombre}
          </li>
        );
      })}
    </ol>
  );
}

function validar(form, diasMaximos, fotos, fotosObligatorias) {
  const hoy = hoyISO();
  const errores = {};
  if (fotosObligatorias) {
    if (!fotos.comprobante) errores.comprobante = 'Sube la foto del comprobante de pago.';
    if (!fotos.orden_de_pago) errores.orden_de_pago = 'Sube la foto de la orden de pago.';
  } else if (Boolean(fotos.comprobante) !== Boolean(fotos.orden_de_pago)) {
    errores[fotos.comprobante ? 'orden_de_pago' : 'comprobante'] = 'Sube las dos fotos, o ninguna.';
  }
  if (!textoEntre(form.solicitante, 3, 80)) errores.solicitante = 'Escribe tu nombre completo.';
  if (!/^[0-9A-Za-z-]{5,15}$/.test(form.identificacion.trim())) errores.identificacion = 'Escribe tu carné (de 5 a 15 letras o números).';
  if (soloDigitos(form.cui).length !== 13) errores.cui = 'El CUI (el número de tu DPI) tiene 13 números.';
  if (!textoEntre(form.programa, 3, 120)) errores.programa = 'Escribe tu carrera o programa académico.';
  if (!form.motivo) errores.motivo = 'Elige el motivo de la solvencia.';
  if (!correoValido(form.correo)) errores.correo = 'Escribe un correo válido: ahí recibirás tu comprobante.';
  if (!/^[0-9A-Za-z-]{4,20}$/.test(form.ordenDePago.trim())) errores.ordenDePago = 'Escribe el número de tu orden de pago.';
  if (!form.fechaPapeleria) {
    errores.fechaPapeleria = 'Indica la fecha en la que presentarás tu papelería.';
  } else if (form.fechaPapeleria <= hoy) {
    errores.fechaPapeleria = 'Debe ser, como mínimo, mañana: la solicitud se envía con 24 horas de anticipación.';
  } else if (form.fechaPapeleria > sumarDias(hoy, diasMaximos)) {
    errores.fechaPapeleria = `Solo puedes pedir la solvencia con un máximo de ${diasMaximos} días de anticipación.`;
  } else if ([0, 6].includes(diaDeLaSemana(form.fechaPapeleria))) {
    errores.fechaPapeleria = 'Las solvencias se entregan de lunes a viernes: elige un día hábil.';
  }
  if (!form.esEstudiante) errores.esEstudiante = 'Este servicio es solo para estudiantes de la Facultad del Campus Central.';
  if (!form.revise) errores.revise = 'Confirma que revisaste tus datos antes de enviar.';
  return errores;
}

export default function SolvenciaPage() {
  const { kiosco } = useKiosco();
  const [reglas, setReglas] = useState(null);
  const [form, setForm] = useState(CAMPOS_INICIALES);
  const [fotos, setFotos] = useState(SIN_FOTOS);
  const [errores, setErrores] = useState({});
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [comprobante, setComprobante] = useState(null);
  const formulario = useRef(null);

  useEffect(() => {
    solvenciaApi
      .reglas()
      .then((res) => setReglas(res.data.data))
      .catch((err) => setError(getErrorMessage(err, 'No se pudo cargar la información del servicio')));
  }, []);

  const diasMaximos = reglas?.diasMaximosDeAnticipacion ?? 7;
  const hoy = hoyISO();
  // El paso que se resalta: 1 (datos) mientras se escribe; 2 (validación) si hay campos por corregir.
  const pasoActual = comprobante ? 3 : hayErrores(errores) ? 1 : 0;

  function cambiar(campo, valor) {
    setForm((previo) => ({ ...previo, [campo]: valor }));
    if (errores[campo]) setErrores((previo) => ({ ...previo, [campo]: '' }));
  }

  function cambiarFoto(tipo, foto) {
    setFotos((previas) => ({ ...previas, [tipo]: foto }));
    if (errores[tipo]) setErrores((previo) => ({ ...previo, [tipo]: '' }));
  }

  // En la web las dos fotos son obligatorias. En un kiosco (sin cámara) se pueden omitir: el personal revisa los papeles en el mostrador.
  const fotosObligatorias = !kiosco;

  async function enviar(e) {
    e.preventDefault();
    const encontrados = validar(form, diasMaximos, fotos, fotosObligatorias);
    setErrores(encontrados);
    if (hayErrores(encontrados)) {
      setError('Revisa los campos marcados.');
      formulario.current?.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    setEnviando(true);
    setError('');
    try {
      const { revise, ...datos } = form;
      const conFotos = fotos.comprobante && fotos.orden_de_pago;
      const res = await solvenciaApi.solicitar({
        ...datos,
        cui: soloDigitos(form.cui),
        kiosco,
        ...(conFotos ? { fotos: { comprobante: fotos.comprobante.dataUrl, orden_de_pago: fotos.orden_de_pago.dataUrl } } : {}),
      });
      setComprobante(res.data.data);
      setForm(CAMPOS_INICIALES); // el formulario se limpia al terminar: no queda nada para la persona siguiente
      setFotos(SIN_FOTOS);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo registrar la solicitud'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Page
      crumbs={[{ etiqueta: 'Inicio', to: '/' }, { etiqueta: 'Solicitud de solvencia' }]}
      title="Solicitud de solvencia"
      subtitle="Paz y salvo bibliotecario. Llena tus datos, revísalos y envía: al terminar recibes tu comprobante."
      ancho="formulario"
    >
      <div className="flex flex-col gap-6">
        <Pasos actual={pasoActual} />

        {comprobante ? (
          <Comprobante tipo="solvencia" registro={comprobante} textoNueva="Hacer otra solicitud" onNueva={() => setComprobante(null)} />
        ) : (
          <form
            ref={formulario}
            onSubmit={enviar}
            noValidate
            className="campos-grandes flex flex-col gap-7 rounded-2xl border border-border bg-white p-6 shadow-card sm:p-8"
          >
            <Nota tono="aviso" titulo="Solo para estudiantes de la Facultad">
              El servicio de solvencias aplica únicamente a estudiantes de la {LIBRARY.facultad} del Campus Central. Ten a la mano tu carné, tu DPI y el
              número de tu orden de pago ya pagada.
            </Nota>

            <AlertBanner>{error}</AlertBanner>

            <fieldset className="flex flex-col gap-4">
              <legend className="mb-1 font-display text-lg font-semibold text-slate-900">Tus datos</legend>
              <Input
                label="Nombre completo"
                required
                hint="Escríbelo tal como aparece en tu documento: si la solvencia sale con un error en el nombre no hay reposición."
                value={form.solicitante}
                error={errores.solicitante}
                autoComplete="name"
                onChange={(e) => cambiar('solicitante', e.target.value)}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Carné"
                  required
                  value={form.identificacion}
                  error={errores.identificacion}
                  hint="Tu número de carné universitario."
                  onChange={(e) => cambiar('identificacion', e.target.value)}
                />
                <Input
                  label="CUI (número de DPI)"
                  required
                  inputMode="numeric"
                  maxLength={17}
                  value={form.cui}
                  error={errores.cui}
                  hint={`13 números${form.cui ? ` · llevas ${soloDigitos(form.cui).length}` : ''}`}
                  onChange={(e) => cambiar('cui', e.target.value)}
                />
              </div>
              <Input
                label="Carrera o programa académico"
                required
                list="programas"
                value={form.programa}
                error={errores.programa}
                onChange={(e) => cambiar('programa', e.target.value)}
              />
              <datalist id="programas">
                {PROGRAMAS.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <Input
                label="Correo electrónico"
                required
                type="email"
                autoComplete="email"
                value={form.correo}
                error={errores.correo}
                hint="Ahí recibirás tu comprobante. Escríbelo con cuidado."
                onChange={(e) => cambiar('correo', e.target.value)}
                placeholder="correo@ejemplo.com"
              />
            </fieldset>

            <fieldset className="flex flex-col gap-4">
              <legend className="mb-1 font-display text-lg font-semibold text-slate-900">Tu trámite</legend>
              <Select
                label="Motivo de la solvencia"
                required
                value={form.motivo}
                error={errores.motivo}
                onChange={(e) => cambiar('motivo', e.target.value)}
              >
                <option value="">Selecciona un motivo</option>
                {(reglas?.motivos ?? []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Número de orden de pago"
                  required
                  value={form.ordenDePago}
                  error={errores.ordenDePago}
                  hint="El mismo de tu boleta de depósito bancario."
                  onChange={(e) => cambiar('ordenDePago', e.target.value)}
                />
                <Input
                  label="Fecha en que presentarás tu papelería"
                  required
                  type="date"
                  min={sumarDias(hoy, 1)}
                  max={sumarDias(hoy, diasMaximos)}
                  value={form.fechaPapeleria}
                  error={errores.fechaPapeleria}
                  hint={`Entre mañana y ${diasMaximos} días adelante, de lunes a viernes.`}
                  onChange={(e) => cambiar('fechaPapeleria', e.target.value)}
                />
              </div>
              {form.fechaPapeleria && !errores.fechaPapeleria ? (
                <p className="-mt-2 text-sm text-slate-600">Presentarás tu papelería el {fechaLarga(form.fechaPapeleria)}.</p>
              ) : null}
            </fieldset>

            <fieldset className="flex flex-col gap-4">
              <legend className="mb-1 font-display text-lg font-semibold text-slate-900">Fotos del pago</legend>
              <Nota tono="info" titulo="Antes de tomar las fotos, verifica">
                Que en el <b>detalle de pago</b> de la orden aparezca <i>Biblioteca (De mi Unidad Académica) – Solvencia de Biblioteca</i>, y que el{' '}
                <b>número de orden de pago</b> sea el mismo en la orden y en la boleta de depósito. Toma cada foto completa, de frente y con buena
                luz: si no se lee, la solicitud se rechaza.
                {fotosObligatorias ? null : ' En el kiosco puedes enviar sin fotos: lleva tu boleta y tu orden de pago al mostrador.'}
              </Nota>
              <div className="grid gap-5 sm:grid-cols-2">
                {FOTOS.map(({ tipo, etiqueta, ayuda }) => (
                  <CampoDeFoto key={tipo} etiqueta={etiqueta} ayuda={ayuda} foto={fotos[tipo]} error={errores[tipo]} onCambiar={(foto) => cambiarFoto(tipo, foto)} />
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-3.5">
              <legend className="mb-1 font-display text-lg font-semibold text-slate-900">Confirmaciones</legend>
              <Checkbox checked={form.esEstudiante} error={errores.esEstudiante} onChange={(e) => cambiar('esEstudiante', e.target.checked)}>
                Soy estudiante de la {LIBRARY.facultad} del Campus Central.
              </Checkbox>
              <Checkbox checked={form.revise} error={errores.revise} onChange={(e) => cambiar('revise', e.target.checked)}>
                Revisé mis datos. Sé que si la solvencia se emite con errores en el nombre, el CUI, el carné o la fecha de papelería no habrá reposición
                y tendré que pagar y tramitarla de nuevo.
              </Checkbox>
            </fieldset>

            <div className="flex flex-col gap-3 border-t border-border pt-6">
              {reglas?.entregaSiEnviasAhora ? (
                <p className="rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-950">
                  Si envías tu solicitud <b>ahora</b>, la entrega estimada es el <b>{fechaLarga(reglas.entregaSiEnviasAhora.fecha)}</b> a las{' '}
                  <b>{reglas.entregaSiEnviasAhora.hora}</b> horas. El personal revisará tu solicitud.
                </p>
              ) : null}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-sm text-xs leading-relaxed text-slate-500">
                  Solo se guardan los datos necesarios para tu solicitud. Al terminar, la pantalla se limpia para proteger tu privacidad.
                </p>
                <Button type="submit" variant="primary" icon={Send} disabled={enviando} className="px-8 py-3.5 text-base">
                  {enviando ? 'Enviando...' : 'Enviar solicitud'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </Page>
  );
}
