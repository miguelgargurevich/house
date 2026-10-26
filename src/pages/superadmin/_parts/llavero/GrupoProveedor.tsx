import { useState } from 'react';
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/24/outline';
import { Button, cx, IconoProveedor } from '../../../../ui';
import { FilaClave } from './FilaClave';
import { resumenClaves } from './tipos';
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

/** Un proveedor con sus claves como filas; sin tarjetas anidadas. El grupo arranca plegado. */
export function GrupoProveedor({ proveedor: p, claves, maxClaves, deshabilitado, probando, sincronizando, onAgregar, onProbar, onSincronizar, onCambiar, onCambiarModelo, onAlternar, onReserva, onQuitar }: Props) {
  const [abierto, setAbierto] = useState(false);
  const lleno = claves.length >= maxClaves;
  const idClaves = `llavero-claves-${p.id}`;
  return (
    <li>
      <div className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <button
          type="button"
          onClick={() => setAbierto(a => !a)}
          aria-expanded={abierto}
          aria-controls={claves.length > 0 ? idClaves : undefined}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <IconoProveedor slug={p.id} size={22} className="mt-0.5" />
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold">{p.nombre}</span>
              <ChevronDownIcon className={cx('h-4 w-4 shrink-0 text-muted transition-transform duration-150', abierto && 'rotate-180')} aria-hidden="true" />
            </span>
            <span className="mt-0.5 block text-sm text-muted">{p.descripcion}</span>
            <span className="mt-1 block text-xs text-muted">{resumenClaves(claves)}</span>
          </span>
        </button>
        <div className="flex flex-col gap-1 md:items-end">
          <Button variant={claves.length === 0 ? 'primary' : 'secondary'} icon={<PlusIcon className="h-4 w-4" aria-hidden="true" />} disabled={deshabilitado || lleno} onClick={onAgregar}>
            {claves.length === 0 ? 'Agregar clave' : 'Agregar otra clave'}
          </Button>
          {lleno && <p className="text-xs text-muted">Máximo {maxClaves} claves por proveedor.</p>}
        </div>
      </div>
      {claves.length > 0 && (
        <ul id={idClaves} hidden={!abierto} className="divide-y divide-line border-t border-line">
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
