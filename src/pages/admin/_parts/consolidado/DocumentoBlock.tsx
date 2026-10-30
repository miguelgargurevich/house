import { Fragment } from 'react';
import { ReciboArticulo } from '../../../shared/mantenimiento/ReciboImprimible';
import { HojaConsolidado } from './HojaConsolidado';
import type { ImpresionBlock } from './tipos';

/** Lo que se imprime: por departamento su recibo (el mismo de «Ver / imprimir recibo») y, en la página siguiente, el consolidado con su fila resaltada (la cara de atrás). */
export function DocumentoBlock({ b }: { b: ImpresionBlock }) {
  return (
    <>
      {b.recibos.map(r => (
        <Fragment key={r.unidad_id}>
          <section className="hoja-recibo"><ReciboArticulo d={r} /></section>
          <HojaConsolidado c={b.consolidado} resaltar={r.unidad_id} impresion />
        </Fragment>
      ))}
    </>
  );
}
