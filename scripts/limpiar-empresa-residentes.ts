/**
 * Pone `empresa_id = null` a los propietarios e inquilinos: la empresa es del PERSONAL (admin, mantenimiento, seguridad);
 * la de un residente es la del condominio de sus unidades. Idempotente (una segunda corrida no cambia nada) y no toca al personal.
 *
 * Uso (lo corre el orquestador, contra la base que corresponda; sin DATABASE_URL usa la del .env):
 *   npx tsx scripts/limpiar-empresa-residentes.ts            # aplica
 *   npx tsx scripts/limpiar-empresa-residentes.ts --simular  # sólo cuenta
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';

const RESIDENTES = ['propietario', 'inquilino'];

/** Devuelve cuántos residentes tenían empresa (y, si no es simulacro, se quedan sin ella). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function limpiarEmpresaResidentes(prisma: Pick<PrismaClient<any, any, any>, 'usuario'>, simular = false): Promise<number> {
  const donde = { rol: { in: RESIDENTES }, empresa_id: { not: null } };
  if (simular) return prisma.usuario.count({ where: donde });
  return (await prisma.usuario.updateMany({ where: donde, data: { empresa_id: null } })).count;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const simular = process.argv.includes('--simular');
    const n = await limpiarEmpresaResidentes(prisma, simular);
    console.log(simular ? `Residentes con empresa (no se cambió nada): ${n}` : `Residentes sin empresa a partir de ahora: ${n} actualizados`);
  } finally {
    await prisma.$disconnect();
  }
}
