import { useState } from 'react';
import { cx } from '../../../ui';
import { PORTADA } from '../../../lib/seo/textos';
import { TECHO } from './Fachada';

const PASOS = PORTADA.pasos.lista;

/** «Cómo funciona»: un deslizador de cuatro paradas mueve a la vez la frase (izquierda) y la captura de ese paso (derecha). Nada depende del scroll. */
export function Pasos() {
  const [n, setN] = useState(0);
  const paso = PASOS[n]!;
  return (
    <section aria-labelledby="pasos-titulo" className="bg-surface2">
      <h2 id="pasos-titulo" className="sr-only">{PORTADA.pasos.titulo}</h2>
      <div className="grid lg:min-h-[88svh] lg:grid-cols-2">
        {/* Captura: en celular va primero. Todas apiladas; sólo la del paso actual se ve (fundido de 200 ms). */}
        <div className="relative order-1 flex min-h-[46svh] items-center justify-center overflow-hidden bg-brand px-6 py-10 lg:order-2 lg:min-h-0 lg:py-16">
          {PASOS.map((p, i) => (
            <img key={p.nombre} src={p.imagen} alt={i === n ? p.alt : ''} aria-hidden={i !== n} loading="lazy" width={p.celular ? 600 : 1600} height={p.celular ? 1298 : 1000}
              style={{ clipPath: TECHO }}
              className={cx('absolute object-cover object-top transition-opacity duration-200',
                p.celular ? 'h-[88%] w-auto max-w-[78%]' : 'h-auto w-[92%] max-w-[44rem]',
                i === n ? 'opacity-100' : 'opacity-0')} />
          ))}
        </div>
        <div className="order-2 flex flex-col justify-between gap-10 px-4 py-12 sm:px-6 lg:order-1 lg:px-[max(1.5rem,calc((100vw-72rem)/2+1.5rem))] lg:py-20">
          <div aria-live="polite">
            <p key={paso.nombre} className="sube-corto max-w-[15em] text-[clamp(2rem,3.4vw,3.25rem)] font-semibold leading-[1.04] tracking-[-0.03em]">{paso.clausula}</p>
            <p key={`${paso.nombre}-t`} className="sube-corto mt-6 max-w-[34rem] text-lg leading-relaxed">{paso.texto}</p>
          </div>
          <div>
            <label htmlFor="pasos-deslizador" className="sr-only">Paso de la cobranza</label>
            <input id="pasos-deslizador" type="range" min={0} max={PASOS.length - 1} step={1} value={n} onChange={e => setN(Number(e.target.value))}
              aria-valuetext={`${paso.nombre}: ${paso.clausula}`}
              className="deslizador-pasos w-full" />
            <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
              {PASOS.map((p, i) => (
                <li key={p.nombre}>
                  <button type="button" onClick={() => setN(i)} aria-current={i === n ? 'step' : undefined}
                    className={cx('text-left text-base font-medium transition-colors duration-150 hover:text-ink', i === n ? 'text-ink' : 'text-muted')}>{p.nombre}</button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
