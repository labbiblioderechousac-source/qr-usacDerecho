import { useId, useRef, useState } from 'react';
import { Camera, Loader2, RefreshCw, X } from 'lucide-react';
import { TIPOS_DE_FOTO, comprimirFoto, pesoLegible } from '../../shared/utils/comprimirFoto';

// Un campo para subir una foto (el comprobante de pago o la orden de pago). En el celular deja tomarla con la cámara o elegirla de la
// galería; en la computadora, elegir un archivo. La foto se achica antes de guardarla en el formulario (ver comprimirFoto) y se muestra
// en miniatura para que la persona compruebe que se lee.
export default function CampoDeFoto({ etiqueta, ayuda, foto, error, onCambiar }) {
  const id = useId();
  const entrada = useRef(null);
  const [preparando, setPreparando] = useState(false);
  const [problema, setProblema] = useState('');

  async function alElegir(e) {
    const archivo = e.target.files?.[0];
    e.target.value = ''; // así se puede volver a elegir el mismo archivo
    if (!archivo) return;
    setPreparando(true);
    setProblema('');
    try {
      onCambiar(await comprimirFoto(archivo));
    } catch (err) {
      setProblema(err.message);
    } finally {
      setPreparando(false);
    }
  }

  const mensaje = problema || error;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-slate-800">
        {etiqueta} <span className="text-action">*</span>
      </label>
      <input
        ref={entrada}
        id={id}
        type="file"
        accept={TIPOS_DE_FOTO.join(',')}
        className="sr-only"
        aria-invalid={mensaje ? 'true' : undefined}
        aria-describedby={`${id}-ayuda`}
        onChange={alElegir}
      />
      {foto ? (
        <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-3">
          <img src={foto.dataUrl} alt={`Vista previa: ${etiqueta}`} className="h-24 w-24 shrink-0 rounded-lg border border-border bg-white object-contain" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-slate-900">Foto lista</p>
            <p className="text-xs text-slate-500">
              {foto.ancho} × {foto.alto} px · {pesoLegible(foto.bytes)}
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <button type="button" onClick={() => entrada.current?.click()} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                <RefreshCw size={13} aria-hidden="true" /> Cambiar
              </button>
              <button type="button" onClick={() => onCambiar(null)} className="inline-flex items-center gap-1 text-xs font-semibold text-secondary hover:underline">
                <X size={13} aria-hidden="true" /> Quitar
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => entrada.current?.click()}
          disabled={preparando}
          className={`flex items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-sm font-semibold transition-colors ${
            mensaje ? 'border-red-300 bg-red-50 text-red-700' : 'border-border bg-surface text-primary hover:border-primary'
          }`}
        >
          {preparando ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Camera size={18} aria-hidden="true" />}
          {preparando ? 'Preparando la foto...' : 'Tomar o elegir la foto'}
        </button>
      )}
      <p id={`${id}-ayuda`} className="text-xs text-slate-500">
        {ayuda} JPG, PNG o WebP.
      </p>
      {mensaje ? <p className="text-xs font-medium text-secondary">{mensaje}</p> : null}
    </div>
  );
}
