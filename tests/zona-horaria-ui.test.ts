// Zona horaria por condominio en el frontend: el selector (render real con react-dom/server) y la fuente de la ficha, el detalle y los contratos.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { before, describe, it } from 'node:test';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

let SelectorPaisMoneda: typeof import('../src/pages/admin/_parts/condominio/SelectorPaisMoneda').SelectorPaisMoneda;
let etiquetaZona: typeof import('../src/pages/admin/_parts/condominio/SelectorPaisMoneda').etiquetaZona;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ SelectorPaisMoneda, etiquetaZona } = await import('../src/pages/admin/_parts/condominio/SelectorPaisMoneda'));
});

describe('selector de zona horaria del condominio', () => {
  const sel = (valor: { pais: string; moneda: string; zona: string }, alCrear = false) => renderToStaticMarkup(createElement(SelectorPaisMoneda, { valor, onCambio: () => undefined, alCrear }));

  it('un país con varias zonas ofrece las suyas, con la elegida marcada; no ofrece las de otros países', () => {
    const h = sel({ pais: 'MX', moneda: 'MXN', zona: 'America/Cancun' });
    assert.match(h, /Zona horaria/);
    for (const z of ['America/Mexico_City', 'America/Cancun', 'America/Tijuana']) assert.match(h, new RegExp(`<option value="${z}"`), z);
    assert.match(h, /<option value="America\/Cancun" selected="">/);
    assert.doesNotMatch(h, /<option value="Europe\/Madrid"/);
    assert.doesNotMatch(h, /<option value="America\/Lima"/);
  });

  it('Perú: una sola zona; España: Península, Canarias y Ceuta', () => {
    const pe = sel({ pais: 'PE', moneda: 'PEN', zona: 'America/Lima' });
    assert.equal(pe.match(/<option value="[A-Za-z_/]+\/[A-Za-z_]+"/g)?.length, 1);
    const es = sel({ pais: 'ES', moneda: 'EUR', zona: 'Europe/Madrid' });
    for (const z of ['Europe/Madrid', 'Atlantic/Canary', 'Africa/Ceuta']) assert.match(es, new RegExp(`<option value="${z}"`), z);
  });

  it('si el condominio ya tiene una zona que no es de su país, también se ofrece (no se pierde al abrir la ficha)', () => {
    assert.match(sel({ pais: 'PE', moneda: 'PEN', zona: 'Europe/Madrid' }), /<option value="Europe\/Madrid" selected="">/);
  });

  it('al crear: «la de su país» con la zona que se propondría; sin país elegido, sólo esa opción', () => {
    const conPais = sel({ pais: 'CL', moneda: '', zona: '' }, true);
    assert.match(conPais, /La de su país \(Santiago \(GMT[−-]\d\)\)/);
    assert.match(conPais, /<option value="" selected="">La de su país/);
    const sinPais = sel({ pais: '', moneda: '', zona: '' }, true);
    assert.doesNotMatch(sinPais, /<option value="America\//);
  });

  it('etiquetaZona: la ciudad y el desfase de hoy (el de verano o el de invierno)', () => {
    assert.match(etiquetaZona('America/Argentina/Buenos_Aires'), /^Buenos Aires \(GMT[−-]3\)$/);
    assert.equal(etiquetaZona('Europe/Madrid', new Date('2026-07-01T12:00:00Z')).replace('−', '-'), 'Madrid (GMT+2)');
    assert.equal(etiquetaZona('Europe/Madrid', new Date('2026-12-01T12:00:00Z')).replace('−', '-'), 'Madrid (GMT+1)');
    assert.equal(etiquetaZona('Zona/Inventada'), 'Inventada');
  });
});

describe('fuente: la zona viaja con el condominio', () => {
  it('la ficha propone la zona del país al elegirlo y manda zona_horaria al guardar', () => {
    const selector = fuente('src/pages/admin/_parts/condominio/SelectorPaisMoneda.tsx');
    assert.match(selector, /zona: pais \? zonaDelPais\(pais\) : ''/);
    const modal = fuente('src/pages/admin/_parts/condominio/ModalDeComplejo.tsx');
    assert.match(modal, /if \(paisMoneda\.zona\) body\.zona_horaria = paisMoneda\.zona/);
    assert.match(modal, /zona: complejo\.zona_horaria \?\? ZONA_POR_DEFECTO/);
  });

  it('el detalle del condominio muestra su zona y el contrato nuevo empieza el día de hoy en esa zona', () => {
    assert.match(fuente('src/pages/admin/CondominioDetalle.tsx'), /label: 'Zona horaria', value: etiquetaZona\(c\.zona_horaria \?\? ZONA_POR_DEFECTO\)/);
    const contratos = fuente('src/pages/admin/_parts/personas/ContratosModal.tsx');
    assert.match(contratos, /hoyEn\(complejo\.zona_horaria \?\? ZONA_POR_DEFECTO\)/);
    assert.doesNotMatch(contratos, /America\/Lima/, 'ya no fija la hora de Lima');
  });
});
