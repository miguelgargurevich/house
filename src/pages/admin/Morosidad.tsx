import { useState } from 'react';
import { ArrowDownTrayIcon, CheckCircleIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useCondominio, useTorreElegida } from '../../app/condominio';
import { useList, useResource } from '../../api';
import { simboloDe } from '../../lib/paises';
import { Badge, Button, Card, DataTable, Modal, PageHeader, Skeleton, StatStrip, dinero, fechaCorta, periodo, sumaPorMoneda } from '../../ui';
import type { Column } from '../../ui';
import { descargarCSV } from './_parts/cobranza/csv';
import { hoyISO } from './_parts/cobranza/comun';
import { SelectoresUbicacion } from './_parts/cobranza/SelectoresUbicacion';
import { AvisoModulo } from '../shared/_parts/AvisoModulo';
import { MantenimientoAdminModal } from './_parts/mantenimientos/MantenimientoAdminModal';

type Ref = { id?: number; codigo?: string; nombre?: string } | string | null | undefined;

interface Moroso {
  unidad: Ref;
  estructura?: { id: number; nombre: string | null } | null;
  complejo?: { id: number; nombre: string } | null;
  propietario: Ref;
  /** Moneda del condominio de la unidad: la deuda va en ella. */
  moneda: string;
  deuda_total: number | string;
  cargos_vencidos: number;
  dias_max_atraso: number;
  /** Sus mantenimientos vencidos, uno por recibo, del más antiguo al más nuevo: cada uno abre su detalle. */
  recibos?: { recibo_id: number; mes: number; anio: number; deuda: string; dias_atraso: number }[];
}

const idUnidad = (m: Moroso): number | null => (typeof m.unidad === 'object' && m.unidad?.id ? m.unidad.id : null);

// El contrato no fija si `unidad`/`propietario` llegan como objeto o como texto: se aceptan ambos.
const texto = (r: Ref): string => (typeof r === 'string' ? r : r?.codigo ?? r?.nombre ?? '');
const claveFila = (m: Moroso): string => (typeof m.unidad === 'object' && m.unidad?.id ? String(m.unidad.id) : `${texto(m.unidad)}|${texto(m.propietario)}`);

export default function Morosidad() {
  const { complejo } = useCondominio();
  // Clic en una unidad: con un solo mes vencido abre su detalle; con varios, primero la lista de meses.
  const [elegida, setElegida] = useState<Moroso | null>(null);
  const [detalle, setDetalle] = useState<{ reciboId: number; unidadId: number } | null>(null);
  function abrir(m: Moroso) {
    const unidadId = idUnidad(m);
    if (unidadId == null || !m.recibos?.length) return;
    if (m.recibos.length === 1) setDetalle({ reciboId: m.recibos[0]!.recibo_id, unidadId });
    else setElegida(m);
  }
  const [torre, setTorre] = useTorreElegida();
  // Las torres son las del condominio elegido (con varios condominios, «Block 1» se repite: el selector las rotula con su condominio).
  const params = { complejo_id: complejo || undefined, estructura_id: torre || undefined };
  const list = useList<Moroso>('/api/reportes/morosidad', { pageSize: 100, params });
  // Las cifras de arriba son de TODO el filtro, no sólo de las filas de la página.
  // Con condominios de monedas distintas el servidor no da un total único: `deuda_total` viene en null y las cifras van por moneda.
  const cifras = useResource<{ resumen: { unidades: number; deuda_total: string | null; cargos_vencidos: number; moneda: string | null; por_moneda?: Record<string, { deuda_total: string }> } }>(`/api/reportes/morosidad?pageSize=1${complejo ? `&complejo_id=${complejo}` : ''}${torre ? `&estructura_id=${torre}` : ''}`);

  // Deuda por moneda: del resumen del filtro completo; mientras llega, la de las filas cargadas (nunca sumando monedas distintas).
  const deudas: { moneda: string; total: number }[] = cifras.data
    ? cifras.data.resumen.moneda !== null ? [{ moneda: cifras.data.resumen.moneda, total: Number(cifras.data.resumen.deuda_total) }] : Object.entries(cifras.data.resumen.por_moneda ?? {}).map(([moneda, x]) => ({ moneda, total: Number(x.deuda_total) }))
    : sumaPorMoneda(list.items.map(m => ({ monto: m.deuda_total, moneda: m.moneda })));
  const deudaTotal = deudas.reduce((s, x) => Math.max(s, x.total), 0); // sólo para el tono: «hay deuda» en alguna moneda
  const mayorAtraso = list.items.reduce((s, m) => Math.max(s, m.dias_max_atraso || 0), 0);
  const parcial = list.total > list.items.length;
  const esperando = list.loading && list.items.length === 0;
  const hint = parcial ? 'Sólo las filas cargadas' : undefined;

  function exportar() {
    // Una sola moneda: «Deuda (S/)»; varias: «Deuda» y una columna «Moneda» (el CSV no mezcla monedas bajo un mismo rótulo).
    const monedas = [...new Set(list.items.map(m => m.moneda))];
    const una = monedas.length <= 1 ? (monedas[0] ?? 'PEN') : null;
    descargarCSV(
      `morosidad-${hoyISO()}.csv`,
      ['Unidad', 'Condominio', 'Block', 'Propietario', una ? `Deuda (${simboloDe(una)})` : 'Deuda', 'Cargos vencidos', 'Días de atraso', ...(una ? [] : ['Moneda'])],
      list.items.map(m => [texto(m.unidad), m.complejo?.nombre ?? '', m.estructura?.nombre ?? '', texto(m.propietario), Number(m.deuda_total).toFixed(2), m.cargos_vencidos, m.dias_max_atraso, ...(una ? [] : [m.moneda])]),
    );
  }

  const columns: Column<Moroso>[] = [
    { key: 'unidad', header: 'Unidad', cell: m => <span className="font-medium">{texto(m.unidad) || '—'}</span> },
    { key: 'complejo', header: 'Condominio', hideBelow: 'md', cell: m => m.complejo?.nombre ?? '—' },
    { key: 'torre', header: 'Block', hideBelow: 'sm', cell: m => m.estructura?.nombre ?? '—' },
    { key: 'propietario', header: 'Propietario', hideBelow: 'sm', cell: m => texto(m.propietario) || '—' },
    { key: 'deuda', header: 'Deuda', align: 'right', cell: m => <span className="num font-medium">{dinero(m.deuda_total, m.moneda)}</span> },
    { key: 'meses', header: 'Meses vencidos', align: 'right', hideBelow: 'md', cell: m => <span className="num">{m.recibos?.length ?? '—'}</span> },
    { key: 'atraso', header: 'Atraso', cell: m => <Badge tone={m.dias_max_atraso >= 30 ? 'bad' : 'warn'}>{m.dias_max_atraso} {m.dias_max_atraso === 1 ? 'día' : 'días'}</Badge> },
    { key: 'ver', header: '', align: 'right', cell: () => <ChevronRightIcon className="ml-auto h-4 w-4 text-muted" aria-hidden="true" /> },
  ];

  // Los reportes son del plan Pro: sin él el servidor responde 403 (MODULO_NO_ACTIVO) y se muestra el aviso con el enlace a Mi plan, no un error.
  if (list.errorCode === 'MODULO_NO_ACTIVO') {
    return (
      <>
        <PageHeader title="Morosidad" description="Unidades con cargos vencidos, de mayor a menor deuda." />
        <Card><div className="p-5"><AvisoModulo modulo="reportes" /><p className="mt-3 text-sm text-muted">La cobranza sigue igual: tus recibos, pagos y cargos vencidos están en sus pantallas. El reporte de morosidad y sus exportes son del plan Torre Pro.</p></div></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Morosidad"
        description="Unidades con cargos vencidos, de mayor a menor deuda."
        actions={
          <Button variant="secondary" icon={<ArrowDownTrayIcon className="h-4 w-4" />} disabled={list.loading || !!list.error || list.items.length === 0} onClick={exportar}>
            Exportar CSV
          </Button>
        }
      />
      <StatStrip
        stats={[
          { label: 'Deuda vencida', value: esperando && !cifras.data ? <Skeleton className="h-7 w-28" /> : deudas.length > 1 ? deudas.map(x => dinero(x.total, x.moneda)).join(' · ') : dinero(deudas[0]?.total ?? 0, deudas[0]?.moneda), tone: deudaTotal > 0 ? 'bad' : undefined, hint: cifras.data ? (deudas.length > 1 ? 'Una cifra por moneda: no se suman' : undefined) : hint },
          { label: 'Unidades morosas', value: esperando ? <Skeleton className="h-7 w-10" /> : list.total },
          { label: 'Mayor atraso', value: esperando ? <Skeleton className="h-7 w-20" /> : `${mayorAtraso} ${mayorAtraso === 1 ? 'día' : 'días'}`, tone: mayorAtraso >= 30 ? 'bad' : mayorAtraso > 0 ? 'warn' : undefined, hint },
        ]}
      />
      <Card>
        <SelectoresUbicacion torre={torre} onTorre={setTorre} envoltura="toolbar" />
        <DataTable
          caption={`Unidades morosas al ${fechaCorta(new Date())}`}
          columns={columns}
          rows={list.items}
          rowKey={claveFila}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          onRowClick={abrir}
          empty={{ title: 'Sin morosidad', description: 'Todas las unidades están al día con sus cargos.', icon: <CheckCircleIcon className="text-ok" /> }}
        />
      </Card>

      <Modal open={elegida !== null} onClose={() => setElegida(null)} title={`Meses vencidos de ${elegida ? texto(elegida.unidad) : ''}`} description="Elige el mantenimiento para ver su detalle, registrar el pago o revisar el voucher.">
        {elegida && (
          <ul className="divide-y divide-line">
            {elegida.recibos?.map(r => (
              <li key={r.recibo_id}>
                <button
                  type="button"
                  onClick={() => { const unidadId = idUnidad(elegida); setElegida(null); if (unidadId != null) setDetalle({ reciboId: r.recibo_id, unidadId }); }}
                  className="flex w-full items-center gap-3 rounded px-2 py-3 text-left text-sm transition-colors duration-150 hover:bg-surface2"
                >
                  <span className="flex-1 font-medium">Mantenimiento de {periodo(r.mes, r.anio).toLowerCase()}</span>
                  <span className="num">{dinero(r.deuda, elegida.moneda)}</span>
                  <Badge tone={r.dias_atraso >= 30 ? 'bad' : 'warn'}>{r.dias_atraso} {r.dias_atraso === 1 ? 'día' : 'días'}</Badge>
                  <ChevronRightIcon className="h-4 w-4 text-muted" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      {detalle && <MantenimientoAdminModal reciboId={detalle.reciboId} unidadId={detalle.unidadId} onClose={() => setDetalle(null)} onCambio={() => { void list.reload(); void cifras.reload(); }} />}
    </>
  );
}
