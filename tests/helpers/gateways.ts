// Gateways de prueba: DNS falso (nunca hay resolución real) y un «Dashboard IA» registrado como en producción.
import { prisma } from './app';
import { gatewayDeps } from '../../src/server/lib/gateways';
import { crearGateway, agregarDominio } from '../../src/server/lib/gatewaysAdmin';

export const IP_PUBLICA = '93.184.216.34';
export const DOMINIO_DASHBOARDIA = 'api-dashboardia.gargurevich.dev';
export const URL_DASHBOARDIA = `https://${DOMINIO_DASHBOARDIA}/v1`;

const resolverOriginal = gatewayDeps.resolver;

/** Todo dominio resuelve a una IP pública, salvo los que se indiquen (host → direcciones). */
export function dnsFalso(especiales: Record<string, string[]> = {}) {
  const consultas: string[] = [];
  gatewayDeps.resolver = async (host) => {
    consultas.push(host);
    return (especiales[host] ?? [IP_PUBLICA]).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return { consultas };
}
export const restaurarDns = () => { gatewayDeps.resolver = resolverOriginal; };

/** Vacía lo de gateways y OCR (las pruebas comparten la base). */
export async function limpiarGateways() {
  await prisma.claveIntegracion.deleteMany();
  await prisma.gatewayIA.deleteMany();
  await prisma.dominioGatewayPermitido.deleteMany();
  await prisma.configuracionOcr.deleteMany();
}

/** Registra «Dashboard IA» (dominio permitido + gateway de visión) como lo deja la migración. */
export async function registrarDashboardia(usuarioId: number) {
  if (!(await prisma.dominioGatewayPermitido.findUnique({ where: { dominio: DOMINIO_DASHBOARDIA } }))) await agregarDominio(DOMINIO_DASHBOARDIA, usuarioId);
  const previo = await prisma.gatewayIA.findFirst({ where: { nombre: 'Dashboard IA' } });
  if (previo) return previo;
  return crearGateway({ nombre: 'Dashboard IA', base_url: URL_DASHBOARDIA, modelo_por_defecto: 'nvidia/nemotron-3.5-super-vl-120b-a12b', modelo_vision: 'nvidia/nemotron-3.5-super-vl-120b-a12b', vision: true, prioridad: 2 }, usuarioId);
}
