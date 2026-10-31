import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Badge, Button, Input, Modal, StatusBadge, dinero, fechaCorta, useToast } from '../../../../ui';
import { ESTADO_UI, type Cuenta, type Movimiento, type PagoResumen } from './tipos';

interface Props { cuenta: Cuenta; movimiento: Movimiento | null; onClose: () => void; onChanged: () => void }

const METODOS: Record<string, string> = { transferencia: 'Transferencia', yape: 'Yape', plin: 'Plin', efectivo: 'Efectivo', tarjeta: 'Tarjeta' };

/** Un pago como opción: unidad, total, fecha, método y referencia; avisa si el monto no coincide con el del abono. */
function PagoLinea({ pago, moneda, monto, accion }: { pago: PagoResumen; moneda: string; monto?: string; accion?: React.ReactNode }) {
  const difiere = monto != null && Number(pago.total) !== Number(monto);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded border border-line p-3">
      <div className="min-w-0 text-sm">
        <p className="font-medium"><span className="num">{pago.unidad?.codigo ?? '—'}</span>{pago.unidad?.estructura ? ` · ${pago.unidad.estructura}` : ''} <span className="num ml-1">{dinero(pago.total, moneda)}</span></p>
        <p className="text-xs text-muted">{fechaCorta(pago.fecha_pago)} · {METODOS[pago.metodo_pago ?? ''] ?? pago.metodo_pago ?? '—'}{pago.referencia ? ` · ${pago.referencia}` : ''}{pago.pagador ? ` · ${pago.pagador}` : ''}</p>
        <p className="mt-1 flex flex-wrap gap-1"><StatusBadge estado={pago.estado_validacion} />{difiere && <Badge tone="warn">El monto difiere</Badge>}</p>
      </div>
      {accion}
    </li>
  );
}

/**
 * Un abono del banco: lo conciliado se desvincula; lo que está por revisar o sin voucher se vincula a mano con un pago sugerido o buscado, o se ignora con un
 * motivo (intereses, transferencia interna…); lo ignorado se vuelve a abrir. Cada acción refresca la lista.
 */
export function MovimientoModal({ cuenta, movimiento, onClose, onChanged }: Props) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [opciones, setOpciones] = useState<PagoResumen[]>([]);
  const [cargando, setCargando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const abierto = movimiento !== null;
  const base = movimiento ? `/api/conciliacion/cuentas/${cuenta.id}/movimientos/${movimiento.id}` : null;
  const pendiente = movimiento?.estado === 'por_revisar' || movimiento?.estado === 'sin_pago';

  useEffect(() => { setQ(''); setMotivo(''); setError(null); setOpciones([]); }, [movimiento?.id]);
  useEffect(() => {
    if (!base || !pendiente) return;
    let vigente = true;
    setCargando(true);
    const t = setTimeout(() => {
      api<{ items: PagoResumen[] }>(`${base}/pagos${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`)
        .then(r => { if (vigente) setOpciones(r.items); })
        .catch(e => { if (vigente) setError(errorText(e)); })
        .finally(() => { if (vigente) setCargando(false); });
    }, q ? 300 : 0);
    return () => { vigente = false; clearTimeout(t); };
  }, [base, pendiente, q]);

  async function ejecutar(accion: 'vincular' | 'desvincular' | 'ignorar', cuerpo?: unknown, mensaje?: string) {
    if (!base) return;
    setTrabajando(true);
    setError(null);
    try {
      await api(`${base}/${accion}`, { method: 'POST', json: cuerpo });
      toast.ok(mensaje ?? 'Listo');
      onChanged();
      onClose();
    } catch (e) { setError(errorText(e)); }
    finally { setTrabajando(false); }
  }

  const sugeridos = movimiento?.sugerencias ?? [];
  const resto = opciones.filter(o => !sugeridos.some(s => s.id === o.id));
  const moneda = cuenta.moneda;

  return (
    <Modal open={abierto} onClose={onClose} title={movimiento ? `Abono de ${dinero(movimiento.monto, moneda)}` : ''} description={movimiento ? `${fechaCorta(movimiento.fecha)}${movimiento.numero_operacion ? ` · operación ${movimiento.numero_operacion}` : ''}` : undefined} size="lg">
      {movimiento && (
        <div className="space-y-5">
          <div className="rounded bg-surface2 p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 break-words text-sm">{movimiento.descripcion || 'Sin descripción'}</p>
              <Badge tone={ESTADO_UI[movimiento.estado].tone}>{ESTADO_UI[movimiento.estado].label}</Badge>
            </div>
          </div>
          {error && <Alert tone="bad">{error}</Alert>}

          {movimiento.estado === 'conciliado' && movimiento.pago && (
            <section aria-label="Pago vinculado" className="space-y-3">
              <p className="text-sm">Conciliado {movimiento.vinculo === 'manual' ? `a mano${movimiento.vinculado_por ? ` por ${movimiento.vinculado_por}` : ''}` : 'automáticamente'}{movimiento.vinculado_at ? ` el ${fechaCorta(movimiento.vinculado_at)}` : ''} con este pago:</p>
              <ul><PagoLinea pago={movimiento.pago} moneda={moneda} monto={movimiento.monto} /></ul>
              <div className="flex justify-end"><Button variant="secondary" loading={trabajando} onClick={() => void ejecutar('desvincular', undefined, 'Abono desvinculado')}>Desvincular</Button></div>
            </section>
          )}

          {movimiento.estado === 'ignorado' && (
            <section aria-label="Abono ignorado" className="space-y-3">
              <p className="text-sm">Ignorado{movimiento.motivo_ignorar ? `: ${movimiento.motivo_ignorar}` : ''}. No cuenta como «abono sin voucher».</p>
              <div className="flex justify-end"><Button variant="secondary" loading={trabajando} onClick={() => void ejecutar('desvincular', undefined, 'Abono reabierto')}>Quitar «ignorar»</Button></div>
            </section>
          )}

          {pendiente && (
            <>
              <section aria-label="Vincular con un pago" className="space-y-3">
                <h3 className="text-sm font-semibold">{sugeridos.length ? 'Pagos sugeridos' : 'Vincular con un pago'}</h3>
                {sugeridos.length > 0 && (
                  <ul className="space-y-2">{sugeridos.map(p => <PagoLinea key={p.id} pago={p} moneda={moneda} monto={movimiento.monto} accion={<Button size="sm" loading={trabajando} onClick={() => void ejecutar('vincular', { pago_id: p.id }, 'Abono vinculado al pago')}>Vincular</Button>} />)}</ul>
                )}
                <Input label="Buscar otro pago" placeholder="Departamento o n.º de operación" value={q} onChange={e => setQ(e.target.value)} hint="Se muestran los pagos del condominio (o del block de la cuenta) que aún no tienen abono; los de monto igual, primero." />
                {cargando && <p className="text-sm text-muted" role="status">Buscando…</p>}
                {!cargando && resto.length === 0 && sugeridos.length === 0 && <p className="text-sm text-muted">No hay pagos libres que mostrar. Si el vecino aún no subió su voucher, el abono queda como «abono sin voucher».</p>}
                {resto.length > 0 && <ul className="max-h-72 space-y-2 overflow-y-auto">{resto.map(p => <PagoLinea key={p.id} pago={p} moneda={moneda} monto={movimiento.monto} accion={<Button size="sm" variant="secondary" loading={trabajando} onClick={() => void ejecutar('vincular', { pago_id: p.id }, 'Abono vinculado al pago')}>Vincular</Button>} />)}</ul>}
              </section>

              <section aria-label="Ignorar el abono" className="space-y-2 border-t border-line pt-4">
                <h3 className="text-sm font-semibold">¿No es un pago de vecino?</h3>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="min-w-0 flex-1"><Input label="Motivo para ignorarlo" placeholder="Intereses, transferencia interna…" maxLength={200} value={motivo} onChange={e => setMotivo(e.target.value)} /></div>
                  <Button variant="secondary" disabled={!motivo.trim()} loading={trabajando} onClick={() => void ejecutar('ignorar', { motivo: motivo.trim() }, 'Abono ignorado')}>Ignorar</Button>
                </div>
              </section>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
