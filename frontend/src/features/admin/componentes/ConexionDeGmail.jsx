import { useState } from 'react';
import { Check, Copy, Link2Off, Mail, RefreshCw } from 'lucide-react';
import { adminApi } from '../adminApi';
import { fechaLegible } from '../estados';
import { getErrorMessage } from '../../../shared/api/axiosClient';
import Badge from '../../../shared/components/Badge';
import Button from '../../../shared/components/Button';
import Nota from '../../../shared/components/Nota';

// La cuenta de Gmail con la que sale el correo, y el botón para conectarla (o volver a conectarla si Google la anuló) sin tocar las
// variables del servidor: lleva a Google, la persona elige la cuenta de la biblioteca y da permiso, y Google la trae de vuelta aquí.
// `vuelta`: 'conectado' o 'error' cuando la página se abre al volver de Google.
export default function ConexionDeGmail({ gmail, vuelta, onCambio }) {
  const [trabajando, setTrabajando] = useState('');
  const [error, setError] = useState('');
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);
  const [copiada, setCopiada] = useState(false);

  const conectada = gmail.enUso && !gmail.anulada;
  const desdeElPanel = gmail.origen === 'panel' && gmail.conexion;
  const cuenta = gmail.conexion?.cuenta ?? gmail.cuenta;

  async function conectar() {
    setTrabajando('conectar');
    setError('');
    try {
      const res = await adminApi.conectarGmail();
      window.location.assign(res.data.data.url);
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo empezar la conexión con Google'));
      setTrabajando('');
    }
  }

  async function quitar() {
    setTrabajando('quitar');
    setError('');
    try {
      await adminApi.desconectarGmail();
      setConfirmarQuitar(false);
      onCambio();
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo quitar la conexión'));
    } finally {
      setTrabajando('');
    }
  }

  async function copiarDireccion() {
    try {
      await navigator.clipboard.writeText(gmail.direccionDeRegreso);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 2500);
    } catch {
      /* sin permiso para el portapapeles: la dirección sigue a la vista para copiarla a mano */
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-white p-5" aria-labelledby="cuenta-de-gmail">
      {vuelta === 'conectado' && gmail.ultimoIntento?.ok ? (
        <Nota tono="ok" titulo="¡Listo! Gmail quedó conectado">
          {gmail.ultimoIntento.mensaje} Si quieres, envía abajo un correo de prueba.
        </Nota>
      ) : null}
      {vuelta === 'error' ? (
        <Nota tono="error" titulo="No se pudo conectar Gmail">
          {gmail.ultimoIntento?.mensaje ?? 'Google no completó la conexión. Vuelve a pulsar «Conectar Gmail».'}
        </Nota>
      ) : null}
      {gmail.anulada ? (
        <Nota tono="error" titulo="Gmail se desconectó: los correos no están saliendo">
          {gmail.anulada.mensaje} Pulsa <b>Conectar Gmail</b> y entra con la cuenta de la biblioteca para que vuelvan a salir.
        </Nota>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cuenta-de-gmail" className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Mail size={18} className="text-primary" aria-hidden="true" /> Cuenta de Gmail
        </h2>
        {conectada ? (
          <Badge tone="status" dot>
            Conectada
          </Badge>
        ) : (
          <Badge tone={gmail.anulada ? 'danger' : 'warning'} dot>
            {gmail.anulada ? 'Desconectada' : 'Sin conectar'}
          </Badge>
        )}
      </div>

      <div className="flex flex-col gap-1 text-sm text-slate-700">
        {cuenta ? (
          <p>
            Los correos salen desde <b className="text-slate-900">{cuenta}</b>.
          </p>
        ) : null}
        {desdeElPanel ? (
          <p className="text-xs text-slate-500">
            Conectada desde este panel el {fechaLegible(gmail.conexion.conectadaEn)}
            {gmail.conexion.conectadaPor ? ` por ${gmail.conexion.conectadaPor}` : ''}.
          </p>
        ) : gmail.origen === 'variables' && gmail.enUso ? (
          <p className="text-xs text-slate-500">Con el permiso guardado en las variables del servidor. Si algún día deja de servir, conéctala aquí con el botón.</p>
        ) : gmail.origen === 'variables' ? (
          <p>Hay un permiso de Gmail en las variables del servidor, pero el correo no lo está usando: revisa el aviso de arriba.</p>
        ) : (
          <p>Todavía no hay una cuenta de Gmail conectada.</p>
        )}
      </div>

      {gmail.puedeConectar ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant={conectada ? 'secondary' : 'primary'} icon={conectada ? RefreshCw : Mail} onClick={conectar} disabled={Boolean(trabajando)}>
              {trabajando === 'conectar' ? 'Abriendo Google...' : conectada ? 'Volver a conectar o cambiar de cuenta' : 'Conectar Gmail'}
            </Button>
            {desdeElPanel && !confirmarQuitar ? (
              <button
                type="button"
                onClick={() => setConfirmarQuitar(true)}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-secondary"
              >
                <Link2Off size={15} aria-hidden="true" /> Quitar la conexión
              </button>
            ) : null}
          </div>
          {confirmarQuitar ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
              <span className="mr-auto">¿Quitar la conexión? Si el servidor no tiene otro permiso guardado en sus variables, los correos dejarán de salir.</span>
              <Button variant="secondary" onClick={() => setConfirmarQuitar(false)} disabled={Boolean(trabajando)}>
                No
              </Button>
              <Button variant="primary" icon={Link2Off} onClick={quitar} disabled={Boolean(trabajando)}>
                {trabajando === 'quitar' ? 'Quitando...' : 'Sí, quitarla'}
              </Button>
            </div>
          ) : null}
          {error ? <Nota tono="error">{error}</Nota> : null}

          <ol className="flex list-decimal flex-col gap-1 rounded-lg bg-surface py-3 pl-8 pr-4 text-sm text-slate-700">
            <li>
              Pulsa <b>{conectada ? 'Volver a conectar' : 'Conectar Gmail'}</b>: se abre la página de Google.
            </li>
            <li>Elige la cuenta de Gmail de la biblioteca (si no aparece, entra con ella).</li>
            <li>
              Si Google avisa que la app no está verificada, pulsa <b>Configuración avanzada</b> y luego <b>Ir a…</b> (es la app de la biblioteca).
            </li>
            <li>
              Deja marcado el permiso de <b>enviar correos</b> y pulsa <b>Continuar</b>. Vuelves aquí solo, con la cuenta conectada.
            </li>
          </ol>

          <details className="text-sm text-slate-700">
            <summary className="cursor-pointer font-semibold text-slate-600">Si Google muestra «Error 400: redirect_uri_mismatch» (para quien administra Google Cloud)</summary>
            <div className="mt-2 flex flex-col gap-2">
              <p>
                Se hace una sola vez: en Google Cloud, <b>APIs y servicios → Credenciales</b>, el cliente OAuth tiene que ser de tipo <b>Aplicación web</b> y
                tener esta dirección en <b>URI de redireccionamiento autorizados</b>:
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all rounded bg-slate-100 px-2 py-1 font-mono text-[13px] text-slate-800">{gmail.direccionDeRegreso}</code>
                <Button variant="secondary" icon={copiada ? Check : Copy} onClick={copiarDireccion} className="!px-3 !py-1.5">
                  {copiada ? 'Copiada' : 'Copiar'}
                </Button>
              </div>
              <p>
                Si el cliente es de tipo «App de escritorio», crea uno nuevo de tipo Aplicación web con esa dirección y pon su ID y su secreto en las variables{' '}
                <code className="font-mono text-[13px]">GMAIL_CLIENT_ID</code> y <code className="font-mono text-[13px]">GMAIL_CLIENT_SECRET</code> del servidor.
              </p>
            </div>
          </details>
        </>
      ) : (
        <Nota tono="aviso" titulo="Falta el cliente de Google">
          Para conectar Gmail desde aquí, el servidor necesita las variables <code className="font-mono">GMAIL_CLIENT_ID</code> y{' '}
          <code className="font-mono">GMAIL_CLIENT_SECRET</code> (del cliente OAuth de Google Cloud, tipo Aplicación web). Se ponen una sola vez.
        </Nota>
      )}
    </section>
  );
}
