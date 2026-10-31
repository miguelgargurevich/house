// `/api/me/canales`: vincular el WhatsApp o el Telegram de la propia persona con un código de un solo uso. Se monta tras `authenticate`.
import { Router } from 'express';
import { prisma } from '../db';
import { HttpError, conflict, notFound } from '../errors';
import { currentUser } from '../middleware/auth';
import { canalesDeps } from '../services/canales/deps';
import { numeroDeInstancia } from '../services/canales/evolution';
import { empresasDelUsuario } from '../services/canales/identidad';
import { limites } from '../services/canales/limites';
import { botActivo, enlaceVinculo } from '../services/canales/telegram';
import { VIGENCIA_CODIGO_MIN, generarCodigo, listarVinculos, mascara, revocarVinculo, type CanalBot } from '../services/canales/vinculos';
import { parse, parseId, z } from '../validation';

const canalParams = z.object({ canal: z.enum(['whatsapp', 'telegram']) });

/** A qué número del edificio se le manda el código: una fila por empresa con la que la persona tiene relación y WhatsApp vinculado. */
async function destinosDe(u: { id: number; empresa_id: number | null }) {
  const ids = await empresasDelUsuario(u);
  if (!ids.length) return [];
  const empresas = await prisma.empresaAdministradora.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' }, select: { id: true, nombre: true, whatsapp_instance: true } });
  return Promise.all(empresas.map(async (e) => ({
    empresa: { id: e.id, nombre: e.nombre },
    disponible: !!e.whatsapp_instance,
    /** Número de WhatsApp del edificio (sólo dígitos) o null si Evolution no lo informa. */
    numero: e.whatsapp_instance ? await numeroDeInstancia(e.whatsapp_instance) : null,
  })));
}

export const canalesMeRouter = Router();

canalesMeRouter.use((_req, res, next) => {
  res.locals.entidad = 'canal_vinculado';
  next();
});

canalesMeRouter.get('/', async (req, res) => {
  const u = currentUser(req);
  const [vinculos, codigo, destinos, bot, empresas] = await Promise.all([
    listarVinculos(u.id),
    prisma.codigoVinculacion.findFirst({ where: { usuario_id: u.id, usado_at: null, expira_at: { gt: canalesDeps.ahora() } }, select: { canal: true, expira_at: true } }),
    destinosDe(u),
    botActivo(),
    empresasDelUsuario(u),
  ]);
  res.json({
    vinculos: vinculos.map((v) => ({ id: v.id, canal: v.canal, identificador: mascara(v.identificador, v.canal as CanalBot), verificado_at: v.verificado_at, empresa: v.empresa })),
    // Sólo se dice que hay un código vigente y cuándo vence: el código en sí sólo se ve al generarlo (en la base está hasheado).
    codigo_vigente: codigo,
    destinos,
    // Telegram es un bot GLOBAL: está disponible si el superadmin lo activó y la persona tiene alguna empresa (el superadmin no).
    telegram: { disponible: !!bot && empresas.length > 0, bot_usuario: bot && empresas.length > 0 ? bot.usuario : null },
  });
});

canalesMeRouter.post('/:canal/codigo', async (req, res) => {
  const u = currentUser(req);
  const { canal } = parse(canalParams, req.params);
  // Pocos códigos por persona: frena a quien intente generar muchos para probar suerte.
  if (limites.codigosUsuario.golpear(`u${u.id}`) > limites.codigosUsuario.tope) throw new HttpError(429, 'Generaste muchos códigos seguidos, intenta de nuevo en unos minutos');
  if (canal === 'telegram') {
    const [bot, empresas] = await Promise.all([botActivo(), empresasDelUsuario(u)]);
    if (!bot || !empresas.length) throw conflict('Telegram todavía no está activado en Torre');
    const { codigo, expira_at } = await generarCodigo(u.id, canal);
    res.locals.accion = 'generar_codigo';
    res.locals.auditDetalle = { canal }; // nunca el código
    return void res.status(201).json({ canal, codigo, expira_at, vigencia_min: VIGENCIA_CODIGO_MIN, destinos: [], telegram: { bot_usuario: bot.usuario, enlace: enlaceVinculo(bot.usuario, codigo) } });
  }
  const destinos = await destinosDe(u);
  if (!destinos.some((d) => d.disponible)) throw conflict('Tu administración todavía no activó WhatsApp en Torre');
  const { codigo, expira_at } = await generarCodigo(u.id, canal);
  res.locals.accion = 'generar_codigo';
  res.locals.auditDetalle = { canal }; // nunca el código
  res.status(201).json({ canal, codigo, expira_at, vigencia_min: VIGENCIA_CODIGO_MIN, destinos });
});

canalesMeRouter.delete('/:id', async (req, res) => {
  const u = currentUser(req);
  const id = parseId(req);
  // Sólo el vínculo PROPIO (uno ajeno responde 404, no se revela que existe).
  if (!(await revocarVinculo({ id, usuario_id: u.id }))) throw notFound('Vínculo');
  res.locals.accion = 'desvincular';
  res.locals.entidadId = id;
  res.status(204).end();
});
