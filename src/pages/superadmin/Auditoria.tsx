import { useState } from 'react';
import { ClipboardDocumentListIcon, EyeIcon } from '@heroicons/react/24/outline';
import { useList } from '../../api';
import { Badge, Card, DataTable, DefinitionList, IconButton, Modal, PageHeader, Select, Toolbar } from '../../ui';
import type { Column, Tone } from '../../ui';
import { fechaHora } from './_parts/fechas';

interface Registro {
  id: number;
  fecha?: string | null;
  created_at?: string | null;
  usuario?: { id?: number; nombre: string; email?: string } | null;
  usuario_nombre?: string | null;
  accion: string;
  entidad: string;
  entidad_id?: number | string | null;
  ip?: string | null;
  detalle?: unknown;
}

const ACCIONES: Record<string, { label: string; tone: Tone }> = {
  crear: { label: 'Crear', tone: 'ok' },
  editar: { label: 'Editar', tone: 'info' },
  eliminar: { label: 'Eliminar', tone: 'bad' },
  login: { label: 'Inicio de sesión', tone: 'neutral' },
};
const ENTIDADES: Record<string, string> = {
  usuario: 'Usuario', empresa: 'Empresa', complejo: 'Condominio', piso: 'Piso', estructura: 'Estructura',
  unidad: 'Unidad', concepto: 'Concepto', recibo: 'Recibo', pago: 'Pago', tarea: 'Tarea',
};

const nombreUsuario = (r: Registro) => r.usuario?.nombre ?? r.usuario_nombre ?? 'Sistema';
const fechaDe = (r: Registro) => r.fecha ?? r.created_at;
const etiquetaEntidad = (e: string) => ENTIDADES[e.toLowerCase()] ?? e;
const accionDe = (a: string) => ACCIONES[a.toLowerCase()] ?? { label: a.charAt(0).toUpperCase() + a.slice(1), tone: 'neutral' as Tone };

function detalleTexto(d: unknown): string {
  if (d === null || d === undefined || d === '') return '';
  if (typeof d === 'string') {
    try { return JSON.stringify(JSON.parse(d), null, 2); } catch { return d; }
  }
  return JSON.stringify(d, null, 2);
}

export default function Auditoria() {
  const [entidad, setEntidad] = useState('');
  const [accion, setAccion] = useState('');
  const [ver, setVer] = useState<Registro | null>(null);
  const list = useList<Registro>('/api/auditoria', { params: { entidad, accion, orden: 'fecha:desc' } });
  const filtrado = !!(entidad || accion);

  const columns: Column<Registro>[] = [
    { key: 'fecha', header: 'Fecha y hora', cell: r => <span className="num whitespace-nowrap">{fechaHora(fechaDe(r))}</span> },
    { key: 'usuario', header: 'Usuario', cell: r => <span className="font-medium">{nombreUsuario(r)}</span> },
    { key: 'accion', header: 'Acción', cell: r => { const a = accionDe(r.accion); return <Badge tone={a.tone}>{a.label}</Badge>; } },
    { key: 'entidad', header: 'Entidad', hideBelow: 'sm', cell: r => etiquetaEntidad(r.entidad) },
    { key: 'entidad_id', header: 'ID', hideBelow: 'md', cell: r => <span className="num">{r.entidad_id ?? '—'}</span> },
    { key: 'ip', header: 'IP', hideBelow: 'lg', cell: r => <span className="num">{r.ip ?? '—'}</span> },
    { key: 'ver', header: '', align: 'right', cell: r => (
      <IconButton label={`Ver detalle del registro ${r.id}`} onClick={e => { e.stopPropagation(); setVer(r); }}><EyeIcon className="h-4 w-4" /></IconButton>
    ) },
  ];

  const detalle = ver ? detalleTexto(ver.detalle) : '';

  return (
    <>
      <PageHeader title="Auditoría" description="Registro de quién hizo qué en la plataforma. Es de sólo lectura." />
      <Card>
        <Toolbar>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Select label="Entidad" className="sm:w-48" value={entidad} onChange={e => setEntidad(e.target.value)}>
              <option value="">Todas las entidades</option>
              {Object.entries(ENTIDADES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
            <Select label="Acción" className="sm:w-48" value={accion} onChange={e => setAccion(e.target.value)}>
              <option value="">Todas las acciones</option>
              {Object.entries(ACCIONES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </div>
        </Toolbar>
        <DataTable
          caption="Registros de auditoría"
          columns={columns}
          rows={list.items}
          rowKey={r => r.id}
          loading={list.loading}
          error={list.error}
          onRetry={list.reload}
          page={list.page}
          pageSize={list.pageSize}
          total={list.total}
          onPage={list.setPage}
          onRowClick={setVer}
          empty={{
            title: filtrado ? 'Sin registros con esos filtros' : 'Aún no hay actividad registrada',
            description: filtrado ? 'Quita algún filtro para ver más registros.' : 'Cuando alguien cree, edite, elimine o inicie sesión, aparecerá aquí.',
            icon: <ClipboardDocumentListIcon />,
          }}
        />
      </Card>

      <Modal open={!!ver} onClose={() => setVer(null)} title="Detalle del registro" size="lg">
        {ver && (
          <div className="space-y-5">
            <DefinitionList
              items={[
                { label: 'Fecha y hora', value: fechaHora(fechaDe(ver)) },
                { label: 'Usuario', value: nombreUsuario(ver) },
                { label: 'Acción', value: <Badge tone={accionDe(ver.accion).tone}>{accionDe(ver.accion).label}</Badge> },
                { label: 'Entidad', value: etiquetaEntidad(ver.entidad) },
                { label: 'ID', value: ver.entidad_id != null ? String(ver.entidad_id) : '' },
                { label: 'IP', value: ver.ip ?? '' },
              ]}
            />
            <div>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Detalle</h3>
              {detalle
                ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded bg-surface2 p-4 font-mono text-xs text-ink">{detalle}</pre>
                : <p className="text-sm text-muted">Este registro no tiene datos adicionales.</p>}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
