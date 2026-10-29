import { PrinterIcon } from '@heroicons/react/24/outline';
import type { ReactNode } from 'react';
import { simboloDe } from '../../../lib/paises';
import { Button, Modal, cx, fechaCorta, nombreDelMes } from '../../../ui';
import { fechaLarga, fechaNumerica, lineasDeNotas, monto2 } from './formato';
import { ImagenRecibo } from './ImagenRecibo';
import { cuentaBancaria } from './tipos';
import type { DetalleMantenimiento, MedioPagoMant } from './tipos';
import { ZonaImprimible } from './ZonaImprimible';

// El recibo es una HOJA: fondo blanco y tinta oscura fijos (también en modo oscuro), como el impreso de la administradora.
const linea = 'border border-neutral-700';
const gris = 'bg-neutral-200 [-webkit-print-color-adjust:exact] [print-color-adjust:exact]';

/** Un renglón «ETIQUETA ........ valor» de las cajas de cuenta. */
function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 px-1.5 py-0.5 sm:grid-cols-[5rem_1fr]">
      <span className="uppercase">{etiqueta}</span>
      <span className="num break-all uppercase">{valor}</span>
    </div>
  );
}

/** Caja con título gris centrado, como «CUENTA DE AHORROS BCP» o «FECHA DE VENCIMIENTO». */
function Caja({ titulo, children, className }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('break-inside-avoid', linea, className)}>
      <p className={cx('border-b border-neutral-700 px-1.5 py-0.5 text-center font-bold uppercase', gris)}>{titulo}</p>
      {children}
    </div>
  );
}

function CajaMedio({ m, correo }: { m: MedioPagoMant; correo: string | null }) {
  const entidad = m.entidad ?? m.banco ?? 'Banco';
  if (m.tipo === 'banco') {
    return (
      <Caja titulo={`Cuenta ${m.tipo_cuenta === 'corriente' ? 'corriente' : 'de ahorros'} ${entidad}${m.moneda === 'USD' ? ` en ${m.moneda_nombre.toLowerCase()}` : ''}`}>
        {m.numero_cuenta && <Fila etiqueta="Nro. cta:" valor={m.numero_cuenta} />}
        {m.cci && <Fila etiqueta="CCI:" valor={m.cci} />}
        <Fila etiqueta="Nombre:" valor={m.titular} />
        {correo && <Fila etiqueta="Correo:" valor={correo} />}
      </Caja>
    );
  }
  if (m.tipo === 'recaudacion') {
    return (
      <Caja titulo={`Pago de servicios · ${entidad}`}>
        {m.instruccion && <p className="px-1.5 py-0.5">{m.instruccion}</p>}
        <Fila etiqueta="Nombre:" valor={m.titular} />
      </Caja>
    );
  }
  return (
    <Caja titulo={m.tipo === 'yape' ? 'Yape' : 'Plin'}>
      {m.celular && <Fila etiqueta="Celular:" valor={m.celular} />}
      <Fila etiqueta="Nombre:" valor={m.titular} />
      {correo && <Fila etiqueta="Correo:" valor={correo} />}
    </Caja>
  );
}

/** Tabla de conceptos con bordes, como la primera cara del impreso: concepto | monto (con el símbolo de la moneda), total del mantenimiento, deuda acumulada y total. */
function TablaConceptos({ d }: { d: DetalleMantenimiento }) {
  const simbolo = simboloDe(d.moneda);
  const fila = 'px-1.5 py-0.5 align-top print:py-[1px]';
  return (
    <table className={cx('w-full border-collapse', linea)}>
      <caption className="sr-only">Conceptos del mantenimiento</caption>
      <thead>
        <tr className={gris}>
          <th scope="col" className={cx(linea, 'px-1.5 py-0.5 text-center font-medium')}>CONCEPTO</th>
          <th scope="col" className={cx(linea, 'w-24 px-1.5 py-0.5 text-center font-medium sm:w-32')}>MONTO {simbolo}</th>
        </tr>
      </thead>
      <tbody>
        {d.conceptos.map(c => (
          <tr key={c.cargo_id}>
            <td className={cx(linea, fila, 'uppercase')}>{c.concepto}{c.es_recargo && <span> (recargo)</span>}{c.motivo && <span className="block text-[0.9em] normal-case text-neutral-600">{c.motivo}</span>}</td>
            <td className={cx(linea, fila, 'num text-right')}>{monto2(c.monto, d.moneda)}</td>
          </tr>
        ))}
        {d.linea_mora && (
          <tr>
            <td className={cx(linea, fila, 'uppercase')}>{d.linea_mora}</td>
            <td className={cx(linea, fila, 'num text-right')}>0.00</td>
          </tr>
        )}
        <tr className={cx('font-bold', gris)}>
          <th scope="row" className={cx(linea, fila, 'text-center')}>TOTAL MANTENIMIENTO</th>
          <td className={cx(linea, fila, 'num text-right')}>{monto2(d.total, d.moneda)}</td>
        </tr>
        <tr>
          <th scope="row" className={cx(linea, fila, 'text-left font-normal')}>DEUDA ACUMULADA Y/O SALDO A FAVOR</th>
          <td className={cx(linea, fila, 'num text-right')}>{monto2(d.deuda_acumulada, d.moneda)}</td>
        </tr>
        <tr className={cx('text-[1.1em] font-bold', gris)}>
          <th scope="row" className={cx(linea, fila, 'text-center')}>TOTAL</th>
          <td className={cx(linea, fila, 'num text-right')}>{monto2(d.total_general, d.moneda)}</td>
        </tr>
      </tbody>
      {(Number(d.cobrado) > 0 || Number(d.en_revision) > 0) && (
        <tfoot>
          {Number(d.cobrado) > 0 && <tr><th scope="row" className={cx(linea, fila, 'text-left font-normal')}>PAGADO (ESTE MANTENIMIENTO)</th><td className={cx(linea, fila, 'num text-right')}>{monto2(d.cobrado, d.moneda)}</td></tr>}
          {Number(d.en_revision) > 0 && <tr><th scope="row" className={cx(linea, fila, 'text-left font-normal')}>EN REVISIÓN</th><td className={cx(linea, fila, 'num text-right')}>{monto2(d.en_revision, d.moneda)}</td></tr>}
          <tr className="font-bold"><th scope="row" className={cx(linea, fila, 'text-left')}>SALDO POR PAGAR (ESTE MANTENIMIENTO)</th><td className={cx(linea, fila, 'num text-right')}>{monto2(d.saldo, d.moneda)}</td></tr>
        </tfoot>
      )}
    </table>
  );
}

/** «Lectura de contómetro» (foto) y «Detalle del consumo de agua». Sin lectura no sale; sin foto, el detalle ocupa todo el ancho. */
function BloqueAgua({ d }: { d: DetalleMantenimiento }) {
  const a = d.agua;
  const simbolo = simboloDe(d.moneda);
  if (!a) return null;
  const celda = cx(linea, 'px-1 py-0.5 text-center');
  return (
    <section aria-label="Consumo de agua" className={cx('grid break-inside-avoid', linea, a.foto_url ? 'sm:grid-cols-2' : '')}>
      {a.foto_url && (
        <div className="border-b border-neutral-700 sm:border-b-0 sm:border-r">
          <p className="border-b border-neutral-700 px-1.5 py-0.5 text-center font-bold">LECTURA DE CONTÓMETRO</p>
          <div className="flex items-center justify-center p-2">
            <ImagenRecibo src={a.foto_url} alt={`Foto del contómetro del departamento ${d.unidad.codigo}`} className="max-h-40 w-auto max-w-full object-contain sm:max-h-36 print:max-h-28" />
          </div>
        </div>
      )}
      <div>
        <p className="border-b border-neutral-700 px-1.5 py-0.5 text-center font-bold">DETALLE DEL CONSUMO DE AGUA</p>
        <div className="p-2">
          <table className="w-full border-collapse text-[0.95em]">
            <caption className="sr-only">Detalle del consumo de agua</caption>
            <tbody>
              <tr>
                <td className={celda}>{fechaNumerica(a.fecha_anterior)}</td>
                <td className={celda}>{fechaNumerica(a.fecha_actual)}</td>
                <td colSpan={3} />
              </tr>
              <tr>
                <th scope="col" className={cx(celda, 'font-normal')}>Lect. Ant.</th>
                <th scope="col" className={cx(celda, 'font-normal')}>Lect. Actual</th>
                <th scope="col" className={cx(celda, 'font-normal')}>consumo m3</th>
                <th scope="col" className={cx(celda, 'font-normal')}>factor</th>
                <th scope="col" className={cx(celda, 'font-normal')}>consumo {simbolo}</th>
              </tr>
              <tr className="num">
                <td className={celda}>{a.lectura_anterior}</td>
                <td className={celda}>{a.lectura_actual}</td>
                <td className={celda}>{a.consumo_m3}</td>
                <td className={celda}>{Number(a.factor).toString()}</td>
                <td className={celda}>{monto2(a.monto, d.moneda)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** El recibo en sí (sin marco de modal): se muestra en pantalla y se repite en la zona de impresión. Orden y bloques como la primera cara del impreso. */
export function ReciboArticulo({ d }: { d: DetalleMantenimiento }) {
  const c = d.condominio;
  const block = d.unidad.estructura?.nombre;
  const mes = nombreDelMes(d.mes);
  const cuenta = cuentaBancaria(d.medios_pago);
  const delBlock = d.medios_pago.filter(m => m.ambito === 'block');
  const delCondominio = d.medios_pago.filter(m => m.ambito !== 'block');
  const dosGrupos = delBlock.length > 0 && delCondominio.length > 0;
  const notas = lineasDeNotas(c?.notas_pago);
  const contacto = [
    c?.admin_nombre ? `ADMINISTRACIÓN: ${c.admin_nombre}` : null,
    c?.admin_celular ? `CELULAR DE ADMINISTRACIÓN: ${c.admin_celular}` : null,
    c?.admin_correo ? `CORREO ELECTRÓNICO ADM: ${c.admin_correo}` : null,
  ].filter((x): x is string => x !== null);
  const hayCajas = d.medios_pago.length > 0;

  return (
    <article aria-label={`Recibo de mantenimiento ${d.numero}`} className="mx-auto w-full max-w-[44rem] space-y-3 bg-white p-3 text-[11px] leading-snug text-neutral-900 sm:p-4 sm:text-xs print:max-w-none print:space-y-1.5 print:p-0 print:text-[10px]">
      <header className={cx('grid gap-3 print:gap-2', c?.cabecera_url ? 'sm:grid-cols-[2fr_3fr]' : '')}>
        {c?.cabecera_url && (
          <div className={cx('overflow-hidden', linea)}>
            <ImagenRecibo src={c.cabecera_url} alt={`Foto de ${c.nombre}`} className="h-32 w-full object-cover sm:h-full sm:max-h-40 print:max-h-32" />
          </div>
        )}
        <div className="text-center">
          <h2 className="text-base font-bold uppercase leading-tight sm:text-lg">{c?.nombre ?? d.empresa?.nombre ?? 'Condominio'}</h2>
          {c?.direccion && <p className="mt-1 uppercase">{c.direccion}</p>}
          <p className="mt-3 text-sm font-bold uppercase sm:text-base print:mt-2">Recibo de mantenimiento mensual</p>
          <dl className="mt-2 grid grid-cols-[auto_1fr_auto_1fr] items-center gap-x-2 gap-y-1.5 text-left">
            <dt>AÑO:</dt><dd className={cx(linea, 'num px-1.5 py-0.5 text-center')}>{d.anio}</dd>
            <dt>MES:</dt><dd className={cx(linea, 'px-1.5 py-0.5 text-center capitalize')}>{mes}</dd>
            <dt className="col-span-2">FECHA DE EMISIÓN:</dt><dd className={cx(linea, 'num col-span-2 px-1.5 py-0.5 text-center')}>{fechaNumerica(d.fecha_emision)}</dd>
          </dl>
          <p className="mt-1 text-right text-[0.9em] text-neutral-600">N.º de recibo <span className="num">{d.numero}</span></p>
        </div>
      </header>

      <section aria-label="Propietario" className={cx('space-y-1.5 p-1.5', linea, gris)}>
        <p><span>Propietario (a):</span> <strong className="ml-1 uppercase">{d.propietario?.nombre ?? '—'}</strong></p>
        {d.inquilino && <p><span>Inquilino (a):</span> <strong className="ml-1 uppercase">{d.inquilino.nombre}</strong></p>}
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {block && <span>Block: <span className={cx('ml-1 inline-block min-w-16 bg-white px-1.5 py-0.5 text-center', linea)}>{block}</span></span>}
          <span>Dpto: <span className={cx('num ml-1 inline-block min-w-16 bg-white px-1.5 py-0.5 text-center', linea)}>{d.unidad.codigo}</span></span>
        </p>
      </section>

      <TablaConceptos d={d} />

      <BloqueAgua d={d} />

      {cuenta && (
        <p className={cx('px-1.5 py-1 text-center font-bold uppercase', linea)}>
          Cancelar únicamente en agentes {cuenta.entidad ?? cuenta.banco ?? 'del banco'} o a través de transferencia y enviar voucher de depósito
        </p>
      )}

      <div className={cx('grid items-start gap-3', hayCajas ? 'sm:grid-cols-[3fr_2fr]' : '')}>
        {hayCajas && (
          <div className="space-y-2">
            {dosGrupos && delBlock.length > 0 && <p className="font-bold uppercase">Cuentas de {block ?? 'la torre'}</p>}
            {delBlock.map(m => <CajaMedio key={m.id} m={m} correo={d.correo_vouchers} />)}
            {dosGrupos && <p className="font-bold uppercase">Cuentas del condominio{c ? ` ${c.nombre}` : ''}</p>}
            {delCondominio.map(m => <CajaMedio key={m.id} m={m} correo={delBlock.length === 0 ? d.correo_vouchers : null} />)}
          </div>
        )}
        <div className="space-y-2">
          <Caja titulo="Fecha de vencimiento"><p className="px-1.5 py-0.5 text-center font-medium">{fechaLarga(d.fecha_vencimiento)}</p></Caja>
          {d.fecha_corte_agua && <Caja titulo="Fecha corte de agua"><p className="px-1.5 py-0.5 text-center font-medium">{fechaLarga(d.fecha_corte_agua)}</p></Caja>}
        </div>
      </div>

      <ul className="space-y-0.5 pl-3 uppercase [list-style-type:'-_'] list-outside">
        {!hayCajas && <li className="normal-case">Consulta los medios de pago con la junta o la administración.</li>}
        <li>Indica tu departamento <span className="num">{d.unidad.codigo}</span> como referencia al pagar.</li>
        {notas.map((n, i) => <li key={i}>{n}</li>)}
        {contacto.map(x => <li key={x}>{x}</li>)}
      </ul>

      {(d.empresa?.logo_url || d.empresa?.nombre) && (
        <footer className="break-inside-avoid pt-1">
          {d.empresa.logo_url
            ? <ImagenRecibo src={d.empresa.logo_url} alt={`Logo de ${d.empresa.nombre}`} className="h-12 w-auto max-w-[14rem] object-contain object-left print:h-10" />
            : <p className="font-bold uppercase">{d.empresa.nombre}{d.empresa.ruc && <span className="num font-normal"> · RUC {d.empresa.ruc}</span>}</p>}
        </footer>
      )}
    </article>
  );
}

/** «Recibo de mantenimiento» imprimible, como la primera cara del impreso de la administradora: una hoja A4 con todo lo del mes y cómo pagarlo. */
export function ReciboImprimible({ detalle: d, onClose }: { detalle: DetalleMantenimiento; onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Recibo de mantenimiento"
      description={`${d.titulo} · vence el ${fechaCorta(d.fecha_vencimiento)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button icon={<PrinterIcon className="h-4 w-4" />} onClick={() => window.print()}>Imprimir</Button></>}
    >
      <ReciboArticulo d={d} />
      <ZonaImprimible><ReciboArticulo d={d} /></ZonaImprimible>
    </Modal>
  );
}
