import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useResource } from '../api';
import { useAuth } from '../auth/AuthContext';
import { CondominioCtx, elegidoValido, guardar, leerGuardado, rutaUsaCondominio } from './condominio';
import type { CondominioOpcion, Estado } from './condominio';

/** Va dentro de la sesión (`key` = el usuario): al cambiar de usuario se vuelve a leer lo suyo. */
export function CondominioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const activo = user?.rol === 'admin' || user?.rol === 'superadmin';
  const usuarioId = user?.id ?? 0;
  const lista = useResource<{ items: CondominioOpcion[] }>(activo ? '/api/complejos/selector' : null);
  // Se parte de lo guardado: así la primera consulta de cada pantalla ya sale con el condominio y no hay un parpadeo con «Todos».
  const [pedido, setPedido] = useState<number | null>(() => (activo ? leerGuardado(usuarioId) ?? null : null));
  const condominios = useMemo(() => lista.data?.items ?? [], [lista.data]);
  const cargado = lista.data !== null;
  const elegido = cargado ? elegidoValido(pedido, condominios) : pedido;

  // Si lo guardado ya no vale, se corrige también lo guardado.
  useEffect(() => { if (cargado && elegido !== pedido) { setPedido(elegido); guardar(usuarioId, elegido); } }, [cargado, elegido, pedido, usuarioId]);

  const elegir = useCallback((id: number | null) => { setPedido(id); guardar(usuarioId, id); }, [usuarioId]);
  const aplica = activo && rutaUsaCondominio(pathname);

  const valor = useMemo<Estado>(() => ({
    activo,
    aplica,
    condominios,
    cargando: activo && lista.loading,
    error: lista.error,
    elegido,
    condominio: condominios.find(c => c.id === elegido) ?? null,
    complejo: aplica && elegido !== null ? String(elegido) : '',
    varios: condominios.length > 1,
    elegir,
    recargar: lista.reload,
  }), [activo, aplica, condominios, lista.loading, lista.error, lista.reload, elegido, elegir]);

  return <CondominioCtx.Provider value={valor}>{children}</CondominioCtx.Provider>;
}

