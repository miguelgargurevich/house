import { Alert, Badge, Button, fechaCorta } from '../../../../ui';
import { fechaHora } from '../fechas';
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
  sincronizando: boolean;
  onProbar: () => void;
  onSincronizar: () => void;
  onCambiar: () => void;
  onCambiarModelo: () => void;
  onAlternar: (habilitada: boolean) => void;
  onReserva: (reserva: boolean) => void;
  onQuitar: () => void;
}

export function FilaClave({ proveedor: p, clave: c, deshabilitado, probando, sincronizando, onProbar, onSincronizar, onCambiar, onCambiarModelo, onAlternar, onReserva, onQuitar }: Props) {
  const estado = ESTADO[c.estado];
  const detalle = c.estado === 'rechazada' || c.estado === 'error' ? c.estado_detalle : null;
  return (
    // Siempre apilada (24-oct): la información a todo el ancho y los controles debajo. En fila, con el asistente abierto el ancho real
    // es el de una tablet aunque la ventana sea de escritorio, y los 7 controles aplastaban la información a una palabra por línea.
    <li className="flex flex-col gap-3 px-5 py-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num text-sm font-medium">{c.etiqueta}</span>
          <span className="num text-sm text-muted" aria-label={`Termina en ${c.ultimos4}`}>••••{c.ultimos4}</span>
          <Badge tone={estado.tone}>{estado.label}</Badge>
          <Enfriando hasta={c.enfriando_hasta} />
          {c.reserva && <Badge tone="info">Reserva</Badge>}
        </div>
        {detalle && (
          <p className="mt-1 text-sm text-bad">
            {detalle}{c.estado === 'rechazada' && '. No se usa hasta que la pruebes bien o la reemplaces.'}
          </p>
        )}
        {c.aviso_modelo && <div className="mt-2"><Alert tone="warn">{c.aviso_modelo}</Alert></div>}
        <p className="mt-1 text-sm">
          Modelo en uso: <span className="num font-medium">{c.modelo_en_uso ?? c.modelo ?? p.modeloPorDefecto}</span>
          <span className="text-muted"> · {c.modelo ? 'fijado por ti' : 'automático'}</span>
        </p>
        <p className="mt-1 text-xs text-muted">
          <span className="num">{plural(c.modelos_activos, 'modelo activo', 'modelos activos')}</span>
          {c.modelos_deprecados > 0 && <span className="num"> · {plural(c.modelos_deprecados, 'retirado', 'retirados')}</span>}
          {' · '}Sincronizado: {c.ultima_sync ? <span className={c.ultima_sync.ok ? undefined : 'text-bad'}>{fechaHora(c.ultima_sync.at)}{!c.ultima_sync.ok && c.ultima_sync.error ? ` (${c.ultima_sync.error})` : ''}</span> : 'nunca'}
        </p>
        <p className="mt-1 text-xs text-muted">
          <span className="num">{plural(c.uso.ok, 'uso', 'usos')} · {plural(c.uso.limite, 'límite', 'límites')}</span>
          {c.uso.error > 0 && <span className="num"> · {plural(c.uso.error, 'error', 'errores')}</span>}
          {' · '}Última prueba: {fechaCorta(c.probada_at)} · Último uso: {fechaCorta(c.ultimo_uso_at)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <Interruptor label="Habilitada" checked={c.habilitada} disabled={deshabilitado} onChange={e => onAlternar(e.target.checked)} className="mr-2" />
        <Interruptor label="Reserva" hint="Sólo si lo demás falla" checked={c.reserva} disabled={deshabilitado} onChange={e => onReserva(e.target.checked)} className="mr-2" />
        <Button variant="secondary" loading={probando} disabled={deshabilitado} onClick={onProbar}>Probar</Button>
        <Button variant="secondary" loading={sincronizando} disabled={deshabilitado} onClick={onSincronizar}>Sincronizar ahora</Button>
        <Button variant="secondary" disabled={deshabilitado} onClick={onCambiarModelo}>Cambiar modelo</Button>
        <Button variant="secondary" disabled={deshabilitado} onClick={onCambiar}>Cambiar clave</Button>
        <Button variant="ghost" disabled={deshabilitado} onClick={onQuitar}>Quitar</Button>
      </div>
    </li>
  );
}
