import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { ArrowDownTrayIcon, ArrowUpTrayIcon, CameraIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../../../api';
import { Alert, Button, Card, ConfirmDialog, ErrorState, IconButton, Input, Skeleton, soles, useToast } from '../../../../ui';
import { avisoAgua, cuentaAgua } from './calculo';
import { DatosRecibo } from './DatosRecibo';
import { FotoContometroModal } from './FotoContometroModal';
import type { AguaDelRecibo, FilaAgua, ResultadoGuardado, ResultadoImportacion } from './tipos';

interface Borrador { fa: string; la: string; fc: string; lc: string; fx: string }

const dia = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
/** «4.9300» → «4.93». */
const sinCeros = (n: string) => (n.includes('.') ? n.replace(/0+$/, '').replace(/\.$/, '') : n);

/** Lo que se muestra al abrir: la lectura guardada o, si no hay, la anterior precargada con la actual del mes previo. */
const inicialDe = (f: FilaAgua): Borrador => f.lectura
  ? { fa: dia(f.lectura.fecha_anterior), la: f.lectura.lectura_anterior, fc: dia(f.lectura.fecha_actual), lc: f.lectura.lectura_actual, fx: sinCeros(f.lectura.factor) }
  : { fa: dia(f.anterior?.fecha), la: f.anterior?.lectura ?? '', fc: '', lc: '', fx: f.anterior ? sinCeros(f.anterior.factor) : '' };

const completa = (b: Borrador) => Boolean(b.fa && b.la.trim() && b.fc && b.lc.trim() && b.fx.trim());
const distinta = (a: Borrador, b: Borrador) => a.fa !== b.fa || a.la !== b.la || a.fc !== b.fc || a.lc !== b.lc || a.fx !== b.fx;

const campo = 'h-8 w-full min-w-[5.5rem] rounded border border-line bg-surface px-2 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/25 aria-[invalid=true]:border-bad';

const TAM_LOTE = 500;

/**
 * Lecturas de agua de un recibo (una por departamento): tabla editable con la lectura anterior ya precargada, factor para toda la torre,
 * carga por Excel/CSV con plantilla, foto del contómetro y el cruce con lo que el recibo cobra por «AGUA DPTO.». La usan la administración
 * (en el periodo) y la junta del block; el servidor limita qué recibo y qué departamentos alcanza cada una.
 */
export function AguaRecibo({ reciboId, onCambio }: { reciboId: number; onCambio?: () => void }) {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<AguaDelRecibo>(`/api/recibos/${reciboId}/agua`);
  const [borr, setBorr] = useState<Record<number, Borrador>>({});
  const [factor, setFactor] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [informe, setInforme] = useState<ResultadoImportacion | null>(null);
  const [foto, setFoto] = useState<FilaAgua | null>(null);
  const [quitar, setQuitar] = useState<FilaAgua | null>(null);
  const archivo = useRef<HTMLInputElement>(null);

  const inicial = useMemo(() => Object.fromEntries((data?.items ?? []).map(f => [f.unidad.id, inicialDe(f)])) as Record<number, Borrador>, [data]);
  useEffect(() => { setBorr(inicial); setErrores({}); }, [inicial]);
  useEffect(() => { if (data?.factor_sugerido) setFactor(f => f || sinCeros(data.factor_sugerido!)); }, [data]);

  const cambiadas = (data?.items ?? []).filter(f => borr[f.unidad.id] && inicial[f.unidad.id] && distinta(borr[f.unidad.id]!, inicial[f.unidad.id]!) && completa(borr[f.unidad.id]!));

  function editar(id: number, parte: Partial<Borrador>) { setBorr(b => ({ ...b, [id]: { ...b[id]!, ...parte } })); }

  /** El factor de la torre se pone una vez: se copia a todas las filas (las que ya tenían lectura quedan por guardar si el factor cambió). */
  function aplicarFactor() {
    if (!factor.trim()) return;
    setBorr(b => Object.fromEntries(Object.entries(b).map(([id, x]) => [id, { ...x, fx: factor.trim() }])));
  }

  async function guardar() {
    const lecturas = cambiadas.map(f => {
      const b = borr[f.unidad.id]!;
      return { unidad_id: f.unidad.id, fecha_anterior: b.fa, lectura_anterior: b.la.trim(), fecha_actual: b.fc, lectura_actual: b.lc.trim(), factor: b.fx.trim() };
    });
    if (!lecturas.length) return; // el botón está apagado sin cambios
    setGuardando(true);
    try {
      let guardadas = 0;
      const falla: Record<string, string> = {};
      for (let i = 0; i < lecturas.length; i += TAM_LOTE) {
        const r = await api<ResultadoGuardado>(`/api/recibos/${reciboId}/agua`, { method: 'PUT', json: { lecturas: lecturas.slice(i, i + TAM_LOTE) } });
        guardadas += r.guardadas;
        for (const e of r.errores) falla[e.dpto] = e.mensaje;
      }
      if (guardadas) toast.ok(`${guardadas} ${guardadas === 1 ? 'lectura guardada' : 'lecturas guardadas'}`);
      if (Object.keys(falla).length) toast.error('Algunas lecturas no se guardaron: míralas marcadas en la tabla.');
      await reload();
      setErrores(falla);
      onCambio?.();
    } catch (e) { toast.error(errorText(e)); } finally { setGuardando(false); }
  }

  async function subir(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setSubiendo(true);
    setInforme(null);
    try {
      const fd = new FormData();
      if (factor.trim()) fd.append('factor', factor.trim());
      fd.append('archivo', f);
      const r = await api<ResultadoImportacion>(`/api/recibos/${reciboId}/agua/excel`, { method: 'POST', body: fd });
      setInforme(r);
      if (r.guardadas) toast.ok(`${r.guardadas} de ${r.filas} lecturas cargadas`);
      await reload();
      onCambio?.();
    } catch (x) { toast.error(errorText(x)); } finally { setSubiendo(false); }
  }

  async function quitarLectura() {
    if (!quitar) return;
    try {
      await api(`/api/recibos/${reciboId}/agua/${quitar.unidad.id}`, { method: 'DELETE' });
      toast.ok(`Lectura de ${quitar.unidad.codigo} quitada`);
      setQuitar(null);
      await reload();
      onCambio?.();
    } catch (x) { toast.error(errorText(x)); }
  }

  if (error) return <Card><ErrorState message={error} onRetry={reload} /></Card>;
  if (!data && loading) return <Card><div className="space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-40 w-full" /></div></Card>;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="p-5">
          <h3 className="mb-3 text-sm font-semibold">Datos del recibo impreso</h3>
          <DatosRecibo reciboId={reciboId} recibo={data.recibo} onCambio={() => { void reload(); onCambio?.(); }} />
        </div>
      </Card>

      <Card>
        <div className="space-y-4 p-5">
          <div>
            <h3 className="text-sm font-semibold">Lecturas de agua</h3>
            <p className="text-sm text-muted">La lectura anterior sale de la actual del mes previo. Escribe la actual de cada departamento, o sube el Excel con la plantilla. Si el agua que cobra el recibo no cuadra con la lectura, la fila lo avisa; no cambia ningún monto.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Input label="Factor (S/ por m³)" inputMode="decimal" className="w-36" placeholder="Ej. 4.93" value={factor} onChange={e => setFactor(e.target.value)} />
            <Button variant="secondary" className="mb-6" disabled={!factor.trim()} onClick={aplicarFactor}>Aplicar a todas las filas</Button>
            <div className="mb-6 ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" icon={<ArrowDownTrayIcon className="h-4 w-4" />} onClick={() => window.location.assign(`/api/recibos/${reciboId}/agua/plantilla`)}>Descargar plantilla</Button>
              <Button variant="secondary" icon={<ArrowUpTrayIcon className="h-4 w-4" />} loading={subiendo} onClick={() => archivo.current?.click()}>Subir Excel o CSV</Button>
              <Button loading={guardando} disabled={cambiadas.length === 0} onClick={() => void guardar()}>Guardar lecturas{cambiadas.length > 0 ? ` (${cambiadas.length})` : ''}</Button>
            </div>
            <input ref={archivo} type="file" accept=".xlsx,.xls,.csv,text/csv" className="sr-only" tabIndex={-1} aria-label="Elegir el Excel o CSV de lecturas" onChange={e => void subir(e)} />
          </div>

          {informe && (
            <Alert tone={informe.errores.length ? 'warn' : 'ok'}>
              <p><strong>{informe.guardadas} de {informe.filas}</strong> lecturas cargadas.{informe.errores.length > 0 && ` ${informe.errores.length} filas no se cargaron:`}</p>
              {informe.errores.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {informe.errores.slice(0, 20).map((e, i) => <li key={i}>{e.fila ? `Fila ${e.fila} · ` : ''}{e.dpto}: {e.mensaje}</li>)}
                  {informe.errores.length > 20 && <li>… y {informe.errores.length - 20} más</li>}
                </ul>
              )}
            </Alert>
          )}

          {/* `relative`: el texto sr-only de las columnas es absoluto y, sin un ancestro posicionado, se escaparía del recorte y ensancharía la página. */}
          <div className="relative overflow-x-auto rounded border border-line">
            <table className="w-full min-w-[58rem] text-sm">
              <caption className="sr-only">Lecturas de agua por departamento</caption>
              <thead>
                <tr className="border-b border-line bg-surface2 text-left text-xs text-muted">
                  <th scope="col" className="px-3 py-2 font-medium">Dpto</th>
                  <th scope="col" className="px-1 py-2 font-medium"><span className="sr-only">Foto y quitar</span></th>
                  <th scope="col" className="px-2 py-2 font-medium">Fecha anterior</th>
                  <th scope="col" className="px-2 py-2 font-medium">Lectura anterior</th>
                  <th scope="col" className="px-2 py-2 font-medium">Fecha actual</th>
                  <th scope="col" className="px-2 py-2 font-medium">Lectura actual</th>
                  <th scope="col" className="px-2 py-2 font-medium">Factor</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">m³</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Lectura S/</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Recibo S/</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted">Este recibo no tiene departamentos.</td></tr>}
                {data.items.map(f => {
                  const b = borr[f.unidad.id];
                  if (!b) return null;
                  const sucia = distinta(b, inicial[f.unidad.id]!);
                  const c = cuentaAgua(b.la, b.lc, b.fx);
                  // Mientras se edita, la vista previa; ya guardada, lo que calculó el servidor.
                  const monto = sucia ? c?.monto ?? null : f.lectura?.monto ?? c?.monto ?? null;
                  const m3 = sucia ? c?.consumo_m3 ?? null : f.lectura?.consumo_m3 ?? c?.consumo_m3 ?? null;
                  const alerta = sucia ? (c ? avisoAgua(c.monto, f.agua_recibo) : null) : f.alerta;
                  const malo = errores[f.unidad.codigo];
                  const incoherente = b.lc.trim() !== '' && b.la.trim() !== '' && !c;
                  return (
                    <Fragment key={f.unidad.id}>
                      <tr className={sucia ? 'bg-brand/5' : undefined}>
                        <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-medium">{f.unidad.codigo}</th>
                        <td className="whitespace-nowrap px-1 py-1.5">
                          <IconButton label={f.lectura ? `Foto del contómetro de ${f.unidad.codigo}` : `Guarda la lectura de ${f.unidad.codigo} para subir su foto`} disabled={!f.lectura} className={f.lectura?.tiene_foto ? 'text-brand' : undefined} onClick={() => setFoto(f)}><CameraIcon className="h-4 w-4" /></IconButton>
                          <IconButton label={`Quitar la lectura de ${f.unidad.codigo}`} disabled={!f.lectura} onClick={() => setQuitar(f)}><TrashIcon className="h-4 w-4" /></IconButton>
                        </td>
                        <td className="min-w-[8.25rem] px-2 py-1.5"><input type="date" aria-label={`Fecha anterior de ${f.unidad.codigo}`} className={campo} value={b.fa} onChange={e => editar(f.unidad.id, { fa: e.target.value })} /></td>
                        <td className="px-2 py-1.5"><input inputMode="decimal" aria-label={`Lectura anterior de ${f.unidad.codigo}`} className={`${campo} num`} value={b.la} onChange={e => editar(f.unidad.id, { la: e.target.value })} /></td>
                        <td className="min-w-[8.25rem] px-2 py-1.5"><input type="date" aria-label={`Fecha actual de ${f.unidad.codigo}`} className={campo} value={b.fc} onChange={e => editar(f.unidad.id, { fc: e.target.value })} /></td>
                        <td className="px-2 py-1.5"><input inputMode="decimal" aria-label={`Lectura actual de ${f.unidad.codigo}`} aria-invalid={incoherente || undefined} className={`${campo} num`} value={b.lc} onChange={e => editar(f.unidad.id, { lc: e.target.value })} /></td>
                        <td className="w-24 px-2 py-1.5"><input inputMode="decimal" aria-label={`Factor de ${f.unidad.codigo}`} className={`${campo} num`} value={b.fx} onChange={e => editar(f.unidad.id, { fx: e.target.value })} /></td>
                        <td className="num whitespace-nowrap px-2 py-1.5 text-right">{m3 ?? '—'}</td>
                        <td className="num whitespace-nowrap px-2 py-1.5 text-right font-medium">{monto !== null ? soles(monto) : '—'}</td>
                        <td className="num whitespace-nowrap px-2 py-1.5 text-right text-muted">{f.agua_recibo !== null ? soles(f.agua_recibo) : '—'}</td>
                      </tr>
                      {(alerta || malo || incoherente) && (
                        <tr>
                          <td />
                          <td colSpan={9} className={`px-2 pb-2 text-xs ${malo || incoherente ? 'text-bad' : 'text-warn'}`}>
                            {malo ?? (incoherente ? 'La lectura actual no puede ser menor que la anterior, y ambas deben ser números.' : alerta)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      {foto && foto.lectura && (
        <FotoContometroModal reciboId={reciboId} unidadId={foto.unidad.id} codigo={foto.unidad.codigo} tieneFoto={foto.lectura.tiene_foto} onClose={() => setFoto(null)} onCambio={() => { void reload(); onCambio?.(); }} />
      )}
      <ConfirmDialog open={quitar !== null} onClose={() => setQuitar(null)} onConfirm={quitarLectura} danger title="Quitar lectura" message={quitar ? `Se quitará la lectura de ${quitar.unidad.codigo} (y su foto). El recibo del departamento saldrá sin el detalle del consumo de agua.` : ''} confirmLabel="Quitar lectura" />
    </div>
  );
}
