import { Link } from 'react-router-dom';
import { BuildingLibraryIcon, DevicePhoneMobileIcon, PencilSquareIcon, PlusIcon, ReceiptPercentIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Badge, Button, Card, CardBody, CardHeader, IconButton, fechaCorta } from '../../../../ui';
import { Interruptor } from '../catalogo/Interruptor';
import { nombreAmbito, nombreGestion } from '../juntas/tipos';
import type { FichaJunta, Junta } from '../juntas/tipos';
import { datoPrincipal, monedaCorta, tipoLabel } from './tipos';
import type { Medio } from './tipos';

/** Un block (o la Junta central) con su junta vigente y las cuentas donde pagan sus vecinos: una sola tarjeta, sin repetir datos. */
export interface GrupoCuentas {
  clave: string;
  complejo: { id: number; nombre: string };
  estructura: { id: number; nombre: string | null } | null;
  /** La ficha de «Juntas directivas»; `null` si la lista de juntas no cargó o el block no aparece en ella. */
  ficha: FichaJunta | null;
  medios: Medio[];
}

interface Props {
  grupo: GrupoCuentas;
  mostrarCondominio: boolean;
  /** Dónde se ve la junta completa: «Mi junta» para la junta, «Juntas directivas» para la administración. */
  enlaceJunta: string;
  esJunta: boolean;
  onAgregar: () => void;
  onEditar: (m: Medio) => void;
  onQuitar: (m: Medio) => void;
  onActivo: (m: Medio, activo: boolean) => void;
}

const quien = (j: Junta, cargo: 'presidente' | 'tesorero') => j.miembros.find(m => m.cargo === cargo)?.nombre ?? 'sin definir';

function FilaMedio({ m, onEditar, onQuitar, onActivo }: { m: Medio } & Pick<Props, 'onEditar' | 'onQuitar' | 'onActivo'>) {
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      {m.tipo === 'banco' ? <BuildingLibraryIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" /> : m.tipo === 'recaudacion' ? <ReceiptPercentIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" /> : <DevicePhoneMobileIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{tipoLabel(m.tipo)}<span className="font-normal text-muted"> · {m.tipo === 'banco' ? `${m.entidad ?? ''} · ${monedaCorta(m.moneda)}` : m.tipo === 'recaudacion' ? [m.entidad, m.servicio].filter(Boolean).join(' · ') : m.tiene_qr ? 'Con código QR' : 'Sin código QR'}</span></p>
        <p className="num break-all">{datoPrincipal(m)}</p>
        <p className="break-words text-xs text-muted">Titular: {m.titular}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Interruptor className="min-h-0 [&>span:last-child]:sr-only" label={m.activo ? 'Activo' : 'Inactivo'} aria-label={`Mostrar a los vecinos: ${tipoLabel(m.tipo)} de ${m.titular}`} checked={m.activo} onChange={e => onActivo(m, e.target.checked)} />
        <IconButton label={`Editar ${tipoLabel(m.tipo)} de ${m.titular}`} onClick={() => onEditar(m)}><PencilSquareIcon className="h-4 w-4" /></IconButton>
        <IconButton label={`Quitar ${tipoLabel(m.tipo)} de ${m.titular}`} onClick={() => onQuitar(m)}><TrashIcon className="h-4 w-4" /></IconButton>
      </div>
    </li>
  );
}

/** La junta arriba (presidente, tesorero y correo, con enlace a la junta completa) y debajo sus cuentas, que se activan, editan o quitan aquí. */
export function CuentasBlock({ grupo, mostrarCondominio, enlaceJunta, esJunta, onAgregar, onEditar, onQuitar, onActivo }: Props) {
  const j = grupo.ficha?.vigente ?? null;
  const nombre = nombreAmbito(grupo.estructura);
  return (
    <Card>
      <CardHeader
        title={nombre}
        description={[mostrarCondominio ? grupo.complejo.nombre : null, j ? `Gestión ${nombreGestion(j)} · desde ${fechaCorta(j.desde)}` : null].filter(Boolean).join(' · ') || undefined}
        action={grupo.medios.some(m => m.activo) ? <Badge tone="ok">Con cuenta</Badge> : <Badge tone="warn">Sin cuenta</Badge>}
      />
      <CardBody className="flex flex-col gap-4">
        <section aria-label={`Junta de ${nombre}`} className="rounded-lg bg-surface2 p-3 text-sm">
          {j ? (
            <>
              <p className="break-words"><span className="text-muted">Presidente:</span> {quien(j, 'presidente')}</p>
              <p className="break-words"><span className="text-muted">Tesorero:</span> {quien(j, 'tesorero')}</p>
              <p className="break-all"><span className="text-muted">Correo:</span> {j.correo ?? 'sin correo'}</p>
            </>
          ) : <p className="text-muted">{grupo.ficha ? 'Sin junta registrada.' : 'No se pudo cargar la junta.'}</p>}
          {grupo.ficha && <Link to={enlaceJunta} className="mt-1 inline-block font-medium text-brand underline underline-offset-2">{j ? 'Ver la junta' : esJunta ? 'Ver mi junta' : 'Registrar la junta'}</Link>}
        </section>
        <section aria-label={`Cuentas de ${nombre}`}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Donde pagan los vecinos</h3>
            <Button variant="secondary" size="sm" icon={<PlusIcon className="h-4 w-4" />} onClick={onAgregar}>Agregar cuenta</Button>
          </div>
          {grupo.medios.length === 0
            ? <p className="text-sm text-muted">Aún no hay cuenta: agrega el banco, Yape o Plin de la junta para que los vecinos sepan cómo pagar.</p>
            : <ul className="divide-y divide-line">{grupo.medios.map(m => <FilaMedio key={m.id} m={m} onEditar={onEditar} onQuitar={onQuitar} onActivo={onActivo} />)}</ul>}
        </section>
      </CardBody>
    </Card>
  );
}
