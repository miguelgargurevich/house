import { PrinterIcon } from '@heroicons/react/24/outline';
import { Button, Modal, StatusBadge, fechaCorta, periodo, soles } from '../../../ui';
import type { DetalleMantenimiento, MedioPagoMant } from './tipos';

// Al imprimir sólo se ve el recibo (el resto de la página se oculta) y el papel va sin sombras ni fondos.
const PRINT_CSS = '@media print{body *{visibility:hidden}#recibo-imprimible,#recibo-imprimible *{visibility:visible}#recibo-imprimible{position:absolute;left:0;top:0;width:100%;padding:0}@page{margin:16mm}}';

function lineaMedio(m: MedioPagoMant): string {
  const entidad = m.entidad ?? m.banco ?? 'Banco';
  if (m.tipo === 'banco') return `${entidad} · cuenta ${m.tipo_cuenta === 'corriente' ? 'corriente' : 'de ahorros'} en ${m.moneda_nombre.toLowerCase()} ${m.numero_cuenta ?? ''}${m.cci ? ` · CCI ${m.cci}` : ''} · a nombre de ${m.titular}`;
  if (m.tipo === 'recaudacion') return `${m.instruccion ?? `Pago de servicios en ${entidad}`} · a nombre de ${m.titular}`;
  return `${m.tipo === 'yape' ? 'Yape' : 'Plin'} ${m.celular ?? ''} · a nombre de ${m.titular}`;
}

/** «Recibo de mantenimiento» imprimible: condominio, empresa administradora, departamento, conceptos, total, estado y medios de pago del block. */
export function ReciboImprimible({ detalle: d, onClose }: { detalle: DetalleMantenimiento; onClose: () => void }) {
  const block = d.unidad.estructura?.nombre;
  const residente = d.inquilino ? `${d.inquilino.nombre} (inquilino)` : d.propietario?.nombre;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Recibo de mantenimiento"
      description={d.titulo}
      footer={<><Button variant="secondary" onClick={onClose}>Cerrar</Button><Button icon={<PrinterIcon className="h-4 w-4" />} onClick={() => window.print()}>Imprimir</Button></>}
    >
      <article id="recibo-imprimible" aria-label={`Recibo de mantenimiento ${d.numero}`} className="space-y-6 text-ink">
        <style>{PRINT_CSS}</style>
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">Recibo de mantenimiento</h2>
            <p className="mt-1 text-sm text-muted">{periodo(d.mes, d.anio)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted">N.º de recibo</p>
            <p className="num text-lg font-semibold">{d.numero}</p>
            <div className="mt-1"><StatusBadge estado={d.estado} /></div>
          </div>
        </header>

        <section className="grid gap-4 text-sm sm:grid-cols-2" aria-label="Datos del recibo">
          <div>
            <p className="text-xs text-muted">Condominio</p>
            <p className="font-medium">{d.condominio?.nombre ?? '—'}</p>
            {d.condominio?.direccion && <p className="text-muted">{d.condominio.direccion}</p>}
          </div>
          <div>
            <p className="text-xs text-muted">Empresa administradora</p>
            <p className="font-medium">{d.empresa?.nombre ?? '—'}</p>
            {d.empresa?.ruc && <p className="text-muted">RUC <span className="num">{d.empresa.ruc}</span></p>}
            {d.empresa?.direccion && <p className="text-muted">{d.empresa.direccion}</p>}
            {(d.empresa?.telefono || d.empresa?.email) && <p className="text-muted">{[d.empresa.telefono, d.empresa.email].filter(Boolean).join(' · ')}</p>}
          </div>
          <div>
            <p className="text-xs text-muted">Departamento</p>
            <p className="font-medium"><span className="num">{d.unidad.codigo}</span>{block ? ` · ${block}` : ''}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Propietario</p>
            <p className="font-medium">{d.propietario?.nombre ?? '—'}</p>
            {d.inquilino && <p className="text-muted">Habita: {residente}</p>}
          </div>
          <div>
            <p className="text-xs text-muted">Emisión</p>
            <p className="font-medium">{fechaCorta(d.fecha_emision)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Vencimiento</p>
            <p className="font-medium">{fechaCorta(d.fecha_vencimiento)}</p>
          </div>
        </section>

        <section aria-label="Detalle de conceptos">
          <table className="w-full text-sm">
            <caption className="sr-only">Conceptos del mantenimiento de {periodo(d.mes, d.anio)}</caption>
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="py-2 font-medium">Concepto</th>
                <th scope="col" className="py-2 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.conceptos.map(c => (
                <tr key={c.cargo_id}>
                  <td className="py-2">{c.concepto}{c.es_recargo && <span className="text-muted"> (recargo)</span>}</td>
                  <td className="num py-2 text-right">{soles(c.monto)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-semibold"><th scope="row" className="py-2 text-left">Total</th><td className="num py-2 text-right">{soles(d.total)}</td></tr>
              {Number(d.cobrado) > 0 && <tr><th scope="row" className="py-1 text-left font-normal text-muted">Pagado</th><td className="num py-1 text-right">{soles(d.cobrado)}</td></tr>}
              {Number(d.en_revision) > 0 && <tr><th scope="row" className="py-1 text-left font-normal text-muted">En revisión</th><td className="num py-1 text-right">{soles(d.en_revision)}</td></tr>}
              <tr className="font-semibold"><th scope="row" className="py-1 text-left">Saldo por pagar</th><td className="num py-1 text-right">{soles(d.saldo)}</td></tr>
            </tfoot>
          </table>
        </section>

        <section aria-label="Medios de pago" className="text-sm">
          <h3 className="mb-1 font-semibold">Dónde pagar</h3>
          {d.medios_pago.length === 0 ? (
            <p className="text-muted">Consulta los medios de pago con la junta o la administración.</p>
          ) : (
            <ul className="list-disc space-y-1 pl-5">
              {d.medios_pago.map(m => <li key={m.id}>{lineaMedio(m)}</li>)}
            </ul>
          )}
          <p className="mt-2 text-muted">Indica tu departamento <span className="num font-medium text-ink">{d.unidad.codigo}</span> como referencia.</p>
        </section>
      </article>
    </Modal>
  );
}
