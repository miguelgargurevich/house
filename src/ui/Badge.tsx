import type { ReactNode } from 'react';
import { cx } from './cx';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'brand';

const tones: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
  brand: 'bg-brand-soft text-brand',
  neutral: 'bg-surface2 text-muted',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium', tones[tone])}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {children}
    </span>
  );
}

const estados: Record<string, { tone: Tone; label: string }> = {
  pagado: { tone: 'ok', label: 'Pagado' },
  pendiente: { tone: 'warn', label: 'Pendiente' },
  vencido: { tone: 'bad', label: 'Vencido' },
  en_revision: { tone: 'info', label: 'En revisión' },
  parcial: { tone: 'info', label: 'Pago parcial' },
  por_validar: { tone: 'warn', label: 'Por validar' },
  validado: { tone: 'ok', label: 'Validado' },
  rechazado: { tone: 'bad', label: 'Rechazado' },
  emitido: { tone: 'info', label: 'Emitido' },
  activa: { tone: 'ok', label: 'Activa' },
  activo: { tone: 'ok', label: 'Activo' },
  inactiva: { tone: 'neutral', label: 'Inactiva' },
  en_progreso: { tone: 'info', label: 'En progreso' },
  completada: { tone: 'ok', label: 'Completada' },
};

/** Estado semántico (pagos, recibos, tareas): el color y la palabra viajan juntos. */
export function StatusBadge({ estado }: { estado?: string | null }) {
  const key = (estado ?? '').toLowerCase();
  const e = estados[key] ?? { tone: 'neutral' as Tone, label: estado ? estado.charAt(0).toUpperCase() + estado.slice(1) : '—' };
  return <Badge tone={e.tone}>{e.label}</Badge>;
}
