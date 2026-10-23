import { Badge, Button, fechaCorta } from '../../../../ui';
import { Interruptor } from '../../../admin/_parts/catalogo/Interruptor';
import { Enfriando } from './Enfriando';
import type { Clave, Proveedor } from './tipos';

const ESTADO = {
  sin_probar: { tone: 'neutral', label: 'Sin probar' },
  ok: { tone: 'ok', label: 'Funciona' },
  error: { tone: 'warn', label: 'Con error' },
  rechazada: { tone: 'bad', label: 'Rechazada' },
} as const;

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

interface Props {
  proveedor: Proveedor;
  clave: Clave;
  deshabilitado: boolean;
  probando: boolean;
  onProbar: () => void;
  onCambiar: () => void;
  onAlternar: (habilitada: boolean) => void;
  onQuitar: () => void;
}

export function FilaClave({ proveedor: p, clave: c, deshabilitado, probando, onProbar, onCambiar, onAlternar, onQuitar }: Props) {
  const estado = ESTADO[c.estado];
  const detalle = c.estado === 'rechazada' || c.estado === 'error' ? c.estado_detalle : null;
  return (
    <li className="flex flex-col gap-3 py-3 pl-5 pr-5 md:flex-row md:items-center md:justify-between md:gap-6">
      <div className="min-w-0 md:flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num text-sm font-medium">{c.etiqueta}</span>
          <span className="num text-sm text-muted" aria-label={`Termina en ${c.ultimos4}`}>••••{c.ultimos4}</span>
          <Badge tone={estado.tone}>{estado.label}</Badge>
          <Enfriando hasta={c.enfriando_hasta} />
        </div>
        {detalle && (
          <p className="mt-1 text-sm text-bad">
            {detalle}{c.estado === 'rechazada' && '. No se usa hasta que la pruebes bien o la reemplaces.'}
          </p>
        )}
        <p className="mt-1 text-xs text-muted">
          <span className="num">{plural(c.uso.ok, 'uso', 'usos')} · {plural(c.uso.limite, 'límite', 'límites')}</span>
          {c.uso.error > 0 && <span className="num"> · {plural(c.uso.error, 'error', 'errores')}</span>}
          {' · '}Modelo: <span className="num">{c.modelo ?? p.modeloPorDefecto}</span> · Última prueba: {fechaCorta(c.probada_at)} · Último uso: {fechaCorta(c.ultimo_uso_at)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <Interruptor label="Habilitada" checked={c.habilitada} disabled={deshabilitado} onChange={e => onAlternar(e.target.checked)} className="mr-2" />
        <Button variant="secondary" loading={probando} disabled={deshabilitado} onClick={onProbar}>Probar</Button>
        <Button variant="secondary" disabled={deshabilitado} onClick={onCambiar}>Cambiar clave</Button>
        <Button variant="ghost" disabled={deshabilitado} onClick={onQuitar}>Quitar</Button>
      </div>
    </li>
  );
}
