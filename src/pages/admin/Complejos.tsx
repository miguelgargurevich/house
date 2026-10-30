import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BuildingStorefrontIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useList, useResource } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  Alert, Badge, Button, Card, DataTable, PageHeader, SearchBox, Toolbar, fechaCorta,
} from '../../ui';
import type { Column } from '../../ui';
import { ModalDeComplejo, type FilaComplejo } from './_parts/condominio/ModalDeComplejo';

const cantidad = (f: FilaComplejo) => f._count?.unidades ?? f.unidades_count;

/** ¿Puede la administradora crear otro condominio? Gratis incluye uno: con uno ya en Gratis, no, y el motivo lo dice. */
interface PuedeAgregar { puede: boolean; motivo: string | null }

/** Lista de condominios: sólo el camino a la ficha, donde viven sus datos, sus torres y sus acciones. */
export default function Complejos() {
  const { user } = useAuth();
  const esSuper = user?.rol === 'superadmin';
  const list = useList<FilaComplejo>('/api/complejos');
  // El superadmin no tiene este límite: sólo la administradora pregunta.
  const puede = useResource<PuedeAgregar>(esSuper ? null : '/api/comercial/puede-agregar-condominio');
  const [nuevo, setNuevo] = useState(false);
  const [motivo, setMotivo] = useState(false);

  /** Con el límite de Gratis no se abre el formulario: se muestra el motivo y el camino a Mi plan. */
  function nuevoCondominio() {
    if (puede.data && !puede.data.puede) return setMotivo(true);
    setNuevo(true);
  }

  const columns: Column<FilaComplejo>[] = [
    { key: 'nombre', header: 'Condominio', cell: f => (
      <div className="tabla-texto-largo min-w-0"><p className="font-medium">{f.nombre}</p>{f.direccion && <p className="truncate text-xs text-muted sm:hidden">{f.direccion}</p>}</div>
    ) },
    { key: 'tipo', header: 'Tipo', hideBelow: 'sm', cell: f => <Badge tone="brand">{f.tipo}</Badge> },
    { key: 'direccion', header: 'Dirección', hideBelow: 'sm', cell: f => f.direccion ?? '—' },
    { key: 'empresa', header: 'Administrado por', hideBelow: 'lg', cell: f => (
      <div className="min-w-0"><p className="truncate">{f.empresa?.nombre ?? '—'}</p>{f.contrato_vigente && <p className="truncate text-xs text-muted">Desde <span className="num">{fechaCorta(f.contrato_vigente.fecha_inicio)}</span></p>}</div>
    ) },
    { key: 'unidades', header: 'Unidades', align: 'right', hideBelow: 'md', cell: f => <span className="num">{cantidad(f) ?? '—'}</span> },
    { key: 'ficha', header: '', align: 'right', cell: f => (
      <Link to={`/admin/condominios/${f.id}`} className="inline-flex items-center rounded-md px-2 py-1 text-sm font-medium text-brand hover:underline">Ver ficha</Link>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="Condominios"
        description="Edificios, condominios y conjuntos residenciales que administras. Cada unidad y cada recibo pertenece a uno."
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={nuevoCondominio}>Nuevo condominio</Button>}
      />
      {motivo && puede.data?.motivo && (
        <Alert tone="info">
          {puede.data.motivo} <Link to="/admin/mi-plan" className="font-medium text-brand hover:underline">Ver Mi plan</Link>
        </Alert>
      )}
      <Card>
        <Toolbar><SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por nombre o dirección" /></Toolbar>
        <DataTable
          caption="Condominios"
          columns={columns}
          rows={list.items}
          rowKey={f => f.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          empty={{
            title: list.q ? 'Sin resultados' : 'Aún no hay condominios',
            description: list.q ? 'Prueba con otra búsqueda.' : 'Registra el primero para poder crear sus unidades y emitir recibos.',
            icon: <BuildingStorefrontIcon />,
            action: list.q ? undefined : <Button icon={<PlusIcon className="h-4 w-4" />} onClick={nuevoCondominio}>Nuevo condominio</Button>,
          }}
        />
      </Card>

      <ModalDeComplejo complejo={nuevo ? 'nuevo' : null} esSuper={esSuper} onClose={() => setNuevo(false)} onGuardado={() => { void list.reload(); void puede.reload(); }} />
    </>
  );
}
