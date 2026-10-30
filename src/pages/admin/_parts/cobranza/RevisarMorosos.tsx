import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Badge, Button, EmptyState, ErrorState, Skeleton, StatusBadge, dinero, fechaCorta, periodo, useToast } from '../../../../ui';
import { textoFechaPago } from '../../../shared/mantenimiento/fechaPago';
import { ESTADO_MORA, fechaDeCorreccion, filtrarUnidades, motivoRevisar, resumenVista } from './morosos';
import type { PagoMora, UnidadMora, VistaMora } from './morosos';

/** De dónde sale la vista: los datos del recibo que se va a emitir, o el Excel que se va a subir (se lee sin crear nada). */
export type FuenteMora =
  | { tipo: 'recibo'; complejoId: string; estructuraId: string; mes: string; anio: string }
  | { tipo: 'excel'; complejoId: string; archivo: File };

const clave = (f: FuenteMora) => (f.tipo === 'recibo' ? `r|${f.complejoId}|${f.estructuraId}|${f.mes}|${f.anio}` : `x|${f.complejoId}|${f.archivo.name}|${f.archivo.size}|${f.archivo.lastModified}`);

function FilaPago({ pago, moneda, onCorregida }: { pago: PagoMora; moneda?: string; onCorregida: () => void }) {
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  const [dia, setDia] = useState(pago.dia);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    if (!dia) return;
    setGuardando(true);
    try {
      // Reusa la corrección de pagos de siempre: la fecha queda como «corregida a mano» (ninguna evaluación posterior la pisa) y auditada.
      await api(`/api/pagos/${pago.id}`, { method: 'PUT', json: { fecha_pago: fechaDeCorreccion(dia) } });
      toast.ok('Fecha corregida.');
      setEditando(false);
      onCorregida();
    } catch (e) { toast.error(errorText(e)); }
    finally { setGuardando(false); }
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="num whitespace-nowrap font-medium">{fechaCorta(pago.fecha_pago)}</span>
      <span className="text-xs text-muted">{textoFechaPago(pago.fecha_origen)}</span>
      <span className="num text-xs text-muted">{dinero(pago.monto, moneda)}</span>
      <StatusBadge estado={pago.estado_validacion} />
      {editando ? (
        <span className="flex items-center gap-2">
          <input type="date" aria-label="Fecha del voucher" className="h-8 rounded border border-line bg-surface px-2 text-sm" value={dia} onChange={e => setDia(e.target.value)} />
          <Button size="sm" loading={guardando} disabled={!dia} onClick={() => void guardar()}>Guardar fecha</Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditando(false); setDia(pago.dia); }} disabled={guardando}>Cancelar</Button>
        </span>
      ) : <Button size="sm" variant="ghost" onClick={() => setEditando(true)}>Corregir fecha</Button>}
    </li>
  );
}

function FilaUnidad({ u, moneda, onCorregida }: { u: UnidadMora; moneda?: string; onCorregida: () => void }) {
  const estado = ESTADO_MORA[u.estado];
  const motivo = motivoRevisar(u);
  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[7rem_13rem_1fr] sm:items-start">
      <span className="num font-medium">{u.codigo}</span>
      <span className="flex flex-col items-start gap-1">
        <Badge tone={estado.tone}>{estado.label}</Badge>
        {u.revisar && <Badge tone="warn">Revisar</Badge>}
      </span>
      <div className="min-w-0 space-y-1">
        {u.pagos.length > 0
          ? <ul className="space-y-1" aria-label={`Pagos de ${u.codigo}`}>{u.pagos.map(p => <FilaPago key={p.id} pago={p} moneda={moneda} onCorregida={onCorregida} />)}</ul>
          : <p className="text-sm text-muted">{u.estado === 'sin_deuda' ? 'No tenía cargos en el recibo anterior.' : 'Sin pagos registrados.'}</p>}
        {motivo && <p className="text-xs text-muted">{motivo}</p>}
      </div>
    </li>
  );
}

/**
 * «Revisar morosos»: quién pagó tarde el recibo del mes anterior, con la fecha del voucher de cada pago, ANTES de emitir. Es el mismo cálculo que hace la
 * emisión: lo que ves aquí es lo que se cobrará. Una fecha mal leída se corrige aquí mismo y la lista se recalcula.
 */
export function RevisarMorosos({ fuente, moneda }: { fuente: FuenteMora; moneda?: string }) {
  const [vista, setVista] = useState<VistaMora | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [soloRevisar, setSoloRevisar] = useState(false);
  const k = clave(fuente);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      if (fuente.tipo === 'recibo') {
        const q = new URLSearchParams({ complejo_id: fuente.complejoId, mes: fuente.mes, anio: fuente.anio });
        if (fuente.estructuraId) q.set('estructura_id', fuente.estructuraId);
        setVista(await api<VistaMora>(`/api/recibos/vista-mora?${q}`));
      } else {
        const fd = new FormData();
        fd.append('archivo', fuente.archivo);
        fd.append('complejo_id', fuente.complejoId);
        setVista(await api<VistaMora>('/api/recibos/excel/vista-mora', { method: 'POST', body: fd }));
      }
    } catch (e) { setError(errorText(e)); }
    finally { setCargando(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `k` resume todo lo que usa `fuente`: cambiar el objeto sin cambiar sus datos no debe recargar.
  }, [k]);
  useEffect(() => { void cargar(); }, [cargar]);

  if (error) return <ErrorState message={error} onRetry={() => void cargar()} />;
  if (!vista) return <div className="space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-32 w-full" /></div>;

  return (
    <div className="space-y-4" aria-busy={cargando}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Morosos del recibo de {periodo(vista.mes, vista.anio).toLowerCase()}</h3>
          <p className="text-sm text-muted">{resumenVista(vista)}{vista.aplica && Number(vista.monto) > 0 ? ` · multa de ${dinero(vista.monto, moneda)}` : ''}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={soloRevisar} onChange={e => setSoloRevisar(e.target.checked)} />
          Sólo para revisar
        </label>
      </div>
      {!vista.aplica && <Alert tone="info">{resumenVista(vista)}</Alert>}
      {vista.torres.map(t => {
        const filas = filtrarUnidades(t.unidades, soloRevisar);
        return (
          <section key={t.estructura_id ?? 'sin-torre'} aria-label={t.torre ?? 'Sin torre'}>
            {(vista.torres.length > 1 || t.torre) && <h4 className="text-sm font-medium">{t.torre ?? 'Departamentos sin torre'}</h4>}
            {!t.anterior ? (
              <p className="text-sm text-muted">No hay recibo del mes anterior{t.torre ? ` en ${t.torre}` : ''}: nadie recibirá multa.</p>
            ) : t.aun_no_vence ? (
              <Alert tone="warn">El recibo de {periodo(t.anterior.mes, t.anterior.anio).toLowerCase()} vence el {fechaCorta(t.anterior.fecha_vencimiento)}: aún no se puede saber quién pagó tarde, así que no se agregará multa.</Alert>
            ) : filas.length === 0 ? (
              <EmptyState title={soloRevisar ? 'Nada para revisar' : 'Sin departamentos'} description={soloRevisar ? 'Todas las fechas vienen del voucher y no hay pagos por validar.' : 'Esta torre no tiene departamentos activos.'} />
            ) : (
              <>
                <p className="text-xs text-muted">Recibo de {periodo(t.anterior.mes, t.anterior.anio).toLowerCase()} · vence el {fechaCorta(t.anterior.fecha_vencimiento)}</p>
                <ul className="max-h-96 divide-y divide-line overflow-y-auto" aria-label={`Departamentos de ${t.torre ?? 'la torre'}`}>
                  {filas.map(u => <FilaUnidad key={u.unidad_id} u={u} moneda={moneda} onCorregida={() => void cargar()} />)}
                </ul>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
