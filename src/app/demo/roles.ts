// La demo de Torre: los roles con los que se entra (tarjetas «Entrar como…» de `/demo`). Las claves son las del servidor (`POST /api/demo/entrar { rol }`,
// `src/server/services/demo/cuentas.ts`); una prueba vigila que las dos listas coincidan. Los textos dicen en una línea qué se va a ver.
export const ROLES_DEMO = ['administradora', 'tesorero_block', 'presidente_central', 'propietario_al_dia', 'propietario_moroso', 'inquilino', 'seguridad', 'mantenimiento'] as const;
export type RolDemo = (typeof ROLES_DEMO)[number];

export const esRolDemo = (r: unknown): r is RolDemo => typeof r === 'string' && (ROLES_DEMO as readonly string[]).includes(r);

export interface RolInfo {
  clave: RolDemo;
  /** Cómo se llama el rol en el botón y en la guía. */
  titulo: string;
}

export interface TarjetaDemo {
  id: string;
  titulo: string;
  /** Qué va a ver quien entra: una línea. */
  ve: string;
  /** Una sola persona; la última tarjeta junta dos (seguridad y mantenimiento) y ofrece un botón por cada una. */
  roles: readonly RolInfo[];
}

export const TARJETAS_DEMO: readonly TarjetaDemo[] = [
  { id: 'administradora', titulo: 'Administradora', ve: 'Los dos condominios: la morosidad, los pagos por validar con su voucher, los recibos por block y los cierres.', roles: [{ clave: 'administradora', titulo: 'Administradora' }] },
  { id: 'tesorero', titulo: 'Tesorero de un block', ve: 'La junta del Block 1: los vouchers de sus vecinos por confirmar y el cierre del mes de su block.', roles: [{ clave: 'tesorero_block', titulo: 'Tesorero de un block' }] },
  { id: 'presidente', titulo: 'Presidente de la junta central', ve: 'La Junta central del condominio: los aportes de los blocks y su cierre del mes.', roles: [{ clave: 'presidente_central', titulo: 'Presidente de la junta central' }] },
  { id: 'al-dia', titulo: 'Propietario al día', ve: 'Su recibo del mes por pagar, sin deudas atrasadas, y cómo subir su voucher.', roles: [{ clave: 'propietario_al_dia', titulo: 'Propietario al día' }] },
  { id: 'moroso', titulo: 'Propietario moroso', ve: 'Tres meses vencidos con su recargo, y cómo ponerse al día con un voucher.', roles: [{ clave: 'propietario_moroso', titulo: 'Propietario moroso' }] },
  { id: 'inquilino', titulo: 'Inquilino', ve: 'El recibo del departamento que alquila y cómo pagarlo desde el celular.', roles: [{ clave: 'inquilino', titulo: 'Inquilino' }] },
  { id: 'personal', titulo: 'Seguridad y mantenimiento', ve: 'El personal del condominio: las unidades para la garita, o las tareas asignadas.', roles: [{ clave: 'seguridad', titulo: 'Seguridad' }, { clave: 'mantenimiento', titulo: 'Mantenimiento' }] },
];

export const TITULO_DE_ROL: Record<RolDemo, string> = Object.fromEntries(TARJETAS_DEMO.flatMap((t) => t.roles.map((r) => [r.clave, r.titulo]))) as Record<RolDemo, string>;

/**
 * El rol de demo de quien tiene la sesión abierta. Se guarda al entrar (`sessionStorage`); si falta (otra pestaña, otra visita), se deduce de la cuenta:
 * administración, junta (por su cargo) o vecino. Entre un vecino al día y uno moroso no se puede distinguir desde aquí: se supone al día.
 */
export function rolDeDemoDe(user: { rol: string; cargo_junta?: string | null; estructura_id?: number | null }, guardado?: string | null): RolDemo | null {
  if (esRolDemo(guardado)) {
    const coincide = guardado === 'administradora' ? user.rol === 'admin'
      : guardado === 'tesorero_block' || guardado === 'presidente_central' ? user.rol === 'propietario' && !!user.cargo_junta
      : guardado === 'propietario_al_dia' || guardado === 'propietario_moroso' ? user.rol === 'propietario'
      : user.rol === guardado;
    if (coincide) return guardado;
  }
  if (user.rol === 'admin') return 'administradora';
  if (user.rol === 'propietario') return user.cargo_junta ? (user.estructura_id == null ? 'presidente_central' : 'tesorero_block') : 'propietario_al_dia';
  if (user.rol === 'inquilino' || user.rol === 'seguridad' || user.rol === 'mantenimiento') return user.rol;
  return null;
}
