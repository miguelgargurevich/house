import { useState } from 'react';
import { ArrowUpCircleIcon, PencilSquareIcon, PlusIcon, TrashIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../../../../api';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, IconButton, Modal, Skeleton, useToast } from '../../../../../ui';
import { Interruptor } from '../../catalogo/Interruptor';
import { PersonaFormModal } from './PersonaFormModal';
import { etiquetaRelacion, textoDeAcceso, type Persona } from './tipos';

interface Props {
  unidad: { id: number; codigo: string } | null;
  onClose: () => void;
  /** Tras cualquier cambio: la lista de unidades (titular e inquilino) se vuelve a leer. */
  onCambio?: () => void;
}

/**
 * «Personas del departamento»: quién vive o es dueño, quién tiene usuario en Torre (interruptor), a quién le llega el aviso de cobro y quién recibe los
 * comunicados. Una tarjeta por persona (sin tabla: se lee bien a 375 px).
 */
export function PersonasModal({ unidad, onClose, onCambio }: Props) {
  const toast = useToast();
  const url = unidad ? `/api/unidades/${unidad.id}/personas` : null;
  const lista = useResource<{ items: Persona[] }>(url);
  const [edicion, setEdicion] = useState<Persona | 'nueva' | null>(null);
  const [quitar, setQuitar] = useState<Persona | null>(null);
  const [ocupada, setOcupada] = useState<number | null>(null);
  const [quitando, setQuitando] = useState(false);

  async function correr(id: number, accion: () => Promise<unknown>, ok: string) {
    setOcupada(id);
    // La lista se relee ANTES de avisar: si no, el aviso «Acceso encendido» salía con el interruptor todavía apagado (en producción la lectura tarda).
    try { await accion(); await lista.reload(); toast.ok(ok); onCambio?.(); } catch (e) { toast.error(errorText(e)); } finally { setOcupada(null); }
  }
  const alternar = (p: Persona, activo: boolean) => correr(p.id, () => api(`${url}/${p.id}/acceso`, { method: 'PUT', json: { activo } }), activo ? 'Acceso encendido' : 'Acceso apagado');
  const marcarPaga = (p: Persona) => correr(p.id, () => api(`${url}/${p.id}`, { method: 'PUT', json: { responsable_pago: true } }), 'Responsable de pago cambiado');
  const hacerTitular = (p: Persona) => correr(p.id, () => api(`${url}/${p.id}/titular`, { method: 'PUT' }), p.relacion === 'inquilino' ? 'Quedó como inquilino principal' : 'Quedó como titular');

  async function confirmarQuitar() {
    if (!quitar) return;
    setQuitando(true);
    try { await api(`${url}/${quitar.id}`, { method: 'DELETE' }); await lista.reload(); toast.ok('Persona quitada'); setQuitar(null); onCambio?.(); } catch (e) { toast.error(errorText(e)); setQuitar(null); } finally { setQuitando(false); }
  }

  const items = lista.data?.items ?? [];

  return (
    <>
      <Modal
        open={!!unidad}
        onClose={onClose}
        title={`Personas del departamento ${unidad?.codigo ?? ''}`}
        description="Decide quién tiene usuario en Torre, a quién le llega el aviso de cobro y quién recibe los comunicados."
        size="lg"
        footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEdicion('nueva')}>Agregar persona</Button></>}
      >
        {lista.error && <Alert tone="bad">{lista.error}</Alert>}
        {lista.loading && !lista.data && <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>}
        {lista.data && items.length === 0 && (
          <EmptyState title="Aún no hay personas" description="Agrega a quien vive o es dueño del departamento. El aviso de cobro le llega al responsable de pago." icon={<UserGroupIcon />} />
        )}
        <ul className="space-y-3">
          {items.map((p) => (
            <li key={p.id} className="rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words font-medium">{p.nombre}</p>
                  <p className="break-words text-sm text-muted">{[p.correo, p.celular].filter(Boolean).join(' · ') || 'Sin correo ni celular'}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {p.tiene_cuenta && !p.principal && <IconButton label={`Hacer titular a ${p.nombre}`} onClick={() => void hacerTitular(p)} disabled={ocupada === p.id}><ArrowUpCircleIcon className="h-4 w-4" /></IconButton>}
                  <IconButton label={`Editar a ${p.nombre}`} onClick={() => setEdicion(p)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
                  <IconButton label={`Quitar a ${p.nombre}`} onClick={() => setQuitar(p)}><TrashIcon className="h-4 w-4" /></IconButton>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="neutral">{etiquetaRelacion(p.relacion)}{p.principal ? ' principal' : ''}</Badge>
                {p.responsable_pago && <Badge tone="brand">Paga</Badge>}
                {p.recibe_comunicados && <Badge tone="info">Recibe comunicados</Badge>}
              </div>
              <div className="mt-3 border-t border-line pt-3">
                <Interruptor
                  label="Tiene usuario en Torre"
                  hint={textoDeAcceso(p.estado_acceso)}
                  checked={p.acceso_activo}
                  disabled={ocupada === p.id}
                  onChange={(e) => void alternar(p, e.target.checked)}
                />
                {!p.responsable_pago && (
                  <button type="button" className="mt-2 text-sm font-medium text-brand underline-offset-2 hover:underline disabled:opacity-50" disabled={ocupada === p.id} onClick={() => void marcarPaga(p)}>
                    Que a esta persona le llegue el aviso de cobro
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Modal>

      <PersonaFormModal unidadId={unidad?.id ?? 0} persona={edicion} onClose={() => setEdicion(null)} onGuardada={async () => { await lista.reload(); setEdicion(null); onCambio?.(); }} />
      <ConfirmDialog
        open={!!quitar}
        onClose={() => setQuitar(null)}
        onConfirm={confirmarQuitar}
        loading={quitando}
        danger
        title="Quitar persona"
        message={`Se quitará a ${quitar?.nombre ?? ''} de la lista del departamento. Si tiene usuario en Torre y no le queda otro departamento, deja de entrar.`}
        confirmLabel="Quitar persona"
      />
    </>
  );
}
