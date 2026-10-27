// Webhook de Evolution para el bot de WhatsApp: `POST /api/canales/whatsapp/:instancia`. Público (sin sesión), autenticado con el secreto de la
// instancia en la cabecera `x-house-secret`. Se monta ANTES del JSON global: lleva su propio tope de cuerpo (64 kB) y sólo lo lee si el secreto es válido.
import express, { Router } from 'express';
import { CABECERA_SECRETO } from '../services/canales/evolution';
import { interpretarWebhook, procesarEntrante, reclamarMensaje } from '../services/canales/entrante';
import { limites } from '../services/canales/limites';
import { autenticarWebhook } from '../services/canales/webhook';

export const MAX_CUERPO_WEBHOOK = '64kb';

// Procesamiento en segundo plano: se responde 200 a Evolution enseguida. Los mensajes de un mismo número van en fila (no se cruzan dos turnos).
const colas = new Map<string, Promise<void>>();
const enCurso = new Set<Promise<void>>();

function encolar(numero: string, trabajo: () => Promise<void>): void {
  const previa = colas.get(numero) ?? Promise.resolve();
  const p: Promise<void> = previa.then(trabajo).catch((e) => { console.error('[canales] falló el procesamiento en segundo plano', e instanceof Error ? e.name : 'error'); });
  colas.set(numero, p);
  enCurso.add(p);
  void p.finally(() => {
    enCurso.delete(p);
    if (colas.get(numero) === p) colas.delete(numero);
  });
}

/** Sólo pruebas: espera a que termine todo lo que quedó en segundo plano. */
export async function esperarCanales(): Promise<void> {
  while (enCurso.size) await Promise.all([...enCurso]);
}

export function canalesWebhookRouter() {
  const router = Router();

  // 1.º el secreto (sin leer el cuerpo); 2.º el JSON con tope; 3.º responder 200 y procesar aparte.
  router.post('/:instancia', async (req, res, next) => {
    const instancia = String(req.params.instancia ?? '');
    const ip = req.ip ?? 'sin-ip';
    // Quien tantea instancias o secretos se frena: tras 30 fallos por IP en 15 min, 429 sin mirar la base.
    if (limites.webhookFallosIp.llena(ip)) return void res.status(429).json({ error: 'Demasiados intentos' });
    const auth = /^[\w.-]{1,80}$/.test(instancia) ? await autenticarWebhook(instancia, req.get(CABECERA_SECRETO)) : null;
    if (!auth) {
      limites.webhookFallosIp.golpear(ip);
      return void res.status(401).json({ error: 'No autorizado' });
    }
    res.locals.empresaId = auth.empresaId;
    next();
  }, express.json({ limit: MAX_CUERPO_WEBHOOK }), (req, res) => {
    const instancia = String(req.params.instancia);
    const empresaId = res.locals.empresaId as number;
    for (const e of interpretarWebhook(req.body)) {
      encolar(e.numero, async () => {
        if (!(await reclamarMensaje(instancia, e.mensajeId))) return; // Evolution reintentó: ya se atendió
        await procesarEntrante(instancia, empresaId, e);
      });
    }
    res.status(200).json({ ok: true });
  });

  return router;
}
