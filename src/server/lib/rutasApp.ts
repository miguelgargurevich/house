// Rutas reales de la app por rol (las mismas de `src/App.tsx` y `src/app/nav.ts`). El asistente sólo recibe la ruta actual del
// usuario si está en esta lista: una ruta inventada o de otro rol no entra al prompt. Una prueba compara la lista con `App.tsx`.
import type { Rol } from '../config';
import type { AuthUser } from '../middleware/auth';
import { esJunta } from './junta';

const OPERACION = [
  '/admin/dashboard', '/admin/complejos', '/admin/condominios/:id', '/admin/unidades', '/admin/recibos', '/admin/recibos/:id', '/admin/pagos', '/admin/morosidad',
  '/admin/mantenimientos', '/admin/conceptos', '/admin/residentes', '/admin/personal', '/admin/proveedores', '/admin/configuracion', '/admin/avisos', '/admin/comunicados', '/admin/juntas', '/admin/medios-pago', '/admin/whatsapp',
] as const;

export const RUTAS_POR_ROL: Record<Rol, readonly string[]> = {
  superadmin: ['/superadmin/dashboard', '/superadmin/empresas', '/superadmin/empresas/:id', '/superadmin/usuarios', '/superadmin/auditoria', '/superadmin/llavero', '/superadmin/integraciones', '/superadmin/suscripciones', ...OPERACION],
  admin: [...OPERACION, '/admin/mi-plan'],
  propietario: ['/propietario/inicio', '/propietario/unidades', '/propietario/cargos', '/propietario/pagos', '/propietario/junta', '/propietario/comunicados'],
  inquilino: ['/inquilino/inicio', '/inquilino/cargos', '/inquilino/pagos', '/inquilino/junta', '/inquilino/comunicados'],
  mantenimiento: ['/mantenimiento/inicio', '/mantenimiento/tareas'],
  seguridad: ['/seguridad/inicio', '/seguridad/unidades'],
  limpieza: ['/limpieza/inicio', '/limpieza/tareas'],
  jardineria: ['/jardineria/inicio', '/jardineria/tareas'],
};
export const RUTAS_JUNTA = ['/junta/mi-junta', '/junta/medios-pago', '/junta/pagos', '/junta/agua', '/junta/comunicados', '/junta/proveedores', '/junta/avisos'] as const;
export const RUTAS_COMUNES = ['/perfil'] as const;

/** Todas las rutas que el asistente puede conocer (para la prueba contra `App.tsx`). */
export const TODAS_LAS_RUTAS: readonly string[] = [...new Set([...Object.values(RUTAS_POR_ROL).flat(), ...RUTAS_JUNTA, ...RUTAS_COMUNES])];

/** Ruta actual validada: la ruta normalizada si el rol del usuario puede estar ahí; si no, `null`. */
export function rutaPermitida(user: Pick<AuthUser, 'rol' | 'cargo_junta' | 'complejo_id' | 'estructura_id' | 'id' | 'email' | 'empresa_id'>, ruta: string | undefined): string | null {
  if (!ruta) return null;
  const limpia = ruta.split(/[?#]/)[0]!.replace(/\/+$/, '')
    .replace(/^\/(admin\/recibos|admin\/condominios|superadmin\/empresas)\/\d+$/, '/$1/:id'); // el periodo de un recibo y las fichas llevan su id
  if (!limpia) return null;
  const validas: readonly string[] = [...RUTAS_POR_ROL[user.rol], ...RUTAS_COMUNES, ...(esJunta(user) ? RUTAS_JUNTA : [])];
  return validas.includes(limpia) ? limpia : null;
}

// ---------- Dónde se ve cada cosa en el menú actual ----------
// «Personas» ya no existe en el menú: los residentes están en la ficha del condominio, el personal en la ficha de la empresa y los
// proveedores en Operación. Las herramientas del asistente (y su prompt) nombran las pantallas con estos textos; una prueba exige que
// el enlace sea una ruta real.
export type Seccion = 'residentes' | 'personal' | 'proveedores';

const DONDE_VER: Record<Seccion, Partial<Record<Rol, { texto: string; ruta: string }>>> = {
  residentes: {
    admin: { texto: 'Condominios › abre el condominio › pestaña Residentes', ruta: '/admin/complejos' },
    superadmin: { texto: 'Condominios › abre el condominio › pestaña Residentes', ruta: '/admin/complejos' },
  },
  personal: {
    admin: { texto: 'Mi empresa › pestaña Personal', ruta: '/admin/configuracion' },
    superadmin: { texto: 'Empresas › abre la empresa › pestaña Personal', ruta: '/superadmin/empresas' },
  },
  proveedores: {
    admin: { texto: 'Operación › Proveedores', ruta: '/admin/proveedores' },
    superadmin: { texto: 'Operación › Proveedores', ruta: '/admin/proveedores' },
  },
};

/** «Condominios › abre el condominio › pestaña Residentes ([Condominios](/admin/complejos))», o `null` si ese rol no tiene esa pantalla (junta y residentes). */
export function dondeVer(rol: Rol, seccion: Seccion): string | null {
  const d = DONDE_VER[seccion][rol];
  return d ? `${d.texto} (${d.ruta})` : null;
}

/** Rutas que `dondeVer` puede citar (para la prueba contra `App.tsx`). */
export const RUTAS_DONDE_VER: readonly string[] = [...new Set(Object.values(DONDE_VER).flatMap((p) => Object.values(p).map((d) => d.ruta)))];
