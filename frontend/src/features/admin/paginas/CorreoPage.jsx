import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, PlugZap, RefreshCw, Send } from 'lucide-react';
import { adminApi } from '../adminApi';
import ConexionDeGmail from '../componentes/ConexionDeGmail';
import PaginaAdmin from '../componentes/PaginaAdmin';
import { ESTADO_DE_CORREO, TIPO_DE_CORREO, fechaLegible } from '../estados';
import { getErrorMessage } from '../../../shared/api/axiosClient';
import AlertBanner from '../../../shared/components/AlertBanner';
import Badge from '../../../shared/components/Badge';
import Button from '../../../shared/components/Button';
import { Input } from '../../../shared/components/FormField';
import Nota from '../../../shared/components/Nota';

const MODOS = {
  smtp: { tone: 'status', texto: 'Envío real por SMTP' },
  api: { tone: 'status', texto: 'Envío real por API' },
  simulado: { tone: 'warning', texto: 'Simulado: no sale ningún correo' },
};

function Dato({ etiqueta, children, tono }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{etiqueta}</dt>
      <dd className={`break-words text-sm font-medium ${tono === 'error' ? 'text-red-700' : 'text-slate-900'}`}>{children}</dd>
    </div>
  );
}

function Variable({ children }) {
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-slate-800">{children}</code>;
}

// Correo electrónico (solo el administrador): cómo quedó configurado el envío de comprobantes, la cuenta de Gmail (que se conecta desde
// aquí), una prueba de envío y los últimos correos con su resultado. Lo demás se configura con variables del servidor (backend/.env.example).
export default function CorreoPage() {
  // Al volver de Google la dirección trae ?gmail=conectado o ?gmail=error: se muestra una vez y se limpia, para que recargar no lo repita.
  const [parametros, setParametros] = useSearchParams();
  const [vueltaDeGoogle] = useState(() => parametros.get('gmail'));
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [verificacion, setVerificacion] = useState(null);
  const [destino, setDestino] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const cargar = useCallback(async () => {
    try {
      const res = await adminApi.correo();
      setDatos(res.data.data);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo cargar el estado del correo'));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  useEffect(() => {
    if (parametros.has('gmail')) setParametros({}, { replace: true });
  }, [parametros, setParametros]);

  async function verificar() {
    setVerificando(true);
    setVerificacion(null);
    try {
      const res = await adminApi.verificarCorreo();
      setVerificacion(res.data.data);
    } catch (err) {
      setVerificacion({ ok: false, mensaje: getErrorMessage(err, 'No se pudo comprobar la conexión') });
    } finally {
      setVerificando(false);
    }
  }

  async function probar(e) {
    e.preventDefault();
    setEnviando(true);
    setResultado(null);
    try {
      const res = await adminApi.probarCorreo(destino.trim());
      setResultado({ tipo: res.data.data.simulado ? 'simulado' : 'enviado', ...res.data.data });
    } catch (err) {
      setResultado({ tipo: 'error', mensaje: getErrorMessage(err, 'No se pudo enviar el correo de prueba') });
    } finally {
      setEnviando(false);
      cargar();
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-slate-400">
        <Loader2 className="animate-spin" size={18} />
        Cargando el estado del correo...
      </div>
    );
  }

  if (!datos) {
    return <AlertBanner>{error || 'No se pudo cargar el estado del correo'}</AlertBanner>;
  }

  const modo = MODOS[datos.modo];
  const conGmail = datos.gmail && (datos.gmail.puedeConectar || datos.gmail.enUso || datos.gmail.conexion);
  // El aviso de «Gmail no está conectado» ya lo dice la tarjeta de Gmail, con su botón.
  const avisos = conGmail ? datos.avisos.filter((aviso) => !aviso.startsWith('Gmail no está conectado')) : datos.avisos;

  return (
    <PaginaAdmin
      descripcion="Así sale el correo de la biblioteca: los comprobantes de reservas y de solicitudes de solvencia que la gente pide o recibe. Aquí conectas la cuenta de Gmail, ves cómo quedó y compruebas que funciona."
      acciones={
        <Button variant="secondary" icon={RefreshCw} onClick={cargar}>
          Actualizar
        </Button>
      }
    >
      <AlertBanner>{error}</AlertBanner>

      {avisos.length > 0 ? (
        avisos.map((aviso) => (
          <Nota key={aviso} tono="aviso">
            {aviso}
          </Nota>
        ))
      ) : datos.modo === 'simulado' && !conGmail ? (
        <Nota tono="info" titulo="El correo está en modo simulado">
          Los correos se arman completos pero no salen: sirve para pruebas y demostraciones. Para que los comprobantes lleguen de verdad
          hay que configurar un servicio de correo (abajo, «Cómo configurarlo»).
        </Nota>
      ) : null}

      {conGmail ? <ConexionDeGmail gmail={datos.gmail} vuelta={vueltaDeGoogle} onCambio={cargar} /> : null}

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-900">Estado del envío</h2>
          <Badge tone={modo.tone} dot>
            {modo.texto}
          </Badge>
        </div>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <Dato etiqueta="Servicio">{datos.descripcion}</Dato>
          <Dato etiqueta="Remitente">{datos.remitente ?? 'Sin definir'}</Dato>
          {datos.usuario ? <Dato etiqueta="Usuario de SMTP">{datos.usuario}</Dato> : null}
          {datos.conexionSegura !== null ? (
            <Dato etiqueta="Conexión">{datos.conexionSegura ? 'Segura desde el inicio (SSL)' : 'Se asegura con STARTTLS si el servidor lo ofrece'}</Dato>
          ) : null}
          <Dato etiqueta="Último envío real">
            {datos.ultimoEnvio
              ? `${fechaLegible(datos.ultimoEnvio.enviadoEn)} · a ${datos.ultimoEnvio.para}`
              : 'Ninguno desde que se encendió el servidor'}
          </Dato>
          <Dato etiqueta="Último error" tono={datos.ultimoError ? 'error' : undefined}>
            {datos.ultimoError ? `${fechaLegible(datos.ultimoError.fecha)} · ${datos.ultimoError.mensaje}` : 'Ninguno'}
          </Dato>
        </dl>

        {datos.verificable ? (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" icon={PlugZap} onClick={verificar} disabled={verificando}>
                {verificando ? 'Comprobando...' : 'Comprobar la conexión'}
              </Button>
              <span className="text-xs text-slate-500">
                {datos.modo === 'smtp'
                  ? 'Abre la conexión y revisa el usuario y la clave sin mandar ningún correo.'
                  : 'Pregunta a Google si el permiso de la cuenta sigue sirviendo, sin mandar ningún correo.'}
              </span>
            </div>
            {verificacion ? (
              <Nota tono={verificacion.ok ? 'ok' : 'error'}>{verificacion.mensaje}</Nota>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5">
        <div>
          <h2 className="text-base font-bold text-slate-900">Enviar un correo de prueba</h2>
          <p className="mt-1 text-sm text-slate-600">
            Manda un mensaje corto a la dirección que escribas, para confirmar que el servidor puede enviar y que el correo no cae en no
            deseado. {datos.modo === 'simulado' ? 'En modo simulado la prueba solo queda registrada abajo.' : ''}
          </p>
        </div>
        <form onSubmit={probar} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="sm:w-96">
            <Input
              label="Dirección que recibirá la prueba"
              type="email"
              required
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              placeholder="tu.correo@ejemplo.com"
            />
          </div>
          <Button type="submit" variant="brand" icon={Send} disabled={enviando || !destino.trim()} className="sm:h-[38px]">
            {enviando ? 'Enviando...' : 'Enviar prueba'}
          </Button>
        </form>
        {resultado?.tipo === 'enviado' ? (
          <Nota tono="ok" titulo="Correo enviado">
            Salió hacia <b>{resultado.para}</b>. Revisa su bandeja y también la carpeta de correo no deseado.
          </Nota>
        ) : null}
        {resultado?.tipo === 'simulado' ? (
          <Nota tono="aviso" titulo="Quedó simulado">
            El correo para <b>{resultado.para}</b> se armó pero no salió, porque el servidor no tiene un servicio de correo configurado.
          </Nota>
        ) : null}
        {resultado?.tipo === 'error' ? (
          <Nota tono="error" titulo="No se pudo enviar">
            {resultado.mensaje}
          </Nota>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-border bg-white p-5">
        <div>
          <h2 className="text-base font-bold text-slate-900">Últimos correos</h2>
          <p className="mt-1 text-sm text-slate-600">Los más recientes desde que se encendió el servidor (la lista se vacía al reiniciarlo).</p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {['Hora', 'Para', 'Qué era', 'Resultado'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {datos.recientes.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                    Todavía no se ha enviado ningún correo.
                  </td>
                </tr>
              ) : (
                datos.recientes.map((c) => {
                  const situacion = ESTADO_DE_CORREO[c.estado] ?? { tone: 'neutral', label: c.estado };
                  return (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{fechaLegible(c.enviadoEn)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs">{c.para}</td>
                      <td className="px-3 py-2.5">
                        {TIPO_DE_CORREO[c.tipo] ?? c.tipo}
                        <span className="block text-xs text-slate-500">{c.asunto}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge tone={situacion.tone}>{situacion.label}</Badge>
                        {c.error ? <span className="mt-1 block max-w-md text-xs text-red-700">{c.error}</span> : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <details className="group rounded-xl border border-border bg-white p-5">
        <summary className="cursor-pointer text-base font-bold text-slate-900">Cómo configurarlo</summary>
        <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-slate-700">
          <p>
            El correo se define con variables de entorno del servidor: en la plataforma donde se publique la biblioteca, o en <Variable>backend/.env</Variable>{' '}
            en un equipo propio. Después de cambiarlas hay que reiniciar el servidor. Hay tres caminos:
          </p>
          <div>
            <p className="font-semibold text-slate-900">A. API de Gmail (gratis, funciona en la nube)</p>
            <p>
              <Variable>GMAIL_CLIENT_ID</Variable> y <Variable>GMAIL_CLIENT_SECRET</Variable> (del cliente OAuth de tipo Aplicación web) y, opcional,{' '}
              <Variable>CORREO_REMITENTE</Variable> con la misma cuenta de Gmail. Con eso, la cuenta se conecta aquí arriba con <b>Conectar Gmail</b>, y se
              vuelve a conectar igual si algún día Google la anula. También sirve el camino de antes: <Variable>CORREO_API</Variable> con{' '}
              <Variable>gmail</Variable> y <Variable>GMAIL_REFRESH_TOKEN</Variable> generado con <Variable>npm run token-gmail</Variable>; si hay las dos, vale la
              del panel. Para que el permiso no venza, la app de Google debe estar «En producción», no en «Prueba» (pasos en el README, «Correo con Gmail»).
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">B. API de otro servicio de correo</p>
            <p>
              <Variable>CORREO_API</Variable> con <Variable>brevo</Variable> o <Variable>resend</Variable>, <Variable>CORREO_API_KEY</Variable> con la clave
              que da el servicio y <Variable>CORREO_REMITENTE</Variable> con una dirección que hayas verificado allí, por ejemplo{' '}
              <Variable>"Biblioteca Derecho" &lt;biblioteca@tu-dominio.com&gt;</Variable>.
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-900">C. SMTP (Gmail, Microsoft 365, el correo de la universidad…)</p>
            <p>
              <Variable>SMTP_HOST</Variable>, <Variable>SMTP_PORT</Variable> (587, o 465 con conexión segura), <Variable>SMTP_USER</Variable>,{' '}
              <Variable>SMTP_PASS</Variable> y, si el usuario no es un correo, <Variable>CORREO_REMITENTE</Variable>. Con Gmail y Microsoft 365 hace falta
              una «contraseña de aplicación», no la contraseña normal.
            </p>
          </div>
          <Nota tono="aviso" titulo="Ojo con las plataformas gratuitas">
            Railway (planes Free, Trial y Hobby) y Render (servicios gratuitos) bloquean los puertos SMTP: ahí el camino C no funciona y hay que usar el A o el B.
          </Nota>
        </div>
      </details>
    </PaginaAdmin>
  );
}
