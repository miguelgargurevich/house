import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Button, Modal, Skeleton, useToast } from '../../../../ui';
import { Interruptor } from '../catalogo/Interruptor';
import { textoDepartamentos, textoEnviado, type PlanRecordatorio } from './tipos';

interface Props {
  /** Los departamentos marcados en Morosidad (`null` cierra el modal). */
  unidades: { id: number; codigo: string }[] | null;
  onClose: () => void;
  onEnviado: () => void;
}

/**
 * «Enviar recordatorio» a los morosos marcados: eliges los canales, ves exactamente a cuántos les llegará (sin encolar nada), el texto y lo que queda
 * de la cuota de WhatsApp, y recién al «Enviar» se encola. Va SÓLO al responsable de pago de cada departamento y a lo más una vez por día.
 */
export function RecordatorioDeudaModal({ unidades, onClose, onEnviado }: Props) {
  const toast = useToast();
  const [correo, setCorreo] = useState(true);
  const [whatsapp, setWhatsapp] = useState(false);
  const [plan, setPlan] = useState<PlanRecordatorio | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const ids = unidades?.map(u => u.id) ?? [];
  const clave = `${ids.join(',')}|${correo}|${whatsapp}`;
  const canales = [...(correo ? ['email'] : []), ...(whatsapp ? ['whatsapp'] : [])];

  // Al abrir y cada vez que cambian los canales: la vista previa (no encola nada).
  useEffect(() => {
    if (!unidades?.length || canales.length === 0) { setPlan(null); setError(null); return; }
    let vigente = true;
    setCargando(true); setError(null);
    api<PlanRecordatorio>('/api/recordatorios/deuda', { method: 'POST', json: { unidades: ids, canales, confirmar: false } })
      .then(p => { if (vigente) setPlan(p); })
      .catch(e => { if (vigente) { setPlan(null); setError(errorText(e)); } })
      .finally(() => { if (vigente) setCargando(false); });
    return () => { vigente = false; };
    // `clave` resume ids y canales.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  async function enviar() {
    setEnviando(true);
    try {
      const r = await api<PlanRecordatorio>('/api/recordatorios/deuda', { method: 'POST', json: { unidades: ids, canales, confirmar: true } });
      toast.ok(textoEnviado(r));
      onEnviado();
      onClose();
    } catch (e) { toast.error(errorText(e)); } finally { setEnviando(false); }
  }

  const sinWhatsapp = plan?.whatsapp.filter(w => !w.disponible) ?? [];
  const excede = plan?.whatsapp.filter(w => w.disponible && !w.alcanza) ?? [];

  return (
    <Modal
      open={unidades !== null}
      onClose={onClose}
      size="lg"
      title="Enviar recordatorio de deuda"
      description={`A ${textoDepartamentos(ids.length)} marcados. Le llega sólo al responsable de pago de cada uno, con lo que debe hoy.`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={enviando} disabled={cargando || !plan || plan.por_avisar === 0} onClick={() => void enviar()}>{plan && plan.por_avisar > 0 ? `Enviar a ${textoDepartamentos(plan.por_avisar)}` : 'Enviar'}</Button></>}
    >
      <div className="grid gap-4">
        <fieldset className="grid gap-1">
          <legend className="mb-1 text-sm font-medium">Por dónde</legend>
          <Interruptor label="Correo" hint="Con diseño, al correo del responsable si tiene los avisos por correo activados." checked={correo} onChange={e => setCorreo(e.target.checked)} />
          <Interruptor label="WhatsApp" hint="Un mensaje a cada responsable, de a poco y con pausas. Gasta la cuota mensual de WhatsApp del condominio." checked={whatsapp} onChange={e => setWhatsapp(e.target.checked)} />
        </fieldset>

        {canales.length === 0 && <Alert tone="warn">Elige al menos un canal.</Alert>}
        {error && <Alert tone="bad">{error}</Alert>}
        {cargando && !plan && <Skeleton className="h-32 w-full" />}

        {plan && (
          <section aria-label="Vista previa" className={cargando ? 'grid gap-4 opacity-60' : 'grid gap-4'} aria-busy={cargando}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded border border-line p-3 text-sm sm:grid-cols-3">
              <Dato etiqueta="Recibirán el recordatorio" valor={plan.por_avisar} destacado />
              <Dato etiqueta="Por correo" valor={plan.por_correo} />
              <Dato etiqueta="Por WhatsApp" valor={plan.por_whatsapp} />
              <Dato etiqueta="Responsables de pago" valor={plan.responsables} />
              <Dato etiqueta="Sin canal activo" valor={plan.sin_canal} pista="Sin correo ni celular, o con los avisos apagados" />
              <Dato etiqueta="Ya recibieron uno hoy" valor={plan.ya_recordadas_hoy} pista="A cada departamento se le recuerda una vez al día" />
              {plan.sin_deuda > 0 && <Dato etiqueta="Sin deuda vencida" valor={plan.sin_deuda} pista="No reciben nada" />}
            </dl>

            {plan.whatsapp.map(w => (
              <div key={w.complejo_id} className="rounded border border-line p-3 text-sm">
                <p className="font-medium">WhatsApp · {w.nombre}</p>
                {w.disponible ? (
                  <p className="text-muted">
                    {w.tope == null ? 'Sin tope mensual.' : `Quedan ${w.restantes} de ${w.tope} mensajes este mes.`} Este envío usa {w.por_enviar}.
                    {w.hoy.tope != null && ` Hoy el número lleva ${w.hoy.enviados} de ${w.hoy.tope}; pasado el tope, el resto sale mañana a las 8:00.`}
                  </p>
                ) : <p className="text-warn">{w.motivo_no_disponible}. Este recordatorio no saldrá por WhatsApp.</p>}
              </div>
            ))}
            {excede.length > 0 && <Alert tone="warn">La cuota de WhatsApp de {excede.map(w => w.nombre).join(', ')} no alcanza para todos: los que no entren quedarán omitidos. Puedes enviar sólo por correo.</Alert>}
            {sinWhatsapp.length > 0 && plan.por_whatsapp === 0 && whatsapp && !correo && <Alert tone="warn">Ninguno saldrá: WhatsApp no está disponible para estos condominios.</Alert>}
            {plan.por_avisar === 0 && <Alert tone="info">{plan.ya_recordadas_hoy > 0 && plan.ya_recordadas_hoy === plan.unidades - plan.sin_deuda ? 'A todos los marcados ya se les recordó hoy.' : 'Nadie recibiría nada con esta selección.'}</Alert>}

            {plan.ejemplo && (
              <div>
                <p className="mb-1 text-sm font-medium">Así lo recibe cada responsable</p>
                <div className="rounded border border-line bg-surface2 p-3 text-sm">
                  <p className="break-words font-medium">{plan.ejemplo.asunto}</p>
                  <p className="mt-2 whitespace-pre-line break-words text-muted">{plan.ejemplo.cuerpo}</p>
                </div>
                <p className="mt-1 text-xs text-muted">Cada uno ve su nombre y lo que debe su departamento. Por WhatsApp se agrega al final cómo dejar de recibir avisos.</p>
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}

function Dato({ etiqueta, valor, pista, destacado }: { etiqueta: string; valor: number; pista?: string; destacado?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{etiqueta}</dt>
      <dd className={destacado ? 'num text-lg font-semibold' : 'num font-medium'}>{valor}</dd>
      {pista && <dd className="text-xs text-muted">{pista}</dd>}
    </div>
  );
}
