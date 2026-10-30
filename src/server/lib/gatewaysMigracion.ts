// Migración del `dashboardia` que era FIJO en el catálogo a su primer gateway registrado («Dashboard IA»). Idempotente y con modo seco.
// Re-cifra cada clave (su AAD lleva proveedor y etiqueta, que cambian) sin perderla ni su estado; jamás imprime una clave.
import { prisma } from '../db';
import { aadClave, cifrar, descifrar, llaveroConfigurado } from './secretBox';
import { PROVEEDOR_GATEWAY, etiquetaInterna } from './gateways';

export const DASHBOARDIA = {
  nombre: 'Dashboard IA',
  dominio: 'api-dashboardia.gargurevich.dev',
  base_url: 'https://api-dashboardia.gargurevich.dev/v1',
  modelo: 'nvidia/nemotron-3.5-super-vl-120b-a12b', // el gateway no publica qwen3-vl-flash en /models
  prioridad: 2, // la que tenía en el catálogo: respaldo de visión justo después de Gemini
} as const;

export interface InformeMigracion {
  seco: boolean;
  dominio: 'creado' | 'ya_estaba';
  gateway: 'creado' | 'ya_estaba';
  claves_migradas: number;
  claves_ya_en_gateway: number;
}

/** Con `seco` calcula el informe y NO escribe nada. */
export async function migrarDashboardia(opts: { seco: boolean }): Promise<InformeMigracion> {
  const pendientes = await prisma.claveIntegracion.findMany({ where: { proveedor: 'dashboardia' }, orderBy: { id: 'asc' } });
  if (pendientes.length > 0 && !llaveroConfigurado()) throw new Error('LLAVERO_ENC_KEY no está configurada: no se pueden re-cifrar las claves de dashboardia');

  const dominio = await prisma.dominioGatewayPermitido.findUnique({ where: { dominio: DASHBOARDIA.dominio } });
  const gateway = await prisma.gatewayIA.findFirst({ where: { nombre: { equals: DASHBOARDIA.nombre, mode: 'insensitive' } } });
  const yaEnGateway = gateway ? await prisma.claveIntegracion.count({ where: { gateway_id: gateway.id } }) : 0;
  const informe: InformeMigracion = {
    seco: opts.seco,
    dominio: dominio ? 'ya_estaba' : 'creado',
    gateway: gateway ? 'ya_estaba' : 'creado',
    claves_migradas: pendientes.length,
    claves_ya_en_gateway: yaEnGateway,
  };
  if (opts.seco) return informe;

  await prisma.$transaction(async (tx) => {
    if (!dominio) await tx.dominioGatewayPermitido.create({ data: { dominio: DASHBOARDIA.dominio } });
    const g = gateway ?? await tx.gatewayIA.create({
      data: { nombre: DASHBOARDIA.nombre, base_url: DASHBOARDIA.base_url, modelo_por_defecto: DASHBOARDIA.modelo, modelo_vision: DASHBOARDIA.modelo, vision: true, prioridad: DASHBOARDIA.prioridad },
    });
    for (const f of pendientes) {
      let clave: string;
      try {
        clave = descifrar(f.api_key_enc, aadClave(f.proveedor, f.etiqueta));
      } catch {
        throw new Error(`No se pudo descifrar la clave #${f.id} de dashboardia: no se migró nada`);
      }
      const etiqueta = etiquetaInterna(g.id, f.etiqueta);
      await tx.claveIntegracion.update({
        where: { id: f.id },
        data: { proveedor: PROVEEDOR_GATEWAY, gateway_id: g.id, etiqueta, api_key_enc: cifrar(clave, aadClave(PROVEEDOR_GATEWAY, etiqueta)) },
        select: { id: true },
      });
    }
  });
  return informe;
}
