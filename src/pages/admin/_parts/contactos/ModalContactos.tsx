import { useState } from 'react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { errorText } from '../../../../api';
import { Alert, Badge, Button, Modal, useToast } from '../../../../ui';
import { subirContactos, urlPlantilla } from './cliente';
import { etiquetaPersona, hayQueGuardar, lineasDeResumen, type Guardado, type VistaPrevia } from './vista';

interface Props {
  complejoId: number;
  complejoNombre?: string;
  onClose: () => void;
  /** Tras guardar: la lista de residentes y el estado de las invitaciones se vuelven a leer. */
  onGuardado: () => void;
}

const enlaceBoton = 'inline-flex h-10 items-center justify-center gap-2 rounded border border-line bg-surface px-4 text-sm font-medium text-ink transition-colors duration-150 hover:bg-surface2';

/**
 * «Subir contactos»: plantilla → archivo → resumen y problemas por fila (el servidor no guardó nada) → «Guardar contactos». Pensado para 390 px:
 * una sola columna, los problemas como tarjetas (sin tabla que se corte de lado).
 */
export function ModalContactos({ complejoId, complejoNombre, onClose, onGuardado }: Props) {
  const toast = useToast();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [actualizar, setActualizar] = useState(false);
  const [invitar, setInvitar] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaPrevia | null>(null);
  const [guardado, setGuardado] = useState<Guardado | null>(null);

  const elegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    setArchivo(e.target.files?.[0] ?? null);
    setVista(null);
    setError(null);
  };

  async function enviar(confirmar: boolean) {
    if (!archivo) return;
    setCargando(true);
    setError(null);
    try {
      const r = await subirContactos({ complejoId, archivo, confirmar, actualizar, invitar });
      if (r.tipo === 'vista') setVista(r.vista);
      else {
        setGuardado(r.guardado);
        setVista(null);
        toast.ok('Contactos guardados');
        onGuardado();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setCargando(false);
    }
  }

  const r = vista?.resumen;
  const lineas = r ? lineasDeResumen(r) : [];
  const puedeGuardar = !!r && hayQueGuardar(r, invitar);

  const pie = guardado ? (
    <Button onClick={onClose}>Cerrar</Button>
  ) : vista ? (
    <>
      <Button variant="secondary" onClick={() => setVista(null)} disabled={cargando}>Volver</Button>
      <Button onClick={() => void enviar(true)} loading={cargando} disabled={!puedeGuardar}>Guardar contactos</Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={onClose} disabled={cargando}>Cancelar</Button>
      <Button onClick={() => void enviar(false)} loading={cargando} disabled={!archivo}>Revisar archivo</Button>
    </>
  );

  return (
    <Modal open onClose={onClose} title="Subir contactos de los vecinos" description={complejoNombre} size="lg" footer={pie}>
      <div className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}

        {guardado ? (
          <div className="space-y-3" aria-live="polite">
            <Alert tone="ok">
              <p className="font-medium">Contactos guardados</p>
              <p className="mt-1">
                {guardado.creados} {guardado.creados === 1 ? 'persona creada' : 'personas creadas'}, {guardado.actualizados} {guardado.actualizados === 1 ? 'actualizada' : 'actualizadas'}.
                {guardado.invitaciones_encoladas > 0 && ` ${guardado.invitaciones_encoladas} ${guardado.invitaciones_encoladas === 1 ? 'invitación quedó' : 'invitaciones quedaron'} en cola: salen en tandas diarias, no todas de golpe.`}
              </p>
            </Alert>
            {guardado.problemas_total > 0 && <Alert tone="warn">{guardado.problemas_total} {guardado.problemas_total === 1 ? 'fila no se guardó' : 'filas no se guardaron'} por los problemas que viste en la revisión. Corrige el Excel y vuelve a subirlo: lo ya guardado no se duplica.</Alert>}
          </div>
        ) : vista && r ? (
          <div className="space-y-4" aria-live="polite">
            <Alert tone={r.filas_con_error ? 'warn' : 'info'}>{vista.error}</Alert>
            {lineas.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="Lo que se va a guardar">
                {lineas.map((l) => <li key={l}>{l}</li>)}
              </ul>
            )}
            <p className="text-sm text-muted">
              {r.filas} {r.filas === 1 ? 'fila leída' : 'filas leídas'}
              {r.filas_con_error > 0 && ` · ${r.filas_con_error} con error`}
              {r.filas_con_aviso > 0 && ` · ${r.filas_con_aviso} con aviso`}
              {invitar && ` · ${r.invitables} ${r.invitables === 1 ? 'invitación se dejará' : 'invitaciones se dejarán'} en cola`}
            </p>
            {vista.problemas.length > 0 && (
              <section aria-label="Problemas por fila">
                <h3 className="mb-2 text-sm font-semibold">Revisa estas filas ({vista.problemas_total})</h3>
                <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {vista.problemas.map((p, i) => (
                    <li key={i} className="rounded border border-line bg-surface2 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">Fila {p.fila}</span>
                        {p.unidad && <span className="text-muted">{p.unidad}</span>}
                        {p.persona && <span className="text-muted">{etiquetaPersona(p.persona)}</span>}
                        <Badge tone={p.nivel === 'error' ? 'bad' : 'warn'}>{p.nivel === 'error' ? 'Error: no se guarda' : 'Aviso'}</Badge>
                      </div>
                      <p className="mt-1 break-words">{p.mensaje}</p>
                    </li>
                  ))}
                </ul>
                {vista.problemas_total > vista.problemas.length && <p className="mt-2 text-xs text-muted">Se muestran las primeras {vista.problemas.length}. Corrige estas y vuelve a revisar para ver las demás.</p>}
              </section>
            )}
            {!puedeGuardar && <Alert tone="info">No hay cambios que guardar con este archivo.</Alert>}
          </div>
        ) : (
          <>
            <Alert tone="info">
              Descarga la plantilla (ya trae a cada vecino y lo que Torre tiene de él), llénala con los correos y celulares y súbela. Primero verás un resumen: no se guarda nada hasta que pulses «Guardar contactos».
            </Alert>
            <div>
              <a href={urlPlantilla(complejoId)} className={enlaceBoton} download>
                <ArrowDownTrayIcon className="h-4 w-4" aria-hidden="true" />Descargar plantilla de contactos
              </a>
            </div>
            <div>
              <label htmlFor="archivo-contactos" className="mb-1 block text-sm font-medium">Archivo Excel (.xlsx)</label>
              <input id="archivo-contactos" type="file" accept=".xlsx,.xls" onChange={elegir} className="block w-full text-sm text-muted file:mr-2 file:rounded file:border file:border-line file:bg-surface file:px-3 file:py-1 file:text-sm" />
              {archivo && <p className="mt-1 text-xs text-muted">{archivo.name} · {Math.round(archivo.size / 1024)} KB</p>}
            </div>
            <div className="space-y-3">
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[oklch(var(--brand))]" checked={actualizar} onChange={(e) => { setActualizar(e.target.checked); setVista(null); }} />
                <span>Actualizar los datos ya cargados<span className="block text-muted">Si un vecino ya tiene un correo o un celular real, se reemplaza por el del Excel. Sin esto, se respeta lo que ya está.</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[oklch(var(--brand))]" checked={invitar} onChange={(e) => setInvitar(e.target.checked)} />
                <span>Enviar invitación a los que tienen correo<span className="block text-muted">No salen todas de golpe: quedan en cola y se mandan en tandas diarias. Nunca a quien ya tiene contraseña.</span></span>
              </label>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
