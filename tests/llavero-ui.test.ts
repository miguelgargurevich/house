// Llavero de IA: plegado de los proveedores por defecto, iconos de marca y resumen de claves.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { datosIconoProveedor } from '../src/ui/proveedoresIcono';
import { resumenClaves, type Clave } from '../src/pages/superadmin/_parts/llavero/tipos';

const clave = (over: Partial<Clave>): Clave => ({
  id: 1,
  proveedor: 'gemini',
  etiqueta: 'principal',
  habilitada: true,
  reserva: false,
  ...over,
}) as unknown as Clave;

describe('iconos de proveedor', () => {
  it('los que tienen logo real lo usan con su color de marca', () => {
    assert.deepEqual(datosIconoProveedor('gemini'), { hex: '#3186FF', mono: 'GE', adaptive: false, glyph: 'googlagemini' });
    assert.equal(datosIconoProveedor('openai').glyph, 'openai');
    assert.equal(datosIconoProveedor('openai').adaptive, true);
    assert.equal(datosIconoProveedor('nvidia').glyph, 'nvidia');
    assert.equal(datosIconoProveedor('nvidia').hex, '#76B900');
    assert.equal(datosIconoProveedor('ollama').glyph, 'ollama');
  });

  it('los que no tienen logo caen a monograma con el color oficial de la marca', () => {
    assert.deepEqual(datosIconoProveedor('groq'), { hex: '#F55036', mono: 'GQ', adaptive: false, glyph: null });
    assert.deepEqual(datosIconoProveedor('openrouter'), { hex: '#6467F2', mono: 'OR', adaptive: false, glyph: null });
    assert.deepEqual(datosIconoProveedor('deepseek'), { hex: '#4D6BFE', mono: 'DS', adaptive: false, glyph: null });
    assert.deepEqual(datosIconoProveedor('mistral'), { hex: '#FA520F', mono: 'MI', adaptive: false, glyph: null });
    assert.deepEqual(datosIconoProveedor('cerebras'), { hex: '#F15A29', mono: 'CB', adaptive: false, glyph: null });
    assert.deepEqual(datosIconoProveedor('cohere'), { hex: '#39594D', mono: 'CO', adaptive: false, glyph: null });
    assert.deepEqual(datosIconoProveedor('sambanova'), { hex: '#EE3124', mono: 'SN', adaptive: false, glyph: null });
  });

  it('sin logo conocido: monograma gris de dos letras', () => {
    assert.deepEqual(datosIconoProveedor('llm7'), { hex: '#6B7280', mono: 'LL', adaptive: false, glyph: null });
    assert.deepEqual(datosIconoProveedor('kilo'), { hex: '#6B7280', mono: 'KI', adaptive: false, glyph: null });
    assert.equal(datosIconoProveedor('no-existe').mono, 'NO');
    assert.equal(datosIconoProveedor('').mono, '?');
  });

  it('el slug se normaliza (mayúsculas y espacios)', () => {
    assert.equal(datosIconoProveedor('GEMINI').glyph, 'googlagemini');
    assert.equal(datosIconoProveedor('  Groq ').mono, 'GQ');
  });
});

describe('resumen de claves del proveedor', () => {
  it('sin claves lo dice', () => {
    assert.equal(resumenClaves([]), 'Sin clave guardada.');
  });
  it('una clave y varias claves', () => {
    assert.equal(resumenClaves([clave({ id: 1 })]), '1 clave');
    assert.equal(resumenClaves([clave({ id: 1 }), clave({ id: 2 })]), '2 claves');
  });
  it('cuenta las pausadas y las de reserva', () => {
    assert.equal(resumenClaves([clave({ id: 1 }), clave({ id: 2, habilitada: false })]), '2 claves · 1 pausada');
    assert.equal(resumenClaves([clave({ id: 1 }), clave({ id: 2, habilitada: false }), clave({ id: 3, habilitada: false })]), '3 claves · 2 pausadas');
    assert.equal(resumenClaves([clave({ id: 1, reserva: true })]), '1 clave · 1 de reserva');
    assert.equal(resumenClaves([clave({ id: 1, reserva: true }), clave({ id: 2, habilitada: false, reserva: true })]), '2 claves · 1 pausada · 2 de reserva');
  });
});

describe('el proveedor arranca plegado y se despliega', () => {
  const fuente = readFileSync('src/pages/superadmin/_parts/llavero/GrupoProveedor.tsx', 'utf8');

  it('el estado arranca cerrado', () => {
    assert.ok(fuente.includes('const [abierto, setAbierto] = useState(false);'));
  });

  it('el botón que pliega declara aria-expanded y aria-controls', () => {
    assert.ok(fuente.includes('aria-expanded={abierto}'));
    const iExpanded = fuente.indexOf('aria-expanded={abierto}');
    const iControls = fuente.indexOf('aria-controls={claves.length > 0 ? idClaves : undefined}');
    assert.ok(iControls > iExpanded, 'aria-controls va junto a aria-expanded');
    assert.ok(fuente.includes('const idClaves = `llavero-claves-${p.id}`;'));
  });

  it('las filas de claves quedan ocultas mientras está plegado', () => {
    const iUl = fuente.indexOf('<ul id={idClaves}');
    assert.ok(iUl > -1, 'la lista de claves tiene id');
    const iHidden = fuente.indexOf('hidden={!abierto}');
    assert.ok(iHidden > iUl && iHidden < iUl + 120, 'la lista de claves se oculta con el estado de plegado');
  });

  it('el chevron gira al abrir', () => {
    assert.ok(fuente.includes("abierto && 'rotate-180'"));
  });

  it('«Agregar clave» está FUERA del botón que pliega (no pliega al agregar)', () => {
    const iCierre = fuente.indexOf('</button>');
    const iAgregar = fuente.indexOf('onClick={onAgregar}');
    assert.ok(iCierre > -1 && iAgregar > iCierre, 'el botón de agregar va después del cierre del botón que pliega');
  });

  it('el icono de marca va en la cabecera del proveedor', () => {
    const iBoton = fuente.indexOf('<button');
    const iIcono = fuente.indexOf('<IconoProveedor slug={p.id}');
    const iCierre = fuente.indexOf('</button>');
    assert.ok(iBoton > -1 && iIcono > iBoton && iIcono < iCierre, 'el icono está dentro del botón que pliega');
  });
});

describe('el orden de uso lleva los mismos iconos', () => {
  const fuente = readFileSync('src/pages/superadmin/_parts/llavero/ComoSeUsan.tsx', 'utf8');

  it('cada proveedor del orden muestra su icono', () => {
    assert.ok(fuente.includes('<IconoProveedor slug={p.id} size={14} />'));
  });
});
