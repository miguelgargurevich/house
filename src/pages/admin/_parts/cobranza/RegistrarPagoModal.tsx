import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorText, useList } from '../../../../api';
import { Alert, Button, EmptyState, ErrorState, Input, Modal, Select, Skeleton, StatusBadge, fechaCorta, periodo, soles, useToast } from '../../../../ui';
import { METODOS } from './comun';

export interface CargoPendiente {
  id: number;
  monto: number | string;
  estado: string;
  unidad?: { id: number; codigo: string } | null;
  concepto?: { nombre: string } | null;
  recibo?: { id: number; mes: number; anio: number; fecha_vencimiento: string } | null;
}

interface Form { monto: string; metodo_pago: string; referencia: string }

export function RegistrarPagoModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  // «pendiente» sólo trae los que aún no vencen; los vencidos son los que más se cobran, así que se piden aparte.
  const pendientes = useList<CargoPendiente>('/api/recibo-concepto-unidades', { pageSize: 10, params: { estado: 'pendiente' } });
  const vencidos = useList<CargoPendiente>('/api/recibo-concepto-unidades', { pageSize: 10, params: { estado: 'vencido' } });
  const [q, setQ] = useState('');
  const [cargo, setCargo] = useState<CargoPendiente | null>(null);
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Form>({
    defaultValues: { monto: '', metodo_pago: 'transferencia', referencia: '' },
  });

  const cargando = pendientes.loading || vencidos.loading;
  const error = pendientes.error ?? vencidos.error;
  const candidatos = [...vencidos.items, ...pendientes.items];
  const total = pendientes.total + vencidos.total;

  function buscar(v: string) { setQ(v); pendientes.setQ(v); vencidos.setQ(v); }
  function elegir(c: CargoPendiente) { setCargo(c); setValue('monto', String(Number(c.monto))); }

  async function registrar(v: Form) {
    if (!cargo) return;
    try {
      await api('/api/pagos', {
        method: 'POST',
        json: { recibo_concepto_unidad_id: cargo.id, monto: Number(v.monto), metodo_pago: v.metodo_pago, referencia: v.referencia.trim() || undefined },
      });
      toast.ok('Pago registrado');
      onSaved();
      onClose();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Registrar pago"
      description="Busca el cargo por el código de la unidad y registra cómo pagó."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button loading={isSubmitting} disabled={!cargo} onClick={handleSubmit(registrar)}>Registrar pago</Button>
        </>
      }
    >
      <div className="space-y-5">
        <Input label="Código de unidad" placeholder="Ej. A-101" autoComplete="off" value={q} onChange={e => buscar(e.target.value)} />

        <section aria-label="Cargos pendientes">
          {error ? (
            <ErrorState message={error} onRetry={() => { void pendientes.reload(); void vencidos.reload(); }} />
          ) : cargando ? (
            <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
          ) : candidatos.length === 0 ? (
            <EmptyState
              title={q ? 'No hay cargos pendientes para esa unidad' : 'No hay cargos pendientes'}
              description={q ? 'Revisa el código o prueba con otra unidad.' : 'Cuando emitas un recibo, sus cargos aparecerán aquí para cobrarlos.'}
            />
          ) : (
            <>
              <ul className="divide-y divide-line overflow-hidden rounded border border-line">
                {candidatos.map(c => (
                  <li key={c.id}>
                    <button
                      type="button"
                      aria-pressed={cargo?.id === c.id}
                      onClick={() => elegir(c)}
                      className={`flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors duration-150 hover:bg-surface2 ${cargo?.id === c.id ? 'bg-brand-soft' : ''}`}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{c.unidad?.codigo ?? '—'} · {c.concepto?.nombre ?? 'Cargo'}</span>
                        <span className="block truncate text-xs text-muted">
                          {c.recibo ? `${periodo(c.recibo.mes, c.recibo.anio)} · vence ${fechaCorta(c.recibo.fecha_vencimiento)}` : '—'}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <StatusBadge estado={c.estado} />
                        <span className="num text-sm font-semibold">{soles(c.monto)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {total > candidatos.length && <p className="mt-2 text-xs text-muted">Mostrando {candidatos.length} de {total}. Escribe el código de la unidad para acotar.</p>}
            </>
          )}
        </section>

        {cargo ? (
          <form onSubmit={handleSubmit(registrar)} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Input
              label="Monto (S/)"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              hint={`Monto del cargo: ${soles(cargo.monto)}`}
              error={errors.monto && `Ingresa un monto mayor a 0 y hasta ${soles(cargo.monto)}`}
              {...register('monto', { required: true, validate: v => Number(v) > 0 && Number(v) <= Number(cargo.monto) + 0.001 })}
            />
            <Select label="Método de pago" {...register('metodo_pago', { required: true })}>
              {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
            <Input label="Referencia (opcional)" className="sm:col-span-2" placeholder="N.º de operación o comprobante" {...register('referencia')} />
          </form>
        ) : (
          !cargando && !error && candidatos.length > 0 && <Alert>Elige un cargo de la lista para registrar su pago.</Alert>
        )}
      </div>
    </Modal>
  );
}
