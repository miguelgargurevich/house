import { PlusIcon } from '@heroicons/react/24/outline';
import { Button } from '../../../../ui';
import { FilaClave } from './FilaClave';
import type { Clave, Proveedor } from './tipos';

interface Props {
  proveedor: Proveedor;
  claves: Clave[];
  maxClaves: number;
  deshabilitado: boolean;
  probando: number | null;
  sincronizando: number | null;
  onAgregar: () => void;
  onProbar: (c: Clave) => void;
  onSincronizar: (c: Clave) => void;
  onCambiar: (c: Clave) => void;
  onCambiarModelo: (c: Clave) => void;
  onAlternar: (c: Clave, habilitada: boolean) => void;
  onReserva: (c: Clave, reserva: boolean) => void;
  onQuitar: (c: Clave) => void;
}

/** Un proveedor con sus claves como filas; sin tarjetas anidadas. */
export function GrupoProveedor({ proveedor: p, claves, maxClaves, deshabilitado, probando, sincronizando, onAgregar, onProbar, onSincronizar, onCambiar, onCambiarModelo, onAlternar, onReserva, onQuitar }: Props) {
  const lleno = claves.length >= maxClaves;
  return (
    <li>
      <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between md:gap-6">
        <div className="min-w-0 md:flex-1">
          <h3 className="text-sm font-semibold">{p.nombre}</h3>
          <p className="mt-0.5 text-sm text-muted">{p.descripcion}</p>
          {claves.length === 0 && <p className="mt-1 text-xs text-muted">Sin clave guardada.</p>}
        </div>
        <div className="flex flex-col gap-1 md:items-end">
          <Button variant={claves.length === 0 ? 'primary' : 'secondary'} icon={<PlusIcon className="h-4 w-4" aria-hidden="true" />} disabled={deshabilitado || lleno} onClick={onAgregar}>
            {claves.length === 0 ? 'Agregar clave' : 'Agregar otra clave'}
          </Button>
          {lleno && <p className="text-xs text-muted">Máximo {maxClaves} claves por proveedor.</p>}
        </div>
      </div>
      {claves.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {claves.map(c => (
            <FilaClave
              key={c.id}
              proveedor={p}
              clave={c}
              deshabilitado={deshabilitado}
              probando={probando === c.id}
              sincronizando={sincronizando === c.id}
              onProbar={() => onProbar(c)}
              onSincronizar={() => onSincronizar(c)}
              onCambiar={() => onCambiar(c)}
              onCambiarModelo={() => onCambiarModelo(c)}
              onAlternar={h => onAlternar(c, h)}
              onReserva={r => onReserva(c, r)}
              onQuitar={() => onQuitar(c)}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
