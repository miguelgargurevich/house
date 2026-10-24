import { useState } from 'react';
import { BanknotesIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useList } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Badge, Button, Card, DataTable, PageHeader, Select, Skeleton, StatStrip, StatusBadge, Tabs, Toolbar, fechaCorta, soles } from '../../ui';
import type { Column } from '../../ui';
import { METODOS, metodoLabel } from './_parts/cobranza/comun';
import { RegistrarPagoModal } from './_parts/cobranza/RegistrarPagoModal';
import { ValidarPagoModal } from './_parts/cobranza/ValidarPagoModal';
import type { PagoRevisable } from './_parts/cobranza/ValidarPagoModal';

type Pestana = 'por_validar' | 'validado' | 'rechazado';

const PESTANAS: { id: Pestana; label: string }[] = [
  { id: 'por_validar', label: 'Por validar' },
  { id: 'validado', label: 'Validados' },
  { id: 'rechazado', label: 'Rechazados' },
];

const TEXTOS: Record<Pestana, { stat: string; tone: 'ok' | 'warn' | 'bad'; vacio: string; vacioDesc: string }> = {
  por_validar: { stat: 'Por validar en esta página', tone: 'warn', vacio: 'No hay pagos por validar', vacioDesc: 'Cuando un residente registre un pago, aparecerá aquí para que lo revises.' },
  validado: { stat: 'Cobrado en esta página', tone: 'ok', vacio: 'No hay pagos validados', vacioDesc: 'Los pagos que valides o registres tú aparecerán aquí.' },
  rechazado: { stat: 'Rechazado en esta página', tone: 'bad', vacio: 'No hay pagos rechazados', vacioDesc: 'Los pagos que rechaces quedarán aquí con su motivo.' },
};

type PagoFila = PagoRevisable;

export default function Pagos() {
  const { user } = useAuth();
  // La junta (propietario con cargo) sólo revisa los pagos de su block: registrar pagos es de la administración.
  const puedeRegistrar = user?.rol !== 'propietario';
  const [pestana, setPestana] = useState<Pestana>('por_validar');
  const [metodo, setMetodo] = useState('');
  const [revisando, setRevisando] = useState<PagoFila | null>(null);
  const [registrando, setRegistrando] = useState(false);
  const list = useList<PagoFila>('/api/pagos', {
    // Los más antiguos primero en «Por validar»: es una cola de trabajo.
    params: { estado_validacion: pestana, metodo_pago: metodo || undefined, orden: pestana === 'por_validar' ? 'fecha_pago:asc' : undefined },
  });
  const textos = TEXTOS[pestana];

  const cobradoPagina = list.items.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const cargandoStats = list.loading && list.items.length === 0;

  const columns: Column<PagoFila>[] = [
    { key: 'fecha', header: 'Fecha', cell: p => fechaCorta(p.fecha_pago) },
    { key: 'unidad', header: 'Unidad', cell: p => <span className="font-medium">{p.unidad?.codigo ?? '—'}</span> },
    { key: 'concepto', header: 'Concepto', hideBelow: 'md', cell: p => p.concepto?.nombre ?? '—' },
    { key: 'usuario', header: 'Pagó', hideBelow: 'lg', cell: p => p.usuario?.nombre ?? '—' },
    { key: 'metodo', header: 'Método', hideBelow: 'sm', cell: p => <Badge>{metodoLabel(p.metodo_pago)}</Badge> },
    { key: 'referencia', header: 'Referencia', hideBelow: 'lg', cell: p => <span className="num text-muted">{p.referencia || '—'}</span> },
    ...(pestana === 'rechazado' ? [{ key: 'motivo', header: 'Motivo', hideBelow: 'md' as const, cell: (p: PagoFila) => <span className="text-muted">{p.motivo_rechazo ?? '—'}</span> }] : []),
    { key: 'comprobante', header: 'Comprobante', hideBelow: 'sm', cell: p => (p.comprobante ? <Badge tone="info">Adjunto</Badge> : <span className="text-muted">Sin archivo</span>) },
    { key: 'monto', header: 'Monto', align: 'right', cell: p => <span className="num font-medium">{soles(p.monto)}</span> },
    { key: 'estado', header: 'Estado', cell: p => <StatusBadge estado={p.estado_validacion} /> },
    { key: 'acciones', header: '', align: 'right', cell: p => <Button size="sm" variant={p.estado_validacion === 'por_validar' ? 'primary' : 'secondary'} onClick={() => setRevisando(p)}>{p.estado_validacion === 'por_validar' ? 'Revisar' : 'Ver'}</Button> },
  ];

  return (
    <>
      <PageHeader
        title="Pagos"
        description={puedeRegistrar ? 'Revisa los pagos que registran los residentes y registra aquí los que recibes por transferencia, Yape, Plin, efectivo o tarjeta.' : 'Revisa los comprobantes de los vecinos de tu block: valida el pago si el dinero llegó a la cuenta o al Yape de la junta, o recházalo indicando el motivo.'}
        actions={puedeRegistrar ? <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setRegistrando(true)}>Registrar pago</Button> : undefined}
      />
      <StatStrip
        stats={[
          { label: textos.stat, value: cargandoStats ? <Skeleton className="h-7 w-28" /> : soles(cobradoPagina), tone: textos.tone },
          { label: 'Pagos en esta página', value: cargandoStats ? <Skeleton className="h-7 w-10" /> : list.items.length, hint: list.error ? undefined : `${list.total} en total` },
        ]}
      />
      <div className="mb-4 overflow-x-auto">
        <Tabs value={pestana} onChange={setPestana} items={PESTANAS} />
      </div>
      <Card>
        <Toolbar>
          <Select label="Método de pago" className="w-full sm:w-52 [&_label]:sr-only" value={metodo} onChange={e => setMetodo(e.target.value)}>
            <option value="">Todos los métodos</option>
            {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Toolbar>
        <DataTable
          caption="Pagos registrados"
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
            description: metodo ? 'Prueba con otro filtro.' : textos.vacioDesc,
            icon: <BanknotesIcon />,
            action: !puedeRegistrar || metodo || pestana !== 'validado' ? undefined : <Button onClick={() => setRegistrando(true)}>Registrar pago</Button>,
          }}
        />
      </Card>

      <ValidarPagoModal pago={revisando} onClose={() => setRevisando(null)} onRevisado={() => void list.reload()} />
      {puedeRegistrar && registrando && <RegistrarPagoModal onClose={() => setRegistrando(false)} onSaved={() => { if (pestana === 'validado') void list.reload(); else setPestana('validado'); /* un pago del admin queda validado */ }} />}
    </>
  );
}
