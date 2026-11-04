// Correo (Resend) falso para las pruebas del contacto y del Libro de Reclamaciones: guarda lo que «saldría» y no usa la red.
import type { DepsAvisos } from '../../src/server/services/avisos/canales';

export interface CorreoEnviado { para: string; asunto: string; texto: string; html: string }

export function correoFalso(opts: { fallar?: boolean } = {}) {
  const enviados: CorreoEnviado[] = [];
  const deps = (): DepsAvisos => ({
    ahora: () => new Date(),
    esperar: async () => {},
    azar: () => 0,
    env: { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'Torre <torre@ejemplo.test>' },
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      if (opts.fallar) return new Response('{}', { status: 500 });
      const b = JSON.parse(String(init?.body));
      enviados.push({ para: b.to[0], asunto: b.subject, texto: b.text, html: b.html ?? '' });
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  return { enviados, deps };
}
