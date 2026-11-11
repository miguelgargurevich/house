// Grupos plegables de la barra lateral (9-nov): qué grupo tiene la pantalla actual, cuándo se pliega, y qué se recuerda.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAVE_GRUPOS, desplegado, esPlegable, grupoActivo, guardarAbiertos, leerAbiertos, rutaDentro } from '../src/app/menuGrupos';
import { NAV, navPara } from '../src/app/nav';

const memoria = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };
const roto = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };

describe('ruta activa', () => {
  it('exacta o una pantalla debajo, como NavLink', () => {
    assert.equal(rutaDentro('/admin/recibos', '/admin/recibos'), true);
    assert.equal(rutaDentro('/admin/recibos/12', '/admin/recibos'), true);
    assert.equal(rutaDentro('/admin/recibosx', '/admin/recibos'), false);
  });
  it('el grupo de la pantalla actual', () => {
    assert.equal(grupoActivo(NAV.admin, '/admin/pagos'), 'Cobranza');
    assert.equal(grupoActivo(NAV.admin, '/admin/comunicados/3'), 'Operación');
    assert.equal(grupoActivo(NAV.admin, '/admin/configuracion'), 'Cuenta');
    assert.equal(grupoActivo(NAV.superadmin, '/superadmin/llavero'), 'Plataforma');
  });
  it('las entradas sueltas (sin rótulo) no son de ningún grupo', () => {
    assert.equal(grupoActivo(NAV.admin, '/admin/dashboard'), null);
    assert.equal(grupoActivo(NAV.propietario, '/propietario/cargos'), null);
  });
  it('la junta de un propietario', () => {
    const g = navPara({ rol: 'propietario', cargo_junta: 'tesorero', complejo_id: 1, junta_unica: false, estructura_id: 4 });
    assert.equal(grupoActivo(g, '/junta/pagos'), 'Junta');
  });
});

describe('qué se pliega', () => {
  it('con rótulo y más de una entrada', () => {
    assert.equal(esPlegable({ label: 'Cobranza', items: [1, 2] }), true);
    assert.equal(esPlegable({ label: 'Cuenta', items: [1] }), false, 'una sola entrada sale suelta');
    assert.equal(esPlegable({ items: [1, 2, 3] }), false, 'sin rótulo, sueltas');
  });
  it('todos los grupos con rótulo tienen ícono para la cabecera', () => {
    for (const grupos of Object.values(NAV)) for (const g of grupos) if (g.label) assert.ok(g.icon, g.label);
  });
});

describe('desplegado', () => {
  const nada = new Set<string>();
  it('el de la pantalla actual se abre solo', () => assert.equal(desplegado('Cobranza', nada, 'Cobranza', false), true));
  it('salvo que se cierre a mano', () => assert.equal(desplegado('Cobranza', nada, 'Cobranza', true), false));
  it('otro grupo, cerrado salvo que se abra', () => {
    assert.equal(desplegado('Operación', nada, 'Cobranza', false), false);
    assert.equal(desplegado('Operación', new Set(['Operación']), 'Cobranza', false), true);
  });
});

describe('se recuerdan los abiertos', () => {
  it('guarda y lee', () => {
    const a = memoria();
    guardarAbiertos(new Set(['Cobranza', 'Plataforma']), a);
    assert.deepEqual([...leerAbiertos(a)].sort(), ['Cobranza', 'Plataforma']);
    assert.ok(a.m.has(CLAVE_GRUPOS));
  });
  it('basura o sin almacenamiento = ninguno, sin reventar', () => {
    const a = memoria(); a.setItem(CLAVE_GRUPOS, '{no es json');
    assert.equal(leerAbiertos(a).size, 0);
    a.setItem(CLAVE_GRUPOS, JSON.stringify([1, 'Cobranza', null]));
    assert.deepEqual([...leerAbiertos(a)], ['Cobranza']);
    assert.equal(leerAbiertos(null).size, 0);
    assert.equal(leerAbiertos(roto).size, 0);
    assert.doesNotThrow(() => guardarAbiertos(new Set(['x']), roto));
  });
});
