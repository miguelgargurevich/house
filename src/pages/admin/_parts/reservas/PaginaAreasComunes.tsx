import { useState } from 'react';
import { useCondominio } from '../../../../app/condominio';
import { useList } from '../../../../api';
import { PageHeader, Select, TabPanel, Tabs } from '../../../../ui';
import type { AreaComun } from '../../../shared/_parts/reservas/tipos';
import { AreasTab } from './AreasTab';
import { ReservasTab } from './ReservasTab';

type Pestana = 'reservas' | 'areas';

/**
 * Áreas comunes y sus reservas, en una sola página con dos pestañas. Con varios condominios se elige uno aquí mismo (esta pantalla no usa el
 * selector de la barra superior); con uno solo no hay nada que elegir.
 */
export function PaginaAreasComunes() {
  const { condominios } = useCondominio();
  const [pestana, setPestana] = useState<Pestana>('reservas');
  const [elegido, setElegido] = useState('');
  const complejo = elegido || (condominios.length === 1 ? String(condominios[0]!.id) : '');
  const areas = useList<AreaComun>('/api/areas-comunes', { pageSize: 100, params: { complejo_id: complejo || undefined } });

  return (
    <>
      <PageHeader title="Áreas comunes" description="Define qué áreas pueden reservar tus vecinos (salón, parrilla, piscina…) y atiende sus reservas." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {condominios.length > 1 && (
          <Select label="Condominio" value={elegido} onChange={e => setElegido(e.target.value)}>
            <option value="">Todos los condominios</option>
            {condominios.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </Select>
        )}
      </div>
      <div className="mb-4">
        <Tabs<Pestana>
          value={pestana}
          onChange={setPestana}
          idBase="areas-comunes-pestanas"
          label="Reservas y áreas"
          items={[{ id: 'reservas', label: 'Reservas' }, { id: 'areas', label: 'Áreas' }]}
        />
      </div>
      <TabPanel idBase="areas-comunes-pestanas" id="reservas" value={pestana}><ReservasTab complejo={complejo} areas={areas.items} /></TabPanel>
      <TabPanel idBase="areas-comunes-pestanas" id="areas" value={pestana}><AreasTab condominios={condominios} complejo={complejo} /></TabPanel>
    </>
  );
}
