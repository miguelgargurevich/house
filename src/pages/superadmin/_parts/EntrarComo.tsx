import { useMemo, useState } from 'react';
import { ArrowRightEndOnRectangleIcon, UsersIcon } from '@heroicons/react/24/outline';
import { useList } from '../../../api';
import type { Rol } from '../../../auth/AuthContext';
import { ROL_LABEL } from '../../../app/nav';
import { Avatar, Button, Card, DataTable, SearchBox, Tabs, Toolbar } from '../../../ui';
import type { Column } from '../../../ui';
import { EntrarComoModal, type PersonaEntrable } from './EntrarComoModal';

type Grupo = '' | 'residente' | 'personal';
interface Fila {
  id: number; nombre: string; email: string; rol: Rol | null;
  empresa?: { id: number; nombre: string } | null;
  complejo?: { id: number; nombre: string } | null;
  unidades?: { id: number; codigo: string; complejo: { id: number; nombre: string } | null }[];
}

const sinCorreo = (email: string) => /@sin-correo\.invalid$/i.test(email);
const dondeEsta = (f: Fila) => f.empresa?.nombre ?? f.unidades?.[0]?.complejo?.nombre ?? f.complejo?.nombre ?? '—';
const deptos = (f: Fila) => (f.unidades ?? []).map(u => u.codigo).join(', ');

/** Superadmin › Usuarios del sistema › «Entrar como»: busca a cualquier persona (administración, personal o vecino) y entra como ella para dar soporte. */
export function EntrarComo() {
  const [grupo, setGrupo] = useState<Grupo>('');
  const [persona, setPersona] = useState<PersonaEntrable | null>(null);
  const list = useList<Fila>('/api/usuarios', { params: { tipo: grupo || undefined } });

  const columns = useMemo<Column<Fila>[]>(() => [
    { key: 'persona', header: 'Persona', cell: f => (
      <span className="flex min-w-0 items-center gap-3">
        <Avatar nombre={f.nombre} size="sm" />
        <span className="min-w-0"><span className="block truncate font-medium">{f.nombre}</span><span className="block truncate text-xs text-muted">{sinCorreo(f.email) ? 'Sin correo' : f.email}</span></span>
      </span>
    ) },
    { key: 'rol', header: 'Rol', hideBelow: 'sm', cell: f => (f.rol ? ROL_LABEL[f.rol] : '—') },
    { key: 'donde', header: 'Dónde', hideBelow: 'md', cell: f => <>{dondeEsta(f)}{deptos(f) && <span className="block text-xs text-muted">{deptos(f)}</span>}</> },
    { key: 'acciones', header: '', align: 'right', cell: f => (f.rol === 'superadmin' || !f.rol ? <span className="text-xs text-muted">No disponible</span> : (
      <Button size="sm" variant="secondary" icon={<ArrowRightEndOnRectangleIcon className="h-4 w-4" aria-hidden="true" />} aria-label={`Entrar como ${f.nombre}`} onClick={() => setPersona({ id: f.id, nombre: f.nombre })}>Entrar como</Button>
    )) },
  ], []);

  return (
    <>
      <Card>
        <Toolbar>
          <Tabs<Grupo> value={grupo} onChange={setGrupo} label="Tipo de persona" items={[{ id: '', label: 'Todos' }, { id: 'residente', label: 'Vecinos' }, { id: 'personal', label: 'Personal' }]} />
          <SearchBox value={list.q} onChange={list.setQ} placeholder="Buscar por nombre, correo o celular…" />
        </Toolbar>
        <DataTable
          caption="Personas a las que puedes entrar como"
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
          empty={{ title: 'Nadie coincide con la búsqueda', description: 'Prueba con otro nombre, correo o celular.', icon: <UsersIcon /> }}
        />
      </Card>
      <EntrarComoModal persona={persona} onClose={() => setPersona(null)} />
    </>
  );
}
