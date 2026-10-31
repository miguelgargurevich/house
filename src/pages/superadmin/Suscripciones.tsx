import { useMemo, useState } from 'react';
import { CreditCardIcon } from '@heroicons/react/24/outline';
import { useList, useResource } from '../../api';
import { Badge, Button, Card, DataTable, PageHeader, SearchBox, Tabs, Toolbar, dinero, fechaCorta } from '../../ui';
import type { Column } from '../../ui';
import { ModalHistorial } from './_parts/suscripciones/ModalHistorial';
import { ModalPago } from './_parts/suscripciones/ModalPago';
import { ModalSuscripcion } from './_parts/suscripciones/ModalSuscripcion';
import { PreciosYPagos } from './_parts/suscripciones/Precios';
import { ESTADO_UI, MODULO_NOMBRE, type EstadoSuscripcion, type ModuloClave, type VistaSuscripcion } from '../shared/_parts/comercial';

type Vista = 'suscripciones' | 'precios';
type Filtro = '' | EstadoSuscripcion;

/** Suscripciones (superadmin): quién tiene qué plan y módulos, cuánto paga, hasta cuándo; registra pagos y edita precios. */
export default function Suscripciones() {
  const [vista, setVista] = useState<Vista>('suscripciones');
  const [filtro, setFiltro] = useState<Filtro>('');
  const list = useList<VistaSuscripcion>('/api/comercial/suscripciones', { params: { estado: filtro || undefined } });
  const planes = useResource<{ planes: { clave: string; nombre: string }[] }>('/api/comercial/catalogo');
  const [pago, setPago] = useState<VistaSuscripcion | null>(null);
  const [edicion, setEdicion] = useState<VistaSuscripcion | null>(null);
  const [historial, setHistorial] = useState<VistaSuscripcion | null>(null);

  const columns = useMemo<Column<VistaSuscripcion>[]>(() => [
    { key: 'condominio', header: 'Condominio', cell: s => <><span className="font-medium">{s.complejo}</span><span className="block text-xs text-muted">{s.empresa?.nombre ?? 'Sin empresa'} · {s.pais} · {s.unidades_maximas != null ? `${s.unidades_facturables} de ${s.unidades_maximas} deptos` : s.unidades_cobradas > s.unidades_facturables ? `${s.unidades_facturables} deptos (cobra ${s.unidades_cobradas})` : `${s.unidades_facturables} deptos`}</span><span className="block text-xs font-medium sm:hidden">{s.plan.nombre}</span></> },
    { key: 'plan', header: 'Plan', hideBelow: 'sm', cell: s => ( // en el celular el plan va bajo el condominio
      <>
        <span className="font-medium">{s.plan.nombre}</span>
        {s.modulos_activos.length > 0 && s.plan.clave !== 'pro' && s.plan.clave !== 'administradora' && s.plan.clave !== 'cortesia'
          ? <span className="mt-1 flex flex-wrap gap-1">{s.modulos_activos.map(m => <Badge key={m} tone="brand">{MODULO_NOMBRE[m as ModuloClave] ?? m}</Badge>)}</span>
          : s.plan.clave === 'gratis' ? <span className="block text-xs text-muted">sin IA, WhatsApp, mora ni reportes</span> : <span className="block text-xs text-muted">todo incluido</span>}
      </>
    ) },
    { key: 'monto', header: 'Al mes', align: 'right', hideBelow: 'sm', cell: s => <span className="num">{s.plan.clave === 'cortesia' ? '—' : (s.solicitud ? s.solicitud.consultar : s.precio_consultar) ? 'Consúltanos' : dinero((s.solicitud?.cotizacion ?? s.cotizacion).total_mes, s.moneda)}{s.solicitud && <span className="block text-xs text-muted">solicitado</span>}</span> },
    { key: 'estado', header: 'Estado', cell: s => <Badge tone={ESTADO_UI[s.estado].tone}>{ESTADO_UI[s.estado].label}</Badge> },
    { key: 'vigencia', header: 'Vigente hasta', hideBelow: 'md', cell: s => <span className="num text-muted">{s.plan.clave === 'cortesia' ? 'Sin vencimiento' : fechaCorta(s.vigente_hasta)}</span> },
    { key: 'acciones', header: '', align: 'right', cell: s => (
      <span className="flex flex-col items-end gap-1.5 whitespace-nowrap sm:flex-row sm:justify-end">
        <Button size="sm" onClick={() => setPago(s)} aria-label={`Registrar pago de ${s.complejo}`}>Registrar pago</Button>
        <Button size="sm" variant="secondary" onClick={() => setEdicion(s)} aria-label={`Cambiar plan de ${s.complejo}`}>Plan</Button>
        <Button size="sm" variant="ghost" onClick={() => setHistorial(s)} aria-label={`Ver pagos de ${s.complejo}`}>Pagos</Button>
      </span>
    ) },
  ], []);

  const recargar = () => { setPago(null); setEdicion(null); list.reload(); };

  return (
    <>
      <PageHeader title="Suscripciones" description="Planes y módulos por condominio. Cobro manual: registra el pago y se extiende la vigencia; lo solicitado y lo por vencer van primero." />
      <div className="mb-4"><Tabs<Vista> value={vista} onChange={setVista} label="Vista" items={[{ id: 'suscripciones', label: 'Suscripciones' }, { id: 'precios', label: 'Precios y pagos' }]} /></div>
      {vista === 'precios' ? <PreciosYPagos /> : (
        <Card>
          <Toolbar>
            <div className="max-w-full overflow-x-auto">
              <Tabs<Filtro> value={filtro} onChange={setFiltro} label="Estado" items={[{ id: '', label: 'Todas' }, { id: 'solicitada', label: 'Solicitadas' }, { id: 'por_vencer', label: 'Por vencer' }, { id: 'vencida', label: 'Vencidas' }, { id: 'activa', label: 'Activas' }, { id: 'gratis', label: 'Torre Gratis' }]} />
            </div>
            <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar condominio o empresa…" />
          </Toolbar>
          <DataTable
            caption="Suscripciones por condominio"
            columns={columns}
            rows={list.items}
            rowKey={s => s.complejo_id}
            loading={list.loading}
            error={list.error}
            onRetry={list.reload}
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPage={list.setPage}
            empty={{ title: 'Sin suscripciones', description: 'Cuando alguien se registre o pida un plan, aparecerá aquí.', icon: <CreditCardIcon /> }}
          />
        </Card>
      )}
      <ModalPago sus={pago} onClose={() => setPago(null)} onHecho={recargar} />
      <ModalSuscripcion sus={edicion} planes={planes.data?.planes ?? []} onClose={() => setEdicion(null)} onHecho={recargar} />
      <ModalHistorial sus={historial} onClose={() => setHistorial(null)} />
    </>
  );
}
