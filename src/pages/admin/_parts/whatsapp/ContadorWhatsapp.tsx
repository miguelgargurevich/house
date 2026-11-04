import { useState } from 'react';
import { useResource } from '../../../../api';
import { Alert, Badge, Button, Card, CardBody, CardHeader, ProgressBar, Skeleton } from '../../../../ui';
import { ORDEN_TIPOS, ROTULO_TIPO, porcentajeDeTope, textoTope, tonoDeTope } from './tipos';
import type { PorTipo, UsoWhatsapp } from './tipos';

/** Una cifra grande con su barra contra el tope. */
function Medidor({ titulo, usados, tope, etiquetaBarra }: { titulo: string; usados: number; tope: number | null; etiquetaBarra: string }) {
  const pct = porcentajeDeTope(usados, tope);
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted">{titulo}</p>
      <p className="num text-2xl font-semibold">{textoTope(usados, tope)}</p>
      {tope != null ? <ProgressBar value={usados} max={tope} label={etiquetaBarra} tone={tonoDeTope(pct)} className="mt-2" /> : <p className="mt-1 text-xs text-muted">Sin tope</p>}
    </div>
  );
}

/** Mensajes enviados por cada tipo, sin los que están en cero. */
function ListaPorTipo({ datos }: { datos: PorTipo }) {
  const filas = ORDEN_TIPOS.filter(t => datos[t] > 0);
  if (!filas.length) return <p className="text-sm text-muted">Nada todavía.</p>;
  return (
    <dl className="grid gap-1 text-sm">
      {filas.map(t => (
        <div key={t} className="flex items-baseline justify-between gap-3">
          <dt className="min-w-0 truncate text-muted">{ROTULO_TIPO[t]}</dt>
          <dd className="num font-medium">{datos[t]}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Cuántos WhatsApp salen del número de la administradora: lo de hoy contra el tope diario (los mensajes a grupos también cuentan), lo del mes por
 * condominio contra su cuota, lo que espera en cola y lo que falló hoy. Todo sale de la base: abrir la pantalla no le pregunta nada a WhatsApp.
 */
export function ContadorWhatsapp() {
  const uso = useResource<UsoWhatsapp>('/api/whatsapp/uso');
  const [periodo, setPeriodo] = useState<'hoy' | 'mes'>('hoy');
  const d = uso.data;
  return (
    <Card>
      <CardHeader
        title="Contador de mensajes"
        description="Lo que ha salido por tu número de WhatsApp. Los mensajes a grupos cuentan igual que los de cada vecino."
        action={<Button size="sm" variant="secondary" loading={uso.loading && !!d} onClick={() => void uso.reload()}>Actualizar</Button>}
      />
      <CardBody className="grid gap-6">
        {uso.error && <Alert tone="bad">{uso.error}</Alert>}
        {!d ? (uso.loading ? <Skeleton className="h-32 w-full" /> : null) : (
          <>
            <div className="grid gap-5 sm:grid-cols-2">
              <Medidor titulo="Enviados hoy" usados={d.hoy.enviados} tope={d.hoy.tope} etiquetaBarra="Mensajes de hoy contra el tope diario del número" />
              <div className="min-w-0">
                <p className="text-sm text-muted">En cola</p>
                <p className="num text-2xl font-semibold">{d.en_cola.total}</p>
                <p className="mt-1 text-xs text-muted">
                  {d.en_cola.total === 0 ? 'No hay mensajes esperando.' : d.en_cola.para_manana > 0 ? `${d.en_cola.para_manana} ${d.en_cola.para_manana === 1 ? 'sale' : 'salen'} mañana: hoy se alcanzó el tope diario.` : 'Salen de a poco, con pausas entre cada uno.'}
                </p>
              </div>
            </div>

            <section aria-labelledby="uso-mes">
              <h3 id="uso-mes" className="mb-2 text-sm font-semibold">Este mes, por condominio <span className="font-normal text-muted">· se renueva el 1 de {d.mes.renueva}</span></h3>
              {d.mes.condominios.length === 0 ? <p className="text-sm text-muted">Aún no tienes condominios.</p> : (
                <ul className="grid gap-4 sm:grid-cols-2">
                  {d.mes.condominios.map(c => {
                    const pct = porcentajeDeTope(c.usados, c.tope);
                    return (
                      <li key={c.complejo_id} className="min-w-0">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate font-medium">{c.nombre}</span>
                          <span className="num shrink-0 text-muted">{c.tope == null ? `${c.usados} · sin tope` : `${c.usados} de ${c.tope}`}</span>
                        </div>
                        {c.tope != null && <ProgressBar value={c.usados} max={c.tope} label={`Cuota mensual de ${c.nombre}`} tone={tonoDeTope(pct)} className="mt-1.5" />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div className="grid gap-5 sm:grid-cols-2">
              <section aria-labelledby="uso-tipo">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 id="uso-tipo" className="text-sm font-semibold">Enviados por tipo</h3>
                  <div role="group" aria-label="Periodo" className="inline-flex rounded border border-line text-xs">
                    {(['hoy', 'mes'] as const).map(p => (
                      <button key={p} type="button" aria-pressed={periodo === p} onClick={() => setPeriodo(p)} className={`h-8 px-3 first:rounded-l last:rounded-r ${periodo === p ? 'bg-brand-soft font-medium text-brand' : 'text-muted hover:bg-surface2'}`}>{p === 'hoy' ? 'Hoy' : 'El mes'}</button>
                    ))}
                  </div>
                </div>
                <ListaPorTipo datos={d.por_tipo[periodo]} />
              </section>
              <section aria-labelledby="uso-fallos">
                <h3 id="uso-fallos" className="mb-2 flex items-center gap-2 text-sm font-semibold">No salieron hoy {d.fallidos_hoy.total > 0 && <Badge tone="bad">{d.fallidos_hoy.total}</Badge>}</h3>
                {d.fallidos_hoy.total === 0 ? <p className="text-sm text-muted">Ningún mensaje falló hoy.</p> : (
                  <ul className="grid gap-1 text-sm">
                    {d.fallidos_hoy.motivos.map(m => (
                      <li key={m.motivo} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 break-words text-muted">{m.motivo}</span>
                        <span className="num shrink-0 font-medium">{m.cantidad}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
