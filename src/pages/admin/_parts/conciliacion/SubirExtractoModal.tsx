import { useState } from 'react';
import { ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { Alert, Button, Modal, Select, dinero, fechaCorta, useToast } from '../../../../ui';
import { letraDeColumna, type Cuenta, type ResultadoSubida } from './tipos';

interface Props { cuenta: Cuenta; onClose: () => void; onDone: () => void }

type Eleccion = { fecha: string; descripcion: string; abono: string; cargo: string; operacion: string; fila_inicio: string };
const VACIA: Eleccion = { fecha: '', descripcion: '', abono: '', cargo: '', operacion: '', fila_inicio: '1' };

/**
 * Subir el extracto de la cuenta (.xlsx, .xls o .csv). Torre detecta sola el encabezado y las columnas; si no las reconoce, muestra las primeras filas y deja
 * elegir qué columna es cada dato (esa elección se guarda para la cuenta). Sólo entran los abonos; el archivo no se guarda.
 */
export function SubirExtractoModal({ cuenta, onClose, onDone }: Props) {
  const toast = useToast();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<string[][] | null>(null);
  const [eleccion, setEleccion] = useState<Eleccion>(VACIA);
  const [resultado, setResultado] = useState<ResultadoSubida | null>(null);

  const columnas = vista?.[0]?.map((_, i) => i) ?? [];
  const opciones = (vacia: string) => (
    <>
      <option value="">{vacia}</option>
      {columnas.map(i => <option key={i} value={i}>Columna {letraDeColumna(i)}{vista?.[0]?.[i] ? ` — ${vista[0][i]!.slice(0, 24)}` : ''}</option>)}
    </>
  );
  const mapeoCompleto = eleccion.fecha !== '' && eleccion.abono !== '';

  async function enviar(conColumnas: boolean) {
    if (!archivo) return;
    setCargando(true);
    setError(null);
    const fd = new FormData();
    fd.append('archivo', archivo);
    if (conColumnas) {
      const n = (v: string) => (v === '' ? null : Number(v));
      fd.append('columnas', JSON.stringify({ fecha: n(eleccion.fecha), descripcion: n(eleccion.descripcion), abono: n(eleccion.abono), cargo: n(eleccion.cargo), operacion: n(eleccion.operacion), fila_inicio: Math.max(0, Number(eleccion.fila_inicio) - 1) }));
    }
    try {
      const r = await api<ResultadoSubida>(`/api/conciliacion/cuentas/${cuenta.id}/extractos`, { method: 'POST', body: fd });
      if (r.requiere_mapeo) { setVista(r.vista ?? []); setError(conColumnas ? 'Con esas columnas no se encontró ningún abono: revisa la elección.' : null); }
      else { setResultado(r); setVista(null); toast.ok(`${r.extracto?.filas_nuevas ?? 0} abonos nuevos`); onDone(); }
    } catch (e) { setError(errorText(e)); }
    finally { setCargando(false); }
  }

  return (
    <Modal open onClose={onClose} title="Subir extracto del banco" description={`${cuenta.entidad ?? 'Cuenta'}${cuenta.ultimos4 ? ` ····${cuenta.ultimos4}` : ''} · ${cuenta.complejo.nombre}`} size="lg">
      {resultado?.extracto ? (
        <div className="space-y-4">
          <Alert tone="ok">
            <p className="font-medium">{resultado.extracto.filas_leidas} abonos en el extracto: {resultado.extracto.filas_nuevas} nuevos{resultado.extracto.filas_repetidas > 0 ? ` y ${resultado.extracto.filas_repetidas} que ya estaban (no se duplican)` : ''}.</p>
            <p className="mt-1 num">{dinero(resultado.extracto.total_abonos, cuenta.moneda)} nuevos · del {fechaCorta(resultado.extracto.fecha_desde)} al {fechaCorta(resultado.extracto.fecha_hasta)}</p>
          </Alert>
          {resultado.cruce && (
            <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3" aria-label="Resultado del cruce">
              <li className="rounded bg-surface2 p-3"><span className="num block text-xl font-semibold text-ok">{resultado.cruce.conciliados}</span>conciliados con un pago</li>
              <li className="rounded bg-surface2 p-3"><span className="num block text-xl font-semibold text-warn">{resultado.cruce.por_revisar}</span>por revisar (varios pagos posibles)</li>
              <li className="rounded bg-surface2 p-3"><span className="num block text-xl font-semibold text-bad">{resultado.cruce.sin_pago}</span>abonos sin voucher</li>
            </ul>
          )}
          {resultado.descartes && resultado.descartes.cargos > 0 && <p className="text-sm text-muted">{resultado.descartes.cargos} cargos (salidas de dinero) se dejaron fuera: sólo se concilian los abonos.</p>}
          <div className="flex justify-end"><Button onClick={onClose}>Listo</Button></div>
        </div>
      ) : (
        <form className="space-y-4" noValidate onSubmit={e => { e.preventDefault(); void enviar(vista != null); }}>
          <div>
            <label htmlFor="extracto-archivo" className="mb-1 block text-sm font-medium">Archivo del banco (.xlsx, .xls o .csv)</label>
            <input id="extracto-archivo" type="file" accept=".xlsx,.xls,.csv" onChange={e => { setArchivo(e.target.files?.[0] ?? null); setVista(null); setError(null); setEleccion(VACIA); }} className="block w-full text-sm text-muted file:mr-2 file:rounded file:border file:border-line file:bg-surface file:px-3 file:py-1 file:text-sm" />
            <p className="mt-1 text-xs text-muted">Descarga el extracto de tu banca por internet. Hasta 5 MB y 5 000 filas. Si subes un extracto que se solapa con otro, no se duplica nada. Torre guarda sólo los abonos, no el archivo.{cuenta.tiene_mapeo ? ' Esta cuenta ya tiene tus columnas guardadas.' : ''}</p>
          </div>

          {error && <Alert tone="bad">{error}</Alert>}

          {vista && (
            <section aria-label="Elegir las columnas" className="space-y-3">
              <Alert tone="info">No reconocí las columnas de este extracto. Elige cuál es cada dato; lo recordaré para esta cuenta.</Alert>
              <div className="max-w-full overflow-x-auto rounded border border-line">
                <table className="w-full text-xs">
                  <caption className="sr-only">Primeras filas del archivo</caption>
                  <thead><tr className="bg-surface2 text-left text-muted"><th scope="col" className="px-2 py-1 font-medium">Fila</th>{columnas.map(i => <th key={i} scope="col" className="px-2 py-1 font-medium">{letraDeColumna(i)}</th>)}</tr></thead>
                  <tbody>{vista.map((f, r) => <tr key={r} className="border-t border-line"><th scope="row" className="num px-2 py-1 text-left font-normal text-muted">{r + 1}</th>{f.map((c, i) => <td key={i} className="max-w-[14rem] truncate px-2 py-1">{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Fecha" value={eleccion.fecha} onChange={e => setEleccion({ ...eleccion, fecha: e.target.value })}>{opciones('Elige la columna')}</Select>
                <Select label="Abono o monto" hint="Si el banco trae un solo monto con signo, elige ése (los negativos se descartan)." value={eleccion.abono} onChange={e => setEleccion({ ...eleccion, abono: e.target.value })}>{opciones('Elige la columna')}</Select>
                <Select label="Descripción (opcional)" value={eleccion.descripcion} onChange={e => setEleccion({ ...eleccion, descripcion: e.target.value })}>{opciones('No viene')}</Select>
                <Select label="N.º de operación (opcional)" value={eleccion.operacion} onChange={e => setEleccion({ ...eleccion, operacion: e.target.value })}>{opciones('No viene')}</Select>
                <Select label="Cargo (opcional)" value={eleccion.cargo} onChange={e => setEleccion({ ...eleccion, cargo: e.target.value })}>{opciones('No viene')}</Select>
                <Select label="Primera fila de datos" value={eleccion.fila_inicio} onChange={e => setEleccion({ ...eleccion, fila_inicio: e.target.value })}>
                  {vista.map((_, r) => <option key={r} value={r + 1}>Fila {r + 1}</option>)}
                </Select>
              </div>
            </section>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose} disabled={cargando}>Cancelar</Button>
            <Button type="submit" icon={<ArrowUpTrayIcon className="h-4 w-4" />} loading={cargando} disabled={!archivo || (vista != null && !mapeoCompleto)}>{vista ? 'Importar con estas columnas' : 'Subir y conciliar'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
