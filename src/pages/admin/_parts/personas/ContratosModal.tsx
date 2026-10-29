import { useState } from 'react';
import { ArrowsRightLeftIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../../../api';
import type { Page } from '../../../../api';
import { ZONA_POR_DEFECTO } from '../../../../lib/paises';
import { Alert, Badge, Button, DataTable, ErrorState, Input, Modal, Select, Skeleton, Textarea, fechaCorta, useToast } from '../../../../ui';
import type { Column } from '../../../../ui';

interface Contrato { id: number; empresa: { id: number; nombre: string }; fecha_inicio: string; fecha_fin: string | null; observaciones: string | null }
interface Props {
  complejo: { id: number; nombre: string; empresa_id: number | null; empresa?: { id: number; nombre: string } | null; zona_horaria?: string };
  /** Sólo el superadmin cambia de administradora. */
  puedeCambiar: boolean;
  onClose: () => void;
  onCambiado: () => void;
}

/** El día de hoy (aaaa-mm-dd) en la zona del condominio: con él empieza el contrato nuevo si no se elige otra fecha. */
const hoyEn = (zona: string) => new Date().toLocaleDateString('en-CA', { timeZone: zona });

/** Historial de contratos de administración del condominio y, para el superadmin, el cambio de administradora. */
export function ContratosModal({ complejo, puedeCambiar, onClose, onCambiado }: Props) {
  const toast = useToast();
  const historial = useResource<Page<Contrato>>(`/api/complejos/${complejo.id}/contratos`);
  const empresas = useResource<Page<{ id: number; nombre: string }>>(puedeCambiar ? '/api/empresas?pageSize=100' : null);
  const [cambiando, setCambiando] = useState(false);
  const [empresa, setEmpresa] = useState('');
  const [desde, setDesde] = useState(hoyEn(complejo.zona_horaria ?? ZONA_POR_DEFECTO));
  const [notas, setNotas] = useState('');
  const [busy, setBusy] = useState(false);

  async function cambiar() {
    setBusy(true);
    try {
      await api(`/api/complejos/${complejo.id}/administradora`, { method: 'POST', json: { empresa_id: Number(empresa), fecha_inicio: desde, observaciones: notas } });
      toast.ok('Administradora cambiada');
      onCambiado();
      onClose();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  const columns: Column<Contrato>[] = [
    { key: 'empresa', header: 'Empresa', cell: c => (
      <div className="min-w-0"><p className="truncate font-medium">{c.empresa.nombre}</p>{c.observaciones && <p className="truncate text-xs text-muted">{c.observaciones}</p>}</div>
    ) },
    { key: 'desde', header: 'Desde', cell: c => <span className="num">{fechaCorta(c.fecha_inicio)}</span> },
    { key: 'hasta', header: 'Hasta', cell: c => (c.fecha_fin ? <span className="num">{fechaCorta(c.fecha_fin)}</span> : <Badge tone="ok">Vigente</Badge>) },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={`Administración de ${complejo.nombre}`}
      footer={cambiando
        ? <><Button variant="secondary" onClick={() => setCambiando(false)}>Volver</Button><Button loading={busy} disabled={!empresa || !desde} onClick={() => void cambiar()}>Cambiar de administradora</Button></>
        : <><Button variant="secondary" onClick={onClose}>Cerrar</Button>{puedeCambiar && <Button icon={<ArrowsRightLeftIcon className="h-4 w-4" />} onClick={() => setCambiando(true)}>Cambiar de administradora</Button>}</>}
    >
      {cambiando ? (
        <div className="grid gap-4">
          <Alert tone="warn">
            Desde la fecha elegida el condominio, sus unidades y sus residentes pasan a la nueva empresa, y el personal de la anterior destinado aquí queda liberado (cerramos sus sesiones).
            Los recibos ya emitidos siguen a nombre de la anterior; la nueva ve los que aún tienen deuda por cobrar.
          </Alert>
          <Select label="Nueva administradora" value={empresa} onChange={e => setEmpresa(e.target.value)} disabled={empresas.loading} hint={empresas.error ?? undefined}>
            <option value="">Elige una empresa</option>
            {(empresas.data?.items ?? []).filter(e => e.id !== complejo.empresa_id).map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </Select>
          <Input label="Vigente desde" type="date" value={desde} onChange={e => setDesde(e.target.value)} />
          <Textarea label="Observaciones (opcional)" value={notas} onChange={e => setNotas(e.target.value)} />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">Administrado por <span className="font-medium text-ink">{complejo.empresa?.nombre ?? 'ninguna empresa'}</span>. Estos son los contratos de administración de este condominio, del más reciente al más antiguo.</p>
          {historial.error ? (
            <ErrorState message={historial.error} onRetry={historial.reload} />
          ) : historial.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <DataTable
              caption="Contratos de administración"
              columns={columns}
              rows={historial.data?.items ?? []}
              rowKey={c => c.id}
              empty={{ title: 'Sin contratos registrados', description: 'Este condominio aún no tiene un contrato de administración registrado.' }}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
