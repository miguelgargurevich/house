import { useState } from 'react';
import { ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { Alert, Button, soles, useToast } from '../../../../ui';
import type { Cotizacion, DatosPago } from '../../../shared/_parts/comercial';

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string | null }) {
  const toast = useToast();
  if (!valor) return null;
  const copiar = () => { void navigator.clipboard?.writeText(valor).then(() => toast.ok('Copiado'), () => toast.error('No se pudo copiar')); };
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="text-sm text-muted">{etiqueta}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        <span className="num truncate">{valor}</span>
        <button type="button" onClick={copiar} aria-label={`Copiar ${etiqueta}`} className="rounded p-1 text-muted transition-colors duration-150 hover:text-brand"><ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" /></button>
      </dd>
    </div>
  );
}

/** Cómo pagar: monto exacto (base + IGV), referencia sugerida y los datos de pago que cargó el superadmin. */
export function ComoPagar({ cot, referencia, pagar }: { cot: Cotizacion; referencia: string; pagar: DatosPago }) {
  const sinDatos = !pagar.yape && !pagar.cuenta && !pagar.cci;
  return (
    <section aria-label="Cómo pagar" className="rounded border border-line p-4">
      <h3 className="text-sm font-semibold">Cómo pagar</h3>
      <dl className="mt-2 divide-y divide-line">
        <div className="flex items-center justify-between gap-3 py-1.5">
          <dt className="text-sm text-muted">Monto al mes</dt>
          <dd className="text-right text-sm"><span className="num text-base font-semibold">{soles(cot.total_mes)}</span><span className="num block text-xs text-muted">{soles(cot.base)} + IGV {soles(cot.igv)}</span></dd>
        </div>
        <Fila etiqueta="Referencia" valor={referencia} />
        <Fila etiqueta="Yape" valor={pagar.yape} />
        <Fila etiqueta="Banco" valor={pagar.banco} />
        <Fila etiqueta="Cuenta" valor={pagar.cuenta} />
        <Fila etiqueta="CCI" valor={pagar.cci} />
        <Fila etiqueta="Titular" valor={pagar.titular} />
      </dl>
      {pagar.instrucciones && <p className="mt-2 text-xs text-muted">{pagar.instrucciones}</p>}
      {sinDatos && <div className="mt-2"><Alert tone="warn">Aún no hay datos de pago cargados: escríbenos y te los pasamos.</Alert></div>}
      <p className="mt-3 text-xs text-muted">Cuando pagues, avísanos con tu voucher y activamos tu plan. Anota la referencia al transferir.</p>
    </section>
  );
}

export function BotonCopiar({ texto, etiqueta }: { texto: string; etiqueta: string }) {
  const [ok, setOk] = useState(false);
  return <Button size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); }); }}>{ok ? 'Copiado' : etiqueta}</Button>;
}
