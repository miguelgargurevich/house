import { ArrowUpTrayIcon, CheckCircleIcon, ShieldCheckIcon } from '@heroicons/react/24/outline';
import type { CSSProperties, ReactNode } from 'react';

/** Tamaño de diseño de la escena (px); el panel la escala para que quepa (con el margen de su plato, `ESCENA_MARGEN`). */
export const ESCENA_ANCHO = 568;
export const ESCENA_ALTO = 340;
export const ESCENA_MARGEN = { x: 56, y: 48 };

/*
 * El flujo del producto en tres tiempos, en una sola composición:
 *   1. llega el recibo del mes (con su detalle por concepto),
 *   2. el vecino sube su voucher y aparece el sello «Voucher leído · Tesorero confirmó» (IA + tesorero),
 *   3. la cobranza del block sube.
 * Las animaciones viven aquí, acotadas con prefijo `lg-`. El estado final es el natural de cada elemento: sin movimiento
 * (prefers-reduced-motion) o si la animación no corre, la escena ya está completa.
 */
const ESTILO = `
.lg-carta, .lg-sello, .lg-antes, .lg-despues, .lg-barra { animation-duration: var(--lg-dur, 700ms); animation-delay: var(--lg-d, 0ms); animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1); }
.lg-cambio { display: inline-grid; justify-items: end; }
.lg-cambio > * { grid-area: 1 / 1; }
.lg-antes { opacity: 0; visibility: hidden; }
.lg-barra { transform-origin: left center; }
@keyframes lg-sube { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes lg-sello { from { opacity: 0; transform: rotate(-9deg) scale(1.35); } 60% { opacity: 1; } to { opacity: 1; transform: rotate(-2deg) scale(1); } }
@keyframes lg-sale { from { opacity: 1; visibility: visible; } to { opacity: 0; visibility: hidden; } }
@keyframes lg-entra { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes lg-barra { from { transform: scaleX(0.9674); } to { transform: none; } }
@media (prefers-reduced-motion: no-preference) {
  .lg-carta { animation-name: lg-sube; animation-fill-mode: backwards; }
  .lg-sello { animation-name: lg-sello; animation-fill-mode: backwards; }
  .lg-antes { animation-name: lg-sale; animation-fill-mode: both; --lg-dur: 260ms; }
  .lg-despues { animation-name: lg-entra; animation-fill-mode: backwards; --lg-dur: 320ms; }
  .lg-barra { animation-name: lg-barra; animation-fill-mode: backwards; --lg-dur: 900ms; }
}
`;

const retardo = (ms: number): CSSProperties => ({ ['--lg-d' as string]: `${ms}ms` });

/** Dos textos en el mismo lugar: el de «antes» sale y el de «después» entra. Sin movimiento sólo se ve el «después». */
function Cambio({ antes, despues, en }: { antes: ReactNode; despues: ReactNode; en: number }) {
  return (
    <span className="lg-cambio">
      <span className="lg-antes" style={retardo(en)}>{antes}</span>
      <span className="lg-despues" style={retardo(en)}>{despues}</span>
    </span>
  );
}

const carta = 'lg-carta absolute rounded-xl bg-escena-tarjeta text-ink ring-1 ring-ink/5';
const sombraAlta = 'shadow-[0_28px_56px_-18px_oklch(0.18_0.05_180/0.55),0_6px_14px_-6px_oklch(0.18_0.05_180/0.3)]';
const sombraMedia = 'shadow-[0_20px_40px_-16px_oklch(0.18_0.05_180/0.5),0_4px_10px_-4px_oklch(0.18_0.05_180/0.28)]';

/** La escena. Decorativa: el panel que la contiene ya es `aria-hidden`. Montos de ejemplo. */
export default function Escena() {
  return (
    <div className="relative h-full w-full">
      <style>{ESTILO}</style>
      <div className="absolute -inset-x-7 -inset-y-6 rounded-[1.75rem] border border-on-escena/10 bg-on-escena/[0.05]" />
      <Recibo />
      <Voucher />
      <Cobranza />
    </div>
  );
}

/** Protagonista: el mantenimiento del mes del vecino, desglosado por concepto. Pasa de «Por pagar» a «Pagado» cuando se confirma su voucher. */
function Recibo() {
  const conceptos: [string, string][] = [['Servicio de seguridad', '70.00'], ['Agua del departamento', '50.93'], ['Servicio de limpieza', '35.00'], ['Luz de áreas comunes', '16.10'], ['Contingencia del block', '10.00']];
  return (
    <div className={`${carta} ${sombraAlta} left-0 top-7 z-10 w-[20rem] p-5`} style={retardo(80)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Mantenimiento de octubre</p>
          <p className="text-xs text-muted">B01-804 · Block 1</p>
        </div>
        <Cambio
          en={1700}
          antes={<span className="inline-flex items-center rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">Por pagar</span>}
          despues={<span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok"><CheckCircleIcon className="h-3.5 w-3.5" />Pagado</span>}
        />
      </div>
      <ul className="mt-4 space-y-1.5 text-xs">
        {conceptos.map(([c, m]) => (
          <li key={c} className="flex justify-between gap-4"><span className="text-muted">{c}</span><span className="num">S/ {m}</span></li>
        ))}
      </ul>
      <div className="mt-3 flex items-baseline justify-between border-t border-ink/10 pt-3">
        <span className="text-xs text-muted">Total</span>
        <span className="num text-lg font-semibold">S/ 182.03</span>
      </div>
    </div>
  );
}

/** El voucher que sube el vecino y el diferencial: lo lee la IA y lo confirma el tesorero. */
function Voucher() {
  const filas: [string, string][] = [['Monto', 'S/ 182.03'], ['N.º de operación', '04821937'], ['Destino', 'Cuenta del condominio']];
  return (
    <div className={`${carta} ${sombraMedia} right-0 top-0 z-20 w-[16.5rem] p-4`} style={retardo(780)}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><ArrowUpTrayIcon className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">Voucher subido</p>
          <p className="text-xs text-muted">Yape · 12 oct, 14:32</p>
        </div>
      </div>
      <dl className="mt-3 space-y-1.5 text-xs">
        {filas.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="num font-medium">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-4 flex justify-center">
        <p className="lg-sello inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border-2 border-ok bg-ok-soft px-2 py-1.5 text-[0.6875rem] font-semibold text-ok" style={{ ...retardo(1350), transform: 'rotate(-2deg)' }}>
          <ShieldCheckIcon className="h-4 w-4 shrink-0" />Voucher leído · Tesorero confirmó
        </p>
      </div>
      <p className="mt-2.5 text-center text-xs text-muted">La IA lee el monto y la operación; el tesorero confirma.</p>
    </div>
  );
}

/** Lo que ve la administradora: la cobranza del block sube con cada pago confirmado. */
function Cobranza() {
  return (
    <div className={`${carta} ${sombraMedia} bottom-0 right-0 z-30 w-[16.5rem] p-4`} style={retardo(1500)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold">Cobranza de octubre · Block 1</p>
        <p className="num text-sm font-semibold text-brand"><Cambio en={2050} antes="89 %" despues="92 %" /></p>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-ink/10"><div className="lg-barra h-full w-[92%] rounded-full bg-brand" style={retardo(2050)} /></div>
      <p className="mt-2 text-xs text-muted"><span className="num"><Cambio en={2050} antes="32" despues="33" /></span> de <span className="num">36</span> departamentos al día</p>
    </div>
  );
}
