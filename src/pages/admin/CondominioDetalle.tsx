import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeftIcon, DocumentTextIcon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import {
  Button, Card, ConfirmDialog, DefinitionList, ErrorState, PageHeader, Skeleton, StatStrip, TabPanel, Tabs, fechaCorta, soles, useToast,
} from '../../ui';
import { TorresDelCondominio } from './_parts/condominio/TorresDelCondominio';
import { ModalDeComplejo, type FilaComplejo } from './_parts/condominio/ModalDeComplejo';
import { ListaDeUnidades } from './_parts/unidades/ListaDeUnidades';
import type { FilaUnidad } from './_parts/unidades/tipos';
import PersonasLista from './_parts/personas/PersonasLista';
import { ContratosModal } from './_parts/personas/ContratosModal';
import { ListaDeRecibos } from './Recibos';

const VISTAS = [
  { id: 'datos', label: 'Datos' },
  { id: 'torres', label: 'Torres' },
  { id: 'unidades', label: 'Unidades' },
  { id: 'residentes', label: 'Residentes' },
  { id: 'recibos', label: 'Recibos' },
] as const;

type Vista = typeof VISTAS[number]['id'];
const esVista = (v: string | null): v is Vista => VISTAS.some(x => x.id === v);

/** Ficha del condominio: sus datos, sus torres, sus unidades, sus residentes y sus recibos. */
export default function CondominioDetalle() {
  const { id } = useParams();
  const complejoId = Number(id);
  const { user } = useAuth();
  const esSuper = user?.rol === 'superadmin';
  const toast = useToast();
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  const vista: Vista = esVista(params.get('vista')) ? (params.get('vista') as Vista) : 'datos';
  const [editando, setEditando] = useState<FilaComplejo | 'nuevo' | null>(null);
  const [contratos, setContratos] = useState<FilaComplejo | null>(null);
  const [borrar, setBorrar] = useState<FilaComplejo | null>(null);
  const [busy, setBusy] = useState(false);
  const [editandoUnidad, setEditandoUnidad] = useState<FilaUnidad | 'nuevo' | null>(null);

  const complejo = useResource<FilaComplejo>(Number.isInteger(complejoId) && complejoId > 0 ? `/api/complejos/${complejoId}` : null);

  if (!Number.isInteger(complejoId) || complejoId <= 0) return <Card><ErrorState message="Condominio no válido" /></Card>;

  const c = complejo.data;
  const irA = (v: Vista) => setParams(v === 'datos' ? {} : { vista: v });

  async function eliminar() {
    if (!borrar) return;
    setBusy(true);
    try {
      await api(`/api/complejos/${borrar.id}`, { method: 'DELETE' });
      toast.ok('Condominio eliminado');
      setBorrar(null);
      navegar('/admin/complejos');
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <Link to="/admin/complejos" className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"><ArrowLeftIcon className="h-4 w-4" />Condominios</Link>
      {complejo.error ? (
        <Card><ErrorState message={complejo.error} onRetry={complejo.reload} /></Card>
      ) : (
        <>
          <PageHeader
            title={c?.nombre ?? (complejo.loading ? 'Cargando…' : 'Condominio')}
            description={c ? [c.tipo, c.direccion, c.empresa?.nombre ? `Administrado por ${c.empresa.nombre}` : null].filter(Boolean).join(' · ') : undefined}
          />
          <StatStrip
            stats={[
              { label: 'Unidades', value: c ? (c.unidades_count ?? c._count?.unidades ?? 0) : <Skeleton className="h-7 w-10" /> },
              { label: 'Torres', value: c ? (c.blocks_count ?? 0) : <Skeleton className="h-7 w-10" /> },
              { label: 'Administrado por', value: c ? (c.empresa?.nombre ?? '—') : <Skeleton className="h-7 w-28" /> },
            ]}
          />
        </>
      )}

      <div className="mb-4">
        <Tabs value={vista} onChange={irA} items={VISTAS.map(v => ({ id: v.id, label: v.label }))} idBase="ficha-complejo" label="Ficha del condominio" />
      </div>

      <TabPanel idBase="ficha-complejo" id="datos" value={vista}>
        <Card>
          {c ? (
            <div className="p-5">
              <div className="mb-4 flex flex-wrap justify-end gap-2">
                <Button variant="secondary" icon={<DocumentTextIcon className="h-4 w-4" />} onClick={() => setContratos(c)}>Contratos</Button>
                <Button icon={<PencilSquareIcon className="h-4 w-4" />} onClick={() => setEditando(c)}>Editar</Button>
                <Button variant="danger" icon={<TrashIcon className="h-4 w-4" />} onClick={() => setBorrar(c)}>Eliminar</Button>
              </div>
              <DefinitionList
                items={[
                  { label: 'Nombre', value: c.nombre },
                  { label: 'Tipo', value: c.tipo },
                  { label: 'Dirección', value: c.direccion },
                  { label: 'Administrado por', value: c.empresa?.nombre ?? '—' },
                  { label: 'Contrato vigente', value: c.contrato_vigente ? `Desde ${fechaCorta(c.contrato_vigente.fecha_inicio)}` : 'Sin contrato vigente' },
                  { label: 'Mora por pago fuera de fecha', value: c.mora_monto != null ? (Number(c.mora_monto) > 0 ? `${soles(c.mora_monto)} en el recibo del mes siguiente` : 'Sin mora') : '—' },
                  { label: 'Descripción', value: c.descripcion },
                ]}
              />
            </div>
          ) : (
            <div className="space-y-3 p-5"><Skeleton className="h-6 w-64" /><Skeleton className="h-20 w-full" /></div>
          )}
        </Card>
      </TabPanel>

      <TabPanel idBase="ficha-complejo" id="torres" value={vista}>
        <TorresDelCondominio complejoId={complejoId} />
      </TabPanel>

      <TabPanel idBase="ficha-complejo" id="unidades" value={vista}>
        <ListaDeUnidades complejoId={complejoId} complejoNombre={c?.nombre} editando={editandoUnidad} onEditando={setEditandoUnidad} />
      </TabPanel>

      <TabPanel idBase="ficha-complejo" id="residentes" value={vista}>
        <PersonasLista tipo="residente" complejoId={complejoId} sinEncabezado />
      </TabPanel>

      <TabPanel idBase="ficha-complejo" id="recibos" value={vista}>
        <ListaDeRecibos complejoId={complejoId} />
      </TabPanel>

      <ModalDeComplejo complejo={editando} esSuper={esSuper} onClose={() => setEditando(null)} onGuardado={() => void complejo.reload()} />
      {contratos && <ContratosModal complejo={contratos} puedeCambiar={esSuper} onClose={() => setContratos(null)} onCambiado={() => void complejo.reload()} />}

      <ConfirmDialog
        open={!!borrar}
        onClose={() => setBorrar(null)}
        onConfirm={eliminar}
        loading={busy}
        danger
        title="Eliminar condominio"
        message={`Se eliminará «${borrar?.nombre ?? ''}». Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar condominio"
      />
    </>
  );
}
