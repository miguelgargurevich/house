// Paso 2 del registro: la administradora que ya tiene cuenta (paso 1) crea su PRIMER condominio. Una sola transacción: renombra su empresa
// (nació con el nombre de la persona), crea el condominio, su contrato de administración y su suscripción (prueba de Torre Pro dentro del plazo de Gratis).
// Sólo si la empresa no tiene condominios: con uno ya, 409. La regla de la suscripción inicial vive en `crearCondominioInicial` (una sola vez).
import type { ConfiguracionComercial, Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { conflict } from '../../errors';
import { abrirContrato } from '../../lib/contratos';
import type { AuthUser } from '../../middleware/auth';
import { empresaDe } from '../../lib/scope';
import { enmascarar, obtenerConfiguracion } from './configuracion';
import { finDePrueba } from './estado';
import { comercialDeps } from './modulos';
import { plazoGratisNuevo } from './plazoGratis';
import { avisarAlSuperadmin } from './registro';

export const MENSAJE_YA_TIENE_CONDOMINIO = 'Tu administradora ya tiene un condominio. Para agregar otro, ve a Condominios.';

export interface DatosPrimerCondominio {
  /** Nombre de la administradora o junta (reemplaza al provisional). */
  empresa: string;
  condominio: string;
  /** Aproximado: sólo se anota; no limita nada (Torre Gratis no tiene tope de departamentos). */
  unidades: number;
}

/**
 * Crea el condominio de una empresa con su contrato y su suscripción inicial. Es la regla comercial del alta por registro: con `dias_prueba_pro` > 0 nace en
 * Torre Pro de prueba; con 0, en Gratis. En ambos casos lleva el plazo de Gratis (`dias_gratis`): la prueba va DENTRO de ese plazo y al vencer, solo lectura.
 */
export async function crearCondominioInicial(
  tx: Prisma.TransactionClient,
  cfg: Pick<ConfiguracionComercial, 'dias_prueba_pro' | 'dias_gratis'>,
  d: { empresaId: number; condominio: string; unidades: number },
): Promise<{ complejoId: number }> {
  const complejo = await tx.complejoHabitacional.create({ data: { nombre: d.condominio, tipo: 'condominio', empresa_id: d.empresaId } });
  await abrirContrato(tx, complejo.id, d.empresaId);
  const ahora = comercialDeps.ahora();
  const prueba = cfg.dias_prueba_pro > 0;
  const plazo = plazoGratisNuevo(cfg, ahora);
  await tx.suscripcionCondominio.create({
    data: prueba
      ? { complejo_id: complejo.id, plan_clave: 'pro', estado: 'activa', es_prueba: true, vigente_hasta: finDePrueba(cfg.dias_prueba_pro, ahora), ...plazo, notas: `Registro público: ~${d.unidades} departamentos. Prueba de Torre Pro de ${cfg.dias_prueba_pro} días.` }
      : { complejo_id: complejo.id, plan_clave: 'gratis', estado: 'gratis', ...plazo, notas: `Registro público: ~${d.unidades} departamentos` },
  });
  return { complejoId: complejo.id };
}

/** Paso 2 del registro, para la administradora que llama (su propia empresa, nunca otra). */
export async function crearPrimerCondominio(user: AuthUser, d: DatosPrimerCondominio): Promise<{ complejoId: number; empresaId: number }> {
  const empresaId = empresaDe(user);
  const cfg = await obtenerConfiguracion();
  const complejoId = await prisma.$transaction(async (tx) => {
    // Bloquea la fila de la empresa: dos envíos a la vez (doble clic, dos pestañas) se turnan y el segundo ve el condominio del primero.
    await tx.$queryRaw`SELECT id FROM "EmpresaAdministradora" WHERE id = ${empresaId} FOR UPDATE`;
    if ((await tx.complejoHabitacional.count({ where: { empresa_id: empresaId } })) > 0) throw conflict(MENSAJE_YA_TIENE_CONDOMINIO);
    await tx.empresaAdministradora.update({ where: { id: empresaId }, data: { nombre: d.empresa }, select: { id: true } });
    return (await crearCondominioInicial(tx, cfg, { empresaId, condominio: d.condominio, unidades: d.unidades })).complejoId;
  });
  const plan = cfg.dias_prueba_pro > 0 ? `Torre Pro de prueba (${cfg.dias_prueba_pro} días)` : 'Torre Gratis';
  const persona = await prisma.usuario.findUnique({ where: { id: user.id }, select: { nombre: true, email: true, telefono: true } });
  await avisarAlSuperadmin('Nuevo condominio en Torre', `${persona?.nombre ?? 'Una administradora'} (${enmascarar(persona?.email ?? user.email)}${persona?.telefono ? `, ${persona.telefono}` : ''}) creó su primer condominio.\nAdministradora o junta: ${d.empresa}\nCondominio: ${d.condominio} (~${d.unidades} departamentos)\nPlan: ${plan}.`);
  return { complejoId, empresaId };
}
