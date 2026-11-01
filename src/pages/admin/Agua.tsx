import { useEffect, useState } from 'react';
import { useList, useResource } from '../../api';
import { useCondominio, useTorreElegida } from '../../app/condominio';
import { Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, periodo } from '../../ui';
import { AguaRecibo } from './_parts/agua/AguaRecibo';

interface Periodo { id: number; mes: number; anio: number; complejo?: { id: number; nombre: string } | null; estructura?: { id: number; nombre: string | null } | null }

/**
 * Lecturas de agua de la administración: elige el recibo (del condominio de la barra de arriba) y carga la lectura de cada departamento, la foto
 * del contómetro y la fecha de corte. Es la misma sección que la pestaña «Agua y datos del recibo» del detalle del recibo, con su propia entrada en el menú.
 */
export default function AdminAgua() {
  const { complejo } = useCondominio();
  const periodos = useList<Periodo>('/api/recibos/periodos', { pageSize: 100, params: { complejo_id: complejo || undefined } });
  const [reciboId, setReciboId] = useState<number | null>(null);
  const [torre, setTorre] = useTorreElegida();
  const torres = useResource<{ items: { id: number; nombre: string | null }[] }>(complejo ? `/api/estructuras?complejo_id=${complejo}&pageSize=100` : null);
  const blocks = torres.data?.items ?? [];
  // Un recibo de un block sólo sale con su block (o con «Todos»); los recibos del condominio entero salen siempre: el filtro acota sus filas.
  const visibles = torre ? periodos.items.filter(p => !p.estructura || String(p.estructura.id) === torre) : periodos.items;
  // Al cambiar de condominio o de block (o al cargar), se elige el recibo más reciente de la lista.
  useEffect(() => { setReciboId(null); }, [complejo, torre]);
  useEffect(() => { if (reciboId === null && visibles[0]) setReciboId(visibles[0].id); }, [visibles, reciboId]);
  const varios = new Set(periodos.items.map(p => p.complejo?.id)).size > 1;

  return (
    <>
      <PageHeader title="Lecturas de agua" description="Elige el recibo y carga la lectura de cada departamento, la foto del contómetro y la fecha de corte: salen en el recibo de cada vecino." />
      {periodos.error ? (
        <Card><ErrorState message={periodos.error} onRetry={periodos.reload} /></Card>
      ) : periodos.loading && periodos.items.length === 0 ? (
        <Card><div className="space-y-3 p-5"><Skeleton className="h-10 w-64" /><Skeleton className="h-40 w-full" /></div></Card>
      ) : periodos.items.length === 0 ? (
        <Card><EmptyState title="Aún no hay recibos" description="Cuando emitas el recibo del mes, aquí cargas las lecturas de agua de cada departamento." /></Card>
      ) : (
        <>
          <div className="mb-4 grid max-w-2xl gap-3 sm:grid-cols-2">
            {blocks.length > 1 && (
              <Select label="Block" value={torre} onChange={e => setTorre(e.target.value)}>
                <option value="">Todos los blocks</option>
                {blocks.map(b => <option key={b.id} value={b.id}>{b.nombre ?? `Block ${b.id}`}</option>)}
              </Select>
            )}
            <Select label="Recibo" value={reciboId ?? ''} onChange={e => setReciboId(Number(e.target.value))}>
              {visibles.map(p => <option key={p.id} value={p.id}>{periodo(p.mes, p.anio)}{p.estructura?.nombre ? ` · ${p.estructura.nombre}` : ''}{varios && p.complejo ? ` · ${p.complejo.nombre}` : ''}</option>)}
            </Select>
          </div>
          {reciboId !== null && <AguaRecibo key={reciboId} reciboId={reciboId} torre={torre} />}
        </>
      )}
    </>
  );
}
