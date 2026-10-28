/**
 * Vista previa de las cuentas del agua mientras se escribe la lectura. Exacta (enteros BigInt, nunca `number` para sumar o multiplicar) y con las
 * mismas reglas que el servidor (`src/server/lib/agua.ts`): consumo = actual − anterior (3 decimales); monto = consumo × factor, 2 decimales,
 * half-up; el aviso salta con más de S/ 0.05 de diferencia. El servidor vuelve a calcular y es quien manda.
 */

/** «1416,574» → 1416574n (milésimas). Más decimales se redondean half-up; texto no numérico → null. */
function escalar(v: string, decimales: number): bigint | null {
  const t = v.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const [entero, fraccion = ''] = t.split('.');
  const base = BigInt(entero + fraccion.padEnd(decimales, '0').slice(0, decimales));
  return fraccion.length > decimales && fraccion[decimales]! >= '5' ? base + 1n : base;
}

const texto = (v: bigint, decimales: number): string => {
  const e = 10n ** BigInt(decimales);
  return `${v / e}.${(v % e).toString().padStart(decimales, '0')}`;
};

export interface CuentaAgua { consumo_m3: string; monto: string }

/** Consumo y monto de una lectura; `null` si falta algún dato, no es un número o la actual es menor que la anterior. */
export function cuentaAgua(anterior: string, actual: string, factor: string): CuentaAgua | null {
  const a = escalar(anterior, 3);
  const c = escalar(actual, 3);
  const f = escalar(factor, 4);
  if (a === null || c === null || f === null || c < a || f <= 0n) return null;
  const m3 = c - a; // milésimas de m³
  const centimos = (m3 * f + 50_000n) / 100_000n; // milésimas × diezmilésimas = 10⁻⁷ → céntimos, half-up
  return { consumo_m3: texto(m3, 3), monto: texto(centimos, 2) };
}

const centimos = (v: string): bigint | null => escalar(v, 2);

/** Aviso si el agua del recibo y la de la lectura difieren en más de S/ 0.05; `null` si cuadran o el recibo no tiene concepto de agua. */
export function avisoAgua(montoLectura: string, montoRecibo: string | null): string | null {
  if (montoRecibo === null) return null;
  const l = centimos(montoLectura);
  const r = centimos(montoRecibo);
  if (l === null || r === null) return null;
  const dif = l > r ? l - r : r - l;
  return dif > 5n ? `El agua del recibo es S/ ${texto(r, 2)}; con la lectura sale S/ ${texto(l, 2)}` : null;
}
