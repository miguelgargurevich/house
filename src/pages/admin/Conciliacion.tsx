import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpTrayIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import { api, ApiError, errorText, useList, useResource, type Page } from '../../api';
import { Alert, Badge, Button, Card, DataTable, EmptyState, PageHeader, Select, Skeleton, StatStrip, Tabs, Toolbar, dinero, fechaCorta } from '../../ui';
import type { Column } from '../../ui';
import { Bloqueable } from '../../app/Bloqueable';
import { AvisoModulo } from '../shared/_parts/AvisoModulo';
import { MovimientoModal } from './_parts/conciliacion/MovimientoModal';
import { ResumenPeriodo } from './_parts/conciliacion/ResumenPeriodo';
import { SubirExtractoModal } from './_parts/conciliacion/SubirExtractoModal';
import { ESTADO_UI, nombreDeCuenta, type Cuenta, type EstadoMovimiento, type Movimiento, type PagoResumen, type Resumen } from './_parts/conciliacion/tipos';

type Pestana = 'todos' | EstadoMovimiento | 'sin_abono';
const PESTANAS: { id: Pestana; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'por_revisar', label: 'Por revisar' },
  { id: 'sin_pago', label: 'Abonos sin voucher' },
  { id: 'conciliado', label: 'Conciliados' },
  { id: 'fuera_periodo', label: 'Fuera de período' },
  { id: 'ignorado', label: 'Ignorados' },
  { id: 'sin_abono', label: 'Vouchers sin abono' },
  { id: 'salida', label: 'Salidas' },
];

const METODOS: Record<string, string> = { transferencia: 'Transferencia', yape: 'Yape', plin: 'Plin', efectivo: 'Efectivo', tarjeta: 'Tarjeta' };

/** Las cuentas bancarias del condominio; si el plan no trae la conciliación, el servidor responde 403 `MODULO_NO_ACTIVO` y se muestra el aviso, no un error. */
function useCuentas(complejoId: string) {
  const [estado, setEstado] = useState<{ items: Cuenta[]; cargando: boolean; error: string | null; codigo?: string }>({ items: [], cargando: !!complejoId, error: null });
  useEffect(() => {
    if (!complejoId) { setEstado({ items: [], cargando: false, error: null }); return; }
    let vigente = true;
    setEstado(e => ({ ...e, cargando: true, error: null, codigo: undefined }));
    api<{ items: Cuenta[] }>(`/api/conciliacion/cuentas?complejo_id=${complejoId}`)
      .then(r => { if (vigente) setEstado({ items: r.items, cargando: false, error: null }); })
      .catch(e => { if (vigente) setEstado({ items: [], cargando: false, error: errorText(e), codigo: e instanceof ApiError ? e.code : undefined }); });
    return () => { vigente = false; };
  }, [complejoId]);
  return estado;
}

export default function Conciliacion() {
  const complejos = useResource<Page<{ id: number; nombre: string }>>('/api/complejos?pageSize=100');
  const [complejoId, setComplejoId] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  useEffect(() => { if (!complejoId && complejos.data?.items.length) setComplejoId(String(complejos.data.items[0]!.id)); }, [complejos.data, complejoId]);
  const cuentas = useCuentas(complejoId);
  useEffect(() => { setCuentaId(c => (cuentas.items.some(x => String(x.id) === c) ? c : String(cuentas.items.find(x => x.activo)?.id ?? cuentas.items[0]?.id ?? ''))); }, [cuentas.items]);
  const cuenta = cuentas.items.find(c => String(c.id) === cuentaId) ?? null;
  const lista = complejos.data?.items ?? [];

  const encabezado = <PageHeader title="Conciliación bancaria" description="Sube el extracto de la cuenta del condominio y Torre cruza cada abono con los pagos registrados: ves qué dinero llegó al banco y qué vouchers no tienen abono." />;

  if (cuentas.codigo === 'MODULO_NO_ACTIVO') {
    return (
      <>
        {encabezado}
        <Card><div className="p-5"><AvisoModulo modulo="conciliacion" /><p className="mt-3 text-sm text-muted">Tus pagos y vouchers siguen igual: la validación a mano no cambia. La conciliación con el extracto del banco es del plan Torre Pro.</p></div></Card>
      </>
    );
  }

  return (
    <>
      {encabezado}
      <Card>
        <Toolbar>
          {lista.length > 1 && (
            <Select label="Condominio" className="w-full sm:w-64" value={complejoId} onChange={e => { setComplejoId(e.target.value); setCuentaId(''); }}>
              {lista.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </Select>
          )}
          {cuentas.items.length > 0 && (
            <Select label="Cuenta" className="w-full sm:w-96" value={cuentaId} onChange={e => setCuentaId(e.target.value)}>
              {cuentas.items.map(c => <option key={c.id} value={c.id}>{nombreDeCuenta(c)}</option>)}
            </Select>
          )}
        </Toolbar>
        {(complejos.loading || cuentas.cargando) && <div className="p-5"><Skeleton className="h-10 w-full" /></div>}
        {complejos.error && <div className="p-5"><Alert tone="bad">{complejos.error}</Alert></div>}
        {cuentas.error && <div className="p-5"><Alert tone="bad">{cuentas.error}</Alert></div>}
        {!complejos.loading && !complejos.error && lista.length === 0 && <EmptyState icon={<ArrowsRightLeftIcon />} title="Aún no tienes condominios" description="Crea un condominio y registra su cuenta bancaria para conciliar su extracto." />}
        {!cuentas.cargando && !cuentas.error && complejoId && cuentas.items.length === 0 && (
          <EmptyState icon={<ArrowsRightLeftIcon />} title="Este condominio no tiene una cuenta bancaria" description="La conciliación se hace sobre una cuenta del condominio o de un block: regístrala en Medios de pago." action={<Link to="/admin/medios-pago" className="inline-flex h-10 items-center rounded border border-line bg-surface px-4 text-sm font-medium hover:bg-surface2">Ir a Medios de pago</Link>} />
        )}
      </Card>
      {cuenta && <PanelDeCuenta key={cuenta.id} cuenta={cuenta} />}
    </>
  );
}

function PanelDeCuenta({ cuenta }: { cuenta: Cuenta }) {
  const base = `/api/conciliacion/cuentas/${cuenta.id}`;
  const [pestana, setPestana] = useState<Pestana>('todos');
  const [subiendo, setSubiendo] = useState(false);
  const [abierto, setAbierto] = useState<Movimiento | null>(null);
  const resumen = useResource<Resumen>(`${base}/resumen`);
  const lista = useList<Movimiento>(`${base}/movimientos`, { pageSize: 25, params: { estado: pestana === 'todos' || pestana === 'sin_abono' ? undefined : pestana } });
  const sinAbono = useResource<{ cantidad: number; monto: string; items: PagoResumen[] }>(pestana === 'sin_abono' ? `${base}/sin-abono` : null);
  const recargar = () => { void resumen.reload(); void lista.reload(); void sinAbono.reload(); };
  const r = resumen.data;
  const moneda = cuenta.moneda;
  const esperando = resumen.loading && !r;
  const cifra = (c?: { cantidad: number; monto: string }) => (esperando || !c ? <Skeleton className="h-7 w-24" /> : <>{c.cantidad}<span className="num ml-2 text-sm font-normal text-muted">{dinero(c.monto, moneda)}</span></>);

  const columns: Column<Movimiento>[] = [
    { key: 'fecha', header: 'Abono', cell: m => (
      <span className="block min-w-0">
        <span className="block whitespace-nowrap font-medium">{fechaCorta(m.fecha)}</span>
        <span className="block max-w-[13rem] truncate text-xs text-muted sm:max-w-xs" title={m.descripcion}>{m.descripcion || '—'}{m.numero_operacion ? ` · op. ${m.numero_operacion}` : ''}</span>
        {/* El estado va aquí (no en otra columna): en el celular lo importante tiene que verse sin desplazar la tabla. */}
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={ESTADO_UI[m.estado].tone}>{ESTADO_UI[m.estado].label}</Badge>
          {m.estado === 'conciliado' && m.pago && <span className="text-xs text-muted"><span className="num">{m.pago.unidad?.codigo ?? '—'}</span> · {m.vinculo === 'manual' ? 'a mano' : 'automático'}</span>}
          {m.estado === 'por_revisar' && <span className="text-xs text-muted">{m.sugerencias.length} {m.sugerencias.length === 1 ? 'pago posible' : 'pagos posibles'}{m.sugerencias[0]?.nombre_coincide ? ' · el primero coincide con el nombre' : ''}</span>}
          {m.estado === 'ignorado' && m.motivo_ignorar && <span className="max-w-[10rem] truncate text-xs text-muted" title={m.motivo_ignorar}>{m.motivo_ignorar}</span>}
        </span>
        {m.estado === 'por_revisar' && m.motivo_revision && <span className="mt-1 block text-xs text-warn">{m.motivo_revision}</span>}
      </span>
    ) },
    { key: 'monto', header: 'Monto', align: 'right', cell: m => <span className="num whitespace-nowrap font-medium">{dinero(m.monto, moneda)}</span> },
    { key: 'acciones', header: '', align: 'right', hideBelow: 'sm', cell: m => <Button size="sm" variant={m.estado === 'por_revisar' || m.estado === 'sin_pago' ? 'primary' : 'secondary'} onClick={() => setAbierto(m)}>{m.estado === 'por_revisar' ? 'Revisar' : m.estado === 'sin_pago' || m.estado === 'fuera_periodo' ? 'Vincular' : 'Ver'}</Button> },
  ];

  // Las salidas (cargos del banco) sólo se leen: no se vinculan ni se ignoran.
  const columnasSalidas: Column<Movimiento>[] = [
    { key: 'fecha', header: 'Salida', cell: m => (
      <span className="block min-w-0">
        <span className="block whitespace-nowrap font-medium">{fechaCorta(m.fecha)}</span>
        <span className="block max-w-[13rem] truncate text-xs text-muted sm:max-w-md" title={m.descripcion}>{m.descripcion || '—'}{m.numero_operacion ? ` · op. ${m.numero_operacion}` : ''}</span>
      </span>
    ) },
    { key: 'monto', header: 'Monto', align: 'right', cell: m => <span className="num whitespace-nowrap font-medium">−{dinero(m.monto, moneda)}</span> },
  ];

  const columnasSinAbono: Column<PagoResumen>[] = [
    { key: 'fecha', header: 'Fecha del pago', cell: p => <span className="whitespace-nowrap">{fechaCorta(p.fecha_pago)}</span> },
    { key: 'unidad', header: 'Departamento', cell: p => <span className="block"><span className="num font-medium">{p.unidad?.codigo ?? '—'}</span>{p.unidad?.estructura ? <span className="block text-xs text-muted">{p.unidad.estructura}</span> : null}</span> },
    { key: 'metodo', header: 'Método', hideBelow: 'sm', cell: p => <span className="block">{METODOS[p.metodo_pago ?? ''] ?? p.metodo_pago ?? '—'}{p.referencia && <span className="num block text-xs text-muted">{p.referencia}</span>}</span> },
    { key: 'total', header: 'Total', align: 'right', cell: p => <span className="num whitespace-nowrap font-medium">{dinero(p.total, moneda)}</span> },
  ];

  return (
    <>
      <div className="mb-4 mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {r?.rango ? <>Extractos cargados: <span className="num">{fechaCorta(r.rango.desde)}</span> al <span className="num">{fechaCorta(r.rango.hasta)}</span> ({r.extractos} {r.extractos === 1 ? 'archivo' : 'archivos'}).</> : 'Aún no subiste ningún extracto de esta cuenta.'}
        </p>
        <Bloqueable>{b => <Button icon={<ArrowUpTrayIcon className="h-4 w-4" />} disabled={b} onClick={() => setSubiendo(true)}>Subir extracto</Button>}</Bloqueable>
      </div>
      <ResumenPeriodo resumen={r ?? null} moneda={moneda} />
      <StatStrip
        stats={[
          { label: 'Conciliados', value: cifra(r?.conciliados), tone: 'ok' },
          { label: 'Por revisar', value: cifra(r?.por_revisar), tone: r && r.por_revisar.cantidad > 0 ? 'warn' : undefined },
          { label: 'Abonos sin voucher', value: cifra(r?.sin_pago), tone: r && r.sin_pago.cantidad > 0 ? 'bad' : undefined, hint: 'Alguien pagó y no subió su voucher' },
          { label: 'Vouchers sin abono', value: cifra(r?.vouchers_sin_abono), tone: r && r.vouchers_sin_abono.cantidad > 0 ? 'bad' : undefined, hint: 'Validados, pero el dinero no está en el banco' },
        ]}
      />
      {resumen.error && <Alert tone="bad">{resumen.error}</Alert>}
      {r && r.vouchers_sin_abono.cantidad > 0 && pestana !== 'sin_abono' && (
        <div className="mb-4"><Alert tone="warn"><p>Hay {r.vouchers_sin_abono.cantidad} {r.vouchers_sin_abono.cantidad === 1 ? 'voucher validado' : 'vouchers validados'} ({dinero(r.vouchers_sin_abono.monto, moneda)}) sin abono en el extracto: el voucher podría no corresponder a dinero real. <button type="button" className="font-medium underline" onClick={() => setPestana('sin_abono')}>Verlos</button></p></Alert></div>
      )}
      <div className="mb-4 overflow-x-auto"><Tabs value={pestana} onChange={setPestana} items={PESTANAS} /></div>
      <Card>
        {pestana === 'sin_abono' ? (
          <>
            <p className="px-4 pt-4 text-sm text-muted">Pagos validados dentro de los días que cubren tus extractos que no tienen ningún abono. No incluye los pagos en efectivo ni los que están por revisar arriba.</p>
            <DataTable caption="Vouchers sin abono en el banco" columns={columnasSinAbono} rows={sinAbono.data?.items ?? []} rowKey={p => p.id} loading={sinAbono.loading} error={sinAbono.error} onRetry={sinAbono.reload}
              empty={{ title: 'Ningún voucher sin abono', description: r?.rango ? 'Todos los pagos validados del periodo tienen su abono en el banco.' : 'Sube un extracto para compararlo con tus pagos validados.', icon: <ArrowsRightLeftIcon /> }} />
          </>
        ) : pestana === 'salida' ? (
          <>
            <p className="px-4 pt-4 text-sm text-muted">Cargos del banco: comisiones, pagos de servicios, retiros… No se cruzan con los pagos de los vecinos.{r && r.salidas.cantidad > 0 ? <> Total: <span className="num font-medium text-ink">{dinero(r.salidas.monto, moneda)}</span> en {r.salidas.cantidad} {r.salidas.cantidad === 1 ? 'salida' : 'salidas'}.</> : null}</p>
            <DataTable caption="Salidas del extracto" columns={columnasSalidas} rows={lista.items} rowKey={m => m.id} loading={lista.loading} error={lista.error} onRetry={lista.reload}
              page={lista.page} pageSize={lista.pageSize} total={lista.total} onPage={lista.setPage}
              empty={{ title: 'Sin salidas', description: 'El extracto no trae cargos, o aún no subiste ninguno.', icon: <ArrowsRightLeftIcon /> }} />
          </>
        ) : (
          <>
            {pestana === 'fuera_periodo' && <p className="px-4 pt-4 text-sm text-muted">Abonos sin voucher cuya fecha queda fuera de los días que cubren tus pagos registrados: todavía no hay nada que cruzar. No cuentan como «abonos sin voucher»; si registras pagos de esos días, vuelven allí al cruzar.</p>}
          <DataTable caption="Abonos del extracto" columns={columns} rows={lista.items} rowKey={m => m.id} loading={lista.loading} error={lista.error} onRetry={lista.reload}
            page={lista.page} pageSize={lista.pageSize} total={lista.total} onPage={lista.setPage} onRowClick={setAbierto}
            empty={{ title: pestana === 'todos' ? 'Sin abonos todavía' : 'Nada en esta pestaña', description: pestana === 'todos' ? 'Sube el extracto del banco para ver y cruzar sus abonos.' : 'Prueba con otra pestaña.', icon: <ArrowsRightLeftIcon />,
              action: pestana === 'todos' ? <Bloqueable>{b => <Button disabled={b} onClick={() => setSubiendo(true)}>Subir extracto</Button>}</Bloqueable> : undefined }} />
          </>
        )}
      </Card>
      {subiendo && <SubirExtractoModal cuenta={cuenta} onClose={() => setSubiendo(false)} onDone={recargar} />}
      <MovimientoModal cuenta={cuenta} movimiento={abierto} onClose={() => setAbierto(null)} onChanged={recargar} />
    </>
  );
}
