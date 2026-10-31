// Registro público: crea EN UNA TRANSACCIÓN la empresa, su administrador y el primer condominio (plan Gratis). El correo se verifica
// con un enlace de un solo uso (sólo se guarda su hash, vence a las 24 h) antes de poder entrar. La respuesta es la misma exista o no el correo.
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { BCRYPT_COST } from '../../config';
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import { abrirContrato } from '../../lib/contratos';
import { registrarAuditoria } from '../../middleware/audit';
import { comercialDeps } from './modulos';
import { finDePrueba } from './estado';
import { plazoGratisNuevo } from './plazoGratis';
import { correoA, enlace, enmascarar, obtenerConfiguracion } from './configuracion';
import { VERSION_LEGAL } from './legal';

export const HORAS_ENLACE = 24;
export const MENSAJE_ENLACE_INVALIDO = 'El enlace no es válido o ya venció. Pide uno nuevo desde el inicio de sesión.';
/** Misma respuesta exista o no el correo: no se puede usar el registro para averiguar quién tiene cuenta. */
export const MENSAJE_REGISTRO = 'Listo. Si el correo es válido, te enviamos un enlace para confirmarlo. Revisa tu bandeja (y la carpeta de spam); vence en 24 horas.';

export interface DatosRegistro {
  nombre: string;
  email: string;
  celular: string;
  password: string;
  empresa: string;
  condominio: string;
  unidades: number;
}

const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
const nuevoToken = () => randomBytes(32).toString('base64url');

async function crearToken(tx: Prisma.TransactionClient | typeof prisma, usuarioId: number): Promise<string> {
  const token = nuevoToken();
  await tx.tokenVerificacionCorreo.create({ data: { usuario_id: usuarioId, token_hash: hashToken(token), expira_at: new Date(comercialDeps.ahora().getTime() + HORAS_ENLACE * 3_600_000) } });
  return token;
}

async function enviarVerificacion(email: string, nombre: string, token: string): Promise<void> {
  const cfg = await obtenerConfiguracion();
  const link = enlace(cfg, `/verificar-correo?token=${encodeURIComponent(token)}`);
  await correoA(email, 'Confirma tu correo en House', `Hola ${nombre},\n\nPara activar tu cuenta de House confirma tu correo con este enlace (vence en ${HORAS_ENLACE} horas y sirve una sola vez):\n\n${link}\n\nSi no te registraste tú, ignora este mensaje.`);
}

async function avisarAlSuperadmin(asunto: string, cuerpo: string): Promise<void> {
  const cfg = await obtenerConfiguracion();
  if (cfg.correo_superadmin) await correoA(cfg.correo_superadmin, asunto, cuerpo).catch(() => undefined);
}

/** Alta de una cuenta nueva. Valida el cierre del registro; el resto de reglas (campos, contraseña) las aplica el esquema de la ruta. */
export async function registrarCuenta(d: DatosRegistro, ip: string | null): Promise<void> {
  const cfg = await obtenerConfiguracion();
  if (!cfg.registro_abierto) throw new HttpError(503, 'El registro está cerrado por ahora. Escríbenos y te ayudamos.');
  // El hash se calcula siempre (exista o no el correo) para que el tiempo de respuesta no delate si la cuenta existe.
  const password_hash = await bcrypt.hash(d.password, BCRYPT_COST);
  const existente = await prisma.usuario.findUnique({ where: { email: d.email }, select: { id: true, nombre: true, correo_verificado: true } });
  if (existente) return void (await avisarCorreoExistente(d.email, existente));

  let creado: { usuarioId: number; empresaId: number; complejoId: number; token: string };
  try {
    creado = await prisma.$transaction(async (tx) => {
      const empresa = await tx.empresaAdministradora.create({ data: { nombre: d.empresa, email: d.email, telefono: d.celular } });
      const usuario = await tx.usuario.create({ data: { nombre: d.nombre, email: d.email, telefono: d.celular, rol: 'admin', password_hash, empresa_id: empresa.id, correo_verificado: false, terminos_version: VERSION_LEGAL, terminos_aceptados_at: comercialDeps.ahora() }, select: { id: true } });
      const complejo = await tx.complejoHabitacional.create({ data: { nombre: d.condominio, tipo: 'condominio', empresa_id: empresa.id } });
      await abrirContrato(tx, complejo.id, empresa.id);
      // Prueba de Pro (reverse trial): el condominio nace en Pro por `dias_prueba_pro` días; con 0 nace en Gratis, como antes.
      const prueba = cfg.dias_prueba_pro > 0;
      // Gratis tiene plazo (`dias_gratis`, 90 por defecto) y la prueba de Pro va DENTRO de él: Pro los primeros días, Gratis hasta el final, luego solo lectura.
      const plazo = plazoGratisNuevo(cfg, comercialDeps.ahora());
      await tx.suscripcionCondominio.create({
        data: prueba
          ? { complejo_id: complejo.id, plan_clave: 'pro', estado: 'activa', es_prueba: true, vigente_hasta: finDePrueba(cfg.dias_prueba_pro, comercialDeps.ahora()), ...plazo, notas: `Registro público: ~${d.unidades} departamentos. Prueba de Pro de ${cfg.dias_prueba_pro} días.` }
          : { complejo_id: complejo.id, plan_clave: 'gratis', estado: 'gratis', ...plazo, notas: `Registro público: ~${d.unidades} departamentos` },
      });
      const token = await crearToken(tx, usuario.id);
      return { usuarioId: usuario.id, empresaId: empresa.id, complejoId: complejo.id, token };
    });
  } catch (err) {
    // Dos registros simultáneos con el mismo correo: el segundo cae aquí y se trata igual que un correo ya registrado.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const otro = await prisma.usuario.findUnique({ where: { email: d.email }, select: { id: true, nombre: true, correo_verificado: true } });
      if (otro) return void (await avisarCorreoExistente(d.email, otro));
    }
    throw err;
  }
  await registrarAuditoria({ usuario_id: creado.usuarioId, accion: 'registro_publico', entidad: 'usuario', entidad_id: creado.usuarioId, detalle: { empresa_id: creado.empresaId, complejo_id: creado.complejoId, correo: enmascarar(d.email), unidades: d.unidades }, ip });
  await enviarVerificacion(d.email, d.nombre, creado.token).catch(() => undefined);
  const plan = cfg.dias_prueba_pro > 0 ? `Pro de prueba (${cfg.dias_prueba_pro} días)` : 'Gratis';
  await avisarAlSuperadmin('Nuevo registro en House', `Se registró ${d.nombre} (${enmascarar(d.email)}, ${d.celular}).\nAdministradora o junta: ${d.empresa}\nCondominio: ${d.condominio} (~${d.unidades} departamentos)\nPlan: ${plan}. Correo aún por verificar.`);
}

async function avisarCorreoExistente(email: string, u: { id: number; nombre: string; correo_verificado: boolean }): Promise<void> {
  if (!u.correo_verificado) {
    // Registró antes y no confirmó: se le manda un enlace nuevo (sin crear nada más).
    await enviarVerificacion(email, u.nombre, await crearToken(prisma, u.id)).catch(() => undefined);
    return;
  }
  await correoA(email, 'Ya tienes una cuenta en House', `Hola ${u.nombre},\n\nAlguien intentó registrar este correo en House, pero ya tiene una cuenta. Si fuiste tú, entra con tu contraseña desde el inicio de sesión.\n\nSi no fuiste tú, no hagas nada: tu cuenta sigue segura.`).catch(() => undefined);
}

/** Pide otro enlace de verificación. Responde igual exista o no la cuenta; sólo reenvía si existe y sigue sin verificar (con 60 s entre envíos). */
export async function reenviarVerificacion(email: string): Promise<void> {
  const u = await prisma.usuario.findUnique({ where: { email }, select: { id: true, nombre: true, correo_verificado: true } });
  if (!u || u.correo_verificado) return;
  const reciente = await prisma.tokenVerificacionCorreo.findFirst({ where: { usuario_id: u.id, created_at: { gt: new Date(comercialDeps.ahora().getTime() - 60_000) } }, select: { id: true } });
  if (reciente) return;
  await enviarVerificacion(email, u.nombre, await crearToken(prisma, u.id)).catch(() => undefined);
}

/** Confirma el correo con el token del enlace. Un solo uso (UPDATE atómico), vigente 24 h. Cualquier fallo → el mismo 400. */
export async function verificarCorreo(token: string, ip: string | null): Promise<void> {
  const ahora = comercialDeps.ahora();
  const fila = await prisma.tokenVerificacionCorreo.findUnique({ where: { token_hash: hashToken(token) }, select: { id: true, usuario_id: true, expira_at: true, usado_at: true } });
  if (!fila || fila.usado_at || fila.expira_at <= ahora) throw new HttpError(400, MENSAJE_ENLACE_INVALIDO, undefined, 'ENLACE_INVALIDO');
  const ok = await prisma.$transaction(async (tx) => {
    const r = await tx.tokenVerificacionCorreo.updateMany({ where: { id: fila.id, usado_at: null, expira_at: { gt: ahora } }, data: { usado_at: ahora } });
    if (r.count !== 1) return false; // otro clic lo usó primero
    await tx.usuario.update({ where: { id: fila.usuario_id }, data: { correo_verificado: true }, select: { id: true } });
    return true;
  });
  if (!ok) throw new HttpError(400, MENSAJE_ENLACE_INVALIDO, undefined, 'ENLACE_INVALIDO');
  await registrarAuditoria({ usuario_id: fila.usuario_id, accion: 'verificar_correo', entidad: 'usuario', entidad_id: fila.usuario_id, ip });
}
