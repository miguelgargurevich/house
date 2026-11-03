import { Router } from 'express';
import { assertRef, crudRouter } from '../crud';
import { prisma } from '../db';
import { HttpError, invalid, notFound } from '../errors';
import { ambitoJunta, puedeGestionar } from '../lib/junta';
import { scopeComplejos, scopeEstructuras } from '../lib/scope';
import { currentUser, requireRole, type AuthUser } from '../middleware/auth';
import { EvolutionFallo, JID_GRUPO, listarGrupos, type GrupoWhatsapp } from '../services/canales/evolution';
import { instanciaDeBlock } from '../services/canales/grupos';
import { correoEfectivo } from '../services/juntas';
import { emailSchema, idSchema, parseBody, parseId, texto, textoOpcional, z } from '../validation';
import { exigirOperativo } from '../services/comercial/operativo';

/**
 * Las torres son planas. Todo el motor de House agrupa por torre directa (`Unidad.estructura_id`):
 * el ámbito de la junta, el resumen de recibos por torre y la importación del Excel de mantenimiento.
 * Por eso el anidamiento se rechaza: una torre anidada sería un dato que la aplicación no sabría representar.
 */
const PLANAS = 'Torre trabaja con blocks planos: no se puede anidar un block dentro de otro';

const base = z.object({
  nombre: textoOpcional(120),
  tipo: texto(40),
  complejo_id: idSchema,
  padre_id: z.never({ error: PLANAS }).nullish(),
  /** Al crear o editar: cuántos pisos tiene la torre (0–60). Los pisos que ya existen no se borran. */
  cantidad_pisos: z.coerce.number().int().min(0, 'No puede ser negativo').max(60, 'Máximo 60 pisos').nullish(),
  /** «Correo del block» al que se envían los vouchers (sale en el recibo impreso). */
  correo_vouchers: z.preprocess((v) => (v === '' ? null : v), emailSchema.nullish()),
});

async function validarRefs(d: Record<string, unknown>, user: AuthUser) {
  if (d.padre_id != null) throw invalid(PLANAS, { padre_id: 'Los blocks son planos' });
  if (d.complejo_id != null) await assertRef(prisma.complejoHabitacional, d.complejo_id as number, scopeComplejos(user), 'complejo_id');
  return d;
}

const crud = crudRouter({
  entidad: 'estructura',
  delegate: prisma.estructura,
  readRoles: ['admin'],
  writeRoles: ['admin'],
  scope: scopeEstructuras,
  search: ['nombre', 'tipo'],
  orderable: ['id', 'nombre', 'tipo'],
  defaultOrder: { id: 'asc' },
  include: { complejo: { select: { id: true, nombre: true } }, juntas: { where: { hasta: null }, select: { correo: true }, take: 1 } },
  // Conteo de pisos y de unidades por torre (una consulta por cada dato, para toda la página).
  format: async (items) => {
    const ids = items.map(i => i.id as number);
    if (!ids.length) return items;
    // El «correo del block» que se muestra es el efectivo: el de la junta vigente o, si no tiene, el `correo_vouchers` de la torre.
    items = items.map(({ juntas, ...i }) => ({ ...i, correo_vouchers: correoEfectivo({ correo_vouchers: (i.correo_vouchers as string | null) ?? null, juntas: juntas as { correo: string | null }[] }) }));
    const [unidades, pisos] = await Promise.all([
      prisma.unidad.groupBy({ by: ['estructura_id'], where: { estructura_id: { in: ids } }, _count: { _all: true } }),
      prisma.piso.groupBy({ by: ['estructura_id'], where: { estructura_id: { in: ids } }, _count: { _all: true } }),
    ]);
    const u = new Map(unidades.map(x => [x.estructura_id, x._count._all]));
    const p = new Map(pisos.map(x => [x.estructura_id, x._count._all]));
    return items.map(i => ({ ...i, unidades_count: u.get(i.id as number) ?? 0, pisos_count: p.get(i.id as number) ?? 0 }));
  },
  filtros: {
    schema: z.object({ complejo_id: idSchema.optional() }),
    where: (f) => (f.complejo_id !== undefined ? { complejo_id: f.complejo_id } : {}),
  },
  createSchema: base,
  updateSchema: base.partial(),
  operativo: (r, u) => exigirOperativo(r.complejo_id as number | null, u),
  prepareCreate: validarRefs,
  prepareUpdate: async (d, u, existing) => {
    if (d.padre_id != null) throw invalid(PLANAS, { padre_id: 'Los blocks son planos' });
    // Una torre no cambia de condominio: sus unidades y sus medios de pago pertenecen al de origen.
    if (d.complejo_id != null && d.complejo_id !== existing.complejo_id) {
      throw invalid('Un block no se cambia de condominio: crea un block nuevo en el otro condominio', { complejo_id: 'No se puede cambiar' });
    }
    // La torre no cambia de condominio y no se anida: se quitan del cuerpo antes de validar el resto.
    const resto = { ...d };
    delete resto.padre_id;
    delete resto.complejo_id;
    return validarRefs(resto, u);
  },
  // Crear la torre con sus pisos, en una transacción.
  create: async (d) => {
    const { cantidad_pisos, ...data } = d as { cantidad_pisos?: number | null } & Record<string, unknown>;
    return prisma.$transaction(async (tx) => {
      const est = await tx.estructura.create({ data: data as never });
      const n = cantidad_pisos ?? 0;
      if (n > 0) await tx.piso.createMany({ data: Array.from({ length: n }, (_, i) => ({ numero: i + 1, estructura_id: est.id })) });
      return est;
    });
  },
  // Editar la torre y agregar los pisos que falten (nunca se borra un piso: puede tener unidades).
  update: async (d, existing) => {
    const { cantidad_pisos, ...data } = d as { cantidad_pisos?: number | null } & Record<string, unknown>;
    const id = existing.id as number;
    return prisma.$transaction(async (tx) => {
      const est = await tx.estructura.update({ where: { id }, data: data as never });
      // Un solo correo: si la torre tiene junta vigente, su correo cambia con el de la torre.
      if (data.correo_vouchers !== undefined) await tx.juntaDirectiva.updateMany({ where: { estructura_id: id, hasta: null }, data: { correo: data.correo_vouchers as string | null } });
      const n = cantidad_pisos ?? 0;
      if (n > 0) {
        const pisos = await tx.piso.findMany({ where: { estructura_id: id }, select: { numero: true } });
        const existentes = new Set(pisos.map(p => p.numero));
        const nuevos = Array.from({ length: n }, (_, i) => i + 1).filter(numero => !existentes.has(numero));
        if (nuevos.length > 0) await tx.piso.createMany({ data: nuevos.map(numero => ({ numero, estructura_id: id })) });
      }
      return est;
    });
  },
  // Una torre con unidades o con junta asignada no se puede borrar: hay que reasignar antes.
  beforeDelete: async (existing) => {
    const id = existing.id as number;
    const [unidades, junta] = await Promise.all([
      prisma.unidad.count({ where: { estructura_id: id } }),
      prisma.usuario.count({ where: { estructura_id: id, cargo_junta: { not: null } } }),
    ]);
    // Borrar la torre se llevaría también su historial de juntas y las cuentas de sus gestiones.
    if (await prisma.juntaDirectiva.count({ where: { estructura_id: id } }) > 0) {
      throw invalid('El block tiene juntas directivas registradas (vigente o anteriores): su historial se perdería', { juntas: 'El block tiene juntas' });
    }
    if (unidades > 0) {
      throw invalid(`El block tiene ${unidades} ${unidades === 1 ? 'unidad asignada' : 'unidades asignadas'}: muévelas a otro block antes de borrarlo`, { unidades: 'El block tiene unidades' });
    }
    if (junta > 0) {
      throw invalid(`El block tiene ${junta} ${junta === 1 ? 'usuario de junta' : 'usuarios de junta'}: reasígnalos antes de borrarlo (sin block su alcance pasa a todo el condominio)`, { junta: 'El block tiene usuarios de junta' });
    }
  },
  // Los pisos se van con la torre.
  afterDelete: async (existing) => {
    await prisma.piso.deleteMany({ where: { estructura_id: existing.id as number } });
  },
});

const router = Router();

/** Asigna a la torre las unidades del condominio que todavía no tienen torre (carga anterior a las torres). */
router.post('/:id/asignar-unidades', requireRole('admin'), async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  const est = await prisma.estructura.findFirst({ where: { AND: [{ id }, scopeEstructuras(user)] }, select: { id: true, complejo_id: true } });
  if (!est) throw notFound();
  await exigirOperativo(est.complejo_id, user);
  const r = await prisma.unidad.updateMany({ where: { complejo_id: est.complejo_id, estructura_id: null }, data: { estructura_id: id } });
  res.locals.entidad = 'estructura';
  res.locals.entidadId = id;
  res.locals.accion = 'asignar_unidades';
  res.locals.auditDetalle = { asignadas: r.count, complejo_id: est.complejo_id };
  res.json({ asignadas: r.count });
});

/**
 * Correo del block para enviar vouchers (el de su junta vigente: ver `services/juntas.ts`). Lo cambian la administración (de su empresa) y la junta de ESE block (presidente o tesorero); la junta
 * sin block, el de cualquier torre de su condominio. Otro tenant o la torre de otra junta → 404.
 */
router.put('/:id/correo-vouchers', async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  const { correo_vouchers } = parseBody(z.strictObject({ correo_vouchers: z.preprocess((v) => (v === '' ? null : v), emailSchema.nullable()) }), req);
  const est = await prisma.estructura.findFirst({ where: { id }, select: { id: true, complejo_id: true } });
  const esAdmin = user.rol === 'admin' || user.rol === 'superadmin';
  if (!est || !(esAdmin ? await prisma.estructura.findFirst({ where: { AND: [{ id }, scopeEstructuras(user)] }, select: { id: true } }) : ambitoJunta(user) && puedeGestionar(user, { complejo_id: est.complejo_id, estructura_id: id }))) throw notFound();
  // El correo del block es el de su junta vigente: se cambian los dos para que lo escrito sea lo que se usa (y borrarlo lo borra de verdad).
  await prisma.$transaction([
    prisma.estructura.update({ where: { id }, data: { correo_vouchers } }),
    prisma.juntaDirectiva.updateMany({ where: { estructura_id: id, hasta: null }, data: { correo: correo_vouchers } }),
  ]);
  res.locals.entidad = 'estructura';
  res.locals.entidadId = id;
  res.locals.accion = 'correo_vouchers';
  res.locals.auditDetalle = { correo_vouchers };
  res.json({ id, correo_vouchers });
});

/** Los grupos donde está el número de la empresa de ESTA torre. Un fallo de Evolution se resume en una frase (el detalle va al log). */
async function gruposDeLaEmpresa(instancia: string): Promise<GrupoWhatsapp[]> {
  try {
    return await listarGrupos(instancia);
  } catch (e) {
    console.error('[estructuras] grupos de WhatsApp:', e instanceof EvolutionFallo ? `${e.causa}${e.estado ? ` ${e.estado}` : ''}` : 'error');
    throw new HttpError(502, 'No se pudo traer la lista de grupos de WhatsApp: revisa que el número siga conectado e inténtalo de nuevo');
  }
}

/** Torre de la empresa de quien llama (otra empresa → 404) con su grupo actual y la instancia de WhatsApp que le toca. */
async function cargarParaGrupo(user: AuthUser, id: number) {
  const est = await prisma.estructura.findFirst({ where: { AND: [{ id }, scopeEstructuras(user)] }, select: { id: true, nombre: true, whatsapp_grupo_jid: true, whatsapp_grupo_nombre: true, whatsapp_grupo_aviso: true, whatsapp_grupo_aviso_at: true } });
  const dueno = est ? await instanciaDeBlock(id) : null;
  if (!est || !dueno) throw notFound();
  return { est, ...dueno };
}

/**
 * Grupos de WhatsApp donde está el número de la empresa de la torre, para elegir el del block. Sólo la administración (la junta ve el grupo
 * elegido en «Comunicados» pero no lo cambia). Sin número conectado: `conectado: false` y lista vacía.
 */
router.get('/:id/grupos-whatsapp', requireRole('admin'), async (req, res) => {
  const { est, instancia } = await cargarParaGrupo(currentUser(req), parseId(req));
  const actual = est.whatsapp_grupo_jid ? { jid: est.whatsapp_grupo_jid, nombre: est.whatsapp_grupo_nombre, aviso: est.whatsapp_grupo_aviso, aviso_at: est.whatsapp_grupo_aviso_at } : null;
  if (!instancia) return res.json({ conectado: false, grupos: [], actual });
  res.json({ conectado: true, grupos: await gruposDeLaEmpresa(instancia), actual });
});

/**
 * Elige (o quita, con `jid: null`) el grupo de WhatsApp del block. El JID NUNCA se acepta a ciegas: tiene que estar en la lista de grupos de la
 * instancia de ESA empresa, y el nombre se guarda tal como lo dice Evolution. Un mismo grupo no puede ser de dos blocks.
 */
router.put('/:id/grupo-whatsapp', requireRole('admin'), async (req, res) => {
  const user = currentUser(req);
  const id = parseId(req);
  const { jid } = parseBody(z.strictObject({ jid: z.string({ error: 'Elige un grupo de la lista' }).regex(JID_GRUPO, 'Elige un grupo de la lista').nullable() }), req);
  const { est, instancia, complejo_id, empresa_id } = await cargarParaGrupo(user, id);
  await exigirOperativo(complejo_id, user);
  let nombre: string | null = null;
  if (jid != null) {
    if (!instancia) throw invalid('Primero conecta WhatsApp: no hay un número vinculado para traer tus grupos', { jid: 'WhatsApp no está conectado' });
    const grupo = (await gruposDeLaEmpresa(instancia)).find((g) => g.jid === jid);
    if (!grupo) throw invalid('Ese grupo no está entre los grupos de tu número de WhatsApp', { jid: 'Grupo no encontrado' });
    const otro = await prisma.estructura.findFirst({ where: { whatsapp_grupo_jid: jid, id: { not: id }, complejo: { empresa_id } }, select: { id: true, nombre: true } });
    if (otro) throw invalid(`Ese grupo ya es del ${otro.nombre?.trim() || `Block ${otro.id}`}`, { jid: 'Grupo ya asignado' });
    nombre = grupo.nombre;
  }
  await prisma.estructura.update({ where: { id }, data: { whatsapp_grupo_jid: jid, whatsapp_grupo_nombre: nombre, whatsapp_grupo_aviso: null, whatsapp_grupo_aviso_at: null } });
  res.locals.entidad = 'estructura';
  res.locals.entidadId = id;
  res.locals.accion = 'grupo_whatsapp';
  res.locals.auditDetalle = { grupo: nombre, antes: est.whatsapp_grupo_nombre };
  res.json({ id, whatsapp_grupo_jid: jid, whatsapp_grupo_nombre: nombre });
});

router.use(crud);

export { router as estructurasRouter };
