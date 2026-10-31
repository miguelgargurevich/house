import { Link } from 'react-router-dom';
import { BanknotesIcon, BellAlertIcon, ReceiptPercentIcon } from '@heroicons/react/24/outline';
import { PORTADA } from '../../lib/seo/textos';
import { Marco } from './Marco';

const ICONOS = [ReceiptPercentIcon, BanknotesIcon, BellAlertIcon] as const;
// Los textos viven en `lib/seo/textos` (los comparte el HTML estático para buscadores); aquí sólo se les pone el ícono.
const BENEFICIOS = PORTADA.beneficios.map((b, i) => ({ ...b, icono: ICONOS[i] }));

/** Portada para quien llega sin sesión: qué es House, tres beneficios y los dos caminos (crear cuenta, ver precios). */
export default function Portada() {
  return (
    <Marco>
      <section className="py-4 text-center sm:py-10">
        <h1 className="mx-auto max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">{PORTADA.h1}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted sm:text-lg">{PORTADA.bajada}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/registro" className="rounded bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors duration-150 hover:bg-brand-hover">{PORTADA.botones.registro}</Link>
          <Link to="/precios" className="rounded border border-line px-5 py-2.5 text-sm font-semibold transition-colors duration-150 hover:border-brand hover:text-brand">{PORTADA.botones.precios}</Link>
        </div>
      </section>
      <ul className="mt-10 grid gap-4 sm:mt-14 sm:grid-cols-3">
        {BENEFICIOS.map(({ icono: Icono, titulo, texto }) => (
          <li key={titulo} className="rounded-lg border border-line bg-surface p-5 shadow-card">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand"><Icono className="h-5 w-5" aria-hidden="true" /></span>
            <h2 className="mt-4 text-base font-semibold">{titulo}</h2>
            <p className="mt-1 text-sm text-muted">{texto}</p>
          </li>
        ))}
      </ul>
    </Marco>
  );
}
