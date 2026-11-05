// R1: la rendición de un condominio grande (448 dptos, 14 blocks) tardaba ≈ 1 s: el cobrado previo hacía una consulta en serie por block.
// Ahora son sumas en paralelo (`Promise.all`). El resultado no cambia: la igualdad de JSON antes/después se comprobó con house_mercado
// (ver HANDOFF). Aquí queda fijada la forma del código para que no vuelva el `await` dentro del bucle.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const src = readFileSync('src/server/services/rendicion.ts', 'utf8');

describe('rendición: el cobrado previo por block va en paralelo (R1)', () => {
  it('una suma por block, lanzadas con Promise.all', () => {
    assert.match(src, /const previos = await Promise\.all\(clavesBlocks\.map\(\(k\) =>\s*prisma\.pago\.aggregate\(/);
  });

  it('no hay `await` de consulta dentro de un bucle sobre los blocks', () => {
    assert.doesNotMatch(src, /for \(const k of clavesBlocks\) \{\s*const r = await prisma\.pago\.aggregate/);
  });

  it('el resultado se asigna por posición a cada block (no se suma dos veces)', () => {
    assert.match(src, /clavesBlocks\.forEach\(\(k, i\) => \{ de\(k\)\.prior_cobrado = new Prisma\.Decimal\(previos\[i\]\._sum\.monto \?\? 0\); \}\);/);
  });
});
