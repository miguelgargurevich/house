import { migrarPersonas } from './server/services/personas/sincronizar';
import { app } from './server/app';
import { iniciarLimpieza } from './server/services/sesiones';
import { iniciarPlanificador, planificadorActivo } from './server/services/avisos';
import { iniciarTareasAsistente } from './server/services/asistente/planificador';
import { prisma } from './server/db';
import { crearContratosIniciales } from './server/lib/contratosIniciales';
import { migrarOcrDesdeEnv } from './server/lib/gatewaysDatos';
import { sembrarCatalogoComercial } from './server/services/comercial/catalogo';
import { migracionInicial } from './server/services/comercial/migracion';
import { iniciarTipoCambio } from './server/services/comercial/tipoCambio';

const PORT = Number(process.env.PORT) || 4000;
iniciarLimpieza();
// Migración idempotente: cada condominio con empresa y sin contrato recibe su contrato de administración vigente (por defecto sólo en producción).
if ((process.env.CONTRATOS_INICIALES ?? (process.env.NODE_ENV === 'production' ? 'on' : 'off')) === 'on') {
  crearContratosIniciales(prisma).then((n) => n && console.log(`[contratos] contratos de administración creados: ${n}`)).catch((e) => console.error('[contratos] no se pudieron crear los contratos iniciales', e instanceof Error ? e.message : 'error'));
}
// Migración ÚNICA del OCR: OCR_BASE_URL / OCR_API_KEY pasan a la base (Llavero › «OCR de comprobantes») y el código deja de leerlas.
migrarOcrDesdeEnv()
  .then((r) => { if (r !== 'ya_configurado' && r !== 'sin_variable') console.log(`[ocr] migración desde variables de entorno: ${r}`); })
  .catch((e) => console.error('[ocr] no se pudo migrar la configuración del OCR', e instanceof Error ? e.message : 'error'));
// Capa comercial: crea los planes, módulos y la configuración que falten (sin pisar lo editado) y, UNA sola vez, deja los condominios que ya existen
// en «cortesía» con todos los módulos: producción se comporta igual que antes. Idempotente; en seco: `npx tsx scripts/migrar-comercial.ts --seco`.
sembrarCatalogoComercial(prisma)
  .then(() => migracionInicial(prisma))
  .then((r) => { if (r.aplicada) console.log(`[comercial] condominios existentes dejados en cortesía: ${r.creadas}`); })
  .catch((e) => console.error('[comercial] no se pudo preparar el catálogo comercial', e instanceof Error ? e.message : 'error'));
// Migración idempotente de «Personas del departamento»: cada unidad con propietario o inquilino y sin personas genera las suyas (con el acceso que ya tienen y el
// responsable de pago de siempre). Sólo mira unidades sin personas: volver a arrancar no cambia nada. Nunca toca pagos ni recibos.
migrarPersonas()
  .then((r) => { if (r.unidades) console.log(`[personas] departamentos con personas creadas: ${r.unidades}`); })
  .catch((e) => console.error('[personas] no se pudo migrar las personas de los departamentos', e instanceof Error ? e.message : 'error'));
app.listen(PORT, () => {
  console.log(`Servidor backend escuchando en puerto ${PORT}`);
  if (planificadorActivo()) iniciarPlanificador();
  iniciarTareasAsistente();
  // Tipo de cambio PEN/USD (los países que no son Perú pagan en dólares): lo lee solo cada 24 h, salvo que el superadmin lo haya fijado a mano.
  iniciarTipoCambio();
});
