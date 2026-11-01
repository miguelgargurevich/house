import { useState } from 'react';
import { cx } from '../../../ui';
import { PORTADA } from '../../../lib/seo/textos';

type Modo = 'una' | 'block';
const MODOS: Modo[] = ['una', 'block'];

/**
 * Una junta o una junta por block: el control que decide cómo se organiza el condominio en Torre, en grande y funcionando.
 * Al cambiarlo cambian el título, el texto y el color de todo el campo.
 */
export function Juntas() {
  const [modo, setModo] = useState<Modo>('block');
  const t = PORTADA.juntas[modo];
  const block = modo === 'block';
  return (
    <section aria-labelledby="juntas-titulo" className={cx('overflow-hidden transition-colors duration-300', block ? 'bg-brand text-on-brand' : 'bg-surface2 text-ink')}>
      <div className="mx-auto flex min-h-[72svh] w-full max-w-6xl flex-col justify-between gap-14 px-4 py-16 sm:px-6 lg:py-24">
        <div aria-live="polite">
          <h2 id="juntas-titulo" className="max-w-[16em] text-[clamp(2rem,4.4vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.03em]">{t.titulo}</h2>
          <p className="mt-6 max-w-[36rem] text-lg leading-relaxed">{t.texto}</p>
        </div>
        {/* El control real de la app (una junta / junta por block) a tamaño de cartel. */}
        <div data-ui role="radiogroup" aria-label="Cómo se organiza tu condominio"
          className={cx('inline-flex w-max max-w-full self-start rounded-xl p-[0.12em] text-[clamp(1.5rem,5.2vw,4rem)] font-semibold leading-none tracking-[-0.02em] lg:self-end',
            block ? 'bg-brand-hover' : 'bg-line')}>
          {MODOS.map(m => (
            <button key={m} type="button" role="radio" aria-checked={modo === m} onClick={() => setModo(m)}
              className={cx('whitespace-nowrap rounded-lg px-[0.55em] py-[0.4em] transition-[background-color,color,transform] duration-200 active:scale-[0.98]',
                modo === m ? (block ? 'bg-on-brand text-brand' : 'bg-surface text-ink') : (block ? 'text-on-brand/80 hover:text-on-brand' : 'text-muted hover:text-ink'))}>
              {PORTADA.juntas[m].opcion}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
