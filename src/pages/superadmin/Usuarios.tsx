import { useState } from 'react';
import { Tabs } from '../../ui';
import PersonasLista from '../admin/_parts/personas/PersonasLista';
import type { TipoPersona } from '../admin/_parts/personas/PersonasLista';

const TABS: { id: TipoPersona; label: string }[] = [
  { id: 'residente', label: 'Residentes' },
  { id: 'personal', label: 'Personal' },
  { id: 'superadmin', label: 'Superadmin' },
];

/** Todas las personas de la plataforma, separadas por tipo (no se mezclan residentes, personal y superadmins). */
export default function Usuarios() {
  const [tipo, setTipo] = useState<TipoPersona>('residente');
  return (
    <PersonasLista
      key={tipo}
      tipo={tipo}
      titulo="Usuarios globales"
      descripcion="Residentes de los condominios, personal de las empresas y cuentas de superadministrador."
      encima={<div className="mb-4 max-w-full overflow-x-auto"><Tabs value={tipo} onChange={setTipo} items={TABS} /></div>}
    />
  );
}
