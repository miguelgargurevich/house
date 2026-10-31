import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeftIcon, MegaphoneIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../api';
import { Button, Card, ErrorState, PageHeader, SearchBox, Select, Skeleton, StatStrip, StatusBadge, TabPanel, Tabs, Toolbar, dinero, fechaCorta, tituloRecibo } from '../../ui';
import { AguaRecibo } from './_parts/agua/AguaRecibo';
import { ConsolidadoBlock } from './_parts/consolidado/ConsolidadoBlock';
import { ImprimirRecibosBlock } from './_parts/consolidado/ImprimirRecibosBlock';
import { AvisarVecinosModal } from './_parts/recibos/AvisarVecinosModal';
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
  /** Moneda del condominio del recibo: las cifras del periodo van en ella. */
  moneda?: string;
  complejo?: { id: number; nombre: string } | null;
  /** Torre del recibo: cada torre tiene el suyo. Sin torre = condominio sin torres, recibo general o recibo viejo que mezcla torres. */
  estructura?: { id: number; nombre: string | null } | null;
  totales?: { monto: string; cobrado: string; pendiente: string; en_revision: string };
  estado_cobranza?: string;
}

function useDebounced<T>(valor: T, ms = 300): T {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

/**
 * Un periodo. Un recibo de TORRE va directo a sus departamentos (sin selector ni vista agrupada: todo es de esa torre y las cifras son suyas);
 * un recibo viejo que mezcla torres sigue agrupado por torre.
 */
export default function PeriodoRecibo() {
  const { id } = useParams();
  const reciboId = Number(id);
  const periodoDb = useResource<Periodo>(`/api/recibos/${reciboId}?sin_cargos=1`);
  const bloques = useResource<{ agrupado: boolean; blocks: BlockResumen[] }>(`/api/recibos/${reciboId}/blocks`);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const [block, setBlock] = useState('');
  const [vista, setVista] = useState<'departamentos' | 'consolidado' | 'agua'>('departamentos');
  const [viendo, setViendo] = useState<Mantenimiento | null>(null);
  const [recargar, setRecargar] = useState(0);
  const [avisando, setAvisando] = useState(false);
  const [imprimiendo, setImprimiendo] = useState(false);
  const qFinal = useDebounced(q.trim());

  const p = periodoDb.data;
  const titulo = p ? tituloRecibo(p.mes, p.anio, p.estructura ? p.estructura.nombre ?? `Block ${p.estructura.id}` : null) : 'Periodo';
  const deTorre = Boolean(p?.estructura);
  const agrupado = !deTorre && (bloques.data?.agrupado ?? false);
  const filtrando = qFinal !== '' || estado !== '' || block !== '';
  const t = p?.totales;
  const pct = t && Number(t.monto) > 0 ? Math.round((Number(t.cobrado) / Number(t.monto)) * 1000) / 10 : 0;
  // Un recibo que cobra a varios blocks (viejo, o sin torre) pide elegir UNO para el consolidado y los recibos del block.
  const blocksElegibles = agrupado ? (bloques.data?.blocks ?? []).filter(b => b.estructura_id != null).map(b => ({ id: b.estructura_id as number, nombre: b.nombre })) : undefined;
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
            title={titulo}
            description={p ? `${p.complejo?.nombre ?? ''} · emitido el ${fechaCorta(p.fecha_emision)} · vence el ${fechaCorta(p.fecha_vencimiento)}` : undefined}
            actions={p ? <><StatusBadge estado={p.estado} /><Button variant="secondary" icon={<PrinterIcon className="h-4 w-4" />} onClick={() => setImprimiendo(true)}>Imprimir recibos del block</Button><Button variant="secondary" icon={<MegaphoneIcon className="h-4 w-4" />} onClick={() => setAvisando(true)}>Avisar a los vecinos</Button></> : undefined}
          />
          <StatStrip
            stats={[
              { label: 'Emitido', value: t ? dinero(t.monto, p?.moneda) : <Skeleton className="h-7 w-28" /> },
              { label: 'Cobrado', value: t ? dinero(t.cobrado, p?.moneda) : <Skeleton className="h-7 w-28" />, tone: 'ok', hint: t ? `${pct} %` : undefined },
              { label: 'Por cobrar', value: t ? dinero(t.pendiente, p?.moneda) : <Skeleton className="h-7 w-28" />, hint: t && Number(t.en_revision) > 0 ? `${dinero(t.en_revision, p?.moneda)} en revisión` : undefined },
              { label: 'Departamentos morosos', value: morosos === undefined ? <Skeleton className="h-7 w-10" /> : morosos, tone: morosos ? 'bad' : undefined },
            ]}
          />
        </>
      )}

      <div className="mb-4">
        <Tabs value={vista} onChange={setVista} items={[{ id: 'departamentos', label: 'Departamentos' }, { id: 'consolidado', label: 'Consolidado del block' }, { id: 'agua', label: 'Agua y datos del recibo' }]} idBase="periodo-recibo" label="Secciones del periodo" />
      </div>

      <TabPanel idBase="periodo-recibo" id="consolidado" value={vista}>
        <ConsolidadoBlock reciboId={reciboId} bloques={blocksElegibles} />
      </TabPanel>

      <TabPanel idBase="periodo-recibo" id="agua" value={vista}>
        <AguaRecibo reciboId={reciboId} onCambio={() => void periodoDb.reload()} />
      </TabPanel>

      <TabPanel idBase="periodo-recibo" id="departamentos" value={vista}>
      <Card className="mb-4">
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Buscar departamento (ej. B01-804)" label="Buscar departamento" />
          {agrupado && (
            <Select label="Block" className="w-full sm:w-48 [&_label]:sr-only" value={block} onChange={e => setBlock(e.target.value)}>
              <option value="">Todos los blocks</option>
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
        <BloquesPeriodo reciboId={reciboId} moneda={p?.moneda} blocks={bloques.data?.blocks ?? null} loading={bloques.loading} error={bloques.error} onRetry={bloques.reload} recargar={recargar} onVer={setViendo} />
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
      </TabPanel>

      {avisando && <AvisarVecinosModal reciboId={reciboId} titulo={titulo} onClose={() => setAvisando(false)} />}
      {imprimiendo && <ImprimirRecibosBlock reciboId={reciboId} titulo={titulo} bloques={blocksElegibles} onClose={() => setImprimiendo(false)} />}

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
