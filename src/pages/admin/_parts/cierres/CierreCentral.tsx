import { useState } from 'react';
import { ArrowTopRightOnSquareIcon, BanknotesIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../../../api';
import { Alert, Badge, Button, Card, CardBody, ConfirmDialog, EmptyState, ErrorState, Skeleton, StatStrip, dinero, fechaCorta, nombreDelMes, useToast } from '../../../../ui';
import { RegistrarMovimientoModal } from './RegistrarMovimientoModal';
import type { AporteBlock, CierreCentral as Cierre, MovimientoCentral } from './tipos';
import { ESTADO_APORTE, ESTADO_CENTRAL, detalleMovimiento, tituloMovimiento } from './vista';
import { abrirVoucher } from './voucher';

function Monto({ etiqueta, valor, moneda, destacado }: { etiqueta: string; valor: string; moneda: string; destacado?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{etiqueta}</dt>
      <dd className={`num break-words ${destacado ? 'text-lg font-semibold' : 'text-sm font-medium'}`}>{dinero(valor, moneda)}</dd>
    </div>
  );
}

function FilaAporte({ a, moneda, onVoucher }: { a: AporteBlock; moneda: string; onVoucher: (id: number) => void }) {
  const est = ESTADO_APORTE[a.estado];
  const r = a.registro;
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h4 className="min-w-0 break-words text-base font-semibold">{a.estructura.nombre ?? 'Block'}</h4>
        <Badge tone={est.tone}>{est.label}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <Monto etiqueta="Le toca aportar" valor={a.facturado} moneda={moneda} />
        {r && <Monto etiqueta="Transferido" valor={r.monto_pagado} moneda={moneda} destacado />}
      </dl>
      {r && (
        <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <p className="break-words text-muted">Pagado el {fechaCorta(r.fecha_pago)}{r.registrado_por ? ` · registrado por ${r.registrado_por.nombre}` : ''}{r.referencia ? ` · Op. ${r.referencia}` : ''}</p>
          {r.conformidad && <p className="text-ok"><CheckCircleIcon className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden="true" />Conformidad de {r.conformidad.por?.nombre ?? 'el tesorero central'} · {fechaCorta(r.conformidad.at)}</p>}
          {r.voucher && <div className="pt-1"><Button size="sm" variant="secondary" icon={<ArrowTopRightOnSquareIcon className="h-4 w-4" />} onClick={() => onVoucher(r.id)}>Ver voucher</Button></div>}
        </div>
      )}
    </li>
  );
}

function TarjetaMovimiento({ m, moneda, puede, ocupado, onVoucher, onQuitar }: { m: MovimientoCentral; moneda: string; puede: boolean; ocupado: boolean; onVoucher: () => void; onQuitar: () => void }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h4 className="break-words text-base font-semibold">{tituloMovimiento(m)}</h4>
          <p className="break-words text-sm text-muted">{m.categoria_etiqueta}</p>
        </div>
        <p className="num text-lg font-semibold">{dinero(m.monto, moneda)}</p>
      </div>
      <p className="mt-3 break-words border-t border-line pt-3 text-sm text-muted">{detalleMovimiento(m, fechaCorta(m.fecha))}</p>
      {m.observaciones && <p className="mt-1 break-words text-sm text-muted">{m.observaciones}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {m.voucher && <Button size="sm" variant="secondary" icon={<ArrowTopRightOnSquareIcon className="h-4 w-4" />} onClick={onVoucher}>Ver voucher</Button>}
        {puede && <Button size="sm" variant="ghost" disabled={ocupado} onClick={onQuitar}>Quitar</Button>}
      </div>
    </li>
  );
}

interface Props { complejoId: number | null; mes: number; anio: number }

/**
 * El cierre del mes de la Junta central: los aportes de los blocks (con la conformidad del tesorero central), el alquiler de estacionamientos y otros ingresos,
 * los egresos, el saldo del mes y el Fondo de ahorros. Quién registra lo decide el servidor (`puede.registrar`: tesorero central o administración).
 */
export function CierreCentral({ complejoId, mes, anio }: Props) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<Cierre>(`/api/cierres/central?mes=${mes}&anio=${anio}${complejoId ? `&complejo_id=${complejoId}` : ''}`);
  const [registrando, setRegistrando] = useState<'ingreso' | 'egreso' | null>(null);
  const [quitando, setQuitando] = useState<MovimientoCentral | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function quitar() {
    if (!quitando) return;
    setOcupado(true);
    try {
      await api(`/api/cierres/central/movimientos/${quitando.id}`, { method: 'DELETE' });
      toast.ok('Movimiento quitado');
      setQuitando(null);
      await reload();
    } catch (e) { toast.error(errorText(e)); } finally { setOcupado(false); }
  }

  if (loading && !data) return <div className="space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>;
  if (error || !data) return <ErrorState message={error ?? 'No se pudo cargar el cierre de la Junta central'} onRetry={() => void reload()} />;
  const c = data;
  const est = ESTADO_CENTRAL[c.estado];
  const periodo = `${nombreDelMes(c.mes)} de ${c.anio}`;
  const verVoucher = (id: number, origen: 'linea' | 'central') => void abrirVoucher(id, origen).catch(e => toast.error(errorText(e)));

  const lista = (tipo: 'ingreso' | 'egreso', items: MovimientoCentral[]) => (
    <section className="space-y-3" aria-label={tipo === 'ingreso' ? 'Otros ingresos' : 'Egresos'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{tipo === 'ingreso' ? 'Otros ingresos' : 'Egresos'} <span className="num text-sm font-normal text-muted">{dinero(tipo === 'ingreso' ? c.ingresos.otros.total : c.egresos.total, c.moneda)}</span></h3>
        {c.puede.registrar && <Button size="sm" icon={<BanknotesIcon className="h-4 w-4" />} onClick={() => setRegistrando(tipo)}>{tipo === 'ingreso' ? 'Registrar ingreso' : 'Registrar egreso'}</Button>}
      </div>
      {tipo === 'ingreso' && <p className="text-sm text-muted">El alquiler de estacionamientos se paga aparte, a la cuenta de la Junta central: regístralo aquí con su voucher.</p>}
      {items.length === 0
        ? <EmptyState title={tipo === 'ingreso' ? 'Sin otros ingresos este mes' : 'Sin egresos este mes'} description={tipo === 'ingreso' ? 'Aquí aparecen el alquiler de estacionamientos y otros ingresos.' : 'Aquí aparecen los servicios del condominio y los proveedores de áreas comunes.'} />
        : (
          <ul className="grid gap-3">
            {items.map(m => <TarjetaMovimiento key={m.id} m={m} moneda={c.moneda} puede={c.puede.registrar} ocupado={ocupado} onVoucher={() => verVoucher(m.id, 'central')} onQuitar={() => setQuitando(m)} />)}
          </ul>
        )}
    </section>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Junta central · {periodo}</h2>
        <Badge tone={est.tone}>{est.label}</Badge>
      </div>

      <StatStrip stats={[
        { label: 'Ingresos del mes', value: dinero(c.ingresos.total, c.moneda) },
        { label: 'Egresos del mes', value: dinero(c.egresos.total, c.moneda) },
        { label: 'Saldo del mes', value: dinero(c.saldo_mes, c.moneda), tone: Number(c.saldo_mes) < 0 ? 'warn' : 'ok' },
      ]} />

      <Card>
        <CardBody>
          <h3 className="text-base font-semibold">Fondo de ahorros de la Junta central</h3>
          <p className="mt-1 text-sm text-muted">Lo que va quedando en la cuenta de la Junta central: los saldos de todos los meses hasta este. El fondo de contingencia del condominio va aparte.</p>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Monto etiqueta="Fondo de ahorros acumulado" valor={c.fondo_ahorros} moneda={c.moneda} destacado />
            <Monto etiqueta="Fondo de contingencia del condominio" valor={c.fondo_contingencia} moneda={c.moneda} destacado />
            <Monto etiqueta="Contingencia aportada este mes" valor={c.fondo_contingencia_mes} moneda={c.moneda} />
          </dl>
        </CardBody>
      </Card>

      <section className="space-y-3" aria-label="Aportes de los blocks">
        <h3 className="text-base font-semibold">Aportes de los blocks <span className="num text-sm font-normal text-muted">{dinero(c.ingresos.aportes.confirmados, c.moneda)}</span></h3>
        <p className="text-sm text-muted">Sólo cuenta lo que el tesorero central ya confirmó. {Number(c.ingresos.aportes.por_confirmar) > 0 && <>Por confirmar: <span className="num">{dinero(c.ingresos.aportes.por_confirmar, c.moneda)}</span>. </>}La contingencia del condominio que viene en esos aportes se muestra aparte, en su fondo.</p>
        {c.blocks_sin_aportar.length > 0 && (
          <Alert tone="warn">
            <span className="font-medium">Blocks que aún no aportan:</span> {c.blocks_sin_aportar.map(b => `${b.nombre ?? 'Block'} (${dinero(b.facturado, c.moneda)})`).join(', ')}. El tesorero central recibe un aviso el día 5.
          </Alert>
        )}
        {c.ingresos.aportes.blocks.length === 0
          ? <EmptyState title="Ningún block aporta este mes" description="Cuando un block tenga recibo con conceptos «del condominio», su aporte aparece aquí." />
          : <ul className="grid gap-3" aria-label="Aporte de cada block">{c.ingresos.aportes.blocks.map(a => <FilaAporte key={a.estructura.id} a={a} moneda={c.moneda} onVoucher={id => verVoucher(id, 'linea')} />)}</ul>}
      </section>

      {lista('ingreso', c.ingresos.otros.movimientos)}
      {lista('egreso', c.egresos.movimientos)}

      {registrando && <RegistrarMovimientoModal tipo={registrando} cierre={c} complejoId={complejoId} onClose={() => setRegistrando(null)} onHecho={() => { setRegistrando(null); void reload(); }} />}
      <ConfirmDialog
        open={!!quitando} onClose={() => setQuitando(null)} onConfirm={quitar} loading={ocupado} danger
        title="Quitar movimiento" message={`Se quitará «${quitando ? tituloMovimiento(quitando) : ''}» y su voucher del cierre. Podrás registrarlo de nuevo.`} confirmLabel="Quitar"
      />
    </div>
  );
}
