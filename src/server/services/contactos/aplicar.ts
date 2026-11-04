/**
 * Guarda un `PlanContactos` dentro de la transacción del guardado. Nunca borra nada y nunca cambia un nombre:
 *  1. crea las personas nuevas (propietario sin dueño, inquilinos) con `empresa_id: null` y el condominio;
 *  2. pone el correo y el celular a las que ya existían (cada cambio revisa que la fila siga como se leyó: si otra persona la tocó mientras tanto, 409);
 *  3. asigna los departamentos (el de una persona de relleno pasa a la que ya tiene ese correo; la de relleno queda sin departamento, con su historial intacto).
 * Los avisos por correo y por WhatsApp se encienden SÓLO al agregar un correo o un celular (si alguien los apagó antes, no se le vuelven a prender).
 */
import { sincronizarUnidades } from '../personas/sincronizar';
import { celularGuardado } from '../personas/tipos';
import type { Prisma } from '@prisma/client';
import { HttpError } from '../../errors';
import type { PlanContactos, UsuarioVirtual } from './plan';

type Tx = Prisma.TransactionClient;

export const MENSAJE_CAMBIO_CONCURRENTE = 'Los datos cambiaron mientras guardabas (alguien editó a esa persona o el departamento). Vuelve a subir el archivo para revisarlo de nuevo.';
const cambioConcurrente = () => new HttpError(409, MENSAJE_CAMBIO_CONCURRENTE, undefined, 'CAMBIO_CONCURRENTE');

export interface ResultadoAplicar {
  /** Id de la base de cada persona del plan (por su `clave`), las nuevas incluidas. */
  ids: Map<string, number>;
  creados: number;
  actualizados: number;
  unidades: number;
  /** Personas del departamento (copropietario, cónyuge, familiar u otro) agregadas o completadas. */
  personas: number;
}

/** Correo de relleno libre para una persona nueva sin correo (nunca existe el buzón: `.invalid` está reservado). */
async function correoDeRelleno(tx: Tx, v: UsuarioVirtual): Promise<string> {
  const base = `u${v.unidadInicial}-${v.rol === 'inquilino' ? 'inq' : 'prop'}`;
  const candidatos = [`${base}@sin-correo.invalid`, ...Array.from({ length: 50 }, (_, i) => `${base}-${i + 2}@sin-correo.invalid`)];
  const ocupados = new Set((await tx.usuario.findMany({ where: { email: { in: candidatos } }, select: { email: true } })).map((u) => u.email.toLowerCase()));
  const libre = candidatos.find((c) => !ocupados.has(c));
  if (!libre) throw new HttpError(409, 'No se pudo crear a una persona: demasiados usuarios con el mismo correo de relleno');
  return libre;
}

export async function aplicarPlan(tx: Tx, plan: PlanContactos, ctx: { complejoId: number }): Promise<ResultadoAplicar> {
  const ids = new Map<string, number>();
  let creados = 0, actualizados = 0, unidades = 0;

  for (const v of plan.usuarios) {
    if (v.id != null) continue;
    const email = v.sinCorreo ? await correoDeRelleno(tx, v) : v.email;
    const u = await tx.usuario.create({
      data: {
        nombre: v.nombre,
        email,
        telefono: v.telefono || null,
        rol: v.rol,
        empresa_id: null,
        complejo_id: ctx.complejoId,
        aviso_email: !v.sinCorreo,
        aviso_whatsapp: !!v.telefono,
      },
      select: { id: true },
    });
    ids.set(v.clave, u.id);
    creados++;
  }

  for (const v of plan.usuarios) {
    if (v.id == null) continue;
    ids.set(v.clave, v.id);
    if (!v.correoPuesto && !v.celularPuesto) continue;
    const data: Prisma.UsuarioUpdateManyMutationInput & { complejo_id?: number } = {};
    if (v.correoPuesto) { data.email = v.email; data.aviso_email = true; }
    if (v.celularPuesto) { data.telefono = v.telefono; data.aviso_whatsapp = true; }
    if (v.complejo_id == null) data.complejo_id = ctx.complejoId;
    const r = await tx.usuario.updateMany({ where: { id: v.id, ...(v.correoPuesto ? { email: { equals: v.email0, mode: 'insensitive' as const } } : {}) }, data });
    if (r.count !== 1) throw cambioConcurrente();
    actualizados++;
  }

  for (const a of plan.asignaciones) {
    const id = a.despues.id ?? ids.get(a.despues.clave);
    if (id == null) throw new HttpError(500, 'No se pudo asignar un departamento');
    const r = await tx.unidad.updateMany({ where: { id: a.unidadId, [a.campo]: a.antes }, data: { [a.campo]: id } });
    if (r.count !== 1) throw cambioConcurrente();
    unidades++;
  }
  // «Personas del departamento»: el titular y el inquilino de cada unidad tocada (y de las personas cuyo contacto cambió) se alinean con su cuenta.
  const conCambio = plan.usuarios.filter((v) => v.id != null && (v.correoPuesto || v.celularPuesto)).map((v) => v.id!);
  const deLasCuentas = conCambio.length ? await tx.unidad.findMany({ where: { OR: [{ propietario_id: { in: conCambio } }, { inquilino_id: { in: conCambio } }] }, select: { id: true } }) : [];
  await sincronizarUnidades(tx, [...plan.asignaciones.map((x) => x.unidadId), ...deLasCuentas.map((x) => x.id)]);
  for (const v of plan.usuarios) {
    const id = v.id ?? ids.get(v.clave);
    if (id == null || (!v.correoPuesto && !v.celularPuesto)) continue;
    const correo = v.correoPuesto && !v.sinCorreo ? v.email : null;
    const celular = v.celularPuesto ? celularGuardado(v.telefono) : null;
    await tx.personaUnidad.updateMany({ where: { usuario_id: id }, data: { ...(correo ? { correo } : {}), ...(celular ? { celular } : {}) } });
  }
  // Las personas del departamento que no son propietario ni inquilino (columna `Relación`): se agregan o se completan. Antes, el titular y el inquilino de esa
  // unidad ya tienen su persona (sincronizar), así que una persona nueva nunca deja al titular fuera de los avisos.
  let personas = 0;
  if (plan.personas.length) {
    await sincronizarUnidades(tx, plan.personas.map((o) => o.unidadId));
    for (const o of plan.personas) {
      if (o.id == null) {
        await tx.personaUnidad.create({ data: { unidad_id: o.unidadId, empresa_id: o.empresaId, nombre: o.nombre, relacion: o.relacion, correo: o.correo, celular: o.celular, recibe_comunicados: false } });
      } else {
        const r = await tx.personaUnidad.updateMany({ where: { id: o.id, correo: o.correo0, celular: o.celular0 }, data: { correo: o.correo, celular: o.celular } });
        if (r.count !== 1) throw cambioConcurrente();
        // Su cuenta (si la tiene) lleva el mismo celular: es por donde le llegan los avisos.
        if (o.usuarioId != null && o.celular && o.celular !== o.celular0) await tx.usuario.update({ where: { id: o.usuarioId }, data: { telefono: o.celular, aviso_whatsapp: true } });
      }
      personas++;
    }
  }
  return { ids, creados, actualizados, unidades, personas };
}
