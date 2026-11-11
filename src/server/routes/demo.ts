// /api/demo/*: sólo existe con el modo demostración encendido (`ConfiguracionDemo.activo`); sin él, todo responde 404 como cualquier ruta que no existe.
//  GET  /estado     (público)    ¿es una demo?, los roles para entrar, cuándo se reinicia.
//  POST /entrar     (público)    { rol } → abre sesión con la cuenta de demo de ese rol, sin contraseña. Mismo cuerpo de respuesta que el login.
//  POST /reiniciar  (superadmin) vuelve a sembrar la demo (responde 202; sigue en segundo plano).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db';
import { HttpError } from '../errors';
import { ipDe, registrarAuditoria } from '../middleware/audit';
import { authenticate, requireRole } from '../middleware/auth';
import { juntaUnicaDeUsuario } from '../lib/juntaUnica';
import { marcaDeUsuario } from '../services/marca/servicio';
import { MARCA_TORRE } from '../services/marca/tipos';
import { crearSesion, ponerCookie } from '../services/sesiones';
import { CUENTAS_DEMO, ROLES_DEMO } from '../services/demo/cuentas';
import { modoDemo } from '../services/demo/estado';
import { HORA_REINICIO_LIMA, reiniciarDemo } from '../services/demo/reinicio';
import { parseBody, z } from '../validation';

export interface OpcionesDemo {
  /** Entradas por IP cada 15 minutos (por defecto 60: un equipo comercial detrás de la misma red no se estorba). */
  limiteEntrar?: number;
}

const entrarSchema = z.strictObject({ rol: z.enum(ROLES_DEMO, { error: 'Elige un rol de la lista' }) });

export function demoRouter(opts: OpcionesDemo = {}) {
  const r = Router();

  // Sin modo demo, esta ruta no existe.
  r.use(async (_req, _res, next) => {
    if (!(await modoDemo())) throw new HttpError(404, 'Ruta no encontrada');
    next();
  });

  r.get('/estado', async (_req, res) => {
    const f = await prisma.configuracionDemo.findUnique({ where: { id: 1 }, select: { sembrada_at: true, reiniciando_desde: true } });
    res.set('Cache-Control', 'no-store');
    res.json({ demo: true, roles: ROLES_DEMO, reinicia_a_las: `${String(HORA_REINICIO_LIMA).padStart(2, '0')}:00 (hora de Lima)`, sembrada_at: f?.sembrada_at ?? null, reiniciando: f?.reiniciando_desde != null });
  });

  const limite = rateLimit({
    windowMs: 15 * 60_000,
    limit: opts.limiteEntrar ?? 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Entraste muchas veces seguidas a la demo. Espera unos minutos e inténtalo de nuevo.' },
  });

  r.post('/entrar', limite, async (req, res) => {
    const { rol } = parseBody(entrarSchema, req);
    const usuario = await prisma.usuario.findUnique({ where: { email: CUENTAS_DEMO[rol].email }, include: { estructura: { select: { nombre: true } } } });
    const reiniciando = (await prisma.configuracionDemo.findUnique({ where: { id: 1 }, select: { reiniciando_desde: true } }))?.reiniciando_desde != null;
    if (!usuario || !usuario.rol || reiniciando) throw new HttpError(503, 'La demo se está preparando. Vuelve a intentarlo en un minuto.');
    const user = { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol, empresa_id: usuario.empresa_id, complejo_id: usuario.complejo_id, cargo_junta: usuario.cargo_junta, estructura_id: usuario.estructura_id, estructura_nombre: usuario.estructura?.nombre ?? null, junta_unica: await juntaUnicaDeUsuario(usuario) };
    const { token, csrf } = await crearSesion(user.id, ipDe(req), req.get('user-agent'));
    ponerCookie(res, token);
    await registrarAuditoria({ usuario_id: user.id, accion: 'login_demo', entidad: 'usuario', entidad_id: user.id, detalle: { rol }, ip: ipDe(req) });
    const marca = await marcaDeUsuario(usuario).catch(() => MARCA_TORRE);
    res.json({ user, csrf, marca });
  });

  r.post('/reiniciar', authenticate, requireRole(), async (_req, res) => {
    // En segundo plano: la siembra dura medio minuto. Quien llama puede consultar `GET /estado` (`reiniciando`).
    void reiniciarDemo((m) => console.log(m)).catch((e) => console.error('[demo] el reinicio falló:', e instanceof Error ? e.message : 'error'));
    res.status(202).json({ ok: true, mensaje: 'Reiniciando la demo: tardará cerca de un minuto.' });
  });

  return r;
}
