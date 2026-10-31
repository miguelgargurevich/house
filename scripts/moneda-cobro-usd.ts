/**
 * Moneda de cobro de la suscripción a House: Perú en soles y TODOS los demás países en dólares (US$), al tipo de cambio (precio en soles ÷ tipo de
 * cambio). Pone `ImpuestoPais.moneda` de cada país como la regla nueva; el impuesto (IVA, etc.) de cada país no se toca. Lo ya emitido tampoco: los
 * pagos de suscripción conservan su moneda y su monto (sólo se informa cuántos hay en otra moneda).
 * Idempotente: correrlo otra vez no cambia nada.
 *
 * Uso (contra la base que corresponda; sin DATABASE_URL usa la del .env):
 *   npx tsx scripts/moneda-cobro-usd.ts --seco   # sólo muestra qué cambiaría
 *   npx tsx scripts/moneda-cobro-usd.ts          # aplica
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { PrismaClient } = await import('@prisma/client');
  const { ajustarMonedaDeCobro } = await import('../src/server/services/comercial/monedaCobro');
  const prisma = new PrismaClient();
  try {
    const seco = process.argv.includes('--seco');
    const { cambios, pagos_en_otra_moneda: pagos } = await ajustarMonedaDeCobro(prisma, { seco });
    if (!cambios.length) console.log('Nada que cambiar: todos los países ya cobran en su moneda de cobro (Perú en soles, el resto en dólares).');
    for (const c of cambios) console.log(`${seco ? '[seco] ' : ''}${c.pais}: ${c.de} → ${c.a}`);
    for (const p of pagos) console.log(`Aviso: ${p.cantidad} pago(s) de suscripción ya registrados en ${p.moneda} (no se tocan).`);
    if (seco) console.log('En seco: no se escribió nada.');
  } finally {
    await prisma.$disconnect();
  }
}
