import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, csrfStore, setUnauthorizedHandler } from '../api';

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
  const [loading, setLoading] = useState(true); // al arrancar se pregunta al servidor si hay sesión (cookie httpOnly)

  // Olvida la sesión sólo en este navegador (el servidor ya la cerró o no existe).
  const olvidar = useCallback(() => { csrfStore.set(null); setUser(null); }, []);

  const logout = useCallback(() => {
    if (csrfStore.has()) void api('/api/auth/logout', { method: 'POST', json: {} }).catch(() => undefined);
    olvidar();
  }, [olvidar]);

  const refresh = useCallback(async () => {
    try {
      const { csrf, ...u } = await api<Usuario & { csrf: string }>('/api/auth/me');
      csrfStore.set(csrf);
      setUser(u);
    } catch { olvidar(); }
  }, [olvidar]);

  useEffect(() => {
    setUnauthorizedHandler(olvidar);
    void refresh().finally(() => setLoading(false));
    return () => setUnauthorizedHandler(null);
  }, [olvidar, refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ user: Usuario; csrf: string }>('/api/auth/login', { method: 'POST', json: { email, password } });
    csrfStore.set(r.csrf);
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
