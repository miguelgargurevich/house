import { useState } from 'react';
import type { FormEvent } from 'react';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { Alert, Button, ConfirmDialog, Input, useToast } from '../../../../ui';
import type { DominioPermitido, Gateway } from './tipos';

interface Props {
  dominios: DominioPermitido[];
  gateways: Gateway[];
  deshabilitado: boolean;
  onCambio: () => void;
}

/** La lista de dominios a los que un gateway u OCR público puede apuntar. La barrera de fondo es la red (el servidor rechaza IP internas en cada llamada). */
export function DominiosPermitidos({ dominios, gateways, deshabilitado, onCambio }: Props) {
  const toast = useToast();
  const [nuevo, setNuevo] = useState('');
  const [error, setError] = useState<string>();
  const [agregando, setAgregando] = useState(false);
  const [quitar, setQuitar] = useState<DominioPermitido | null>(null);
  const [quitando, setQuitando] = useState(false);

  async function agregar(e?: FormEvent) {
    e?.preventDefault();
    setAgregando(true);
    setError(undefined);
    try {
      await api('/api/llavero/dominios', { method: 'POST', json: { dominio: nuevo.trim() } });
      toast.ok(`Dominio ${nuevo.trim().toLowerCase()} permitido`);
      setNuevo('');
      onCambio();
    } catch (err) { setError(errorText(err)); } finally { setAgregando(false); }
  }

  async function quitarDominio() {
    if (!quitar) return;
    setQuitando(true);
    try {
      await api(`/api/llavero/dominios/${quitar.id}`, { method: 'DELETE' });
      toast.ok(`Dominio ${quitar.dominio} quitado de la lista`);
      setQuitar(null);
      onCambio();
    } catch (err) { toast.error(errorText(err)); } finally { setQuitando(false); }
  }

  const afectados = quitar ? gateways.filter(g => g.dominio === quitar.dominio) : [];

  return (
    <section aria-labelledby="llavero-dominios" className="border-t border-line px-5 py-4">
      <div className="flex gap-3">
        <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="llavero-dominios" className="text-sm font-semibold">Dominios permitidos</h2>
          <p className="mt-0.5 text-sm text-muted">Un gateway u OCR público sólo puede apuntar a uno de estos dominios exactos. Aun así, en cada llamada el servidor comprueba que el dominio resuelva a una dirección pública: nunca a la red interna.</p>
          {dominios.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Aún no hay ninguno: agrega el dominio de tu gateway antes de registrarlo.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Dominios permitidos">
              {dominios.map(d => (
                <li key={d.id} className="flex items-center gap-1 rounded-full bg-surface2 py-0.5 pl-3 pr-1 text-sm">
                  <span className="num">{d.dominio}</span>
                  <Button variant="ghost" disabled={deshabilitado} onClick={() => setQuitar(d)} aria-label={`Quitar ${d.dominio}`}>Quitar</Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={e => void agregar(e)} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start" noValidate>
            <Input label="Agregar dominio" ocultarEtiqueta className="sm:w-80" autoComplete="off" spellCheck={false} placeholder="api.midominio.dev" value={nuevo} onChange={e => setNuevo(e.target.value)} error={error} hint={error ? undefined : 'Sólo el dominio, sin https:// ni ruta.'} disabled={deshabilitado} />
            <Button type="submit" variant="secondary" loading={agregando} disabled={deshabilitado || !nuevo.trim()}>Permitir dominio</Button>
          </form>
        </div>
      </div>
      <ConfirmDialog
        open={!!quitar}
        onClose={() => setQuitar(null)}
        onConfirm={quitarDominio}
        loading={quitando}
        danger
        title="Quitar dominio permitido"
        message={`Se quitará ${quitar?.dominio ?? ''} de la lista.${afectados.length > 0 ? ` Los gateways ${afectados.map(g => g.nombre).join(', ')} dejarán de usarse de inmediato (sus claves se conservan).` : ''}`}
        confirmLabel="Quitar dominio"
      />
      {dominios.length === 0 && gateways.length > 0 && <div className="mt-3"><Alert tone="warn">Hay gateways registrados pero ningún dominio permitido: ninguno se usa.</Alert></div>}
    </section>
  );
}
