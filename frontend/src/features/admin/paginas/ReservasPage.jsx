import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Armchair, Ban, DoorClosed, DoorOpen, Gavel, History, Loader2, MonitorSmartphone, Printer, RefreshCw, Search } from 'lucide-react';
import { adminApi } from '../adminApi';
import { reservasApi } from '../../reservas/reservasApi';
import PlanoDelLugar from '../../reservas/PlanoDelLugar';
import { useSesionAdmin } from '../SesionAdmin';
import { EVENTO_LUGAR_LIBERADO } from '../useAvisosDeReservas';
import AvisosDeEstaPc from '../componentes/AvisosDeEstaPc';
import ModalDeSancion from '../componentes/ModalDeSancion';
import { useImpresionDeBoleta } from '../componentes/BoletaDeReserva';
import { usePaginaLocal } from '../usePaginaLocal';
import { getErrorMessage } from '../../../shared/api/axiosClient';
import AlertBanner from '../../../shared/components/AlertBanner';
import Badge from '../../../shared/components/Badge';
import Button from '../../../shared/components/Button';
import Nota from '../../../shared/components/Nota';
import Paginacion from '../../../shared/components/Paginacion';
import { fechaCorta, fechaYHora } from '../../../shared/utils/fechas';
import AccionesDeReserva from '../componentes/AccionesDeReserva';
import BarraDeFiltros from '../componentes/BarraDeFiltros';
import LugarDeReserva from '../componentes/LugarDeReserva';
import ModalConfirmar from '../componentes/ModalConfirmar';
import PaginaAdmin from '../componentes/PaginaAdmin';
import { ESTADO_RESERVA, MOTIVO_LIBERACION, TIPO_RESERVA } from '../estados';
import { horasQueSeLiberan, relojDeLaBiblioteca, situacionDeHoy, textoDeDuracion } from '../reservasDelPanel';

const TIPOS = ['cubiculo', 'estacion', 'sala_lectura'];
const TIPO_EN_PLURAL = { cubiculo: 'Cubículos', estacion: 'Estaciones', sala_lectura: 'Sala de lectura' };
const ICONO_DEL_TIPO = { cubiculo: DoorClosed, estacion: MonitorSmartphone, sala_lectura: Armchair };
const ALCANCES = [
  ['hoy', 'Hoy'],
  ['proximas', 'Próximas'],
  ['pasadas', 'Anteriores'],
  ['todas', 'Todas'],
];
const CADA_CUANTO_MS = 30 * 1000;
const MAXIMO_POR_LLEGAR = 8;

const ACCION_DE_LA_API = {
  ingreso: reservasApi.avanzar,
  salida: reservasApi.avanzar,
  liberar: reservasApi.liberar,
  cancelar: reservasApi.cancelar,
  quitar_penalizacion: reservasApi.quitarPenalizacion,
  quitar_sancion: reservasApi.quitarSancion,
  liberar_todos: () => reservasApi.liberarNoLlegaron(),
};

// "21/10/2026 09:15", en hora de la biblioteca.
function momento(iso) {
  const { fecha, hora } = fechaYHora(iso);
  return `${fecha} ${hora}`;
}

// Cuánto lugar queda de cada tipo, ahora mismo. Con un clic, la tabla de abajo muestra las reservas de hoy de ese tipo.
function OcupacionDeLugares({ tipo, datos, activo, onElegir }) {
  const Icono = ICONO_DEL_TIPO[tipo];
  const ocupados = datos.enUso + datos.esperando;
  const libres = datos.total - ocupados;
  const porcentaje = (cantidad) => (datos.total ? (cantidad / datos.total) * 100 : 0);
  return (
    <button
      type="button"
      onClick={onElegir}
      aria-pressed={activo}
      title={`Ver las reservas de hoy: ${TIPO_EN_PLURAL[tipo].toLowerCase()}`}
      className={`rounded-xl border bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
        activo ? 'border-primary ring-2 ring-primary/20' : 'border-border'
      }`}
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Icono size={16} className="text-primary" aria-hidden="true" />
        {TIPO_EN_PLURAL[tipo]}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${libres > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {libres > 0 ? `${libres} libres` : 'Lleno'}
        </span>
      </p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="font-heading text-3xl font-semibold leading-none text-primary-dark">{ocupados}</span>
        <span className="text-sm text-slate-500">de {datos.total} ocupados</span>
      </p>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${datos.enUso} en uso, ${datos.esperando} esperando, ${libres} libres`}>
        <span className="bg-primary" style={{ width: `${porcentaje(datos.enUso)}%` }} />
        <span className="bg-amber-400" style={{ width: `${porcentaje(datos.esperando)}%` }} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        {datos.enUso} en uso · {datos.esperando} esperando · {libres} libres
      </p>
    </button>
  );
}

function GrupoDeAtencion({ titulo, color, cantidad, vacio, accion, children }) {
  return (
    <div>
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden="true" />
        {titulo}
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-slate-500">{cantidad}</span>
        {accion ? <span className="ml-auto">{accion}</span> : null}
      </h3>
      {cantidad === 0 ? <p className="mt-1.5 text-sm text-slate-400">{vacio}</p> : <ul className="mt-1 divide-y divide-border">{children}</ul>}
    </div>
  );
}

// Botón para imprimir la boleta de uso de una reserva (con los datos del estudiante y el plano de su lugar).
function BotonDeBoleta({ onImprimir, grande = false }) {
  if (grande) {
    return (
      <Button variant="brand" icon={Printer} onClick={onImprimir}>
        Imprimir boleta
      </Button>
    );
  }
  return (
    <button type="button" onClick={onImprimir} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
      <Printer size={13} aria-hidden="true" />
      Boleta
    </button>
  );
}

const sinEspacios = (texto) => String(texto ?? '').replace(/\s+/g, '').toLowerCase();

// Todo lo de un carné: cuántas veces reservó, a cuántas no llegó, sus sanciones (vigentes, terminadas o quitadas) y el botón para
// sancionarlo.
function HistorialDelCarne({ reservas, sanciones, onSancionar }) {
  const cuenta = (condicion) => reservas.filter(condicion).length;
  const datos = [
    ['Reservas', reservas.length],
    ['Usadas', cuenta((r) => r.estado === 'finalizado' || r.estado === 'en_uso')],
    ['No llegó', cuenta((r) => r.estado === 'liberada' && r.motivoLiberacion === 'no_presentado')],
    ['Canceladas', cuenta((r) => r.estado === 'cancelado')],
    ['Sanciones', sanciones.length],
  ];
  const persona = reservas[0];
  const ahora = Date.now();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface/60 p-4" data-testid="historial-del-carne">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <History size={16} className="text-primary" aria-hidden="true" /> Historial de {persona.solicitante}
        </h3>
        <Button variant="secondary" icon={Gavel} onClick={() => onSancionar({ identificacion: persona.identificacion, solicitante: persona.solicitante })}>
          Sancionar
        </Button>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {datos.map(([etiqueta, valor]) => (
          <div key={etiqueta} className="rounded-md bg-white px-3 py-2 ring-1 ring-border">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{etiqueta}</dt>
            <dd className={`font-heading text-xl font-semibold ${etiqueta === 'No llegó' && valor > 0 ? 'text-amber-700' : etiqueta === 'Sanciones' && valor > 0 ? 'text-red-700' : 'text-slate-900'}`}>
              {valor}
            </dd>
          </div>
        ))}
      </dl>
      {sanciones.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-xs">
          {sanciones.map((s) => {
            const situacion = s.quitada ? 'Quitada' : new Date(s.hasta).getTime() > ahora ? 'Vigente' : 'Terminó';
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-white px-3 py-2 ring-1 ring-border">
                <Badge tone={situacion === 'Vigente' ? 'danger' : 'neutral'}>{situacion}</Badge>
                <span className="font-mono text-slate-500">{s.id}</span>
                <span className="font-semibold text-slate-800">{s.motivo}</span>
                <span className="text-slate-500">
                  · {s.horas} h, desde el {momento(s.desde)}
                  {s.por?.nombre ? ` · por ${s.por.nombre}` : ''}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

// Busca las reservas de un estudiante por su carné o identificación, para imprimirle la boleta cuando llega al mostrador. Muestra
// primero las de hoy que siguen vigentes, luego las próximas y al final las anteriores, y debajo su historial.
function BuscarPorCarne({ reservas, penalizaciones, sanciones, hoy, onImprimir, onSancionar }) {
  const [texto, setTexto] = useState('');
  const [buscado, setBuscado] = useState('');

  const encontradas = useMemo(() => {
    const carne = sinEspacios(buscado);
    if (!carne) return [];
    const exactas = reservas.filter((r) => sinEspacios(r.identificacion) === carne);
    const lista = exactas.length > 0 ? exactas : reservas.filter((r) => sinEspacios(r.identificacion).includes(carne));
    const grupo = (r) => {
      const vigente = r.estado === 'reservado' || r.estado === 'en_uso';
      if (r.fecha === hoy && vigente) return 0;
      if (r.fecha >= hoy && vigente) return 1;
      return 2;
    };
    return lista
      .sort((a, b) => grupo(a) - grupo(b) || (grupo(a) === 2 ? -1 : 1) * `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`))
      .slice(0, 6);
  }, [reservas, buscado, hoy]);
  const penalizacion = buscado ? penalizaciones.find((p) => sinEspacios(p.identificacion) === sinEspacios(buscado)) : null;
  const delCarne = useMemo(() => {
    if (encontradas.length === 0) return null;
    const carne = sinEspacios(encontradas[0].identificacion);
    return {
      reservas: reservas.filter((r) => sinEspacios(r.identificacion) === carne).sort((a, b) => b.creadoEn.localeCompare(a.creadoEn)),
      sanciones: sanciones.filter((s) => sinEspacios(s.identificacion) === carne),
    };
  }, [encontradas, reservas, sanciones]);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5" aria-labelledby="boleta-por-carne">
      <div>
        <h2 id="boleta-por-carne" className="text-base font-bold text-slate-900">
          Boleta de uso: buscar por carné
        </h2>
        <p className="mt-0.5 text-sm text-slate-600">
          Cuando el estudiante llega, escribe su carné o identificación: aparece su reserva con el plano de su lugar y puedes imprimir la
          boleta, ya llena con sus datos, para que revise y firme el estado del mobiliario y el equipo.
        </p>
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setBuscado(texto);
        }}
      >
        <label className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <span className="sr-only">Carné o identificación</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            inputMode="numeric"
            placeholder="Carné o identificación del estudiante"
            className="w-full rounded-md border border-border bg-white py-2 pl-9 pr-3 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <Button type="submit" variant="primary" icon={Search} disabled={!texto.trim()}>
          Buscar
        </Button>
      </form>

      {penalizacion ? (
        <Nota tono="aviso" titulo="Este carné no puede reservar">
          {penalizacion.tipo === 'sancion' ? (
            <>
              Tiene una sanción ({penalizacion.motivo}) y no puede reservar hasta el <b>{momento(penalizacion.hasta)}</b>. Si fue un error, quítasela en «Sin poder reservar», más
              abajo.
            </>
          ) : (
            <>
              No se presentó a su reserva {penalizacion.reservaId} ({penalizacion.recursoNombre}, {fechaCorta(penalizacion.fecha)} a las {penalizacion.hora}) y no puede reservar
              hasta el <b>{momento(penalizacion.hasta)}</b>. Si avisó o fue un error, quítale la penalización en «Sin poder reservar», más abajo.
            </>
          )}
        </Nota>
      ) : null}

      {buscado ? (
        encontradas.length === 0 ? (
          <p className="text-sm text-slate-500" role="status">
            No hay reservas con el carné <span className="font-mono font-semibold text-slate-700">{buscado.trim()}</span>.
          </p>
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Reservas del estudiante">
            {encontradas.map((r) => {
              const estadoDeReserva = ESTADO_RESERVA[r.estado] ?? { tone: 'neutral', label: r.estado };
              return (
                <li key={r.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row" data-testid="reserva-del-carne">
                  <div className="w-full shrink-0 rounded-md border border-border bg-surface p-1 sm:w-80">
                    <PlanoDelLugar recursoId={r.recursoId} nombre={r.recursoNombre} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <LugarDeReserva reserva={r} grande />
                    <p className="text-sm text-slate-700">
                      <span className="font-semibold text-slate-900">{r.solicitante}</span>
                      <span className="block font-mono text-xs text-slate-500">
                        {r.identificacion} · {r.id}
                      </span>
                    </p>
                    <p className="text-sm text-slate-700">
                      {fechaCorta(r.fecha)} · <span className="font-mono">{r.hora}–{r.horaFin}</span>
                    </p>
                    <div className="mt-auto flex flex-wrap items-center gap-3">
                      <Badge tone={estadoDeReserva.tone}>{estadoDeReserva.label}</Badge>
                      <BotonDeBoleta grande onImprimir={() => onImprimir(r)} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
      {delCarne ? <HistorialDelCarne reservas={delCarne.reservas} sanciones={delCarne.sanciones} onSancionar={onSancionar} /> : null}
    </section>
  );
}

// Quién no puede reservar por un tiempo: por no presentarse a una reserva (automático) o por una sanción del personal. Si avisó o fue un
// error, el personal se la quita.
function SinPoderReservar({ lista, ocupado, onQuitar }) {
  const cancelaron = (n) => (n > 0 ? ` · ${n} reserva${n === 1 ? '' : 's'} cancelada${n === 1 ? '' : 's'}` : '');
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-white p-5" aria-labelledby="sin-poder-reservar">
      <div>
        <h2 id="sin-poder-reservar" className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Ban size={17} className="text-amber-600" aria-hidden="true" />
          Sin poder reservar
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">{lista.length}</span>
        </h2>
        <p className="mt-0.5 text-sm text-slate-600">Por no llegar a su reserva o por una sanción: hasta la hora indicada no pueden reservar ningún lugar de estudio.</p>
      </div>
      <ul className="divide-y divide-border">
        {lista.map((p) => (
          <li key={p.sancionId ?? p.reservaId} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <div className="min-w-0 flex-1 basis-48">
              <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-900">
                {p.solicitante}
                <Badge tone={p.tipo === 'sancion' ? 'danger' : 'warning'}>{p.tipo === 'sancion' ? 'Sanción' : 'No llegó'}</Badge>
              </p>
              <p className="font-mono text-xs text-slate-500">{p.identificacion}</p>
            </div>
            <p className="min-w-0 flex-1 basis-56 text-xs text-slate-600">
              {p.tipo === 'sancion' ? (
                <>
                  {p.motivo}
                  {p.por?.nombre ? ` · por ${p.por.nombre}` : ''}
                </>
              ) : (
                <>
                  Faltó a <span className="font-mono">{p.reservaId}</span> · {p.recursoNombre}, {fechaCorta(p.fecha)} {p.hora}
                </>
              )}
              {cancelaron(p.canceladas.length)}
            </p>
            <p className="text-sm text-slate-700">
              Hasta el <b className="font-mono">{momento(p.hasta)}</b>
            </p>
            <button type="button" disabled={ocupado} onClick={() => onQuitar(p)} className="text-xs font-semibold text-primary hover:underline disabled:opacity-50">
              {p.tipo === 'sancion' ? 'Quitar sanción' : 'Quitar penalización'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FilaDeAtencion({ reserva, detalle, children }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
      <div className="w-52 min-w-0 shrink-0">
        <LugarDeReserva reserva={reserva} />
      </div>
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-sm font-semibold text-slate-900">{reserva.solicitante}</p>
        <p className="text-xs text-slate-500">
          <span className="font-mono text-slate-700">
            {reserva.hora}–{reserva.horaFin}
          </span>{' '}
          · {detalle}
        </p>
      </div>
      {children}
    </li>
  );
}

// Lo que el texto de la ventana de confirmación dice de cada acción.
function ContenidoDeConfirmacion({ tipo, reserva, reloj }) {
  const lugar = <b>{reserva.recursoNombre}</b>;
  const persona = <b>{reserva.solicitante}</b>;
  const aviso = reserva.correo ? <p>Le avisaremos por correo a {reserva.correo}.</p> : null;
  if (tipo === 'liberar_todos') {
    return (
      <>
        <p>
          Se liberan ahora los lugares de las <b>{reserva.cantidad}</b> personas que no han llegado y cuya hora ya empezó, sin esperar a que termine la tolerancia. Otras
          personas podrán reservarlos enseguida.
        </p>
        <p>Como no se presentaron, quedan sin poder reservar el tiempo de la configuración (igual que si el sistema las liberara solo) y, si dejaron correo, se les avisa.</p>
        <p className="text-slate-500">Para liberar sin castigo a alguien que avisó que no vendría, usa «No llegó» en su reserva.</p>
      </>
    );
  }
  if (tipo === 'quitar_sancion') {
    return (
      <p>
        {persona} (carné <span className="font-mono">{reserva.identificacion}</span>) podrá reservar otra vez desde ahora. Las reservas que se le cancelaron por la sanción no
        vuelven.
      </p>
    );
  }
  if (tipo === 'quitar_penalizacion') {
    return (
      <p>
        {persona} (carné <span className="font-mono">{reserva.identificacion}</span>) podrá reservar otra vez desde ahora. Las reservas que se le cancelaron por
        no presentarse no vuelven: si todavía las necesita, tiene que reservar de nuevo.
      </p>
    );
  }
  if (tipo === 'liberar') {
    return (
      <>
        <p>
          {lugar} está reservado por {persona} de {reserva.hora} a {reserva.horaFin}. Si no llegó, o avisó que no vendrá, el lugar queda libre ahora mismo para que otra
          persona lo reserve.
        </p>
        {aviso}
      </>
    );
  }
  if (tipo === 'cancelar') {
    return (
      <>
        <p>
          Se cancelará la reserva <b>{reserva.id}</b> de {persona} en {lugar} ({fechaCorta(reserva.fecha)}, de {reserva.hora} a {reserva.horaFin}). Esto no se puede deshacer y
          el lugar queda libre.
        </p>
        {aviso}
      </>
    );
  }
  const liberadas = horasQueSeLiberan(reserva, reloj);
  return liberadas ? (
    <p>
      {persona} se va antes de que termine su reserva (a las {reserva.horaFin}). Al registrar su salida, {lugar} queda libre de <b>{liberadas.desde}</b> a <b>{liberadas.hasta}</b>{' '}
      y otras personas podrán reservar esas horas.
    </p>
  ) : (
    <p>
      Se registra la salida de {persona} de {lugar}. La reserva queda finalizada.
    </p>
  );
}

const TEXTOS_DE_CONFIRMACION = {
  liberar: { titulo: '¿Liberar este lugar?', boton: 'Sí, liberar el lugar', volver: 'No, dejarlo', peligro: true },
  cancelar: { titulo: '¿Cancelar la reserva?', boton: 'Sí, cancelar la reserva', volver: 'No, mantenerla', peligro: true },
  salida: { titulo: '¿Registrar la salida?', boton: 'Sí, registrar la salida', volver: 'Volver', peligro: false },
  quitar_penalizacion: { titulo: '¿Quitar la penalización?', boton: 'Sí, ya puede reservar', volver: 'No, dejarla', peligro: false },
  quitar_sancion: { titulo: '¿Quitar la sanción?', boton: 'Sí, ya puede reservar', volver: 'No, dejarla', peligro: false },
  liberar_todos: { titulo: '¿Liberar a los que no llegaron?', boton: 'Sí, liberar los lugares', volver: 'No, esperar', peligro: true },
};

function avisoDeResultado(tipo, reserva) {
  if (tipo === 'liberar_todos') {
    return reserva.length > 0 ? `Se liberaron ${reserva.length} lugares: ${reserva.map((r) => r.recursoNombre).join(', ')}.` : 'No había nadie por liberar.';
  }
  if (tipo === 'quitar_sancion') return `Sanción quitada: ${reserva.solicitante} ya puede reservar.`;
  if (tipo === 'quitar_penalizacion') return `Penalización quitada: ${reserva.solicitante} ya puede reservar.`;
  if (tipo === 'ingreso') return `Ingreso registrado: ${reserva.solicitante} ya está en ${reserva.recursoNombre}.`;
  if (tipo === 'salida') {
    return reserva.salioAntes
      ? `Salida registrada. ${reserva.recursoNombre} quedó libre de ${reserva.horaFin} a ${reserva.horaFinOriginal}.`
      : `Salida registrada: la reserva de ${reserva.recursoNombre} quedó finalizada.`;
  }
  if (tipo === 'liberar') return `Lugar liberado: ${reserva.recursoNombre} está disponible otra vez.`;
  return `Reserva ${reserva.id} cancelada: ${reserva.recursoNombre} está disponible otra vez.`;
}

function notaDelEstado(r) {
  if (r.estado === 'liberada' && r.penalizadoHasta) {
    const castigo = r.penalizacionQuitada ? 'penalización quitada' : `sin reservar hasta el ${momento(r.penalizadoHasta)}`;
    return `${MOTIVO_LIBERACION[r.motivoLiberacion] ?? r.motivoLiberacion} · ${castigo}`;
  }
  if (r.estado === 'liberada' && r.motivoLiberacion) return MOTIVO_LIBERACION[r.motivoLiberacion] ?? r.motivoLiberacion;
  if (r.estado === 'cancelado' && r.motivoCancelacion === 'penalizacion') return `Cancelada porque no se presentó a ${r.canceladaPorFaltaEn}`;
  if (r.estado === 'cancelado' && r.motivoCancelacion === 'sancion') return `Cancelada por la sanción ${r.canceladaPorSancion}`;
  if (r.estado === 'finalizado' && r.salioAntes) return `Se fue antes: liberó de ${r.horaFin} a ${r.horaFinOriginal}`;
  if (r.estado === 'finalizado' && r.salidaAutomatica) return 'Se cerró sola al terminar su hora';
  if (r.estado === 'en_uso' && r.ingresoEn) return `Adentro desde las ${fechaYHora(r.ingresoEn).hora}`;
  return null;
}

// Reservas de cubículos, estaciones y sala de lectura, para quien atiende el mostrador: cuánto lugar queda, quién está adentro, a
// quién se espera y qué hacer con cada uno. Si alguien no se presenta dentro del tiempo de tolerancia, el lugar se libera solo; si se
// va antes de que termine su hora, al sellar su salida las horas que no usó quedan libres para otras personas.
export default function ReservasPage() {
  const [reservas, setReservas] = useState([]);
  const [lugares, setLugares] = useState(null);
  const [tolerancia, setTolerancia] = useState(15);
  const [horasDePenalizacion, setHorasDePenalizacion] = useState(0);
  const [penalizaciones, setPenalizaciones] = useState([]);
  const [sanciones, setSanciones] = useState([]); // todas las del personal: el historial de cada carné
  const [sancionando, setSancionando] = useState(null); // { identificacion, solicitante, reservaId? } mientras se llena la sanción
  const tabla = useRef(null);
  const [ahora, setAhora] = useState(() => new Date());
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [estado, setEstado] = useState('');
  const [tipo, setTipo] = useState('');
  const [alcance, setAlcance] = useState('hoy');
  const [confirmacion, setConfirmacion] = useState(null); // { tipo, reserva } mientras se pide confirmar
  const [errorDeConfirmacion, setErrorDeConfirmacion] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const { sesion } = useSesionAdmin();
  const boleta = useImpresionDeBoleta({ toleranciaMinutos: tolerancia, horasDePenalizacion, atendidoPor: sesion.nombre || sesion.usuario });

  const cargar = useCallback(async () => {
    try {
      const [lista, resumen, castigos, historial] = await Promise.all([reservasApi.listar(), adminApi.resumen(), reservasApi.penalizaciones(), reservasApi.sanciones()]);
      setReservas(lista.data.data);
      setPenalizaciones(castigos.data.data);
      setSanciones(historial.data.data);
      setLugares(resumen.data.data.reservas.lugares);
      setAhora(new Date());
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudieron cargar las reservas'));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    reservasApi
      .condiciones()
      .then((res) => {
        setTolerancia(res.data.data.toleranciaMinutos);
        setHorasDePenalizacion(res.data.data.horasDePenalizacion ?? 0);
      })
      .catch(() => {});
    // Se actualiza sola mientras la pestaña está a la vista: quien atiende ve lo que pasó sin tocar nada.
    const intervalo = setInterval(() => {
      if (!document.hidden) cargar();
    }, CADA_CUANTO_MS);
    return () => clearInterval(intervalo);
  }, [cargar]);

  // Cuando el aviso de la PC detecta que un lugar se liberó (alguien no llegó), la página se actualiza sola.
  useEffect(() => {
    window.addEventListener(EVENTO_LUGAR_LIBERADO, cargar);
    return () => window.removeEventListener(EVENTO_LUGAR_LIBERADO, cargar);
  }, [cargar]);

  useEffect(() => {
    if (!aviso) return undefined;
    const temporizador = setTimeout(() => setAviso(''), 7000);
    return () => clearTimeout(temporizador);
  }, [aviso]);

  async function ejecutar(accion, reserva) {
    setTrabajando(true);
    setErrorDeConfirmacion('');
    try {
      const res = await ACCION_DE_LA_API[accion](accion === 'quitar_sancion' ? reserva.sancionId : reserva.id);
      setAviso(avisoDeResultado(accion, res.data.data));
      setError('');
      setConfirmacion(null);
    } catch (err) {
      const mensaje = getErrorMessage(err, 'No se pudo completar la acción');
      if (confirmacion) setErrorDeConfirmacion(mensaje);
      else setError(mensaje);
    } finally {
      setTrabajando(false);
    }
    await cargar();
  }

  const acciones = (reserva) => (
    <>
      <AccionesDeReserva
      reserva={reserva}
      ocupado={trabajando}
      onIngreso={() => ejecutar('ingreso', reserva)}
      onSalida={() => setConfirmacion({ tipo: 'salida', reserva })}
      onLiberar={() => setConfirmacion({ tipo: 'liberar', reserva })}
      onCancelar={() => setConfirmacion({ tipo: 'cancelar', reserva })}
      />
      <BotonDeBoleta onImprimir={() => boleta.imprimir(reserva)} />
      <button
        type="button"
        onClick={() => setSancionando({ identificacion: reserva.identificacion, solicitante: reserva.solicitante, reservaId: reserva.id })}
        className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:underline"
        title="Sancionar a esta persona: queda un tiempo sin poder reservar"
      >
        <Gavel size={13} aria-hidden="true" />
        Sancionar
      </button>
    </>
  );

  // Con un clic en una tarjeta de ocupación, la tabla muestra las reservas de hoy de ese tipo (otro clic quita el filtro).
  function elegirTipo(t) {
    const quitar = tipo === t;
    setTipo(quitar ? '' : t);
    if (!quitar) setAlcance('hoy');
    tabla.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const reloj = relojDeLaBiblioteca(ahora);

  const deHoy = useMemo(() => {
    const grupos = { en_uso: [], esperando: [], por_llegar: [] };
    reservas.forEach((r) => {
      const situacion = situacionDeHoy(r, reloj, tolerancia);
      if (situacion) grupos[situacion.tipo].push({ reserva: r, situacion });
    });
    const porHora = (a, b) => a.reserva.hora.localeCompare(b.reserva.hora) || a.reserva.recursoNombre.localeCompare(b.reserva.recursoNombre, 'es', { numeric: true });
    Object.values(grupos).forEach((grupo) => grupo.sort(porHora));
    return grupos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservas, reloj.fecha, reloj.minutos, tolerancia]);

  const filtradas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    const lista = reservas.filter(
      (r) =>
        (!estado || r.estado === estado) &&
        (!tipo || r.tipo === tipo) &&
        (alcance === 'todas' ||
          (alcance === 'hoy' && r.fecha === reloj.fecha) ||
          (alcance === 'proximas' && r.fecha > reloj.fecha) ||
          (alcance === 'pasadas' && r.fecha < reloj.fecha)) &&
        (!texto ||
          [r.id, r.codigoConfirmacion, r.solicitante, r.identificacion, r.recursoNombre].some((v) => String(v ?? '').toLowerCase().includes(texto)))
    );
    const alRevez = alcance === 'pasadas' || alcance === 'todas'; // lo más reciente primero; hoy y próximas, por orden de hora
    return lista.sort((a, b) => {
      const orden = `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`) || a.recursoNombre.localeCompare(b.recursoNombre, 'es', { numeric: true });
      return alRevez ? -orden : orden;
    });
  }, [reservas, busqueda, estado, tipo, alcance, reloj.fecha]);
  const pagina = usePaginaLocal(filtradas, 40, [busqueda, estado, tipo, alcance]);

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={18} />
        Cargando reservas...
      </div>
    );
  }

  const hayAlgoAhora = deHoy.en_uso.length + deHoy.esperando.length + deHoy.por_llegar.length > 0;
  const textoDeConfirmar = confirmacion ? TEXTOS_DE_CONFIRMACION[confirmacion.tipo] : null;

  return (
    <PaginaAdmin
      descripcion="Qué lugares están ocupados, quién está adentro y a quién se espera. Si alguien no se presenta dentro del tiempo de tolerancia, el lugar se libera solo y esa persona queda un tiempo sin poder reservar; si se va antes de que termine su hora, al registrar su salida las horas que no usó quedan libres."
      acciones={
        <Button variant="secondary" icon={RefreshCw} onClick={cargar}>
          Actualizar
        </Button>
      }
    >
      <AlertBanner>{error}</AlertBanner>
      {aviso ? (
        <Nota tono="ok">
          <span role="status">{aviso}</span>
        </Nota>
      ) : null}

      {lugares ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {TIPOS.map((t) => (
            <OcupacionDeLugares key={t} tipo={t} datos={lugares[t]} activo={tipo === t} onElegir={() => elegirTipo(t)} />
          ))}
        </div>
      ) : null}

      <AvisosDeEstaPc titulo="Avisos cuando se libera un lugar" ejemplo="se liberó la Estación 4: Ana Pérez no llegó a su reserva." />

      <BuscarPorCarne
        reservas={reservas}
        penalizaciones={penalizaciones}
        sanciones={sanciones}
        hoy={reloj.fecha}
        onImprimir={boleta.imprimir}
        onSancionar={setSancionando}
      />

      {penalizaciones.length > 0 ? (
        <SinPoderReservar
          lista={penalizaciones}
          ocupado={trabajando}
          onQuitar={(p) =>
            setConfirmacion(
              p.tipo === 'sancion'
                ? { tipo: 'quitar_sancion', reserva: { sancionId: p.sancionId, solicitante: p.solicitante, identificacion: p.identificacion } }
                : { tipo: 'quitar_penalizacion', reserva: { id: p.reservaId, solicitante: p.solicitante, identificacion: p.identificacion } }
            )
          }
        />
      ) : null}

      <section className="flex flex-col gap-5 rounded-xl border border-border bg-white p-5" aria-label="Para atender ahora">
        <h2 className="text-base font-bold text-slate-900">Para atender ahora</h2>
        {!hayAlgoAhora ? <p className="text-sm text-slate-500">No hay nadie en la sala ni esperando por ahora: todas las reservas de hoy ya se atendieron.</p> : null}

        <GrupoDeAtencion titulo="Adentro ahora" color="bg-primary" cantidad={deHoy.en_uso.length} vacio="Nadie con una reserva en uso.">
          {deHoy.en_uso.map(({ reserva, situacion }) => (
            <FilaDeAtencion
              key={reserva.id}
              reserva={reserva}
              detalle={situacion.minutosParaTerminar > 0 ? `termina en ${textoDeDuracion(situacion.minutosParaTerminar)}` : 'su hora ya terminó'}
            >
              {acciones(reserva)}
            </FilaDeAtencion>
          ))}
        </GrupoDeAtencion>

        <GrupoDeAtencion
          titulo="Esperando a que llegue"
          color="bg-amber-400"
          cantidad={deHoy.esperando.length}
          vacio="Nadie por llegar con la hora ya empezada."
          accion={
            deHoy.esperando.length > 0 ? (
              <button
                type="button"
                disabled={trabajando}
                onClick={() => setConfirmacion({ tipo: 'liberar_todos', reserva: { cantidad: deHoy.esperando.length } })}
                className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:border-amber-500 disabled:opacity-60"
              >
                <DoorOpen size={14} aria-hidden="true" />
                Liberar a los que no llegaron ({deHoy.esperando.length})
              </button>
            ) : null
          }
        >
          {deHoy.esperando.map(({ reserva, situacion }) => (
            <FilaDeAtencion
              key={reserva.id}
              reserva={reserva}
              detalle={
                situacion.minutosParaLiberarse > 0
                  ? `se libera sola a las ${situacion.liberaA} (en ${textoDeDuracion(situacion.minutosParaLiberarse)})`
                  : 'se libera en un momento'
              }
            >
              {acciones(reserva)}
            </FilaDeAtencion>
          ))}
        </GrupoDeAtencion>

        <GrupoDeAtencion titulo="Llegan más tarde hoy" color="bg-slate-300" cantidad={deHoy.por_llegar.length} vacio="No hay más reservas para hoy.">
          {deHoy.por_llegar.slice(0, MAXIMO_POR_LLEGAR).map(({ reserva, situacion }) => (
            <FilaDeAtencion key={reserva.id} reserva={reserva} detalle={`empieza en ${textoDeDuracion(situacion.minutosParaEmpezar)}`}>
              {acciones(reserva)}
            </FilaDeAtencion>
          ))}
        </GrupoDeAtencion>
        {deHoy.por_llegar.length > MAXIMO_POR_LLEGAR ? <p className="text-xs text-slate-500">y {deHoy.por_llegar.length - MAXIMO_POR_LLEGAR} más en la tabla de abajo</p> : null}
      </section>

      <section ref={tabla} className="flex scroll-mt-20 flex-col gap-3" aria-label="Todas las reservas">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">Reservas</h2>
          <div className="inline-flex rounded-lg border border-border bg-white p-0.5" role="group" aria-label="Qué días mostrar">
            {ALCANCES.map(([valor, texto]) => (
              <button
                key={valor}
                type="button"
                onClick={() => setAlcance(valor)}
                aria-pressed={alcance === valor}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  alcance === valor ? 'bg-primary text-white' : 'text-slate-600 hover:bg-surface'
                }`}
              >
                {texto}
              </button>
            ))}
          </div>
        </div>
        <BarraDeFiltros
          busqueda={busqueda}
          onBusqueda={setBusqueda}
          placeholder="Número, código, nombre, carné o lugar"
          filtros={[
            { etiqueta: 'Todos los estados', valor: estado, onCambio: setEstado, opciones: Object.entries(ESTADO_RESERVA).map(([clave, e]) => [clave, e.label]) },
            { etiqueta: 'Todos los lugares', valor: tipo, onCambio: setTipo, opciones: Object.entries(TIPO_RESERVA) },
          ]}
          resumen={`${filtradas.length} reserva${filtradas.length === 1 ? '' : 's'}`}
        />

        <div className="overflow-x-auto rounded-xl border border-border bg-white">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {['Reserva', 'Lugar', 'En el plano', 'Persona', 'Cuándo', 'Estado'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pagina.visibles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    {reservas.length === 0
                      ? 'Aún no hay reservas registradas.'
                      : alcance === 'hoy' && !busqueda && !estado && !tipo
                        ? 'No hay reservas para hoy. Cambia a «Próximas» o «Todas» para ver otros días.'
                        : 'Ninguna reserva coincide con lo que buscas.'}
                  </td>
                </tr>
              ) : (
                pagina.visibles.map((r) => {
                  const estadoDeReserva = ESTADO_RESERVA[r.estado] ?? { tone: 'neutral', label: r.estado };
                  const nota = notaDelEstado(r);
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2.5 font-mono">
                        {r.id}
                        {r.codigoConfirmacion ? <span className="block text-xs text-slate-500">{r.codigoConfirmacion}</span> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <LugarDeReserva reserva={r} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="w-36 rounded border border-border bg-surface p-0.5">
                          <PlanoDelLugar recursoId={r.recursoId} nombre={r.recursoNombre} />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        {r.solicitante}
                        {r.identificacion ? <span className="block font-mono text-xs text-slate-500">{r.identificacion}</span> : null}
                        <span className="block text-xs text-slate-500">{r.kiosco ? `Kiosco ${r.kiosco}` : 'Web'}</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {fechaCorta(r.fecha)}
                        <span className="block font-mono text-xs text-slate-600">
                          {r.hora}–{r.horaFin}
                          {r.duracion > 1 ? ` · ${r.duracion} h` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={estadoDeReserva.tone}>{estadoDeReserva.label}</Badge>
                        {nota ? <span className="mt-1 block max-w-[14rem] text-xs text-slate-500">{nota}</span> : null}
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {r.estado === 'reservado' || r.estado === 'en_uso' ? acciones(r) : <BotonDeBoleta onImprimir={() => boleta.imprimir(r)} />}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <Paginacion pagina={pagina.pagina} paginas={pagina.paginas} onCambiar={pagina.irAPagina} />
      </section>

      <ModalConfirmar
        abierto={Boolean(confirmacion)}
        titulo={textoDeConfirmar?.titulo ?? ''}
        textoConfirmar={textoDeConfirmar?.boton}
        textoCancelar={textoDeConfirmar?.volver}
        peligro={textoDeConfirmar?.peligro}
        trabajando={trabajando}
        error={errorDeConfirmacion}
        onConfirmar={() => ejecutar(confirmacion.tipo, confirmacion.reserva)}
        onCancelar={() => {
          setConfirmacion(null);
          setErrorDeConfirmacion('');
        }}
      >
        {confirmacion ? <ContenidoDeConfirmacion tipo={confirmacion.tipo} reserva={confirmacion.reserva} reloj={reloj} /> : null}
      </ModalConfirmar>
      {sancionando ? (
        <ModalDeSancion
          persona={sancionando}
          onCerrar={() => setSancionando(null)}
          onHecho={(sancion) => {
            setSancionando(null);
            setAviso(
              `Sanción registrada: ${sancion.solicitante} no puede reservar hasta el ${momento(sancion.hasta)}${
                sancion.canceladas.length > 0 ? ` (se cancelaron ${sancion.canceladas.join(', ')})` : ''
              }.`
            );
            cargar();
          }}
        />
      ) : null}
      {boleta.portal}
    </PaginaAdmin>
  );
}
