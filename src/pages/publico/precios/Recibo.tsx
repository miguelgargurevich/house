import { MinusIcon, PlusIcon } from '@heroicons/react/24/outline';
import { cx, soles } from '../../../ui';
import type { Catalogo } from '../catalogo';
import { useTotal } from './useTotal';

export interface Eleccion { unidades: string; plan: string; modulos: string[] }

const PRESETS = [20, 50, 100, 250] as const;
const MAX = 100_000;

/**
 * El recibo de House: la calculadora presentada como lo que House emite. Los precios por departamento salen del catálogo;
 * el total al mes y al año lo calcula el servidor (`/api/publico/cotizar`).
 */
export function Recibo({ cat, eleccion, onCambio }: { cat: Catalogo; eleccion: Eleccion; onCambio: (e: Eleccion) => void }) {
  const { unidades, plan: claveplan, modulos } = eleccion;
  const plan = cat.planes.find(p => p.clave === claveplan) ?? cat.planes[0];
  const incluidos = plan?.modulos_incluidos ?? [];
  const sueltos = modulos.filter(m => !incluidos.includes(m));
  const valido = Number(unidades) >= 1;
  const n = Math.min(MAX, Math.max(1, Math.trunc(Number(unidades) || 0)));
  const total = useTotal(n, plan?.clave ?? null, sueltos, valido && !!plan);
  const gratis = plan && Number(plan.precio_por_unidad) === 0 && sueltos.length === 0;
  const set = (parcial: Partial<Eleccion>) => onCambio({ ...eleccion, ...parcial });
  const alternar = (c: string) => set({ modulos: modulos.includes(c) ? modulos.filter(x => x !== c) : [...modulos, c] });
  const paso = (d: number) => set({ unidades: String(Math.min(MAX, Math.max(1, (Math.trunc(Number(unidades)) || 0) + d))) });

  return (
    <section id="recibo" data-ui aria-labelledby="recibo-titulo" className="scroll-mt-6 overflow-hidden rounded-xl bg-surface">
      <div className="space-y-6 p-5 sm:p-7">
        <header>
          <h2 id="recibo-titulo" className="text-2xl font-semibold tracking-tight sm:text-3xl">Calcula tu recibo</h2>
          <p className="mt-1 text-base text-muted">Lo que pagas por condominio, con IGV incluido.</p>
        </header>

        <div>
          <label htmlFor="deptos" className="text-sm font-medium">Departamentos del condominio</label>
          <div className="mt-2 flex items-stretch gap-2">
            <button type="button" onClick={() => paso(-10)} aria-label="Restar 10 departamentos" className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-surface2 text-ink transition-colors duration-150 hover:bg-brand-soft active:scale-95"><MinusIcon className="h-5 w-5" aria-hidden="true" /></button>
            <input
              id="deptos" type="number" inputMode="numeric" min={1} max={MAX} value={unidades}
              onChange={e => set({ unidades: e.target.value })}
              aria-invalid={valido ? undefined : true} aria-describedby="deptos-msg"
              className="num h-12 min-w-0 flex-1 rounded bg-surface2 px-3 text-center text-2xl font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-brand aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-bad"
            />
            <button type="button" onClick={() => paso(10)} aria-label="Sumar 10 departamentos" className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-surface2 text-ink transition-colors duration-150 hover:bg-brand-soft active:scale-95"><PlusIcon className="h-5 w-5" aria-hidden="true" /></button>
          </div>
          <p id="deptos-msg" aria-live="polite" className={cx('mt-2 text-sm', valido ? 'sr-only' : 'text-bad')}>{valido ? 'Departamentos del condominio' : 'Escribe al menos 1 departamento'}</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Tamaños frecuentes">
            {PRESETS.map(p => (
              <button key={p} type="button" onClick={() => set({ unidades: String(p) })} aria-pressed={Number(unidades) === p}
                className="num h-9 rounded px-3.5 text-sm font-medium transition-colors duration-150 bg-surface2 text-ink hover:bg-brand-soft aria-pressed:bg-brand aria-pressed:text-on-brand">{p}</button>
            ))}
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Plan</legend>
          <div className="mt-2 flex gap-1 rounded bg-surface2 p-1">
            {cat.planes.map(p => (
              <label key={p.clave} className="flex-auto cursor-pointer">
                <input type="radio" name="plan" value={p.clave} checked={plan?.clave === p.clave} onChange={() => set({ plan: p.clave })} className="peer sr-only" />
                <span className="flex h-10 items-center justify-center rounded px-3 text-sm font-medium text-muted transition-colors duration-150 hover:text-ink peer-checked:bg-surface peer-checked:text-ink peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand">{p.nombre}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Módulos</legend>
          <div className="mt-2 space-y-1.5">
            {cat.modulos.map(m => {
              const trae = incluidos.includes(m.clave);
              const on = trae || modulos.includes(m.clave);
              return (
                <label key={m.clave} className={cx('flex items-center gap-3 rounded bg-surface2 px-3 py-2.5 transition-colors duration-150', trae ? 'cursor-default' : 'cursor-pointer hover:bg-brand-soft', on && !trae && 'bg-brand-soft')}>
                  <input type="checkbox" checked={on} disabled={trae} onChange={() => alternar(m.clave)} className="h-5 w-5 shrink-0 accent-[oklch(var(--brand))]" />
                  <span className="min-w-0 flex-1 text-base leading-snug">{m.nombre}</span>
                  <span className="num shrink-0 text-sm text-muted">{trae ? 'Incluido' : `+ ${soles(m.precio_por_unidad)}`}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className="bg-brand p-5 text-on-brand sm:p-7" aria-live="polite" aria-atomic="true">
        {total.error ? <p className="text-base">No se pudo calcular. Revisa tu conexión e inténtalo de nuevo.</p> : (
          <>
            <p className="text-sm font-medium opacity-90">Total al mes · {n} {n === 1 ? 'departamento' : 'departamentos'}</p>
            {total.r ? (
              <div key={total.r.total_mes} className="sube-corto">
                <p className="num mt-1 text-5xl font-semibold tracking-tight sm:text-6xl">{soles(total.r.total_mes)}</p>
                <p className="num mt-2 text-lg">{gratis ? 'Gratis para siempre, sin límite de departamentos.' : `${soles(total.r.total_anio)} al año · IGV incluido`}</p>
              </div>
            ) : <div className="mt-2 h-14 w-56 rounded bg-on-brand/20" aria-hidden="true" />}
          </>
        )}
      </div>
    </section>
  );
}
