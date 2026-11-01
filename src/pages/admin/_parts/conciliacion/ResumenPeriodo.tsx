import { Alert, Skeleton, dinero } from '../../../../ui';
import type { Resumen } from './tipos';

/**
 * Abonos, salidas y neto del periodo de los extractos (en tres columnas aun en el celular: son tres cifras cortas) y, si el extracto trae saldo, si
 * saldo inicial + movimientos = saldo final. Un tramo que no cuadra se avisa con las filas del archivo.
 */
export function ResumenPeriodo({ resumen, moneda }: { resumen: Resumen | null; moneda: string }) {
  const celdas: { label: string; valor: string | null; detalle?: string; clase?: string }[] = [
    { label: 'Abonos', valor: resumen ? dinero(resumen.abonos.monto, moneda) : null, detalle: resumen ? `${resumen.abonos.cantidad} en el banco` : undefined, clase: 'text-ok' },
    { label: 'Salidas', valor: resumen ? dinero(resumen.salidas.monto, moneda) : null, detalle: resumen ? `${resumen.salidas.cantidad} cargos` : undefined },
    { label: 'Neto del periodo', valor: resumen ? dinero(resumen.neto, moneda) : null, detalle: 'abonos − salidas', clase: resumen && Number(resumen.neto) < 0 ? 'text-bad' : undefined },
  ];
  const saldo = resumen?.saldo ?? null;
  return (
    <div className="mb-6 space-y-3">
      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line shadow-card" aria-label="Abonos, salidas y neto del periodo">
        {celdas.map(c => (
          <div key={c.label} className="min-w-0 bg-surface p-3 sm:p-4">
            <dt className="text-xs text-muted sm:text-sm">{c.label}</dt>
            <dd className={`mt-1 break-words text-base font-semibold num sm:text-xl ${c.clase ?? ''}`}>{c.valor ?? <Skeleton className="h-6 w-full max-w-[6rem]" />}</dd>
            {c.detalle && <p className="mt-0.5 text-xs text-muted">{c.detalle}</p>}
          </div>
        ))}
      </dl>
      {saldo && !saldo.cuadra && (
        <Alert tone="warn">
          <p className="font-medium">El saldo del extracto «{saldo.archivo_nombre}» no cuadra con sus movimientos.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">{saldo.avisos.map(a => <li key={a}>{a}</li>)}</ul>
          <p className="mt-1 text-sm">Si falta un movimiento, vuelve a descargar el extracto completo y súbelo: lo que ya estaba no se duplica.</p>
        </Alert>
      )}
      {saldo && saldo.cuadra && (
        <p className="text-sm text-muted">Saldo del extracto: <span className="num">{dinero(saldo.inicial, moneda)}</span> al inicio y <span className="num">{dinero(saldo.final, moneda)}</span> al final. Cuadra con los movimientos.</p>
      )}
    </div>
  );
}
