import { useLayoutEffect, useRef, useState } from 'react';
import { BanknotesIcon, BellAlertIcon, CalendarDaysIcon } from '@heroicons/react/24/outline';
import Escena, { ESCENA_ALTO, ESCENA_ANCHO, ESCENA_MARGEN } from './Escena';

/** Lo que House hace de verdad hoy; sin cifras ni clientes inventados. */
const HECHOS = [
  { icono: BanknotesIcon, texto: 'Yape, Plin y transferencias' },
  { icono: BellAlertIcon, texto: 'Avisos por WhatsApp y correo' },
  { icono: CalendarDaysIcon, texto: 'Cierre del mes por block' },
] as const;

/** Escala la escena (tamaño fijo de diseño) al hueco que le deja el panel, sin pasar de 1.3 ni bajar de 0.55. */
function useAjuste() {
  const hueco = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1);
  useLayoutEffect(() => {
    const el = hueco.current;
    if (!el) return;
    const medir = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width && height) setK(Math.max(0.55, Math.min(1.5, width / (ESCENA_ANCHO + ESCENA_MARGEN.x), height / (ESCENA_ALTO + ESCENA_MARGEN.y))));
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [hueco, k] as const;
}

/**
 * Panel derecho del login: titular, una escena compuesta del flujo (recibo → voucher leído y confirmado → cobranza) y los hechos del producto.
 * Decorativo (`aria-hidden`) y sólo desde `lg:`. Fijo a la altura de la ventana: la escena se escala al hueco, el panel nunca estira la página.
 */
export default function PanelLogin() {
  const [hueco, k] = useAjuste();
  return (
    <aside className="relative hidden overflow-hidden bg-escena text-on-escena lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:px-10 lg:py-12 xl:px-16 2xl:px-20" aria-hidden="true">
      <div className="mx-auto flex min-h-0 w-full max-w-[50rem] flex-1 flex-col">
        <h2 className="max-w-[16ch] text-balance text-[2.5rem] font-semibold leading-[1.06] tracking-[-0.03em] [@media(max-height:780px)]:text-4xl xl:text-[3.25rem] 2xl:text-[3.75rem] xl:[@media(max-height:780px)]:text-[2.5rem]">
          Cobra a tiempo <span className="block text-on-escena/75">y que cada vecino sepa qué debe.</span>
        </h2>
        <p className="mt-4 max-w-[30rem] text-pretty text-base leading-relaxed text-on-escena/85">
          Cada recibo con su detalle por concepto; cada voucher, leído por la IA y confirmado por el tesorero.
        </p>

        <div ref={hueco} className="relative my-6 min-h-0 flex-1">
          <div className="absolute left-1/2 top-1/2" style={{ width: ESCENA_ANCHO, height: ESCENA_ALTO, transform: `translate(-50%, -50%) scale(${k})` }}>
            <Escena />
          </div>
        </div>

        <ul className="grid grid-cols-3 gap-4 border-t border-on-escena/20 pt-5 text-xs leading-snug text-on-escena/85">
          {HECHOS.map(({ icono: Icono, texto }) => (
            <li key={texto} className="flex flex-col gap-2"><Icono className="h-4 w-4" />{texto}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
