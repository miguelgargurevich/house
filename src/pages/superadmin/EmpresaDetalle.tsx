import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeftIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useList, useResource } from '../../api';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, DefinitionList, ErrorState, PageHeader, Skeleton, StatStrip, StatusBadge, TabPanel, Tabs, fechaCorta, useToast,
} from '../../ui';
import type { Column } from '../../ui';
import { ImagenEditable } from '../admin/_parts/condominio/ImagenEditable';
import PersonasLista from '../admin/_parts/personas/PersonasLista';
import { ModalDeEmpresa, type FilaEmpresa } from './_parts/ModalDeEmpresa';

const VISTAS = [
  { id: 'datos', label: 'Datos' },
  { id: 'personal', label: 'Personal' },
  { id: 'condominios', label: 'Condominios' },
] as const;

type Vista = typeof VISTAS[number]['id'];
const esVista = (v: string | null): v is Vista => VISTAS.some(x => x.id === v);

interface Empresa extends FilaEmpresa {
  fecha_inicio: string | null;
  logo_url?: string | null;
}

interface Complejo {
  id: number;
  nombre: string;
  tipo: string;
  direccion: string | null;
  empresa_id: number | null;
  unidades_count?: number;
  contrato_vigente?: { id: number; fecha_inicio: string } | null;
}

/** Ficha de la empresa administradora: sus datos, su personal y sus condominios. */
export default function EmpresaDetalle() {
  const { id } = useParams();
  const empresaId = Number(id);
  const toast = useToast();
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  const vista: Vista = esVista(params.get('vista')) ? (params.get('vista') as Vista) : 'datos';
  const [editando, setEditando] = useState<FilaEmpresa | null>(null);
  const [borrar, setBorrar] = useState<FilaEmpresa | null>(null);
  const [busy, setBusy] = useState(false);
  const empresa = useResource<Empresa>(Number.isInteger(empresaId) && empresaId > 0 ? `/api/empresas/${empresaId}` : null);
  const complejos = useList<Complejo>('/api/complejos', { params: { empresa_id: Number.isInteger(empresaId) && empresaId > 0 ? String(empresaId) : undefined }, pageSize: 100 });

  if (!Number.isInteger(empresaId) || empresaId <= 0) return <Card><ErrorState message="Empresa no válida" /></Card>;

  const e = empresa.data;
  const irA = (v: Vista) => setParams(v === 'datos' ? {} : { vista: v });

  async function eliminar() {
    if (!borrar) return;
    setBusy(true);
    try {
      await api(`/api/empresas/${borrar.id}`, { method: 'DELETE' });
      toast.ok('Empresa eliminada');
      setBorrar(null);
      navegar('/superadmin/empresas');
    } catch (err) { toast.error(errorText(err)); } finally { setBusy(false); }
  }

  const columns: Column<Complejo>[] = [
    { key: 'nombre', header: 'Condominio', cell: c => (
      <div className="min-w-0"><p className="truncate font-medium">{c.nombre}</p>{c.direccion && <p className="truncate text-xs text-muted sm:hidden">{c.direccion}</p>}</div>
    ) },
    { key: 'tipo', header: 'Tipo', cell: c => <Badge tone="brand">{c.tipo}</Badge> },
    { key: 'direccion', header: 'Dirección', hideBelow: 'sm', cell: c => c.direccion ?? '—' },
    { key: 'unidades', header: 'Unidades', align: 'right', hideBelow: 'md', cell: c => <span className="num">{c.unidades_count ?? '—'}</span> },
    { key: 'contrato', header: 'Contrato', hideBelow: 'md', cell: c => (c.contrato_vigente ? <span className="num">Desde {fechaCorta(c.contrato_vigente.fecha_inicio)}</span> : '—') },
    { key: 'ficha', header: '', align: 'right', cell: c => (
      <Link to={`/admin/condominios/${c.id}`} className="inline-flex items-center rounded-md px-2 py-1 text-sm font-medium text-brand hover:underline">Ver ficha</Link>
    ) },
  ];

  return (
    <>
      <Link to="/superadmin/empresas" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"><ArrowLeftIcon className="h-4 w-4" />Empresas</Link>
      {empresa.error ? (
        <Card><ErrorState message={empresa.error} onRetry={empresa.reload} /></Card>
      ) : (
        <>
          <PageHeader
            title={e?.nombre ?? (empresa.loading ? 'Cargando…' : 'Empresa')}
            description={e ? [e.representante_legal ? `Representante legal: ${e.representante_legal}` : null, e.ruc ? `RUC ${e.ruc}` : null].filter(Boolean).join(' · ') : undefined}
            actions={e ? <StatusBadge estado={e.estado ?? 'activa'} /> : undefined}
          />
          <StatStrip
            stats={[
              { label: 'Condominios', value: complejos.loading ? <Skeleton className="h-7 w-10" /> : complejos.total },
              { label: 'Estado', value: e ? (e.estado ?? 'activa') : <Skeleton className="h-7 w-20" /> },
              { label: 'Inicio de operaciones', value: e ? (e.fecha_inicio ? fechaCorta(e.fecha_inicio) : '—') : <Skeleton className="h-7 w-24" /> },
            ]}
          />
        </>
      )}

      <div className="mb-4">
        <Tabs value={vista} onChange={irA} items={VISTAS.map(v => ({ id: v.id, label: v.label }))} idBase="ficha-empresa" label="Ficha de la empresa" />
      </div>

      <TabPanel idBase="ficha-empresa" id="datos" value={vista}>
        <Card>
          {e ? (
            <div className="p-5">
              <div className="mb-4 flex flex-wrap justify-end gap-2">
                <Button icon={<PencilSquareIcon className="h-4 w-4" />} onClick={() => setEditando(e)}>Editar</Button>
                <Button variant="danger" icon={<TrashIcon className="h-4 w-4" />} onClick={() => setBorrar(e)}>Eliminar</Button>
              </div>
              <DefinitionList
                items={[
                  { label: 'Razón social', value: e.nombre },
                  { label: 'RUC', value: e.ruc },
                  { label: 'Estado', value: e.estado ?? 'activa' },
                  { label: 'Representante legal', value: e.representante_legal },
                  { label: 'Correo electrónico', value: e.email },
                  { label: 'Teléfono', value: e.telefono },
                  { label: 'Dirección', value: e.direccion },
                  { label: 'Inicio de operaciones', value: e.fecha_inicio ? fechaCorta(e.fecha_inicio) : null },
                ]}
              />
              <section aria-labelledby="logo-empresa" className="mt-6 border-t border-line pt-5">
                <h3 id="logo-empresa" className="mb-3 text-sm font-semibold">Recibo impreso</h3>
                <ImagenEditable titulo="Logo de la empresa" ayuda="Sale al pie de cada recibo de mantenimiento. JPG, PNG o WebP, hasta 2 MB." url={e.logo_url ?? null} ruta={`/api/empresas/${e.id}/logo`} onCambio={() => void empresa.reload()} />
              </section>
            </div>
          ) : (
            <div className="space-y-3 p-5"><Skeleton className="h-6 w-64" /><Skeleton className="h-20 w-full" /></div>
          )}
        </Card>
      </TabPanel>

      <TabPanel idBase="ficha-empresa" id="personal" value={vista}>
        <PersonasLista tipo="personal" empresaId={empresaId} sinEncabezado />
      </TabPanel>

      <TabPanel idBase="ficha-empresa" id="condominios" value={vista}>
        <Card>
          <DataTable
            caption="Condominios de la empresa"
            columns={columns}
            rows={complejos.items}
            rowKey={c => c.id}
            loading={complejos.loading}
            error={complejos.error}
            onRetry={complejos.reload}
            page={complejos.page}
            pageSize={complejos.pageSize}
            total={complejos.total}
            onPage={complejos.setPage}
            empty={{ title: 'Esta empresa no administra condominios', description: 'Cuando se le asigne uno aparecerá aquí.', icon: <ArrowLeftIcon /> }}
          />
        </Card>
      </TabPanel>

      <ModalDeEmpresa empresa={editando} onClose={() => setEditando(null)} onGuardado={() => void empresa.reload()} />

      <ConfirmDialog
        open={!!borrar}
        onClose={() => setBorrar(null)}
        onConfirm={eliminar}
        loading={busy}
        danger
        title="Eliminar empresa"
        message={`Se eliminará ${borrar?.nombre ?? 'la empresa'}. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar empresa"
      />
    </>
  );
}
