import type { ReactNode } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { Alert, Badge, Card, CardHeader, DataTable, StatStrip, cx, dinero, fechaCorta, nombreDelMes } from '../../../../ui';
import type { Column } from '../../../../ui';
import type { FilaBlock, LineaEgreso, Moroso, Rendicion } from './tipos';
import { estadoLineaEgreso, textoDiferencia, textoPct, tonoPct, tonoSaldo } from './vista';

const TONO = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' } as const;

/** Un renglón «etiqueta ……… monto». `fuerte` = total de la sección; `sub` = desglose (sangrado); `suave` = informativo (no suma). */
function Fila({ etiqueta, valor, moneda, fuerte, sub, suave, tono, nota }: { etiqueta: string; valor: string | ReactNode; moneda?: string; fuerte?: boolean; sub?: boolean; suave?: boolean; tono?: keyof typeof TONO; nota?: string }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-4 py-2', fuerte && 'border-t border-line font-semibold', sub && 'pl-4 text-sm', suave && 'text-muted')}>
      <dt className="min-w-0 break-words">{etiqueta}{nota && <span className="block text-xs font-normal text-muted">{nota}</span>}</dt>
      <dd className={cx('num shrink-0 text-right', tono && TONO[tono])}>{typeof valor === 'string' && moneda ? dinero(valor, moneda) : valor}</dd>
    </div>
  );
}

const Lista = ({ children, etiqueta }: { children: ReactNode; etiqueta: string }) => <dl aria-label={etiqueta} className="divide-y divide-line px-5 py-2">{children}</dl>;

/** Franja de arriba: lo que se mira primero. */
export function Resumen({ r }: { r: Rendicion }) {
  const m = r.complejo.moneda;
  return (
    <StatStrip
      stats={[
        { label: 'Cobrado del mes', value: dinero(r.ingresos.cobrado.total, m), hint: `Emitido ${dinero(r.ingresos.emitido, m)}` },
        { label: 'Egresos', value: dinero(r.egresos.total, m), hint: r.egresos.por_pagar.lineas ? `${r.egresos.por_pagar.lineas} por pagar` : undefined },
        { label: 'Saldo final', value: dinero(r.cuadre.saldo_final, m), tone: tonoSaldo(r.cuadre.saldo_final) },
        { label: '% cobrado', value: textoPct(r.morosidad.pct_cobrado), tone: tonoPct(r.morosidad.pct_cobrado), hint: `${r.morosidad.unidades_morosas} ${r.morosidad.unidades_morosas === 1 ? 'moroso' : 'morosos'}` },
      ]}
    />
  );
}

export function Ingresos({ r }: { r: Rendicion }) {
  const i = r.ingresos;
  const m = r.complejo.moneda;
  return (
    <Card>
      <CardHeader title="Ingresos" description="Lo cobrado en el mes: pagos validados con fecha de pago (la del voucher) dentro del mes." />
      <Lista etiqueta="Ingresos del mes">
        <Fila etiqueta="Emitido del mes" valor={i.emitido} moneda={m} suave nota="Suma de los recibos del mes" />
        <Fila etiqueta="Cobrado del mes" valor={i.cobrado.total} moneda={m} fuerte nota={`${i.cobrado.pagos} ${i.cobrado.pagos === 1 ? 'pago validado' : 'pagos validados'}`} />
        <Fila sub etiqueta="De recibos del mes" valor={i.cobrado.del_mes} moneda={m} />
        <Fila sub etiqueta="De meses anteriores" valor={i.cobrado.de_meses_anteriores} moneda={m} />
        <Fila sub etiqueta="Adelantado (recibos de meses posteriores)" valor={i.cobrado.adelantado} moneda={m} />
        <Fila suave etiqueta="Por validar" valor={i.por_validar.total} moneda={m} nota={`${i.por_validar.pagos} ${i.por_validar.pagos === 1 ? 'pago' : 'pagos'} · no suma hasta que se valide`} />
        {i.otros_central && <Fila etiqueta="Otros ingresos de la Junta central" valor={i.otros_central.total} moneda={m} nota="Alquiler de estacionamientos y otros" />}
        {i.otros_central && <Fila fuerte etiqueta="Total de ingresos" valor={i.total} moneda={m} />}
      </Lista>
      {i.conciliacion && (
        <div className="border-t border-line">
          {i.conciliacion.activa ? (
            <Lista etiqueta="Conciliación con el banco">
              <Fila etiqueta="Conciliado con el banco" valor={i.conciliacion.conciliado} moneda={m} tono="ok" />
              <Fila etiqueta="En efectivo" valor={i.conciliacion.efectivo} moneda={m} suave nota="El efectivo no se concilia con el banco" />
              <Fila etiqueta="Cobrado sin conciliar" valor={i.conciliacion.sin_conciliar} moneda={m} tono={Number(i.conciliacion.sin_conciliar) > 0 ? 'warn' : undefined} />
            </Lista>
          ) : <p className="px-5 py-3 text-sm text-muted">La conciliación bancaria no está activa en este condominio: la rendición no puede decir cuánto de lo cobrado ya está en el banco.</p>}
        </div>
      )}
      {i.otros_central && i.otros_central.movimientos.length > 0 && <Movimientos titulo="Ingresos de la Junta central" movs={i.otros_central.movimientos} moneda={m} />}
    </Card>
  );
}

function Movimientos({ titulo, movs, moneda }: { titulo: string; movs: { fecha: string; concepto: string; detalle: string; monto: string }[]; moneda: string }) {
  return (
    <div className="border-t border-line px-5 py-3">
      <h3 className="text-sm font-semibold">{titulo}</h3>
      <ul className="mt-1 divide-y divide-line">
        {movs.map((x, i) => (
          <li key={i} className="flex items-baseline justify-between gap-4 py-2 text-sm">
            <span className="min-w-0 break-words"><span className="text-muted">{fechaCorta(x.fecha)}</span> · {x.detalle}</span>
            <span className="num shrink-0">{dinero(x.monto, moneda)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Egresos({ r }: { r: Rendicion }) {
  const e = r.egresos;
  const m = r.complejo.moneda;
  const enBlock = r.alcance === 'block';
  const columnas: Column<LineaEgreso>[] = [
    { key: 'block', header: 'Block', hideBelow: 'md', cell: l => l.estructura.nombre ?? '—' },
    { key: 'linea', header: 'Línea', cell: l => <span className="font-medium">{l.nombre}</span> },
    { key: 'facturado', header: 'Facturado', align: 'right', hideBelow: 'sm', cell: l => <span className="num">{dinero(l.facturado, m)}</span> },
    { key: 'pagado', header: 'Pagado', align: 'right', cell: l => <span className="num">{l.pagado === null ? '—' : dinero(l.pagado, m)}</span> },
    { key: 'fecha', header: 'Fecha de pago', hideBelow: 'lg', cell: l => fechaCorta(l.fecha_pago) },
    { key: 'estado', header: 'Estado', cell: l => { const s = estadoLineaEgreso(l); return <Badge tone={s.tone}>{s.label}</Badge>; } },
  ];
  return (
    <Card>
      <CardHeader title="Egresos" description="Los pagos del cierre del mes: la empresa administradora, la Junta central, servicios y proveedores. Un pago hecho al mes siguiente cuenta en el cierre al que pertenece." />
      {(e.sin_conformidad.lineas > 0 || e.por_pagar.lineas > 0 || e.sin_clasificar.length > 0) && (
        <div className="space-y-2 px-5 pt-4">
          {e.sin_conformidad.lineas > 0 && <Alert tone="warn">{e.sin_conformidad.lineas === 1 ? '1 pago está pagado pero sin conformidad' : `${e.sin_conformidad.lineas} pagos están pagados pero sin conformidad`} ({dinero(e.sin_conformidad.monto, m)}): falta confirmar que llegó a la cuenta.</Alert>}
          {e.por_pagar.lineas > 0 && <Alert tone="info">{e.por_pagar.lineas === 1 ? '1 línea del cierre aún no se paga' : `${e.por_pagar.lineas} líneas del cierre aún no se pagan`} ({dinero(e.por_pagar.facturado, m)} facturados). No se descuentan hasta que se registre el pago.</Alert>}
          {e.sin_clasificar.length > 0 && <Alert tone="warn">Hay conceptos del recibo sin destino ({e.sin_clasificar.map(s => s.nombre).join(', ')}): no entran al cierre hasta que los clasifiques.</Alert>}
        </div>
      )}
      <Lista etiqueta="Egresos del mes">
        <Fila suave etiqueta="Facturado a pagar" valor={e.facturado} moneda={m} />
        <Fila etiqueta={enBlock ? 'Pagado' : 'Pagado por los blocks'} valor={e.pagado} moneda={m} />
        {!enBlock && <Fila sub suave etiqueta="Aporte a la Junta central (traspaso interno)" valor={`− ${dinero(e.traspaso_central, m)}`} nota="Pasa de la cuenta del block a la de la Junta central: no sale del condominio" />}
        {e.central && <Fila etiqueta="Pagado por la Junta central" valor={e.central.total} moneda={m} />}
        <Fila fuerte etiqueta="Total de egresos" valor={e.total} moneda={m} />
      </Lista>
      <div className="border-t border-line">
        <DataTable caption="Pagos del cierre del mes" columns={columnas} rows={e.lineas} rowKey={l => `${l.estructura.id}|${l.linea}`} empty={{ title: 'Sin pagos en el cierre', description: 'Cuando haya recibos del mes con destino de pago, sus líneas aparecerán aquí.' }} />
      </div>
      {e.central && e.central.movimientos.length > 0 && <Movimientos titulo="Pagos de la Junta central" movs={e.central.movimientos} moneda={m} />}
    </Card>
  );
}

export function Cuadre({ r }: { r: Rendicion }) {
  const c = r.cuadre;
  const m = r.complejo.moneda;
  const x = c.extracto;
  const dif = x ? textoDiferencia(x, v => dinero(v, m)) : null;
  return (
    <Card>
      <CardHeader title="Cuadre" description="Saldo inicial + ingresos − egresos = saldo final." />
      <Lista etiqueta="Cuadre del mes">
        <Fila etiqueta="Saldo inicial" valor={c.saldo_inicial} moneda={m} tono={tonoSaldo(c.saldo_inicial)} nota="El saldo final del mes anterior" />
        <Fila etiqueta="+ Ingresos" valor={c.ingresos} moneda={m} />
        <Fila etiqueta="− Egresos" valor={c.egresos} moneda={m} />
        <Fila fuerte etiqueta="Saldo final" valor={c.saldo_final} moneda={m} tono={tonoSaldo(c.saldo_final)} />
      </Lista>
      <p className="border-t border-line px-5 py-3 text-sm text-muted">{c.nota}</p>
      {x && dif && (
        <div className="border-t border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Comparación con el extracto del banco</h3>
            <Badge tone={dif.tone}>{dif.label}</Badge>
          </div>
          <dl className="mt-1 divide-y divide-line">
            <Fila etiqueta="Saldo según la rendición" valor={x.saldo_rendicion} moneda={m} />
            <Fila etiqueta="Saldo del banco" valor={x.saldo_banco} moneda={m} nota={x.cuentas.map(cu => `${cu.cuenta} al ${fechaCorta(cu.hasta)}`).join(' · ')} />
            <Fila fuerte etiqueta="Diferencia" valor={x.diferencia} moneda={m} tono={x.cuadra ? 'ok' : 'warn'} />
          </dl>
        </div>
      )}
    </Card>
  );
}

export function Fondos({ r }: { r: Rendicion }) {
  const f = r.fondos;
  const m = r.complejo.moneda;
  return (
    <Card>
      <CardHeader title="Fondos" description="Lo ahorrado por los blocks y la Junta central, acumulado hasta este mes." />
      <Lista etiqueta="Fondos">
        {f.blocks.map(b => <Fila key={b.estructura.id} etiqueta={`Fondo de ahorros · ${b.estructura.nombre ?? 'Block'}`} valor={b.fondo_ahorros} moneda={m} />)}
        {f.blocks.length > 1 && <Fila fuerte etiqueta="Total de los blocks" valor={f.fondo_ahorros_blocks} moneda={m} />}
        {f.central && <Fila etiqueta="Fondo de ahorros de la Junta central" valor={f.central.fondo_ahorros} moneda={m} />}
        {f.central && <Fila etiqueta="Fondo de contingencia del condominio" valor={f.central.fondo_contingencia} moneda={m} />}
        {f.blocks.length === 0 && !f.central && <Fila etiqueta="Sin fondos que mostrar" valor="—" suave />}
      </Lista>
    </Card>
  );
}

export function Morosidad({ r }: { r: Rendicion }) {
  const mo = r.morosidad;
  const m = r.complejo.moneda;
  const columnas: Column<Moroso>[] = [
    { key: 'dpto', header: 'Departamento', cell: u => <span className="font-medium">{u.unidad.codigo}</span> },
    { key: 'block', header: 'Block', hideBelow: 'sm', cell: u => u.estructura?.nombre ?? '—' },
    { key: 'meses', header: 'Meses', align: 'right', hideBelow: 'md', cell: u => <span className="num">{u.meses}</span> },
    { key: 'atraso', header: 'Atraso', cell: u => <Badge tone={u.dias_max_atraso >= 30 ? 'bad' : 'warn'}>{u.dias_max_atraso} {u.dias_max_atraso === 1 ? 'día' : 'días'}</Badge> },
    { key: 'deuda', header: 'Deuda', align: 'right', cell: u => <span className="num font-medium">{dinero(u.deuda, m)}</span> },
  ];
  return (
    <Card>
      <CardHeader title="Morosidad" description={`Deuda vencida de los recibos hasta ${nombreDelMes(r.periodo.mes)}, al ${fechaCorta(mo.al)}.`} />
      <Lista etiqueta="Morosidad del mes">
        <Fila etiqueta="% cobrado del recibo del mes" valor={textoPct(mo.pct_cobrado)} tono={tonoPct(mo.pct_cobrado)} nota={`${dinero(mo.pagado_del_recibo, m)} pagados de ${dinero(mo.emitido, m)} emitidos`} />
        <Fila etiqueta="Departamentos morosos" valor={String(mo.unidades_morosas)} />
        <Fila fuerte etiqueta="Deuda vencida" valor={mo.deuda_total} moneda={m} tono={Number(mo.deuda_total) > 0 ? 'bad' : undefined} nota={`${dinero(mo.deuda_del_mes, m)} son del recibo de este mes`} />
      </Lista>
      <div className="border-t border-line">
        <DataTable
          caption={`Departamentos morosos al ${fechaCorta(mo.al)}`}
          columns={columnas}
          rows={mo.unidades}
          rowKey={u => u.unidad.id}
          empty={{ title: 'Sin morosidad', description: 'Todos los departamentos están al día con los recibos hasta este mes.', icon: <CheckCircleIcon className="text-ok" /> }}
        />
        {!mo.lista_completa && <p className="border-t border-line px-5 py-3 text-sm text-muted">La lista muestra los departamentos de mayor deuda; las cifras de arriba son de todos.</p>}
      </div>
    </Card>
  );
}

export function PorBlock({ r }: { r: Rendicion }) {
  const m = r.complejo.moneda;
  if (!r.blocks) return null;
  const columnas: Column<FilaBlock>[] = [
    { key: 'block', header: 'Block', cell: b => <span className="font-medium">{b.estructura.nombre}</span> },
    { key: 'emitido', header: 'Emitido', align: 'right', hideBelow: 'lg', cell: b => <span className="num">{dinero(b.emitido, m)}</span> },
    { key: 'cobrado', header: 'Cobrado', align: 'right', cell: b => <span className="num">{dinero(b.cobrado, m)}</span> },
    { key: 'egresos', header: 'Egresos', align: 'right', hideBelow: 'sm', cell: b => <span className="num">{dinero(b.egresos_pagado, m)}</span> },
    { key: 'saldo', header: 'Saldo final', align: 'right', cell: b => <span className={cx('num font-medium', Number(b.saldo_final) < 0 && 'text-bad')}>{dinero(b.saldo_final, m)}</span> },
    { key: 'pct', header: '% cobrado', align: 'right', hideBelow: 'md', cell: b => <span className="num">{textoPct(b.pct_cobrado)}</span> },
    { key: 'morosos', header: 'Morosos', align: 'right', hideBelow: 'md', cell: b => <span className="num">{b.unidades_morosas}</span> },
  ];
  return (
    <Card>
      <CardHeader title="Por block" description="Cada block con su propio cobrado y egresos. La Junta central suma aparte: el saldo del condominio es el de los blocks más lo acumulado de la Junta central." />
      <DataTable caption="Rendición por block" columns={columnas} rows={r.blocks} rowKey={b => b.estructura.id ?? 'sin-block'} empty={{ title: 'Sin blocks' }} />
    </Card>
  );
}
