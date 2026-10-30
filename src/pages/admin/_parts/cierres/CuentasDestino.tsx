import { useEffect, useState } from 'react';
import { api, errorText, useResource } from '../../../../api';
import { Button, Card, CardBody, ErrorState, Input, Skeleton, useToast } from '../../../../ui';
import type { CuentaDestino, CuentasEmpresa } from './tipos';
import { textoCuenta } from './vista';

type Campos = { banco: string; tipo: string; numero: string; cci: string; titular: string };
const deCuenta = (c: CuentaDestino): Campos => ({ banco: c.banco ?? '', tipo: c.tipo ?? '', numero: c.numero ?? '', cci: c.cci ?? '', titular: c.titular ?? '' });
const aJson = (c: Campos) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.trim() || null]));

function Formulario({ titulo, ayuda, inicial, onGuardar }: { titulo: string; ayuda?: string; inicial: CuentaDestino; onGuardar: (c: Campos) => Promise<void> }) {
  const [c, setC] = useState<Campos>(deCuenta(inicial));
  const [guardando, setGuardando] = useState(false);
  useEffect(() => setC(deCuenta(inicial)), [inicial]);
  const campo = (k: keyof Campos, label: string) => <Input label={label} autoComplete="off" value={c[k]} onChange={e => setC({ ...c, [k]: e.target.value })} />;
  return (
    <form
      className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2"
      onSubmit={async e => { e.preventDefault(); setGuardando(true); try { await onGuardar(c); } finally { setGuardando(false); } }}
    >
      <div className="sm:col-span-2">
        <h3 className="break-words text-base font-semibold">{titulo}</h3>
        {ayuda && <p className="text-sm text-muted">{ayuda}</p>}
        {textoCuenta(inicial) && <p className="mt-1 break-words text-xs text-muted">Ahora: <span className="num">{textoCuenta(inicial)}</span></p>}
      </div>
      {campo('banco', 'Banco')}{campo('tipo', 'Tipo de cuenta')}{campo('numero', 'Número de cuenta')}{campo('cci', 'CCI')}
      <div className="sm:col-span-2">{campo('titular', 'Titular')}</div>
      <div className="sm:col-span-2"><Button type="submit" size="sm" loading={guardando}>Guardar cuenta</Button></div>
    </form>
  );
}

/** Las cuentas a las que paga el tesorero: la de la empresa administradora y la de cada proveedor. Se le muestran al registrar el pago. */
export function CuentasDestino({ complejoId }: { complejoId: number | null }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<CuentasEmpresa>(`/api/cierres/cuentas${complejoId ? `?complejo_id=${complejoId}` : ''}`);
  if (loading && !data) return <Skeleton className="h-48 w-full" />;
  if (error || !data) return <ErrorState message={error ?? 'No se pudo cargar'} onRetry={() => void reload()} />;

  async function guardar(ruta: string, c: Campos, cuerpoExtra: Record<string, unknown> = {}) {
    try {
      await api(ruta, { method: 'PUT', json: { ...aJson(c), ...cuerpoExtra } });
      toast.ok('Cuenta guardada');
      await reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <p className="text-sm text-muted">El tesorero ve estas cuentas al registrar cada pago. La cuenta de la Junta central se carga en Medios de pago.</p>
        <Formulario
          titulo={`Empresa administradora · ${data.administradora.empresa}`} ayuda="Adónde paga cada block el concepto de administración."
          inicial={data.administradora} onGuardar={c => guardar('/api/cierres/cuentas/administradora', c, complejoId ? { complejo_id: complejoId } : {})}
        />
        {data.proveedores.length === 0 && <p className="text-sm text-muted">Aún no hay proveedores: créalos en Proveedores para cargar su cuenta.</p>}
        {data.proveedores.map(p => (
          <Formulario key={p.id} titulo={`Proveedor · ${p.razon_social}`} inicial={p} onGuardar={c => guardar(`/api/cierres/cuentas/proveedor/${p.id}`, c)} />
        ))}
      </CardBody>
    </Card>
  );
}
