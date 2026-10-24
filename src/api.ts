import { useEffect, useRef, useState, useCallback } from 'react';

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

/** Token CSRF de la sesión: sólo en memoria (lo entregan login y /me); nunca en localStorage ni en cookie legible. */
let csrf: string | null = null;
export const csrfStore = {
  set: (t: string | null) => { csrf = t; },
  has: () => csrf !== null,
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) { onUnauthorized = fn; }

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) };
  const metodo = (init.method ?? 'GET').toUpperCase();
  if (csrf && metodo !== 'GET' && metodo !== 'HEAD') headers['X-CSRF-Token'] = csrf;
  let body = init.body;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  const res = await fetch(`${BASE}${path}`, { ...init, headers, body, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && csrf) onUnauthorized?.(); // la sesión se perdió (vencida, revocada o cerrada en otro lado)
    const msg = typeof data?.error === 'string' ? data.error : data?.error?.message ?? 'No se pudo completar la operación';
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export interface Page<T> { items: T[]; total: number; page: number; pageSize: number }

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Ocurrió un error inesperado';
}

/** Lista paginada con búsqueda (debounce 300 ms) y descarte de respuestas viejas. */
export function useList<T>(path: string, opts: { pageSize?: number; params?: Record<string, string | undefined> } = {}) {
  const pageSize = opts.pageSize ?? 20;
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [data, setData] = useState<Page<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const paramsKey = JSON.stringify(opts.params ?? {});

  useEffect(() => { const t = setTimeout(() => { setDq(q); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setPage(1); }, [paramsKey, path]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (dq) sp.set('q', dq);
    for (const [k, v] of Object.entries(JSON.parse(paramsKey) as Record<string, string | undefined>)) if (v) sp.set(k, v);
    try {
      const r = await api<Page<T>>(`${path}?${sp}`);
      if (my === seq.current) setData(r);
    } catch (e) {
      if (my === seq.current) setError(errorText(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [path, page, pageSize, dq, paramsKey]);

  useEffect(() => { void load(); }, [load]);

  return { items: data?.items ?? [], total: data?.total ?? 0, page, pageSize, setPage, q, setQ, loading, error, reload: load };
}

/** Carga un recurso único. */
export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true); setError(null);
    try { setData(await api<T>(path)); } catch (e) { setError(errorText(e)); } finally { setLoading(false); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, loading, error, reload: load };
}
