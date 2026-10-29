import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Button, Input, Modal, Select, dinero, useToast } from '../../../../ui';
import { decimalesDe, simboloDe } from '../../../../lib/paises';
import { MEDIOS, nombreDePlan, type VistaSuscripcion } from '../../../shared/_parts/comercial';

const hoy = () => new Date().toISOString().slice(0, 10);
/** Suma un mes calendario a una fecha `AAAA-MM-DD` (sin zonas horarias: es una fecha de calendario). */
const masUnMes = (iso: string): string => {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(Date.UTC(a, m, d)); // mes siguiente, mismo día
  if (f.getUTCDate() !== d) f.setUTCDate(0); // 31 ene + 1 mes → fin de febrero
  return f.toISOString().slice(0, 10);
};
const diaSiguiente = (iso: string): string => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Registrar un pago manual (transferencia, Yape…): extiende la vigencia hasta el final del periodo cubierto y activa lo solicitado. */
export function ModalPago({ sus, onClose, onHecho }: { sus: VistaSuscripcion | null; onClose: () => void; onHecho: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ monto: '', fecha_pago: hoy(), medio: 'transferencia', operacion: '', periodo_desde: hoy(), periodo_hasta: masUnMes(hoy()), voucher_ref: '', notas: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sus) return;
    // Lo que se pidió (si hay solicitud) o lo contratado; el periodo arranca el día siguiente al vencimiento si aún está vigente.
    const vigente = sus.vigente_hasta ? sus.vigente_hasta.slice(0, 10) : null;
    const desde = vigente && vigente >= hoy() ? diaSiguiente(vigente) : hoy();
    setF({ monto: (sus.solicitud?.cotizacion ?? sus.cotizacion).total_mes, fecha_pago: hoy(), medio: 'transferencia', operacion: '', periodo_desde: desde, periodo_hasta: masUnMes(desde), voucher_ref: '', notas: '' });
    setError(null);
  }, [sus]);

  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value })) });

  async function guardar() {
    if (!sus) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/comercial/suscripciones/${sus.complejo_id}/pagos`, { method: 'POST', json: { ...f, operacion: f.operacion.trim() || null, voucher_ref: f.voucher_ref.trim() || null, notas: f.notas.trim() || null } });
      toast.ok('Pago registrado: la vigencia se extendió');
      onHecho();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  const cot = sus ? (sus.solicitud?.cotizacion ?? sus.cotizacion) : null;
  return (
    <Modal
      open={!!sus}
      onClose={onClose}
      title={sus ? `Registrar pago · ${sus.complejo}` : ''}
      description={sus ? `${sus.empresa?.nombre ?? 'Sin empresa'} · referencia sugerida ${sus.referencia_pago}` : undefined}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={busy} disabled={!f.monto || !f.periodo_desde || !f.periodo_hasta} onClick={() => void guardar()}>Registrar pago</Button></>}
    >
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        {sus?.solicitud && <Alert tone="info">El cliente pidió {sus.solicitud.plan ? `el plan ${nombreDePlan(sus.solicitud.plan)}` : 'módulos'}: el pago lo activa.</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={`Monto pagado (${simboloDe(sus?.moneda)}, con ${sus?.impuesto.nombre ?? 'impuesto'})`} inputMode={decimalesDe(sus?.moneda) === 0 ? 'numeric' : 'decimal'} required hint={cot && !(sus?.solicitud ? sus.solicitud.consultar : sus?.precio_consultar) ? `Esperado: ${dinero(cot.total_mes, sus?.moneda)} (${dinero(cot.base, sus?.moneda)} + ${sus?.impuesto.nombre} ${dinero(cot.igv, sus?.moneda)})` : sus?.precio_consultar ? 'Este plan no tiene precio en la moneda del país: escribe el monto acordado.' : undefined} {...campo('monto')} />
          <Input label="Fecha del pago" type="date" required {...campo('fecha_pago')} />
          <Select label="Medio" {...campo('medio')}>{MEDIOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          <Input label="N.º de operación" maxLength={80} hint="Evita registrar dos veces el mismo pago" {...campo('operacion')} />
          <Input label="Periodo cubierto desde" type="date" required {...campo('periodo_desde')} />
          <Input label="Periodo cubierto hasta" type="date" required {...campo('periodo_hasta')} />
        </div>
        <Input label="Referencia del voucher (opcional)" maxLength={200} {...campo('voucher_ref')} />
        <Input label="Notas (opcional)" maxLength={500} {...campo('notas')} />
      </div>
    </Modal>
  );
}
