import { useCallback } from 'react';

export function getToken() {
  return localStorage.getItem('token');
}

export function setToken(token: string) {
  localStorage.setItem('token', token);
}

export function removeToken() {
  localStorage.removeItem('token');
}

export function useApi() {
  // Método genérico para llamadas autenticadas
  const apiFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const token = getToken();
      // Forzar tipado a Record<string, string> para evitar warning
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers ? options.headers as Record<string, string> : {}),
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(url, {
        ...options,
        headers,
      });
      if (res.status === 401 || res.status === 403) {
        removeToken();
        // Opcional: redirigir a login o mostrar mensaje
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw data;
      return data;
    },
    []
  );

  return { apiFetch, getToken, setToken, removeToken };
}
