// Datos del responsable y versión de los Términos y la Política de privacidad (Ley 29733). Los datos viven en `ConfiguracionComercial`
// y los edita el superadmin; sólo estos cuatro campos y la versión salen sin sesión.
import type { ConfiguracionComercial } from '@prisma/client';

/** Versión de los Términos y de la Política. Se graba en cada cuenta nueva al aceptarlos. La página pública lleva la misma (ver `tests/legal-ui.test.ts`). */
export const VERSION_LEGAL = '2026-10-30';

export interface DatosLegales {
  razon_social: string | null;
  ruc: string | null;
  domicilio: string | null;
  correo: string | null;
  version: string;
}

/** Lo que `GET /api/publico/legal` devuelve: nada más de la configuración (ni datos de pago ni el correo del superadmin). */
export function datosLegales(cfg: Pick<ConfiguracionComercial, 'legal_razon_social' | 'legal_ruc' | 'legal_domicilio' | 'legal_correo'>): DatosLegales {
  return { razon_social: cfg.legal_razon_social, ruc: cfg.legal_ruc, domicilio: cfg.legal_domicilio, correo: cfg.legal_correo, version: VERSION_LEGAL };
}
