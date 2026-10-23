import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { HOME, useAuth } from './AuthContext';
import type { Rol } from './AuthContext';
import { Skeleton } from '../ui';

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
