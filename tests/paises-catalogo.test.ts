// Catálogo de países y monedas (src/lib/paises.ts), el formateo de dinero y los valores por defecto del esquema.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { prisma, vaciarBase } from './helpers/app';
import { CODIGOS_MONEDA, CODIGOS_PAIS, MONEDAS, PAISES, decimalesDe, formatoDinero, monedaDe, monedaDelPais, monedaEnPlural, paisDe, simboloDe } from '../src/lib/paises';

describe('catálogo de países y monedas', () => {
  it('cada país apunta a una moneda del catálogo, con zona horaria IANA válida', () => {
    for (const p of PAISES) {
      assert.ok(monedaDe(p.moneda), `${p.codigo}: la moneda ${p.moneda} no está en el catálogo`);
      assert.doesNotThrow(() => new Intl.DateTimeFormat('es', { timeZone: p.zona_horaria }), `${p.codigo}: zona ${p.zona_horaria}`);
      assert.match(p.codigo, /^[A-Z]{2}$/);
      assert.ok(p.bandera.length > 0 && p.nombre.length > 0);
    }
  });

  it('sin códigos repetidos', () => {
    assert.equal(new Set(CODIGOS_PAIS).size, PAISES.length);
    assert.equal(new Set(CODIGOS_MONEDA).size, MONEDAS.length);
  });

  it('Latinoamérica + España + EE. UU., con su moneda por defecto', () => {
    const esperado: Record<string, string> = { PE: 'PEN', US: 'USD', ES: 'EUR', CL: 'CLP', CO: 'COP', MX: 'MXN', AR: 'ARS', BO: 'BOB', UY: 'UYU', PY: 'PYG', GT: 'GTQ', CR: 'CRC', DO: 'DOP', EC: 'USD', BR: 'BRL' };
    for (const [p, m] of Object.entries(esperado)) assert.equal(paisDe(p)?.moneda, m, p);
    assert.equal(monedaDelPais('PE'), 'PEN');
    assert.equal(monedaDelPais('ZZ'), 'PEN', 'un país desconocido propone soles');
  });

  it('símbolo y decimales de las monedas del encargo', () => {
    const q = (c: string) => monedaDe(c)!;
    assert.deepEqual([q('PEN').simbolo, q('PEN').decimales], ['S/', 2]);
    assert.deepEqual([q('USD').simbolo, q('USD').decimales], ['US$', 2]);
    assert.deepEqual([q('EUR').simbolo, q('EUR').decimales], ['€', 2]);
    assert.deepEqual([q('CLP').simbolo, q('CLP').decimales], ['$', 0]);
    assert.deepEqual([q('PYG').simbolo, q('PYG').decimales], ['₲', 0]);
    assert.deepEqual([q('UYU').simbolo, q('UYU').decimales], ['$U', 2]);
    assert.deepEqual([q('DOP').simbolo, q('DOP').decimales], ['RD$', 2]);
    assert.equal(decimalesDe('CLP'), 0);
    assert.equal(decimalesDe('PEN'), 2);
    assert.equal(decimalesDe('???'), 2);
  });

  it('el plural para frases y el símbolo para rótulos (soles si no se dice; el código si la moneda no existe)', () => {
    assert.equal(monedaEnPlural('PEN'), 'soles');
    assert.equal(monedaEnPlural('USD'), 'dólares');
    assert.equal(monedaEnPlural('CLP'), 'pesos chilenos');
    assert.equal(monedaEnPlural(null), 'soles');
    assert.equal(monedaEnPlural('XYZ'), 'XYZ');
    assert.equal(simboloDe('USD'), 'US$');
    assert.equal(simboloDe(undefined), 'S/');
    assert.equal(simboloDe('XYZ'), 'XYZ');
    for (const m of MONEDAS) assert.ok(m.plural && m.plural === m.plural.toLowerCase(), `${m.codigo}: plural en minúsculas`);
  });

  it('el impuesto de referencia del Perú es el IGV de 18 %; EE. UU. no tiene uno nacional', () => {
    assert.deepEqual(paisDe('PE')!.impuesto, { nombre: 'IGV', tasa: 18 });
    assert.equal(paisDe('US')!.impuesto, null);
  });
});

describe('formatoDinero', () => {
  it('soles con el mismo formato de siempre (S/ 272.15, miles con coma)', () => {
    assert.equal(formatoDinero(272.15, 'PEN'), 'S/ 272.15');
    assert.equal(formatoDinero('1272.15', 'PEN'), 'S/ 1,272.15');
    assert.equal(formatoDinero(-5, 'PEN'), '-S/ 5.00');
    assert.equal(formatoDinero(null, 'PEN'), 'S/ 0.00');
    assert.equal(formatoDinero(undefined, null), 'S/ 0.00', 'sin moneda cuenta como soles');
    assert.equal(formatoDinero(Number.NaN, 'PEN'), 'S/ 0.00');
  });

  it('coincide con el formato de soles() del frontend, espacio duro incluido', () => {
    const pen = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
    for (const v of [0, 1, 20, 272.15, 1272.15, 1234567.89, -5.5]) assert.equal(formatoDinero(v, 'PEN', ' '), pen.format(v), String(v));
  });

  it('dólares', () => {
    assert.equal(formatoDinero(20, 'USD'), 'US$ 20.00');
    assert.equal(formatoDinero('1500.5', 'USD'), 'US$ 1,500.50');
  });

  it('pesos chilenos: sin decimales y con punto de miles', () => {
    assert.equal(formatoDinero(1234567, 'CLP'), '$ 1.234.567');
    assert.equal(formatoDinero('15000.4', 'CLP'), '$ 15.000');
  });

  it('euros: símbolo después, coma decimal, el punto de miles siempre', () => {
    assert.equal(formatoDinero(1234.5, 'EUR'), '1.234,50 €');
    assert.equal(formatoDinero(99.9, 'EUR'), '99,90 €');
  });

  it('un Decimal de Prisma se formatea por su texto, no por un float', () => {
    assert.equal(formatoDinero({ toFixed: (d: number) => (Number('0.1') + Number('0.2')).toFixed(d) }, 'PEN'), 'S/ 0.30');
  });

  it('una moneda que no está en el catálogo sale con su código, sin reventar', () => {
    assert.equal(formatoDinero(10, 'XYZ'), 'XYZ 10.00');
  });

  it('-0.00 no lleva signo', () => {
    assert.equal(formatoDinero(-0.001, 'PEN'), 'S/ 0.00');
  });
});

describe('esquema: pais y moneda con valores por defecto', () => {
  before(vaciarBase);
  after(async () => { await vaciarBase(); await prisma.$disconnect(); });

  it('un condominio y una empresa creados sin país ni moneda quedan en Perú y soles', async () => {
    const e = await prisma.empresaAdministradora.create({ data: { nombre: 'Sin país' } });
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'Sin moneda', tipo: 'Edificio', empresa_id: e.id } });
    assert.equal(e.pais, 'PE');
    assert.equal(c.pais, 'PE');
    assert.equal(c.moneda, 'PEN');
  });

  it('acepta otro país y otra moneda', async () => {
    const c = await prisma.complejoHabitacional.create({ data: { nombre: 'En Santiago', tipo: 'Edificio', pais: 'CL', moneda: 'CLP' } });
    assert.deepEqual([c.pais, c.moneda], ['CL', 'CLP']);
  });
});
