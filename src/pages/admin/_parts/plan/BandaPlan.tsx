import { Link } from 'react-router-dom';
import { useResource } from '../../../../api';
import { useCondominio } from '../../../../app/condominio';
import { Alert } from '../../../../ui';
import { diasDePrueba } from './diasDePrueba';
import { mensajeVouchers, type UsoMes } from './usoDelMes';

/** Lo que el Resumen necesita del plan de cada condominio (la vista completa está en Mi plan). */
interface Vista { complejo_id: number; complejo: string; en_prueba: boolean; dias_para_vencer: number | null; plan: { clave: string }; uso: UsoMes }

/**
 * Resumen del admin, del condominio elegido (o de todos): si está en prueba de Pro, lo dice con los días que le quedan; y lo que dicen sus
 * vouchers del mes (en Gratis, lo que se validó a mano). Con el enlace a Mi plan.
 */
export function BandaPlan() {
  const { data } = useResource<{ condominios: Vista[] }>('/api/comercial/mi-plan');
  const { elegido } = useCondominio();
  const condominios = (data?.condominios ?? []).filter(c => elegido == null || c.complejo_id === elegido);
  const avisos = condominios.flatMap(c => {
    const salida: { id: string; texto: string }[] = [];
    if (c.en_prueba) salida.push({ id: `${c.complejo_id}-prueba`, texto: `Prueba de Pro${condominios.length > 1 ? ` de ${c.complejo}` : ''} · ${diasDePrueba(c.dias_para_vencer)}. Después sigues en Gratis, sin perder datos.` });
    const vouchers = c.uso ? mensajeVouchers(c.uso, c.plan.clave, c.en_prueba) : null;
    if (vouchers) salida.push({ id: `${c.complejo_id}-vouchers`, texto: condominios.length > 1 ? `${c.complejo}: ${vouchers}` : vouchers });
    return salida;
  });
  if (!avisos.length) return null;
  return (
    <div className="space-y-2">
      {avisos.map(a => (
        <Alert key={a.id} tone="info">
          {a.texto}{' '}
          <Link to="/admin/mi-plan" className="font-medium text-brand hover:underline">Ver Mi plan</Link>
        </Alert>
      ))}
    </div>
  );
}
