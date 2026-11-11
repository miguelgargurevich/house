// Eliminar la propia cuenta desde Mi perfil (App Store 5.1.1(v), Google Play y Ley 29733).
//
// - Vecino, personal y administradora con OTRA administradora activa en su empresa: se elimina AL MOMENTO. Pierde el acceso (sesiones, tokens de API, contraseña,
//   invitaciones y vínculos de WhatsApp/Telegram) y sus datos personales se ANONIMIZAN en la misma fila de `Usuario` (la fila NO se borra).
// - Lo CONTABLE queda intacto: recibos, cargos, pagos, vouchers y movimientos siguen con su departamento (son los libros del condominio). Donde el historial
//   muestre a esa persona, dice «Cuenta eliminada».
// - Única administradora de su empresa: NO se elimina (dejaría el condominio sin nadie). Puede pedir el cierre de la empresa: queda una `SolicitudContacto`
//   con tema `cierre_cuenta` en la bandeja del superadmin.
// - El superadmin no se elimina por aquí.
import type { Prisma, SolicitudContacto } from '@prisma/client';
import bcrypt from 'bcrypt';
import { prisma } from '../../db';
import { HttpError, invalid } from '../../errors';
import { sincronizarUnidades } from '../personas/sincronizar';
import { avisarContacto } from '../contacto/solicitud';
import { revocarDeUsuario } from '../sesiones';

type Db = Prisma.TransactionClient | typeof prisma;

/** Lo que la persona escribe para confirmar (sin importar mayúsculas ni espacios de más). */
export const FRASE_ELIMINAR = 'ELIMINAR';
export const NOMBRE_ELIMINADA = 'Cuenta eliminada';
/** Tema de la `SolicitudContacto` que deja la única administradora al pedir el cierre de su empresa. */
export const TEMA_CIERRE = 'cierre_cuenta';
/** Correo único y no entregable (`.invalid` nunca resuelve): deja libre el correo original y nunca recibe nada. */
export const correoDeCuentaEliminada = (id: number) => `eliminada-${id}@cuenta-eliminada.invalid`;

export const MENSAJE_UNICA_ADMIN = 'Eres la única administradora de tu empresa: si eliminas tu cuenta, tu condominio se quedaría sin nadie que lo administre. Puedes pedir el cierre de tu empresa desde aquí.';
export const MENSAJE_SUPERADMIN = 'Una cuenta de superadministrador no se elimina desde aquí.';

export type ModoEliminacion = 'inmediata' | 'solicitud' | 'no_disponible';

interface Quien { id: number; rol: string | null; empresa_id: number | null }

/**
 * `inmediata`: se elimina al confirmar. `solicitud`: única administradora de su empresa (sólo puede pedir el cierre). `no_disponible`: superadmin.
 * Otra administradora «activa» = sin eliminar, con contraseña y con el correo confirmado (una invitación sin aceptar no puede hacerse cargo).
 */
export async function modoDeEliminacion(db: Db, u: Quien): Promise<ModoEliminacion> {
  if (u.rol === 'superadmin') return 'no_disponible';
  if (u.rol !== 'admin' || u.empresa_id == null) return 'inmediata';
  const otras = await db.usuario.count({ where: { empresa_id: u.empresa_id, rol: 'admin', id: { not: u.id }, eliminada_at: null, password_hash: { not: null }, correo_verificado: true } });
  return otras > 0 ? 'inmediata' : 'solicitud';
}

/** La confirmación que pide la pantalla: la frase «ELIMINAR» (si aplica) y la contraseña actual (si la cuenta tiene). 422 con el campo que falló; nada cambia. */
export async function verificarIdentidad(usuarioId: number, d: { password?: string; confirmacion?: string }, opciones: { pideFrase: boolean }): Promise<void> {
  if (opciones.pideFrase && (d.confirmacion ?? '').trim().toUpperCase() !== FRASE_ELIMINAR) {
    throw invalid(`Escribe ${FRASE_ELIMINAR} para confirmar`, { confirmacion: `Escribe ${FRASE_ELIMINAR}` });
  }
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, omit: { password_hash: false } });
  if (!u) throw new HttpError(401, 'Sesión inválida o vencida');
  if (!u.password_hash) return; // sin contraseña (no debería tener sesión): no hay qué comparar
  if (!d.password) throw invalid('Ingresa tu contraseña para confirmar', { password: 'Es obligatoria' });
  if (!(await bcrypt.compare(d.password, u.password_hash))) throw invalid('La contraseña no es correcta', { password: 'No es correcta' });
}

const bloquearEmpresa = (tx: Prisma.TransactionClient, empresaId: number) => tx.$executeRaw`SELECT pg_advisory_xact_lock(${empresaId}::int, 13::int)`;

export type ResultadoEliminar = { resultado: 'eliminada'; unidades: number[] } | { resultado: 'unica_admin' };

/**
 * Elimina la cuenta de `usuarioId`. El chequeo de «única administradora» y la eliminación van en la MISMA transacción, con la empresa bloqueada: dos
 * administradoras que se eliminan a la vez no pueden dejarla sin ninguna.
 */
export async function eliminarCuenta(usuarioId: number): Promise<ResultadoEliminar> {
  const r = await prisma.$transaction(async (tx) => {
    const previo = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { empresa_id: true } });
    if (previo?.empresa_id != null) await bloquearEmpresa(tx, previo.empresa_id);
    const u = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, rol: true, empresa_id: true, eliminada_at: true } });
    if (!u || u.eliminada_at) throw new HttpError(401, 'Sesión inválida o vencida');
    const modo = await modoDeEliminacion(tx, u);
    if (modo === 'no_disponible') throw new HttpError(403, MENSAJE_SUPERADMIN);
    if (modo === 'solicitud') return { resultado: 'unica_admin' } as const;

    // Sus departamentos: la unidad deja de apuntar a una cuenta que ya no existe (la administración asigna a quien corresponda; el correo queda libre para invitar).
    const unidades = (await tx.unidad.findMany({ where: { OR: [{ propietario_id: u.id }, { inquilino_id: u.id }] }, select: { id: true } })).map((x) => x.id);
    const deFichas = (await tx.personaUnidad.findMany({ where: { usuario_id: u.id }, select: { unidad_id: true } })).map((x) => x.unidad_id);
    const afectadas = [...new Set([...unidades, ...deFichas])].sort((a, b) => a - b);
    await tx.unidad.updateMany({ where: { propietario_id: u.id }, data: { propietario_id: null } });
    await tx.unidad.updateMany({ where: { inquilino_id: u.id }, data: { inquilino_id: null } });
    await tx.personaUnidad.deleteMany({ where: { usuario_id: u.id } }); // su ficha de «Personas del departamento» (nombre, correo y celular suyos)
    await sincronizarUnidades(tx, afectadas); // deja UN responsable de pago por departamento
    await tx.miembroJunta.deleteMany({ where: { usuario_id: u.id, junta: { hasta: null } } }); // sale de la junta vigente; las gestiones pasadas conservan su nombre «Cuenta eliminada»

    // Acceso y avisos.
    await tx.tokenApi.deleteMany({ where: { usuario_id: u.id } });
    await tx.canalVinculado.deleteMany({ where: { usuario_id: u.id } }); // WhatsApp y Telegram propios (sus pendientes caen en cascada)
    await tx.codigoVinculacion.deleteMany({ where: { usuario_id: u.id } });
    await tx.tokenInvitacion.deleteMany({ where: { usuario_id: u.id } });
    await tx.tokenVerificacionCorreo.deleteMany({ where: { usuario_id: u.id } });
    await tx.invitacionEnCola.deleteMany({ where: { usuario_id: u.id } });
    await tx.notificacion.deleteMany({ where: { usuario_id: u.id } }); // su bandeja de avisos (asunto y cuerpo llevan su nombre)
    await tx.conversacionIA.deleteMany({ where: { usuario_id: u.id } }); // sus conversaciones con el asistente (sus mensajes caen en cascada)

    await tx.usuario.update({
      where: { id: u.id },
      data: {
        nombre: NOMBRE_ELIMINADA, email: correoDeCuentaEliminada(u.id), telefono: null, password_hash: null,
        aviso_email: false, aviso_whatsapp: false, cargo_junta: null, estructura_id: null, eliminada_at: new Date(),
      },
    });
    return { resultado: 'eliminada', unidades: afectadas } as const;
  }, { timeout: 30_000 });

  if (r.resultado === 'eliminada') {
    // Ya confirmada: se cierran sus sesiones (y las «Entrar como» sobre ella) y se borran sus filas (llevan IP y navegador). `authenticate` además rechaza
    // toda cuenta con `eliminada_at`, así que ni una caída justo aquí deja una sesión viva.
    await revocarDeUsuario(usuarioId);
    await prisma.sesion.deleteMany({ where: { usuario_id: usuarioId } });
  }
  return r;
}

export interface Solicitud { fila: SolicitudContacto; ya_existia: boolean }

/** Solicitud de cierre pendiente de esta cuenta (la misma administradora no apila varias). */
export const solicitudPendiente = (db: Db, correo: string) => db.solicitudContacto.findFirst({ where: { tema: TEMA_CIERRE, correo, estado: 'nueva' }, orderBy: { id: 'desc' } });

/**
 * La única administradora pide el cierre de su empresa: queda en Superadmin › Contactos y se avisa a Torre por correo. Pedirlo dos veces no duplica.
 * 409 si ya no es la única (entonces puede eliminar su cuenta ella misma).
 */
export async function solicitarCierre(usuarioId: number, origen: { ip: string | null; user_agent: string | null }): Promise<Solicitud> {
  const r = await prisma.$transaction(async (tx) => {
    const previo = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { empresa_id: true } });
    if (previo?.empresa_id != null) await bloquearEmpresa(tx, previo.empresa_id);
    const u = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, nombre: true, email: true, telefono: true, rol: true, empresa_id: true, eliminada_at: true, empresa: { select: { id: true, nombre: true } } } });
    if (!u || u.eliminada_at) throw new HttpError(401, 'Sesión inválida o vencida');
    const modo = await modoDeEliminacion(tx, u);
    if (modo === 'no_disponible') throw new HttpError(403, MENSAJE_SUPERADMIN);
    if (modo !== 'solicitud') throw new HttpError(409, 'Tu empresa tiene otra administradora activa: puedes eliminar tu propia cuenta desde aquí.', undefined, 'HAY_OTRA_ADMIN');
    const existente = await solicitudPendiente(tx, u.email);
    if (existente) return { fila: existente, ya_existia: true };
    const empresa = u.empresa?.nombre ?? 'sin nombre';
    const fila = await tx.solicitudContacto.create({
      data: {
        nombre: u.nombre.slice(0, 120), correo: u.email, celular: u.telefono, condominio: empresa.slice(0, 120), tema: TEMA_CIERRE,
        ip: origen.ip?.slice(0, 64) ?? null, user_agent: origen.user_agent?.slice(0, 300) ?? null,
        mensaje: [
          `La única administradora de la empresa «${empresa}» (empresa n.º ${u.empresa_id}, cuenta n.º ${u.id}) pide el cierre de su empresa desde Mi perfil.`,
          'Corresponde atenderlo según los Términos: entregar una copia de sus datos y eliminarlos o anonimizarlos a los 90 días, salvo lo que la ley obligue a conservar.',
        ].join('\n'),
      },
    });
    return { fila, ya_existia: false };
  });
  if (!r.ya_existia) return { fila: await avisarContacto(r.fila), ya_existia: false };
  return r;
}
