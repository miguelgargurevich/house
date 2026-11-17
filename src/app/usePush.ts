import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Usuario } from '../auth/AuthContext';
import { useToast } from '../ui';
import { reanudarWeb } from './push';
import { iniciarPushApp } from './pushApp';
import { servidorPush } from './pushServidor';

/**
 * Con la sesión iniciada: registra el teléfono para los avisos push de la app (Android) y vuelve a registrar el navegador si esa cuenta ya los había
 * activado ahí. Todo es silencioso y nunca lanza. En una sesión prestada («Entrar como») no registra nada: el dispositivo es del superadmin, no de la persona a quien ve.
 * Al tocar un aviso de la app se abre su ruta interna; con la app abierta, el aviso sale como un mensaje en pantalla.
 */
export function usePushInicio(user: Usuario | null): void {
  const nav = useNavigate();
  const toast = useToast();
  const actual = useRef({ nav, toast });
  actual.current = { nav, toast };
  const id = user?.id;
  const prestada = !!user?.impersonando;

  useEffect(() => {
    if (id == null || prestada) return;
    void iniciarPushApp(
      { abrir: (ruta) => actual.current.nav(ruta), mostrar: (texto) => actual.current.toast.ok(texto) },
      servidorPush,
    );
    void reanudarWeb(id);
  }, [id, prestada]);
}
