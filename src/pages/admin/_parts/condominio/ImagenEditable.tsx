import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { PhotoIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { Alert, Button, ConfirmDialog, useToast } from '../../../../ui';
import { ACCEPT_IMAGEN, errorDeImagen, subirImagen } from '../../../shared/_parts/imagenes';
import { ImagenRecibo } from '../../../shared/mantenimiento/ImagenRecibo';

interface Props {
  /** Qué imagen es («Foto de cabecera», «Logo»). */
  titulo: string;
  ayuda: string;
  /** URL actual de la imagen (con su versión) o `null` si no hay. */
  url: string | null;
  /** Ruta de la API de esa imagen: `PUT` la sube, `DELETE` la quita. */
  ruta: string;
  /** Se llama tras subir (`true`) o quitar (`false`), para que la pantalla recargue la URL. */
  onCambio: (hay: boolean) => void;
  className?: string;
}

/** Imagen del recibo impreso (foto de cabecera del condominio o logo de la empresa): vista previa, subir/cambiar y quitar. Máx. 2 MB, JPG/PNG/WebP. */
export function ImagenEditable({ titulo, ayuda, url, ruta, onCambio, className }: Props) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quitar, setQuitar] = useState(false);
  const [quitando, setQuitando] = useState(false);

  async function elegir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const err = errorDeImagen(f);
    setError(err);
    if (err) return;
    setSubiendo(true);
    try {
      await subirImagen(ruta, f);
      toast.ok(`${titulo} guardada`);
      onCambio(true);
    } catch (x) { setError(errorText(x)); } finally { setSubiendo(false); }
  }

  async function confirmarQuitar() {
    setQuitando(true);
    try {
      await api(ruta, { method: 'DELETE' });
      toast.ok(`${titulo} quitada`);
      setQuitar(false);
      onCambio(false);
    } catch (x) { toast.error(errorText(x)); } finally { setQuitando(false); }
  }

  return (
    <div className={className}>
      <p className="text-sm font-medium">{titulo}</p>
      <p className="mb-2 text-xs text-muted">{ayuda}</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-24 w-40 items-center justify-center overflow-hidden rounded border border-line bg-surface2 text-muted">
          {url
            ? <ImagenRecibo src={url} alt={titulo} className="h-full w-full object-contain" />
            : <span className="flex flex-col items-center gap-1 text-xs"><PhotoIcon className="h-6 w-6" aria-hidden="true" />Sin imagen</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={subiendo} onClick={() => input.current?.click()}>{url ? 'Cambiar imagen' : 'Subir imagen'}</Button>
          {url && <Button variant="ghost" size="sm" onClick={() => setQuitar(true)}>Quitar</Button>}
        </div>
        <input ref={input} type="file" accept={ACCEPT_IMAGEN} className="sr-only" tabIndex={-1} aria-label={`Elegir ${titulo.toLowerCase()}`} onChange={e => void elegir(e)} />
      </div>
      {error && <div className="mt-2"><Alert tone="bad">{error}</Alert></div>}
      <ConfirmDialog open={quitar} onClose={() => setQuitar(false)} onConfirm={confirmarQuitar} loading={quitando} danger title={`Quitar ${titulo.toLowerCase()}`} message="El recibo se imprimirá sin esta imagen." confirmLabel="Quitar" />
    </div>
  );
}
