import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BanknotesIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useCondominio, useTorreElegida } from '../../app/condominio';
import { useList } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, DataTable, PageHeader, Select, Skeleton, StatStrip, StatusBadge, Tabs, Toolbar, dinero, dinerosPorMoneda, fechaCorta, sumaPorMoneda } from '../../ui';
import type { Column } from '../../ui';
import { METODOS, metodoLabel } from './_parts/cobranza/comun';
import { esTesorero, estadoRevision, insigniaConformidad } from './_parts/cobranza/conformidad';
import { esJunta } from '../../auth/junta';
import { RegistrarPagoModal } from './_parts/cobranza/RegistrarPagoModal';
import { SelectoresUbicacion } from './_parts/cobranza/SelectoresUbicacion';
import { ValidarPagoModal } from './_parts/cobranza/ValidarPagoModal';
import type { PagoRevisable } from './_parts/cobranza/ValidarPagoModal';
import { Bloqueable } from '../../app/Bloqueable';

type Pestana = 'por_validar' | 'validado' | 'rechazado';

const PESTANAS: { id: Pestana; label: string }[] = [
  { id: 'por_validar', label: 'Por validar' },
  { id: 'validado', label: 'Validados' },
  { id: 'rechazado', label: 'Rechazados' },
];

const TEXTOS: Record<Pestana, { stat: string; tone: 'ok' | 'warn' | 'bad'; vacio: string; vacioDesc: string }> = {
  por_validar: { stat: 'Por validar en esta página', tone: 'warn', vacio: 'No hay pagos por validar', vacioDesc: 'Cuando un vecino registre el pago de su mantenimiento, aparecerá aquí para que lo revises.' },
  validado: { stat: 'Cobrado en esta página', tone: 'ok', vacio: 'No hay pagos validados', vacioDesc: 'Los pagos que valides o registres tú aparecerán aquí.' },
  rechazado: { stat: 'Rechazado en esta página', tone: 'bad', vacio: 'No hay pagos rechazados', vacioDesc: 'Los pagos que rechaces quedarán aquí con su motivo.' },
};

type PagoFila = PagoRevisable;

const COLOR_ESTADO = { ok: 'font-medium text-ok', warn: 'font-medium text-warn', neutral: 'text-muted' } as const;

/** «Voucher ✓ · IA: coincide · Tesorero: pendiente»: lo que falta para que el pago se valide (solo si coinciden la IA y el tesorero, o a mano con el check). */
function EstadoRevision({ pago }: { pago: PagoFila }) {
  const e = estadoRevision(pago);
  return (
    <span className="block text-xs leading-5" aria-label="Estado de la revisión">
      <span className={pago.comprobante ? COLOR_ESTADO.ok : COLOR_ESTADO.warn}>Voucher {e.voucher}</span>
      <span className="text-muted"> · IA: </span><span className={COLOR_ESTADO[e.ia.tone]}>{e.ia.label}</span>
      <span className="text-muted"> · Tesorero: </span><span className={COLOR_ESTADO[e.tesorero.tone]}>{e.tesorero.label}</span>
    </span>
  );
}

export default function Pagos() {
  const { user } = useAuth();
  // La administración y la junta (presidente o tesorero, en su torre) registran pagos; un propietario sin cargo no llega a esta pantalla.
  const junta = esJunta(user);
  const puedeRegistrar = user?.rol !== 'propietario' || junta;
  const [pestana, setPestana] = useState<Pestana>('por_validar');
  const [metodo, setMetodo] = useState('');
  const [conformidad, setConformidad] = useState<'' | 'con' | 'sin'>('');
  const tesorero = esTesorero(user);
  const { complejo } = useCondominio();
  const [torre, setTorre] = useTorreElegida();
  const [revisando, setRevisando] = useState<PagoFila | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const list = useList<PagoFila>('/api/pagos', {
    // Los más antiguos primero en «Por validar»: es una cola de trabajo.
    params: { estado_validacion: pestana, metodo_pago: metodo || undefined, conformidad: conformidad || undefined, complejo_id: complejo || undefined, estructura_id: torre || undefined, orden: pestana === 'por_validar' ? 'fecha_pago:asc' : undefined },
  });
  const textos = TEXTOS[pestana];

  // La suma de la página va POR MONEDA: dos condominios de monedas distintas nunca se suman.
  const montosPagina = list.items.map(p => ({ monto: p.mantenimiento?.total ?? p.monto, moneda: p.moneda }));
  const monedasEnPagina = sumaPorMoneda(montosPagina).length;
  const cargandoStats = list.loading && list.items.length === 0;
  // Cada torre cobra a su cuenta: la suma de la página puede juntar varias; se dice, y filtrar por torre las separa.
  const torresEnPagina = new Set(list.items.map(p => p.unidad?.estructura?.id ?? 0)).size;
  const filtrando = Boolean(metodo || torre || conformidad);

  // Una fila por PAGO DEL MANTENIMIENTO (no por concepto): cabe a 1280 px sin scroll; lo secundario se oculta según el ancho.
  const monto = (p: PagoFila) => p.mantenimiento?.total ?? p.monto;
  const columns: Column<PagoFila>[] = [
    { key: 'fecha', header: 'Fecha', cell: p => <span className="whitespace-nowrap">{fechaCorta(p.fecha_pago)}</span> },
    { key: 'mant', header: 'Mantenimiento', cell: p => (
      <span className="block min-w-0">
        <span className="block font-medium">{p.mantenimiento ? p.mantenimiento.titulo.split(' · ')[0] : p.concepto?.nombre ?? 'Pago'}</span>
        <span className="block text-xs text-muted">
          <span className="num">{p.unidad?.codigo ?? '—'}</span>{p.unidad?.estructura?.nombre ? ` · ${p.unidad.estructura.nombre}` : ''}{p.mantenimiento ? ` · ${p.mantenimiento.conceptos} conceptos` : ' · un solo concepto'}
          {p.usuario?.nombre && <span className="hidden 2xl:inline"> · {p.usuario.nombre}</span>}
        </span>
      </span>
    ) },
    { key: 'torre', header: 'Torre', hideBelow: 'xl', cell: p => (
      <span className="block">{p.unidad?.estructura?.nombre ?? '—'}{p.unidad?.complejo && <span className="block text-xs text-muted">{p.unidad.complejo.nombre}</span>}</span>
    ) },
    { key: 'metodo', header: 'Método', hideBelow: 'lg', cell: p => (
      <span className="block"><Badge>{metodoLabel(p.metodo_pago)}</Badge>{p.referencia && <span className="num mt-1 block text-xs text-muted">{p.referencia}</span>}</span>
    ) },
    ...(pestana === 'rechazado' ? [{ key: 'motivo', header: 'Motivo', hideBelow: 'md' as const, cell: (p: PagoFila) => <span className="text-muted">{p.motivo_rechazo ?? '—'}</span> }] : []),
    { key: 'monto', header: 'Total', align: 'right', cell: p => <span className="num whitespace-nowrap font-medium">{dinero(monto(p), p.moneda)}</span> },
    { key: 'estado', header: 'Estado', cell: p => (
      <span className="flex flex-col items-start gap-1">
        <StatusBadge estado={p.estado_validacion} />
        {p.validado_por_ia && <Badge tone="brand">{p.conformidad ? 'Validado por IA + tesorero' : 'Validado por IA'}</Badge>}
        {pestana === 'por_validar'
          ? <EstadoRevision pago={p} />
          : (() => { const c = insigniaConformidad(p); return c && <Badge tone={c.tone}>{c.label}</Badge>; })()}
        {p.aviso_multa && <Badge tone="warn">Multa por quitar</Badge>}
      </span>
    ) },
    { key: 'acciones', header: '', align: 'right', cell: p => <Button size="sm" variant={p.estado_validacion === 'por_validar' ? 'primary' : 'secondary'} onClick={() => setRevisando(p)}>{p.estado_validacion === 'por_validar' ? 'Revisar' : 'Ver'}</Button> },
  ];

  return (
    <>
      <PageHeader
        title="Pagos"
        description={junta ? (tesorero ? 'Revisa los comprobantes de los vecinos de tu torre y confirma que el dinero llegó a la cuenta o al Yape de la junta: la administración verá tu conformidad y valida el pago. También puedes registrar aquí los pagos que recibas directamente.' : 'Revisa los comprobantes de los vecinos de tu torre. El tesorero confirma que el dinero llegó a la cuenta o al Yape de la junta y la administración valida el pago. También puedes registrar aquí los pagos que recibas directamente.') : 'Cada fila es el pago de un mantenimiento (todos sus conceptos, un comprobante). Revisa los que registran los vecinos y registra aquí los que recibes por transferencia, Yape, Plin, efectivo o tarjeta.'}
        actions={puedeRegistrar ? (
          <>
            {/* La junta carga las lecturas de agua de su torre desde aquí (el menú de la junta no tiene esa entrada). */}
            {junta && <Link to="/junta/agua" className="inline-flex h-10 items-center rounded border border-line bg-surface px-4 text-sm font-medium transition-colors duration-150 hover:bg-surface2">Lecturas de agua</Link>}
            <Bloqueable>{b => <Button icon={<PlusIcon className="h-4 w-4" />} disabled={b} onClick={() => setRegistrando(true)}>Registrar pago</Button>}</Bloqueable>
          </>
        ) : undefined}
      />
      <StatStrip
        stats={[
          { label: textos.stat, value: cargandoStats ? <Skeleton className="h-7 w-28" /> : dinerosPorMoneda(montosPagina), tone: textos.tone, hint: !cargandoStats && monedasEnPagina > 1 ? 'Una cifra por moneda: no se suman' : !cargandoStats && torresEnPagina > 1 ? `Suma ${torresEnPagina} torres: filtra por torre para separarlas` : undefined },
          { label: 'Pagos en esta página', value: cargandoStats ? <Skeleton className="h-7 w-10" /> : list.items.length, hint: list.error ? undefined : `${list.total} en total` },
        ]}
      />
      <div className="mb-4 overflow-x-auto">
        <Tabs value={pestana} onChange={setPestana} items={PESTANAS} />
      </div>
      <Card>
        <Toolbar>
          <SelectoresUbicacion torre={torre} onTorre={setTorre} oculto={junta} />
          <Select label="Método de pago" className="w-full sm:w-52 [&_label]:sr-only" value={metodo} onChange={e => setMetodo(e.target.value)}>
            <option value="">Todos los métodos</option>
            {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
          <Select label="Conformidad del tesorero" className="w-full sm:w-56 [&_label]:sr-only" value={conformidad} onChange={e => setConformidad(e.target.value as '' | 'con' | 'sin')}>
            <option value="">Con o sin conformidad</option>
            <option value="con">Con conformidad</option>
            <option value="sin">Sin conformidad</option>
          </Select>
        </Toolbar>
        <DataTable
          caption="Pagos de mantenimientos"
          columns={columns}
          rows={list.items}
          rowKey={p => p.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          onRowClick={setRevisando}
          empty={{
            title: textos.vacio,
            description: filtrando ? 'Prueba con otro filtro.' : textos.vacioDesc,
            icon: <BanknotesIcon />,
            action: !puedeRegistrar || filtrando || pestana !== 'validado' ? undefined : <Bloqueable>{b => <Button disabled={b} onClick={() => setRegistrando(true)}>Registrar pago</Button>}</Bloqueable>,
          }}
        />
      </Card>

      <ValidarPagoModal pago={revisando} onClose={() => setRevisando(null)} onRevisado={() => void list.reload()} />
      {puedeRegistrar && registrando && <RegistrarPagoModal onClose={() => setRegistrando(false)} onSaved={() => { if (pestana === 'validado') void list.reload(); else setPestana('validado'); /* un pago del admin queda validado */ }} />}
    </>
  );
}
