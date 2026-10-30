import { useState } from 'react';
import { PaperClipIcon } from '@heroicons/react/24/outline';
import { useCondominio } from '../../../../app/condominio';
import { api, errorText, useResource, type Page } from '../../../../api';
import { Alert, Button, Card, Modal, useToast } from '../../../../ui';
import type { Complejo } from './comun';
import { resumenSubida, type ResultadoExcel } from './resumenExcel';

interface FilaComplejo extends Complejo { id: number; nombre: string }

export function SubirExcelModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [abierto, setAbierto] = useState(true);
  const [archivo, setArchivo] = useState<File | null>(null);
  // Por defecto, el condominio elegido arriba; con «Todos los condominios» se pide elegirlo (un Excel es de UN condominio).
  const { complejo } = useCondominio();
  const [complejoId, setComplejoId] = useState(complejo);
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoExcel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const complejos = useResource<Page<FilaComplejo>>('/api/complejos?pageSize=100');
  const resumen = resultado && resumenSubida(resultado);

  const manejarArchivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setArchivo(f);
    setError(null);
    setResultado(null);
  };

  const subir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archivo || !complejoId) return;
    setCargando(true);
    setError(null);
    setResultado(null);
    const fd = new FormData();
    fd.append('archivo', archivo);
    fd.append('complejo_id', complejoId);
    try {
      const r = await api<ResultadoExcel>('/api/recibos/excel', { method: 'POST', body: fd });
      setResultado(r);
      toast.ok((r.recibos?.length ?? 1) > 1 ? `${r.recibos!.length} recibos cargados: ${r.unidades_procesadas} departamentos` : `Recibo creado: ${r.unidades_procesadas} departamentos`);
      void onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCargando(false);
    }
  };

  return (
    <Modal open={abierto} onClose={() => { setAbierto(false); onClose(); }} title="Subir Excel de recibos">
      <form onSubmit={subir} className="grid gap-4 sm:grid-cols-2" noValidate>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium mb-1">Condominio</label>
          <select className="w-full border border-line rounded px-3 py-2 text-sm bg-surface focus:outline-none focus:border-brand" value={complejoId} onChange={e => setComplejoId(e.target.value)}>
            <option value="">Elige un condominio</option>
            {(complejos.data?.items ?? []).map((c: FilaComplejo) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
          {!complejoId && <p className="text-xs text-muted mt-1">Elige el condominio al que pertenece el Excel. Cada torre del archivo (columna BLOCK) crea o reemplaza SU recibo; las torres que no vengan en el archivo no se tocan.</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium mb-1">Archivo Excel (.xlsx)</label>
          <input type="file" accept=".xlsx,.xls" onChange={manejarArchivo} className="block w-full text-sm text-muted file:mr-2 file:py-1 file:px-3 file:rounded file:border file:border-line file:text-sm" />
          {archivo && <p className="text-xs text-muted mt-1">{archivo.name} · {Math.round(archivo.size / 1024)} KB</p>}
        </div>
        {error && <Alert tone="bad">{error}</Alert>}
        {resumen && resumen.torres.length > 0 && (
          <ul className="sm:col-span-2 list-disc space-y-0.5 pl-5 text-sm" aria-label="Recibos por torre">
            {resumen.torres.map(t => <li key={t}>{t}</li>)}
          </ul>
        )}
        {resumen?.mora && <div className="sm:col-span-2"><Alert tone="info">{resumen.mora}</Alert></div>}
        {resumen && resumen.advertencias.length > 0 && (
          <div className="sm:col-span-2">
            <Alert tone="warn">
              <p className="font-medium">{resumen.titulo} · {resumen.linea}</p>
              <p className="mt-2">Revisa estas filas ({resumen.advertencias.length}):</p>
              <ul className="mt-1 max-h-48 overflow-y-auto list-disc pl-5 space-y-1">
                {resumen.advertencias.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </Alert>
          </div>
        )}
        {resumen && resumen.advertencias.length === 0 && (
          <Card className="sm:col-span-2 bg-ok/5 border-ok/20 p-3 rounded border">
            <p className="text-sm text-ink"><strong>{resumen.titulo}</strong></p>
            <p className="text-sm text-ink">{resumen.linea}</p>
          </Card>
        )}
        <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => { setAbierto(false); onClose(); }} disabled={cargando}>Cancelar</Button>
          <Button type="submit" loading={cargando} disabled={!archivo || !complejoId}>
            <PaperClipIcon className="h-4 w-4 mr-2" /> Subir Excel y crear recibos
          </Button>
        </div>
      </form>
    </Modal>
  );
}
