import { useEffect, useMemo, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Badge, Button, Card, CardBody, CardHeader, Input, Select, dinero, useToast } from '../../../../ui';
import { MONEDAS, decimalesDe, monedaDe, paisDe } from '../../../../lib/paises';

export interface ImpuestoPais { pais: string; nombre: string; tasa: string; moneda: string; activo: boolean }
export interface PrecioMoneda { plan_clave: string; moneda: string; precio_por_unidad: string }
interface PlanPrecio { clave: string; nombre: string; precio_por_unidad: string }

/** La API guarda la tasa en fracción (0.19); aquí se edita en porcentaje (19). Se redondea a 2 decimales para no arrastrar 7.000000000000001. */
const aPorcentaje = (tasa: string): string => String(Number((Number(tasa) * 100).toFixed(2)));
const aFraccion = (pct: string): string => (Number(pct.replace(',', '.')) / 100).toFixed(4);
const porcentajeValido = (pct: string): boolean => { const n = Number(pct.replace(',', '.')); return pct.trim() !== '' && Number.isFinite(n) && n >= 0 && n <= 100; };

function FilaImpuesto({ f, onGuardado }: { f: ImpuestoPais; onGuardado: () => void }) {
  const toast = useToast();
  const p = paisDe(f.pais);
  const [nombre, setNombre] = useState(f.nombre);
  const [pct, setPct] = useState(aPorcentaje(f.tasa));
  const [moneda, setMoneda] = useState(f.moneda);
  const [activo, setActivo] = useState(f.activo);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setNombre(f.nombre); setPct(aPorcentaje(f.tasa)); setMoneda(f.moneda); setActivo(f.activo); }, [f]);
  const cambio = nombre !== f.nombre || pct !== aPorcentaje(f.tasa) || moneda !== f.moneda || activo !== f.activo;
  async function guardar() {
    setBusy(true);
    try {
      await api(`/api/comercial/impuestos/${f.pais}`, { method: 'PUT', json: { nombre: nombre.trim(), tasa: aFraccion(pct), moneda, activo } });
      toast.ok(`${p?.nombre ?? f.pais}: impuesto y moneda actualizados`);
      onGuardado();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }
  return (
    <li className="flex flex-wrap items-end gap-3 py-3">
      <div className="min-w-[10rem] flex-1">
        <p className="text-sm font-medium"><span aria-hidden="true">{p?.bandera} </span>{p?.nombre ?? f.pais}</p>
        <p className="text-xs text-muted">{activo ? 'Abierto: se ofrece en /precios y se puede contratar' : <Badge tone="neutral">Cerrado: no se ofrece ni se contrata</Badge>}</p>
      </div>
      <Input label="Impuesto" maxLength={20} value={nombre} onChange={e => setNombre(e.target.value)} className="w-28" />
      <Input label="Tasa (%)" inputMode="decimal" value={pct} onChange={e => setPct(e.target.value)} error={porcentajeValido(pct) ? undefined : 'Entre 0 y 100'} className="w-24" />
      <Select label="Moneda de cobro" value={moneda} onChange={e => setMoneda(e.target.value)} className="w-52">
        {MONEDAS.map(m => <option key={m.codigo} value={m.codigo}>{m.codigo} · {m.nombre}</option>)}
      </Select>
      <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[oklch(var(--brand))]" checked={activo} onChange={e => setActivo(e.target.checked)} />Abierto</label>
      <Button size="sm" loading={busy} disabled={!cambio || !nombre.trim() || !porcentajeValido(pct)} onClick={() => void guardar()} aria-label={`Guardar ${p?.nombre ?? f.pais}`}>Guardar</Button>
    </li>
  );
}

function FilaPrecio({ plan, moneda, fila, onGuardado }: { plan: PlanPrecio; moneda: string; fila: PrecioMoneda | undefined; onGuardado: () => void }) {
  const toast = useToast();
  const [precio, setPrecio] = useState(fila?.precio_por_unidad ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPrecio(fila?.precio_por_unidad ?? ''); }, [fila]);
  const url = `/api/comercial/planes/${plan.clave}/precios/${moneda}`;
  async function guardar() {
    setBusy(true);
    try { await api(url, { method: 'PUT', json: { precio_por_unidad: precio.trim() } }); toast.ok(`${plan.nombre} en ${moneda}: precio guardado`); onGuardado(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }
  async function quitar() {
    setBusy(true);
    try { await api(url, { method: 'DELETE' }); toast.ok(`${plan.nombre} en ${moneda}: sin precio (Consúltanos)`); onGuardado(); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }
  return (
    <li className="flex flex-wrap items-end gap-3 py-2.5">
      <div className="min-w-[10rem] flex-1">
        <p className="text-sm font-medium">{plan.nombre}</p>
        <p className="num text-xs text-muted">{fila ? `Se muestra: ${dinero(fila.precio_por_unidad, moneda)} por depto al mes + impuesto` : 'Sin precio: en estos países se muestra «Consúltanos» y no se puede contratar'}</p>
      </div>
      <Input label={`Precio base (${monedaDe(moneda)?.simbolo ?? moneda}, sin impuesto)`} inputMode={decimalesDe(moneda) === 0 ? 'numeric' : 'decimal'} value={precio} onChange={e => setPrecio(e.target.value)} hint={decimalesDe(moneda) === 0 ? 'Sin decimales.' : undefined} className="w-56" />
      <Button size="sm" loading={busy} disabled={!precio.trim() || precio.trim() === fila?.precio_por_unidad} onClick={() => void guardar()} aria-label={`Guardar precio de ${plan.nombre} en ${moneda}`}>Guardar</Button>
      {fila && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void quitar()} aria-label={`Quitar precio de ${plan.nombre} en ${moneda}`}>Quitar</Button>}
    </li>
  );
}

/**
 * «Impuestos y moneda por país» (el impuesto —IGV, IVA…— y la moneda con que se cobra la suscripción en cada país, y si el país está abierto) y, debajo,
 * el precio de cada plan de pago en cada moneda que se cobra. Todo se edita aquí: nada vive en el código.
 */
export function ImpuestosYPrecios({ impuestos, precios, planes, onGuardado }: { impuestos: ImpuestoPais[]; precios: PrecioMoneda[]; planes: PlanPrecio[]; onGuardado: () => void }) {
  // Monedas en que se cobra hoy (de los países abiertos), sin soles: su precio es el del plan.
  const monedas = useMemo(() => [...new Set(impuestos.filter(i => i.activo).map(i => i.moneda))].filter(m => m !== 'PEN').sort(), [impuestos]);
  // Los planes que cobran: Gratis y cortesía no llevan precio por moneda.
  const deCobro = planes.filter(p => Number(p.precio_por_unidad) > 0);
  const paisesDe = (m: string) => impuestos.filter(i => i.moneda === m && i.activo).map(i => paisDe(i.pais)?.nombre ?? i.pais).join(', ');
  return (
    <>
      <Card>
        <CardHeader title="Impuestos y moneda por país" description="El impuesto que se suma a la suscripción (IGV, IVA…) y la moneda en que se cobra, según el país del condominio. Un país cerrado no se ofrece en la página de precios ni se puede contratar. Lo que ya se pagó no cambia al editar la tasa." />
        <CardBody><ul className="divide-y divide-line">{impuestos.map(f => <FilaImpuesto key={f.pais} f={f} onGuardado={onGuardado} />)}</ul></CardBody>
      </Card>
      <Card>
        <CardHeader title="Precios por moneda" description="Precio BASE por departamento al mes de cada plan en cada moneda que se cobra (sin impuesto). Un plan sin precio en la moneda de un país no se puede contratar ahí: se muestra «Consúltanos». En soles, el precio es el del plan (arriba)." />
        <CardBody className="space-y-5">
          {!monedas.length && <p className="text-sm text-muted">Todos los países abiertos cobran en soles.</p>}
          {monedas.map(m => (
            <section key={m} aria-label={`Precios en ${monedaDe(m)?.nombre ?? m}`}>
              <h3 className="text-sm font-semibold">{m} · {monedaDe(m)?.nombre ?? m} <span className="font-normal text-muted">({paisesDe(m)})</span></h3>
              <ul className="divide-y divide-line">{deCobro.map(p => <FilaPrecio key={`${p.clave}-${m}`} plan={p} moneda={m} fila={precios.find(x => x.plan_clave === p.clave && x.moneda === m)} onGuardado={onGuardado} />)}</ul>
            </section>
          ))}
        </CardBody>
      </Card>
    </>
  );
}
