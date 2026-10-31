// Moneda de cobro de la suscripción por país: Perú en soles, todos los demás en dólares (`monedaDeCobroSuscripcion`). Una base ya existente tiene
// `ImpuestoPais.moneda` con la moneda propia de cada país (CLP, ARS…); esto la deja como la regla nueva. Idempotente. NO toca lo ya emitido: los
// `PagoSuscripcion` guardan su moneda y su monto y no se recalculan nunca; sólo informa cuántos hay en otra moneda (de países que ya no cobran así).
import type { PrismaClient } from '@prisma/client';
import { monedaDeCobroSuscripcion } from '../../../lib/paises';
import { sembrarCatalogoComercial } from './catalogo';
import { invalidarComercial } from './modulos';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = Pick<PrismaClient<any, any, any>, 'moduloComercial' | 'planComercial' | 'configuracionComercial' | 'impuestoPais' | 'pagoSuscripcion'>;

export interface CambioDeMoneda { pais: string; de: string; a: string }
export interface InformeMonedaCobro {
  cambios: CambioDeMoneda[];
  /** Pagos de suscripción ya registrados en una moneda distinta de la de cobro actual de su país: se quedan tal cual (no se recalculan). */
  pagos_en_otra_moneda: { moneda: string; cantidad: number }[];
}

export async function ajustarMonedaDeCobro(db: Cliente, opts: { seco?: boolean } = {}): Promise<InformeMonedaCobro> {
  if (!opts.seco) await sembrarCatalogoComercial(db);
  const filas = await db.impuestoPais.findMany({ orderBy: { pais: 'asc' } });
  const cambios: CambioDeMoneda[] = [];
  for (const f of filas) {
    const a = monedaDeCobroSuscripcion(f.pais);
    if (f.moneda === a) continue;
    cambios.push({ pais: f.pais, de: f.moneda, a });
    if (!opts.seco) await db.impuestoPais.update({ where: { pais: f.pais }, data: { moneda: a } });
  }
  if (!opts.seco && cambios.length) invalidarComercial();
  // Pagos ya registrados de condominios de países que no son Perú, en una moneda que no es dólares (informativo).
  const pagos = await db.pagoSuscripcion.findMany({ where: { complejo: { pais: { not: 'PE' } }, moneda: { not: 'USD' } }, select: { moneda: true } });
  const por = new Map<string, number>();
  for (const p of pagos) por.set(p.moneda, (por.get(p.moneda) ?? 0) + 1);
  return { cambios, pagos_en_otra_moneda: [...por].map(([moneda, cantidad]) => ({ moneda, cantidad })).sort((x, y) => x.moneda.localeCompare(y.moneda)) };
}
