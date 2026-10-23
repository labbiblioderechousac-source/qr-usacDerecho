import { useCallback, useEffect, useMemo, useState } from 'react';
import { BellRing, Check, FileDown, FolderCheck, FolderOpen, ImageOff, Loader2, RefreshCw, TriangleAlert, Volume2, X } from 'lucide-react';
import { solvenciaApi } from '../../solvencia/solvenciaApi';
import { usePaginaLocal } from '../usePaginaLocal';
import { useSesionAdmin } from '../SesionAdmin';
import { EVENTO_SOLVENCIA_NUEVA, anunciar, guardarPreferencias, leerPreferencias } from '../useAvisosDeSolvencia';
import { elegirCarpeta, estadoDeLaCarpeta, guardarEnLaPc, pedirPermiso } from '../carpetaDeSolvencias';
import { getErrorMessage } from '../../../shared/api/axiosClient';
import AlertBanner from '../../../shared/components/AlertBanner';
import Badge from '../../../shared/components/Badge';
import Button from '../../../shared/components/Button';
import Modal from '../../../shared/components/Modal';
import Nota from '../../../shared/components/Nota';
import Paginacion from '../../../shared/components/Paginacion';
import { Checkbox, Textarea } from '../../../shared/components/FormField';
import { fechaCorta } from '../../../shared/utils/fechas';
import BarraDeFiltros from '../componentes/BarraDeFiltros';
import PaginaAdmin from '../componentes/PaginaAdmin';
import { ESTADO_SOLVENCIA, fechaLegible } from '../estados';

const ENCABEZADOS = ['Solicitud', 'Solicitante', 'Trámite', 'Papelería y entrega', 'Fotos', 'Estado', 'Acción'];
const FOTOS = { comprobante: 'Comprobante de pago', orden_de_pago: 'Orden de pago' };
const pendiente = (s) => ['pendiente', 'en_revision'].includes(s.estado);

// Lo que se revisa antes de aprobar: las mismas verificaciones que la biblioteca le pide a la persona en su sitio.
const CHEQUEOS = [
  ['legibles', 'Las dos fotos se leen completas.'],
  ['detalle', 'En la orden de pago, el detalle dice «Biblioteca (De mi Unidad Académica) – Solvencia de Biblioteca».'],
  ['numero', 'El número de orden de pago es el mismo en la orden, en la boleta de depósito y en la solicitud.'],
];

const MOTIVOS_FRECUENTES = [
  'Las fotos no se leen. Tome de nuevo las fotos completas, de frente y con buena luz.',
  'El número de orden de pago no coincide con el de la boleta de depósito.',
  'El detalle de la orden de pago no corresponde a Solvencia de Biblioteca.',
  'El comprobante de pago ya fue presentado en otra solicitud.',
];

const TEXTO_DEL_CORREO = {
  enviado: 'Se le envió el correo.',
  pendiente: 'El correo va en camino.',
  simulado: 'El correo de la biblioteca no está configurado: no se envió ningún correo.',
  fallido: 'El correo no se pudo enviar (revisa la sección Correo).',
};

function descargar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- La carpeta de solvencias de esta PC ------------------------------------------------------------------------------

function CarpetaDeEstaPc({ carpeta, onCambio }) {
  const [error, setError] = useState('');

  async function elegir() {
    setError('');
    try {
      await elegirCarpeta();
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message || 'No se pudo usar esa carpeta. Prueba con otra (por ejemplo C:\\solvencias).');
    }
    onCambio();
  }

  async function permitir() {
    setError('');
    try {
      if (!(await pedirPermiso())) setError('El navegador no dio permiso. Vuelve a intentarlo y elige «Permitir».');
    } catch (err) {
      setError(err.message);
    }
    onCambio();
  }

  if (carpeta.estado === 'no_se_puede') {
    return (
      <Nota tono="aviso" titulo="Este navegador no puede guardar las fotos en la PC">
        Para aprobar o rechazar solicitudes con fotos usa <b>Google Chrome</b> o <b>Microsoft Edge</b> en la computadora de la biblioteca: las fotos se
        guardan ahí (en la carpeta de solvencias) y después se borran del sistema.
      </Nota>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white px-4 py-3">
      {carpeta.estado === 'lista' ? <FolderCheck size={20} className="text-emerald-600" aria-hidden="true" /> : <FolderOpen size={20} className="text-amber-600" aria-hidden="true" />}
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-slate-900">
          {carpeta.estado === 'lista' && `Las fotos se guardan en la carpeta «${carpeta.nombre}» de esta PC`}
          {carpeta.estado === 'sin_permiso' && `Carpeta «${carpeta.nombre}»: el navegador pide permiso otra vez`}
          {carpeta.estado === 'sin_carpeta' && 'Elige la carpeta de solvencias de esta PC'}
          {carpeta.estado === 'cargando' && 'Revisando la carpeta de solvencias...'}
        </p>
        <p className="text-xs text-slate-500">
          Al aprobar o rechazar, el comprobante va a <span className="font-mono">comprobante</span> y la orden a <span className="font-mono">orden_de_pago</span>{' '}
          (se crean solas). Crea la carpeta <span className="font-mono">C:\solvencias</span> y elígela.
        </p>
        {error ? <p className="mt-1 text-xs font-medium text-secondary">{error}</p> : null}
      </div>
      {carpeta.estado === 'sin_permiso' ? (
        <Button variant="brand" onClick={permitir}>
          Dar permiso
        </Button>
      ) : null}
      {carpeta.estado !== 'cargando' ? (
        <Button variant="secondary" icon={FolderOpen} onClick={elegir}>
          {carpeta.estado === 'sin_carpeta' ? 'Elegir carpeta' : 'Cambiar'}
        </Button>
      ) : null}
    </div>
  );
}

// --- Avisos con voz en esta PC ----------------------------------------------------------------------------------------

function AvisosDeEstaPc() {
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
        <BellRing size={18} className="text-primary" aria-hidden="true" /> Avisos cuando llega una solicitud
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
      <button
        type="button"
        onClick={() => anunciar('Así suena el aviso: llegó una nueva solicitud de solvencia.', preferencias)}
        className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
      >
        <Volume2 size={14} aria-hidden="true" /> Probar aviso
      </button>
    </div>
  );
}

// --- Revisión de una solicitud ----------------------------------------------------------------------------------------

function Miniatura({ titulo, foto, onAmpliar }) {
  if (foto?.cargando) {
    return (
      <div className="flex h-44 items-center justify-center rounded-xl border border-border bg-surface text-slate-400">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }
  if (!foto?.url) {
    return (
      <div className="flex h-44 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border bg-surface px-3 text-center text-xs text-slate-500">
        <ImageOff size={20} aria-hidden="true" />
        {foto?.error ?? 'Sin foto'}
      </div>
    );
  }
  return (
    <button type="button" onClick={onAmpliar} className="group relative block overflow-hidden rounded-xl border border-border bg-surface" title="Ampliar">
      <img src={foto.url} alt={titulo} className="h-44 w-full object-contain transition-transform group-hover:scale-[1.03]" />
      <span className="absolute bottom-1.5 right-1.5 rounded bg-ink/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">Clic para ampliar</span>
    </button>
  );
}

function ModalDeRevision({ solicitud, carpeta, onCarpeta, onCerrar, onHecho }) {
  const tiposConFoto = Object.keys(FOTOS).filter((tipo) => solicitud.fotos?.[tipo]);
  const conFotosEnElSistema = tiposConFoto.some((tipo) => solicitud.fotos[tipo].enRevision);
  const [fotos, setFotos] = useState(() => Object.fromEntries(tiposConFoto.map((tipo) => [tipo, { cargando: true }])));
  const [ampliada, setAmpliada] = useState(null);
  const [chequeos, setChequeos] = useState({});
  const [motivo, setMotivo] = useState('');
  const [trabajando, setTrabajando] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let vigente = true;
    const urls = [];
    tiposConFoto.forEach(async (tipo) => {
      try {
        const res = await solvenciaApi.foto(solicitud.id, tipo);
        const url = URL.createObjectURL(res.data);
        urls.push(url);
        if (vigente) setFotos((previas) => ({ ...previas, [tipo]: { url, blob: res.data } }));
      } catch (err) {
        const mensaje = err.response?.status === 404 ? 'La foto ya no está en el sistema' : 'No se pudo cargar la foto';
        if (vigente) setFotos((previas) => ({ ...previas, [tipo]: { error: mensaje } }));
      }
    });
    return () => {
      vigente = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solicitud.id]);

  const repetidas = solicitud.fotosRepetidas ?? {};
  const todoRevisado = CHEQUEOS.every(([clave]) => chequeos[clave]) || tiposConFoto.length === 0;
  const fotosListas = tiposConFoto.every((tipo) => fotos[tipo]?.blob);
  const faltaCarpeta = conFotosEnElSistema && carpeta.estado !== 'lista' && carpeta.estado !== 'sin_permiso';

  // Primero las fotos van a la PC; solo si quedaron guardadas se resuelve la solicitud (y el servidor las borra).
  async function resolver(accion) {
    setTrabajando(accion);
    setError('');
    try {
      let guardadas;
      if (conFotosEnElSistema) {
        if (!fotosListas) throw new Error('Las fotos todavía no se cargaron: no se pueden guardar en la PC.');
        guardadas = {};
        for (const tipo of tiposConFoto) {
          guardadas[tipo] = await guardarEnLaPc(tipo, solicitud.fotos[tipo].archivo, fotos[tipo].blob);
        }
        onCarpeta();
      }
      const res = accion === 'aprobar' ? await solvenciaApi.aprobar(solicitud.id, guardadas) : await solvenciaApi.rechazar(solicitud.id, motivo.trim(), guardadas);
      onHecho(res.data.data, accion);
    } catch (err) {
      setError(err.response ? getErrorMessage(err, 'No se pudo completar la acción') : err.message);
      setTrabajando('');
    }
  }

  return (
    <Modal open title={`Revisar la solicitud ${solicitud.id}`} onClose={trabajando ? undefined : onCerrar} ancho="max-w-3xl">
      <div className="flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-1.5 rounded-xl bg-surface px-4 py-3 text-sm sm:grid-cols-2">
          {[
            ['Solicitante', solicitud.solicitante],
            ['Carné', solicitud.identificacion],
            ['CUI', solicitud.cui],
            ['Motivo', solicitud.motivo],
            ['Orden de pago', solicitud.ordenDePago],
            ['Correo', solicitud.correo],
            ['Papelería', solicitud.fechaPapeleria ? fechaCorta(solicitud.fechaPapeleria) : '—'],
            ['Enviada', `${fechaLegible(solicitud.creadoEn)} · ${solicitud.kiosco ? `Kiosco ${solicitud.kiosco}` : 'Web'}`],
          ].map(([etiqueta, valor]) => (
            <div key={etiqueta} className="flex gap-2">
              <dt className="w-24 shrink-0 text-slate-500">{etiqueta}</dt>
              <dd className={`min-w-0 break-words font-semibold text-slate-900 ${etiqueta === 'Orden de pago' ? 'font-mono' : ''}`}>{valor}</dd>
            </div>
          ))}
        </dl>

        {tiposConFoto.length === 0 ? (
          <Nota tono="aviso" titulo="Sin fotos">
            Esta solicitud se envió desde un kiosco, sin fotos: revisa la boleta de depósito y la orden de pago en el mostrador antes de resolverla.
          </Nota>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {tiposConFoto.map((tipo) => (
              <figure key={tipo} className="flex flex-col gap-1.5">
                <figcaption className="text-sm font-semibold text-slate-900">{FOTOS[tipo]}</figcaption>
                <Miniatura titulo={FOTOS[tipo]} foto={fotos[tipo]} onAmpliar={() => setAmpliada(tipo)} />
                {repetidas[tipo] ? (
                  <p className="flex items-start gap-1.5 text-xs font-semibold text-red-700">
                    <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                    Esta misma foto ya se usó en {repetidas[tipo].join(', ')}.
                  </p>
                ) : null}
                <p className="truncate font-mono text-[11px] text-slate-400">{solicitud.fotos[tipo].archivo}</p>
              </figure>
            ))}
          </div>
        )}

        {faltaCarpeta ? <CarpetaDeEstaPc carpeta={carpeta} onCambio={onCarpeta} /> : null}

        {tiposConFoto.length > 0 ? (
          <fieldset className="flex flex-col gap-2 rounded-xl border border-border px-4 py-3">
            <legend className="px-1 text-sm font-semibold text-slate-900">Antes de aprobar, comprueba</legend>
            {CHEQUEOS.map(([clave, texto]) => (
              <Checkbox key={clave} checked={Boolean(chequeos[clave])} onChange={(e) => setChequeos((previos) => ({ ...previos, [clave]: e.target.checked }))}>
                {clave === 'numero' ? (
                  <>
                    {texto} (Solicitud: <b className="font-mono">{solicitud.ordenDePago}</b>)
                  </>
                ) : (
                  texto
                )}
              </Checkbox>
            ))}
          </fieldset>
        ) : null}

        <div className="flex flex-col gap-2">
          <Textarea
            label="Motivo del rechazo (obligatorio para rechazar)"
            rows={3}
            maxLength={500}
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            hint="Le llega a la persona por correo, para que corrija y envíe una nueva solicitud."
          />
          <div className="flex flex-wrap gap-1.5">
            {MOTIVOS_FRECUENTES.map((texto) => (
              <button key={texto} type="button" onClick={() => setMotivo(texto)} className="rounded-full border border-border bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-primary hover:text-primary">
                {texto.split('.')[0]}
              </button>
            ))}
          </div>
        </div>

        <AlertBanner>{error}</AlertBanner>

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="secondary" onClick={onCerrar} disabled={Boolean(trabajando)}>
            Cerrar
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" icon={X} onClick={() => resolver('rechazar')} disabled={Boolean(trabajando) || motivo.trim().length < 3 || faltaCarpeta} className="text-secondary">
              {trabajando === 'rechazar' ? 'Rechazando...' : 'Rechazar'}
            </Button>
            <Button variant="primary" icon={Check} onClick={() => resolver('aprobar')} disabled={Boolean(trabajando) || !todoRevisado || faltaCarpeta}>
              {trabajando === 'aprobar' ? 'Aprobando...' : 'Aprobar y enviar solvencia'}
            </Button>
          </div>
        </div>
        {conFotosEnElSistema ? (
          <p className="-mt-2 text-xs text-slate-500">Al aprobar o rechazar, las fotos se guardan en la carpeta de solvencias de esta PC y se borran del sistema.</p>
        ) : null}
      </div>

      {ampliada && fotos[ampliada]?.url ? (
        <div role="dialog" aria-modal="true" aria-label={FOTOS[ampliada]} className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/90 p-4" onClick={() => setAmpliada(null)}>
          <img src={fotos[ampliada].url} alt={FOTOS[ampliada]} className="max-h-full max-w-full rounded-lg bg-white object-contain shadow-2xl" />
          <button type="button" onClick={() => setAmpliada(null)} className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-slate-800 hover:bg-white" aria-label="Cerrar la foto">
            <X size={20} />
          </button>
        </div>
      ) : null}
    </Modal>
  );
}

// --- Página -----------------------------------------------------------------------------------------------------------

// Solicitudes de solvencia (paz y salvo bibliotecario). La administración revisa las fotos del pago y las aprueba (a la persona le
// llega su constancia en PDF) o las rechaza con un motivo. Circulación las ve, pero no las resuelve.
export default function SolicitudesPage() {
  const { sesion } = useSesionAdmin();
  const esAdministrador = sesion?.rol === 'administrador';
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('');
  const [revisando, setRevisando] = useState(null);
  const [carpeta, setCarpeta] = useState({ estado: 'cargando', nombre: null });

  const cargar = useCallback(async () => {
    try {
      const res = await solvenciaApi.listar();
      setSolicitudes(res.data.data);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudieron cargar las solicitudes'));
    } finally {
      setCargando(false);
    }
  }, []);

  const revisarCarpeta = useCallback(() => {
    estadoDeLaCarpeta()
      .then(setCarpeta)
      .catch(() => setCarpeta({ estado: 'sin_carpeta', nombre: null }));
  }, []);

  useEffect(() => {
    cargar();
    if (esAdministrador) revisarCarpeta();
  }, [cargar, revisarCarpeta, esAdministrador]);

  // Cuando el aviso de la PC detecta una solicitud nueva, la lista se actualiza sola.
  useEffect(() => {
    window.addEventListener(EVENTO_SOLVENCIA_NUEVA, cargar);
    return () => window.removeEventListener(EVENTO_SOLVENCIA_NUEVA, cargar);
  }, [cargar]);

  async function bajarConstancia(s) {
    try {
      const res = await solvenciaApi.constancia(s.id);
      descargar(res.data, `Constancia_solvencia_${s.id}.pdf`);
    } catch {
      setError('No se pudo descargar la constancia');
    }
  }

  const filtradas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return solicitudes.filter(
      (s) =>
        (!estado || s.estado === estado || (estado === 'pendiente' && s.estado === 'en_revision')) &&
        (!texto ||
          [s.id, s.codigoConfirmacion, s.solicitante, s.identificacion, s.cui, s.correo, s.ordenDePago, s.programa, s.motivo].some((v) =>
            String(v ?? '').toLowerCase().includes(texto)
          ))
    );
  }, [solicitudes, busqueda, estado]);
  const pagina = usePaginaLocal(filtradas, 40, [busqueda, estado]);

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={18} />
        Cargando solicitudes...
      </div>
    );
  }

  return (
    <PaginaAdmin
      descripcion={
        esAdministrador
          ? 'Solicitudes de solvencia del sitio y de los kioscos. Revisa las fotos del comprobante y de la orden de pago, y aprueba (a la persona le llega su constancia en PDF) o rechaza con un motivo.'
          : 'Solicitudes de solvencia del sitio y de los kioscos. La administración revisa las fotos del pago y las aprueba o rechaza.'
      }
      acciones={
        <Button variant="secondary" icon={RefreshCw} onClick={cargar}>
          Actualizar
        </Button>
      }
    >
      <AlertBanner>{error}</AlertBanner>
      {aviso ? (
        <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-primary-dark">
          {aviso}
        </p>
      ) : null}

      {esAdministrador ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <CarpetaDeEstaPc carpeta={carpeta} onCambio={revisarCarpeta} />
          <AvisosDeEstaPc />
        </div>
      ) : null}

      <BarraDeFiltros
        busqueda={busqueda}
        onBusqueda={setBusqueda}
        placeholder="Número, nombre, carné, CUI u orden de pago"
        filtros={[
          {
            etiqueta: 'Todos los estados',
            valor: estado,
            onCambio: setEstado,
            opciones: Object.entries(ESTADO_SOLVENCIA)
              .filter(([clave]) => clave !== 'en_revision')
              .map(([clave, e]) => [clave, e.label]),
          },
        ]}
        resumen={`${filtradas.length} de ${solicitudes.length}`}
      />

      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-surface text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {ENCABEZADOS.map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {pagina.visibles.length === 0 ? (
              <tr>
                <td colSpan={ENCABEZADOS.length} className="px-3 py-8 text-center text-slate-400">
                  {solicitudes.length === 0 ? 'Aún no hay solicitudes registradas.' : 'Ninguna solicitud coincide con la búsqueda.'}
                </td>
              </tr>
            ) : (
              pagina.visibles.map((s) => {
                const estadoDeSolicitud = ESTADO_SOLVENCIA[s.estado] ?? { tone: 'neutral', label: s.estado };
                const tiposConFoto = Object.keys(FOTOS).filter((tipo) => s.fotos?.[tipo]);
                return (
                  <tr key={s.id} className="align-top">
                    <td className="px-3 py-3">
                      <span className="font-mono">{s.id}</span>
                      {s.codigoConfirmacion ? <span className="block font-mono text-xs text-slate-500">{s.codigoConfirmacion}</span> : null}
                      <span className="block text-xs text-slate-400">{fechaLegible(s.creadoEn)}</span>
                      <span className="block text-xs text-slate-400">{s.kiosco ? `Kiosco ${s.kiosco}` : 'Web'}</span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-semibold text-slate-900">{s.solicitante}</span>
                      <span className="block font-mono text-xs text-slate-500">Carné {s.identificacion}</span>
                      {s.cui ? <span className="block font-mono text-xs text-slate-500">CUI {s.cui}</span> : null}
                      {s.correo ? <span className="block text-xs text-slate-500">{s.correo}</span> : null}
                    </td>
                    <td className="px-3 py-3">
                      {s.motivo}
                      <span className="block max-w-[14rem] text-xs text-slate-500">{s.programa}</span>
                      {s.ordenDePago ? <span className="block font-mono text-xs text-slate-500">Orden de pago {s.ordenDePago}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs">
                      {s.fechaPapeleria ? (
                        <span className="block text-slate-700">
                          Papelería: <b>{fechaCorta(s.fechaPapeleria)}</b>
                        </span>
                      ) : null}
                      {s.entregaEstimada ? (
                        <span className="block text-slate-700">
                          Entrega: <b>{fechaCorta(s.entregaEstimada.fecha)}</b> {s.entregaEstimada.hora}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-600">
                      {tiposConFoto.length === 0 ? (
                        <span className="text-slate-400">Sin fotos</span>
                      ) : tiposConFoto.every((tipo) => s.fotos[tipo].enRevision) ? (
                        `${tiposConFoto.length} por revisar`
                      ) : (
                        <span title={tiposConFoto.map((tipo) => s.fotos[tipo].guardadaEn).join('\n')}>Guardadas en la PC</span>
                      )}
                      {s.fotosRepetidas ? (
                        <span className="mt-1 flex items-center gap-1 font-semibold text-red-700">
                          <TriangleAlert size={12} aria-hidden="true" /> Repetida
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={estadoDeSolicitud.tone}>{estadoDeSolicitud.label}</Badge>
                      {s.estado === 'rechazada' && s.observacion ? <span className="mt-1 block max-w-[13rem] text-xs text-slate-500">{s.observacion}</span> : null}
                      {s.revisadaPor?.nombre ? (
                        <span className="mt-1 block text-[11px] text-slate-400">
                          {s.revisadaPor.nombre} · {fechaLegible(s.atendidaEn)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {esAdministrador && pendiente(s) ? (
                        <button type="button" onClick={() => setRevisando(s)} className="text-xs font-semibold text-primary hover:underline">
                          Revisar
                        </button>
                      ) : null}
                      {esAdministrador && s.estado === 'aprobada' ? (
                        <button type="button" onClick={() => bajarConstancia(s)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                          <FileDown size={13} aria-hidden="true" /> Constancia
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Paginacion pagina={pagina.pagina} paginas={pagina.paginas} onCambiar={pagina.irAPagina} />

      {revisando ? (
        <ModalDeRevision
          solicitud={revisando}
          carpeta={carpeta}
          onCarpeta={revisarCarpeta}
          onCerrar={() => setRevisando(null)}
          onHecho={(resuelta, accion) => {
            setRevisando(null);
            const guardadas = Object.values(resuelta.fotos ?? {})
              .map((f) => f.guardadaEn)
              .filter(Boolean);
            setAviso(
              `${resuelta.id} ${accion === 'aprobar' ? 'aprobada' : 'rechazada'}. ${guardadas.length > 0 ? `Fotos guardadas en ${guardadas.join(' y ')}. ` : ''}${
                TEXTO_DEL_CORREO[resuelta.correoDeResolucion] ?? ''
              }`
            );
            cargar();
          }}
        />
      ) : null}
    </PaginaAdmin>
  );
}
