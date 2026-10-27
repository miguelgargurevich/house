import { useState } from 'react';
import { CreditCardIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../api';
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, fechaCorta, soles, useToast } from '../../ui';
import { ComoPagar } from './_parts/plan/ComoPagar';
import { HistorialPagos } from './_parts/plan/HistorialPagos';
import { ModalSolicitud } from './_parts/plan/ModalSolicitud';
import { ESTADO_UI, MODULO_NOMBRE, nombreDePlan, type DatosPago, type ModuloClave, type VistaSuscripcion } from '../shared/_parts/comercial';

interface Respuesta {
  condominios: VistaSuscripcion[];
  pagar: DatosPago;
  catalogo: { planes: { clave: string; nombre: string; precio_por_unidad: string }[]; modulos: { clave: string; nombre: string; descripcion: string | null; precio_por_unidad: string }[] };
}

function aviso(c: VistaSuscripcion): { tone: 'warn' | 'bad'; texto: string } | null {
  if (c.estado === 'por_vencer') return { tone: 'warn', texto: `Tu plan vence ${c.dias_para_vencer === 0 ? 'hoy' : `en ${c.dias_para_vencer} ${c.dias_para_vencer === 1 ? 'día' : 'días'}`}. Renueva para no perder los módulos.` };
  if (c.estado === 'vencida') return c.en_gracia
    ? { tone: 'warn', texto: 'Tu plan venció y estás en días de gracia: los módulos siguen activos por ahora.' }
    : { tone: 'bad', texto: 'Tu plan venció y los módulos están apagados. Tus datos siguen intactos y todo lo gratis sigue funcionando; paga para reactivarlos.' };
  return null;
}

function Condominio({ c, pagar, onSolicitar, onCambio }: { c: VistaSuscripcion; pagar: DatosPago; onSolicitar: () => void; onCambio: () => void }) {
  const toast = useToast();
  const [pagos, setPagos] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const est = ESTADO_UI[c.estado];
  const a = aviso(c);
  const cobro = c.solicitud ? c.solicitud.cotizacion : c.cotizacion;
  const hayQuePagar = Number(cobro.total_mes) > 0 && (c.solicitud != null || c.estado === 'por_vencer' || c.estado === 'vencida');
  const esCortesia = c.plan.clave === 'cortesia';

  async function cancelar() {
    setCancelando(true);
    try { await api(`/api/comercial/mi-plan/${c.complejo_id}/solicitud`, { method: 'DELETE' }); toast.ok('Solicitud cancelada'); onCambio(); } catch (e) { toast.error(errorText(e)); } finally { setCancelando(false); }
  }

  return (
    <Card>
      <CardHeader
        title={c.complejo}
        description={`${c.unidades_facturables} ${c.unidades_facturables === 1 ? 'departamento facturable' : 'departamentos facturables'}`}
        action={<Badge tone={est.tone}>{est.label}</Badge>}
      />
      <CardBody className="space-y-4">
        {a && <Alert tone={a.tone}>{a.texto}</Alert>}
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <div><dt className="text-xs text-muted">Plan</dt><dd className="text-sm font-medium">{c.plan.nombre}</dd></div>
          <div><dt className="text-xs text-muted">Vigente hasta</dt><dd className="num text-sm font-medium">{esCortesia ? 'Sin vencimiento' : c.vigente_hasta ? fechaCorta(c.vigente_hasta) : '—'}</dd></div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted">Módulos activos</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {c.modulos_activos.length ? c.modulos_activos.map(m => <Badge key={m} tone="brand">{MODULO_NOMBRE[m as ModuloClave] ?? m}</Badge>) : <span className="text-sm text-muted">Ninguno: tienes todo lo gratis.</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Total al mes</dt>
            <dd className="text-sm"><span className="num text-lg font-semibold">{soles(c.cotizacion.total_mes)}</span>{Number(c.cotizacion.total_mes) > 0 && <span className="num block text-xs text-muted">{soles(c.cotizacion.base)} + IGV {soles(c.cotizacion.igv)}</span>}</dd>
          </div>
        </dl>

        {c.solicitud && (
          <Alert tone="info">
            Pediste {[c.solicitud.plan ? `el plan ${nombreDePlan(c.solicitud.plan)}` : null, c.solicitud.modulos.length ? c.solicitud.modulos.map(m => MODULO_NOMBRE[m as ModuloClave] ?? m).join(', ') : null].filter(Boolean).join(' + ')}. Se activa cuando registremos tu pago.
          </Alert>
        )}
        {hayQuePagar && <ComoPagar cot={cobro} referencia={c.referencia_pago} pagar={pagar} />}

        <div className="flex flex-wrap items-center gap-2">
          {!esCortesia && <Button onClick={onSolicitar}>{c.plan.clave === 'gratis' ? 'Solicitar módulo / Pasar a Pro' : 'Solicitar otro módulo o plan'}</Button>}
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
      <PageHeader title="Mi plan" description="Lo gratis es para siempre. Activa módulos sólo en los condominios que los necesiten; los precios incluyen IGV." />
      {loading && <div className="space-y-4"><Skeleton className="h-56 w-full" /><Skeleton className="h-56 w-full" /></div>}
      {error && <ErrorState message={error} onRetry={reload} />}
      {data && !data.condominios.length && <EmptyState icon={<CreditCardIcon />} title="Aún no tienes condominios" description="Cuando crees tu primer condominio verás aquí su plan." />}
      {data && (
        <div className="space-y-6">
          {data.condominios.map(c => (
            <Condominio key={c.complejo_id} c={c} pagar={data.pagar} onSolicitar={() => setSolicitando(c)} onCambio={reload} />
          ))}
          <ModalSolicitud condominio={solicitando} catalogo={data.catalogo} onClose={() => setSolicitando(null)} onHecho={() => { setSolicitando(null); reload(); }} />
        </div>
      )}
    </>
  );
}
