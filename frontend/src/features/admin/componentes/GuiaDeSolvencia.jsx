import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ExternalLink, Film, ListOrdered, Pencil, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { solvenciaApi } from '../../solvencia/solvenciaApi';
import { getErrorMessage } from '../../../shared/api/axiosClient';
import AlertBanner from '../../../shared/components/AlertBanner';
import Button from '../../../shared/components/Button';
import Modal from '../../../shared/components/Modal';
import { Checkbox, Input, Textarea } from '../../../shared/components/FormField';
import { PASOS_DE_SOLVENCIA } from '../../../shared/config/navegacion';
import { fechaLegible } from '../estados';

// «Cómo hacer tu solvencia» desde el panel: cambiar los videos (pegando el enlace de YouTube) y los pasos, agregarlos, quitarlos o
// cambiarlos de orden, sin tocar el código. Lo guardado se ve al instante en el sitio y en los kioscos. Los mismos límites que el servidor.

const MAXIMO_DE_VIDEOS = 4;
const MAXIMO_DE_PASOS = 12;

// Igual que en el servidor: acepta el enlace de YouTube de cualquier forma, o solo el código de 11 caracteres.
function idDeYoutube(valor) {
  const texto = String(valor ?? '').trim();
  if (/^[\w-]{11}$/.test(texto)) return texto;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(texto) ? texto : `https://${texto}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com', 'youtube-nocookie.com'].includes(host)) {
    id = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)?.[1] ?? null;
  }
  return id && /^[\w-]{11}$/.test(id.slice(0, 11)) ? id.slice(0, 11) : null;
}

let ultimaClave = 0;
const nuevaClave = () => (ultimaClave += 1);

const largo = (valor) => valor.trim().replace(/\s+/g, ' ').length;
const fueraDeRango = (valor, minimo, maximo) => largo(valor) < minimo || largo(valor) > maximo;

function paraEditar(guia) {
  return {
    videos: guia.videos.map((v) => ({ clave: nuevaClave(), enlace: `https://youtu.be/${v.id}`, titulo: v.titulo })),
    pasos: guia.pasos.map((p) => ({ clave: nuevaClave(), titulo: p.titulo, texto: p.texto, conFormulario: Boolean(p.conFormulario) })),
  };
}

function erroresDe({ videos, pasos }) {
  const errores = {};
  videos.forEach((v) => {
    if (!idDeYoutube(v.enlace)) errores[`${v.clave}-enlace`] = 'Pega el enlace del video de YouTube (por ejemplo https://youtu.be/HaVEv74BTS4)';
    if (fueraDeRango(v.titulo, 3, 80)) errores[`${v.clave}-titulo`] = 'Escribe de 3 a 80 letras';
  });
  pasos.forEach((p) => {
    if (fueraDeRango(p.titulo, 3, 80)) errores[`${p.clave}-titulo`] = 'Escribe de 3 a 80 letras';
    if (fueraDeRango(p.texto, 3, 600)) errores[`${p.clave}-texto`] = 'Escribe de 3 a 600 letras';
  });
  return errores;
}

function mover(lista, i, hacia) {
  const nueva = [...lista];
  [nueva[i], nueva[i + hacia]] = [nueva[i + hacia], nueva[i]];
  return nueva;
}

function BotonesDeOrden({ i, total, que, onMover, onQuitar, puedeQuitar = true }) {
  const clase = 'rounded-md p-1.5 text-slate-500 transition-colors hover:bg-surface hover:text-slate-900 disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="flex shrink-0 flex-col gap-1">
      <button type="button" className={clase} disabled={i === 0} onClick={() => onMover(i, -1)} aria-label={`Subir ${que} ${i + 1}`} title="Subir">
        <ArrowUp size={16} />
      </button>
      <button type="button" className={clase} disabled={i === total - 1} onClick={() => onMover(i, 1)} aria-label={`Bajar ${que} ${i + 1}`} title="Bajar">
        <ArrowDown size={16} />
      </button>
      <button
        type="button"
        className={`${clase} hover:!bg-red-50 hover:!text-secondary`}
        disabled={!puedeQuitar}
        onClick={() => onQuitar(i)}
        aria-label={`Quitar ${que} ${i + 1}`}
        title="Quitar"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function EditorDeGuia({ guia, onCerrar, onGuardada }) {
  const [borrador, setBorrador] = useState(() => paraEditar(guia));
  const [trabajando, setTrabajando] = useState(false);
  const [confirmarOriginal, setConfirmarOriginal] = useState(false);
  const [error, setError] = useState('');
  const errores = erroresDe(borrador);
  const hayErrores = Object.keys(errores).length > 0;
  const { videos, pasos } = borrador;

  const cambiar = (lista, clave, campo, valor) =>
    setBorrador((b) => ({ ...b, [lista]: b[lista].map((item) => (item.clave === clave ? { ...item, [campo]: valor } : item)) }));
  const moverEn = (lista) => (i, hacia) => setBorrador((b) => ({ ...b, [lista]: mover(b[lista], i, hacia) }));
  const quitarDe = (lista) => (i) => setBorrador((b) => ({ ...b, [lista]: b[lista].filter((_, j) => j !== i) }));

  async function guardar(e) {
    e.preventDefault();
    if (hayErrores) return;
    setTrabajando(true);
    setError('');
    try {
      const res = await solvenciaApi.guardarGuia({
        videos: videos.map((v) => ({ enlace: v.enlace.trim(), titulo: v.titulo })),
        pasos: pasos.map((p) => ({ titulo: p.titulo, texto: p.texto, conFormulario: p.conFormulario })),
      });
      onGuardada(res.data.data, 'Guardado: la página «Cómo hacer tu solvencia» ya muestra los cambios.');
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo guardar'));
      setTrabajando(false);
    }
  }

  async function volverAlOriginal() {
    setTrabajando(true);
    setError('');
    try {
      const res = await solvenciaApi.restaurarGuia();
      onGuardada(res.data.data, 'Listo: la página volvió a los videos y pasos originales de la biblioteca.');
    } catch (err) {
      setError(getErrorMessage(err, 'No se pudo volver a los originales'));
      setTrabajando(false);
      setConfirmarOriginal(false);
    }
  }

  return (
    <Modal
      open
      title="Cambiar los videos y los pasos de «Cómo hacer tu solvencia»"
      onClose={trabajando ? undefined : onCerrar}
      ancho="max-w-3xl"
      footer={
        confirmarOriginal ? (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <p className="mr-auto text-sm font-semibold text-slate-800">¿Volver a los videos y pasos originales? Lo que cambiaste se pierde.</p>
            <Button variant="secondary" onClick={() => setConfirmarOriginal(false)} disabled={trabajando}>
              No
            </Button>
            <Button variant="primary" icon={RotateCcw} onClick={volverAlOriginal} disabled={trabajando}>
              {trabajando ? 'Volviendo...' : 'Sí, volver a los originales'}
            </Button>
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" icon={RotateCcw} className="mr-auto" onClick={() => setConfirmarOriginal(true)} disabled={trabajando}>
              Volver a los originales
            </Button>
            <Button variant="secondary" onClick={onCerrar} disabled={trabajando}>
              Cancelar
            </Button>
            <Button variant="primary" type="submit" form="form-guia-solvencia" icon={Save} disabled={trabajando || hayErrores}>
              {trabajando ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </div>
        )
      }
    >
      <form id="form-guia-solvencia" onSubmit={guardar} className="flex flex-col gap-6">
        <p className="text-sm text-slate-700">
          Lo que guardes se ve al instante en la página <b>Cómo hacer tu solvencia</b>, en el sitio y en los kioscos. Para cambiar un video, copia su
          enlace en YouTube (botón <b>Compartir</b> → <b>Copiar</b>) y pégalo aquí.
        </p>
        <AlertBanner>{error}</AlertBanner>
        {hayErrores ? <p className="-mt-3 text-sm font-semibold text-secondary">Revisa lo marcado en rojo para poder guardar.</p> : null}

        <section aria-labelledby="guia-videos" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="guia-videos" className="flex items-center gap-2 font-bold text-slate-900">
              <Film size={18} className="text-primary" aria-hidden="true" /> Videos ({videos.length} de {MAXIMO_DE_VIDEOS})
            </h3>
            <p className="text-xs text-slate-500">El primero sale arriba de todo; los demás, al final de la página.</p>
          </div>
          {videos.length === 0 ? <p className="rounded-lg bg-surface px-3 py-2 text-sm text-slate-600">La página no muestra ningún video.</p> : null}
          {videos.map((video, i) => {
            const id = idDeYoutube(video.enlace);
            return (
              <div key={video.clave} className="flex gap-3 rounded-xl border border-border p-3">
                <div className="hidden w-36 shrink-0 sm:block">
                  {id ? (
                    <img src={`https://i.ytimg.com/vi/${id}/mqdefault.jpg`} alt="" className="aspect-video w-full rounded-lg bg-slate-100 object-cover" />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                      <Film size={24} aria-hidden="true" />
                    </div>
                  )}
                  <p className="mt-1 text-center text-[11px] font-semibold text-slate-500">{i === 0 ? 'Arriba de todo' : 'Al final'}</p>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Input
                    label={`Enlace del video ${i + 1}`}
                    value={video.enlace}
                    placeholder="https://youtu.be/..."
                    onChange={(e) => cambiar('videos', video.clave, 'enlace', e.target.value)}
                    error={errores[`${video.clave}-enlace`]}
                  />
                  <Input
                    label="Título (se ve debajo del video)"
                    value={video.titulo}
                    maxLength={80}
                    onChange={(e) => cambiar('videos', video.clave, 'titulo', e.target.value)}
                    error={errores[`${video.clave}-titulo`]}
                  />
                  {id ? (
                    <a href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-xs font-semibold text-primary hover:underline">
                      Verlo en YouTube <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : null}
                </div>
                <BotonesDeOrden i={i} total={videos.length} que="el video" onMover={moverEn('videos')} onQuitar={quitarDe('videos')} />
              </div>
            );
          })}
          {videos.length < MAXIMO_DE_VIDEOS ? (
            <Button
              variant="secondary"
              icon={Plus}
              className="self-start"
              onClick={() => setBorrador((b) => ({ ...b, videos: [...b.videos, { clave: nuevaClave(), enlace: '', titulo: '' }] }))}
            >
              Agregar un video
            </Button>
          ) : null}
        </section>

        <section aria-labelledby="guia-pasos" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id="guia-pasos" className="flex items-center gap-2 font-bold text-slate-900">
              <ListOrdered size={18} className="text-primary" aria-hidden="true" /> Pasos ({pasos.length} de {MAXIMO_DE_PASOS})
            </h3>
            <p className="text-xs text-slate-500">Se numeran solos, en este orden.</p>
          </div>
          <ol className="flex flex-col gap-3">
            {pasos.map((paso, i) => (
              <li key={paso.clave} className="flex gap-3 rounded-xl border border-border p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-white">{i + 1}</span>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Input
                    label="Título del paso"
                    value={paso.titulo}
                    maxLength={80}
                    onChange={(e) => cambiar('pasos', paso.clave, 'titulo', e.target.value)}
                    error={errores[`${paso.clave}-titulo`]}
                  />
                  <Textarea
                    label="Explicación"
                    rows={3}
                    maxLength={600}
                    value={paso.texto}
                    onChange={(e) => cambiar('pasos', paso.clave, 'texto', e.target.value)}
                    error={errores[`${paso.clave}-texto`]}
                  />
                  <Checkbox checked={paso.conFormulario} onChange={(e) => cambiar('pasos', paso.clave, 'conFormulario', e.target.checked)}>
                    Mostrar en este paso el botón <b>Ir al formulario</b>
                  </Checkbox>
                </div>
                <BotonesDeOrden
                  i={i}
                  total={pasos.length}
                  que="el paso"
                  onMover={moverEn('pasos')}
                  onQuitar={quitarDe('pasos')}
                  puedeQuitar={pasos.length > 1}
                />
              </li>
            ))}
          </ol>
          {pasos.length < MAXIMO_DE_PASOS ? (
            <Button
              variant="secondary"
              icon={Plus}
              className="self-start"
              onClick={() => setBorrador((b) => ({ ...b, pasos: [...b.pasos, { clave: nuevaClave(), titulo: '', texto: '', conFormulario: false }] }))}
            >
              Agregar un paso
            </Button>
          ) : null}
        </section>
      </form>
    </Modal>
  );
}

// La franja en la página de Solvencias: cuántos videos y pasos tiene la guía, quién la cambió por última vez y el botón para editarla.
export default function GuiaDeSolvencia() {
  const [guia, setGuia] = useState(null);
  const [editando, setEditando] = useState(false);
  const [aviso, setAviso] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    solvenciaApi
      .guia()
      .then((res) => setGuia(res.data.data))
      .catch((err) => setError(getErrorMessage(err, 'No se pudo leer la guía de la solvencia')));
  }, []);

  if (!guia) return error ? <p className="text-xs font-medium text-secondary">{error}</p> : null;

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900">Página «Cómo hacer tu solvencia»</p>
          <p className="text-xs text-slate-600">
            {guia.videos.length} {guia.videos.length === 1 ? 'video' : 'videos'} y {guia.pasos.length} {guia.pasos.length === 1 ? 'paso' : 'pasos'}
            {guia.actualizadaEn ? ` · cambiada el ${fechaLegible(guia.actualizadaEn)}${guia.actualizadaPor ? ` por ${guia.actualizadaPor}` : ''}` : ' · la original de la biblioteca'}
          </p>
        </div>
        <Link
          to={PASOS_DE_SOLVENCIA.to}
          target="_blank"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-semibold text-primary hover:bg-blue-50"
        >
          Ver la página <ExternalLink size={14} aria-hidden="true" />
        </Link>
        <Button variant="brand" icon={Pencil} onClick={() => setEditando(true)}>
          Cambiar videos y pasos
        </Button>
      </div>
      {aviso ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {aviso}
        </p>
      ) : null}
      {editando ? (
        <EditorDeGuia
          guia={guia}
          onCerrar={() => setEditando(false)}
          onGuardada={(nueva, mensaje) => {
            setGuia(nueva);
            setAviso(mensaje);
            setEditando(false);
          }}
        />
      ) : null}
    </div>
  );
}
