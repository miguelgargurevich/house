import { ArrowDownTrayIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { useState } from 'react';
import { useList, useResource } from '../../api';
import { Badge, Button, Card, DataTable, PageHeader, Skeleton, StatStrip, Toolbar, fechaCorta, soles } from '../../ui';
import type { Column } from '../../ui';
import { descargarCSV } from './_parts/cobranza/csv';
import { hoyISO } from './_parts/cobranza/comun';
import { SelectoresUbicacion } from './_parts/cobranza/SelectoresUbicacion';
import { AvisoModulo } from '../shared/_parts/AvisoModulo';

type Ref = { id?: number; codigo?: string; nombre?: string } | string | null | undefined;

interface Moroso {
  unidad: Ref;
  estructura?: { id: number; nombre: string | null } | null;
  complejo?: { id: number; nombre: string } | null;
  propietario: Ref;
  deuda_total: number | string;
  cargos_vencidos: number;
  dias_max_atraso: number;
}

// El contrato no fija si `unidad`/`propietario` llegan como objeto o como texto: se aceptan ambos.
const texto = (r: Ref): string => (typeof r === 'string' ? r : r?.codigo ?? r?.nombre ?? '');
const claveFila = (m: Moroso): string => (typeof m.unidad === 'object' && m.unidad?.id ? String(m.unidad.id) : `${texto(m.unidad)}|${texto(m.propietario)}`);

export default function Morosidad() {
  const [complejo, setComplejo] = useState('');
  const [torre, setTorre] = useState('');
  // Las torres son las del condominio elegido (con varios condominios, «Block 1» se repite: el selector las rotula con su condominio).
  const params = { complejo_id: complejo || undefined, estructura_id: torre || undefined };
  const list = useList<Moroso>('/api/reportes/morosidad', { pageSize: 100, params });
  // Las cifras de arriba son de TODO el filtro, no sólo de las filas de la página.
  const cifras = useResource<{ resumen: { unidades: number; deuda_total: string; cargos_vencidos: number } }>(`/api/reportes/morosidad?pageSize=1${complejo ? `&complejo_id=${complejo}` : ''}${torre ? `&estructura_id=${torre}` : ''}`);

  const deudaTotal = cifras.data ? Number(cifras.data.resumen.deuda_total) : list.items.reduce((s, m) => s + (Number(m.deuda_total) || 0), 0);
  const mayorAtraso = list.items.reduce((s, m) => Math.max(s, m.dias_max_atraso || 0), 0);
  const parcial = list.total > list.items.length;
  const esperando = list.loading && list.items.length === 0;
  const hint = parcial ? 'Sólo las filas cargadas' : undefined;

  function exportar() {
    descargarCSV(
      `morosidad-${hoyISO()}.csv`,
      ['Unidad', 'Condominio', 'Torre', 'Propietario', 'Deuda (S/)', 'Cargos vencidos', 'Días de atraso'],
      list.items.map(m => [texto(m.unidad), m.complejo?.nombre ?? '', m.estructura?.nombre ?? '', texto(m.propietario), Number(m.deuda_total).toFixed(2), m.cargos_vencidos, m.dias_max_atraso]),
    );
  }

  const columns: Column<Moroso>[] = [
    { key: 'unidad', header: 'Unidad', cell: m => <span className="font-medium">{texto(m.unidad) || '—'}</span> },
    { key: 'complejo', header: 'Condominio', hideBelow: 'md', cell: m => m.complejo?.nombre ?? '—' },
    { key: 'torre', header: 'Torre', hideBelow: 'sm', cell: m => m.estructura?.nombre ?? '—' },
    { key: 'propietario', header: 'Propietario', hideBelow: 'sm', cell: m => texto(m.propietario) || '—' },
    { key: 'deuda', header: 'Deuda', align: 'right', cell: m => <span className="num font-medium">{soles(m.deuda_total)}</span> },
    { key: 'cargos', header: 'Cargos vencidos', align: 'right', hideBelow: 'md', cell: m => <span className="num">{m.cargos_vencidos}</span> },
    { key: 'atraso', header: 'Atraso', cell: m => <Badge tone={m.dias_max_atraso >= 30 ? 'bad' : 'warn'}>{m.dias_max_atraso} {m.dias_max_atraso === 1 ? 'día' : 'días'}</Badge> },
  ];

  // Los reportes son del plan Pro: sin él el servidor responde 403 (MODULO_NO_ACTIVO) y se muestra el aviso con el enlace a Mi plan, no un error.
  if (list.errorCode === 'MODULO_NO_ACTIVO') {
    return (
      <>
        <PageHeader title="Morosidad" description="Unidades con cargos vencidos, de mayor a menor deuda." />
        <Card><div className="p-5"><AvisoModulo modulo="reportes" /><p className="mt-3 text-sm text-muted">La cobranza sigue igual: tus recibos, pagos y cargos vencidos están en sus pantallas. El reporte de morosidad y sus exportes son del plan Pro.</p></div></Card>
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
          { label: 'Deuda vencida', value: esperando && !cifras.data ? <Skeleton className="h-7 w-28" /> : soles(deudaTotal), tone: deudaTotal > 0 ? 'bad' : undefined, hint: cifras.data ? undefined : hint },
          { label: 'Unidades morosas', value: esperando ? <Skeleton className="h-7 w-10" /> : list.total },
          { label: 'Mayor atraso', value: esperando ? <Skeleton className="h-7 w-20" /> : `${mayorAtraso} ${mayorAtraso === 1 ? 'día' : 'días'}`, tone: mayorAtraso >= 30 ? 'bad' : mayorAtraso > 0 ? 'warn' : undefined, hint },
        ]}
      />
      <Card>
        <Toolbar>
          <SelectoresUbicacion complejo={complejo} torre={torre} onComplejo={setComplejo} onTorre={setTorre} />
        </Toolbar>
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
          empty={{ title: 'Sin morosidad', description: 'Todas las unidades están al día con sus cargos.', icon: <CheckCircleIcon className="text-ok" /> }}
        />
      </Card>
    </>
  );
}
