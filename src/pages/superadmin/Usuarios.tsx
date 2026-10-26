import PersonasLista from '../admin/_parts/personas/PersonasLista';

/**
 * Usuarios globales = las cuentas DEL SISTEMA (superadministradores de la plataforma).
 * Los residentes, el personal de las empresas y los proveedores viven en sus propias
 * pantallas (Personas › Residentes / Personal / Proveedores): aquí no se cargan.
 */
export default function Usuarios() {
  return (
    <PersonasLista
      tipo="superadmin"
      titulo="Usuarios del sistema"
      descripcion="Cuentas con acceso a toda la plataforma."
    />
  );
}
