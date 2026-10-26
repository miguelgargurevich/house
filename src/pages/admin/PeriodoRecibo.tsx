import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../api';
import { Card, ErrorState, PageHeader, SearchBox, Select, Skeleton, StatStrip, StatusBadge, Toolbar, fechaCorta, periodo, soles } from '../../ui';
import { BloquesPeriodo } from './_parts/mantenimientos/BloquesPeriodo';
import type { BlockResumen } from './_parts/mantenimientos/BloquesPeriodo';
import { MantenimientoAdminModal } from './_parts/mantenimientos/MantenimientoAdminModal';
import { ESTADOS_FILTRO, MantenimientosLista } from './_parts/mantenimientos/MantenimientosLista';
import type { Mantenimiento } from '../shared/mantenimiento/tipos';

interface Periodo {
  id: number;
  mes: number;
  anio: number;
  descripcion: string | null;
  fecha_emision: string;
  fecha_vencimiento: string;
  estado: string | null;
  complejo?: { id: number; nombre: string } | null;
  totales?: { monto: string; cobrado: string; pendiente: string; en_revision: string };
  estado_cobranza?: string;
}

function useDebounced<T>(valor: T, ms = 300): T {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

/** Un periodo: agrupado por torre si el condominio tiene más de una (si no, directo a los departamentos). */
export default function PeriodoRecibo() {
  const { id } = useParams();
  const reciboId = Number(id);
  const periodoDb = useResource<Periodo>(`/api/recibos/${reciboId}?sin_cargos=1`);
  const bloques = useResource<{ agrupado: boolean; blocks: BlockResumen[] }>(`/api/recibos/${reciboId}/blocks`);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const [block, setBlock] = useState('');
  const [viendo, setViendo] = useState<Mantenimiento | null>(null);
  const [recargar, setRecargar] = useState(0);
  const qFinal = useDebounced(q.trim());

  const p = periodoDb.data;
  const agrupado = bloques.data?.agrupado ?? false;
  const filtrando = qFinal !== '' || estado !== '' || block !== '';
  const t = p?.totales;
  const pct = t && Number(t.monto) > 0 ? Math.round((Number(t.cobrado) / Number(t.monto)) * 1000) / 10 : 0;
  const morosos = bloques.data?.blocks.reduce((s, b) => s + b.morosos, 0);

  if (!Number.isInteger(reciboId) || reciboId <= 0) return <Card><ErrorState message="Periodo no válido" /></Card>;

  return (
    <>
      <Link to="/admin/recibos" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"><ArrowLeftIcon className="h-4 w-4" />Recibos</Link>
      {periodoDb.error ? (
        <Card><ErrorState message={periodoDb.error} onRetry={periodoDb.reload} /></Card>
      ) : (
        <>
          <PageHeader
            title={p ? `Mantenimiento de ${periodo(p.mes, p.anio).toLowerCase()}` : 'Periodo'}
            description={p ? `${p.complejo?.nombre ?? ''} · emitido el ${fechaCorta(p.fecha_emision)} · vence el ${fechaCorta(p.fecha_vencimiento)}` : undefined}
            actions={p ? <StatusBadge estado={p.estado} /> : undefined}
          />
          <StatStrip
            stats={[
              { label: 'Emitido', value: t ? soles(t.monto) : <Skeleton className="h-7 w-28" /> },
              { label: 'Cobrado', value: t ? soles(t.cobrado) : <Skeleton className="h-7 w-28" />, tone: 'ok', hint: t ? `${pct} %` : undefined },
              { label: 'Por cobrar', value: t ? soles(t.pendiente) : <Skeleton className="h-7 w-28" />, hint: t && Number(t.en_revision) > 0 ? `${soles(t.en_revision)} en revisión` : undefined },
              { label: 'Departamentos morosos', value: morosos === undefined ? <Skeleton className="h-7 w-10" /> : morosos, tone: morosos ? 'bad' : undefined },
            ]}
          />
        </>
      )}

      <Card className="mb-4">
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Buscar departamento (ej. B01-804)" label="Buscar departamento" />
          {agrupado && (
            <Select label="Torre" className="w-full sm:w-48 [&_label]:sr-only" value={block} onChange={e => setBlock(e.target.value)}>
              <option value="">Todas las torres</option>
              {(bloques.data?.blocks ?? []).map(b => <option key={b.estructura_id ?? 'sin'} value={b.estructura_id ?? 'sin'}>{b.nombre}</option>)}
            </Select>
          )}
          <Select label="Estado" className="w-full sm:w-48 [&_label]:sr-only" value={estado} onChange={e => setEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            {ESTADOS_FILTRO.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
          </Select>
        </Toolbar>
      </Card>

      {agrupado && !filtrando ? (
        <BloquesPeriodo reciboId={reciboId} blocks={bloques.data?.blocks ?? null} loading={bloques.loading} error={bloques.error} onRetry={bloques.reload} recargar={recargar} onVer={setViendo} />
      ) : bloques.loading && !bloques.data ? (
        <Card><div className="space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div></Card>
      ) : (
        <Card>
          <MantenimientosLista
            reciboId={reciboId}
            estructuraId={block && block !== 'sin' ? Number(block) : undefined}
            sinBlock={block === 'sin'}
            estado={estado}
            q={qFinal}
            mostrarBlock={agrupado}
            recargar={recargar}
            onVer={setViendo}
          />
        </Card>
      )}

      {viendo && (
        <MantenimientoAdminModal
          reciboId={viendo.recibo_id}
          unidadId={viendo.unidad_id}
          onClose={() => setViendo(null)}
          onCambio={() => { setRecargar(n => n + 1); void periodoDb.reload(); void bloques.reload(); }}
        />
      )}
    </>
  );
}
