/**
 * Personas de un departamento: listar, agregar, editar, quitar, encender o apagar el acceso a Torre y elegir al responsable de pago.
 * Todo cambio de una unidad corre en una transacción con el candado de ESA unidad (`bloquearUnidad`): dos cambios a la vez no dejan dos responsables.
 * Nunca guarda ni registra correos o celulares fuera de la propia fila (la auditoría sólo lleva ids y cantidades).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { HttpError, conflict, notFound } from '../../errors';
import { comercialDeps } from '../comercial/modulos';
import { encolarInvitaciones } from '../contactos/cola';
import { correoSinBuzon } from '../invitaciones';
import { revocarDeUsuario } from '../sesiones';
import { unidadesDeUsuario } from '../../lib/scope';
import { buscarOCrearCuenta, cuentaVinculable, MENSAJE_CUENTA_AJENA, MENSAJE_OTRA_PERSONA, type ContextoCondominio } from './cuentas';
import { asegurarResponsable, bloquearUnidad, sincronizarUnidad } from './sincronizar';
import { campoDeUnidad, celularGuardado, correoReal, empresaDeUnidad, esPrincipal, rolDeRelacion, type Relacion } from './tipos';
import { mismaPersona } from '../contactos/plan';

type Tx = Prisma.TransactionClient;

export type EstadoAcceso = 'sin_cuenta' | 'apagado' | 'sin_correo' | 'sin_invitar' | 'en_cola' | 'invitado' | 'entro';

export interface PersonaDto {
  id: number;
  unidad_id: number;
  nombre: string;
  relacion: Relacion;
  correo: string | null;
  celular: string | null;
  responsable_pago: boolean;
  recibe_comunicados: boolean;
  acceso_activo: boolean;
  tiene_cuenta: boolean;
  estado_acceso: EstadoAcceso;
  /** Es el titular o el inquilino principal que sigue `Unidad.propietario_id` / `inquilino_id`. */
  principal: boolean;
}

const msg = {
  principalRepetido: (r: string) => `Ya hay ${r === 'propietario' ? 'un propietario' : 'un inquilino'} en este departamento. Usa Copropietario, Cónyuge, Familiar u Otro`,
  quitarResponsable: 'Es la persona que recibe el aviso de cobro: elige antes a otra persona como responsable de pago',
  quitarTitular: 'Es el titular del departamento: elige antes otro titular (Unidades › Editar o «Hacer titular» en otra persona)',
  sinContactoPaga: 'Agrega un correo o un celular para que le lleguen los avisos de cobro',
  sinCorreoAcceso: 'Agrega un correo para darle acceso a Torre',
  dejarResponsable: 'Para cambiar al responsable de pago, marca a la otra persona: el departamento siempre tiene uno',
  correoDelAcceso: 'Ese correo es el de su acceso a Torre: apaga el acceso antes de cambiarlo',
};

interface PersonaFila {
  id: number; unidad_id: number; empresa_id: number | null; nombre: string; relacion: string; correo: string | null; celular: string | null;
  responsable_pago: boolean; recibe_comunicados: boolean; usuario_id: number | null; acceso_activo: boolean;
}

/** Lo que se sabe de una unidad para operar sobre sus personas. */
interface UnidadCtx {
  id: number;
  codigo: string;
  propietario_id: number | null;
  inquilino_id: number | null;
  ctx: ContextoCondominio;
  empresa: number | null;
}

async function cargarUnidad(tx: Tx, unidadId: number): Promise<UnidadCtx> {
  const u = await tx.unidad.findUnique({ where: { id: unidadId }, select: { id: true, codigo: true, propietario_id: true, inquilino_id: true, complejo_id: true, empresa_id: true, complejo: { select: { empresa_id: true } } } });
  if (!u || u.complejo_id == null) throw notFound('Unidad');
  const empresa = empresaDeUnidad(u);
  return { id: u.id, codigo: u.codigo, propietario_id: u.propietario_id, inquilino_id: u.inquilino_id, ctx: { complejoId: u.complejo_id, empresaId: empresa }, empresa };
}

const esTitularVigente = (p: { relacion: string; usuario_id: number | null }, u: UnidadCtx) =>
  esPrincipal(p.relacion) && p.usuario_id != null && u[campoDeUnidad(p.relacion)] === p.usuario_id;

// ---------- Lectura ----------
export async function listarPersonas(unidadId: number): Promise<PersonaDto[]> {
  let unidad = await prisma.unidad.findUnique({ where: { id: unidadId }, select: { propietario_id: true, inquilino_id: true, _count: { select: { personas: true } } } });
  if (!unidad) return [];
  // Un departamento con propietario o inquilino y todavía sin personas (la migración corre al arrancar el servidor) se alinea al abrirlo.
  if (unidad._count.personas === 0 && (unidad.propietario_id != null || unidad.inquilino_id != null)) {
    await prisma.$transaction((tx) => sincronizarUnidad(tx, unidadId));
    unidad = await prisma.unidad.findUnique({ where: { id: unidadId }, select: { propietario_id: true, inquilino_id: true, _count: { select: { personas: true } } } });
    if (!unidad) return [];
  }
  const filas = (await prisma.personaUnidad.findMany({ where: { unidad_id: unidadId }, orderBy: { id: 'asc' } })) as PersonaFila[];
  const ids = [...new Set(filas.flatMap((p) => (p.usuario_id == null ? [] : [p.usuario_id])))];
  const [usuarios, enCola, invitados] = await Promise.all([
    ids.length ? prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, password_hash: true } }) : [],
    ids.length ? prisma.invitacionEnCola.findMany({ where: { usuario_id: { in: ids }, enviada_at: null, descartada_at: null }, select: { usuario_id: true } }) : [],
    ids.length ? prisma.tokenInvitacion.findMany({ where: { usuario_id: { in: ids } }, select: { usuario_id: true } }) : [],
  ]);
  const porId = new Map(usuarios.map((u) => [u.id, u]));
  const colaSet = new Set(enCola.map((x) => x.usuario_id));
  const invSet = new Set(invitados.map((x) => x.usuario_id));
  const orden = (p: PersonaFila) => (p.relacion === 'propietario' ? 0 : p.relacion === 'inquilino' ? 1 : 2);
  return filas
    .sort((a, b) => orden(a) - orden(b) || a.id - b.id)
    .map((p) => {
      const us = p.usuario_id != null ? porId.get(p.usuario_id) : undefined;
      let estado: EstadoAcceso;
      if (!us) estado = 'sin_cuenta';
      else if (!p.acceso_activo) estado = 'apagado';
      else if (us.password_hash) estado = 'entro';
      else if (correoSinBuzon(us.email)) estado = 'sin_correo';
      else if (colaSet.has(us.id)) estado = 'en_cola';
      else if (invSet.has(us.id)) estado = 'invitado';
      else estado = 'sin_invitar';
      return {
        id: p.id, unidad_id: p.unidad_id, nombre: p.nombre, relacion: p.relacion as Relacion, correo: p.correo, celular: p.celular,
        responsable_pago: p.responsable_pago, recibe_comunicados: p.recibe_comunicados, acceso_activo: !!us && p.acceso_activo,
        tiene_cuenta: !!us, estado_acceso: estado,
        principal: esPrincipal(p.relacion) && p.usuario_id != null && unidad[campoDeUnidad(p.relacion)] === p.usuario_id,
      };
    });
}

// ---------- Escritura ----------
export interface DatosPersona {
  nombre: string;
  relacion: Relacion;
  correo?: string | null;
  celular?: string | null;
  responsable_pago?: boolean;
  recibe_comunicados?: boolean;
}

/** Las cuentas que dejaron de tener acceso en ESTA operación (para cerrar sus sesiones al terminar). */
export interface Efecto { sinAcceso: number[]; invitacionesEncoladas: number }

/** Si la persona no tiene ninguna unidad con acceso, se le cierran sesiones, tokens, vínculos de canal e invitaciones. Se llama DESPUÉS de confirmar la transacción. */
export async function cerrarAccesosSinUnidad(usuarioIds: Iterable<number>): Promise<number> {
  let cerradas = 0;
  for (const id of new Set(usuarioIds)) {
    if ((await prisma.unidad.count({ where: unidadesDeUsuario(id) })) > 0) continue;
    const ahora = comercialDeps.ahora();
    await revocarDeUsuario(id);
    await prisma.tokenApi.updateMany({ where: { usuario_id: id, revocado_at: null }, data: { revocado_at: ahora } });
    await prisma.canalVinculado.updateMany({ where: { usuario_id: id, revocado_at: null }, data: { revocado_at: ahora } });
    await prisma.invitacionEnCola.updateMany({ where: { usuario_id: id, enviada_at: null, descartada_at: null }, data: { descartada_at: ahora, motivo: 'acceso_apagado' } });
    await prisma.tokenInvitacion.updateMany({ where: { usuario_id: id, usado_at: null, expira_at: { gt: ahora } }, data: { expira_at: ahora } });
    cerradas++;
  }
  return cerradas;
}

export const MENSAJE_ACCESO_DESACTIVADO = 'Tu acceso a Torre está desactivado. Habla con tu administración.';

/**
 * ¿La administración le apagó el acceso? Sólo un residente con alguna ficha de persona en la que el acceso está apagado y que ya no tiene NINGÚN departamento con acceso.
 * Un residente que nunca estuvo en «Personas del departamento» no entra en esta regla (entra como siempre).
 */
export async function accesoDesactivado(usuarioId: number, rol: string | null): Promise<boolean> {
  if (rol !== 'propietario' && rol !== 'inquilino') return false;
  if ((await prisma.personaUnidad.count({ where: { usuario_id: usuarioId, acceso_activo: false } })) === 0) return false;
  return (await prisma.unidad.count({ where: unidadesDeUsuario(usuarioId) })) === 0;
}

/** Normaliza y valida correo y celular del cuerpo (ya pasaron por zod): correo en minúsculas sin relleno; celular con formato internacional. */
function limpiarContacto(d: { correo?: string | null; celular?: string | null }) {
  return {
    correo: d.correo === undefined ? undefined : correoReal(d.correo),
    celular: d.celular === undefined ? undefined : celularGuardado(d.celular),
  };
}

async function bloquearYCargar(tx: Tx, unidadId: number) {
  await bloquearUnidad(tx, unidadId);
  // Antes de tocar nada, el titular y el inquilino de la unidad ya están en la lista (una persona nueva nunca los deja fuera de los avisos).
  await sincronizarUnidad(tx, unidadId);
  return cargarUnidad(tx, unidadId);
}

/** Pasa la marca de responsable a esa persona (y se la quita a la anterior). Pide un contacto: correo, celular o cuenta. */
async function fijarResponsable(tx: Tx, unidad: UnidadCtx, persona: PersonaFila): Promise<void> {
  const p = await tx.personaUnidad.findUniqueOrThrow({ where: { id: persona.id } });
  if (!p.correo && !p.celular && p.usuario_id == null) throw new HttpError(400, msg.sinContactoPaga);
  await tx.personaUnidad.updateMany({ where: { unidad_id: unidad.id, responsable_pago: true, id: { not: p.id } }, data: { responsable_pago: false } });
  if (!p.responsable_pago) await tx.personaUnidad.update({ where: { id: p.id }, data: { responsable_pago: true } });
}

/**
 * Le da cuenta a la persona (ficha, sin acceso) si necesita recibir avisos (responsable de pago o comunicados) y tiene un correo real o un celular.
 * Una persona de relación propietario/inquilino con cuenta pasa a ser el titular/inquilino de la unidad si ese lugar está libre.
 */
async function asegurarFicha(tx: Tx, unidad: UnidadCtx, personaId: number): Promise<void> {
  const p = await tx.personaUnidad.findUniqueOrThrow({ where: { id: personaId } });
  if (p.usuario_id != null || (!p.correo && !p.celular)) return;
  const cuenta = await buscarOCrearCuenta(tx, { id: p.id, nombre: p.nombre, relacion: p.relacion, correo: p.correo, celular: p.celular, unidad_id: p.unidad_id }, unidad.ctx);
  await vincularCuenta(tx, unidad, p, cuenta.id);
}

async function vincularCuenta(tx: Tx, unidad: UnidadCtx, p: PersonaFila, usuarioId: number): Promise<void> {
  const q = await tx.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { rol: true } });
  if (esPrincipal(p.relacion)) {
    // El titular y el inquilino principal son cuentas de ese rol (una cuenta de propietario no pasa a ser el inquilino del departamento).
    if (q.rol !== rolDeRelacion(p.relacion)) throw new HttpError(409, `Esa cuenta es de ${q.rol === 'inquilino' ? 'un inquilino' : 'un propietario'}: usa la relación Familiar u Otro`, undefined, 'ROL_DISTINTO');
    const campo = campoDeUnidad(p.relacion);
    const actual = unidad[campo];
    if (actual != null && actual !== usuarioId) throw new HttpError(409, 'Este departamento ya tiene otra cuenta como ' + (p.relacion === 'propietario' ? 'titular' : 'inquilino') + ': cámbiala en Unidades');
    if (actual == null) { await tx.unidad.update({ where: { id: unidad.id }, data: { [campo]: usuarioId } }); unidad[campo] = usuarioId; }
  }
  await tx.personaUnidad.update({ where: { id: p.id }, data: { usuario_id: usuarioId } });
}

export async function agregarPersona(unidadId: number, d: DatosPersona): Promise<{ persona: PersonaDto; efecto: Efecto }> {
  const { correo, celular } = limpiarContacto(d);
  const id = await prisma.$transaction(async (tx) => {
    const unidad = await bloquearYCargar(tx, unidadId);
    if (esPrincipal(d.relacion) && (await tx.personaUnidad.count({ where: { unidad_id: unidadId, relacion: d.relacion } })) > 0) throw conflict(msg.principalRepetido(d.relacion));
    const creada = await tx.personaUnidad.create({
      data: {
        unidad_id: unidadId, empresa_id: unidad.empresa, nombre: d.nombre, relacion: d.relacion, correo: correo ?? null, celular: celular ?? null,
        // Los comunicados les llegan a quien lo pida; sin pedirlo, sólo a los titulares (como hoy).
        recibe_comunicados: d.recibe_comunicados ?? esPrincipal(d.relacion),
      },
    });
    if (creada.recibe_comunicados || d.responsable_pago) await asegurarFicha(tx, unidad, creada.id);
    if (d.responsable_pago) await fijarResponsable(tx, unidad, creada as PersonaFila);
    await asegurarResponsable(tx, unidadId);
    return creada.id;
  });
  const persona = (await listarPersonas(unidadId)).find((p) => p.id === id)!;
  return { persona, efecto: { sinAcceso: [], invitacionesEncoladas: 0 } };
}

export interface CambiosPersona {
  nombre?: string;
  relacion?: Relacion;
  correo?: string | null;
  celular?: string | null;
  responsable_pago?: boolean;
  recibe_comunicados?: boolean;
}

export async function editarPersona(unidadId: number, personaId: number, d: CambiosPersona): Promise<{ persona: PersonaDto; efecto: Efecto }> {
  const { correo, celular } = limpiarContacto(d);
  await prisma.$transaction(async (tx) => {
    const unidad = await bloquearYCargar(tx, unidadId);
    const p = await tx.personaUnidad.findFirst({ where: { id: personaId, unidad_id: unidadId } });
    if (!p) throw notFound('Persona');
    const data: Prisma.PersonaUnidadUpdateInput = {};
    const titular = esTitularVigente(p, unidad);

    if (d.relacion !== undefined && d.relacion !== p.relacion) {
      if (titular) throw conflict('Es el titular del departamento: para cambiar quién es, usa «Hacer titular» en otra persona');
      if (esPrincipal(d.relacion) && (await tx.personaUnidad.count({ where: { unidad_id: unidadId, relacion: d.relacion, id: { not: p.id } } })) > 0) throw conflict(msg.principalRepetido(d.relacion));
      if (esPrincipal(d.relacion) && p.usuario_id != null) throw conflict('Esta persona ya tiene cuenta: no puede pasar a ser titular o inquilino por aquí. Usa «Hacer titular»');
      data.relacion = d.relacion;
    }
    if (d.nombre !== undefined && d.nombre !== p.nombre) {
      // Con cuenta, el nombre es el de la cuenta (la ficha y la cuenta no pueden decir cosas distintas): sólo lo cambia quien tiene la cuenta.
      if (p.usuario_id != null) throw conflict('Esta persona ya tiene cuenta: su nombre se cambia en Usuarios');
      data.nombre = d.nombre;
    }
    if (correo !== undefined && correo !== p.correo) {
      if (p.usuario_id != null) {
        const us = await tx.usuario.findUniqueOrThrow({ where: { id: p.usuario_id }, select: { email: true, password_hash: true } });
        if (p.acceso_activo || us.password_hash) { if (correoReal(us.email) !== correo) throw conflict(msg.correoDelAcceso); }
        else if (correo) {
          // Ficha sin acceso: su cuenta cambia de correo si ese correo está libre; si ya es de otra cuenta, no se mezclan.
          const otra = await tx.usuario.findFirst({ where: { email: { equals: correo, mode: 'insensitive' }, id: { not: p.usuario_id } }, select: { id: true } });
          if (otra) throw conflict('Ese correo ya está en uso por otra cuenta');
          await tx.usuario.update({ where: { id: p.usuario_id }, data: { email: correo, aviso_email: true } });
        } else await tx.usuario.update({ where: { id: p.usuario_id }, data: { email: `u${p.unidad_id}-p${p.id}@sin-correo.invalid`, aviso_email: false } });
      }
      data.correo = correo;
    }
    if (celular !== undefined && celular !== p.celular) {
      if (p.usuario_id != null) await tx.usuario.update({ where: { id: p.usuario_id }, data: { telefono: celular, ...(celular ? { aviso_whatsapp: true } : {}) } });
      data.celular = celular;
    }
    if (d.recibe_comunicados !== undefined) data.recibe_comunicados = d.recibe_comunicados;
    if (Object.keys(data).length) await tx.personaUnidad.update({ where: { id: p.id }, data });

    if (d.responsable_pago === false && p.responsable_pago) throw conflict(msg.dejarResponsable);
    if (d.recibe_comunicados || d.responsable_pago) await asegurarFicha(tx, unidad, p.id);
    if (d.responsable_pago === true) await fijarResponsable(tx, unidad, p as PersonaFila);
    await asegurarResponsable(tx, unidadId);
  });
  return { persona: (await listarPersonas(unidadId)).find((p) => p.id === personaId)!, efecto: { sinAcceso: [], invitacionesEncoladas: 0 } };
}

export async function quitarPersona(unidadId: number, personaId: number): Promise<Efecto> {
  const usuarioId = await prisma.$transaction(async (tx) => {
    const unidad = await bloquearYCargar(tx, unidadId);
    const p = await tx.personaUnidad.findFirst({ where: { id: personaId, unidad_id: unidadId } });
    if (!p) throw notFound('Persona');
    if (esTitularVigente(p, unidad)) throw conflict(msg.quitarTitular);
    if (p.responsable_pago) throw conflict(msg.quitarResponsable);
    await tx.personaUnidad.delete({ where: { id: p.id } });
    // Era el inquilino principal sin ser titular de nadie más: no hay ficha de unidad que soltar (sólo el titular y el inquilino vigentes la tienen).
    return p.usuario_id;
  });
  const sinAcceso = usuarioId != null && (await cerrarAccesosSinUnidad([usuarioId])) > 0 ? [usuarioId] : [];
  return { sinAcceso, invitacionesEncoladas: 0 };
}

/** Enciende el acceso a Torre de la persona: busca o crea su cuenta (sin contraseña) y deja su invitación en la cola. 400 sin correo; 409 con cuenta ajena. */
export async function encenderAcceso(unidadId: number, personaId: number, porUsuarioId: number | null): Promise<{ persona: PersonaDto; efecto: Efecto }> {
  const ahora = comercialDeps.ahora();
  const encoladas = await prisma.$transaction(async (tx) => {
    const unidad = await bloquearYCargar(tx, unidadId);
    const p = await tx.personaUnidad.findFirst({ where: { id: personaId, unidad_id: unidadId } });
    if (!p) throw notFound('Persona');
    let usuarioId = p.usuario_id;
    if (usuarioId != null) {
      const us = await tx.usuario.findUniqueOrThrow({ where: { id: usuarioId }, select: { id: true, nombre: true, email: true, rol: true, empresa_id: true, complejo_id: true } });
      // Una cuenta que ya tenía la persona se vuelve a comprobar: si hoy es de personal u otra empresa, no se enciende.
      if (!(await cuentaVinculable(tx, us, unidad.ctx))) throw new HttpError(409, MENSAJE_CUENTA_AJENA, undefined, 'CUENTA_AJENA');
      if (correoSinBuzon(us.email)) {
        // Ficha con correo de relleno: ahora hay un correo real en la persona.
        if (!p.correo) throw new HttpError(400, msg.sinCorreoAcceso);
        const otra = await tx.usuario.findFirst({ where: { email: { equals: p.correo, mode: 'insensitive' }, id: { not: us.id } }, select: { id: true, nombre: true, email: true, rol: true, empresa_id: true, complejo_id: true } });
        if (otra) {
          if (!(await cuentaVinculable(tx, otra, unidad.ctx))) throw new HttpError(409, MENSAJE_CUENTA_AJENA, undefined, 'CUENTA_AJENA');
          if (!mismaPersona(p.nombre, otra.nombre)) throw new HttpError(409, MENSAJE_OTRA_PERSONA, undefined, 'OTRA_PERSONA');
          usuarioId = otra.id;
        } else await tx.usuario.update({ where: { id: us.id }, data: { email: p.correo, aviso_email: true } });
      }
    } else {
      if (!p.correo) throw new HttpError(400, msg.sinCorreoAcceso);
      usuarioId = (await buscarOCrearCuenta(tx, { id: p.id, nombre: p.nombre, relacion: p.relacion, correo: p.correo, celular: p.celular, unidad_id: p.unidad_id }, unidad.ctx)).id;
    }
    await vincularCuenta(tx, unidad, p as PersonaFila, usuarioId!);
    await tx.personaUnidad.update({ where: { id: p.id }, data: { acceso_activo: true } });
    // Su invitación sale con las demás, en tandas (sólo si la cuenta no tiene contraseña ni una invitación vigente o en cola).
    const r = await encolarInvitaciones(tx, { complejoId: unidad.ctx.complejoId, ids: [usuarioId!], porUsuarioId, ahora });
    return r.encoladas;
  });
  return { persona: (await listarPersonas(unidadId)).find((p) => p.id === personaId)!, efecto: { sinAcceso: [], invitacionesEncoladas: encoladas } };
}

/** Apaga el acceso: la persona se queda en la lista. Si la cuenta ya no tiene NINGÚN departamento con acceso, se le cierran sesiones, tokens e invitaciones. */
export async function apagarAcceso(unidadId: number, personaId: number): Promise<{ persona: PersonaDto; efecto: Efecto }> {
  const usuarioId = await prisma.$transaction(async (tx) => {
    await bloquearYCargar(tx, unidadId);
    const p = await tx.personaUnidad.findFirst({ where: { id: personaId, unidad_id: unidadId } });
    if (!p) throw notFound('Persona');
    if (p.usuario_id == null) throw new HttpError(400, 'Esta persona no tiene cuenta en Torre');
    await tx.personaUnidad.update({ where: { id: p.id }, data: { acceso_activo: false } });
    return p.usuario_id;
  });
  const sinAcceso = (await cerrarAccesosSinUnidad([usuarioId])) > 0 ? [usuarioId] : [];
  return { persona: (await listarPersonas(unidadId)).find((p) => p.id === personaId)!, efecto: { sinAcceso, invitacionesEncoladas: 0 } };
}

/**
 * «Hacer titular»: la persona (con cuenta) pasa a ser el titular (o el inquilino principal) del departamento y quien lo era queda como copropietario
 * (u «otro», en el caso del inquilino). Así se puede quitar al anterior sin dejar el departamento sin titular. La marca de responsable de pago no se mueve.
 */
export async function hacerPrincipal(unidadId: number, personaId: number): Promise<PersonaDto> {
  await prisma.$transaction(async (tx) => {
    const unidad = await bloquearYCargar(tx, unidadId);
    const p = await tx.personaUnidad.findFirst({ where: { id: personaId, unidad_id: unidadId } });
    if (!p) throw notFound('Persona');
    if (p.usuario_id == null) throw new HttpError(400, 'Para hacerla titular primero dale una cuenta (enciende «Tiene usuario en Torre»)');
    const rel: 'propietario' | 'inquilino' = p.relacion === 'inquilino' ? 'inquilino' : 'propietario';
    const us = await tx.usuario.findUniqueOrThrow({ where: { id: p.usuario_id }, select: { rol: true } });
    if (us.rol !== rolDeRelacion(rel)) throw conflict(`Esa cuenta es de ${us.rol === 'inquilino' ? 'un inquilino' : 'un propietario'}: no puede ser ${rel === 'propietario' ? 'titular' : 'inquilino principal'}`);
    const anterior = await tx.personaUnidad.findFirst({ where: { unidad_id: unidadId, relacion: rel, id: { not: p.id } } });
    if (anterior) await tx.personaUnidad.update({ where: { id: anterior.id }, data: { relacion: rel === 'propietario' ? 'copropietario' : 'otro' } });
    await tx.personaUnidad.update({ where: { id: p.id }, data: { relacion: rel } });
    await tx.unidad.update({ where: { id: unidad.id }, data: { [campoDeUnidad(rel)]: p.usuario_id } });
    await asegurarResponsable(tx, unidadId);
  });
  return (await listarPersonas(unidadId)).find((p) => p.id === personaId)!;
}
