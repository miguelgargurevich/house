import { useState } from 'react';
import { api, errorText } from '../../../../api';
import { Button, useToast } from '../../../../ui';
import { AvisoModulo } from '../../../shared/_parts/AvisoModulo';
import { ROTULO_WHATSAPP, TIPOS_WHATSAPP_CONFIGURABLES, WHATSAPP_POR_DEFECTO, type TipoWhatsapp } from '../../../../server/services/avisos/whatsappTipos';

interface Props {
  complejoId: number;
  /** Lista guardada (`whatsapp_avisos`). Sin ella se muestra la de por defecto. */
  lista?: string[];
  /** Si el plan del condominio trae «Avisos por WhatsApp». `false` = la sección lo dice y no deja cambiar nada. */
  planWhatsapp?: boolean;
  onGuardado: () => void;
}

/** Sección de la ficha: qué avisos automáticos salen también por WhatsApp (el correo no cambia). Quien la monta la vuelve a montar al cambiar la lista (`key`). */
export function AvisosWhatsapp({ complejoId, lista, planWhatsapp, onGuardado }: Props) {
  const toast = useToast();
  const [sel, setSel] = useState<TipoWhatsapp[]>(() => (lista ?? WHATSAPP_POR_DEFECTO).filter((t): t is TipoWhatsapp => (TIPOS_WHATSAPP_CONFIGURABLES as readonly string[]).includes(t)));
  const [busy, setBusy] = useState(false);
  const sinPlan = planWhatsapp === false;
  const guardada = lista ?? WHATSAPP_POR_DEFECTO;
  const cambio = sel.length !== guardada.length || sel.some((t) => !guardada.includes(t));

  async function guardar() {
    setBusy(true);
    try {
      await api(`/api/complejos/${complejoId}`, { method: 'PATCH', json: { whatsapp_avisos: TIPOS_WHATSAPP_CONFIGURABLES.filter((t) => sel.includes(t)) } });
      toast.ok('Avisos por WhatsApp guardados');
      onGuardado();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <section aria-labelledby="avisos-whatsapp" className="mt-6 space-y-4 border-t border-line pt-5">
      <div>
        <h3 id="avisos-whatsapp" className="text-sm font-semibold">Avisos por WhatsApp</h3>
        <p className="mt-1 text-sm text-muted">
          Elige qué avisos automáticos salen también por WhatsApp. El correo no cambia. Cada WhatsApp cuenta para la cuota mensual del plan y para el tope diario del número de WhatsApp de tu administración.
        </p>
      </div>
      {sinPlan && <AvisoModulo modulo="whatsapp_avisos" />}
      <fieldset disabled={sinPlan} className="space-y-4">
        <legend className="sr-only">Avisos que salen por WhatsApp</legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {TIPOS_WHATSAPP_CONFIGURABLES.map((t) => (
            <li key={t}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-line px-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-brand"
                  checked={sel.includes(t)}
                  onChange={() => setSel((x) => (x.includes(t) ? x.filter((c) => c !== t) : [...x, t]))}
                />
                {ROTULO_WHATSAPP[t]}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex justify-end">
          <Button onClick={guardar} loading={busy} disabled={!cambio || busy}>Guardar avisos por WhatsApp</Button>
        </div>
      </fieldset>
    </section>
  );
}
