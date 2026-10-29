// Tanda 1 · `junta_y_residentes`: quiénes son la junta directiva de cada block y, para quien administra, los vecinos. El alcance sale de
// `lib/scope.ts` y `lib/junta.ts`: la administración ve su empresa; la junta (presidente/tesorero), su ámbito; el residente SÓLO la junta de
// su(s) block(s), con cargo y nombre (nunca la lista de vecinos). Sin correos, teléfonos ni documentos: la salida segura los quita igual.
import { Prisma } from '@prisma/client';
import { ROLES_RESIDENTE } from '../config';
import { prisma } from '../db';
import { CARGOS_JUNTA, ambitoJunta, filtroAmbito } from '../lib/junta';
import { dondeVer } from '../lib/rutasApp';
import { empresaDe, scopeComplejos, scopeUnidades } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { z } from '../validation';
import { cortar, dato, defineHerramienta, idPositivo, nombreCorto, paginacion, pagina, respuesta, sinAcceso, textoCorto } from './base';
import { unidadesPropias } from './residente';

const MAX_JUNTA = 50;
const MAX_UNIDADES_POR_PERSONA = 6;
const ORDEN_CARGO: Record<string, number> = Object.fromEntries(CARGOS_JUNTA.map((c, i) => [c, i]));

type TipoAlcance = 'plataforma' | 'empresa' | 'junta' | 'residente';
interface AlcancePersonas {
  tipo: TipoAlcance;
  /** Unidades cuyos residentes se pueden listar (sólo si `vecinos`). */
  unidades: Prisma.UnidadWhereInput;
  /** Miembros de la junta que esta persona puede ver. */
  junta: Prisma.UsuarioWhereInput;
  /** ¿Puede ver la lista de vecinos y los departamentos? Sólo la administración y la junta que gestiona. El residente no. */
  vecinos: boolean;
}

const TEXTO_ALCANCE: Record<TipoAlcance, string> = { plataforma: 'toda la plataforma', empresa: 'tu empresa', junta: 'tu ámbito de junta', residente: 'la junta de tu(s) block(s)' };

/** La junta de un block la forman quienes tienen cargo en ese block y los que tienen cargo en todo el condominio (`estructura_id` null). */
const juntaDeBlock = (complejo_id: number, estructura_id: number | null): Prisma.UsuarioWhereInput => ({ complejo_id, OR: [{ estructura_id: null }, ...(estructura_id != null ? [{ estructura_id }] : [])] });

async function alcancePersonas(u: AuthUser): Promise<AlcancePersonas> {
  if (u.rol === 'superadmin') return { tipo: 'plataforma', unidades: {}, junta: {}, vecinos: true };
  if (u.rol === 'admin') {
    empresaDe(u); // 403 si no tiene empresa
    return { tipo: 'empresa', unidades: scopeUnidades(u), junta: { complejo: scopeComplejos(u) }, vecinos: true };
  }
  if (!(ROLES_RESIDENTE as readonly string[]).includes(u.rol)) throw sinAcceso();
  const a = ambitoJunta(u);
  if (a) return { tipo: 'junta', unidades: filtroAmbito(a), junta: a.estructura_id == null ? { complejo_id: a.complejo_id } : juntaDeBlock(a.complejo_id, a.estructura_id), vecinos: true };
  // Residente: la junta de los blocks donde tiene unidades (más la del condominio entero). Nada más.
  // El block de su perfil cuenta aunque aún no tenga una unidad asignada (p. ej. un vocal recién nombrado).
  const pares = await prisma.unidad.findMany({ where: unidadesPropias(u), distinct: ['complejo_id', 'estructura_id'], take: 50, select: { complejo_id: true, estructura_id: true } });
  if (u.complejo_id != null) pares.push({ complejo_id: u.complejo_id, estructura_id: u.estructura_id });
  const ors = pares.filter((p): p is { complejo_id: number; estructura_id: number | null } => p.complejo_id != null).map((p) => juntaDeBlock(p.complejo_id, p.estructura_id));
  return { tipo: 'residente', unidades: { id: -1 }, junta: ors.length ? { OR: ors } : { id: -1 }, vecinos: false };
}

export const juntaYResidentes = defineHerramienta({
  nombre: 'junta_y_residentes',
  descripcion:
    'Quiénes son la junta directiva (presidente, tesorero, secretario, vocal) de cada block y, para la administración y la junta, los residentes (propietarios e inquilinos) con su departamento, su rol y su cargo si lo tienen. ' +
    'Úsala para «¿quiénes son la junta?», «¿quién es el presidente de mi block?», «¿hay residentes con cargo?» o «¿quién vive en la B01-403?». `junta` lista los cargos (con el departamento, para la administración y la junta); `filas` son los residentes (paginados). ' +
    'Un residente sólo recibe la junta de su(s) block(s), con cargo y nombre; la lista de vecinos no está disponible para él (si la pide, dilo). No trae correos, teléfonos ni documentos. ' +
    'Ejemplo: {"solo_junta":true} o {"estructura_id":3,"texto":"403"}.',
  entrada: z.strictObject({
    condominio_id: idPositivo.optional().describe('Filtra por condominio (id de `condominios_y_blocks`).'),
    estructura_id: idPositivo.optional().describe('Filtra por block/torre (id de `condominios_y_blocks`).'),
    solo_junta: z.boolean().default(false).describe('true = sólo la junta directiva, sin la lista de residentes.'),
    texto: textoCorto(60).optional().describe('Parte del nombre o del código del departamento.'),
    ...paginacion,
  }),
  roles: ['admin', 'superadmin', 'propietario', 'inquilino'],
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = await alcancePersonas(u);
    const p = pagina(e);
    const ci = { contains: e.texto ?? '', mode: 'insensitive' as const };
    const ubic: Prisma.UnidadWhereInput = { ...(e.condominio_id ? { complejo_id: e.condominio_id } : {}), ...(e.estructura_id ? { estructura_id: e.estructura_id } : {}) };
    const unidadFiltro: Prisma.UnidadWhereInput = { AND: [al.unidades, ubic] };

    // ---- Junta: quienes tienen cargo, por block ----
    const juntaWhere: Prisma.UsuarioWhereInput = {
      AND: [
        { rol: 'propietario', cargo_junta: { not: null } },
        al.junta,
        e.condominio_id ? { complejo_id: e.condominio_id } : {},
        e.estructura_id ? { OR: [{ estructura_id: e.estructura_id }, { estructura_id: null }] } : {},
        e.texto ? { OR: [{ nombre: ci }, ...(al.vecinos ? [{ unidades: { some: { codigo: ci } } }] : [])] } : {},
      ],
    };
    const miembros = await prisma.usuario.findMany({
      where: juntaWhere,
      take: 200,
      select: {
        id: true, nombre: true, cargo_junta: true, complejo_id: true, estructura_id: true,
        complejo: { select: { nombre: true } }, estructura: { select: { nombre: true } },
        unidades: { orderBy: { codigo: 'asc' }, take: 20, select: { codigo: true, complejo_id: true, estructura_id: true } },
      },
    });
    const junta = miembros
      .sort((a, b) =>
        (a.complejo?.nombre ?? '').localeCompare(b.complejo?.nombre ?? '', 'es', { numeric: true }) ||
        (a.estructura?.nombre ?? '').localeCompare(b.estructura?.nombre ?? '', 'es', { numeric: true }) ||
        (ORDEN_CARGO[a.cargo_junta ?? ''] ?? 9) - (ORDEN_CARGO[b.cargo_junta ?? ''] ?? 9) || a.id - b.id)
      .map((m) => {
        // Su departamento: el que tiene dentro del ámbito de su cargo (sólo se muestra a quien administra o gestiona).
        const depto = m.unidades.filter((x) => x.complejo_id === m.complejo_id && (m.estructura_id == null || x.estructura_id === m.estructura_id)).map((x) => dato(x.codigo, 30));
        return {
          cargo: m.cargo_junta,
          nombre: nombreCorto(m.nombre),
          condominio: dato(m.complejo?.nombre),
          block: m.estructura_id != null ? dato(m.estructura?.nombre) : null,
          ambito: m.estructura_id != null ? 'block' : 'junta central (todo el condominio)',
          ...(al.vecinos ? { departamento: depto.length ? depto.slice(0, 3).join(', ') : null } : {}),
        };
      });

    // ---- Residentes (sólo administración y junta que gestiona) ----
    let filas: Record<string, unknown>[] = [];
    let hay_mas = false;
    let siguiente_cursor: string | null = null;
    let total_residentes: number | null = null;
    if (al.vecinos && !e.solo_junta) {
      const where: Prisma.UsuarioWhereInput = {
        AND: [
          { rol: { in: [...ROLES_RESIDENTE] } },
          { OR: [{ unidades: { some: unidadFiltro } }, { unidadesInquilino: { some: unidadFiltro } }] },
          e.texto
            ? { OR: [{ nombre: ci }, { unidades: { some: { AND: [unidadFiltro, { codigo: ci }] } } }, { unidadesInquilino: { some: { AND: [unidadFiltro, { codigo: ci }] } } }] }
            : {},
        ],
      };
      const unidadesSel = { where: unidadFiltro, orderBy: { codigo: 'asc' as const }, take: MAX_UNIDADES_POR_PERSONA, select: { codigo: true, complejo: { select: { nombre: true } }, estructura: { select: { nombre: true } } } };
      const [residentes, total] = await Promise.all([
        prisma.usuario.findMany({
          where, orderBy: [{ nombre: 'asc' }, { id: 'asc' }], skip: p.skip, take: p.take,
          select: { id: true, nombre: true, rol: true, cargo_junta: true, estructura_id: true, estructura: { select: { nombre: true } }, unidades: unidadesSel, unidadesInquilino: unidadesSel },
        }),
        prisma.usuario.count({ where }),
      ]);
      const c = cortar(residentes, p);
      hay_mas = c.hay_mas;
      siguiente_cursor = c.siguiente_cursor;
      total_residentes = total;
      filas = c.filas.map((x) => ({
        nombre: nombreCorto(x.nombre),
        rol: x.rol,
        cargo: x.cargo_junta,
        cargo_de: x.cargo_junta ? (x.estructura_id != null ? dato(x.estructura?.nombre) : 'junta central (todo el condominio)') : null,
        departamentos: [...x.unidades, ...x.unidadesInquilino].slice(0, MAX_UNIDADES_POR_PERSONA).map((d) => ({ unidad: dato(d.codigo, 30), block: dato(d.estructura?.nombre), condominio: dato(d.complejo?.nombre) })),
      }));
    }

    return respuesta({
      alcance: TEXTO_ALCANCE[al.tipo],
      junta: junta.slice(0, MAX_JUNTA),
      total_junta: junta.length,
      hay_mas_junta: junta.length > MAX_JUNTA,
      filas,
      ...(total_residentes != null ? { total_residentes } : {}),
      hay_mas,
      siguiente_cursor,
      nota: al.vecinos
        ? junta.length === 0 && !e.solo_junta ? 'No hay miembros de junta registrados con ese filtro.' : null
        : junta.length === 0
          ? 'Tu block todavía no tiene junta registrada; consulta con la administración.'
          : 'Por privacidad, los residentes sólo ven la junta de su block (cargo y nombre); la lista de vecinos no está disponible.',
      ver_en: al.vecinos ? dondeVer(u.rol, 'residentes') : null,
    });
  },
});

export const HERRAMIENTAS_PERSONAS = [juntaYResidentes];
