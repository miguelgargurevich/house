import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, setUnauthorizedHandler, tokenStore } from '../api';

export type Rol = 'superadmin' | 'admin' | 'propietario' | 'inquilino' | 'mantenimiento' | 'seguridad';

export interface Usuario {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  empresa_id?: number | null;
  complejo_id?: number | null;
  telefono?: string | null;
}

interface AuthState {
  user: Usuario | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<Usuario>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export const HOME: Record<Rol, string> = {
  superadmin: '/superadmin/dashboard',
  admin: '/admin/dashboard',
  propietario: '/propietario/inicio',
  inquilino: '/inquilino/inicio',
  mantenimiento: '/mantenimiento/inicio',
  seguridad: '/seguridad/inicio',
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Usuario | null>(null);
  const [loading, setLoading] = useState(() => !!tokenStore.get());

  const logout = useCallback(() => { tokenStore.clear(); setUser(null); }, []);

  const refresh = useCallback(async () => {
    try { setUser(await api<Usuario>('/api/auth/me')); } catch { logout(); }
  }, [logout]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (tokenStore.get()) void refresh().finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, [logout, refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: Usuario }>('/api/auth/login', { method: 'POST', json: { email, password } });
    tokenStore.set(r.token);
    setUser(r.user);
    return r.user;
  }, []);

  const value = useMemo(() => ({ user, loading, login, logout, refresh }), [user, loading, login, logout, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth fuera de AuthProvider');
  return c;
}
