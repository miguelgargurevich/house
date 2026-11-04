import type { ReactNode } from 'react';
import { dinero, fechaCorta } from '../../../../ui';
import { useMarca } from '../../../../app/marca/contexto';
import { CabeceraMarca } from '../../../shared/mantenimiento/cabeceraMarca';
import { cabeceraSoloConMarca } from '../../../shared/mantenimiento/cabeceraDocumento';
import type { Rendicion } from './tipos';
import { estadoLineaEgreso, textoDiferencia, textoPct, tituloRendicion } from './vista';

/** Un renglón de la hoja: «etiqueta ……… monto». */
function R({ e, v, fuerte, sub }: { e: string; v: string; fuerte?: boolean; sub?: boolean }) {
  return (
    <tr className={fuerte ? 'border-t border-black font-semibold' : undefined}>
      <td className={`py-0.5 pr-4 ${sub ? 'pl-4' : ''}`}>{e}</td>
      <td className="py-0.5 text-right tabular-nums">{v}</td>
    </tr>
  );
}

const Seccion = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
  <section className="mt-5 break-inside-avoid">
    <h2 className="border-b border-black pb-0.5 text-sm font-semibold uppercase tracking-wide">{titulo}</h2>
    {children}
  </section>
);

/**
 * La rendición como documento para imprimir o guardar como PDF (A4, blanco y negro). Va dentro de `<ZonaImprimible>`: en pantalla no se ve y al imprimir
 * el CSS de «Impresión» (index.css) oculta todo lo demás. Es la misma información que la pantalla, sin tarjetas ni colores.
 */
export function HojaImprimible({ r }: { r: Rendicion }) {
  const m = r.complejo.moneda;
  const d = (v: string) => dinero(v, m);
  const { ingresos: i, egresos: e, cuadre: c, morosidad: mo } = r;
  const dif = c.extracto ? textoDiferencia(c.extracto, d) : null;
  return (
    <article className="text-xs leading-snug text-black">
      {/* Con la marca propia activa: logo, nombre comercial y franja de color de la administradora arriba del documento. */}
      <CabeceraMarca c={cabeceraSoloConMarca(useMarca())} />
      <header>
        <p className="text-[10px] uppercase tracking-widest">Rendición de cuentas</p>
        <h1 className="text-xl font-semibold">{r.complejo.nombre}</h1>
        <p className="text-sm">{tituloRendicion(r)} · montos en {m}</p>
      </header>

      <Seccion titulo="Resumen">
        <table className="mt-1 w-full"><tbody>
          <R e="Saldo inicial" v={d(c.saldo_inicial)} />
          <R e="+ Ingresos" v={d(c.ingresos)} />
          <R e="− Egresos" v={d(c.egresos)} />
          <R fuerte e="Saldo final" v={d(c.saldo_final)} />
        </tbody></table>
        <p className="mt-1 text-[10px]">{c.nota}</p>
        {c.extracto && dif && <p className="mt-1">Banco: {d(c.extracto.saldo_banco)} · diferencia {d(c.extracto.diferencia)} ({dif.label}).</p>}
      </Seccion>

      <Seccion titulo="Ingresos">
        <table className="mt-1 w-full"><tbody>
          <R e="Emitido del mes" v={d(i.emitido)} />
          <R fuerte e={`Cobrado del mes (${i.cobrado.pagos} pagos validados)`} v={d(i.cobrado.total)} />
          <R sub e="De recibos del mes" v={d(i.cobrado.del_mes)} />
          <R sub e="De meses anteriores" v={d(i.cobrado.de_meses_anteriores)} />
          <R sub e="Adelantado" v={d(i.cobrado.adelantado)} />
          <R e={`Por validar (${i.por_validar.pagos}, no suma)`} v={d(i.por_validar.total)} />
          {i.otros_central && <R e="Otros ingresos de la Junta central" v={d(i.otros_central.total)} />}
          {i.conciliacion?.activa && <R sub e="Conciliado con el banco" v={d(i.conciliacion.conciliado)} />}
          {i.conciliacion?.activa && <R sub e="En efectivo" v={d(i.conciliacion.efectivo)} />}
          {i.conciliacion?.activa && <R sub e="Sin conciliar" v={d(i.conciliacion.sin_conciliar)} />}
          <R fuerte e="Total de ingresos" v={d(i.total)} />
        </tbody></table>
      </Seccion>

      <Seccion titulo="Egresos">
        <table className="mt-1 w-full">
          <thead><tr className="text-left"><th className="py-0.5 font-medium">Block</th><th className="py-0.5 font-medium">Línea</th><th className="py-0.5 text-right font-medium">Facturado</th><th className="py-0.5 text-right font-medium">Pagado</th><th className="py-0.5 pl-3 font-medium">Estado</th></tr></thead>
          <tbody>
            {e.lineas.map(l => (
              <tr key={`${l.estructura.id}|${l.linea}`}>
                <td className="py-0.5 pr-2">{l.estructura.nombre ?? ''}</td>
                <td className="py-0.5 pr-2">{l.nombre}</td>
                <td className="py-0.5 text-right tabular-nums">{d(l.facturado)}</td>
                <td className="py-0.5 text-right tabular-nums">{l.pagado === null ? '—' : d(l.pagado)}</td>
                <td className="py-0.5 pl-3">{estadoLineaEgreso(l).label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="mt-2 w-full"><tbody>
          <R e="Pagado por los blocks" v={d(e.pagado)} />
          {r.alcance === 'condominio' && <R sub e="Aporte a la Junta central (traspaso interno, no se resta)" v={d(e.traspaso_central)} />}
          {e.central && <R e="Pagado por la Junta central" v={d(e.central.total)} />}
          <R fuerte e="Total de egresos" v={d(e.total)} />
        </tbody></table>
        {e.sin_conformidad.lineas > 0 && <p className="mt-1">Atención: {e.sin_conformidad.lineas} pago(s) sin conformidad ({d(e.sin_conformidad.monto)}).</p>}
      </Seccion>

      <Seccion titulo="Fondos">
        <table className="mt-1 w-full"><tbody>
          {r.fondos.blocks.map(b => <R key={b.estructura.id} e={`Fondo de ahorros · ${b.estructura.nombre ?? 'Block'}`} v={d(b.fondo_ahorros)} />)}
          {r.fondos.central && <R e="Fondo de ahorros de la Junta central" v={d(r.fondos.central.fondo_ahorros)} />}
          {r.fondos.central && <R e="Fondo de contingencia del condominio" v={d(r.fondos.central.fondo_contingencia)} />}
        </tbody></table>
      </Seccion>

      <Seccion titulo={`Morosidad al ${fechaCorta(mo.al)}`}>
        <table className="mt-1 w-full"><tbody>
          <R e={`% cobrado del recibo del mes (${d(mo.pagado_del_recibo)} de ${d(mo.emitido)})`} v={textoPct(mo.pct_cobrado)} />
          <R e="Departamentos morosos" v={String(mo.unidades_morosas)} />
          <R fuerte e="Deuda vencida" v={d(mo.deuda_total)} />
        </tbody></table>
        {mo.unidades.length > 0 && (
          <table className="mt-2 w-full">
            <thead><tr className="text-left"><th className="py-0.5 font-medium">Departamento</th><th className="py-0.5 font-medium">Block</th><th className="py-0.5 text-right font-medium">Meses</th><th className="py-0.5 text-right font-medium">Atraso</th><th className="py-0.5 text-right font-medium">Deuda</th></tr></thead>
            <tbody>{mo.unidades.map(u => (
              <tr key={u.unidad.id}><td className="py-0.5">{u.unidad.codigo}</td><td className="py-0.5">{u.estructura?.nombre ?? ''}</td><td className="py-0.5 text-right tabular-nums">{u.meses}</td><td className="py-0.5 text-right tabular-nums">{u.dias_max_atraso} d</td><td className="py-0.5 text-right tabular-nums">{d(u.deuda)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Seccion>

      {r.blocks && (
        <Seccion titulo="Por block">
          <table className="mt-1 w-full">
            <thead><tr className="text-left"><th className="py-0.5 font-medium">Block</th><th className="py-0.5 text-right font-medium">Emitido</th><th className="py-0.5 text-right font-medium">Cobrado</th><th className="py-0.5 text-right font-medium">Egresos</th><th className="py-0.5 text-right font-medium">Saldo final</th><th className="py-0.5 text-right font-medium">% cobrado</th></tr></thead>
            <tbody>{r.blocks.map(b => (
              <tr key={b.estructura.id ?? 'sin-block'}><td className="py-0.5">{b.estructura.nombre}</td><td className="py-0.5 text-right tabular-nums">{d(b.emitido)}</td><td className="py-0.5 text-right tabular-nums">{d(b.cobrado)}</td><td className="py-0.5 text-right tabular-nums">{d(b.egresos_pagado)}</td><td className="py-0.5 text-right tabular-nums">{d(b.saldo_final)}</td><td className="py-0.5 text-right tabular-nums">{textoPct(b.pct_cobrado)}</td></tr>
            ))}</tbody>
          </table>
        </Seccion>
      )}

      <footer className="mt-12 grid grid-cols-2 gap-12 break-inside-avoid text-center">
        <p className="border-t border-black pt-1">Administración</p>
        <p className="border-t border-black pt-1">Junta directiva</p>
      </footer>
      <p className="mt-4 text-[10px]">Generado el {fechaCorta(r.generado_at)} desde Torre.</p>
    </article>
  );
}
