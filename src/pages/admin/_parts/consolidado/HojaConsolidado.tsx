import { cx, nombreDelMes } from '../../../../ui';
import { fechaLarga, monto2 } from '../../../shared/mantenimiento/formato';
import { letraConsolidadoPt } from './escala';
import { blockCorto } from './formato';
import type { Consolidado } from './tipos';

// La hoja es BLANCA con tinta oscura también en modo oscuro (como el recibo): es lo que se imprime, igual que el Excel de la administradora.
const linea = 'border border-neutral-700';
const gris = 'bg-neutral-200 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]';

/**
 * La tabla del consolidado: BLOCK | Dpto. | Apellidos y Nombres | un concepto por columna | TOTAL MANT | DEUDA ACUMULADA | TOTAL, y una fila de TOTALES.
 * En pantalla se ensancha y se desplaza en horizontal; impresa (`impresion`) ocupa el ancho de la hoja y su letra se ajusta a la cantidad de filas.
 * `resaltar` marca (en gris) la fila de un departamento: la hoja que va por detrás de SU recibo.
 */
export function TablaConsolidado({ c, resaltar, impresion }: { c: Consolidado; resaltar?: number; impresion?: boolean }) {
  const celda = cx(linea, 'px-1 py-0.5 print:px-[2px] print:py-[0.15mm]');
  const monto = cx(celda, 'num whitespace-nowrap text-right');
  const m = (v: string) => monto2(v, c.moneda);
  const cabecera = cx(linea, gris, 'px-1 py-0.5 text-center align-middle font-bold uppercase leading-tight [overflow-wrap:anywhere] print:px-[2px] print:py-[0.15mm] print:text-[0.85em]');
  return (
    <table className={cx('border-collapse leading-[1.1]', impresion ? 'w-full table-fixed' : 'w-max min-w-full text-xs')} style={impresion ? { fontSize: `${letraConsolidadoPt(c.filas.length)}pt` } : undefined}>
      <caption className="sr-only">{`Consolidado de ${c.block ?? c.condominio} · ${nombreDelMes(c.mes)} de ${c.anio}`}</caption>
      {impresion && (
        <colgroup>
          <col style={{ width: '4.5%' }} /><col style={{ width: '4.5%' }} /><col style={{ width: '18%' }} />
          {c.conceptos.map(x => <col key={x.id} />)}
          <col style={{ width: '5.5%' }} /><col style={{ width: '5.5%' }} /><col style={{ width: '5.5%' }} />
        </colgroup>
      )}
      <thead>
        <tr>
          <th scope="col" rowSpan={2} className={cabecera}>BLOCK</th>
          <th scope="col" rowSpan={2} className={cabecera}>Dpto.</th>
          <th scope="col" rowSpan={2} className={cabecera}>Apellidos y Nombres</th>
          <th scope="colgroup" colSpan={c.conceptos.length + 3} className={cabecera}>Conceptos por cobrar</th>
        </tr>
        <tr>
          {c.conceptos.map(x => <th key={x.id} scope="col" className={cabecera}>{x.nombre}</th>)}
          <th scope="col" className={cabecera}>TOTAL MANT</th>
          <th scope="col" className={cabecera}>DEUDA ACUMULADA</th>
          <th scope="col" className={cabecera}>TOTAL</th>
        </tr>
      </thead>
      <tbody>
        {c.filas.map(f => (
          <tr key={f.unidad_id} className={cx('break-inside-avoid', f.unidad_id === resaltar && cx('font-bold', gris))}>
            <td className={cx(celda, 'whitespace-nowrap text-center')}>{blockCorto(f.block)}</td>
            <th scope="row" className={cx(celda, 'whitespace-nowrap text-center font-normal', f.unidad_id === resaltar && 'font-bold')}><span className="num">{f.dpto}</span></th>
            <td className={cx(celda, 'whitespace-nowrap uppercase print:overflow-hidden')}>{f.propietario}</td>
            {f.montos.map((v, i) => <td key={c.conceptos[i]!.id} className={monto}>{m(v)}</td>)}
            <td className={monto}>{m(f.total_mant)}</td>
            <td className={monto}>{m(f.deuda_acumulada)}</td>
            <td className={cx(monto, 'font-bold')}>{m(f.total)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className={cx('font-bold', gris)}>
          <th scope="row" colSpan={3} className={cx(celda, 'text-center')}>TOTALES</th>
          {c.totales.montos.map((v, i) => <td key={c.conceptos[i]!.id} className={monto}>{m(v)}</td>)}
          <td className={monto}>{m(c.totales.total_mant)}</td>
          <td className={monto}>{m(c.totales.deuda_acumulada)}</td>
          <td className={monto}>{m(c.totales.total)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/** La hoja del consolidado con su título (empresa, «MANTENIMIENTO DE OCTUBRE 2026», MES y VENCIMIENTO) como la del Excel. */
export function HojaConsolidado({ c, resaltar, impresion }: { c: Consolidado; resaltar?: number; impresion?: boolean }) {
  const mes = nombreDelMes(c.mes);
  return (
    <section aria-label="Consolidado del block" className={cx('hoja-consolidado bg-white text-[11px] leading-snug text-neutral-900', impresion ? 'print:text-[9pt]' : 'p-3')}>
      <header className="mb-2 space-y-0.5 print:mb-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="font-bold uppercase">{c.empresa ?? c.condominio}</p>
          <h2 className="text-center text-sm font-bold uppercase print:text-[11pt]">Mantenimiento de {mes} {c.anio}</h2>
          <p className="uppercase">{c.condominio}{c.block ? ` · ${c.block}` : ''}</p>
        </div>
        <p className="flex flex-wrap items-baseline gap-x-6">
          <span>MES <strong className="ml-1 capitalize">{mes}</strong></span>
          <span>VENCIMIENTO: <strong className="ml-1">{fechaLarga(c.fecha_vencimiento)}</strong></span>
        </p>
      </header>
      <TablaConsolidado c={c} resaltar={resaltar} impresion={impresion} />
    </section>
  );
}
