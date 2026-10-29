import { useResource } from '../../../../api';
import { Alert, Modal, Skeleton, fechaCorta } from '../../../../ui';
import { QrImagen } from '../medios/QrMiniatura';
import { cargoLabel, lineaCuenta, nombreAmbito, nombreGestion } from './tipos';
import type { Junta } from './tipos';

interface Props {
  /** El block (o el condominio, con `estructura: null`) cuyo historial se ve; `null` cierra el diálogo. */
  ambito: { complejo_id: number; estructura: { id: number; nombre: string | null } | null } | null;
  onClose: () => void;
}

/** Las gestiones anteriores de la junta, de la más reciente a la más antigua: sólo lectura. */
export function HistorialModal({ ambito, onClose }: Props) {
  const q = useResource<{ items: Junta[] }>(ambito ? `/api/juntas/historial?complejo_id=${ambito.complejo_id}&estructura_id=${ambito.estructura?.id ?? 'ninguna'}` : null);
  return (
    <Modal open={ambito !== null} onClose={onClose} size="lg" title="Historial de la junta" description={ambito ? `${nombreAmbito(ambito.estructura)} · gestiones anteriores (sólo lectura).` : undefined}>
      {q.loading && <Skeleton className="h-32 w-full" />}
      {q.error && <Alert tone="bad">No se pudo cargar el historial: {q.error}</Alert>}
      {q.data && q.data.items.length === 0 && <p className="text-sm text-muted">Aún no hay gestiones anteriores.</p>}
      <ol className="flex flex-col gap-5">
        {q.data?.items.map(j => (
          <li key={j.id} className="rounded-lg border border-line p-4">
            <h3 className="text-base font-semibold">Gestión {nombreGestion(j)}</h3>
            <p className="text-sm text-muted">Del {fechaCorta(j.desde)} al {fechaCorta(j.hasta)}</p>
            {j.notas && <p className="mt-1 whitespace-pre-line break-words text-sm">{j.notas}</p>}
            <dl className="mt-3 flex flex-col gap-2 text-sm">
              {j.miembros.map(m => (
                <div key={m.id} className="min-w-0">
                  <dt className="font-medium">{cargoLabel(m.cargo)}: <span className="break-words font-normal">{m.nombre}</span></dt>
                  <dd className="break-words text-xs text-muted">{[m.departamentos.join(', '), m.email, m.telefono].filter(Boolean).join(' · ')}</dd>
                </div>
              ))}
              {j.miembros.length === 0 && <p className="text-muted">Sin miembros registrados.</p>}
            </dl>
            <p className="mt-3 break-words text-sm"><span className="font-medium">Correo:</span> {j.correo ?? '—'}</p>
            <div className="mt-2 flex flex-col gap-2">
              {j.medios.length === 0 && <p className="text-sm text-muted">Sin cuenta registrada.</p>}
              {j.medios.map(m => (
                <div key={m.id} className="flex items-start gap-3 text-sm">
                  {m.tiene_qr && <QrImagen id={m.id} version={m.updated_at} alt={`Código QR de ${m.titular}`} className="h-16 w-16 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium">{lineaCuenta(m)}</p>
                    {m.tipo === 'banco' && m.numero_cuenta && <p className="num break-all">Cuenta {m.numero_cuenta}</p>}
                    {m.tipo === 'banco' && m.cci && <p className="num break-all">CCI {m.cci}</p>}
                    {(m.tipo === 'yape' || m.tipo === 'plin') && m.celular && <p className="num">{m.celular}</p>}
                    <p className="break-words text-muted">Titular: {m.titular}</p>
                  </div>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
