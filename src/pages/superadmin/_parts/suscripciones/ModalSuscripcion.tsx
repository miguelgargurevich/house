import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Button, Input, Modal, Select, Textarea, useToast } from '../../../../ui';
import { MODULO_NOMBRE, aFechaInput, type ModuloClave, type VistaSuscripcion } from '../../../shared/_parts/comercial';

/** Cambiar plan, módulos sueltos, vigencia y notas de un condominio (queda auditado). */
export function ModalSuscripcion({ sus, planes, onClose, onHecho }: { sus: VistaSuscripcion | null; planes: { clave: string; nombre: string }[]; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [plan, setPlan] = useState('gratis');
  const [modulos, setModulos] = useState<string[]>([]);
  const [vigente, setVigente] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sus) return;
    setPlan(sus.plan.clave); setModulos(sus.modulos_sueltos); setVigente(aFechaInput(sus.vigente_hasta)); setNotas(sus.notas ?? ''); setError(null);
  }, [sus]);

  async function guardar() {
    if (!sus) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/comercial/suscripciones/${sus.complejo_id}`, { method: 'PATCH', json: { plan_clave: plan, modulos, vigente_hasta: vigente || null, notas: notas.trim() || null } });
      toast.ok('Suscripción actualizada');
      onHecho();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <Modal
      open={!!sus}
      onClose={onClose}
      title={sus ? `Plan y módulos · ${sus.complejo}` : ''}
      description="Cambiar el plan o los módulos resuelve la solicitud pendiente. Sin fecha de vigencia, no vence."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} onClick={() => void guardar()}>Guardar</Button></>}
    >
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <Select label="Plan" value={plan} onChange={e => setPlan(e.target.value)}>{planes.map(p => <option key={p.clave} value={p.clave}>{p.nombre}</option>)}</Select>
        <fieldset>
          <legend className="text-sm font-medium">Módulos sueltos (además de los del plan)</legend>
          <div className="mt-2 space-y-2">
            {(Object.keys(MODULO_NOMBRE) as ModuloClave[]).map(m => (
              <label key={m} className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-[oklch(var(--brand))]" checked={modulos.includes(m)} onChange={() => setModulos(x => (x.includes(m) ? x.filter(c => c !== m) : [...x, m]))} />
                {MODULO_NOMBRE[m]}
              </label>
            ))}
          </div>
        </fieldset>
        <Input label="Vigente hasta" type="date" value={vigente} onChange={e => setVigente(e.target.value)} hint="Déjalo vacío para que no venza (cortesía)." />
        <Textarea label="Notas" maxLength={1000} value={notas} onChange={e => setNotas(e.target.value)} />
      </div>
    </Modal>
  );
}
