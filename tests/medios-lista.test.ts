// Lista de medios de pago de la administradora: la segunda línea de cada fila muestra la entidad real (no `banco`),
// la moneda en las cuentas y el servicio en las recaudaciones. El repo no tiene testing-library: se fija con la fuente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const lista = readFileSync('src/pages/admin/MediosPago.tsx', 'utf8');
const tipos = readFileSync('src/pages/admin/_parts/medios/tipos.ts', 'utf8');

describe('lista de medios: la fila muestra la entidad real', () => {
  it('la cuenta bancaria usa la entidad (con «Otro» ya resuelto por el servidor) y la moneda', () => {
    assert.match(lista, /m\.tipo === 'banco' \? `\$\{m\.entidad \?\? ''\} · \$\{monedaCorta\(m\.moneda\)\}`/);
    assert.match(tipos, /export const monedaCorta = \(m: Moneda\) => \(m === 'USD' \? 'Dólares' : 'Soles'\);/);
  });

  it('la recaudación muestra entidad · servicio, con su propio ícono (no el del celular)', () => {
    assert.match(lista, /m\.tipo === 'recaudacion' \? \[m\.entidad, m\.servicio\]\.filter\(Boolean\)\.join\(' · '\)/);
    assert.match(lista, /m\.tipo === 'recaudacion' \? <ReceiptPercentIcon/);
    assert.match(lista, /import \{[^}]*\bReceiptPercentIcon\b[^}]*\} from '@heroicons\/react\/24\/outline'/);
  });

  it('Yape y Plin siguen con «Con/Sin código QR»', () => {
    assert.match(lista, /: m\.tiene_qr \? 'Con código QR' : 'Sin código QR'/);
  });

  it('ya no usa m.banco a secas en la columna del medio', () => {
    assert.ok(!/\bm\.banco\b/.test(lista), 'la lista no debe leer m.banco');
  });
});
