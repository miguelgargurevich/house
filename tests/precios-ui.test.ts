// Página de precios como oferta: tarjetas de nivel debajo del hero, Pro destacada, calculadora al final y sin sticky.
// Las tarjetas se renderizan de verdad (react-dom/server); la forma de la página se fija con la fuente.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { before, describe, it } from 'node:test';
import type { Catalogo } from '../src/pages/publico/catalogo';

let Planes: typeof import('../src/pages/publico/precios/Planes').Planes;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ Planes } = await import('../src/pages/publico/precios/Planes'));
});

/** Catálogo de prueba con cifras INVENTADAS: si la tarjeta trae otras, es que las escribió a mano. */
const cat = (): Catalogo => ({
  registro_abierto: true,
  dias_gratis: 90,
  pais: 'PE', moneda: 'PEN', impuesto: { nombre: 'IGV', tasa: '0.18' },
  paises: [{ codigo: 'PE', nombre: 'Perú', bandera: '🇵🇪', moneda: 'PEN', impuesto: { nombre: 'IGV', tasa: '0.18' } }],
  planes: [
    { clave: 'gratis', nombre: 'Gratis', descripcion: 'Para empezar.', precio_por_unidad: '0.00', consultar: false, modulos_incluidos: [], caracteristicas: ['Recibos por torre', 'Portal del vecino'], unidades_maximas: 13, unidades_minimas: null, total_minimo_mes: null },
    { clave: 'pro', nombre: 'Pro', descripcion: 'Para juntas grandes.', precio_por_unidad: '7.77', consultar: false, modulos_incluidos: ['ia_vouchers'], caracteristicas: ['Todo lo de Gratis', 'IA que lee vouchers'], unidades_maximas: null, unidades_minimas: 17, total_minimo_mes: '132.09' },
    { clave: 'administradora', nombre: 'Administradora', descripcion: 'Varios condominios.', precio_por_unidad: '5.55', consultar: false, modulos_incluidos: ['ia_vouchers'], caracteristicas: ['Todo lo de Pro'], unidades_maximas: null, unidades_minimas: 17, total_minimo_mes: '94.35' },
  ],
  modulos: [{ clave: 'ia_vouchers', nombre: 'IA que lee vouchers', descripcion: 'Lee cada comprobante.' }],
});

const enRuta = (el: React.ReactElement) => renderToStaticMarkup(createElement(StaticRouter, { location: '/precios' }, el));
const fuente = (ruta: string) => readFileSync(ruta, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const PAGINA = 'src/pages/publico/Precios.tsx';
const RECIBO = 'src/pages/publico/precios/Recibo.tsx';

describe('página de precios como oferta', () => {
  it('cada plan de cat es una tarjeta, en el orden Gratis, Pro, Administradora, y Pro lleva la etiqueta «Más elegido»', () => {
    const html = enRuta(createElement(Planes, { cat: cat(), onCalcular: () => undefined }));
    const tarjetas = [...html.matchAll(/<article[^>]*>.*?<h3[^>]*>([^<]+)<\/h3>/g)].map(m => m[1]);
    assert.deepEqual(tarjetas, ['Gratis', 'Pro', 'Administradora']);
    const pro = /<article[^>]*border-brand[^>]*>.*?<\/article>/.exec(html)?.[0] ?? '';
    assert.match(pro, /Más elegido/, 'Pro es la destacada');
    assert.doesNotMatch(html.replace(pro, ''), /Más elegido/, 'sólo una tarjeta lleva la etiqueta');
  });

  it('cada tarjeta trae el «para quién» (descripción), el precio con su unidad y las características del catálogo', () => {
    const html = enRuta(createElement(Planes, { cat: cat(), onCalcular: () => undefined }));
    for (const dato of ['Para empezar.', 'Para juntas grandes.', 'Varios condominios.', '7.77', '5.55', 'por departamento al mes + IGV', 'IA que lee vouchers', 'Todo lo de Pro']) {
      assert.ok(html.includes(dato), `falta «${dato}»`);
    }
    assert.match(html, /S\/ 0/, 'Gratis muestra cero');
    assert.match(html, /Mínimo de 17 departamentos cobrados por condominio · desde S\/ 132\.09 al mes \+ IGV\./, 'el mínimo de Pro sale del catálogo');
  });

  it('los botones: Gratis «Crear cuenta gratis», Pro «Empezar con Pro» y, debajo, «Ver mi total»; Administradora sólo «Ver mi total» (a la calculadora)', () => {
    const html = enRuta(createElement(Planes, { cat: cat(), onCalcular: () => undefined }));
    assert.match(html, /href="\/registro"[^>]*>Crear cuenta gratis/);
    assert.match(html, /href="\/registro"[^>]*>Empezar con Pro/);
    assert.equal([...html.matchAll(/href="#recibo"[^>]*>Ver mi total/g)].length, 2, 'Pro y Administradora llevan a la calculadora');
  });

  it('las cuatro tarjetas van en fila en pantalla ancha (xl), de dos en dos en tableta y apiladas en el celular, con botones alineados abajo (mt-auto)', () => {
    const s = fuente('src/pages/publico/precios/Planes.tsx');
    assert.match(s, /grid items-stretch gap-5 sm:grid-cols-2 xl:grid-cols-4/);
    assert.match(s, /mt-auto flex flex-col gap-3 pt-8/);
  });

  it('la página abre con el hero corto y las tarjetas van justo debajo; no hay botón «Calcula tu recibo» en el hero', () => {
    const s = fuente(PAGINA);
    assert.doesNotMatch(s, /Calcula tu recibo/);
    assert.doesNotMatch(s, /href="#recibo"/, 'el hero no enlaza a la calculadora');
    const orden = ['<Planes ', '<Modulos ', '<Recibo '].map(t => s.indexOf(t));
    assert.ok(orden.every(i => i > 0), 'están las tres secciones');
    assert.deepEqual([...orden].sort((a, b) => a - b), orden, 'oferta, luego lo que trae Pro, luego la calculadora');
  });

  it('la calculadora es una sección propia «Calcula cuánto pagarías», sin sticky y a ancho cómodo', () => {
    assert.match(fuente(RECIBO), /Calcula cuánto pagarías/);
    assert.match(fuente(RECIBO), /lg:grid lg:grid-cols-2/, 'en escritorio, formulario y total lado a lado');
    for (const f of [PAGINA, RECIBO, 'src/pages/publico/precios/Planes.tsx', 'src/pages/publico/precios/Modulos.tsx']) {
      assert.doesNotMatch(fuente(f), /sticky/, `${f} no debe ser sticky`);
    }
  });
});
