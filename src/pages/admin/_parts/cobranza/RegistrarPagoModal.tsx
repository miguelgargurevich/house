import { useState } from 'react';
import { useList, useResource } from '../../../../api';
import { Alert, Button, EmptyState, ErrorState, Input, Modal, Select, Skeleton, StatusBadge, fechaCorta, periodo, soles } from '../../../../ui';
import type { Mantenimiento } from '../../../shared/mantenimiento/tipos';
import { FormPagoMantenimiento } from '../mantenimientos/FormPagoMantenimiento';
import type { Lista, ReciboFila } from './comun';

interface ListaProps { reciboId: string; q: string; elegido: Mantenimiento | null; onElegir: (m: Mantenimiento) => void }

/** Mantenimientos del periodo que aún se pueden pagar (se monta con el periodo ya elegido: así no se pide el periodo 0). */
function ListaPorPagar({ reciboId, q, elegido, onElegir }: ListaProps) {
  // Los vencidos son los que más se cobran: «por pagar» trae pendientes, parciales y vencidos del periodo.
  const lista = useList<Mantenimiento>(`/api/recibos/${reciboId}/mantenimientos`, { pageSize: 8, params: { estado: 'vencido,pendiente,parcial', q: q.trim() || undefined } });
  return (
    <section aria-label="Mantenimientos por pagar">
      {lista.error ? (
        <ErrorState message={lista.error} onRetry={lista.reload} />
      ) : lista.loading ? (
        <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
      ) : lista.items.length === 0 ? (
        <EmptyState title={q ? 'No hay mantenimientos por pagar para ese departamento' : 'No hay mantenimientos por pagar en este periodo'} description={q ? 'Revisa el código o prueba con otro periodo.' : 'Todo lo emitido ya se pagó o está en revisión.'} />
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded border border-line">
            {lista.items.map(m => (
              <li key={m.unidad_id}>
                <button
                  type="button"
                  aria-pressed={elegido?.unidad_id === m.unidad_id}
                  onClick={() => onElegir(m)}
                  className={`flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors duration-150 hover:bg-surface2 ${elegido?.unidad_id === m.unidad_id ? 'bg-brand-soft' : ''}`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium"><span className="num">{m.unidad.codigo}</span>{m.propietario ? ` · ${m.propietario.nombre}` : ''}</span>
                    <span className="block truncate text-xs text-muted">Vence {fechaCorta(m.fecha_vencimiento)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3"><StatusBadge estado={m.estado} /><span className="num text-sm font-semibold">{soles(m.saldo)}</span></span>
                </button>
              </li>
            ))}
          </ul>
          {lista.total > lista.items.length && <p className="mt-2 text-xs text-muted">Mostrando {lista.items.length} de {lista.total}. Escribe el código del departamento para acotar.</p>}
          {!elegido && <div className="mt-4"><Alert>Elige un departamento de la lista para registrar su pago.</Alert></div>}
        </>
      )}
    </section>
  );
}

/** Registrar el pago de un mantenimiento: elige el periodo, busca el departamento y registra cómo pagó (el monto es el saldo completo). */
export function RegistrarPagoModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const recibos = useResource<Lista<ReciboFila>>('/api/recibos?pageSize=24');
  const [reciboId, setReciboId] = useState('');
  const [q, setQ] = useState('');
  const [elegido, setElegido] = useState<Mantenimiento | null>(null);
  const periodoActual = reciboId || (recibos.data?.items[0] ? String(recibos.data.items[0].id) : '');
  const sinPeriodo = !recibos.loading && !recibos.error && (recibos.data?.items.length ?? 0) === 0;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Registrar pago"
      description="Elige el periodo, busca el departamento y registra cómo pagó el mantenimiento completo."
      footer={<Button variant="secondary" onClick={onClose}>Cerrar</Button>}
    >
      <div className="space-y-5">
        {recibos.error ? <ErrorState message={recibos.error} onRetry={recibos.reload} /> : sinPeriodo ? (
          <EmptyState title="Aún no hay periodos emitidos" description="Emite el mantenimiento del mes para poder registrar pagos." />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="Periodo" value={periodoActual} onChange={e => { setReciboId(e.target.value); setElegido(null); }} disabled={recibos.loading}>
                {(recibos.data?.items ?? []).map(r => <option key={r.id} value={r.id}>{periodo(r.mes, r.anio)} · {r.complejo?.nombre ?? 'Condominio'}</option>)}
              </Select>
              <Input label="Código de departamento" placeholder="Ej. A-101" autoComplete="off" value={q} onChange={e => { setQ(e.target.value); setElegido(null); }} />
            </div>
            {periodoActual && <ListaPorPagar key={periodoActual} reciboId={periodoActual} q={q} elegido={elegido} onElegir={setElegido} />}
            {elegido && (
              <section aria-label={`Registrar el pago de ${elegido.unidad.codigo}`} className="rounded border border-line p-4">
                <FormPagoMantenimiento key={`${elegido.recibo_id}-${elegido.unidad_id}`} reciboId={elegido.recibo_id} unidadId={elegido.unidad_id} saldo={elegido.saldo} onRegistrado={() => { onSaved(); onClose(); }} />
              </section>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
