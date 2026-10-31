import { Link } from 'react-router-dom';
import { BanknotesIcon, BellAlertIcon, ReceiptPercentIcon } from '@heroicons/react/24/outline';
import { Marco } from './Marco';

const BENEFICIOS = [
  { icono: ReceiptPercentIcon, titulo: 'Recibos claros por block', texto: 'Emite desde tu Excel y cada vecino ve qué debe, en tu moneda, desde su celular.' },
  { icono: BanknotesIcon, titulo: 'Cobranza y morosidad al día', texto: 'Vouchers, medios de pago del condominio y seguimiento de lo vencido.' },
  { icono: BellAlertIcon, titulo: 'Torre Gratis para empezar', texto: 'Torre Gratis por 3 meses, hasta 20 departamentos. Después, Torre Básico para edificios chicos o Torre Pro con todo: IA de vouchers, WhatsApp, asistente, mora automática y reportes.' },
] as const;

/** Portada para quien llega sin sesión: qué es House, tres beneficios y los dos caminos (crear cuenta, ver precios). */
export default function Portada() {
  return (
    <Marco>
      <section className="py-4 text-center sm:py-10">
        <h1 className="mx-auto max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl">Cobra las cuotas de tu condominio sin perseguir a nadie</h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted sm:text-lg">Torre ordena recibos, pagos y morosidad de edificios y condominios en el Perú. Empieza gratis; activa la IA cuando la necesites.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/registro" className="rounded bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors duration-150 hover:bg-brand-hover">Crear cuenta gratis</Link>
          <Link to="/precios" className="rounded border border-line px-5 py-2.5 text-sm font-semibold transition-colors duration-150 hover:border-brand hover:text-brand">Ver precios</Link>
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
