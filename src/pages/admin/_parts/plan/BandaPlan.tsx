import { Link } from 'react-router-dom';
import { useResource } from '../../../../api';
import { useCondominio } from '../../../../app/condominio';
import { Alert } from '../../../../ui';
import { diasDePrueba } from './diasDePrueba';

/** Lo que el Resumen necesita del plan de cada condominio (la vista completa está en Mi plan). */
interface Vista { complejo_id: number; complejo: string; en_prueba: boolean; dias_para_vencer: number | null }

/** Resumen del admin: si un condominio (el elegido, o todos) está en prueba de Pro, lo dice con el enlace a Mi plan. */
export function BandaPlan() {
  const { data } = useResource<{ condominios: Vista[] }>('/api/comercial/mi-plan');
  const { elegido } = useCondominio();
  const pruebas = (data?.condominios ?? []).filter(c => c.en_prueba && (elegido == null || c.complejo_id === elegido));
  if (!pruebas.length) return null;
  return (
    <div className="space-y-2">
      {pruebas.map(c => (
        <Alert key={c.complejo_id} tone="info">
          Prueba de Pro{pruebas.length > 1 ? ` de ${c.complejo}` : ''} · {diasDePrueba(c.dias_para_vencer)}. Después sigues en Gratis, sin perder datos.{' '}
          <Link to="/admin/mi-plan" className="font-medium text-brand hover:underline">Ver Mi plan</Link>
        </Alert>
      ))}
    </div>
  );
}
