import { useRef } from 'react';
import type { ChangeEvent } from 'react';
import { CameraIcon } from '@heroicons/react/24/outline';
import { ACCEPT_COMPROBANTE, tamanoLegible } from '../../shared/comprobantes';
import { Button, Input, Select, Skeleton, fechaCorta, soles } from '../../../ui';
import { FORM_PAGO } from './pago';
import { METODOS } from './tipos';
import type { Metodo } from './tipos';
import type { Mantenimiento } from '../../shared/mantenimiento/tipos';

interface PanelProps {
  mant: Mantenimiento;
  /** Saldo a pagar; `null` mientras carga el detalle. */
  saldo: string | null;
  /** Correo del block (lo carga la junta): el voucher también se le manda ahí. */
  correoVouchers: string | null;
  metodo: Metodo;
  onMetodo: (m: Metodo) => void;
  referencia: string;
  onReferencia: (v: string) => void;
  archivo: File | null;
  /** Qué falla con el archivo (lo vio el navegador o lo dijo el servidor). */
  errorArchivo?: string;
  onArchivo: (e: ChangeEvent<HTMLInputElement>) => void;
  conCamara: boolean;
  onEnviar: () => void;
}

/** Todo «Pagar mantenimiento» en un solo panel: cuánto y el voucher. Las cuentas de pago van en el recibo. El pie (Cancelar / Enviar pago) es `PiePago`. */
export function PanelPago(p: PanelProps) {
  const { mant } = p;
  const inputCamara = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-6">
      {/* Sólo lo que hace falta: el monto y de qué mes es. El detalle por concepto está en el recibo. */}
      <div className="rounded border border-line bg-surface2 px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-sm text-muted">Monto a pagar</p>
          <div className="num text-2xl font-semibold">{p.saldo !== null ? soles(p.saldo) : <Skeleton className="h-7 w-32" />}</div>
        </div>
        <p className="mt-1 text-sm text-muted">
          {mant.titulo.split(' · ')[0]} · {mant.unidad.codigo}{mant.unidad.estructura?.nombre ? ` · ${mant.unidad.estructura.nombre}` : ''} · vence el {fechaCorta(mant.fecha_vencimiento)}
        </p>
      </div>

      <section aria-labelledby="pago-voucher" className="space-y-3">
        <h3 id="pago-voucher" className="text-base font-semibold">Sube tu voucher</h3>
        <p className="text-sm text-muted">Cuando hayas pagado, sube la foto o el PDF de tu voucher y envía tu pago. Queda en revisión hasta que se valide.</p>
        {p.correoVouchers && <p className="text-sm text-muted">Al enviarlo, también se lo mandamos a la junta del block (<span className="break-all font-medium">{p.correoVouchers}</span>).</p>}
        <form id={FORM_PAGO} onSubmit={e => { e.preventDefault(); p.onEnviar(); }} noValidate className="grid gap-4 sm:grid-cols-2">
          <div>
            <Input
              label="Voucher (foto o PDF)"
              type="file"
              accept={ACCEPT_COMPROBANTE}
              required
              aria-required="true"
              hint="Obligatorio. Hasta 2 MB. La IA lo revisa para validarlo más rápido."
              error={p.errorArchivo}
              onChange={p.onArchivo}
              className="[&_input]:h-auto [&_input]:py-2"
            />
            {p.conCamara && <div className="mt-2">
              <Button size="sm" variant="secondary" icon={<CameraIcon className="h-4 w-4" />} onClick={() => inputCamara.current?.click()}>Tomar foto con la cámara</Button>
              <input ref={inputCamara} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={p.onArchivo} className="sr-only" tabIndex={-1} aria-label="Tomar una foto del voucher" />
            </div>}
            {p.archivo && (
              <p className="mt-2 flex items-center justify-between gap-3 rounded bg-surface2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">{p.archivo.name} · <span className="num text-muted">{tamanoLegible(p.archivo.size)}</span></span>
              </p>
            )}
          </div>
          <div className="grid content-start gap-4">
            <Select label="¿Cómo pagaste?" value={p.metodo} onChange={e => p.onMetodo(e.target.value as Metodo)}>
              {METODOS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
            <Input label="N.º de operación (opcional)" autoComplete="off" value={p.referencia} onChange={e => p.onReferencia(e.target.value)} />
          </div>
        </form>
      </section>
    </div>
  );
}
