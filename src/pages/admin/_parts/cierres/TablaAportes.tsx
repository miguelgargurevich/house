import { useState } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../../../api';
import { Alert, Badge, Button, EmptyState, ErrorState, Skeleton, StatStrip, dinero, fechaCorta, useToast } from '../../../../ui';
import type { Aporte, Aportes } from './tipos';
import { QUIEN_CONFIRMA, detalleRegistro } from './vista';
import { abrirVoucher } from './voucher';

const ESTADO = {
  sin_registrar: { tone: 'warn', label: 'El block aún no registró el pago' },
  sin_conformidad: { tone: 'info', label: 'Falta tu conformidad' },
  conforme: { tone: 'ok', label: 'Con conformidad' },
} as const;

interface Props {
  complejoId: number | null;
  mes: number;
  anio: number;
  /** Qué pagos de los blocks se ven: lo que llega a la Junta central o lo que llega a la empresa administradora. */
  destino: 'central' | 'administradora';
}

/** Lo que cada block pagó a la Junta central (o a la empresa administradora) en el mes, con el voucher y la conformidad de quien recibe. */
export function TablaAportes({ complejoId, mes, anio, destino }: Props) {
  const toast = useToast();
  const params = `mes=${mes}&anio=${anio}&destino=${destino}${complejoId ? `&complejo_id=${complejoId}` : ''}`;
  const { data, loading, error, reload } = useResource<Aportes>(`/api/cierres/aportes?${params}`);
  const [ocupado, setOcupado] = useState<number | null>(null);

  async function conformidad(a: Aporte, dar: boolean) {
    if (!a.registro) return;
    setOcupado(a.registro.id);
    try {
      await api(`/api/cierres/lineas/${a.registro.id}/conformidad`, { method: dar ? 'PUT' : 'DELETE' });
      toast.ok(dar ? 'Conformidad registrada' : 'Conformidad quitada');
      await reload();
    } catch (e) { toast.error(errorText(e)); } finally { setOcupado(null); }
  }

  if (loading && !data) return <div className="space-y-3"><Skeleton className="h-20 w-full" /><Skeleton className="h-32 w-full" /></div>;
  if (error || !data) return <ErrorState message={error ?? 'No se pudo cargar'} onRetry={() => void reload()} />;
  const d = data;
  const quien = destino === 'central' ? 'la Junta central' : 'la empresa administradora';
  return (
    <div className="space-y-5">
      <StatStrip stats={[
        { label: 'Facturado a los blocks', value: dinero(d.totales.facturado, d.moneda) },
        { label: 'Registrado por los blocks', value: dinero(d.totales.registrado, d.moneda), hint: d.totales.sin_registrar ? `${d.totales.sin_registrar} sin registrar` : undefined },
        { label: 'Con conformidad', value: dinero(d.totales.conforme, d.moneda), hint: d.totales.sin_conformidad ? `${d.totales.sin_conformidad} por confirmar` : undefined, tone: d.totales.sin_conformidad ? 'warn' : 'ok' },
      ]} />
      {destino === 'central' && (
        <p className="text-sm text-muted">
          Caja de la Junta central: <span className="num font-medium text-ink">{dinero(d.caja_central.recibido, d.moneda)}</span> ya confirmados
          {Number(d.caja_central.por_confirmar) > 0 && <> · <span className="num">{dinero(d.caja_central.por_confirmar, d.moneda)}</span> por confirmar</>} (todos los meses; sus propios egresos aún no se registran).
        </p>
      )}
      {!d.puede.conformidad && d.aportes.length > 0 && <Alert tone="info">Aquí ves lo que llegó a {quien}. La conformidad la da {destino === 'central' ? 'el tesorero central' : 'la administración'}.</Alert>}
      {d.aportes.length === 0
        ? <EmptyState title="Sin pagos para este mes" description={`Ningún block tiene lo que pagar a ${quien} en este mes.`} />
        : (
          <ul className="grid gap-3" aria-label={`Pagos a ${quien}`}>
            {d.aportes.map(a => {
              const e = ESTADO[a.estado];
              const r = a.registro;
              return (
                <li key={`${a.estructura.id}-${a.linea}`} className="rounded-lg border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
                    <div className="min-w-0">
                      <h3 className="break-words text-base font-semibold">{a.estructura.nombre ?? 'Block'}</h3>
                      <p className="break-words text-sm text-muted">{a.nombre}</p>
                    </div>
                    <Badge tone={e.tone}>{a.estado === 'sin_conformidad' && !d.puede.conformidad ? 'Falta la conformidad' : e.label}</Badge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3">
                    <div><dt className="text-xs text-muted">Facturado</dt><dd className="num text-sm font-medium">{dinero(a.facturado, d.moneda)}</dd></div>
                    {r && <div><dt className="text-xs text-muted">Transferido</dt><dd className="num text-lg font-semibold">{dinero(r.monto_pagado, d.moneda)}</dd></div>}
                  </dl>
                  {r && (
                    <>
                      <p className="mt-3 break-words border-t border-line pt-3 text-sm text-muted">{detalleRegistro(r, fechaCorta)}</p>
                      {r.conformidad && <p className="mt-1 text-sm text-ok"><CheckCircleIcon className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden="true" />Conformidad de {r.conformidad.por?.nombre ?? QUIEN_CONFIRMA[destino]} · {fechaCorta(r.conformidad.at)}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {r.voucher && <Button size="sm" variant="secondary" onClick={() => void abrirVoucher(r.id).catch(err => toast.error(errorText(err)))}>Ver voucher</Button>}
                        {a.puede_conformidad && (r.conformidad
                          ? <Button size="sm" variant="secondary" disabled={ocupado === r.id} onClick={() => void conformidad(a, false)}>Quitar conformidad</Button>
                          : <Button size="sm" disabled={ocupado === r.id} onClick={() => void conformidad(a, true)}>Confirmo que llegó a la cuenta</Button>)}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );
}
