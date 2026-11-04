import { EyeIcon } from '@heroicons/react/24/outline';
import { useList } from '../../../api';
import { ROL_LABEL } from '../../../app/nav';
import type { Rol } from '../../../auth/AuthContext';
import { Badge, Card, DataTable } from '../../../ui';
import type { Column, Tone } from '../../../ui';
import { fechaHora } from './fechas';

interface Fila {
  id: string;
  superadmin: { id: number; nombre: string; email: string } | null;
  usuario: { id: number; nombre: string; email: string; rol: Rol | null } | null;
  motivo: string;
  inicio_at: string;
  expira_at: string;
  fin_at: string | null;
  fin_motivo: 'salir' | 'vencio' | 'revocada' | null;
}

const FIN: Record<string, { label: string; tone: Tone }> = {
  salir: { label: 'Volvió a su cuenta', tone: 'ok' },
  vencio: { label: 'Venció', tone: 'warn' },
  revocada: { label: 'Se cerró la sesión', tone: 'bad' },
};

/** Superadmin › Auditoría › «Entrar como»: quién entró como quién, por qué, cuándo empezó, cuándo terminó y cómo. */
export function Impersonaciones() {
  const list = useList<Fila>('/api/impersonacion');
  const columns: Column<Fila>[] = [
    { key: 'inicio', header: 'Inicio', cell: f => <span className="num sm:whitespace-nowrap">{fechaHora(f.inicio_at)}</span> },
    { key: 'quien', header: 'Quién', cell: f => <span className="font-medium">{f.superadmin?.nombre ?? 'Cuenta eliminada'}</span> },
    { key: 'aquien', header: 'A quién', cell: f => <>{f.usuario?.nombre ?? 'Cuenta eliminada'}{f.usuario?.rol && <span className="block text-xs text-muted">{ROL_LABEL[f.usuario.rol]}</span>}</> },
    { key: 'motivo', header: 'Motivo', hideBelow: 'sm', cell: f => <span className="line-clamp-2 max-w-xs">{f.motivo}</span> },
    { key: 'fin', header: 'Fin', hideBelow: 'md', cell: f => <span className="num sm:whitespace-nowrap">{f.fin_at ? fechaHora(f.fin_at) : '—'}</span> },
    { key: 'como', header: 'Cómo terminó', cell: f => (f.fin_motivo ? <Badge tone={FIN[f.fin_motivo]?.tone ?? 'neutral'}>{FIN[f.fin_motivo]?.label ?? f.fin_motivo}</Badge> : <Badge tone="info">En curso</Badge>) },
  ];
  return (
    <Card>
      <DataTable
        caption="Entradas como otra persona"
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
        empty={{ title: 'Aún no has entrado como nadie', description: 'Cuando entres como otra persona para dar soporte, quedará aquí con su motivo.', icon: <EyeIcon /> }}
      />
    </Card>
  );
}
