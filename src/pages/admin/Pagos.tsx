import { useState } from 'react';
import { BanknotesIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useList } from '../../api';
import { Badge, Button, Card, DataTable, PageHeader, Select, Skeleton, StatStrip, Toolbar, fechaCorta, soles } from '../../ui';
import type { Column } from '../../ui';
import { METODOS, metodoLabel } from './_parts/cobranza/comun';
import { RegistrarPagoModal } from './_parts/cobranza/RegistrarPagoModal';

interface PagoFila {
  id: number;
  fecha_pago: string;
  monto: number | string;
  metodo_pago: string | null;
  referencia: string | null;
  unidad?: { codigo: string } | null;
  concepto?: { nombre: string } | null;
  usuario?: { nombre: string } | null;
}

export default function Pagos() {
  const [metodo, setMetodo] = useState('');
  const [registrando, setRegistrando] = useState(false);
  const list = useList<PagoFila>('/api/pagos', { params: { metodo_pago: metodo || undefined } });

  const cobradoPagina = list.items.reduce((s, p) => s + (Number(p.monto) || 0), 0);
  const cargandoStats = list.loading && list.items.length === 0;

  const columns: Column<PagoFila>[] = [
    { key: 'fecha', header: 'Fecha', cell: p => fechaCorta(p.fecha_pago) },
    { key: 'unidad', header: 'Unidad', cell: p => <span className="font-medium">{p.unidad?.codigo ?? '—'}</span> },
    { key: 'concepto', header: 'Concepto', hideBelow: 'md', cell: p => p.concepto?.nombre ?? '—' },
    { key: 'usuario', header: 'Pagó', hideBelow: 'lg', cell: p => p.usuario?.nombre ?? '—' },
    { key: 'metodo', header: 'Método', hideBelow: 'sm', cell: p => <Badge>{metodoLabel(p.metodo_pago)}</Badge> },
    { key: 'referencia', header: 'Referencia', hideBelow: 'lg', cell: p => <span className="num text-muted">{p.referencia || '—'}</span> },
    { key: 'monto', header: 'Monto', align: 'right', cell: p => <span className="num font-medium">{soles(p.monto)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Pagos"
        description="Cobros registrados por unidad. Registra aquí los que recibes por transferencia, Yape, Plin, efectivo o tarjeta."
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setRegistrando(true)}>Registrar pago</Button>}
      />
      <StatStrip
        stats={[
          { label: 'Cobrado en esta página', value: cargandoStats ? <Skeleton className="h-7 w-28" /> : soles(cobradoPagina), tone: 'ok' },
          { label: 'Pagos en esta página', value: cargandoStats ? <Skeleton className="h-7 w-10" /> : list.items.length, hint: list.error ? undefined : `${list.total} en total` },
        ]}
      />
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
          empty={{
            title: 'No hay pagos registrados',
            description: metodo ? 'Prueba con otro filtro.' : 'Cuando un residente pague, registra el cobro aquí para actualizar su deuda.',
            icon: <BanknotesIcon />,
            action: metodo ? undefined : <Button onClick={() => setRegistrando(true)}>Registrar pago</Button>,
          }}
        />
      </Card>

      {registrando && <RegistrarPagoModal onClose={() => setRegistrando(false)} onSaved={() => void list.reload()} />}
    </>
  );
}
