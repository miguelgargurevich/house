import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { avisoCci, avisoLargoCuenta } from '../src/pages/admin/_parts/medios/avisos';
import { ENTIDADES, GRUPOS_ENTIDAD, camposDePago, codigoUnidadDelMedio, instruccionRecaudacion, nombreEntidad } from '../src/server/services/mediosPago';

const entidad = (nombre: string) => ENTIDADES.find((x) => x.nombre === nombre)!;
const digitos = (n: number) => '1234567890'.repeat(3).slice(0, n);

describe('catálogo de entidades (fuente única del servidor)', () => {
  it('trae exactamente las entidades pedidas, agrupadas, y «Otro» al final', () => {
    const porGrupo = (g: string) => ENTIDADES.filter((x) => x.grupo === g).map((x) => x.nombre);
    assert.deepEqual(porGrupo('banco'), [
      'BCP', 'BBVA', 'Interbank', 'Scotiabank', 'Banco de la Nación', 'BanBif', 'Pichincha', 'Mibanco', 'Banco Falabella', 'Banco Ripley', 'Banco GNB', 'Santander', 'Citibank', 'Alfin Banco', 'Banco de Comercio', 'Compartamos Banco',
    ]);
    assert.deepEqual(porGrupo('caja'), [
      'Caja Arequipa', 'Caja Huancayo', 'Caja Piura', 'Caja Cusco', 'Caja Trujillo', 'Caja Sullana', 'Caja Ica', 'Caja Tacna', 'Caja Metropolitana de Lima', 'Caja Maynas',
    ]);
    assert.deepEqual(porGrupo('financiera'), ['Financiera Confianza', 'Financiera Efectiva']);
    assert.deepEqual(porGrupo('otra'), ['Otro']);
    assert.deepEqual(GRUPOS_ENTIDAD.map((g) => g.grupo), ['banco', 'caja', 'financiera', 'otra']);
    assert.equal(new Set(ENTIDADES.map((x) => x.nombre)).size, ENTIDADES.length, 'sin repetidos');
  });

  it('sólo los códigos de CCI y los largos de cuenta acordados; el resto sin aviso', () => {
    const codigos = Object.fromEntries(ENTIDADES.filter((x) => x.codigo_cci).map((x) => [x.nombre, x.codigo_cci]));
    assert.deepEqual(codigos, { BCP: '002', Interbank: '003', Scotiabank: '009', BBVA: '011', 'Banco de la Nación': '018', Pichincha: '035', BanBif: '038', Mibanco: '049' });
    const largos = Object.fromEntries(ENTIDADES.filter((x) => x.largo_ahorros || x.largo_corriente).map((x) => [x.nombre, [x.largo_ahorros, x.largo_corriente]]));
    assert.deepEqual(largos, { BCP: [14, 13], BBVA: [18, 18], Interbank: [13, 13], Scotiabank: [10, 10], 'Banco de la Nación': [11, 11] });
  });
});

describe('aviso del largo habitual de la cuenta (nunca bloquea)', () => {
  it('BCP: ahorros 14, corriente 13', () => {
    const bcp = entidad('BCP');
    assert.equal(avisoLargoCuenta(bcp, 'ahorros', digitos(14)), null);
    assert.equal(avisoLargoCuenta(bcp, 'corriente', digitos(13)), null);
    assert.match(avisoLargoCuenta(bcp, 'ahorros', digitos(13))!, /BCP suele usar 14 dígitos en cuentas de ahorros: revisa el número/);
    assert.match(avisoLargoCuenta(bcp, 'corriente', digitos(14))!, /BCP suele usar 13 dígitos en cuentas corrientes/);
  });

  it('Interbank 13, BBVA 18, Scotiabank 10 y Banco de la Nación 11, en ahorros y corriente', () => {
    for (const [nombre, n] of [['Interbank', 13], ['BBVA', 18], ['Scotiabank', 10], ['Banco de la Nación', 11]] as const) {
      for (const tipo of ['ahorros', 'corriente']) {
        assert.equal(avisoLargoCuenta(entidad(nombre), tipo, digitos(n)), null, `${nombre} ${tipo} ${n}`);
        assert.match(avisoLargoCuenta(entidad(nombre), tipo, digitos(n + 1))!, new RegExp(`${nombre} suele usar ${n} dígitos: revisa`), `${nombre} ${tipo} ${n + 1}`);
        assert.ok(avisoLargoCuenta(entidad(nombre), tipo, digitos(n - 1)), `${nombre} ${tipo} ${n - 1}`);
      }
    }
  });

  it('cuenta los dígitos (no los guiones ni los espacios) y no avisa con el campo vacío', () => {
    assert.equal(avisoLargoCuenta(entidad('Scotiabank'), 'ahorros', '000-123-4567'), null);
    assert.equal(avisoLargoCuenta(entidad('BBVA'), 'ahorros', ''), null);
    assert.equal(avisoLargoCuenta(entidad('BBVA'), 'ahorros', ' - '), null);
  });

  it('otros bancos, «Otro» y sin entidad: sin aviso', () => {
    for (const nombre of ['BanBif', 'Mibanco', 'Pichincha', 'Caja Arequipa', 'Financiera Confianza', 'Otro']) {
      assert.equal(avisoLargoCuenta(entidad(nombre), 'ahorros', digitos(7)), null, nombre);
    }
    assert.equal(avisoLargoCuenta(undefined, 'ahorros', digitos(7)), null);
  });
});

describe('aviso del código de banco en el CCI (nunca bloquea)', () => {
  const cci = (prefijo: string) => (prefijo + '0'.repeat(20)).slice(0, 20);

  it('un CCI 002 con BBVA avisa (y dice a qué banco parece); con BCP no', () => {
    const aviso = avisoCci(entidad('BBVA'), cci('002'), ENTIDADES);
    assert.match(aviso!, /empieza con 002 \(BCP\)/);
    assert.match(aviso!, /el código de BBVA es 011/);
    assert.equal(avisoCci(entidad('BCP'), cci('002'), ENTIDADES), null);
    assert.equal(avisoCci(entidad('BBVA'), cci('011'), ENTIDADES), null);
  });

  it('cada código acordado: coincide sin aviso y cualquier otro prefijo avisa', () => {
    for (const [nombre, codigo] of [['BCP', '002'], ['Interbank', '003'], ['Scotiabank', '009'], ['BBVA', '011'], ['Banco de la Nación', '018'], ['Pichincha', '035'], ['BanBif', '038'], ['Mibanco', '049']] as const) {
      assert.equal(avisoCci(entidad(nombre), cci(codigo)), null, nombre);
      assert.ok(avisoCci(entidad(nombre), cci('999')), `${nombre} con 999`);
    }
  });

  it('prefijo desconocido: avisa sin nombrar otro banco', () => {
    assert.match(avisoCci(entidad('BCP'), cci('999'), ENTIDADES)!, /^Este CCI empieza con 999 y el código de BCP es 002/);
  });

  it('otras entidades, CCI incompleto o vacío y sin entidad: sin aviso', () => {
    assert.equal(avisoCci(entidad('Caja Piura'), cci('999')), null);
    assert.equal(avisoCci(entidad('Otro'), cci('999')), null);
    assert.equal(avisoCci(entidad('BCP'), '999'), null, 'incompleto: eso lo valida el formulario');
    assert.equal(avisoCci(entidad('BCP'), ''), null);
    assert.equal(avisoCci(undefined, cci('999')), null);
  });
});

describe('nombre de la entidad e instrucción de recaudación', () => {
  const rec = { tipo: 'recaudacion', banco: 'BCP', banco_otro: null, servicio: 'Condominio Los Libertadores', codigo_pago: 'departamento', codigo_instruccion: null };

  it('«Otro» muestra el nombre escrito; un medio viejo sin nombre se lee como «Otra entidad»', () => {
    assert.equal(nombreEntidad({ banco: 'Otro', banco_otro: 'Caja Rural Prueba' }), 'Caja Rural Prueba');
    assert.equal(nombreEntidad({ banco: 'Otro', banco_otro: null }), 'Otra entidad');
    assert.equal(nombreEntidad({ banco: 'Otro', banco_otro: '  ' }), 'Otra entidad');
    assert.equal(nombreEntidad({ banco: 'BCP', banco_otro: 'ignorado' }), 'BCP');
    assert.equal(nombreEntidad({ banco: null }), null);
  });

  it('departamento: lleva el código real de la unidad; dni y otro, su texto', () => {
    assert.equal(instruccionRecaudacion(rec, 'B01-804'), 'Paga desde Pago de servicios en BCP → Condominio Los Libertadores, con el código: B01-804');
    assert.equal(instruccionRecaudacion({ ...rec, codigo_pago: 'dni' }, 'B01-804'), 'Paga desde Pago de servicios en BCP → Condominio Los Libertadores, con el código: tu DNI');
    assert.equal(
      instruccionRecaudacion({ ...rec, banco: 'Otro', banco_otro: 'Caja Rural X', codigo_pago: 'otro', codigo_instruccion: 'Tu código de socio' }, 'B01-804'),
      'Paga desde Pago de servicios en Caja Rural X → Condominio Los Libertadores, con el código: Tu código de socio',
    );
    assert.equal(instruccionRecaudacion({ ...rec, tipo: 'yape' }, 'B01-804'), null);
  });

  it('camposDePago: moneda y nombre de moneda; PEN por defecto', () => {
    const base = { ...rec, tipo: 'banco', servicio: null, codigo_pago: null };
    assert.deepEqual(camposDePago({ ...base, moneda: 'USD' }, null), { entidad: 'BCP', moneda: 'USD', moneda_nombre: 'Dólares', servicio: null, codigo_pago: null, instruccion: null });
    assert.equal(camposDePago({ ...base, moneda: 'PEN' }, null).moneda_nombre, 'Soles');
  });

  it('el código de la unidad es el de SU block (o de cualquier unidad del condominio si el medio es de todo el condominio)', () => {
    const unidades = [{ codigo: 'B02-101', complejo_id: 1, estructura_id: 2 }, { codigo: 'B01-804', complejo_id: 1, estructura_id: 1 }, { codigo: 'X-1', complejo_id: 9, estructura_id: null }];
    assert.equal(codigoUnidadDelMedio({ complejo_id: 1, estructura_id: 1 }, unidades), 'B01-804');
    assert.equal(codigoUnidadDelMedio({ complejo_id: 1, estructura_id: 2 }, unidades), 'B02-101');
    assert.equal(codigoUnidadDelMedio({ complejo_id: 1, estructura_id: null }, unidades), 'B02-101');
    assert.equal(codigoUnidadDelMedio({ complejo_id: 1, estructura_id: 3 }, unidades), null);
  });
});

// Sin navegador en las pruebas: se fija lo que el código promete (estructura y textos), no cómo se pinta.
describe('formulario y pantallas (prueba de fuente)', () => {
  const leer = (ruta: string) => readFileSync(new URL(`../src/pages/${ruta}`, import.meta.url), 'utf8');

  it('el formulario pide las entidades al servidor (sin lista propia), las agrupa en optgroup y sólo AVISA el formato', () => {
    const form = leer('admin/_parts/medios/MedioFormModal.tsx');
    const tipos = leer('admin/_parts/medios/tipos.ts');
    assert.doesNotMatch(tipos, /BANCOS|'Scotiabank'|'Interbank'/, 'la lista de bancos vive sólo en el servidor');
    assert.match(tipos, /\/api\/medios-pago\/catalogo/);
    assert.match(form, /<optgroup /);
    assert.match(form, /avisoLargoCuenta\(/);
    assert.match(form, /avisoCci\(/);
    assert.match(form, /\{6,25\}/, 'el formulario acepta de 6 a 25 como el servidor');
    assert.doesNotMatch(form, /validate:[^\n]*avisoLargo|validate:[^\n]*avisoCodigo/, 'los avisos no entran en la validación: nunca bloquean');
    assert.match(form, /label="Moneda"/);
    assert.match(form, /ENTIDAD_OTRA/);
  });

  it('el vecino ve la instrucción de recaudación, la moneda y el nombre real de la entidad', () => {
    const como = leer('residente/_parts/ComoPagar.tsx');
    assert.match(como, /m\.instruccion/);
    assert.match(como, /m\.entidad/);
    assert.match(como, /moneda_nombre/);
    assert.match(como, /dólares/);
  });

  it('el recibo imprimible muestra moneda, entidad e instrucción de recaudación', () => {
    const recibo = leer('shared/mantenimiento/ReciboImprimible.tsx');
    assert.match(recibo, /m\.instruccion/);
    assert.match(recibo, /m\.entidad/);
    assert.match(recibo, /moneda_nombre/);
  });
});
