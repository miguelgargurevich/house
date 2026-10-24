/**
 * Crea el contrato de administración vigente de cada condominio que tiene empresa y todavía no tiene contrato (inicio = su primer
 * recibo, o hoy). Idempotente: una segunda corrida no cambia nada. También corre solo al arrancar el servidor en producción.
 *
 * Uso (lo corre el orquestador, contra la base que corresponda; sin DATABASE_URL usa la del .env):
 *   npx tsx scripts/contratos-iniciales.ts            # aplica
 *   npx tsx scripts/contratos-iniciales.ts --simular  # sólo cuenta
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { PrismaClient } = await import('@prisma/client');
  const { crearContratosIniciales } = await import('../src/server/lib/contratosIniciales');
  const prisma = new PrismaClient();
  try {
    const simular = process.argv.includes('--simular');
    const n = await crearContratosIniciales(prisma, simular);
    console.log(simular ? `Condominios sin contrato vigente (no se cambió nada): ${n}` : `Contratos de administración creados: ${n}`);
  } finally {
    await prisma.$disconnect();
  }
}
