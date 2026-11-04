// Cobertura de los grupos de WhatsApp. Cada block (o todo el condominio) tiene UN grupo en uso con el número de la administración: a él va el aviso
// del recibo y los comunicados de ese block. Aquí se dice qué grupo le toca a cada recibo y qué block se queda sin el suyo. Sin JID ni datos personales.
import { prisma } from '../../db';
import { periodoTexto } from '../../lib/periodo';
import { mensajeGrupoRecibo } from '../avisos/plantillas';

/** Lo que el recibo necesita para saber a qué grupo va. */
export interface DatosRecibo {
  mes: number;
  anio: number;
  fecha_vencimiento: Date;
  estructura: { id: number; nombre: string | null } | null;
  complejo: { nombre: string } | null;
}

/** «Condominio X» sin repetir la palabra si el nombre ya la trae («Condominio Los Libertadores»). */
export const nombreCondominio = (nombre: string): string => (/^condominio\b/i.test(nombre.trim()) ? nombre.trim() : `Condominio ${nombre}`.trim());

/** «Block 9» si el recibo es de un block; «Condominio X» si es de todo el condominio. */
export function ubicacionDelRecibo(r: Pick<DatosRecibo, 'estructura' | 'complejo'>): string {
  if (r.estructura) return r.estructura.nombre ?? `Block ${r.estructura.id}`;
  return nombreCondominio(r.complejo?.nombre ?? '');
}

/** Texto del grupo para el aviso de un recibo: el mismo que la administración copiaba a mano. Sin montos ni nombres de vecinos. */
export function textoGrupoRecibo(r: DatosRecibo): string {
  return mensajeGrupoRecibo({ periodo: periodoTexto(r.mes, r.anio), ubicacion: ubicacionDelRecibo(r), vencimiento: r.fecha_vencimiento });
}

/**
 * sin_grupo: no hay grupo en uso para ese block (o para el condominio). ya_no_esta: lo hay, pero el número ya no está en él.
 * listo: hay grupo y aún no salió el aviso de este recibo. enviado: el aviso de este recibo ya salió a todos sus grupos.
 */
export type SituacionGrupoRecibo = 'sin_grupo' | 'ya_no_esta' | 'listo' | 'enviado';

export interface GrupoDelRecibo {
  destino: 'block' | 'condominio';
  ubicacion: string;
  situacion: SituacionGrupoRecibo;
  /** Los grupos en uso (y donde el número sigue) que aún no tienen este recibo: a ellos va el envío. */
  listos: { id: number; nombre: string }[];
  texto: string;
  empresa_id: number | null;
  complejo_id: number | null;
  instancia: string | null;
}

/**
 * El grupo que le toca a un recibo: el de SU block (`destino` block) o, si el recibo no es de un block, el de todo el condominio.
 * Devuelve `null` si el recibo no existe. Nunca lanza por falta de grupo: eso es la situación `sin_grupo`.
 */
export async function gruposDelRecibo(reciboId: number): Promise<GrupoDelRecibo | null> {
  const r = await prisma.recibo.findUnique({
    where: { id: reciboId },
    select: {
      mes: true, anio: true, fecha_vencimiento: true, complejo_id: true, estructura_id: true,
      estructura: { select: { id: true, nombre: true } },
      complejo: { select: { nombre: true, empresa_id: true, empresa: { select: { whatsapp_instance: true } } } },
    },
  });
  if (!r) return null;
  const destino = r.estructura_id != null ? 'block' : 'condominio';
  const ubicacion = ubicacionDelRecibo(r);
  const base = { destino, ubicacion, texto: textoGrupoRecibo(r), empresa_id: r.complejo?.empresa_id ?? null, complejo_id: r.complejo_id, instancia: r.complejo?.empresa?.whatsapp_instance?.trim() || null } as const;
  const grupos = r.complejo_id == null ? [] : await prisma.grupoWhatsapp.findMany({
    where: { complejo_id: r.complejo_id, en_uso: true, destino, ...(destino === 'block' ? { estructura_id: r.estructura_id } : {}) },
    orderBy: [{ id: 'asc' }],
    select: { id: true, nombre: true, ya_no_esta: true },
  });
  if (!grupos.length) return { ...base, situacion: 'sin_grupo', listos: [] };
  const alcanzables = grupos.filter((g) => !g.ya_no_esta);
  if (!alcanzables.length) return { ...base, situacion: 'ya_no_esta', listos: [] };
  const hechos = await prisma.envioGrupoWhatsapp.findMany({
    where: { recibo_id: reciboId, estado: 'enviado', grupo_id: { in: alcanzables.map((g) => g.id) } },
    distinct: ['grupo_id'],
    select: { grupo_id: true },
  });
  const yaAvisados = new Set(hechos.map((h) => h.grupo_id));
  const listos = alcanzables.filter((g) => !yaAvisados.has(g.id)).map((g) => ({ id: g.id, nombre: g.nombre }));
  return { ...base, situacion: listos.length ? 'listo' : 'enviado', listos };
}

/** El aviso que la administración ve cuando al recibo le falta grupo (o el grupo ya no tiene al número). `null` si todo está bien o ya salió. */
export function avisoSinGrupo(g: Pick<GrupoDelRecibo, 'ubicacion' | 'situacion'>): string | null {
  if (g.situacion === 'sin_grupo') return `El ${g.ubicacion} no tiene grupo de WhatsApp: el aviso del recibo sólo le llegará por correo. Asígnalo en WhatsApp › Mis grupos.`;
  if (g.situacion === 'ya_no_esta') return `Tu número ya no está en el grupo del ${g.ubicacion}: el aviso del recibo sólo le llegará por correo. Vuelve a entrar al grupo y trae tus grupos de nuevo.`;
  return null;
}

/** Cobertura de un condominio: cuántos blocks tienen su grupo y cuáles no (con el motivo). `condominio_con_grupo` es el grupo de todo el condominio. */
export interface CoberturaCondominio {
  complejo_id: number;
  nombre: string;
  bloques: {
    total: number;
    con_grupo: number;
    faltan: { estructura_id: number; nombre: string; motivo: 'sin_grupo' | 'ya_no_esta' }[];
  };
  condominio_con_grupo: boolean;
}

/** La cobertura de varios condominios en dos consultas (no una por block). Sólo cuenta grupos en uso con el número todavía dentro. */
export async function coberturaDeCondominios(complejos: { id: number; nombre: string }[]): Promise<CoberturaCondominio[]> {
  const ids = complejos.map((c) => c.id);
  if (!ids.length) return [];
  const [estructuras, grupos] = await Promise.all([
    prisma.estructura.findMany({ where: { complejo_id: { in: ids } }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }], select: { id: true, nombre: true, complejo_id: true } }),
    prisma.grupoWhatsapp.findMany({ where: { complejo_id: { in: ids }, en_uso: true }, select: { complejo_id: true, destino: true, estructura_id: true, ya_no_esta: true } }),
  ]);
  return complejos.map((c) => {
    const bloques = estructuras.filter((e) => e.complejo_id === c.id);
    const gruposDeC = grupos.filter((g) => g.complejo_id === c.id);
    const faltan: CoberturaCondominio['bloques']['faltan'] = [];
    let conGrupo = 0;
    for (const b of bloques) {
      const suyos = gruposDeC.filter((g) => g.destino === 'block' && g.estructura_id === b.id);
      if (suyos.some((g) => !g.ya_no_esta)) conGrupo++;
      else faltan.push({ estructura_id: b.id, nombre: b.nombre ?? `Block ${b.id}`, motivo: suyos.length ? 'ya_no_esta' : 'sin_grupo' });
    }
    return {
      complejo_id: c.id,
      nombre: c.nombre,
      bloques: { total: bloques.length, con_grupo: conGrupo, faltan },
      condominio_con_grupo: gruposDeC.some((g) => g.destino === 'condominio' && !g.ya_no_esta),
    };
  });
}
