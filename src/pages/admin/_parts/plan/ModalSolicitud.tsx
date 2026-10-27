import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Button, Modal, soles, useToast } from '../../../../ui';
import { MODULO_NOMBRE, type ModuloClave, type VistaSuscripcion } from '../../../shared/_parts/comercial';

interface Catalogo { planes: { clave: string; nombre: string; precio_por_unidad: string }[]; modulos: { clave: string; nombre: string; descripcion: string | null; precio_por_unidad: string }[] }
interface Total { total_mes: string; total_anio: string }

/** «Solicitar módulo / Pasar a Pro»: pide, no activa. El monto estimado lo calcula el servidor. */
export function ModalSolicitud({ condominio, catalogo, onClose, onHecho }: { condominio: VistaSuscripcion | null; catalogo: Catalogo; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState<string | null>(null);
  const [modulos, setModulos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState<Total | null>(null);

  useEffect(() => { if (condominio) { setPlan(null); setModulos([]); setError(null); setTotal(null); } }, [condominio]);

  const pedibles = catalogo.planes.filter(p => p.clave !== 'gratis' && p.clave !== 'cortesia');
  const propios = condominio?.modulos_activos ?? [];
  const disponibles = catalogo.modulos.filter(m => !propios.includes(m.clave));
  const n = condominio?.unidades_facturables ?? 0;

  // Estimado con lo que pediría (lo ya activo no se vuelve a cobrar): el mismo cálculo del servidor que usa la página de precios.
  useEffect(() => {
    if (!condominio || n < 1 || (!plan && !modulos.length)) { setTotal(null); return; }
    let vivo = true;
    const sp = new URLSearchParams({ unidades: String(n) });
    if (plan) sp.set('plan', plan);
    if (modulos.length) sp.set('modulos', modulos.join(','));
    api<Total>(`/api/publico/cotizar?${sp}`).then(t => { if (vivo) setTotal(t); }).catch(() => { if (vivo) setTotal(null); });
    return () => { vivo = false; };
  }, [condominio, plan, modulos, n]);

  async function enviar() {
    if (!condominio) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/comercial/mi-plan/${condominio.complejo_id}/solicitud`, { method: 'POST', json: { plan, modulos } });
      toast.ok('Solicitud enviada. Te mostramos cómo pagar.');
      onHecho();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <Modal
      open={!!condominio}
      onClose={onClose}
      title={condominio ? `Solicitar para ${condominio.complejo}` : ''}
      description="Elige un plan o los módulos que necesitas. No se activa nada hasta que registremos tu pago."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={!plan && !modulos.length} onClick={() => void enviar()}>Enviar solicitud</Button></>}
    >
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <fieldset>
          <legend className="text-sm font-medium">Pasar a un plan</legend>
          <div className="mt-2 space-y-2">
            {pedibles.map(p => (
              <label key={p.clave} className="flex cursor-pointer items-center justify-between gap-3 rounded border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <span className="flex items-center gap-2">
                  <input type="radio" name="plan" className="h-4 w-4 accent-[oklch(var(--brand))]" checked={plan === p.clave} onChange={() => setPlan(p.clave)} onClick={() => plan === p.clave && setPlan(null)} />
                  <span className="font-medium">{p.nombre}</span>
                </span>
                <span className="num text-xs text-muted">{soles(p.precio_por_unidad)} por depto al mes</span>
              </label>
            ))}
          </div>
        </fieldset>
        {!plan && disponibles.length > 0 && (
          <fieldset>
            <legend className="text-sm font-medium">…o sólo los módulos que necesitas</legend>
            <div className="mt-2 space-y-2">
              {disponibles.map(m => (
                <label key={m.clave} className="flex cursor-pointer items-start justify-between gap-3 rounded border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                  <span className="flex items-start gap-2">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[oklch(var(--brand))]" checked={modulos.includes(m.clave)} onChange={() => setModulos(x => (x.includes(m.clave) ? x.filter(c => c !== m.clave) : [...x, m.clave]))} />
                    <span><span className="block font-medium">{MODULO_NOMBRE[m.clave as ModuloClave] ?? m.nombre}</span>{m.descripcion && <span className="block text-xs text-muted">{m.descripcion}</span>}</span>
                  </span>
                  <span className="num shrink-0 text-xs text-muted">{soles(m.precio_por_unidad)} /depto</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {total && (
          <p className="rounded bg-surface2 px-3 py-2 text-sm" role="status">
            Costo estimado: <span className="num font-semibold">{soles(total.total_mes)}</span> al mes por {n} departamentos (IGV incluido) · <span className="num">{soles(total.total_anio)}</span> al año.
          </p>
        )}
      </div>
    </Modal>
  );
}
