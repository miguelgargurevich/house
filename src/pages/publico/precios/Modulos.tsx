import type { ReactNode } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { cx, soles } from '../../../ui';
import { Aparece } from '../Aparece';
import type { Catalogo, Modulo } from '../catalogo';

/**
 * Pedacitos de la interfaz de cada módulo, con datos de ejemplo. Van en HTML (no son imágenes) y no se leen en voz alta:
 * el texto del módulo, que sí se lee, ya dice lo mismo.
 */
const MUESTRAS: Record<string, ReactNode> = {
  ia_vouchers: (
    <div className="w-full max-w-[17rem] space-y-2 rounded-lg bg-surface p-3.5 text-sm">
      <p className="flex items-baseline justify-between gap-3"><span className="font-semibold">Voucher de Yape</span><span className="num font-semibold">S/ 350.00</span></p>
      <p className="text-muted">Operación 0482913 · Recibo B01-804</p>
      <p className="inline-flex items-center gap-1.5 rounded bg-ok-soft px-2 py-1 font-medium text-ok"><CheckCircleIcon className="h-4 w-4" aria-hidden="true" />Coincide con el recibo</p>
    </div>
  ),
  whatsapp_avisos: (
    <div className="w-full max-w-[17rem] space-y-1.5 text-sm">
      <p className="rounded-lg rounded-tl-none bg-surface p-3 leading-snug">Hola, tu mantenimiento de octubre (B01-804) es S/ 350.00. Paga por Yape o transferencia.</p>
      <p className="px-1 text-muted">Recordatorio de pago</p>
    </div>
  ),
  asistente: (
    <div className="w-full max-w-[17rem] space-y-1.5 text-sm">
      <p className="ml-auto w-fit max-w-[80%] rounded-lg rounded-tr-none bg-brand p-2.5 text-on-brand">¿Cuánto debo este mes?</p>
      <p className="w-fit max-w-[90%] rounded-lg rounded-tl-none bg-surface p-2.5 leading-snug">Tu mantenimiento de octubre es S/ 350.00 y aún no figura pago.</p>
    </div>
  ),
};

function Fila({ m, plan, activo, onAlternar, onSolo }: { m: Modulo; plan: { nombre: string; incluidos: string[] } | null; activo: boolean; onAlternar: () => void; onSolo: () => void }) {
  const incluido = !!plan?.incluidos.includes(m.clave);
  return (
    <Aparece como="li" className="grid gap-5 sm:grid-cols-[18rem_1fr] sm:gap-8">
      <div aria-hidden="true" data-ui className="flex min-h-36 items-center justify-center rounded-xl bg-surface2 p-4">{MUESTRAS[m.clave]}</div>
      <div className="flex flex-col justify-center">
        <h3 className="text-xl font-semibold leading-snug">{m.nombre}</h3>
        {m.descripcion && <p className="mt-1.5 text-base">{m.descripcion}</p>}
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2"><span className="num text-2xl font-semibold">{soles(m.precio_por_unidad)}</span><span className="text-base text-muted">por departamento al mes</span></p>
        <div className="mt-4">
          {incluido ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="inline-flex h-11 items-center gap-2 text-base font-medium text-ok"><CheckCircleIcon className="h-5 w-5" aria-hidden="true" />Incluido en {plan?.nombre}</span>
              <a href="#recibo" onClick={onSolo} className="inline-flex h-11 items-center text-base font-medium text-brand underline underline-offset-4 hover:text-brand-hover">Ver solo este módulo</a>
            </p>
          ) : (
            <button type="button" onClick={onAlternar} aria-pressed={activo}
              className={cx('inline-flex h-11 items-center rounded px-5 text-base font-semibold transition-colors duration-150 active:scale-[0.98]', activo ? 'bg-brand text-on-brand hover:bg-brand-hover' : 'bg-brand-soft text-brand hover:bg-surface2')}>
              {activo ? 'Sumado a tu recibo' : 'Sumar a mi recibo'}
            </button>
          )}
        </div>
      </div>
    </Aparece>
  );
}

/** Módulos sueltos: cada uno con su muestra, su beneficio, su precio y un botón que lo suma al recibo de al lado. */
export function Modulos({ cat, planClave, elegidos, onAlternar, onSolo }: { cat: Catalogo; planClave: string; elegidos: string[]; onAlternar: (clave: string) => void; onSolo: (clave: string) => void }) {
  const p = cat.planes.find(x => x.clave === planClave);
  const plan = p ? { nombre: p.nombre, incluidos: p.modulos_incluidos } : null;
  return (
    <section aria-labelledby="modulos-titulo" className="scroll-mt-6">
      <h2 id="modulos-titulo" className="text-3xl font-semibold tracking-tight sm:text-4xl">Suma solo lo que necesites</h2>
      <p className="mt-3 max-w-xl text-lg">Los módulos se contratan por condominio. En Gratis los eliges uno a uno; Pro los trae todos.</p>
      <ul className="mt-8 space-y-10">
        {cat.modulos.map(m => <Fila key={m.clave} m={m} plan={plan} activo={elegidos.includes(m.clave)} onAlternar={() => onAlternar(m.clave)} onSolo={() => onSolo(m.clave)} />)}
      </ul>
    </section>
  );
}
