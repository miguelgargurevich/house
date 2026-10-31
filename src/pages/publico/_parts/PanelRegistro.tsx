import { BellAlertIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { CheckIcon } from '@heroicons/react/20/solid';

/** Lo que trae el plan Gratis (espejo de `caracteristicas` del servidor, sin los que son sólo de Pro). */
const BENEFICIOS = [
  'Recibos por block, con cada concepto desglosado',
  'La cobranza del mes, al día en tu resumen',
  'Subes el Excel del recibo de cada block',
  'Vouchers validados a mano y avisos por correo',
];

/** Panel de marca junto al formulario de registro: el plan Gratis y dos tarjetas de ejemplo, del mismo estilo que el login. Los montos son de ejemplo. */
export function PanelRegistro() {
  return (
    <aside aria-labelledby="panel-registro-titulo" className="rounded-2xl bg-escena p-6 text-on-escena sm:p-10 lg:sticky lg:top-6">
      <p className="mb-3 text-sm font-medium opacity-85">Paso 1 de 2: tu cuenta. Tu condominio lo creas después de confirmar tu correo.</p>
      <p id="panel-registro-titulo" className="text-2xl font-semibold leading-tight tracking-tight text-balance sm:text-3xl">Torre Gratis por 3 meses, sin tope de departamentos.</p>
      <p className="mt-3 text-sm opacity-85">Sin tarjeta. Al terminar los 3 meses, tus datos siguen aquí y eliges Torre Básico o Torre Pro desde Mi plan.</p>
      <ul className="mt-6 space-y-2.5 text-sm">
        {BENEFICIOS.map(b => (
          <li key={b} className="flex gap-2.5"><CheckIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{b}</span></li>
        ))}
      </ul>

      <div aria-hidden="true" className="mt-8 space-y-3">
        <div className="w-full max-w-sm rounded-xl bg-escena-tarjeta p-5 text-ink shadow-[0_24px_48px_-16px_oklch(0.2_0.05_180/0.45)] sm:ml-auto">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Mantenimiento de octubre</p>
              <p className="text-xs text-muted">Block A · Depto. 804</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok"><CheckCircleIcon className="h-3.5 w-3.5" />Pagado</span>
          </div>
          <ul className="mt-4 space-y-1.5 text-xs">
            {[['Servicio de seguridad', '70.00'], ['Servicio de limpieza', '35.00'], ['Agua del departamento', '50.93']].map(([c, m]) => (
              <li key={c} className="flex justify-between gap-4"><span className="text-muted">{c}</span><span className="num">S/ {m}</span></li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
            <span className="text-xs text-muted">Total</span>
            <span className="num text-lg font-semibold">S/ 155.93</span>
          </div>
        </div>

        <div className="w-full max-w-xs rounded-xl bg-escena-tarjeta p-4 text-ink shadow-[0_18px_40px_-14px_oklch(0.2_0.05_180/0.4)]">
          <div className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><BellAlertIcon className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="text-xs font-semibold">Aviso por correo</p>
              <p className="mt-0.5 text-xs leading-snug text-muted">Tu mantenimiento de noviembre vence el 10. Págalo desde Torre en un minuto.</p>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
