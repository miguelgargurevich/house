import { useState } from 'react';
import { CreditCardIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../api';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, dinero, fechaCorta, useToast } from '../../ui';
import { ComoPagar } from './_parts/plan/ComoPagar';
import { HistorialPagos } from './_parts/plan/HistorialPagos';
import { ModalSolicitud } from './_parts/plan/ModalSolicitud';
import { ESTADO_UI, MODULO_NOMBRE, nombreDePlan, type DatosPago, type ModuloClave, type VistaSuscripcion } from '../shared/_parts/comercial';
import { diasDePrueba } from './_parts/plan/diasDePrueba';

/** La vista del servidor: la de siempre más si el condominio está en prueba de Pro. */
type Vista = VistaSuscripcion & { en_prueba: boolean };

interface Respuesta {
  condominios: Vista[];
  pagar: DatosPago;
  /** Gratis incluye un condominio: con uno ya en Gratis, `motivo` dice por qué no se agrega otro. */
  puede_agregar_condominio: { puede: boolean; motivo: string | null };
}

function aviso(c: Vista): { tone: 'warn' | 'bad'; texto: string } | null {
  // La prueba de Pro tiene su propia banda: no se avisa de «vence» ni de «venció».
  if (c.en_prueba) return null;
  if (c.estado === 'por_vencer') return { tone: 'warn', texto: `Tu plan vence ${c.dias_para_vencer === 0 ? 'hoy' : `en ${c.dias_para_vencer} ${c.dias_para_vencer === 1 ? 'día' : 'días'}`}. Renueva para no perder lo de Pro.` };
  if (c.estado === 'vencida') return c.en_gracia
    ? { tone: 'warn', texto: 'Tu plan venció y estás en días de gracia: lo de Pro sigue activo por ahora.' }
    : { tone: 'bad', texto: 'Tu plan venció y lo de Pro está apagado. Tus datos siguen intactos y todo lo gratis sigue funcionando; paga para reactivarlo.' };
  return null;
}

function Condominio({ c, pagar, onSolicitar, onCambio }: { c: Vista; pagar: DatosPago; onSolicitar: () => void; onCambio: () => void }) {
  const toast = useToast();
  const [pagos, setPagos] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const est = c.en_prueba ? { label: 'Prueba de Pro', tone: 'brand' as const } : ESTADO_UI[c.estado];
  const a = aviso(c);
  const cobro = c.solicitud ? c.solicitud.cotizacion : c.cotizacion;
  const consultar = c.solicitud ? c.solicitud.consultar : c.precio_consultar;
  const conImpuesto = Number(c.impuesto.tasa) > 0;
  const hayQuePagar = !consultar && Number(cobro.total_mes) > 0 && (c.solicitud != null || c.estado === 'por_vencer' || c.estado === 'vencida');
  const esCortesia = c.plan.clave === 'cortesia';

  async function cancelar() {
    setCancelando(true);
    try { await api(`/api/comercial/mi-plan/${c.complejo_id}/solicitud`, { method: 'DELETE' }); toast.ok('Solicitud cancelada'); onCambio(); } catch (e) { toast.error(errorText(e)); } finally { setCancelando(false); }
  }

  return (
    <Card>
      <CardHeader
        title={c.complejo}
        description={c.unidades_maximas != null ? `${c.unidades_facturables} de ${c.unidades_maximas} departamentos` : `${c.unidades_facturables} ${c.unidades_facturables === 1 ? 'departamento' : 'departamentos'}`}
        action={<Badge tone={est.tone}>{est.label}</Badge>}
      />
      <CardBody className="space-y-4">
        {c.en_prueba && <Alert tone="info">Prueba de Pro · {diasDePrueba(c.dias_para_vencer)}. Después sigues en Gratis, sin perder datos. Para seguir con la IA de vouchers, WhatsApp y reportes, pasa a Pro.</Alert>}
        {a && <Alert tone={a.tone}>{a.texto}</Alert>}
        {c.unidades_maximas != null && c.unidades_facturables >= c.unidades_maximas && (
          <Alert tone="warn">
            {c.unidades_facturables > c.unidades_maximas ? `Tienes ${c.unidades_facturables} departamentos y ${c.plan.nombre} llega hasta ${c.unidades_maximas}: no podrás agregar más, pero no se oculta ni se borra ninguno.` : `Llegaste al tope de ${c.unidades_maximas} departamentos de ${c.plan.nombre}.`} Pasa a Pro para seguir creciendo.
          </Alert>
        )}
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div><dt className="text-xs text-muted">Plan</dt><dd className="text-sm font-medium">{c.plan.nombre}</dd></div>
          <div><dt className="text-xs text-muted">Vigente hasta</dt><dd className="num text-sm font-medium">{esCortesia ? 'Sin vencimiento' : c.vigente_hasta ? fechaCorta(c.vigente_hasta) : '—'}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted">Lo que tienes activo de Pro</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {c.modulos_activos.length ? c.modulos_activos.map(m => <Badge key={m} tone="brand">{MODULO_NOMBRE[m as ModuloClave] ?? m}</Badge>) : <span className="text-sm text-muted">Nada de Pro: tienes todo lo gratis (IA, WhatsApp, asistente, mora automática y reportes son de Pro).</span>}
            </dd>
            {c.modulos_sueltos.length > 0 && c.plan.clave !== 'cortesia' && <dd className="mt-1.5 text-xs text-muted">Los módulos sueltos que ya tenías ({c.modulos_sueltos.map(m => MODULO_NOMBRE[m as ModuloClave] ?? m).join(', ')}) se respetan hasta que cambies de plan: ya no se venden por separado.</dd>}
          </div>
          <div>
            <dt className="text-xs text-muted">Total al mes</dt>
            <dd className="text-sm">
              {c.precio_consultar
                ? <><span className="text-lg font-semibold">Consúltanos</span><span className="block text-xs text-muted">Tu plan todavía no tiene precio en la moneda de tu país.</span></>
                : <><span className="num text-lg font-semibold">{dinero(c.cotizacion.total_mes, c.moneda)}</span>{Number(c.cotizacion.total_mes) > 0 && conImpuesto && <span className="num block text-xs text-muted">{dinero(c.cotizacion.base, c.moneda)} + {c.impuesto.nombre} {dinero(c.cotizacion.igv, c.moneda)}</span>}</>}{c.cotizacion.minimo_aplicado && <span className="block text-xs text-muted">Se cobra el mínimo de {c.cotizacion.unidades_cobradas} departamentos por condominio ({c.plan.nombre}).</span>}</dd>
          </div>
        </dl>

        {c.solicitud && (
          <Alert tone="info">
            Pediste el plan {nombreDePlan(c.solicitud.plan ?? '')}{c.solicitud.cotizacion.minimo_aplicado ? ` (mínimo de ${c.solicitud.cotizacion.unidades_cobradas} departamentos)` : ''}. Se activa cuando registremos tu pago.
          </Alert>
        )}
        {hayQuePagar && <ComoPagar cot={cobro} referencia={c.referencia_pago} pagar={pagar} />}

        <div className="flex flex-wrap items-center gap-2">
          {!esCortesia && <Button onClick={onSolicitar}>{c.plan.clave === 'gratis' ? 'Pasar a Pro' : 'Cambiar de plan'}</Button>}
          {c.solicitud && <Button variant="secondary" loading={cancelando} onClick={() => void cancelar()}>Cancelar solicitud</Button>}
          <Button variant="ghost" onClick={() => setPagos(v => !v)} aria-expanded={pagos}>{pagos ? 'Ocultar pagos' : 'Ver pagos'}</Button>
        </div>
        {pagos && <HistorialPagos complejoId={c.complejo_id} />}
      </CardBody>
    </Card>
  );
}

/** Mi plan: por condominio, el plan, los módulos activos, el monto al mes con su desglose, la vigencia y cómo pagar. */
export default function MiPlan() {
  const { data, loading, error, reload } = useResource<Respuesta>('/api/comercial/mi-plan');
  const [solicitando, setSolicitando] = useState<VistaSuscripcion | null>(null);

  return (
    <>
      <PageHeader title="Mi plan" description="Gratis con límite de departamentos, o Pro con todo. El plan se elige por condominio; los precios del plan no incluyen el impuesto de tu país (IGV, IVA…); el monto a pagar ya lo suma, en la moneda de tu condominio." />
      {loading && <div className="space-y-4"><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></div>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && !data.condominios.length && <EmptyState icon={<CreditCardIcon />} title="Aún no tienes condominios" description="Cuando crees tu primer condominio verás aquí su plan." />}
      {data && (
        <div className="space-y-6">
          {!data.puede_agregar_condominio.puede && data.puede_agregar_condominio.motivo && <Alert tone="info">{data.puede_agregar_condominio.motivo}</Alert>}
          {data.condominios.map(c => (
            <Condominio key={c.complejo_id} c={c} pagar={data.pagar} onSolicitar={() => setSolicitando(c)} onCambio={reload} />
          ))}
          <ModalSolicitud condominio={solicitando} onClose={() => setSolicitando(null)} onHecho={() => { setSolicitando(null); reload(); }} />
        </div>
      )}
    </>
  );
}
