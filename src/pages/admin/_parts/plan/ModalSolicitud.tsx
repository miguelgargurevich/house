import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Button, Modal, soles, useToast } from '../../../../ui';
import type { VistaSuscripcion } from '../../../shared/_parts/comercial';

interface Catalogo { planes: { clave: string; nombre: string; descripcion: string | null; precio_por_unidad: string; unidades_minimas: number | null; total_minimo_mes: string | null }[] }
interface Total { unidades_cobradas: number; minimo_aplicado: boolean; total_mes: string; total_anio: string }

/** «Pasar a Pro»: pide un plan (los módulos ya no se piden sueltos: Pro los trae todos); no activa nada. El monto estimado lo calcula el servidor. */
export function ModalSolicitud({ condominio, catalogo, onClose, onHecho }: { condominio: VistaSuscripcion | null; catalogo: Catalogo; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<Total | null>(null);

  useEffect(() => { if (condominio) { setPlan(null); setError(null); setTotal(null); } }, [condominio]);

  const pedibles = catalogo.planes.filter(p => p.clave !== 'gratis' && p.clave !== 'cortesia');
  const n = condominio?.unidades_facturables ?? 0;

  // Estimado con el plan elegido (con el mínimo de departamentos si corresponde): el mismo cálculo del servidor que usa la página de precios.
  useEffect(() => {
    if (!condominio || !plan) { setTotal(null); return; }
    let vivo = true;
    const sp = new URLSearchParams({ unidades: String(Math.max(1, n)), plan });
    api<Total>(`/api/publico/cotizar?${sp}`).then(t => { if (vivo) setTotal(t); }).catch(() => { if (vivo) setTotal(null); });
    return () => { vivo = false; };
  }, [condominio, plan, n]);

  async function enviar() {
    if (!condominio || !plan) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/comercial/mi-plan/${condominio.complejo_id}/solicitud`, { method: 'POST', json: { plan } });
      toast.ok('Solicitud enviada. Te mostramos cómo pagar.');
      onHecho();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <Modal
      open={!!condominio}
      onClose={onClose}
      title={condominio ? `Pasar a un plan de pago: ${condominio.complejo}` : ''}
      description="Elige el plan. No se activa nada hasta que registremos tu pago."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={!plan} onClick={() => void enviar()}>Enviar solicitud</Button></>}
    >
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <fieldset>
          <legend className="text-sm font-medium">Plan</legend>
          <div className="mt-2 space-y-2">
            {pedibles.map(p => (
              <label key={p.clave} className="flex cursor-pointer items-start justify-between gap-3 rounded border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <span className="flex items-start gap-2">
                  <input type="radio" name="plan" className="mt-0.5 h-4 w-4 accent-[oklch(var(--brand))]" checked={plan === p.clave} onChange={() => setPlan(p.clave)} />
                  <span><span className="block font-medium">{p.nombre}</span>{p.descripcion && <span className="block text-xs text-muted">{p.descripcion}</span>}</span>
                </span>
                <span className="num shrink-0 text-right text-xs text-muted">{soles(p.precio_por_unidad)} por depto al mes{p.unidades_minimas != null && <span className="block">mínimo {p.unidades_minimas} departamentos</span>}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {total && (
          <p className="rounded bg-surface2 px-3 py-2 text-sm" role="status">
            Costo estimado: <span className="num font-semibold">{soles(total.total_mes)}</span> al mes (IGV incluido) · <span className="num">{soles(total.total_anio)}</span> al año.
            {total.minimo_aplicado && ` Tu condominio tiene ${n} ${n === 1 ? 'departamento' : 'departamentos'}, pero el plan cobra un mínimo de ${total.unidades_cobradas}.`}
          </p>
        )}
      </div>
    </Modal>
  );
}
