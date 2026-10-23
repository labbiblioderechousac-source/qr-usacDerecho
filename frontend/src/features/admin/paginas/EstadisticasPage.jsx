import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Armchair,
  Ban,
  CalendarCheck,
  CalendarClock,
  Clock,
  DoorOpen,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Loader2,
  Mail,
  MonitorSmartphone,
  Printer,
  QrCode,
  Receipt,
  RefreshCw,
  Search,
  UserX,
} from 'lucide-react';
import { adminApi } from '../adminApi';
import { getErrorMessage } from '../../../shared/api/axiosClient';
import AlertBanner from '../../../shared/components/AlertBanner';
import Button from '../../../shared/components/Button';
import StatTile from '../../../shared/components/StatTile';
import { hoyISO, primerDiaDelMes } from '../../../shared/utils/fechas';
import PaginaAdmin from '../componentes/PaginaAdmin';
import PeriodoDeEstadisticas from '../componentes/PeriodoDeEstadisticas';
import { fechaLegible } from '../estados';
import { nombreDelPeriodo, rangoDe } from '../periodos';

// Barras horizontales hechas con divs: cada fila muestra también el número, así no depende solo del color.
function Barras({ filas }) {
  const maximo = Math.max(1, ...filas.map((f) => f.valor));
  return (
    <ul className="flex flex-col gap-1.5">
      {filas.map((f) => (
        <li key={f.etiqueta} className="grid grid-cols-[4.75rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
          <span className="text-slate-600">{f.etiqueta}</span>
          <span className="h-3 overflow-hidden rounded-full bg-surface">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${(f.valor / maximo) * 100}%` }} />
          </span>
          <span className="text-right font-semibold text-slate-700">{f.valor}</span>
        </li>
      ))}
    </ul>
  );
}

function Tarjeta({ titulo, children }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-white p-4">
      <h3 className="text-sm font-bold text-slate-900">{titulo}</h3>
      {children}
    </section>
  );
}

function SinDatos({ children }) {
  return <p className="text-sm text-slate-400">{children}</p>;
}

// Cómo terminaron las reservas del período: cuántas se usaron, cuántas personas no llegaron y cuántas se cancelaron.
function ResultadoDeLasReservas({ reservas }) {
  const conResultado = reservas.atendidas + reservas.noSePresentaron;
  const asistencia = conResultado > 0 ? Math.round((reservas.atendidas / conResultado) * 100) : null;
  return (
    <Tarjeta titulo="Cómo terminaron las reservas">
      {reservas.total === 0 ? (
        <SinDatos>No hay reservas en este período.</SinDatos>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Atendidas (llegaron)" value={reservas.atendidas} icon={CalendarCheck} />
            <StatTile label="No se presentaron" value={reservas.noSePresentaron} icon={UserX} />
            <StatTile label="Canceladas" value={reservas.canceladas} icon={Ban} />
            <StatTile label="Liberadas por el personal" value={reservas.liberadasPorElPersonal} icon={DoorOpen} />
            <StatTile label="Pendientes (aún no llegan)" value={reservas.pendientes} icon={CalendarClock} />
            <StatTile label="Horas reservadas" value={reservas.horasReservadas} icon={Clock} />
          </div>
          <p className="text-sm text-slate-600">
            {asistencia === null
              ? 'Todavía no hay reservas que hayan terminado en este período.'
              : `Llegó el ${asistencia} % de las personas que reservaron (${reservas.atendidas} de ${conResultado}). ${reservas.penalizaciones} ${
                  reservas.penalizaciones === 1 ? 'persona quedó penalizada' : 'personas quedaron penalizadas'
                } por no presentarse.`}
          </p>
        </>
      )}
    </Tarjeta>
  );
}

// Estadísticas de uso de los servicios (propuesta, sección 4.5.7), del período que elija el administrador.
export default function EstadisticasPage() {
  const hoy = hoyISO();
  const [eleccion, setEleccion] = useState(() => ({ modo: 'mes', referencia: hoy, rango: { desde: primerDiaDelMes(hoy), hasta: hoy } }));
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [descargando, setDescargando] = useState(false);
  const ultimaConsulta = useRef(0);

  const periodo = eleccion.modo === 'rango' ? eleccion.rango : rangoDe(eleccion.modo, eleccion.referencia);
  const { desde, hasta } = periodo;

  // Si se cambia de período mientras llega la respuesta anterior, solo cuenta la última que se pidió.
  const cargar = useCallback(async () => {
    const consulta = (ultimaConsulta.current += 1);
    setCargando(true);
    try {
      const res = await adminApi.estadisticas({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) });
      if (consulta !== ultimaConsulta.current) return;
      setDatos(res.data.data);
      setError('');
    } catch (err) {
      if (consulta === ultimaConsulta.current) setError(getErrorMessage(err, 'No se pudieron cargar las estadísticas'));
    } finally {
      if (consulta === ultimaConsulta.current) setCargando(false);
    }
  }, [desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // El Excel del mismo período que se ve en pantalla. Se pide con la sesión y se guarda con el nombre que da el servidor.
  async function descargarExcel() {
    setDescargando(true);
    try {
      const res = await adminApi.estadisticasExcel({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}) });
      const nombre = /filename="([^"]+)"/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? 'Estadisticas.xlsx';
      const url = URL.createObjectURL(res.data);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      enlace.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError('');
    } catch {
      setError('No se pudo generar el Excel. Inténtalo de nuevo.');
    } finally {
      setDescargando(false);
    }
  }

  if (!datos) {
    return cargando ? (
      <div className="flex items-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={18} />
        Cargando estadísticas...
      </div>
    ) : (
      <AlertBanner>{error}</AlertBanner>
    );
  }

  const { totales, reservas, comprobantes, porHora, porDia, tesisMasConsultadas, kioscos } = datos;
  const hayReservas = porHora.some((h) => h.total > 0);
  const delPeriodo = nombreDelPeriodo(eleccion.modo, periodo).toLowerCase();

  return (
    <PaginaAdmin
      descripcion={`Cómo se usan los servicios de la biblioteca en el período que elijas. Las reservas cuentan por el día en que se usa el lugar; lo demás, por el día en que ocurrió. Datos calculados el ${fechaLegible(datos.generadoEn)}.`}
      acciones={
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={FileSpreadsheet} onClick={descargarExcel} disabled={descargando}>
            {descargando ? 'Generando...' : 'Descargar Excel'}
          </Button>
          <Button variant="secondary" icon={RefreshCw} onClick={cargar} disabled={cargando}>
            {cargando ? 'Actualizando...' : 'Actualizar'}
          </Button>
        </div>
      }
    >
      <PeriodoDeEstadisticas valor={eleccion} hoy={hoy} onCambiar={setEleccion} />
      <AlertBanner>{error}</AlertBanner>

      <div className={`grid grid-cols-2 gap-3 transition-opacity lg:grid-cols-4 ${cargando ? 'opacity-60' : ''}`} aria-busy={cargando}>
        <StatTile label="Búsquedas en el OPAC" value={totales.busquedasOpac} icon={Search} />
        <StatTile label="Consultas de tesis digitales" value={totales.consultasDigitales} icon={FileText} />
        <StatTile label="Descargas de tesis digitales" value={totales.descargasDigitales} icon={Download} />
        <StatTile label="Accesos por código QR" value={totales.accesosQr} icon={QrCode} />
        <StatTile label="Sesiones en kioscos" value={totales.sesionesKiosco} icon={MonitorSmartphone} />
        <StatTile label="Reservas de cubículos" value={totales.reservasCubiculos} icon={DoorOpen} />
        <StatTile label="Reservas de espacios de estudio" value={totales.reservasEspacios} icon={Armchair} />
        <StatTile label="Solicitudes de solvencia" value={totales.solicitudesSolvencia} icon={FileCheck2} />
      </div>

      <ResultadoDeLasReservas reservas={reservas} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta titulo="Comprobantes">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-1">
            <StatTile label="Generados" value={comprobantes.generados} icon={Receipt} />
            <StatTile label="Impresos" value={comprobantes.impresos} icon={Printer} />
            <StatTile label="Por correo" value={comprobantes.porCorreo} icon={Mail} />
          </div>
        </Tarjeta>

        <Tarjeta titulo="Horarios con mayor demanda">
          {hayReservas ? (
            <Barras filas={porHora.map((h) => ({ etiqueta: h.hora, valor: h.total }))} />
          ) : (
            <SinDatos>No hay reservas en {delPeriodo} para calcular la demanda.</SinDatos>
          )}
        </Tarjeta>

        <Tarjeta titulo="Días con mayor utilización">
          {hayReservas ? (
            <Barras filas={porDia.map((d) => ({ etiqueta: d.dia, valor: d.total }))} />
          ) : (
            <SinDatos>No hay reservas en {delPeriodo} para calcular la utilización.</SinDatos>
          )}
        </Tarjeta>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Tesis más consultadas">
          {tesisMasConsultadas.length === 0 ? (
            <SinDatos>No se consultó ninguna tesis digital en {delPeriodo}.</SinDatos>
          ) : (
            <ol className="flex flex-col gap-2.5">
              {tesisMasConsultadas.map((t, i) => (
                <li key={t.id} className="flex items-start gap-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold leading-snug text-slate-900">{t.titulo}</span>
                    <span className="block text-xs text-slate-500">
                      {t.consultas} consultas digitales · {t.accesosQr} accesos por QR · <span className="font-mono">{t.id}</span>
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Tarjeta>

        <Tarjeta titulo="Uso por kiosco">
          {kioscos.length === 0 ? (
            <SinDatos>No hay sesiones de kiosco en {delPeriodo}.</SinDatos>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[18rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1.5 font-semibold">Kiosco</th>
                  <th className="py-1.5 font-semibold">Sesiones</th>
                  <th className="py-1.5 font-semibold">Reservas y solicitudes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {kioscos.map((k) => (
                  <tr key={k.kiosco}>
                    <td className="py-2 font-semibold">Kiosco {k.kiosco}</td>
                    <td className="py-2">{k.sesiones}</td>
                    <td className="py-2">{k.operaciones}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Tarjeta>
      </div>
    </PaginaAdmin>
  );
}
