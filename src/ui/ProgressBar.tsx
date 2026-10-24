import { cx } from './cx';
import { porcentaje } from './a11y';

type Tono = 'ok' | 'brand' | 'warn' | 'bad' | 'info';
const tonos: Record<Tono, string> = { ok: 'bg-ok', brand: 'bg-brand', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info' };

interface Props {
  value: number;
  /** Valor que equivale al 100 %. Por omisión 100 (`value` ya es un porcentaje). */
  max?: number;
  /** Nombre accesible de la barra («Avance de cobranza»). */
  label: string;
  /** Lectura para el lector de pantalla si «n de max» no basta (p. ej. «S/ 300 de S/ 450»). */
  valueText?: string;
  tone?: Tono;
  className?: string;
}

/** Barra de avance con `role="progressbar"`. El relleno usa tokens del sistema; el texto visible va aparte, junto a la barra. */
export function ProgressBar({ value, max = 100, label, valueText, tone = 'ok', className }: Props) {
  const pct = porcentaje(value, max);
  const ahora = Math.min(Math.max(Number(value) || 0, 0), max);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={ahora}
      aria-valuetext={valueText}
      className={cx('h-1.5 overflow-hidden rounded-full bg-surface2', className)}
    >
      <div className={cx('h-full rounded-full transition-[width] duration-200', tonos[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
