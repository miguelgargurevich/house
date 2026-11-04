/**
 * Invitaciones en tandas. La carga de contactos NO manda las invitaciones: las deja en `InvitacionEnCola` y la tarea diaria (enganchada al planificador de
 * avisos, cada 15 min) manda como máximo `ConfiguracionComercial.invitaciones_por_dia` por DÍA DE LIMA, en el orden en que se pidieron. El plan de
 * Resend limita los correos por día: mandar 448 de golpe rebotaría casi todos.
 *
 * Nunca se invita: a un correo de relleno (`.invalid`), a quien ya tiene contraseña, a quien ya tiene una invitación vigente, ni a quien ya está en cola.
 * Todo se vuelve a comprobar al momento de enviar (la cola puede esperar días).
 */
import { Prisma } from '@prisma/client';
import { ROLES_RESIDENTE } from '../../config';
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import { diaEn } from '../../lib/fechas';
import { ZONA_POR_DEFECTO } from '../../../lib/paises';
import { obtenerConfiguracion } from '../comercial/configuracion';
import { comercialDeps } from '../comercial/modulos';
import { invitarUsuario } from '../invitaciones';

type Tx = Prisma.TransactionClient;

/** A la tercera vez que el proveedor rechaza esa dirección (400, 404 o 422), se saca de la cola. */
export const MAX_INTENTOS = 3;
const DIA_MS = 86_400_000;

export const ZONA_INVITACIONES = ZONA_POR_DEFECTO;

/** Quiénes se pueden invitar en un condominio: residentes de sus unidades, con correo real, sin contraseña, sin invitación vigente y sin estar en cola. */
function candidatos(complejoId: number, ahora: Date, estructuraId?: number | null, ids?: number[], correoYaGuardado = true): Prisma.UsuarioWhereInput {
  const unidad: Prisma.UnidadWhereInput = { complejo_id: complejoId, ...(estructuraId != null ? { estructura_id: estructuraId } : {}) };
  return {
    ...(ids ? { id: { in: ids } } : {}),
    rol: { in: [...ROLES_RESIDENTE] },
    password_hash: null,
    // Con correo de relleno nunca (`.invalid`). La vista previa todavía no guardó el correo nuevo: ahí se pregunta por todo lo demás.
    ...(correoYaGuardado ? { NOT: { email: { endsWith: '.invalid', mode: 'insensitive' } } } : {}),
    // Quien tiene el acceso apagado en su ficha de persona (titular o inquilino principal) no se invita; las demás personas, sólo con el acceso encendido.
    OR: [
      { unidades: { some: { ...unidad, personas: { none: { relacion: 'propietario', acceso_activo: false } } } } },
      { unidadesInquilino: { some: { ...unidad, personas: { none: { relacion: 'inquilino', acceso_activo: false } } } } },
      { personasUnidad: { some: { unidad, acceso_activo: true } } },
    ],
    invitaciones: { none: { usado_at: null, expira_at: { gt: ahora } } },
    invitacionesEnCola: { none: { enviada_at: null, descartada_at: null } },
  };
}

/** Cuántos vecinos se podrían invitar hoy en un condominio (o en un block). */
export async function contarPendientes(db: Tx | typeof prisma, complejoId: number, ahora: Date, estructuraId?: number | null): Promise<number> {
  return db.usuario.count({ where: candidatos(complejoId, ahora, estructuraId) });
}

/** De estos ids, cuántos se podrían invitar (para la vista previa de la carga: su correo nuevo aún no está guardado, así que no se mira el de la base). */
export async function contarInvitables(db: Tx | typeof prisma, complejoId: number, ids: number[], ahora: Date): Promise<number> {
  return ids.length ? db.usuario.count({ where: candidatos(complejoId, ahora, null, ids, false) }) : 0;
}

export interface ResultadoEncolar {
  encoladas: number;
}

/** Clave del candado por condominio para encolar (la 1 es de las estructuras y las del periodo valen ≥ 200001): dos clics a la vez no duplican la cola. */
const CANDADO_COLA = 4;

/** Deja en cola las invitaciones de los vecinos que se pueden invitar (todos los del condominio/block, o sólo los `ids`). Dentro de una transacción. */
export async function encolarInvitaciones(tx: Tx, p: { complejoId: number; estructuraId?: number | null; ids?: number[]; porUsuarioId: number | null; ahora: Date }): Promise<ResultadoEncolar> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${p.complejoId}::int, ${CANDADO_COLA}::int)`;
  const usuarios = await tx.usuario.findMany({ where: candidatos(p.complejoId, p.ahora, p.estructuraId, p.ids), select: { id: true }, orderBy: { id: 'asc' } });
  if (!usuarios.length) return { encoladas: 0 };
  await tx.invitacionEnCola.createMany({ data: usuarios.map((u) => ({ usuario_id: u.id, complejo_id: p.complejoId, creado_por_id: p.porUsuarioId, created_at: p.ahora })) });
  return { encoladas: usuarios.length };
}

export interface EstadoCola {
  enviadas: number;
  en_cola: number;
  /** Vecinos con correo real que todavía no están en cola ni invitados. */
  por_encolar: number;
  por_dia: number;
  enviadas_hoy: number;
  /** Días con envíos que faltan para vaciar la cola (0 = nada en cola). */
  dias: number;
}

/** Días con envíos que hacen falta para sacar `enCola` invitaciones con un cupo de `cupoHoy` hoy y `porDia` cada día siguiente. */
export function diasParaVaciar(enCola: number, cupoHoy: number, porDia: number): number {
  if (enCola <= 0) return 0;
  const hoy = Math.min(enCola, Math.max(0, cupoHoy));
  const resto = enCola - hoy;
  return (hoy > 0 ? 1 : 0) + Math.ceil(resto / Math.max(1, porDia));
}

async function enviadasHoy(ahora: Date): Promise<number> {
  const hoy = diaEn(ahora, ZONA_INVITACIONES);
  const filas = await prisma.invitacionEnCola.findMany({ where: { enviada_at: { gte: new Date(ahora.getTime() - 2 * DIA_MS), lte: new Date(ahora.getTime() + DIA_MS) } }, select: { enviada_at: true } });
  return filas.filter((f) => f.enviada_at && diaEn(f.enviada_at, ZONA_INVITACIONES) === hoy).length;
}

/** «X enviadas, Y en cola (salen en N días)» de un condominio. El cupo diario es de toda la plataforma (el límite es del correo), no del condominio. */
export async function estadoDeLaCola(complejoId: number, ahora: Date = comercialDeps.ahora()): Promise<EstadoCola> {
  const [cfg, hoy, enviadas, suyas, porEncolar] = await Promise.all([
    obtenerConfiguracion(),
    enviadasHoy(ahora),
    prisma.invitacionEnCola.count({ where: { complejo_id: complejoId, enviada_at: { not: null } } }),
    prisma.invitacionEnCola.findMany({ where: { complejo_id: complejoId, enviada_at: null, descartada_at: null }, select: { id: true }, orderBy: { id: 'desc' }, take: 1 }),
    contarPendientes(prisma, complejoId, ahora),
  ]);
  const enCola = await prisma.invitacionEnCola.count({ where: { complejo_id: complejoId, enviada_at: null, descartada_at: null } });
  // Las de otros condominios que están antes en la cola también ocupan cupo: se cuentan hasta la última de ESTE condominio.
  const delante = suyas[0] ? await prisma.invitacionEnCola.count({ where: { enviada_at: null, descartada_at: null, id: { lte: suyas[0].id } } }) : 0;
  const porDia = cfg.invitaciones_por_dia;
  return { enviadas, en_cola: enCola, por_encolar: porEncolar, por_dia: porDia, enviadas_hoy: hoy, dias: diasParaVaciar(delante, porDia - hoy, porDia) };
}

export interface ResultadoTanda {
  enviadas: number;
  descartadas: number;
  /** Quedan en cola (en toda la plataforma) después de la tanda. */
  en_cola: number;
  /** La tanda se cortó antes del tope porque el correo falló (canal caído, tope del proveedor). */
  cortada: boolean;
}

/** Errores de la dirección (no del canal): el proveedor la rechazó. Los demás (sin configurar, sin conexión, 401/403/429/5xx) cortan la tanda y se reintenta en el siguiente ciclo. */
const RECHAZO_DE_LA_DIRECCION = /respondió (400|404|422)\b/;

/**
 * Una tanda: manda las invitaciones que faltan hasta el tope de HOY (día de Lima). Se puede llamar en cada ciclo del planificador: con el tope ya cubierto no
 * hace nada. `ahora` y el reloj de `invitarUsuario` son el mismo (`comercialDeps.ahora`), así las pruebas simulan días sin esperar.
 */
export async function procesarInvitaciones(opts: { ahora?: Date } = {}): Promise<ResultadoTanda> {
  const ahora = opts.ahora ?? comercialDeps.ahora();
  const cfg = await obtenerConfiguracion();
  const cupo = cfg.invitaciones_por_dia - (await enviadasHoy(ahora));
  const r: ResultadoTanda = { enviadas: 0, descartadas: 0, en_cola: 0, cortada: false };
  if (cupo > 0) {
    const descartar = async (id: number, motivo: string) => { await prisma.invitacionEnCola.update({ where: { id }, data: { descartada_at: ahora, motivo } }); r.descartadas++; };
    // Se leen de a poco (los descartados no gastan cupo, así que puede hacer falta más de una página).
    let despuesDe = 0;
    pasada: while (r.enviadas < cupo) {
      const lote = await prisma.invitacionEnCola.findMany({ where: { enviada_at: null, descartada_at: null, id: { gt: despuesDe } }, orderBy: { id: 'asc' }, take: Math.max(50, cupo - r.enviadas) });
      if (!lote.length) break;
      for (const fila of lote) {
        despuesDe = fila.id;
        if (r.enviadas >= cupo) break pasada;
        const u = await prisma.usuario.findUnique({ where: { id: fila.usuario_id }, select: { id: true, email: true, rol: true, password_hash: true } });
        if (!u) { await descartar(fila.id, 'sin_correo'); continue; }
        if (u.password_hash != null) { await descartar(fila.id, 'ya_tiene_acceso'); continue; }
        if (!(ROLES_RESIDENTE as readonly string[]).includes(u.rol ?? '')) { await descartar(fila.id, 'no_residente'); continue; }
        if (/\.invalid$/i.test(u.email.trim())) { await descartar(fila.id, 'sin_correo'); continue; }
        const vigente = await prisma.tokenInvitacion.findFirst({ where: { usuario_id: u.id, usado_at: null, expira_at: { gt: ahora } }, select: { id: true } });
        if (vigente) { await descartar(fila.id, 'ya_invitada'); continue; }
        let estado: Awaited<ReturnType<typeof invitarUsuario>>;
        try {
          estado = await invitarUsuario(u.id, fila.creado_por_id);
        } catch (err) {
          if (err instanceof HttpError && err.status === 409) { await descartar(fila.id, 'ya_tiene_acceso'); continue; }
          if (err instanceof HttpError && err.status === 429) continue; // se le acaba de mandar una: queda para el siguiente ciclo
          throw err;
        }
        if (estado.estado === 'enviada') {
          await prisma.invitacionEnCola.update({ where: { id: fila.id }, data: { enviada_at: ahora } });
          r.enviadas++;
        } else if (estado.estado === 'sin_correo') {
          await descartar(fila.id, 'sin_correo');
        } else if (RECHAZO_DE_LA_DIRECCION.test(estado.motivo)) {
          const intentos = fila.intentos + 1;
          if (intentos >= MAX_INTENTOS) await descartar(fila.id, 'fallo');
          else await prisma.invitacionEnCola.update({ where: { id: fila.id }, data: { intentos } });
        } else {
          r.cortada = true;
          break pasada;
        }
      }
    }
  }
  r.en_cola = await prisma.invitacionEnCola.count({ where: { enviada_at: null, descartada_at: null } });
  return r;
}
