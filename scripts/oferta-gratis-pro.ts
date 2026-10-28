/**
 * Oferta «Gratis con límite o Pro con todo»: deja en la base los valores nuevos de los planes (Gratis hasta 20 departamentos; Pro y
 * Administradora con mínimo de 20 departamentos cobrados; Pro, Administradora y Cortesía con los tres módulos + mora automática + reportes;
 * textos de la página de precios). No toca precios ni suscripciones: los condominios en cortesía (Los Libertadores) siguen igual.
 * Idempotente: correrlo otra vez no cambia nada. Los precios y los topes se editan después en Suscripciones › Precios.
 *
 * Uso (contra la base que corresponda; sin DATABASE_URL usa la del .env):
 *   npx tsx scripts/oferta-gratis-pro.ts --seco   # sólo muestra qué cambiaría
 *   npx tsx scripts/oferta-gratis-pro.ts          # aplica
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { PrismaClient } = await import('@prisma/client');
  const { ajustarOfertaGratisPro } = await import('../src/server/services/comercial/oferta');
  const prisma = new PrismaClient();
  try {
    const seco = process.argv.includes('--seco');
    const informe = await ajustarOfertaGratisPro(prisma, { seco });
    if (!informe.length) console.log('Nada que cambiar: los planes ya tienen la oferta Gratis con límite / Pro con todo.');
    for (const p of informe) console.log(`${seco ? '[seco] ' : ''}${p.clave}: ${p.cambios.join('; ')}`);
    if (seco) console.log('En seco: no se escribió nada.');
  } finally {
    await prisma.$disconnect();
  }
}
