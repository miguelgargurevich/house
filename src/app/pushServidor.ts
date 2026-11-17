import { api } from '../api';
import { leerConfigPush } from './push';
import type { ServidorPush } from './pushApp';

/** Las llamadas de la app de iOS/Android al servidor de avisos push (`/api/me/push/*`). Aquí vive el único `api()` del puente nativo (`pushApp.ts` se prueba en Node sin él). */
export const servidorPush: ServidorPush = {
  fcmListo: async () => (await leerConfigPush()).fcm,
  registrar: (token, plataforma) => api('/api/me/push/dispositivos', { method: 'POST', json: { tipo: 'fcm', token, plataforma } }),
  baja: (token, cabeceras) => api('/api/me/push/dispositivos/baja', { method: 'POST', json: { token }, headers: cabeceras }),
};
