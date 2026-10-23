import { Badge, Button, fechaCorta } from '../../../../ui';
import { Interruptor } from '../../../admin/_parts/catalogo/Interruptor';
import type { Clave, Proveedor } from './tipos';

const ESTADO = {
  sin_probar: { tone: 'neutral', label: 'Sin probar' },
  ok: { tone: 'ok', label: 'Funciona' },
  error: { tone: 'bad', label: 'Con error' },
} as const;

interface Props {
  proveedor: Proveedor;
  clave: Clave | undefined;
  deshabilitado: boolean;
  probando: boolean;
  onAgregar: () => void;
  onProbar: () => void;
  onAlternar: (habilitada: boolean) => void;
  onQuitar: () => void;
}

export function FilaProveedor({ proveedor: p, clave: c, deshabilitado, probando, onAgregar, onProbar, onAlternar, onQuitar }: Props) {
  const estado = c ? ESTADO[c.estado] : null;
  return (
    <li className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="min-w-0 md:flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold">{p.nombre}</h3>
          {estado && <Badge tone={estado.tone}>{estado.label}</Badge>}
          {c && <span className="num text-sm text-muted" aria-label={`Termina en ${c.ultimos4}`}>••••{c.ultimos4}</span>}
        </div>
        <p className="mt-0.5 text-sm text-muted">{p.descripcion}</p>
        {c ? (
          <>
            {c.estado === 'error' && c.estado_detalle && <p className="mt-1 text-sm text-bad">{c.estado_detalle}</p>}
            <p className="mt-1 text-xs text-muted">
              Modelo: <span className="num">{c.modelo ?? p.modeloPorDefecto}</span> · Última prueba: {fechaCorta(c.probada_at)} · Último uso: {fechaCorta(c.ultimo_uso_at)}
            </p>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted">Sin clave guardada.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        {c ? (
          <>
            <Interruptor label="Habilitada" checked={c.habilitada} disabled={deshabilitado} onChange={e => onAlternar(e.target.checked)} className="mr-2" />
            <Button variant="secondary" loading={probando} disabled={deshabilitado} onClick={onProbar}>Probar</Button>
            <Button variant="secondary" disabled={deshabilitado} onClick={onAgregar}>Cambiar clave</Button>
            <Button variant="ghost" disabled={deshabilitado} onClick={onQuitar}>Quitar</Button>
          </>
        ) : (
          <Button disabled={deshabilitado} onClick={onAgregar}>Agregar clave</Button>
        )}
      </div>
    </li>
  );
}
