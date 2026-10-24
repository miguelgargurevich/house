import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList, useResource } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { Alert, Button, Card, CardHeader, ErrorState, PageHeader, Skeleton, fechaCorta, soles, useToast } from '../../../ui';
import { CargoItem } from './CargoItem';
import { PagarModal } from './PagarModal';
import { primerNombre } from './tipos';
import type { Cargo } from './tipos';

interface Resumen {
  deuda_total: number | string;
  vencidos: number | string;
  en_revision: number;
  proximo_vencimiento: { cargo_id: number; monto: number | string; fecha: string } | null;
  pagado_ano: number | string;
}

export function InicioResidente({ base }: { base: '/propietario' | '/inquilino' }) {
  const { user } = useAuth();
  const toast = useToast();
  const resumen = useResource<Resumen>('/api/dashboard/resumen');
  const pendientes = useList<Cargo>('/api/me/cargos', { pageSize: 20, params: { estado: 'pendiente' } });
  const [pagando, setPagando] = useState<Cargo | null>(null);
  const [abriendo, setAbriendo] = useState(false);

  async function pagarProximo(id: number) {
    setAbriendo(true);
    try { setPagando(await api<Cargo>(`/api/me/cargos/${id}`)); }
    catch (e) { toast.error(errorText(e)); }
    finally { setAbriendo(false); }
  }

  function recargar() { void resumen.reload(); void pendientes.reload(); }

  const proximos = [...pendientes.items]
    .sort((a, b) => a.recibo.fecha_vencimiento.localeCompare(b.recibo.fecha_vencimiento))
    .slice(0, 3);
  const r = resumen.data;
  const hayVencidos = r ? Number(r.vencidos) > 0 : false;
  const alDia = r ? Number(r.deuda_total) <= 0 : false;

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
                <p className={`num mt-1 text-3xl font-semibold ${hayVencidos ? 'text-bad' : ''}`}>{soles(r.deuda_total)}</p>
                {alDia
                  ? <p className="mt-1 flex items-center gap-1.5 text-sm text-ok"><CheckCircleIcon className="h-4 w-4" />Estás al día</p>
                  : hayVencidos && <p className="mt-1 text-sm text-bad">Tienes recibos vencidos</p>}
                {r.en_revision > 0 && <p className="mt-1 text-sm text-info">{r.en_revision === 1 ? '1 pago en revisión' : `${r.en_revision} pagos en revisión`}</p>}
              </div>
              <div className="p-5">
                <p className="text-sm text-muted">Próximo vencimiento</p>
                {r.proximo_vencimiento ? (
                  <>
                    <p className="num mt-1 text-xl font-semibold">{soles(r.proximo_vencimiento.monto)}</p>
                    <p className="text-sm text-muted">Vence {fechaCorta(r.proximo_vencimiento.fecha)}</p>
                    <Button className="mt-3" loading={abriendo} onClick={() => void pagarProximo(r.proximo_vencimiento!.cargo_id)}>Pagar ahora</Button>
                  </>
                ) : (
                  <p className="mt-1 text-sm text-muted">No tienes vencimientos próximos.</p>
                )}
              </div>
              <div className="p-5">
                <p className="text-sm text-muted">Pagado este año</p>
                <p className="num mt-1 text-xl font-semibold">{soles(r.pagado_ano)}</p>
              </div>
            </div>
          </Card>

          {alDia ? (
            <Alert tone="ok">Estás al día: no tienes recibos por pagar. Cuando se emita uno nuevo, aparecerá aquí.</Alert>
          ) : (
            <>
              {hayVencidos && (
                <Alert tone="bad">
                  Tienes recibos vencidos. <Link to={`${base}/cargos?estado=vencido`} className="font-medium underline">Revisa cuáles son</Link>.
                </Alert>
              )}
              <Card>
                <CardHeader
                  title="Próximos recibos"
                  action={<Link to={`${base}/cargos`} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">Ver todos <ArrowRightIcon className="h-4 w-4" /></Link>}
                />
                {pendientes.error ? (
                  <ErrorState message={pendientes.error} onRetry={pendientes.reload} />
                ) : pendientes.loading ? (
                  <div className="space-y-3 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
                ) : proximos.length === 0 ? (
                  <p className="p-5 text-sm text-muted">No tienes recibos pendientes por vencer.</p>
                ) : (
                  <div className="divide-y divide-line">
                    {proximos.map(c => <CargoItem key={c.id} cargo={c} onPagar={setPagando} />)}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      )}

      <PagarModal cargo={pagando} onClose={() => setPagando(null)} onPagado={recargar} />
    </>
  );
}
