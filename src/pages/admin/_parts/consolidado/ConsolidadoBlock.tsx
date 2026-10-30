import { useState } from 'react';
import { ArrowDownTrayIcon, PrinterIcon, TableCellsIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../../../api';
import { Button, Card, EmptyState, ErrorState, Select, Skeleton } from '../../../../ui';
import { ZonaImprimible } from '../../../shared/mantenimiento/ZonaImprimible';
import { HojaConsolidado } from './HojaConsolidado';
import type { Consolidado } from './tipos';
import { useImprimir } from './useImprimir';

/** Blocks de un recibo que cobra a varios (viejo o sin torre): se elige UNO para ver su consolidado. */
export interface BlockElegible { id: number; nombre: string }

/**
 * «Consolidado del block»: la tabla con TODOS los departamentos del block (un concepto por columna, TOTAL MANT, DEUDA ACUMULADA y TOTAL) que la
 * administradora imprime en la cara de atrás de cada recibo. En pantalla es una tabla ancha con desplazamiento horizontal; «Imprimir» la saca en una hoja A4
 * horizontal y «Descargar Excel» da el mismo formato del Excel que se sube (se puede volver a subir). Sólo para administración y junta: nunca en las pantallas de residentes.
 */
export function ConsolidadoBlock({ reciboId, bloques }: { reciboId: number; bloques?: BlockElegible[] }) {
  const [torre, setTorre] = useState('');
  const filtro = torre ? `?estructura_id=${torre}` : '';
  const { data: c, loading, error, reload } = useResource<Consolidado>(`/api/recibos/${reciboId}/consolidado${filtro}`);
  const { imprimiendo, imprimir } = useImprimir();

  const elegir = bloques && bloques.length > 1 && (
    <Select label="Block" className="w-full sm:w-48 [&_label]:sr-only" value={torre} onChange={e => setTorre(e.target.value)}>
      <option value="">Todos los blocks</option>
      {bloques.map(b => <option key={b.id} value={b.id}>{b.nombre}</option>)}
    </Select>
  );
  if (error) return <Card>{elegir && <div className="border-b border-line px-5 py-3">{elegir}</div>}<ErrorState message={error} onRetry={reload} /></Card>;
  if (!c) return <Card><div className="space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></div></Card>;
  if (c.filas.length === 0) return <Card>{elegir && <div className="border-b border-line px-5 py-3">{elegir}</div>}<EmptyState icon={<TableCellsIcon />} title="Este recibo no tiene departamentos" description="Cuando el recibo cobre a algún departamento, aquí verás la tabla del block." /></Card>;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="text-sm text-muted">{c.filas.length} departamentos · una columna por concepto. Es la hoja que va por detrás de cada recibo.</p>
        <div className="flex flex-wrap items-center gap-2">
          {elegir}
          <Button variant="secondary" icon={<ArrowDownTrayIcon className="h-4 w-4" />} onClick={() => window.location.assign(`/api/recibos/${reciboId}/consolidado/excel${filtro}`)}>Descargar Excel</Button>
          <Button icon={<PrinterIcon className="h-4 w-4" />} onClick={imprimir}>Imprimir</Button>
        </div>
      </div>
      <div className={loading ? 'overflow-x-auto opacity-60' : 'overflow-x-auto'} aria-busy={loading} tabIndex={0} role="region" aria-label="Consolidado del block (desplázate en horizontal para ver todas las columnas)">
        <HojaConsolidado c={c} />
      </div>
      {imprimiendo && <ZonaImprimible><HojaConsolidado c={c} impresion /></ZonaImprimible>}
    </Card>
  );
}
