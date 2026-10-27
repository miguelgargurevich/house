import { useState } from 'react';
import type { FormEvent } from 'react';
import { DocumentMagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { Alert, Badge, Button, ConfirmDialog, Input, Modal, useToast } from '../../../../ui';
import type { OcrVista } from './tipos';

interface Props {
  ocr: OcrVista;
  deshabilitado: boolean;
  onCambio: () => void;
}

const ESTADO = { ok: { tone: 'ok', label: 'En uso' }, pausado: { tone: 'neutral', label: 'En pausa' }, invalido: { tone: 'bad', label: 'No válido' } } as const;

/** «OCR de comprobantes»: la última red de la evaluación. Destino interno de una lista fija del servidor, o un https público con las mismas barreras que los gateways. */
export function OcrSeccion({ ocr, deshabilitado, onCambio }: Props) {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [modo, setModo] = useState<'interno' | 'publico'>('interno');
  const [url, setUrl] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string>();
  const [guardando, setGuardando] = useState(false);
  const [quitar, setQuitar] = useState(false);
  const [quitando, setQuitando] = useState(false);

  function abrir() {
    setModo(ocr.configurado ? ocr.modo : 'interno');
    setUrl(ocr.configurado && ocr.modo === 'publico' ? ocr.base_url ?? '' : '');
    setClave('');
    setError(undefined);
    setAbierto(true);
  }
  function cerrar() { setClave(''); setAbierto(false); }

  async function guardar(e?: FormEvent) {
    e?.preventDefault();
    setGuardando(true);
    setError(undefined);
    try {
      await api('/api/llavero/ocr', { method: 'PUT', json: { modo, ...(modo === 'publico' ? { base_url: url.trim() } : {}), ...(clave.trim() ? { clave: clave.trim() } : {}) } });
      toast.ok('OCR de comprobantes guardado');
      setClave('');
      onCambio();
      setAbierto(false);
    } catch (err) { setError(errorText(err)); } finally { setGuardando(false); }
  }

  async function pausar(habilitado: boolean) {
    try {
      await api('/api/llavero/ocr', { method: 'PATCH', json: { habilitado } });
      toast.ok(habilitado ? 'OCR reanudado' : 'OCR en pausa');
      onCambio();
    } catch (err) { toast.error(errorText(err)); }
  }

  async function quitarOcr() {
    setQuitando(true);
    try {
      await api('/api/llavero/ocr', { method: 'DELETE' });
      toast.ok('OCR quitado');
      setQuitar(false);
      onCambio();
    } catch (err) { toast.error(errorText(err)); } finally { setQuitando(false); }
  }

  const interno = ocr.destinos_internos[0];
  const estado = ocr.configurado ? ESTADO[ocr.estado] : null;

  return (
    <section aria-labelledby="llavero-ocr" className="border-t border-line px-5 py-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="flex min-w-0 gap-3">
          <DocumentMagnifyingGlassIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
          <div className="min-w-0">
            <h2 id="llavero-ocr" className="flex flex-wrap items-center gap-2 text-sm font-semibold">OCR de comprobantes {estado && <Badge tone={estado.tone}>{estado.label}</Badge>}</h2>
            <p className="mt-0.5 text-sm text-muted">Última red al evaluar un comprobante cuando la IA no responde. Nunca valida solo: sólo informa y alerta.</p>
            {ocr.configurado ? (
              <p className="mt-1 text-sm">
                {ocr.modo === 'interno' ? 'Servicio interno' : 'Servicio público'}: <span className="num font-medium">{ocr.url ?? 'sin destino válido'}</span>
                <span className="text-muted"> · {ocr.tiene_clave ? `clave que termina en ${ocr.ultimos4}` : 'sin clave'}</span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">Sin configurar: la evaluación no usa OCR.</p>
            )}
            {ocr.configurado && ocr.estado === 'invalido' && <div className="mt-2"><Alert tone="warn">El destino guardado ya no cumple las barreras (por ejemplo, su dominio salió de la lista permitida): el OCR NO se usa. Vuelve a guardarlo o permite el dominio.</Alert></div>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <Button variant={ocr.configurado ? 'secondary' : 'primary'} disabled={deshabilitado} onClick={abrir}>{ocr.configurado ? 'Cambiar' : 'Configurar OCR'}</Button>
          {ocr.configurado && <Button variant="secondary" disabled={deshabilitado} onClick={() => void pausar(!ocr.habilitado)}>{ocr.habilitado ? 'Pausar' : 'Reanudar'}</Button>}
          {ocr.configurado && <Button variant="ghost" disabled={deshabilitado} onClick={() => setQuitar(true)}>Quitar</Button>}
        </div>
      </div>

      <Modal
        open={abierto}
        onClose={cerrar}
        title="OCR de comprobantes"
        description="La clave se guarda cifrada y no se vuelve a mostrar."
        footer={<><Button variant="secondary" onClick={cerrar}>Cancelar</Button><Button loading={guardando} disabled={modo === 'publico' && !url.trim()} onClick={() => void guardar()}>Guardar</Button></>}
      >
        <form onSubmit={e => void guardar(e)} className="grid gap-4" noValidate>
          {error && <Alert tone="bad">{error}</Alert>}
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Dónde está el servicio</legend>
            <label className="flex min-h-10 cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="ocr-modo" className="mt-1" checked={modo === 'interno'} onChange={() => setModo('interno')} />
              <span><span className="font-medium">Interno</span> <span className="num text-muted">({interno ? `${interno.id}: ${interno.url}` : 'ninguno disponible'})</span><span className="block text-xs text-muted">Un contenedor de la red interna del servidor. Sólo se admiten los destinos de una lista fija del código.</span></span>
            </label>
            <label className="flex min-h-10 cursor-pointer items-start gap-2 text-sm">
              <input type="radio" name="ocr-modo" className="mt-1" checked={modo === 'publico'} onChange={() => setModo('publico')} />
              <span><span className="font-medium">Público (https)</span><span className="block text-xs text-muted">Con un dominio de «Dominios permitidos»; debe resolver a una dirección pública.</span></span>
            </label>
          </fieldset>
          {modo === 'publico' && <Input label="URL del servicio" autoComplete="off" spellCheck={false} value={url} onChange={e => setUrl(e.target.value)} placeholder="https://ocr.midominio.dev" />}
          <Input label="Clave de API (opcional)" type="password" autoComplete="off" spellCheck={false} value={clave} onChange={e => setClave(e.target.value)} hint={ocr.configurado && ocr.tiene_clave ? `Déjala vacía para conservar la que termina en ${ocr.ultimos4}.` : 'Va en la cabecera X-API-Key. Entre 8 y 400 caracteres, sin espacios.'} />
        </form>
      </Modal>

      <ConfirmDialog open={quitar} onClose={() => setQuitar(false)} onConfirm={quitarOcr} loading={quitando} danger title="Quitar el OCR" message="Se borrará la clave y la evaluación dejará de usar el OCR como última red. Podrás configurarlo de nuevo cuando quieras." confirmLabel="Quitar OCR" />
    </section>
  );
}
