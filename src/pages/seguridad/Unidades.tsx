import { KeyIcon } from '@heroicons/react/24/outline';
import { useList } from '../../api';
import { Card, DataTable, PageHeader, SearchBox, StatusBadge, Toolbar } from '../../ui';
import type { Column } from '../../ui';

interface Fila {
  id: number;
  codigo: string;
  tipo: string;
  estado: string | null;
  propietario?: { id: number; nombre: string } | null;
  inquilino?: { id: number; nombre: string } | null;
}

const capitalizar = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function Unidades() {
  const list = useList<Fila>('/api/unidades', { params: { orden: 'codigo:asc' } });

  const columns: Column<Fila>[] = [
    { key: 'codigo', header: 'Unidad', cell: f => (
      <div className="min-w-0">
        <p className="num font-medium">{f.codigo}</p>
        <p className="break-words text-xs text-muted sm:hidden">{f.inquilino?.nombre ?? f.propietario?.nombre ?? 'Sin residente'}</p>
      </div>
    ) },
    { key: 'tipo', header: 'Tipo', hideBelow: 'sm', cell: f => capitalizar(f.tipo) },
    { key: 'propietario', header: 'Propietario', hideBelow: 'sm', cell: f => f.propietario?.nombre ?? '—' },
    { key: 'inquilino', header: 'Inquilino', hideBelow: 'sm', cell: f => f.inquilino?.nombre ?? '—' },
    { key: 'estado', header: 'Estado', cell: f => <StatusBadge estado={f.estado ?? 'activa'} /> },
  ];

  return (
    <>
      <PageHeader title="Unidades" description="Consulta a quién visitar en tu condominio. Es de sólo lectura." />
      <Card>
        <Toolbar><SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por código de unidad" /></Toolbar>
        <DataTable
          caption="Unidades del condominio"
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
            title: list.q ? 'Sin resultados' : 'Tu condominio aún no tiene unidades',
            description: list.q ? 'Revisa el código e inténtalo de nuevo.' : 'Cuando la administración registre las unidades, podrás consultarlas aquí.',
            icon: <KeyIcon />,
          }}
        />
      </Card>
    </>
  );
}
