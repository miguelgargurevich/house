import type { ReactNode } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
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

function Fila({ m }: { m: Modulo }) {
  return (
    <Aparece como="li" className="grid gap-5 sm:grid-cols-[18rem_1fr] sm:gap-8">
      <div aria-hidden="true" data-ui className="flex min-h-36 items-center justify-center rounded-xl bg-surface2 p-4">{MUESTRAS[m.clave]}</div>
      <div className="flex flex-col justify-center">
        <h3 className="text-xl font-semibold leading-snug">{m.nombre}</h3>
        {m.descripcion && <p className="mt-1.5 text-base">{m.descripcion}</p>}
      </div>
    </Aparece>
  );
}

/** Lo que trae Pro: cada módulo con su muestra y su beneficio. Ya no se venden sueltos, así que no llevan precio ni botón de sumar. */
export function Modulos({ cat, onCalcular }: { cat: Catalogo; onCalcular: (clave: string) => void }) {
  const pro = cat.planes.find(p => p.clave === 'pro');
  return (
    <section aria-labelledby="modulos-titulo" className="scroll-mt-6">
      <h2 id="modulos-titulo" className="text-3xl font-semibold tracking-tight sm:text-4xl">Lo que trae {pro?.nombre ?? 'Torre Pro'}</h2>
      <p className="mt-3 max-w-xl text-lg">Estos módulos van incluidos en {pro?.nombre ?? 'Torre Pro'}; no se venden por separado y el plan Torre Gratis no los trae.</p>
      <ul className="mt-8 space-y-10">
        {cat.modulos.map(m => <Fila key={m.clave} m={m} />)}
      </ul>
      {pro && <p className="mt-8"><a href="#recibo" onClick={() => onCalcular(pro.clave)} className="inline-flex h-11 items-center text-base font-medium text-brand underline underline-offset-4 hover:text-brand-hover">Ver mi total con {pro.nombre}</a></p>}
    </section>
  );
}
