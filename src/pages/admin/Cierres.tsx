import { useEffect, useState } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCondominio } from '../../app/condominio';
import { Alert, Badge, Button, EmptyState, ErrorState, PageHeader, Select, Skeleton, TabPanel, Tabs, dinero, nombreDelMes } from '../../ui';
import { CierreCentral } from './_parts/cierres/CierreCentral';
import { CuentasDestino } from './_parts/cierres/CuentasDestino';
import { DetalleCierre } from './_parts/cierres/DetalleCierre';
import { PeriodoSelect } from './_parts/cierres/PeriodoSelect';
import { TablaAportes } from './_parts/cierres/TablaAportes';
import type { TablaBlocks } from './_parts/cierres/tipos';
import { ESTADO_CIERRE, periodoPorDefecto } from './_parts/cierres/vista';

type Pestana = 'blocks' | 'administradora' | 'central' | 'junta_central' | 'cuentas';
const PESTANAS: { id: Pestana; label: string }[] = [
  { id: 'blocks', label: 'Cierre por block' },
  { id: 'administradora', label: 'Pagos a la administradora' },
  { id: 'central', label: 'Aportes a la Junta central' },
  { id: 'junta_central', label: 'Cierre de la Junta central' },
  { id: 'cuentas', label: 'Cuentas de destino' },
];

/** Blocks de un condominio en un mes, con su estado; al tocar uno se abre su cierre. Un block con un solo cierre (la junta de ese block) se abre solo. */
function ListaBlocks({ complejoId, mes, anio, esAdmin }: { complejoId: number | null; mes: number; anio: number; esAdmin: boolean }) {
  const { data, loading, error, reload } = useResource<TablaBlocks>(`/api/cierres?mes=${mes}&anio=${anio}${complejoId ? `&complejo_id=${complejoId}` : ''}`);
  const [abierto, setAbierto] = useState<number | null>(null);
  useEffect(() => setAbierto(null), [complejoId, mes, anio]);

  if (loading && !data) return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;
  if (error || !data) return <ErrorState message={error ?? 'No se pudo cargar'} onRetry={() => void reload()} />;
  const unico = !esAdmin && data.blocks.length === 1 ? data.blocks[0]!.estructura.id : null;
  const id = abierto ?? unico;

  if (id !== null) {
    return (
      <div className="space-y-4">
        {abierto !== null && !unico && <Button variant="ghost" size="sm" icon={<ChevronLeftIcon className="h-4 w-4" />} onClick={() => setAbierto(null)}>Todos los blocks</Button>}
        <DetalleCierre estructuraId={id} mes={mes} anio={anio} esAdmin={esAdmin} onCambio={() => void reload()} />
      </div>
    );
  }
  if (data.blocks.length === 0) return <EmptyState title="Sin blocks con recibos" description="Cuando el condominio emita recibos por block, aquí verás el cierre de cada uno." />;
  return (
    <ul className="grid gap-3" aria-label={`Cierre de ${nombreDelMes(mes)} por block`}>
      {data.blocks.map(b => {
        const est = ESTADO_CIERRE[b.estado];
        return (
          <li key={b.estructura.id}>
            <button type="button" onClick={() => setAbierto(b.estructura.id)} className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface p-4 text-left transition-colors duration-150 hover:bg-surface2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="break-words text-base font-semibold">{b.estructura.nombre ?? 'Block'}</span>
                  <Badge tone={est.tone}>{est.label}</Badge>
                </span>
                <span className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                  <span><span className="block text-xs text-muted">Pagos registrados</span><span className="num">{b.lineas_pagadas} de {b.lineas_total}</span></span>
                  <span><span className="block text-xs text-muted">Facturado</span><span className="num">{dinero(b.facturado_total, data.moneda)}</span></span>
                  <span><span className="block text-xs text-muted">Sobrante del mes</span><span className="num">{dinero(b.sobrante_mes, data.moneda)}</span></span>
                  <span><span className="block text-xs text-muted">Fondo de ahorros</span><span className="num">{dinero(b.fondo_ahorros, data.moneda)}</span></span>
                </span>
              </span>
              <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Cierre del mes. Lo usan la junta del block (tesorero: registra sus pagos con voucher; presidente: lo ve), la Junta central (ve el de todos los blocks) y la
 * administración («Cierres por block»: elige condominio y ve el estado de cada block, la conformidad de los pagos a la empresa administradora y las cuentas de destino).
 */
export default function Cierres() {
  const { user } = useAuth();
  const { condominios } = useCondominio();
  const esAdmin = user?.rol === 'admin' || user?.rol === 'superadmin';
  const [periodo, setPeriodo] = useState(periodoPorDefecto);
  const [pestana, setPestana] = useState<Pestana>('blocks');
  const [elegido, setElegido] = useState<number | null>(null);
  const complejoId = esAdmin ? (elegido ?? condominios[0]?.id ?? null) : null;
  const anioActual = new Date().getFullYear();

  return (
    <>
      <PageHeader
        title={esAdmin ? 'Cierres del mes' : 'Cierre del mes'}
        description={esAdmin
          ? 'Lo que cada junta de block paga al cerrar el mes: la empresa administradora, la Junta central, los servicios y los proveedores; con su voucher y su conformidad.'
          : 'Lo que la junta paga al cerrar el mes, con el voucher de cada pago. Se cierra hacia el día 5 del mes siguiente.'}
      />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        {esAdmin && (
          <div className="w-full sm:w-72">
            {condominios.length > 1
              ? <Select label="Condominio" value={complejoId ?? ''} onChange={e => setElegido(Number(e.target.value))}>{condominios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</Select>
              : <p className="text-sm"><span className="block text-xs text-muted">Condominio</span><span className="font-medium">{condominios[0]?.nombre ?? '—'}</span></p>}
          </div>
        )}
        <PeriodoSelect mes={periodo.mes} anio={periodo.anio} anioActual={anioActual} onChange={setPeriodo} />
      </div>

      {esAdmin && complejoId === null && <Alert tone="info">Elige un condominio para ver su cierre.</Alert>}
      {(!esAdmin || complejoId !== null) && (esAdmin ? (
        <>
          <Tabs value={pestana} onChange={setPestana} items={PESTANAS} idBase="cierres" label="Cierres" />
          <TabPanel idBase="cierres" id="blocks" value={pestana} className="mt-5"><ListaBlocks complejoId={complejoId} mes={periodo.mes} anio={periodo.anio} esAdmin /></TabPanel>
          <TabPanel idBase="cierres" id="administradora" value={pestana} className="mt-5"><TablaAportes complejoId={complejoId} mes={periodo.mes} anio={periodo.anio} destino="administradora" /></TabPanel>
          <TabPanel idBase="cierres" id="central" value={pestana} className="mt-5"><TablaAportes complejoId={complejoId} mes={periodo.mes} anio={periodo.anio} destino="central" /></TabPanel>
          <TabPanel idBase="cierres" id="junta_central" value={pestana} className="mt-5"><CierreCentral complejoId={complejoId} mes={periodo.mes} anio={periodo.anio} /></TabPanel>
          <TabPanel idBase="cierres" id="cuentas" value={pestana} className="mt-5"><CuentasDestino complejoId={complejoId} /></TabPanel>
        </>
      ) : <ListaBlocks complejoId={null} mes={periodo.mes} anio={periodo.anio} esAdmin={false} />)}
    </>
  );
}
