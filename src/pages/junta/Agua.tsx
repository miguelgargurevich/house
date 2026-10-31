import { useEffect, useState } from 'react';
import { useList } from '../../api';
import { Card, EmptyState, ErrorState, PageHeader, Select, Skeleton, periodo } from '../../ui';
import { AguaRecibo } from '../admin/_parts/agua/AguaRecibo';

interface Periodo { id: number; mes: number; anio: number; estructura?: { id: number; nombre: string | null } | null }

/** Lecturas de agua del recibo de la torre de la junta (presidente o tesorero): la misma pantalla que ve la administración, acotada por la API. */
export default function JuntaAgua() {
  const periodos = useList<Periodo>('/api/recibos/periodos', { pageSize: 100 });
  const [reciboId, setReciboId] = useState<number | null>(null);
  useEffect(() => { if (reciboId === null && periodos.items[0]) setReciboId(periodos.items[0].id); }, [periodos.items, reciboId]);

  return (
    <>
      <PageHeader title="Lecturas de agua" description="Carga la lectura de cada departamento de tu block, la fecha de corte y el correo para enviar vouchers: salen en el recibo de cada vecino." />
      {periodos.error ? (
        <Card><ErrorState message={periodos.error} onRetry={periodos.reload} /></Card>
      ) : periodos.loading && periodos.items.length === 0 ? (
        <Card><div className="space-y-3 p-5"><Skeleton className="h-10 w-64" /><Skeleton className="h-40 w-full" /></div></Card>
      ) : periodos.items.length === 0 ? (
        <Card><EmptyState title="Aún no hay recibos" description="Cuando la administración emita el recibo de tu block, podrás cargar aquí las lecturas de agua." /></Card>
      ) : (
        <>
          <div className="mb-4 max-w-sm">
            <Select label="Recibo" value={reciboId ?? ''} onChange={e => setReciboId(Number(e.target.value))}>
              {periodos.items.map(p => <option key={p.id} value={p.id}>{periodo(p.mes, p.anio)}{p.estructura?.nombre ? ` · ${p.estructura.nombre}` : ''}</option>)}
            </Select>
          </div>
          {reciboId !== null && <AguaRecibo key={reciboId} reciboId={reciboId} />}
        </>
      )}
    </>
  );
}
