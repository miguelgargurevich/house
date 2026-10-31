import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { HOME, useAuth } from './AuthContext';
import { esJunta } from './junta';
import type { Rol } from './AuthContext';
import { EmptyState, Skeleton } from '../ui';

export function RequireAuth() {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="p-8"><Skeleton className="h-8 w-56" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

export function RequireRole({ roles }: { roles: Rol[] }) {
  const { user } = useAuth();
  if (!user) return null;
  if (!roles.includes(user.rol)) return <Navigate to={HOME[user.rol]} replace />;
  return <Outlet />;
}

/** Pantallas de la Junta central de los blocks: en junta única no existen, así que si alguien entra a mano se le avisa (no es un error). */
const SOLO_JUNTA_CENTRAL = ['/junta/aportes', '/junta/cierre-central'];

/** Como `RequireRole`, pero para la junta: propietarios con cargo de presidente o tesorero (mira `cargo_junta`, no sólo el rol). */
export function RequireJunta() {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return null;
  if (!esJunta(user)) return <Navigate to={HOME[user.rol]} replace />;
  if (user.junta_unica && SOLO_JUNTA_CENTRAL.includes(loc.pathname)) return <AvisoJuntaUnica />;
  return <Outlet />;
}

/** Su condominio tiene una sola junta directiva: no hay aportes de blocks ni una Junta central aparte, así que la pantalla no aplica. */
function AvisoJuntaUnica() {
  return (
    <EmptyState
      title="Esta pantalla no aplica a tu condominio"
      description="Tu condominio tiene una sola junta directiva: no hay aportes de blocks ni una Junta central aparte. El cierre del mes está en el menú."
      action={<Link to="/junta/cierre" className="text-sm font-medium text-brand hover:underline">Ir al cierre del mes</Link>}
    />
  );
}
