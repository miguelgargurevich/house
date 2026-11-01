import { useEffect, useState } from 'react';
import { useList } from '../../api';
import { useCondominio } from '../../app/condominio';
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
  // Al cambiar de condominio (o al cargar), se elige el recibo más reciente de la lista.
  useEffect(() => { setReciboId(null); }, [complejo]);
  useEffect(() => { if (reciboId === null && periodos.items[0]) setReciboId(periodos.items[0].id); }, [periodos.items, reciboId]);
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
          <div className="mb-4 max-w-md">
            <Select label="Recibo" value={reciboId ?? ''} onChange={e => setReciboId(Number(e.target.value))}>
              {periodos.items.map(p => <option key={p.id} value={p.id}>{periodo(p.mes, p.anio)}{p.estructura?.nombre ? ` · ${p.estructura.nombre}` : ''}{varios && p.complejo ? ` · ${p.complejo.nombre}` : ''}</option>)}
            </Select>
          </div>
          {reciboId !== null && <AguaRecibo key={reciboId} reciboId={reciboId} />}
        </>
      )}
    </>
  );
}
