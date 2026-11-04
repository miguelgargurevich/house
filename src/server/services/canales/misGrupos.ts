// «Mis grupos»: los grupos de WhatsApp del número de la empresa, guardados en Torre. Evolution tarda mucho en listarlos (≈17 s con ~70 grupos),
// así que se traen UNA vez («Traer mis grupos») y las pantallas y los envíos leen de la base. `GrupoWhatsapp` es la fuente de verdad de a quién
// representa cada grupo; las columnas `Estructura.whatsapp_grupo_*` son legado y sólo se leen para pasar lo ya elegido (`migrarGruposDeEstructuras`).
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import { esSugerido, type GrupoElegible } from './gruposTipos';
import { canalesDeps } from './deps';
import { EvolutionFallo, listarGrupos, type GrupoWhatsapp } from './evolution';

/**
 * Pasa a `GrupoWhatsapp` (en uso, destino «vecinos del block») los grupos que la administración ya había elegido en la ficha del block y deja
 * vacías esas columnas: así no hay dos lugares que se contradigan y la migración no se repite (ni revive un grupo que se apagó después).
 * Barata (una consulta si no hay nada que pasar): se llama al leer, al traer los grupos, al armar un comunicado y al enviarlo.
 */
export async function migrarGruposDeEstructuras(empresaIds: number | number[]): Promise<number> {
  const ids = Array.isArray(empresaIds) ? empresaIds : [empresaIds];
  if (!ids.length) return 0;
  const bloques = await prisma.estructura.findMany({
    where: { whatsapp_grupo_jid: { not: null }, complejo: { empresa_id: { in: ids } } },
    orderBy: { id: 'asc' },
    select: { id: true, complejo_id: true, whatsapp_grupo_jid: true, whatsapp_grupo_nombre: true, whatsapp_grupo_aviso: true, whatsapp_grupo_aviso_at: true, complejo: { select: { empresa_id: true } } },
  });
  let pasados = 0;
  for (const b of bloques) {
    const empresa_id = b.complejo?.empresa_id;
    const jid = b.whatsapp_grupo_jid;
    if (empresa_id == null || !jid || b.complejo_id == null) continue;
    const nombre = b.whatsapp_grupo_nombre?.trim() || 'Grupo sin nombre';
    await prisma.$transaction(async (tx) => {
      const ya = await tx.grupoWhatsapp.findUnique({ where: { empresa_id_jid: { empresa_id, jid } }, select: { id: true, en_uso: true } });
      if (!ya) {
        await tx.grupoWhatsapp.create({ data: { empresa_id, jid, nombre, en_uso: true, destino: 'block', complejo_id: b.complejo_id, estructura_id: b.id, aviso: b.whatsapp_grupo_aviso, aviso_at: b.whatsapp_grupo_aviso_at } });
        pasados++;
      } else if (!ya.en_uso) {
        // Ya estaba en la lista (traída antes de pasar lo elegido): lo elegido en la ficha manda.
        await tx.grupoWhatsapp.update({ where: { id: ya.id }, data: { en_uso: true, destino: 'block', complejo_id: b.complejo_id, estructura_id: b.id, aviso: b.whatsapp_grupo_aviso, aviso_at: b.whatsapp_grupo_aviso_at } });
        pasados++;
      }
      await tx.estructura.update({ where: { id: b.id }, data: { whatsapp_grupo_jid: null, whatsapp_grupo_nombre: null, whatsapp_grupo_aviso: null, whatsapp_grupo_aviso_at: null } });
    });
  }
  return pasados;
}

export interface ResumenLista { nuevos: number; actualizados: number; ya_no_estan: number; quitados: number }

/**
 * Deja la base igual a la lista que trajo Evolution: crea los nuevos, actualiza nombre y miembros, y a los que ya no vienen los marca «ya no estás
 * en este grupo» (si estaban en uso NO se borran) o, si no estaban en uso, los quita de la lista. Un grupo que vuelve a aparecer se limpia.
 */
export async function aplicarListaDeEvolution(empresaId: number, lista: GrupoWhatsapp[]): Promise<ResumenLista> {
  const ahora = canalesDeps.ahora();
  const existentes = await prisma.grupoWhatsapp.findMany({ where: { empresa_id: empresaId }, select: { id: true, jid: true, en_uso: true, ya_no_esta: true } });
  const porJid = new Map(existentes.map((g) => [g.jid, g]));
  const vienen = new Set(lista.map((g) => g.jid));
  const nuevos = lista.filter((g) => !porJid.has(g.jid));
  const quedan = lista.filter((g) => porJid.has(g.jid));
  const faltan = existentes.filter((g) => !vienen.has(g.jid));
  await prisma.$transaction([
    prisma.grupoWhatsapp.createMany({ data: nuevos.map((g) => ({ empresa_id: empresaId, jid: g.jid, nombre: g.nombre, miembros: g.miembros, sincronizado_at: ahora })), skipDuplicates: true }),
    ...quedan.map((g) => {
      const antes = porJid.get(g.jid)!;
      return prisma.grupoWhatsapp.update({ where: { id: antes.id }, data: { nombre: g.nombre, miembros: g.miembros, ya_no_esta: false, sincronizado_at: ahora, ...(antes.ya_no_esta ? { aviso: null, aviso_at: null } : {}) } });
    }),
    prisma.grupoWhatsapp.updateMany({ where: { id: { in: faltan.filter((g) => g.en_uso).map((g) => g.id) } }, data: { ya_no_esta: true } }),
    prisma.grupoWhatsapp.deleteMany({ where: { id: { in: faltan.filter((g) => !g.en_uso).map((g) => g.id) } } }),
  ]);
  return { nuevos: nuevos.length, actualizados: quedan.length, ya_no_estan: faltan.filter((g) => g.en_uso).length, quitados: faltan.filter((g) => !g.en_uso).length };
}

const sincronizando = new Set<number>();

/**
 * «Traer mis grupos»: UNA llamada a Evolution (con tope amplio) y guarda el resultado. Dos a la vez de la misma empresa no se pisan: la segunda
 * recibe 409. Los fallos de Evolution se resumen en una frase; el detalle va al log sin URL ni claves.
 */
export async function sincronizarGrupos(empresaId: number, instancia: string): Promise<ResumenLista> {
  if (sincronizando.has(empresaId)) throw new HttpError(409, 'Ya se están trayendo tus grupos: espera a que termine');
  sincronizando.add(empresaId);
  try {
    await migrarGruposDeEstructuras(empresaId); // primero lo ya elegido, para que la lista nueva no lo pise
    let lista: GrupoWhatsapp[];
    try {
      lista = await listarGrupos(instancia);
    } catch (e) {
      console.error('[whatsapp] traer grupos:', e instanceof EvolutionFallo ? `${e.causa}${e.estado ? ` ${e.estado}` : ''}` : 'error');
      const causa = e instanceof EvolutionFallo ? e.causa : 'error';
      if (causa === 'sin_configurar') throw new HttpError(503, 'La Evolution API no está configurada en este servidor');
      throw new HttpError(causa === 'timeout' ? 504 : 502, causa === 'timeout'
        ? 'WhatsApp tardó demasiado en darnos tus grupos. Inténtalo de nuevo en un momento'
        : 'No se pudieron traer tus grupos: revisa que el número siga conectado e inténtalo de nuevo');
    }
    return await aplicarListaDeEvolution(empresaId, lista);
  } finally {
    sincronizando.delete(empresaId);
  }
}

/**
 * Los grupos en los que se puede escribir desde un comunicado de este condominio: en uso y donde el número sigue. `estructuraId` limita a un
 * block (la junta de un block sólo ve los de SU block). Nunca trae el JID.
 */
export async function gruposElegibles(complejoId: number, estructuraId: number | null = null): Promise<GrupoElegible[]> {
  return prisma.grupoWhatsapp.findMany({
    where: { complejo_id: complejoId, en_uso: true, ya_no_esta: false, ...(estructuraId != null ? { estructura_id: estructuraId } : {}) },
    orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    select: { id: true, nombre: true, destino: true, estructura_id: true },
  });
}

/** Los que vienen marcados cuando la API recibe `enviar_grupo: true` sin elegir ninguno (la misma regla que marca la pantalla). */
export const gruposSugeridos = (elegibles: GrupoElegible[], estructuraId: number | null): GrupoElegible[] => elegibles.filter((g) => esSugerido(g, estructuraId));
