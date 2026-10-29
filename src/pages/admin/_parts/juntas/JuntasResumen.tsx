import { Link } from 'react-router-dom';
import { UserGroupIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../../../api';
import { Card, fechaCorta } from '../../../../ui';
import { nombreAmbito, nombreGestion, palabraDe } from './tipos';
import type { FichaJunta, Junta, ListaJuntas } from './tipos';

interface Props {
  /** Los filtros de «Medios de pago»: '' = todos; la torre también puede ser «ninguna» (todo el condominio). */
  complejoId: string;
  torreId: string;
  /** La junta entra por «Mi junta»; la administración, por «Juntas directivas». */
  esJunta: boolean;
}

const quien = (j: Junta, cargo: 'presidente' | 'tesorero') => j.miembros.find(m => m.cargo === cargo)?.nombre ?? 'sin definir';

/**
 * Arriba de la lista de medios de pago: por block, quién es el presidente y el tesorero de la junta vigente y su correo, con el enlace a la junta.
 * Es la misma ficha que «Juntas directivas»: la cuenta que se ve abajo ES la cuenta de esta junta.
 */
export function JuntasResumen({ complejoId, torreId, esJunta }: Props) {
  const q = useResource<ListaJuntas>(torreId === 'ninguna' ? null : `/api/juntas${complejoId ? `?complejo_id=${complejoId}` : ''}`);
  const enlace = esJunta ? '/junta/mi-junta' : '/admin/juntas';
  const fichas = (q.data?.items ?? []).filter((f: FichaJunta) => f.estructura !== null && (!/^\d+$/.test(torreId) || String(f.estructura.id) === torreId));
  // Un condominio con 14 blocks no debe empujar la lista de medios fuera de la pantalla: se abre sola con pocos.
  if (q.error || !fichas.length) return null;
  return (
    <details open={fichas.length <= 3} className="mb-4 rounded-lg border border-line bg-surface shadow-card">
      <summary className="flex min-h-10 cursor-pointer items-center gap-2 px-4 py-2 text-sm font-semibold">
        <UserGroupIcon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        Junta vigente de cada {palabraDe(fichas)} · {fichas.length}
      </summary>
      <ul className="grid gap-3 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-3">
        {fichas.map(f => (
          <li key={`${f.complejo.id}:${f.estructura!.id}`}>
            <Card className="h-full p-3 text-sm shadow-none">
              <p className="font-medium">{nombreAmbito(f.estructura)}{f.vigente && <span className="font-normal text-muted"> · gestión {nombreGestion(f.vigente)}</span>}</p>
              {f.vigente ? (
                <>
                  <p className="mt-1 break-words">Presidente: {quien(f.vigente, 'presidente')}</p>
                  <p className="break-words">Tesorero: {quien(f.vigente, 'tesorero')}</p>
                  <p className="break-all text-muted">Correo: {f.vigente.correo ?? 'sin correo'}</p>
                  <p className="text-xs text-muted">Desde {fechaCorta(f.vigente.desde)}</p>
                </>
              ) : <p className="mt-1 text-muted">Sin junta registrada.</p>}
              <Link to={enlace} className="mt-2 inline-block font-medium text-brand underline underline-offset-2">{f.vigente ? 'Ver la junta' : esJunta ? 'Ver mi junta' : 'Registrar la junta'}</Link>
            </Card>
          </li>
        ))}
      </ul>
    </details>
  );
}
