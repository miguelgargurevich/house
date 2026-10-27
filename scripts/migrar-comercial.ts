/**
 * Capa comercial: deja los condominios que YA existen (y no tienen suscripción) en el plan «cortesía» con todos los módulos y sin vencimiento,
 * para que producción se comporte igual que antes de los planes. Idempotente: sólo toca a los que no tienen fila de suscripción.
 * También corre solo, UNA vez, al arrancar el servidor (queda anotado en ConfiguracionComercial.migracion_cortesia_at).
 *
 * Uso (contra la base que corresponda; sin DATABASE_URL usa la del .env):
 *   npx tsx scripts/migrar-comercial.ts --seco   # sólo cuenta, no escribe nada
 *   npx tsx scripts/migrar-comercial.ts          # aplica
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { PrismaClient } = await import('@prisma/client');
  const { sembrarCatalogoComercial } = await import('../src/server/services/comercial/catalogo');
  const { migrarACortesia } = await import('../src/server/services/comercial/migracion');
  const prisma = new PrismaClient();
  try {
    const seco = process.argv.includes('--seco');
    if (!seco) await sembrarCatalogoComercial(prisma);
    const r = await migrarACortesia(prisma, { seco });
    console.log(seco
      ? `En seco (no se escribió nada): ${r.sinSuscripcion} condominio(s) sin suscripción pasarían a cortesía; ${r.yaTenian} ya tienen suscripción.`
      : `Condominios dejados en cortesía: ${r.creadas} (ya tenían suscripción: ${r.yaTenian}).`);
  } finally {
    await prisma.$disconnect();
  }
}
