import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList, useResource } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { Alert, Button, Card, CardHeader, ErrorState, PageHeader, Skeleton, dinero, fechaCorta, useToast } from '../../../ui';
import { DetalleMantenimientoModal } from './DetalleMantenimientoModal';
import { MantenimientoItem } from './MantenimientoItem';
import { PagarModal } from './PagarModal';
import { primerNombre } from './tipos';
import type { Mantenimiento } from '../../shared/mantenimiento/tipos';

interface Resumen {
  /** Moneda de las cifras; `null` si tus unidades están en condominios de monedas distintas (entonces van por moneda en `por_moneda`, nunca sumadas). */
  moneda: string | null;
  deuda_total: number | string | null;
  por_moneda?: Record<string, { deuda_total: number | string; pagado_ano: number | string }>;
  /** Mantenimientos (un recibo por departamento y mes), no conceptos sueltos. */
  mantenimientos_vencidos: number;
  mantenimientos_en_revision: number;
  proximo_mantenimiento: { recibo_id: number; unidad_id: number; titulo: string; torre?: string | null; monto: number | string; moneda: string; fecha: string } | null;
  pagado_ano: number | string | null;
}

export function InicioResidente({ base }: { base: '/propietario' | '/inquilino' }) {
  const { user } = useAuth();
  const toast = useToast();
  const resumen = useResource<Resumen>('/api/dashboard/resumen');
  const pendientes = useList<Mantenimiento>('/api/me/mantenimientos', { pageSize: 3, params: { estado: 'vencido,pendiente,parcial', orden: 'vencimiento:asc' } });
  const [pagando, setPagando] = useState<Mantenimiento | null>(null);
  const [viendo, setViendo] = useState<Mantenimiento | null>(null);
  const [abriendo, setAbriendo] = useState(false);

  async function pagarProximo(p: { recibo_id: number; unidad_id: number }) {
    setAbriendo(true);
    try {
      const r = await api<{ items: Mantenimiento[] }>(`/api/me/mantenimientos?pageSize=100&estado=pendiente,parcial`);
      const m = r.items.find(x => x.recibo_id === p.recibo_id && x.unidad_id === p.unidad_id);
      if (m) setPagando(m);
    }
    catch (e) { toast.error(errorText(e)); }
    finally { setAbriendo(false); }
  }

  function recargar() { void resumen.reload(); void pendientes.reload(); }

  const proximos = pendientes.items;
  const r = resumen.data;
  const hayVencidos = r ? r.mantenimientos_vencidos > 0 : false;
  // Con unidades en dos monedas la deuda y lo pagado se dicen por moneda: «S/ 150.00 · US$ 40.00».
  const montos = (campo: 'deuda_total' | 'pagado_ano') => (r?.moneda != null ? dinero(r[campo], r.moneda) : Object.entries(r?.por_moneda ?? {}).map(([m, x]) => dinero(x[campo], m)).join(' · '));
  const alDia = r ? (r.moneda != null ? Number(r.deuda_total) <= 0 : Object.values(r.por_moneda ?? {}).every(x => Number(x.deuda_total) <= 0)) : false;

  return (
    <>
      <PageHeader title={`Hola, ${primerNombre(user?.nombre)}`} description="Esto es lo que debes y lo que ya pagaste." />

      {resumen.error ? (
        <Card><ErrorState message={resumen.error} onRetry={resumen.reload} /></Card>
      ) : resumen.loading || !r ? (
        <div className="space-y-6"><Skeleton className="h-44 w-full" /><Skeleton className="h-56 w-full" /></div>
      ) : (
        <div className="space-y-6">
          <Card>
            <div className="grid divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="p-5">
                <p className="text-sm text-muted">Deuda total</p>
                <p className={`num mt-1 text-3xl font-semibold ${hayVencidos ? 'text-bad' : ''}`}>{montos('deuda_total')}</p>
                {alDia
                  ? <p className="mt-1 flex items-center gap-1.5 text-sm text-ok"><CheckCircleIcon className="h-4 w-4" />Estás al día</p>
                  : hayVencidos && <p className="mt-1 text-sm text-bad">{r.mantenimientos_vencidos === 1 ? 'Tienes 1 mantenimiento vencido' : `Tienes ${r.mantenimientos_vencidos} mantenimientos vencidos`}</p>}
                {r.mantenimientos_en_revision > 0 && <p className="mt-1 text-sm text-info">{r.mantenimientos_en_revision === 1 ? '1 pago en revisión' : `${r.mantenimientos_en_revision} pagos en revisión`}</p>}
              </div>
              <div className="p-5">
                <p className="text-sm text-muted">Próximo vencimiento</p>
                {r.proximo_mantenimiento ? (
                  <>
                    <p className="num mt-1 text-xl font-semibold">{dinero(r.proximo_mantenimiento.monto, r.proximo_mantenimiento.moneda)}</p>
                    <p className="text-sm text-muted">{r.proximo_mantenimiento.titulo.split(' · ')[0]}{r.proximo_mantenimiento.torre ? ` · ${r.proximo_mantenimiento.torre}` : ''} · vence {fechaCorta(r.proximo_mantenimiento.fecha)}</p>
                    <Button className="mt-3" loading={abriendo} onClick={() => void pagarProximo(r.proximo_mantenimiento!)}>Pagar mantenimiento</Button>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted">No tienes vencimientos próximos.</p>
                )}
              </div>
              <div className="p-5">
                <p className="text-sm text-muted">Pagado este año</p>
                <p className="num mt-1 text-xl font-semibold">{montos('pagado_ano')}</p>
              </div>
            </div>
          </Card>

          {alDia ? (
            <Alert tone="ok">Estás al día: no tienes mantenimientos por pagar. Cuando se emita el del mes, aparecerá aquí.</Alert>
          ) : (
            <>
              {hayVencidos && (
                <Alert tone="bad">
                  Tienes mantenimientos vencidos. <Link to={`${base}/cargos?estado=vencido`} className="font-medium underline">Revisa cuáles son</Link>.
                </Alert>
              )}
              <Card>
                <CardHeader
                  title="Mantenimientos por pagar"
                  action={<Link to={`${base}/cargos`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">Ver todos <ArrowRightIcon className="h-4 w-4" /></Link>}
                />
                {pendientes.error ? (
                  <ErrorState message={pendientes.error} onRetry={pendientes.reload} />
                ) : pendientes.loading ? (
                  <div className="space-y-3 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
                ) : proximos.length === 0 ? (
                  <p className="p-5 text-sm text-muted">No tienes mantenimientos por pagar.</p>
                ) : (
                  <div className="divide-y divide-line">
                    {proximos.map(m => <MantenimientoItem key={`${m.recibo_id}-${m.unidad_id}`} mant={m} rechazo={m.motivo_rechazo} onPagar={setPagando} onVer={setViendo} />)}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      )}

      <DetalleMantenimientoModal mant={viendo} onClose={() => setViendo(null)} onPagar={setPagando} />
      <PagarModal mant={pagando} onClose={() => setPagando(null)} onPagado={recargar} />
    </>
  );
}
