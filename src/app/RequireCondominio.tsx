import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Skeleton } from '../ui';
import { useCondominio } from './condominio';

/** Ruta del paso 2 del registro: la bienvenida de la administradora que todavía no creó su condominio. */
export const RUTA_BIENVENIDA = '/admin/bienvenida';

/**
 * Guarda de las pantallas de la administración: una administradora (`admin`) SIN condominios no tiene nada que ver ahí todavía, así que cualquier
 * pantalla la manda a la bienvenida (paso 2 del registro) hasta que cree el primero. Mientras llega la lista de condominios no se pinta la pantalla
 * (así no parpadea el Resumen vacío antes de redirigir). El superadmin y los demás roles pasan sin cambios; si la lista falla, también (la pantalla muestra su error).
 */
export function RequireCondominio() {
  const { user } = useAuth();
  const { sinCondominios, listo, error } = useCondominio();
  if (user?.rol !== 'admin') return <Outlet />;
  if (sinCondominios) return <Navigate to={RUTA_BIENVENIDA} replace />;
  if (!listo && !error) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 w-full" /></div>;
  return <Outlet />;
}
