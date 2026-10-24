// Rutas reales de la app por rol (las mismas de `src/App.tsx` y `src/app/nav.ts`). El asistente sólo recibe la ruta actual del
// usuario si está en esta lista: una ruta inventada o de otro rol no entra al prompt. Una prueba compara la lista con `App.tsx`.
import type { Rol } from '../config';
import type { AuthUser } from '../middleware/auth';
import { esJunta } from './junta';

const OPERACION = [
  '/admin/dashboard', '/admin/complejos', '/admin/unidades', '/admin/recibos', '/admin/recibos/:id', '/admin/pagos', '/admin/morosidad',
  '/admin/mantenimientos', '/admin/conceptos', '/admin/residentes', '/admin/personal', '/admin/proveedores', '/admin/configuracion', '/admin/avisos', '/admin/medios-pago',
] as const;

export const RUTAS_POR_ROL: Record<Rol, readonly string[]> = {
  superadmin: ['/superadmin/dashboard', '/superadmin/empresas', '/superadmin/usuarios', '/superadmin/auditoria', '/superadmin/llavero', ...OPERACION],
  admin: OPERACION,
  propietario: ['/propietario/inicio', '/propietario/unidades', '/propietario/cargos', '/propietario/pagos'],
  inquilino: ['/inquilino/inicio', '/inquilino/cargos', '/inquilino/pagos'],
  mantenimiento: ['/mantenimiento/inicio', '/mantenimiento/tareas'],
  seguridad: ['/seguridad/inicio', '/seguridad/unidades'],
  limpieza: ['/limpieza/inicio', '/limpieza/tareas'],
  jardineria: ['/jardineria/inicio', '/jardineria/tareas'],
};
export const RUTAS_JUNTA = ['/junta/medios-pago', '/junta/pagos'] as const;
export const RUTAS_COMUNES = ['/perfil'] as const;

/** Todas las rutas que el asistente puede conocer (para la prueba contra `App.tsx`). */
export const TODAS_LAS_RUTAS: readonly string[] = [...new Set([...Object.values(RUTAS_POR_ROL).flat(), ...RUTAS_JUNTA, ...RUTAS_COMUNES])];

/** Ruta actual validada: la ruta normalizada si el rol del usuario puede estar ahí; si no, `null`. */
export function rutaPermitida(user: Pick<AuthUser, 'rol' | 'cargo_junta' | 'complejo_id' | 'estructura_id' | 'id' | 'email' | 'empresa_id'>, ruta: string | undefined): string | null {
  if (!ruta) return null;
  const limpia = ruta.split(/[?#]/)[0]!.replace(/\/+$/, '').replace(/^(\/admin\/recibos)\/\d+$/, '$1/:id'); // el periodo de un recibo lleva su id
  if (!limpia) return null;
  const validas: readonly string[] = [...RUTAS_POR_ROL[user.rol], ...RUTAS_COMUNES, ...(esJunta(user) ? RUTAS_JUNTA : [])];
  return validas.includes(limpia) ? limpia : null;
}
