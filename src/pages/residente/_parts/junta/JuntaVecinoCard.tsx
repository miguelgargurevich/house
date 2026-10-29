import { useState } from 'react';
import { ClipboardDocumentIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { Badge, Card, CardBody, CardHeader, fechaCorta, useToast } from '../../../../ui';
import { cargoLabel, lineaCuenta } from '../../../admin/_parts/juntas/tipos';
import { QrImagen } from '../../../admin/_parts/medios/QrMiniatura';
import { laJunta, mailtoJunta, nombreJunta } from './tipos';
import type { CuentaVecino, JuntaVecino } from './tipos';

/** Un dato de la cuenta con su botón «Copiar» (el número, el CCI o el celular). */
function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  const toast = useToast();
  const [ok, setOk] = useState(false);
  const copiar = () => {
    void navigator.clipboard?.writeText(valor).then(
      () => { setOk(true); toast.ok(`${etiqueta} copiado`); setTimeout(() => setOk(false), 1500); },
      () => toast.error('No se pudo copiar'),
    );
  };
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="text-muted">{etiqueta}</span>
      <span className="num break-all font-medium">{valor}</span>
      <button type="button" onClick={copiar} aria-label={`Copiar ${etiqueta.toLowerCase()}`} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-brand hover:bg-surface2">
        <ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />{ok ? 'Copiado' : 'Copiar'}
      </button>
    </p>
  );
}

function Cuenta({ c }: { c: CuentaVecino }) {
  return (
    <li className="flex items-start gap-3 rounded-lg border border-line p-3 text-sm">
      {c.tiene_qr && <QrImagen id={c.id} alt={`Código QR de ${c.titular}`} className="h-20 w-20 shrink-0" />}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-medium">{lineaCuenta(c)}</p>
        {c.tipo === 'banco' && c.numero_cuenta && <Dato etiqueta="Cuenta" valor={c.numero_cuenta} />}
        {c.tipo === 'banco' && c.cci && <Dato etiqueta="CCI" valor={c.cci} />}
        {(c.tipo === 'yape' || c.tipo === 'plin') && c.celular && <Dato etiqueta="Celular" valor={c.celular} />}
        {c.instruccion && <p className="break-words text-muted">{c.instruccion}</p>}
        <p className="break-words text-muted">Titular: {c.titular}{c.moneda === 'USD' ? ' · Dólares' : ''}</p>
      </div>
    </li>
  );
}

/** «Mi junta»: la junta vigente de un block (o la Junta central) en sólo lectura. Cargo, nombre y departamento; el correo de la junta; la cuenta donde se paga. */
export function JuntaVecinoCard({ item, mostrarCondominio }: { item: JuntaVecino; mostrarCondominio: boolean }) {
  const { ambito, junta: j } = item;
  const nombre = nombreJunta(ambito);
  const centro = ambito.estructura == null;
  return (
    <Card>
      <CardHeader
        title={nombre}
        description={[mostrarCondominio ? ambito.complejo.nombre : null, centro ? 'Junta de todo el condominio' : j ? `Desde ${fechaCorta(j.desde)}` : null].filter(Boolean).join(' · ') || undefined}
        action={j ? <Badge tone="ok">Vigente</Badge> : <Badge tone="neutral">Sin junta</Badge>}
      />
      <CardBody className="flex flex-col gap-5">
        {!j ? (
          <p className="text-sm text-muted">{`Aún no hay una junta registrada para ${nombre}. Cuando la administración la registre, verás aquí a sus miembros y la cuenta donde pagar.`}</p>
        ) : (
          <>
            <section aria-label={`Miembros de ${laJunta(ambito)}`}>
              <h3 className="mb-2 text-sm font-semibold">Quiénes la forman</h3>
              {j.miembros.length === 0 ? (
                <p className="text-sm text-muted">Aún no hay miembros registrados.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {j.miembros.map((m, i) => (
                    <li key={`${m.cargo}-${i}`} className="min-w-0 rounded-lg border border-line p-3 text-sm">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge tone={m.cargo === 'presidente' || m.cargo === 'tesorero' ? 'brand' : 'neutral'}>{cargoLabel(m.cargo)}</Badge>
                        <span className="break-words font-medium">{m.nombre}</span>
                      </p>
                      {m.departamentos.length > 0 && <p className="mt-1 break-words text-xs text-muted">Dpto. {m.departamentos.join(', ')}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {j.correo && (
              <section aria-label={`Escríbele a ${laJunta(ambito)}`}>
                <a href={mailtoJunta(j.correo)} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-brand hover:bg-surface2">
                  <EnvelopeIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0">Escríbele a {centro ? 'la Junta central' : 'tu junta'}<span className="block break-all text-xs font-normal text-muted">{j.correo}</span></span>
                </a>
              </section>
            )}

            <section aria-label={`Cuenta de ${laJunta(ambito)}`}>
              <h3 className="mb-2 text-sm font-semibold">Dónde pagas</h3>
              {j.cuentas.length === 0
                ? <p className="text-sm text-muted">Esta junta aún no registró una cuenta. Consulta cómo pagar en tu recibo o pregunta a la administración.</p>
                : <ul className="grid gap-2">{j.cuentas.map(c => <Cuenta key={c.id} c={c} />)}</ul>}
            </section>
          </>
        )}
      </CardBody>
    </Card>
  );
}
