import { cx } from '../../../../ui';
import { minutosDe } from '../../../shared/_parts/reservas/tipos';
import type { Bloque } from '../../../shared/_parts/reservas/tipos';

interface Props {
  apertura: string;
  cierre: string;
  ocupados: Bloque[];
  /** Tramo que el vecino está eligiendo (se dibuja encima, sin tapar lo ocupado). */
  eleccion?: { inicio: string; fin: string } | null;
}

const pct = (min: number, desde: number, total: number) => `${(((min - desde) / total) * 100).toFixed(3)}%`;

/**
 * El día del área de un vistazo: una barra del horario de apertura al de cierre con los tramos ocupados, y debajo la misma información en texto
 * (la barra es sólo visual: el lector de pantalla lee la lista). Usa sólo colores del tema, así que sirve en modo claro y oscuro.
 */
export function LineaDelDia({ apertura, cierre, ocupados, eleccion }: Props) {
  const desde = minutosDe(apertura);
  const total = Math.max(1, minutosDe(cierre) - desde);
  const tramo = (ini: string, fin: string) => ({ left: pct(Math.max(minutosDe(ini), desde), desde, total), width: `${((Math.min(minutosDe(fin), desde + total) - Math.max(minutosDe(ini), desde)) / total * 100).toFixed(3)}%` });

  return (
    <div>
      <div className="relative h-8 w-full overflow-hidden rounded border border-line bg-ok-soft" aria-hidden="true">
        {ocupados.map(o => (
          <span key={o.id} className={cx('absolute inset-y-0 border-x border-surface', o.mia ? 'bg-brand' : o.estado === 'pendiente' ? 'bg-warn' : 'bg-bad')} style={tramo(o.hora_inicio, o.hora_fin)} />
        ))}
        {eleccion && <span className="absolute inset-y-1 rounded-sm border-2 border-ink bg-surface/60" style={tramo(eleccion.inicio, eleccion.fin)} />}
      </div>
      <div className="num mt-1 flex justify-between text-xs text-muted" aria-hidden="true"><span>{apertura}</span><span>{cierre}</span></div>
      <ul className="mt-3 space-y-1 text-sm" aria-label="Horarios ocupados">
        {ocupados.length === 0
          ? <li className="text-ok">Todo el día está libre.</li>
          : ocupados.map(o => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-2">
                <span className="num font-medium">{o.hora_inicio}–{o.hora_fin}</span>
                <span className="text-muted">{o.mia ? 'Tu reserva' : o.estado === 'pendiente' ? 'Ocupado (por aprobar)' : 'Ocupado'}</span>
              </li>
            ))}
      </ul>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ok-soft ring-1 ring-line" />Libre</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-bad" />Ocupado</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-warn" />Por aprobar</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand" />Tuyo</span>
      </p>
    </div>
  );
}
