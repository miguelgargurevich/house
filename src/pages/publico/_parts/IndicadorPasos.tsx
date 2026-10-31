import { CheckIcon } from '@heroicons/react/20/solid';
import { cx } from '../../../ui';

/** Los pasos del alta: la cuenta (registro público), el condominio (primer ingreso) y «Listo» (el Resumen). */
const PASOS = ['Cuenta', 'Condominio', 'Listo'] as const;

/**
 * Indicador «1 Cuenta ✓ · 2 Condominio · 3 Listo». `actual` es el paso en el que estás (1–3): los anteriores van con ✓ y el actual resaltado.
 * Es una lista ordenada; el paso actual lleva `aria-current="step"` y el ✓ se dice como texto para el lector de pantalla.
 */
export function IndicadorPasos({ actual, className }: { actual: 1 | 2 | 3; className?: string }) {
  return (
    <ol aria-label="Pasos para empezar" className={cx('flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm sm:gap-x-2', className)}>
      {PASOS.map((nombre, i) => {
        const n = i + 1;
        const hecho = n < actual;
        const aqui = n === actual;
        return (
          <li key={nombre} aria-current={aqui ? 'step' : undefined} className="flex items-center gap-2">
            {i > 0 && <span className="hidden h-px w-6 bg-line sm:block" aria-hidden="true" />}
            <span className={cx('flex items-center gap-2 font-medium', aqui ? 'text-ink' : hecho ? 'text-ok' : 'text-muted')}>
              <span
                aria-hidden="true"
                className={cx('num flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs', aqui ? 'bg-brand text-on-brand' : hecho ? 'bg-ok-soft text-ok' : 'bg-surface2 text-muted')}
              >
                {hecho ? <CheckIcon className="h-4 w-4" /> : n}
              </span>
              {nombre}
              {hecho && <span className="sr-only"> (listo)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
