// Decisiones de la página /demo que no son pintura (sin React: se prueban con `node:test`).
import { esRolDemo, type RolDemo } from '../../../app/demo/roles';

/** A dónde va cada rol al entrar: la pantalla donde empieza su recorrido de «Qué probar». */
export const ENTRADA_DEMO: Record<RolDemo, string> = {
  administradora: '/admin/dashboard',
  tesorero_block: '/junta/pagos',
  presidente_central: '/junta/aportes',
  propietario_al_dia: '/propietario/inicio',
  propietario_moroso: '/propietario/inicio',
  inquilino: '/inquilino/inicio',
  seguridad: '/seguridad/inicio',
  mantenimiento: '/mantenimiento/inicio',
};

export type VistaDemo = 'cargando' | 'tarjetas' | 'sin_demo';

/** Qué muestra la página: las tarjetas (en una demo), el enlace a la demo (en cualquier otra instancia) o nada mientras se pregunta. */
export function vistaDeDemo(a: { puedeSerDemo: boolean; cargando: boolean; demo: boolean }): VistaDemo {
  if (!a.puedeSerDemo) return 'sin_demo';
  if (a.cargando) return 'cargando';
  return a.demo ? 'tarjetas' : 'sin_demo';
}

/** La entrada que devolvió el servidor: sólo si es un rol de demo conocido. */
export const entradaDe = (rol: unknown): string | null => (esRolDemo(rol) ? ENTRADA_DEMO[rol] : null);
