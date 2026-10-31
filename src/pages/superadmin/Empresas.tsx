import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BuildingOffice2Icon, PlusIcon } from '@heroicons/react/24/outline';
import { useList } from '../../api';
import {
  Button, Card, DataTable, PageHeader, SearchBox, StatusBadge, Toolbar,
} from '../../ui';
import type { Column } from '../../ui';
import { ModalDeEmpresa, type FilaEmpresa } from './_parts/ModalDeEmpresa';

/** Lista de empresas administradoras: sólo el camino a la ficha, donde viven sus datos y sus acciones. */
export default function Empresas() {
  const navigate = useNavigate();
  const list = useList<FilaEmpresa>('/api/empresas');
  const [nueva, setNueva] = useState(false);

  const columns: Column<FilaEmpresa>[] = [
    { key: 'nombre', header: 'Empresa', cell: f => (
      <div className="min-w-0 max-w-[11rem] sm:max-w-none"><p className="truncate font-medium">{f.nombre}</p><p className="truncate text-xs text-muted">{f.email ?? 'Sin correo'}</p></div>
    ) },
    { key: 'ruc', header: 'RUC', hideBelow: 'sm', cell: f => <span className="num">{f.ruc ?? '—'}</span> },
    { key: 'representante', header: 'Representante legal', hideBelow: 'lg', cell: f => f.representante_legal ?? '—' },
    { key: 'telefono', header: 'Teléfono', hideBelow: 'md', cell: f => <span className="num">{f.telefono ?? '—'}</span> },
    { key: 'estado', header: 'Estado', cell: f => <StatusBadge estado={f.estado ?? 'activa'} /> },
    { key: 'ficha', header: '', align: 'right', hideBelow: 'sm', cell: f => (
      <Link to={`/superadmin/empresas/${f.id}`} className="inline-flex items-center rounded-md px-2 py-1 text-sm font-medium text-brand hover:underline">Ver ficha</Link>
    ) },
  ];

  return (
    <>
      <PageHeader
        title="Empresas"
        description="Administradoras de condominios que usan Torre."
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setNueva(true)}>Nueva empresa</Button>}
      />
      <Card>
        <Toolbar><SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por nombre o RUC" /></Toolbar>
        <DataTable
          onRowClick={f => navigate(`/superadmin/empresas/${f.id}`)}
          caption="Empresas administradoras"
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
            title: list.q ? 'Sin resultados' : 'Aún no hay empresas',
            description: list.q ? 'Prueba con otro nombre o RUC.' : 'Registra la primera administradora para que pueda crear sus condominios y usuarios.',
            icon: <BuildingOffice2Icon />,
            action: list.q ? undefined : <Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setNueva(true)}>Nueva empresa</Button>,
          }}
        />
      </Card>

      <ModalDeEmpresa empresa={nueva ? 'nueva' : null} onClose={() => setNueva(false)} onGuardado={() => void list.reload()} />
    </>
  );
}
