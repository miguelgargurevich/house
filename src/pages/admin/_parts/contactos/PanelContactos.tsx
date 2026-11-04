import { useState } from 'react';
import { ArrowDownTrayIcon, ArrowUpTrayIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource, type Page } from '../../../../api';
import { Button, Card, Select, Skeleton, useToast } from '../../../../ui';
import { nombreTorre } from '../medios/tipos';
import { urlPlantilla } from './cliente';
import { ModalContactos } from './ModalContactos';
import { textoCola, type EstadoCola } from './vista';

interface Torre { id: number; nombre: string | null }

const enlaceBoton = 'inline-flex h-10 items-center justify-center gap-2 rounded border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface2';

/**
 * Encima de la lista de Residentes (sólo administración): descargar la plantilla, subir los contactos y dejar en cola las invitaciones de los que
 * ya tienen correo. Las invitaciones no salen de golpe: este panel muestra cuántas se enviaron y cuántas esperan su turno.
 */
export function PanelContactos({ complejoId, complejoNombre, onCambio }: { complejoId: number; complejoNombre?: string; onCambio?: () => void }) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [torre, setTorre] = useState('');
  const [encolando, setEncolando] = useState(false);
  const estado = useResource<EstadoCola>(`/api/contactos/invitaciones?complejo_id=${complejoId}`);
  const torres = useResource<Page<Torre>>(`/api/estructuras?complejo_id=${complejoId}&pageSize=100`);
  const e = estado.data;

  async function invitarPendientes() {
    setEncolando(true);
    try {
      const r = await api<{ encoladas: number }>('/api/contactos/invitaciones', { method: 'POST', json: { complejo_id: complejoId, ...(torre ? { estructura_id: Number(torre) } : {}) } });
      toast.ok(r.encoladas === 0 ? 'No había vecinos pendientes de invitar.' : `Quedaron en cola ${r.encoladas} ${r.encoladas === 1 ? 'invitación' : 'invitaciones'}: salen en tandas diarias.`);
      void estado.reload();
      onCambio?.();
    } catch (err) { toast.error(errorText(err)); } finally { setEncolando(false); }
  }

  return (
    <>
      <Card className="mb-4">
        <section aria-labelledby="contactos-titulo" className="space-y-3 p-4">
          <div>
            <h3 id="contactos-titulo" className="text-sm font-semibold">Contactos de los vecinos</h3>
            <p className="mt-1 text-sm text-muted">Carga los correos y celulares de todo el condominio con un Excel, en lugar de editar vecino por vecino.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={urlPlantilla(complejoId)} className={enlaceBoton} download><ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />Descargar plantilla de contactos</a>
            <Button icon={<ArrowUpTrayIcon className="h-4 w-4" />} onClick={() => setAbierto(true)}>Subir contactos</Button>
          </div>
          <div className="space-y-2 border-t border-line pt-3">
            <p className="text-sm" aria-live="polite">
              {e ? textoCola(e) : estado.error ? <span className="text-bad">{estado.error}</span> : <Skeleton className="inline-block h-4 w-64" />}
            </p>
            {e && e.por_encolar > 0 && <p className="text-xs text-muted">{e.por_encolar} {e.por_encolar === 1 ? 'vecino con correo todavía no tiene' : 'vecinos con correo todavía no tienen'} invitación. Se mandan hasta {e.por_dia} por día.</p>}
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-full sm:w-56">
                <Select label="Block" value={torre} onChange={(ev) => setTorre(ev.target.value)}>
                  <option value="">Todo el condominio</option>
                  {(torres.data?.items ?? []).map((t) => <option key={t.id} value={t.id}>{nombreTorre(t)}</option>)}
                </Select>
              </div>
              <Button variant="secondary" icon={<EnvelopeIcon className="h-4 w-4" />} loading={encolando} onClick={() => void invitarPendientes()}>Invitar a los pendientes</Button>
            </div>
          </div>
        </section>
      </Card>
      {abierto && <ModalContactos complejoId={complejoId} complejoNombre={complejoNombre} onClose={() => setAbierto(false)} onGuardado={() => { void estado.reload(); onCambio?.(); }} />}
    </>
  );
}
