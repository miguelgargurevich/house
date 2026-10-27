/**
 * Convierte el proveedor FIJO `dashboardia` en el gateway propio «Dashboard IA»: permite su dominio, crea el `GatewayIA` y pasa sus claves
 * (`proveedor = 'dashboardia'`) a `proveedor = 'gateway'` re-cifrándolas, sin perder la key ni su estado. Idempotente: repetirlo no cambia nada.
 * Imprime un informe; nunca una clave.
 *
 * Uso (en producción, dentro del contenedor de la app; el entorno trae LLAVERO_ENC_KEY y la base real):
 *   npx tsx scripts/migrar-gateway-dashboardia.ts --seco   # sólo cuenta lo que haría, no escribe
 *   npx tsx scripts/migrar-gateway-dashboardia.ts          # lo aplica
 */
import { prisma } from '../src/server/db';
import { migrarDashboardia } from '../src/server/lib/gatewaysMigracion';

void (async () => {
  try {
    const informe = await migrarDashboardia({ seco: process.argv.includes('--seco') });
    console.log(JSON.stringify(informe, null, 2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : 'error');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
