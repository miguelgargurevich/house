import { useMemo, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Bloqueable } from '../../../../app/Bloqueable';
import { Alert, Button, Input, Modal, Textarea, dinero, useToast } from '../../../../ui';
import { MOTIVO_CORREGIR_MAX, cambiosDe, errorMonto, errorMotivo, pagadoVigente, sePuedeQuitar, type CargoCorregible } from './correccion';

interface Props {
  codigo: string;
  moneda: string;
  cargos: CargoCorregible[];
  onClose: () => void;
  /** Algo se guardó (aunque no todo): la pantalla vuelve a leer el recibo del departamento. */
  onCorregido: () => void;
}

/**
 * «Corregir» el recibo de un departamento: el monto nuevo de cada concepto, o «Quitar este cargo». Un motivo para todo (queda en la auditoría con el monto
 * anterior y el nuevo). Un monto no puede bajar de lo ya pagado, y un cargo con pagos no se quita: el servidor lo vuelve a comprobar. No avisa al vecino.
 */
export function CorregirCargosModal({ codigo, moneda, cargos, onClose, onCorregido }: Props) {
  const toast = useToast();
  const [montos, setMontos] = useState<Record<number, string>>(() => Object.fromEntries(cargos.map(c => [c.cargo_id, Number(c.monto).toFixed(2)])));
  const [quitar, setQuitar] = useState<ReadonlySet<number>>(new Set());
  const [motivo, setMotivo] = useState('');
  const [verErrores, setVerErrores] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formato = (n: number) => dinero(n.toFixed(2), moneda);
  const cambios = useMemo(() => cambiosDe(cargos, montos, quitar), [cargos, montos, quitar]);
  const errMotivo = errorMotivo(motivo, MOTIVO_CORREGIR_MAX);
  const errMonto = (c: CargoCorregible) => (quitar.has(c.cargo_id) ? undefined : errorMonto(montos[c.cargo_id] ?? c.monto, c, formato));
  const hayError = cargos.some(c => errMonto(c)) || errMotivo !== undefined;

  function alternarQuitar(id: number) {
    setQuitar(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  }

  async function guardar() {
    setVerErrores(true);
    if (hayError || cambios.length === 0) return;
    setEnviando(true);
    setError(null);
    let hechos = 0;
    try {
      for (const c of cambios) {
        try {
          if (c.accion === 'quitar') await api(`/api/recibo-concepto-unidades/${c.cargo_id}/quitar`, { method: 'POST', json: { motivo: motivo.trim() } });
          else await api(`/api/recibo-concepto-unidades/${c.cargo_id}/corregir`, { method: 'POST', json: { monto: c.monto, motivo: motivo.trim() } });
          hechos++;
        } catch (e) {
          // Cada cambio es una operación aparte: si uno falla, los anteriores ya quedaron guardados y se dice cuál no.
          setError(`${c.concepto}: ${errorText(e)}${hechos > 0 ? ` (los ${hechos} cambios anteriores sí se guardaron)` : ''}`);
          return;
        }
      }
      toast.ok(hechos === 1 ? 'Cargo corregido.' : `${hechos} cargos corregidos.`);
      onClose();
    } finally {
      setEnviando(false);
      if (hechos > 0) onCorregido();
    }
  }

  return (
    <Modal
      open
      onClose={() => { if (!enviando) onClose(); }}
      size="lg"
      title="Corregir cargos"
      description={`Departamento ${codigo}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={enviando}>Cancelar</Button>
          <Bloqueable>{b => <Button loading={enviando} disabled={b || cambios.length === 0} onClick={() => void guardar()}>{cambios.length > 1 ? `Guardar ${cambios.length} cambios` : 'Guardar cambio'}</Button>}</Bloqueable>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">Cambia el monto de un concepto o quita el cargo. El vecino no recibe aviso: es una corrección. Un monto no puede quedar por debajo de lo ya pagado.</p>
        <ul className="divide-y divide-line rounded border border-line">
          {cargos.map(c => {
            const marcado = quitar.has(c.cargo_id);
            const puedeQuitar = sePuedeQuitar(c);
            const e = verErrores ? errMonto(c) : undefined;
            return (
              <li key={c.cargo_id} className="space-y-2 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-ink">{c.concepto}</p>
                    <p className="text-sm text-muted">Hoy: <span className="num">{dinero(c.monto)}</span>{pagadoVigente(c) > 0 && <> · pagado o en revisión: <span className="num">{formato(pagadoVigente(c))}</span></>}</p>
                  </div>
                  <Input
                    label={`Monto nuevo de ${c.concepto}`}
                    ocultarEtiqueta
                    className="w-32"
                    inputMode="decimal"
                    value={montos[c.cargo_id] ?? ''}
                    disabled={marcado}
                    error={e}
                    onChange={ev => setMontos(m => ({ ...m, [c.cargo_id]: ev.target.value }))}
                  />
                </div>
                <label className={`flex items-start gap-2 text-sm ${puedeQuitar ? '' : 'text-muted'}`}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[oklch(var(--brand))]" checked={marcado} disabled={!puedeQuitar} onChange={() => alternarQuitar(c.cargo_id)} />
                  <span>
                    Quitar este cargo
                    {!puedeQuitar && <span className="block">Tiene pagos: anúlalos o recházalos antes de quitarlo.</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <Textarea
          label="Motivo"
          hint={`Queda registrado en la auditoría con tu nombre, el monto anterior y el nuevo (de 5 a ${MOTIVO_CORREGIR_MAX} caracteres).`}
          error={verErrores ? errMotivo : undefined}
          value={motivo}
          maxLength={MOTIVO_CORREGIR_MAX}
          onChange={e => setMotivo(e.target.value)}
        />
        {error && <Alert tone="bad">{error}</Alert>}
      </div>
    </Modal>
  );
}
