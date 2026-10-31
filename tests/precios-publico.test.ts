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
let Preguntas: typeof import('../src/pages/publico/precios/Preguntas').Preguntas;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ Planes } = await import('../src/pages/publico/precios/Planes'));
  ({ Modulos } = await import('../src/pages/publico/precios/Modulos'));
  ({ Comparativa } = await import('../src/pages/publico/precios/Comparativa'));
  ({ Preguntas } = await import('../src/pages/publico/precios/Preguntas'));
});

/** Precios, topes y mínimos INVENTADOS a propósito (no son los de producción): si el componente trae los suyos, el test lo nota. */
const cat = (abierto: boolean): Catalogo => ({
  registro_abierto: abierto,
  dias_gratis: 90,
  pais: 'PE', moneda: 'PEN', impuesto: { nombre: 'IGV', tasa: '0.18' },
  paises: [{ codigo: 'PE', nombre: 'Perú', bandera: '🇵🇪', moneda: 'PEN', impuesto: { nombre: 'IGV', tasa: '0.18' } }, { codigo: 'CL', nombre: 'Chile', bandera: '🇨🇱', moneda: 'CLP', impuesto: { nombre: 'IVA', tasa: '0.19' } }],
  planes: [
    { clave: 'gratis', nombre: 'Gratis', descripcion: 'Para siempre.', precio_por_unidad: '0.00', consultar: false, modulos_incluidos: [], caracteristicas: ['1 condominio', 'Hasta 13 departamentos', 'Recibos por torre', 'Portal del vecino'], unidades_maximas: 13, unidades_minimas: null, total_minimo_mes: null },
    { clave: 'pro', nombre: 'Pro', descripcion: 'Todo House.', precio_por_unidad: '7.77', consultar: false, modulos_incluidos: ['ia_vouchers', 'asistente', 'mora_automatica', 'reportes'], caracteristicas: ['Todo lo de Gratis, sin tope de departamentos', 'IA que lee y valida vouchers', 'Mora automática', 'Reportes y exportes'], unidades_maximas: null, unidades_minimas: 17, total_minimo_mes: '132.09' },
    { clave: 'administradora', nombre: 'Administradora', descripcion: 'Varios condominios.', precio_por_unidad: '5.55', consultar: false, modulos_incluidos: ['ia_vouchers', 'asistente', 'mora_automatica', 'reportes'], caracteristicas: ['Todo lo de Pro', 'Descuento por volumen'], unidades_maximas: null, unidades_minimas: 17, total_minimo_mes: '94.35' },
  ],
  modulos: [
    { clave: 'ia_vouchers', nombre: 'IA que lee y valida vouchers', descripcion: 'Lee cada comprobante.' },
    { clave: 'asistente', nombre: 'Asistente con IA', descripcion: 'Responde dudas.' },
  ],
});
const enRuta = (el: React.ReactElement) => renderToStaticMarkup(createElement(StaticRouter, { location: '/precios' }, el));
const sinCalcular = () => undefined;

describe('página pública de precios', () => {
  it('los precios y los topes de los planes salen del catálogo; los módulos ya no llevan precio', () => {
    const html = enRuta(createElement('div', null, createElement(Planes, { cat: cat(true), onCalcular: sinCalcular }), createElement(Modulos, { cat: cat(true), onCalcular: sinCalcular }), createElement(Comparativa, { cat: cat(true) })));
    for (const dato of ['7.77', '5.55', '132.09', '94.35']) assert.ok(html.includes(dato), `falta ${dato}`);
    assert.match(html, /S\/\s*0/, 'Gratis se muestra en cero');
    assert.match(html, /Hasta 13 departamentos por condominio/, 'el tope de Gratis viene del catálogo');
    assert.match(html, /Mínimo de 17 departamentos cobrados por condominio · desde S\/\s*132\.09 al mes/, 'el mínimo de Pro y su total salen del catálogo');
  });

  it('los módulos se presentan como «lo que trae Pro»: sin precio, sin botón de sumar', () => {
    const html = enRuta(createElement(Modulos, { cat: cat(true), onCalcular: sinCalcular }));
    assert.match(html, /Lo que trae Pro/);
    assert.match(html, /IA que lee y valida vouchers/);
    assert.doesNotMatch(html, /Sumar a mi recibo|Sumado a tu recibo|por departamento al mes|Ver solo este módulo/);
    assert.doesNotMatch(html, /7\.77|5\.55|\b132\.09\b/, 'ni el precio de un plan');
  });

  it('la comparativa es Gratis vs Pro: Gratis sin IA, WhatsApp, asistente, mora ni reportes; Pro con todo; sin columna de módulo suelto', () => {
    const html = enRuta(createElement(Comparativa, { cat: cat(true) }));
    assert.doesNotMatch(html, /Módulo suelto/);
    // «1 condominio» con ✓ en todas las columnas hacía creer que los planes de pago traían uno solo: ahora es una fila con cuántos trae cada plan.
    assert.doesNotMatch(html, /<th[^>]*>1 condominio<\/th>/, 'la viñeta «1 condominio» no va como fila con ✓');
    assert.match(html, /<th[^>]*>Condominios por cuenta<\/th><td[^>]*>1<\/td><td[^>]*>Los que quieras<\/td><\/tr>/, 'sin Básico en este catálogo: Gratis y Pro');
    assert.match(html, /Cada condominio tiene su propio plan/);
    const fila = (nombre: string) => new RegExp(`<tr[^>]*><th[^>]*>${nombre}</th>(.*?)</tr>`).exec(html)?.[1] ?? '';
    const marcas = (celdas: string) => [...celdas.matchAll(/<span class="sr-only">(Incluido|No incluido)<\/span>/g)].map(m => m[1]);
    for (const nombre of ['IA que lee y valida vouchers', 'Asistente con IA', 'Mora automática', 'Reportes y exportes']) {
      assert.deepEqual(marcas(fila(nombre)), ['No incluido', 'Incluido'], `${nombre}: ✗ en Gratis, ✓ en Pro`);
    }
    assert.deepEqual(marcas(fila('Recibos por torre')), ['Incluido', 'Incluido'], 'lo de Gratis también está en Pro');
    assert.match(fila('Departamentos por condominio'), /Hasta 13/);
    assert.match(fila('Departamentos por condominio'), /Sin tope/);
    assert.doesNotMatch(html, /<th[^>]*>Hasta 13 departamentos<\/th>/, 'la viñeta del tope no se repite como función');
  });

  it('las preguntas frecuentes toman el tope y el mínimo del catálogo (no los escriben)', () => {
    const html = enRuta(createElement(Preguntas, { cat: cat(true) }));
    assert.match(html, /llega hasta 13 departamentos por condominio/);
    assert.match(html, /como mínimo 17 departamentos/);
    assert.doesNotMatch(html, /módulo suelto|sin límite de departamentos/i);
  });

  it('con el registro abierto, los planes llevan a /registro', () => {
    const html = enRuta(createElement(Planes, { cat: cat(true), onCalcular: sinCalcular }));
    assert.match(html, /href="\/registro"[^>]*>Empezar con Torre Pro/);
    assert.match(html, /href="\/registro"[^>]*>Crear cuenta gratis/);
    assert.doesNotMatch(html, /href="\/login"/);
  });

  it('con el registro cerrado, ningún plan ofrece «Crear cuenta»: queda «Ingresar»', () => {
    const html = enRuta(createElement(Planes, { cat: cat(false), onCalcular: sinCalcular }));
    assert.doesNotMatch(html, /\/registro/);
    assert.doesNotMatch(html, /Crear cuenta/);
    assert.match(html, /href="\/login"[^>]*>Ingresar/);
  });

  it('el recibo (calculadora) no tiene casillas de módulos: cotiza sólo el plan y avisa del tope y del mínimo', () => {
    // Se lee la fuente: renderizarlo arrastraría `src/api.ts`, que necesita `import.meta.env` (sólo existe bajo Vite).
    const r = readFileSync('src/pages/publico/precios/Recibo.tsx', 'utf8');
    assert.doesNotMatch(r, /type="checkbox"|sueltos|modulos:/);
    assert.match(r, /useTotal\(n, plan\?\.clave \?\? null, cat\.pais, valido && !!plan\)/, 'la calculadora cotiza con el país elegido');
    assert.match(r, /const excede = tope != null && n > tope/);
    assert.match(r, /total\.r\.minimo_aplicado/);
    const t = readFileSync('src/pages/publico/precios/useTotal.ts', 'utf8');
    assert.doesNotMatch(t, /modulos/, 'la cotización pública ya no lleva módulos sueltos');
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

/** Chile: pesos sin decimales e IVA 19 %; Pro con precio, Administradora sin precio en pesos («Consúltanos»). */
const catChile = (): Catalogo => {
  const base = cat(true);
  return {
    ...base, pais: 'CL', moneda: 'CLP', impuesto: { nombre: 'IVA', tasa: '0.19' },
    planes: base.planes.map(p => (p.clave === 'pro' ? { ...p, precio_por_unidad: '1900', total_minimo_mes: '38000' } : p.clave === 'administradora' ? { ...p, precio_por_unidad: null, consultar: true, total_minimo_mes: null } : { ...p, precio_por_unidad: '0' })),
  };
};

describe('/precios por país: moneda, precios e impuesto del país elegido', () => {
  it('Perú: «S/ 7.77 por departamento al mes + IGV», como siempre', () => {
    const html = enRuta(createElement(Planes, { cat: cat(true), onCalcular: sinCalcular }));
    assert.match(html, /S\/\u00a07\.77/);
    assert.match(html, /por departamento al mes \+ IGV/);
    assert.doesNotMatch(html, /IVA|Consúltanos/);
  });

  it('Chile: «$ 1.900 por departamento al mes + IVA», mínimo en pesos, y «Consúltanos» donde no hay precio; sin «S/» ni «IGV»', () => {
    const html = enRuta(createElement(Planes, { cat: catChile(), onCalcular: sinCalcular }) );
    assert.match(html, /\$\u00a01\.900/);
    assert.match(html, /por departamento al mes \+ IVA/);
    assert.match(html, /desde \$\u00a038\.000 al mes \+ IVA/);
    assert.match(html, /Consúltanos/, 'Administradora no tiene precio en pesos');
    assert.doesNotMatch(html, /S\/|IGV|5\.55/);
    assert.match(html, /\$\u00a00/, 'Gratis es $ 0 para siempre');
  });

  it('la comparativa y las preguntas hablan con el impuesto del país (IVA) y no con un «IGV» fijo', () => {
    const c = catChile();
    const comp = enRuta(createElement(Comparativa, { cat: c }));
    assert.match(comp, /sin IVA/);
    assert.match(comp, /\$\u00a01\.900/);
    assert.match(comp, /precio a consultar/);
    assert.doesNotMatch(comp, /IGV|S\//);
    const preg = enRuta(createElement(Preguntas, { cat: c }));
    assert.match(preg, /¿El precio incluye IVA\?/);
    assert.doesNotMatch(preg, /IGV/);
    const sinImpuesto = enRuta(createElement(Preguntas, { cat: { ...c, impuesto: { nombre: 'Impuesto', tasa: '0' } } }));
    assert.match(sinImpuesto, /no se suma ningún impuesto/);
  });

  it('el selector lista los países abiertos con su bandera, avisa moneda e impuesto y está etiquetado', async () => {
    const { SelectorPais } = await import('../src/pages/publico/precios/SelectorPais');
    const html = enRuta(createElement(SelectorPais, { cat: catChile() }));
    assert.match(html, /<label[^>]*>Precios para<\/label>/);
    assert.match(html, /<option value="PE">🇵🇪 Perú<\/option>/);
    assert.match(html, /<option value="CL" selected="">🇨🇱 Chile<\/option>/);
    assert.match(html, /se cobra en pesos chilenos, más IVA/);
  });

  it('la elección de país se recuerda por visitante en localStorage, siempre dentro de try/catch, y se pide al servidor con ?pais=', () => {
    assert.match(readFileSync('src/pages/publico/catalogo.ts', 'utf8'), /\/api\/publico\/planes\?pais=/);
    const f = readFileSync('src/pages/publico/paisElegido.ts', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const usos = f.match(/.*localStorage.*/g) ?? [];
    assert.equal(usos.length, 2, 'una lectura y una escritura');
    for (const uso of usos) assert.match(uso, /try \{.*\} catch/, `localStorage sin try/catch: ${uso.trim()}`);
    assert.match(f, /localStorage\.setItem\(CLAVE_PAIS/);
    assert.match(f, /localStorage\.getItem\(CLAVE_PAIS/);
    assert.match(readFileSync('src/pages/publico/Precios.tsx', 'utf8'), /<SelectorPais /);
  });

  it('la calculadora muestra «Consúltanos» cuando el plan no tiene precio en el país, y «Con IVA» con el impuesto del servidor', () => {
    const r = readFileSync('src/pages/publico/precios/Recibo.tsx', 'utf8');
    assert.match(r, /plan\?\.consultar/);
    assert.match(r, /Consúltanos/);
    assert.match(r, /Con \{total\.r\.impuesto_nombre\}/);
    assert.match(readFileSync('src/pages/publico/precios/useTotal.ts', 'utf8'), /pais/);
  });

  it('las pantallas públicas no escriben «IGV» ni «S/» (salvo comentarios): el impuesto y la moneda vienen del catálogo', () => {
    for (const f of ['Precios.tsx', 'Marco.tsx', 'precios/Planes.tsx', 'precios/Recibo.tsx', 'precios/Comparativa.tsx', 'precios/Preguntas.tsx', 'precios/SelectorPais.tsx']) {
      const src = readFileSync(`src/pages/publico/${f}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(src, /\bIGV\b|S\/\s?[\d$]/, `${f} lleva un IGV o un S/ fijo`);
    }
  });
});
