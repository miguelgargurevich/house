// Las cuentas con las que se entra a la demo, una por rol. Los correos son FIJOS (el seed las crea siempre iguales); las contraseñas son aleatorias y nadie
// las conoce: a la demo se entra sólo por `POST /api/demo/entrar`. Correos `.example` y celulares 900…: nada real.
export const ROLES_DEMO = ['administradora', 'tesorero_block', 'presidente_central', 'propietario_al_dia', 'propietario_moroso', 'inquilino', 'seguridad', 'mantenimiento'] as const;
export type RolDemo = (typeof ROLES_DEMO)[number];

export const DOMINIO_DEMO = 'torredemo.example';

export interface CuentaDemo { email: string; nombre: string; /** Departamento (sólo vecinos), para el seed y las pruebas. */ unidad?: string }

export const CUENTAS_DEMO: Record<RolDemo, CuentaDemo> = {
  administradora: { email: `lucia.paredes@${DOMINIO_DEMO}`, nombre: 'Lucía Paredes Rojas' },
  tesorero_block: { email: `marco.vasquez@${DOMINIO_DEMO}`, nombre: 'Marco Vásquez Salazar', unidad: 'B01-202' },
  presidente_central: { email: `carmen.cardenas@${DOMINIO_DEMO}`, nombre: 'Carmen Cárdenas Ibáñez', unidad: 'B02-204' },
  propietario_al_dia: { email: `raul.quispe@${DOMINIO_DEMO}`, nombre: 'Raúl Quispe Torres', unidad: 'B01-102' },
  propietario_moroso: { email: `gladys.huaman@${DOMINIO_DEMO}`, nombre: 'Gladys Huamán Flores', unidad: 'B01-101' },
  inquilino: { email: `diego.ramos@${DOMINIO_DEMO}`, nombre: 'Diego Ramos Pacheco', unidad: 'B01-103' },
  seguridad: { email: `pedro.ccori@${DOMINIO_DEMO}`, nombre: 'Pedro Ccori Mamani' },
  mantenimiento: { email: `maria.valdivia@${DOMINIO_DEMO}`, nombre: 'María Valdivia Tello' },
};

export const esRolDemo = (r: unknown): r is RolDemo => typeof r === 'string' && (ROLES_DEMO as readonly string[]).includes(r);
