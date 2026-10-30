import { useState } from 'react';
import { PrinterIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../../../api';
import { Alert, Button, ErrorState, Modal, Select, Skeleton } from '../../../../ui';
import type { BlockElegible } from './ConsolidadoBlock';
import { ZonaImprimible } from '../../../shared/mantenimiento/ZonaImprimible';
import { DocumentoBlock } from './DocumentoBlock';
import type { ImpresionBlock } from './tipos';

/** «Imprimir recibos del block»: un solo documento, recibo y consolidado por departamento, para imprimirlo a doble cara. */
export function ImprimirRecibosBlock({ reciboId, titulo, bloques, onClose }: { reciboId: number; titulo: string; /** Sólo en un recibo que cobra a varios blocks: hay que elegir uno. */ bloques?: BlockElegible[]; onClose: () => void }) {
  const [torre, setTorre] = useState('');
  const porElegir = Boolean(bloques && bloques.length > 1 && !torre);
  const { data: b, loading, error, reload } = useResource<ImpresionBlock>(porElegir ? null : `/api/recibos/${reciboId}/consolidado/impresion${torre ? `?estructura_id=${torre}` : ''}`);
  const n = b?.recibos.length ?? 0;
  return (
    <Modal
      open
      onClose={onClose}
      title="Imprimir recibos del block"
      description={titulo}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cerrar</Button>
          <Button icon={<PrinterIcon className="h-4 w-4" />} disabled={!b || n === 0} onClick={() => window.print()}>Imprimir</Button>
        </>
      }
    >
      {bloques && bloques.length > 1 && (
        <Select label="Block" className="mb-4" value={torre} onChange={e => setTorre(e.target.value)}>
          <option value="" disabled>Elige el block…</option>
          {bloques.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </Select>
      )}
      {porElegir ? (
        <p className="text-sm text-muted">Este recibo cobra a varios blocks: elige de cuál imprimir los recibos.</p>
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : loading || !b ? (
        <div className="space-y-3" aria-busy="true"><p className="text-sm text-muted">Preparando los recibos del block…</p><Skeleton className="h-10 w-full" /></div>
      ) : n === 0 ? (
        <Alert tone="info">Este recibo no tiene departamentos con cargos para imprimir.</Alert>
      ) : (
        <div className="space-y-3 text-sm">
          <p><strong>{n} {n === 1 ? 'recibo' : 'recibos'}</strong>, cada uno seguido del consolidado del block: {n * 2} hojas en total. Ordenados por departamento.</p>
          <p className="text-muted">Imprímelo a doble cara: el recibo va por delante y el consolidado (con el departamento resaltado) por detrás. Los recibos salen en A4 vertical y el consolidado en A4 horizontal.</p>
          <Alert tone="warn">El consolidado muestra el nombre, el monto y la deuda de todos los vecinos del block. Entrega cada hoja sólo a quien corresponda.</Alert>
        </div>
      )}
      {b && n > 0 && <ZonaImprimible><DocumentoBlock b={b} /></ZonaImprimible>}
    </Modal>
  );
}
