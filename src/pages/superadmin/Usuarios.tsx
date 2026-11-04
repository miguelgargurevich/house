import { useState } from 'react';
import { PageHeader, Tabs } from '../../ui';
import PersonasLista from '../admin/_parts/personas/PersonasLista';
import { EntrarComo } from './_parts/EntrarComo';

type Vista = 'sistema' | 'entrar';

/**
 * Usuarios globales = las cuentas DEL SISTEMA (superadministradores de la plataforma).
 * Los residentes, el personal de las empresas y los proveedores viven en sus propias
 * pantallas (Personas › Residentes / Personal / Proveedores): aquí no se cargan.
 * La pestaña «Entrar como» sí busca a cualquiera: es la herramienta de soporte (ver Torre como esa persona).
 */
export default function Usuarios() {
  const [vista, setVista] = useState<Vista>('sistema');
  const pestanas = (
    <div className="mb-4"><Tabs<Vista> value={vista} onChange={setVista} label="Vista" items={[{ id: 'sistema', label: 'Superadministradores' }, { id: 'entrar', label: 'Entrar como' }]} /></div>
  );
  if (vista === 'entrar') {
    return (
      <>
        <PageHeader title="Usuarios del sistema" description="Busca a una persona y entra como ella para darle soporte. Queda en la auditoría con tu nombre y el motivo." />
        {pestanas}
        <EntrarComo />
      </>
    );
  }
  return (
    <PersonasLista
      tipo="superadmin"
      titulo="Usuarios del sistema"
      descripcion="Cuentas con acceso a toda la plataforma."
      encima={pestanas}
    />
  );
}
