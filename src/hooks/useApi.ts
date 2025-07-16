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
  // Usar solo REACT_APP_API_URL como base para todas las llamadas
  const API_BASE = import.meta.env.REACT_APP_API_URL || 'http://localhost:4000';
  const apiFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const token = getToken();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers ? options.headers as Record<string, string> : {}),
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      // Si la url es relativa, anteponer la base
      const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url.startsWith('/') ? url : `/${url}`}`;
      const res = await fetch(fullUrl, {
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
