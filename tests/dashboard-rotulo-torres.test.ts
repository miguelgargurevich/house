// F1: en el resumen de una empresa con varios condominios, «Block 2» solo no dice de qué condominio es.
// La lógica del rótulo es pura (cobranza/torres.ts) y se prueba importándola; el Dashboard se revisa por fuente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { hayVariosCondominios, rotuloTorre } from '../src/pages/admin/_parts/cobranza/torres';

const dashboard = readFileSync('src/pages/admin/Dashboard.tsx', 'utf8');
const A = { id: 1, nombre: 'Los Pinos' };
const B = { id: 2, nombre: 'Los Cedros' };

describe('rótulo de torre en el resumen (F1)', () => {
  it('con torres de un solo condominio queda como hoy: solo el nombre del block', () => {
    const torres = [{ complejo: A }, { complejo: A }];
    assert.equal(hayVariosCondominios(torres), false);
    assert.equal(rotuloTorre('Block 2', A, false), 'Block 2');
  });

  it('con torres de varios condominios, el rótulo lleva el condominio', () => {
    const torres = [{ complejo: A }, { complejo: B }];
    assert.equal(hayVariosCondominios(torres), true);
    assert.equal(rotuloTorre('Block 2', A, true), 'Block 2 · Los Pinos');
    assert.equal(rotuloTorre('Block 2', B, true), 'Block 2 · Los Cedros');
  });

  it('dos blocks «Block 2» de condominios distintos ya no se confunden', () => {
    assert.notEqual(rotuloTorre('Block 2', A, true), rotuloTorre('Block 2', B, true));
  });

  it('una torre sin condominio no inventa uno aunque haya varios', () => {
    assert.equal(rotuloTorre('Block 6', null, true), 'Block 6');
  });

  it('el Dashboard usa el rótulo en la barra (title y texto) y ajusta la columna sólo con varios condominios', () => {
    assert.match(dashboard, /const varios = hayVariosCondominios\(torres\)/);
    assert.match(dashboard, /const rotulo = \(t: NonNullable<Resumen\['por_torre'\]>\[number\]\) => rotuloTorre\(t\.nombre, t\.complejo, varios\)/);
    assert.match(dashboard, /title=\{rotulo\(t\)\}>\{rotulo\(t\)\}<\/span>/);
    assert.match(dashboard, /varios \? 'grid-cols-\[minmax\(0,8rem\)_1fr_3\.25rem\]' : 'grid-cols-\[minmax\(4\.5rem,auto\)_1fr_3\.25rem\]'/);
  });
});
