import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cx } from '../../../ui';
import { dinero } from '../../../ui/format';
import { PORTADA, masImpuesto } from '../../../lib/seo/textos';
import type { Catalogo, Plan } from '../catalogo';
import { plazoGratisTexto } from '../plazoGratis';
import { noCabeEnPlan } from '../precios/tramo';
import { useTotal } from '../precios/useTotal';
import { Techito } from './Fachada';

const ORDEN = ['gratis', 'basico', 'pro', 'administradora'];

/**
 * Precios en corto: los nombres de los planes son la lista y a la derecha queda una sola cifra viva, lo que pagaría TU edificio al mes.
 * El total lo calcula el servidor (`/api/publico/cotizar`, con el mínimo del plan); aquí no se hace cuenta de precios.
 */
export function PreciosVivos({ cat, abierto }: { cat: Catalogo; abierto: boolean }) {
  const planes = ORDEN.map(c => cat.planes.find(p => p.clave === c)).filter((p): p is Plan => !!p);
  const [clave, setClave] = useState('pro');
  const [texto, setTexto] = useState('40');
  const n = Math.min(5000, Math.max(1, Math.floor(Number(texto)) || 1));
  const plan = planes.find(p => p.clave === clave) ?? planes[0];
  const gratis = plan ? Number(plan.precio_por_unidad) === 0 : false;
  // Un plan con tope de departamentos (hoy ninguno de pago; el superadmin puede ponerlo) no cotiza a quien ya tiene más: no se pide el total y se dice cuál sigue.
  const tope = plan?.unidades_maximas ?? null;
  const excede = noCabeEnPlan(plan, n);
  const pro = planes.find(p => p.clave === 'pro');
  const { r } = useTotal(n, plan?.clave ?? null, cat.pais, !!plan && !gratis && !plan.consultar && !excede);
  if (!plan) return null;

  const cifra = excede ? `Hasta ${tope}` : gratis ? dinero(0, cat.moneda) : r?.total_mes ? dinero(r.total_mes, cat.moneda) : '…';
  const periodo = excede ? 'departamentos por condominio' : gratis ? plazoGratisTexto(cat) : `al mes${masImpuesto(cat)}`;
  const detalle = excede
    ? `${plan.nombre} llega hasta ${tope} departamentos y tu condominio tiene ${n}. Con ${n} te sirve ${pro?.nombre ?? 'Torre Pro'}, que no tiene tope.`
    : gratis
    ? `Para ${n} departamentos, sin tarjeta.`
    : plan.precio_por_unidad !== null
      ? `${n} departamentos a ${dinero(plan.precio_por_unidad, cat.moneda)} cada uno${r?.minimo_aplicado ? '; con pocos departamentos pagas el mínimo del plan' : ''}.`
      : 'Todavía no tiene precio en tu país: consúltanos.';

  return (
    <section aria-labelledby="precios-titulo" className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 lg:py-36">
      <h2 id="precios-titulo" className="text-[clamp(2rem,4.4vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.03em]">{PORTADA.precios.titulo}</h2>
      <label className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-3 text-lg">
        <span>{PORTADA.precios.pregunta}</span>
        <input type="number" inputMode="numeric" min={1} max={5000} value={texto} onChange={e => setTexto(e.target.value)}
          className="h-12 w-28 rounded bg-surface px-4 text-xl font-semibold tabular-nums outline-none ring-brand focus-visible:ring-2" />
      </label>
      <div className="mt-12 grid gap-10 lg:grid-cols-12">
        <ul className="lg:col-span-6" aria-label="Planes">
          {planes.map(p => {
            const activo = p.clave === plan.clave;
            return (
              <li key={p.clave}>
                <button type="button" aria-pressed={activo} onClick={() => setClave(p.clave)} onFocus={() => setClave(p.clave)}
                  className={cx('flex items-center gap-[0.3em] py-1 text-left text-[clamp(2rem,4.4vw,4.25rem)] font-semibold leading-[1.08] tracking-[-0.03em] transition-colors duration-150',
                    activo ? 'text-ink' : 'text-muted hover:text-ink')}>
                  <Techito className={cx('h-[0.42em] w-[0.42em] shrink-0 text-brand transition-opacity duration-150', activo ? 'opacity-100' : 'opacity-0')} />
                  {p.nombre}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="lg:col-span-6 lg:col-start-7" aria-live="polite">
          <p className="flex flex-wrap items-baseline gap-x-3">
            <span key={`${plan.clave}-${cifra}`} className="sube-corto text-[clamp(2.6rem,5.4vw,5.25rem)] font-semibold leading-none tracking-[-0.04em] tabular-nums">{cifra}</span>
            <span className="text-lg text-muted">{periodo}</span>
          </p>
          <p className="mt-4 text-lg">{detalle}</p>
          {plan.caracteristicas.length > 0 && (
            <ul className="mt-6 space-y-2 text-lg">
              {plan.caracteristicas.map(c => <li key={c} className="flex items-start gap-3"><Techito className="mt-1.5 h-3.5 w-3.5 shrink-0 text-brand" />{c}</li>)}
            </ul>
          )}
          <div className="mt-9 flex flex-wrap gap-3">
            {abierto && <Link to="/registro" className="inline-flex h-12 items-center rounded bg-brand px-6 text-base font-semibold text-on-brand transition-colors duration-150 hover:bg-brand-hover active:scale-[0.98]">{PORTADA.botones.registro}</Link>}
            <Link to="/precios" className="inline-flex h-12 items-center rounded bg-surface px-6 text-base font-semibold transition-colors duration-150 hover:bg-line active:scale-[0.98]">Ver el detalle de {plan.nombre}</Link>
          </div>
          <p className="mt-6 text-base text-muted">{PORTADA.precios.nota}</p>
        </div>
      </div>
    </section>
  );
}
