import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader, TabPanel, Tabs } from '../../../../ui';
import { EnviosTab } from '../avisos/EnviosTab';
import { ComunicadosTab } from './ComunicadosTab';
import { baseDe } from './tipos';

export type PestanaComunicados = 'comunicados' | 'envios';

const SEGMENTO: Record<PestanaComunicados, string> = { comunicados: 'comunicados', envios: 'avisos' };

/**
 * Comunicados y sus envíos, en una sola página con dos pestañas. Cada pestaña tiene su ruta (`/…/comunicados` y `/…/avisos`), así que los
 * enlaces viejos siguen sirviendo, recargar y «atrás» funcionan, y el menú marca la sección. Cambiar de pestaña reemplaza la entrada del historial.
 */
export function PaginaComunicados({ pestana }: { pestana: PestanaComunicados }) {
  const navigate = useNavigate();
  const base = baseDe(useLocation().pathname);
  const cambiar = (p: PestanaComunicados) => navigate(`${base}/${SEGMENTO[p]}`, { replace: true });

  return (
    <>
      <PageHeader title="Comunicados" description="Escribe anuncios para los vecinos y revisa qué se les envió por correo y WhatsApp." />
      <div className="mb-4">
        <Tabs<PestanaComunicados>
          value={pestana}
          onChange={cambiar}
          idBase="comunicados-pestanas"
          label="Comunicados y envíos"
          items={[{ id: 'comunicados', label: 'Comunicados' }, { id: 'envios', label: 'Envíos' }]}
        />
      </div>
      <TabPanel idBase="comunicados-pestanas" id="comunicados" value={pestana}><ComunicadosTab /></TabPanel>
      <TabPanel idBase="comunicados-pestanas" id="envios" value={pestana}><EnviosTab /></TabPanel>
    </>
  );
}
