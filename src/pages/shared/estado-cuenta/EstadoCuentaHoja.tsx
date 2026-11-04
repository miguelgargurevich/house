import { simboloDe } from '../../../lib/paises';
import { cx, nombreDelMes } from '../../../ui';
import { fechaNumerica, monto2 } from '../mantenimiento/formato';
import { useMarca } from '../../../app/marca/contexto';
import { CabeceraMarca, PieConTorre } from '../mantenimiento/cabeceraMarca';
import { cabeceraDeDocumento } from '../mantenimiento/cabeceraDocumento';
import { ESTADO_MES, ESTADO_PAGO, type EstadoCuenta, type FilaEstadoCuenta } from './tipos';

// Como el recibo, el estado de cuenta es una HOJA: fondo blanco y tinta oscura fijos (también en modo oscuro) para que se vea y se imprima igual.
const linea = 'border border-neutral-700';
const gris = 'bg-neutral-200 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]';
const celda = 'px-1 py-0.5 align-top sm:px-1.5';

/** «Ene 2025» (setiembre, «Set»): corto para que las cinco columnas quepan en 390 px. */
const mesCorto = (mes: number, anio: number) => `${nombreDelMes(mes).charAt(0).toUpperCase()}${nombreDelMes(mes).slice(1, 3)} ${anio}`;

function Bloque({ f, moneda }: { f: FilaEstadoCuenta; moneda: string }) {
  const m = (v: string) => monto2(v, moneda);
  const conceptos = f.por_concepto.map(c => `${c.concepto}${c.es_mora ? ' (mora)' : ''} ${m(c.monto)}`).join(' · ');
  return (
    <tbody className="break-inside-avoid">
      <tr>
        <th scope="row" className={cx(linea, celda, 'text-left font-medium')}>
          {mesCorto(f.mes, f.anio)}
          <span className={cx('block text-[0.9em] font-normal', f.estado === 'vencido' ? 'font-bold text-neutral-900' : 'text-neutral-600')}>{ESTADO_MES[f.estado]}</span>
        </th>
        <td className={cx(linea, celda, 'num text-right')}>{m(f.cargo)}</td>
        <td className={cx(linea, celda, 'num text-right')}>{m(f.pagado)}</td>
        <td className={cx(linea, celda, 'num text-right')}>{m(f.saldo)}</td>
        <td className={cx(linea, celda, 'num text-right font-bold')}>{m(f.saldo_acumulado)}</td>
      </tr>
      <tr>
        <td colSpan={5} className={cx(linea, celda, 'break-words text-[0.95em] text-neutral-700')}>
          <p>{conceptos}</p>
          <p>Vence el {fechaNumerica(f.fecha_vencimiento)}{Number(f.en_revision) > 0 && <> · En revisión: <span className="num">{m(f.en_revision)}</span> (aún no resta)</>}</p>
          {f.pagos.length > 0 && (
            <ul className="mt-0.5 space-y-0.5">
              {f.pagos.map((p, i) => (
                <li key={`${p.id ?? 'sd'}-${i}`} className={cx((p.estado === 'rechazado' || p.estado === 'anulado') && 'text-neutral-500')}>
                  <span className="num">{p.fecha ? fechaNumerica(p.fecha) : 'Sin fecha'}</span>
                  {p.operacion && <> · Op. <span className="num">{p.operacion}</span></>}
                  {p.sin_detalle && <> · Registrado sin voucher</>}
                  {' · '}<span className="num">{m(p.monto)}</span> · <span className="font-medium">{ESTADO_PAGO[p.estado]}</span>
                </li>
              ))}
            </ul>
          )}
        </td>
      </tr>
    </tbody>
  );
}

/** El estado de cuenta en sí (sin marco de modal): se muestra en pantalla y se repite en la zona de impresión. */
export function EstadoCuentaHoja({ e }: { e: EstadoCuenta }) {
  const t = e.totales;
  const s = simboloDe(e.moneda);
  const m = (v: string) => monto2(v, e.moneda);
  const periodo = e.desde && e.hasta ? `${mesCorto(Number(e.desde.slice(5)), Number(e.desde.slice(0, 4)))} a ${mesCorto(Number(e.hasta.slice(5)), Number(e.hasta.slice(0, 4)))}` : null;
  // El estado de cuenta no trae el id de la empresa, sólo su razón social: con ella se comprueba que la marca del usuario sea la de la administradora del documento.
  const cabecera = cabeceraDeDocumento(useMarca(), { razonSocial: e.administradora });
  return (
    <article aria-label={`Estado de cuenta del departamento ${e.unidad.codigo}`} className="mx-auto w-full max-w-[44rem] space-y-3 bg-white p-3 text-[11px] leading-snug text-neutral-900 sm:p-4 sm:text-xs print:max-w-none print:space-y-2 print:p-0 print:text-[10px]">
      <CabeceraMarca c={cabecera} />
      <header className="text-center">
        <h2 className="break-words text-base font-bold uppercase leading-tight sm:text-lg">{e.condominio?.nombre ?? 'Condominio'}</h2>
        {e.administradora && <p className="uppercase">Administra: {cabecera.nombre ?? e.administradora}</p>}
        <p className="mt-2 text-sm font-bold uppercase sm:text-base">Estado de cuenta</p>
        <p className="text-neutral-600">Al corte del <span className="num">{fechaNumerica(e.fecha_corte)}</span>{periodo && <> · {periodo}</>}</p>
      </header>

      <section aria-label="Departamento" className={cx('space-y-1 p-1.5', linea, gris)}>
        <p><span>Propietario (a):</span> <strong className="ml-1 break-words uppercase">{e.propietario ?? '—'}</strong></p>
        {e.inquilino && <p><span>Inquilino (a):</span> <strong className="ml-1 break-words uppercase">{e.inquilino}</strong></p>}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {e.estructura?.nombre && <span>Block: <strong className="ml-1">{e.estructura.nombre}</strong></span>}
          <span>Dpto: <strong className="num ml-1">{e.unidad.codigo}</strong></span>
        </p>
      </section>

      <dl aria-label="Resumen" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {[
          ['Total cargado', t.cargado, false],
          ['Total pagado', t.pagado, false],
          ['Saldo deudor', t.saldo_deudor, true],
          ['Meses vencidos', String(t.meses_vencidos), false],
        ].map(([k, v, fuerte]) => (
          <div key={String(k)} className={cx('min-w-0 px-1.5 py-1', linea, fuerte && gris)}>
            <dt>{k}</dt>
            <dd className={cx('num break-words text-[1.15em]', fuerte ? 'font-bold' : 'font-medium')}>{k === 'Meses vencidos' ? v : `${s} ${m(String(v))}`}</dd>
          </div>
        ))}
      </dl>

      {e.filas.length === 0 && Number(t.saldo_anterior) === 0 ? (
        <p className={cx('px-1.5 py-3 text-center', linea)}>Este departamento no tiene recibos en el periodo.</p>
      ) : (
        <table className={cx('w-full table-fixed border-collapse', linea)}>
          <caption className="sr-only">Cuenta corriente del departamento {e.unidad.codigo}</caption>
          <colgroup><col className="w-[22%]" /><col className="w-[18%]" /><col className="w-[17%]" /><col className="w-[17%]" /><col className="w-[26%]" /></colgroup>
          <thead>
            <tr className={gris}>
              <th scope="col" className={cx(linea, celda, 'text-left font-medium')}>Mes</th>
              <th scope="col" className={cx(linea, celda, 'text-right font-medium')}>Cargo {s}</th>
              <th scope="col" className={cx(linea, celda, 'text-right font-medium')}>Pagado {s}</th>
              <th scope="col" className={cx(linea, celda, 'text-right font-medium')}>Saldo {s}</th>
              <th scope="col" className={cx(linea, celda, 'text-right font-medium')}>Acumulado {s}</th>
            </tr>
          </thead>
          {Number(t.saldo_anterior) !== 0 && (
            <tbody>
              <tr>
                <th scope="row" colSpan={4} className={cx(linea, celda, 'text-left font-medium')}>Saldo anterior (recibos previos al periodo)</th>
                <td className={cx(linea, celda, 'num text-right font-bold')}>{m(t.saldo_anterior)}</td>
              </tr>
            </tbody>
          )}
          {e.filas.map(f => <Bloque key={f.recibo_id} f={f} moneda={e.moneda} />)}
          <tfoot>
            <tr className={cx('font-bold', gris)}>
              <th scope="row" className={cx(linea, celda, 'text-left')}>Total</th>
              <td className={cx(linea, celda, 'num text-right')}>{m(t.cargado)}</td>
              <td className={cx(linea, celda, 'num text-right')}>{m(t.pagado)}</td>
              <td className={cx(linea, celda)} />
              <td className={cx(linea, celda, 'num text-right')}>{m(t.saldo_deudor)}</td>
            </tr>
          </tfoot>
        </table>
      )}

      <ul className="space-y-0.5 pl-3 [list-style-type:'-_'] list-outside">
        <li>Saldo = lo que aún se puede pagar de cada mes. El acumulado suma mes a mes{Number(t.saldo_anterior) !== 0 ? ', desde el saldo anterior' : ''}.</li>
        <li>Los pagos «por validar» no restan hasta que la administración los valide{Number(t.en_revision) > 0 && <>: hoy hay <span className="num">{s} {m(t.en_revision)}</span> en revisión</>}.</li>
        {Number(t.mora) > 0 && <li>La mora (<span className="num">{s} {m(t.mora)}</span>) ya está incluida en el cargo del mes.</li>}
        {t.pagos_rechazados > 0 && <li>Los pagos rechazados se muestran pero no se cuentan.</li>}
        {t.pagos_anulados > 0 && <li>Los pagos anulados por la administración se muestran pero no se cuentan.</li>}
      </ul>
      <footer className="break-inside-avoid pt-1"><PieConTorre /></footer>
    </article>
  );
}
