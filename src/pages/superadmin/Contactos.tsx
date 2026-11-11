import { useMemo, useState } from 'react';
import { InboxIcon } from '@heroicons/react/24/outline';
import { useList, useResource } from '../../api';
import { Badge, Card, DataTable, PageHeader, SearchBox, Tabs, Toolbar, fechaCorta, Button } from '../../ui';
import type { Column } from '../../ui';
import { ModalContacto } from './_parts/contactos/ModalContacto';
import { ModalReclamacion } from './_parts/contactos/ModalReclamacion';
import { textoPlazo, tonoPlazo, type Contacto, type Reclamacion } from './_parts/contactos/tipos';

type Vista = 'contactos' | 'reclamaciones';
type FiltroContacto = '' | 'nueva' | 'atendida';
type FiltroReclamacion = '' | 'pendiente' | 'respondida';

/** Contactos (mensajes de /contacto) y Reclamaciones (Libro de Reclamaciones virtual) de la web pública. Sólo superadmin. */
export default function Contactos() {
  const [vista, setVista] = useState<Vista>('contactos');
  const resumen = useResource<{ pendientes: number; vencidas: number }>('/api/comercial/reclamaciones?pageSize=1');
  const nuevos = useResource<{ nuevas: number }>('/api/comercial/contactos?pageSize=1');
  const pendientes = resumen.data?.pendientes ?? 0;
  const vencidas = resumen.data?.vencidas ?? 0;
  const recargarResumen = () => { resumen.reload(); nuevos.reload(); };

  return (
    <>
      <PageHeader title="Contactos y reclamaciones" description="Lo que llega desde la web pública: mensajes del formulario de contacto y hojas del Libro de Reclamaciones. Las reclamaciones se responden en 15 días hábiles (sábados y domingos no cuentan; los feriados sí)." />
      {vencidas > 0 && <p role="alert" className="mb-4 rounded-lg bg-bad-soft px-4 py-3 text-sm font-medium text-bad">{vencidas === 1 ? 'Hay 1 reclamación con el plazo vencido.' : `Hay ${vencidas} reclamaciones con el plazo vencido.`}</p>}
      <div className="mb-4">
        <Tabs<Vista> value={vista} onChange={setVista} label="Vista" items={[
          { id: 'contactos', label: `Contactos${nuevos.data?.nuevas ? ` · ${nuevos.data.nuevas}` : ''}` },
          { id: 'reclamaciones', label: `Reclamaciones${pendientes ? ` · ${pendientes}` : ''}` },
        ]} />
      </div>
      {vista === 'contactos' ? <ListaContactos onCambio={recargarResumen} /> : <ListaReclamaciones onCambio={recargarResumen} />}
    </>
  );
}

function ListaContactos({ onCambio }: { onCambio: () => void }) {
  const [filtro, setFiltro] = useState<FiltroContacto>('');
  const list = useList<Contacto>('/api/comercial/contactos', { params: { estado: filtro || undefined } });
  const [abierto, setAbierto] = useState<Contacto | null>(null);
  const columns = useMemo<Column<Contacto>[]>(() => [
    { key: 'quien', header: 'Quién', cell: c => <><span className="font-medium">{c.nombre}</span><span className="block text-xs text-muted">{c.correo}{c.celular ? ` · ${c.celular}` : ''}</span></> },
    { key: 'condominio', header: 'Condominio', hideBelow: 'md', cell: c => <>{c.condominio ?? '—'}{c.unidades ? <span className="block text-xs text-muted">{c.unidades} deptos{c.varios_condominios ? ' · varios condominios' : ''}</span> : null}</> },
    { key: 'tema', header: 'Tema', hideBelow: 'sm', cell: c => c.tema === 'demo' ? <Badge tone="brand">Demo</Badge> : c.tema === 'cierre_cuenta' ? <Badge tone="warn">Cierre de empresa</Badge> : c.tema === 'eliminar_cuenta' ? <Badge tone="warn">Eliminar cuenta</Badge> : <span className="text-muted">Consulta</span> },
    { key: 'fecha', header: 'Recibido', hideBelow: 'sm', cell: c => <span className="num text-muted">{fechaCorta(c.created_at)}</span> },
    { key: 'estado', header: 'Estado', cell: c => <Badge tone={c.estado === 'nueva' ? 'warn' : 'ok'}>{c.estado === 'nueva' ? 'Nuevo' : 'Atendido'}</Badge> },
    { key: 'ver', header: '', align: 'right', cell: c => <Button size="sm" variant="secondary" onClick={() => setAbierto(c)} aria-label={`Ver mensaje de ${c.nombre}`}>Ver</Button> },
  ], []);
  return (
    <Card>
      <Toolbar>
        <div className="max-w-full overflow-x-auto"><Tabs<FiltroContacto> value={filtro} onChange={setFiltro} label="Estado" items={[{ id: '', label: 'Todos' }, { id: 'nueva', label: 'Nuevos' }, { id: 'atendida', label: 'Atendidos' }]} /></div>
        <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar nombre, correo o condominio…" />
      </Toolbar>
      <DataTable caption="Mensajes de contacto" columns={columns} rows={list.items} rowKey={c => c.id} loading={list.loading} error={list.error} onRetry={list.reload}
        page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage}
        empty={{ title: 'Sin mensajes', description: 'Cuando alguien escriba desde /contacto, aparecerá aquí.', icon: <InboxIcon /> }} />
      <ModalContacto contacto={abierto} onClose={() => setAbierto(null)} onHecho={() => { setAbierto(null); list.reload(); onCambio(); }} />
    </Card>
  );
}

function ListaReclamaciones({ onCambio }: { onCambio: () => void }) {
  const [filtro, setFiltro] = useState<FiltroReclamacion>('');
  const list = useList<Reclamacion>('/api/comercial/reclamaciones', { params: { estado: filtro || undefined } });
  const [abierta, setAbierta] = useState<Reclamacion | null>(null);
  const columns = useMemo<Column<Reclamacion>[]>(() => [
    { key: 'hoja', header: 'Hoja', cell: r => <><span className="num font-medium">{r.correlativo}</span><span className="block text-xs text-muted">{r.tipo === 'queja' ? 'Queja' : 'Reclamo'} · {r.consumidor_nombre}</span></> },
    { key: 'fecha', header: 'Registrada', hideBelow: 'md', cell: r => <span className="num text-muted">{fechaCorta(r.created_at)}</span> },
    { key: 'plazo', header: 'Plazo', cell: r => <><Badge tone={tonoPlazo(r)}>{textoPlazo(r)}</Badge>{r.estado === 'pendiente' && <span className="num mt-1 block text-xs text-muted">Hasta el {fechaCorta(r.fecha_limite)}</span>}</> },
    { key: 'ver', header: '', align: 'right', cell: r => <Button size="sm" variant="secondary" onClick={() => setAbierta(r)} aria-label={`Ver hoja ${r.correlativo}`}>Ver</Button> },
  ], []);
  return (
    <Card>
      <Toolbar>
        <div className="max-w-full overflow-x-auto"><Tabs<FiltroReclamacion> value={filtro} onChange={setFiltro} label="Estado" items={[{ id: '', label: 'Todas' }, { id: 'pendiente', label: 'Pendientes' }, { id: 'respondida', label: 'Respondidas' }]} /></div>
        <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar número, nombre, correo o documento…" />
      </Toolbar>
      <DataTable caption="Hojas del Libro de Reclamaciones" columns={columns} rows={list.items} rowKey={r => r.id} loading={list.loading} error={list.error} onRetry={list.reload}
        page={list.page} pageSize={list.pageSize} total={list.total} onPage={list.setPage}
        empty={{ title: 'Sin reclamaciones', description: 'Las hojas del Libro de Reclamaciones aparecerán aquí, con los días que faltan para responder.', icon: <InboxIcon /> }} />
      <ModalReclamacion reclamacion={abierta} onClose={() => setAbierta(null)} onHecho={() => { setAbierta(null); list.reload(); onCambio(); }} />
    </Card>
  );
}
