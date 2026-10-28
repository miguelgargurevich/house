// Página pública de precios (/precios): se renderizan los componentes de verdad (react-dom/server) con un catálogo de prueba.
// Los precios salen del catálogo (nunca del código) y, con el registro cerrado, ningún botón ofrece «Crear cuenta».
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { before, describe, it } from 'node:test';
import type { Catalogo } from '../src/pages/publico/catalogo';

let Planes: typeof import('../src/pages/publico/precios/Planes').Planes;
let Modulos: typeof import('../src/pages/publico/precios/Modulos').Modulos;
let Comparativa: typeof import('../src/pages/publico/precios/Comparativa').Comparativa;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ Planes } = await import('../src/pages/publico/precios/Planes'));
  ({ Modulos } = await import('../src/pages/publico/precios/Modulos'));
  ({ Comparativa } = await import('../src/pages/publico/precios/Comparativa'));
});

/** Precios INVENTADOS a propósito (no son los de producción): si el componente trae los suyos, el test lo nota. */
const cat = (abierto: boolean): Catalogo => ({
  registro_abierto: abierto,
  planes: [
    { clave: 'gratis', nombre: 'Gratis', descripcion: 'Para siempre.', precio_por_unidad: '0.00', modulos_incluidos: [], caracteristicas: ['Recibos por torre', 'Portal del residente'] },
    { clave: 'pro', nombre: 'Pro', descripcion: 'Los tres módulos y más.', precio_por_unidad: '7.77', modulos_incluidos: ['ia_vouchers', 'asistente'], caracteristicas: ['Todo lo de Gratis', 'IA que lee y valida vouchers', 'Mora automática'] },
    { clave: 'administradora', nombre: 'Administradora', descripcion: 'Varios condominios.', precio_por_unidad: '5.55', modulos_incluidos: ['ia_vouchers', 'asistente'], caracteristicas: ['Todo lo de Pro', 'Descuento por volumen'] },
  ],
  modulos: [
    { clave: 'ia_vouchers', nombre: 'IA que lee y valida vouchers', descripcion: 'Lee cada comprobante.', precio_por_unidad: '3.33' },
    { clave: 'asistente', nombre: 'Asistente con IA', descripcion: 'Responde dudas.', precio_por_unidad: '1.11' },
  ],
});
const enRuta = (el: React.ReactElement) => renderToStaticMarkup(createElement(StaticRouter, { location: '/precios' }, el));
const sinCalcular = () => undefined;

describe('página pública de precios', () => {
  it('los precios de los planes, los módulos y la comparativa salen del catálogo', () => {
    const html = enRuta(createElement('div', null, createElement(Planes, { cat: cat(true), onCalcular: sinCalcular }), createElement(Modulos, { cat: cat(true), planClave: 'gratis', elegidos: [], onAlternar: sinCalcular, onSolo: sinCalcular }), createElement(Comparativa, { cat: cat(true) })));
    for (const precio of ['7.77', '5.55', '3.33', '1.11']) assert.ok(html.includes(precio), `falta ${precio}`);
    assert.match(html, /S\/\s*0/, 'Gratis se muestra en cero');
  });

  it('con el registro abierto, los planes llevan a /registro', () => {
    const html = enRuta(createElement(Planes, { cat: cat(true), onCalcular: sinCalcular }));
    assert.match(html, /href="\/registro"[^>]*>Empezar con Pro/);
    assert.match(html, /href="\/registro"[^>]*>Crear cuenta gratis/);
    assert.doesNotMatch(html, /href="\/login"/);
  });

  it('con el registro cerrado, ningún plan ofrece «Crear cuenta»: queda «Ingresar»', () => {
    const html = enRuta(createElement(Planes, { cat: cat(false), onCalcular: sinCalcular }));
    assert.doesNotMatch(html, /\/registro/);
    assert.doesNotMatch(html, /Crear cuenta/);
    assert.match(html, /href="\/login"[^>]*>Ingresar/);
  });

  it('un módulo que el plan ya trae no se vende suelto: dice «Incluido en …»; con Gratis se puede sumar', () => {
    const pro = enRuta(createElement(Modulos, { cat: cat(true), planClave: 'pro', elegidos: [], onAlternar: sinCalcular, onSolo: sinCalcular }));
    assert.match(pro, /Incluido en Pro/);
    assert.doesNotMatch(pro, /Sumar a mi recibo/);
    const gratis = enRuta(createElement(Modulos, { cat: cat(true), planClave: 'gratis', elegidos: ['asistente'], onAlternar: sinCalcular, onSolo: sinCalcular }));
    assert.match(gratis, /Sumado a tu recibo/);
    assert.match(gratis, /Sumar a mi recibo/);
  });

  it('el recibo no deja desmarcar un módulo del plan y sólo cotiza los sueltos', () => {
    // Se lee la fuente: renderizarlo arrastraría `src/api.ts`, que necesita `import.meta.env` (sólo existe bajo Vite).
    const r = readFileSync('src/pages/publico/precios/Recibo.tsx', 'utf8');
    assert.match(r, /const sueltos = modulos\.filter\(m => !incluidos\.includes\(m\)\)/);
    assert.match(r, /useTotal\(n, plan\?\.clave \?\? null, sueltos,/);
    assert.match(r, /disabled=\{trae\}/);
  });

  it('el frontend no escribe los precios publicados ni calcula el total: lo pide al servidor', () => {
    const carpeta = 'src/pages/publico';
    const archivos = [`${carpeta}/Precios.tsx`, ...readdirSync(`${carpeta}/precios`).map(f => `${carpeta}/precios/${f}`)];
    for (const a of archivos) assert.doesNotMatch(readFileSync(a, 'utf8'), /\b(2\.95|2\.36|1\.18|0\.59|2\.50|2\.00)\b/, `${a}: precio de un plan o módulo escrito a mano`);
    assert.match(readFileSync(`${carpeta}/precios/useTotal.ts`, 'utf8'), /\/api\/publico\/cotizar/);
  });

  it('el marco público sólo ofrece «Crear cuenta» con el registro abierto', () => {
    const s = readFileSync('src/pages/publico/Marco.tsx', 'utf8');
    assert.match(s, /\{data\?\.registro_abierto && <Link to="\/registro"/);
  });
});
