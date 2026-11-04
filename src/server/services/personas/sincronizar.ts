/**
 * Mantiene `PersonaUnidad` alineada con `Unidad.propietario_id` / `inquilino_id` y garantiza UN solo responsable de pago por departamento.
 *
 * `sincronizarUnidad` es idempotente y se llama dentro de la transacción de cada cambio «viejo» del titular o del inquilino (Unidades, Usuarios, carga de
 * contactos, Excel de blocks nuevos). `migrarPersonas` la corre sobre los departamentos que todavía no tienen personas (al arrancar el servidor):
 * correrla dos veces no duplica nada. Nunca toca pagos, recibos ni cargos.
 *
 * Responsable de pago por defecto = el mismo criterio de siempre (`quienPaga`): el inquilino si hay, si no el propietario.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { campoDeUnidad, celularGuardado, correoReal, empresaDeUnidad } from './tipos';

type Tx = Prisma.TransactionClient;

/** Candado por departamento: dos cambios a la vez sobre las personas de una misma unidad se esperan (así nunca quedan dos responsables). */
export async function bloquearUnidad(tx: Tx, unidadId: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${unidadId}::int, 7::int)`;
}

/**
 * Deja exactamente UN responsable de pago si hay personas: si ya hay varias (no debería), queda la primera; si no hay ninguna, la regla de siempre
 * (inquilino principal; si no, propietario titular). `preferida`: a quién se le da la marca (cambiarla mueve la marca).
 */
export async function asegurarResponsable(tx: Tx, unidadId: number, preferida?: number): Promise<void> {
  const personas = await tx.personaUnidad.findMany({ where: { unidad_id: unidadId }, select: { id: true, relacion: true, responsable_pago: true }, orderBy: { id: 'asc' } });
  if (!personas.length) return;
  let elegida: number | undefined;
  if (preferida != null && personas.some((p) => p.id === preferida)) elegida = preferida;
  else elegida = personas.find((p) => p.responsable_pago)?.id ?? personas.find((p) => p.relacion === 'inquilino')?.id ?? personas.find((p) => p.relacion === 'propietario')?.id;
  const sobran = personas.filter((p) => p.responsable_pago && p.id !== elegida).map((p) => p.id);
  if (sobran.length) await tx.personaUnidad.updateMany({ where: { id: { in: sobran } }, data: { responsable_pago: false } });
  if (elegida != null && !personas.find((p) => p.id === elegida)!.responsable_pago) await tx.personaUnidad.update({ where: { id: elegida }, data: { responsable_pago: true } });
}

/** Alinea las personas de UNA unidad con su titular e inquilino principal. Devuelve cuántas personas creó, relinkeó o borró. */
export async function sincronizarUnidad(tx: Tx, unidadId: number): Promise<number> {
  await bloquearUnidad(tx, unidadId);
  const u = await tx.unidad.findUnique({
    where: { id: unidadId },
    select: { id: true, propietario_id: true, inquilino_id: true, empresa_id: true, complejo: { select: { empresa_id: true } }, personas: { orderBy: { id: 'asc' } } },
  });
  if (!u) return 0;
  const empresa = empresaDeUnidad(u);
  let cambios = 0;
  // La unidad pasó a otra administradora (otro condominio): todas sus personas la siguen.
  if (empresa != null && u.personas.some((p) => p.empresa_id !== empresa)) await tx.personaUnidad.updateMany({ where: { unidad_id: u.id, NOT: { empresa_id: empresa } }, data: { empresa_id: empresa } });
  let inquilinoNuevo = false;
  for (const relacion of ['propietario', 'inquilino'] as const) {
    const usuarioId = u[campoDeUnidad(relacion)];
    const actual = u.personas.find((p) => p.relacion === relacion);
    if (usuarioId == null) {
      // Se fue (la unidad ya no lo tiene): la persona de esa cuenta sale; una persona sin cuenta (sólo nombre) se queda.
      if (actual?.usuario_id != null) { await tx.personaUnidad.delete({ where: { id: actual.id } }); cambios++; }
      continue;
    }
    const us = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { nombre: true, email: true, telefono: true } });
    if (!us) continue;
    const correo = correoReal(us.email);
    const celular = celularGuardado(us.telefono);
    if (!actual) {
      await tx.personaUnidad.create({ data: { unidad_id: u.id, empresa_id: empresa, nombre: us.nombre, relacion, correo, celular, usuario_id: usuarioId, acceso_activo: true, recibe_comunicados: true } });
      cambios++;
      if (relacion === 'inquilino') inquilinoNuevo = true;
    } else if (actual.usuario_id !== usuarioId) {
      // Otra persona ocupa el lugar: la ficha pasa a ser de ella (la marca de responsable y la de comunicados son del lugar, no de la persona).
      await tx.personaUnidad.update({ where: { id: actual.id }, data: { nombre: us.nombre, correo, celular, usuario_id: usuarioId, acceso_activo: true, empresa_id: empresa } });
      cambios++;
      if (relacion === 'inquilino') inquilinoNuevo = true;
    } else {
      // La misma persona: sólo se refresca lo que cambió en su cuenta (sin vaciar nunca un dato).
      const data: Prisma.PersonaUnidadUpdateInput = {};
      if (us.nombre !== actual.nombre) data.nombre = us.nombre;
      if (correo && correo !== actual.correo) data.correo = correo;
      if (celular && celular !== actual.celular) data.celular = celular;
      if (actual.empresa_id !== empresa) data.empresa_id = empresa;
      if (Object.keys(data).length) { await tx.personaUnidad.update({ where: { id: actual.id }, data }); cambios++; }
    }
  }
  // Un inquilino que llega se queda con el aviso de cobro (como `quienPaga` de siempre) si lo tenía el propietario titular.
  if (inquilinoNuevo) {
    const ahora = await tx.personaUnidad.findMany({ where: { unidad_id: u.id }, select: { id: true, relacion: true, responsable_pago: true } });
    const inq = ahora.find((p) => p.relacion === 'inquilino');
    const titularPaga = ahora.find((p) => p.relacion === 'propietario' && p.responsable_pago);
    if (inq && titularPaga) await asegurarResponsable(tx, u.id, inq.id);
  }
  await asegurarResponsable(tx, u.id);
  return cambios;
}

/** Sincroniza varias unidades (sin repetir). */
export async function sincronizarUnidades(tx: Tx, ids: Iterable<number | null | undefined>): Promise<number> {
  let n = 0;
  for (const id of new Set([...ids].filter((x): x is number => x != null))) n += await sincronizarUnidad(tx, id);
  return n;
}

export interface ResultadoMigracion { unidades: number; cambios: number }

/**
 * Migración idempotente: cada unidad con propietario o inquilino y SIN personas genera las suyas (propietario con su cuenta y, si hay, inquilino con la suya),
 * con acceso como lo tienen hoy (siguen entrando igual), recibiendo comunicados, y el responsable de pago de siempre. Por tandas: no carga la memoria.
 * Corre al arrancar el servidor (`src/server.ts`); sólo mira unidades sin personas, así que volver a correrla no cambia nada.
 */
export async function migrarPersonas(opts: { lote?: number } = {}): Promise<ResultadoMigracion> {
  const lote = opts.lote ?? 200;
  let unidades = 0;
  let cambios = 0;
  let desde = 0;
  for (;;) {
    const ids = await prisma.unidad.findMany({
      where: { id: { gt: desde }, personas: { none: {} }, OR: [{ propietario_id: { not: null } }, { inquilino_id: { not: null } }] },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: lote,
    });
    if (!ids.length) break;
    await prisma.$transaction(async (tx) => {
      for (const { id } of ids) { cambios += await sincronizarUnidad(tx, id); unidades++; }
    }, { timeout: 60_000 });
    desde = ids[ids.length - 1]!.id;
  }
  return { unidades, cambios };
}

