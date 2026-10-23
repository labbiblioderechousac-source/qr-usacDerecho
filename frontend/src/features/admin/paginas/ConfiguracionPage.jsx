import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { adminApi } from '../adminApi';
import PaginaAdmin from '../componentes/PaginaAdmin';
import { ROLES_DEL_PERSONAL, fechaLegible } from '../estados';
import { getErrorMessage } from '../../../shared/api/axiosClient';
import AlertBanner from '../../../shared/components/AlertBanner';
import Badge from '../../../shared/components/Badge';
import Button from '../../../shared/components/Button';

const SERVICIOS = [
  { tipo: 'cubiculo', nombre: 'Cubículos', detalle: 'Reservas por horas para estudiar o trabajar en grupo.' },
  { tipo: 'estacion', nombre: 'Estaciones', detalle: 'Puestos individuales con una sola silla.' },
  { tipo: 'sala_lectura', nombre: 'Sala de lectura', detalle: 'Mesas compartidas de seis sillas.' },
];

// Configuración general (solo el administrador; propuesta, sección 4.5.6). Los cambios rigen desde que se guardan,
// tanto en los kioscos como en la web.
export default function ConfiguracionPage() {
  const [guardada, setGuardada] = useState(null); // lo que tiene el servidor
  const [tolerancia, setTolerancia] = useState('');
  const [penalizacion, setPenalizacion] = useState('');
  const [horasPorReserva, setHorasPorReserva] = useState('');
  const [horasPorDia, setHorasPorDia] = useState('');
  const [pausadas, setPausadas] = useState({});
  const [importantes, setImportantes] = useState([]);
  const [inactividad, setInactividad] = useState({});
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');

  function cargarEnFormulario(configuracion) {
    setGuardada(configuracion);
    setTolerancia(String(configuracion.toleranciaMinutos));
    setPenalizacion(String(configuracion.horasDePenalizacion));
    setHorasPorReserva(String(configuracion.maxHorasPorReserva));
    setHorasPorDia(String(configuracion.maxHorasPorDia));
    setPausadas(configuracion.reservasPausadas);
    setImportantes(configuracion.camposImportantes);
    setInactividad(configuracion.minutosDeInactividad);
  }

  useEffect(() => {
    adminApi
      .configuracion()
      .then((res) => cargarEnFormulario(res.data.data))
      .catch((err) => setError(getErrorMessage(err, 'No se pudo cargar la configuración')))
      .finally(() => setCargando(false));
  }, []);

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={18} />
        Cargando configuración...
      </div>
    );
  }

  if (!guardada) {
    return <AlertBanner>{error || 'No se pudo cargar la configuración'}</AlertBanner>;
  }

  const { toleranciaMinima, toleranciaMaxima, horasMaximas, penalizacionMaxima } = guardada.limites;
  const hayCambios =
    Number(tolerancia) !== guardada.toleranciaMinutos ||
    Number(penalizacion) !== guardada.horasDePenalizacion ||
    Number(horasPorReserva) !== guardada.maxHorasPorReserva ||
    Number(horasPorDia) !== guardada.maxHorasPorDia ||
    SERVICIOS.some(({ tipo }) => pausadas[tipo] !== guardada.reservasPausadas[tipo]) ||
    guardada.camposDeTesis.some(({ campo }) => importantes.includes(campo) !== guardada.camposImportantes.includes(campo)) ||
    Object.keys(ROLES_DEL_PERSONAL).some((rol) => inactividad[rol] !== guardada.minutosDeInactividad[rol]);

  async function guardar(e) {
    e.preventDefault();
    const minutos = Number(tolerancia);
    if (!Number.isInteger(minutos) || minutos < toleranciaMinima || minutos > toleranciaMaxima) {
      setError(`La tolerancia debe ser un número entero de ${toleranciaMinima} a ${toleranciaMaxima} minutos.`);
      return;
    }
    const castigo = Number(penalizacion);
    if (!Number.isInteger(castigo) || castigo < 0 || castigo > penalizacionMaxima) {
      setError(`Las horas sin poder reservar deben ser un número entero de 0 a ${penalizacionMaxima}.`);
      return;
    }
    const porReserva = Number(horasPorReserva);
    const porDia = Number(horasPorDia);
    const horasValidas = (n) => Number.isInteger(n) && n >= 1 && n <= horasMaximas;
    if (!horasValidas(porReserva) || !horasValidas(porDia)) {
      setError(`Las horas de las reservas deben ser números enteros de 1 a ${horasMaximas}.`);
      return;
    }
    if (porDia < porReserva) {
      setError('El máximo por persona al día no puede ser menor que el máximo por reserva.');
      return;
    }
    setGuardando(true);
    setError('');
    setAviso('');
    try {
      const res = await adminApi.guardarConfiguracion({
        toleranciaMinutos: minutos,
        horasDePenalizacion: castigo,
        maxHorasPorReserva: porReserva,
        maxHorasPorDia: porDia,
        reservasPausadas: pausadas,
        camposImportantes: guardada.camposDeTesis.map(({ campo }) => campo).filter((campo) => importantes.includes(campo)),
        minutosDeInactividad: inactividad,
      });
      cargarEnFormulario(res.data.data);
      setAviso('Configuración guardada. Ya rige en los kioscos y en la web.');
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo guardar la configuración'));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <PaginaAdmin descripcion="Ajustes generales de las reservas, del catálogo y de las sesiones del panel. Lo que guardes rige desde ese momento, sin reiniciar nada.">
      <form onSubmit={guardar} className="flex max-w-3xl flex-col gap-5">
        <AlertBanner>{error}</AlertBanner>
        {aviso ? (
          <p role="status" className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-primary-dark">
            {aviso}
          </p>
        ) : null}

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">Tiempo de tolerancia y penalización</h2>
          <p className="text-sm text-slate-600">
            Si quien reservó no se presenta dentro de estos minutos desde la hora de inicio, la reserva se libera sola y el lugar
            queda disponible. Vale para cubículos, estaciones y sala de lectura.
          </p>
          <label className="flex items-center gap-3 text-sm text-slate-700">
            <input
              type="number"
              min={toleranciaMinima}
              max={toleranciaMaxima}
              step={1}
              required
              value={tolerancia}
              onChange={(e) => setTolerancia(e.target.value)}
              className="w-24 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            minutos (de {toleranciaMinima} a {toleranciaMaxima})
          </label>
          <p className="text-sm text-slate-600">
            Quien no se presenta queda unas horas <b>sin poder reservar</b> ningún lugar de estudio, y se cancelan las reservas que tenía en
            ese tiempo. El personal puede quitar la penalización desde Reservas. Con 0 no hay penalización.
          </p>
          <label className="flex items-center gap-3 text-sm text-slate-700">
            <input
              type="number"
              min={0}
              max={penalizacionMaxima}
              step={1}
              required
              value={penalizacion}
              onChange={(e) => setPenalizacion(e.target.value)}
              aria-label="Horas sin poder reservar por no presentarse"
              className="w-24 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            horas sin poder reservar (de 0 a {penalizacionMaxima})
          </label>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">Horas de las reservas</h2>
          <p className="text-sm text-slate-600">
            Los cubículos, las estaciones y las sillas de la sala de lectura se reservan por horas enteras, eligiendo de qué hora a qué hora.
            Para que una persona no se quede con todos los lugares, fija cuántas horas seguidas puede reservar y cuántas en total al día
            entre todos ellos.
          </p>
          <div className="flex flex-col gap-3 text-sm text-slate-700 sm:flex-row sm:gap-8">
            <label className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={horasMaximas}
                step={1}
                required
                value={horasPorReserva}
                onChange={(e) => setHorasPorReserva(e.target.value)}
                aria-label="Máximo de horas por reserva"
                className="w-20 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              horas como máximo por reserva
            </label>
            <label className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={horasMaximas}
                step={1}
                required
                value={horasPorDia}
                onChange={(e) => setHorasPorDia(e.target.value)}
                aria-label="Máximo de horas por persona al día"
                className="w-20 rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              horas como máximo por persona al día
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5">
          <h2 className="text-base font-bold text-slate-900">Pausar reservas</h2>
          <p className="text-sm text-slate-600">
            Mientras un tipo de lugar esté pausado, los kioscos y la web avisan y no aceptan reservas nuevas de ese tipo. Las reservas
            que ya existen no se tocan. Úsalo, por ejemplo, durante un cierre o mantenimiento.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {SERVICIOS.map(({ tipo, nombre, detalle }) => (
              <li key={tipo} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span>
                  <span className="block text-sm font-semibold text-slate-900">{nombre}</span>
                  <span className="block text-xs text-slate-500">{detalle}</span>
                </span>
                <span className="flex items-center gap-3">
                  <Badge tone={pausadas[tipo] ? 'warning' : 'status'} dot>
                    {pausadas[tipo] ? 'Pausadas' : 'Abiertas'}
                  </Badge>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={Boolean(pausadas[tipo])}
                      onChange={(e) => setPausadas((previas) => ({ ...previas, [tipo]: e.target.checked }))}
                      className="h-4 w-4 accent-primary"
                    />
                    Pausar
                  </label>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5" aria-labelledby="datos-importantes">
          <h2 id="datos-importantes" className="text-base font-bold text-slate-900">
            Datos importantes de las tesis
          </h2>
          <p className="text-sm text-slate-600">
            Código, título, autor y año son siempre obligatorios. Marca aquí qué otros datos debe tener una tesis completa. Si una tesis llega
            sin alguno, se registra igual (a veces la entregan así), pero en el catálogo queda marcada como <b>incompleta</b> y se puede
            filtrar para completarla después.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {guardada.camposDeTesis.map(({ campo, nombre }) => (
              <li key={campo} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm font-semibold text-slate-900">{nombre}</span>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={importantes.includes(campo)}
                    onChange={(e) => setImportantes((previos) => (e.target.checked ? [...previos, campo] : previos.filter((c) => c !== campo)))}
                    className="h-4 w-4 accent-primary"
                  />
                  Importante
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5" aria-labelledby="cierre-de-sesion">
          <h2 id="cierre-de-sesion" className="text-base font-bold text-slate-900">
            Cierre de sesión por inactividad
          </h2>
          <p className="text-sm text-slate-600">
            Tras cuántos minutos sin tocar la pantalla se cierra la sesión del panel, según el rol. Con <b>Nunca</b> la sesión queda abierta en esa
            PC hasta que la persona salga (útil en la PC de la administración, que avisa cuando llega una solicitud de solvencia); úsalo solo en
            computadoras de la biblioteca que nadie más usa. El cambio se aplica a cada persona la próxima vez que abra el panel.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {Object.entries(ROLES_DEL_PERSONAL).map(([rol, { nombre }]) => (
              <li key={rol} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <label htmlFor={`inactividad-${rol}`} className="text-sm font-semibold text-slate-900">
                  {nombre}
                </label>
                <select
                  id={`inactividad-${rol}`}
                  value={inactividad[rol] ?? 20}
                  onChange={(e) => setInactividad((previo) => ({ ...previo, [rol]: Number(e.target.value) }))}
                  className="rounded-md border border-border bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary focus:outline-none"
                >
                  {guardada.limites.minutosDeInactividad.map((minutos) => (
                    <option key={minutos} value={minutos}>
                      {minutos === 0 ? 'Nunca' : minutos < 60 ? `${minutos} minutos` : `${minutos / 60} ${minutos === 60 ? 'hora' : 'horas'}`}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" icon={Check} disabled={!hayCambios || guardando}>
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </Button>
          <span className="text-xs text-slate-500">
            {guardada.actualizadaEn
              ? `Último cambio: ${fechaLegible(guardada.actualizadaEn)}, por ${guardada.actualizadaPor}.`
              : 'Todavía no se ha cambiado nada: rigen los valores iniciales.'}
          </span>
        </div>
      </form>
    </PaginaAdmin>
  );
}
