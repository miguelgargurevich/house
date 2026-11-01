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
    assert.match(html, /Desde S\/\s*132\.09 al mes \+ IGV\./, 'el mínimo de Pro en soles sale del catálogo');
    assert.doesNotMatch(html, /incluye hasta|desde el 18/, 'sin «incluye hasta» ni «desde el 18»: el mínimo se dice sólo en soles');
  });

  it('los botones: Gratis «Crear cuenta gratis», Pro «Empezar con Torre Pro» y, debajo, «Ver mi total»; Administradora sólo «Ver mi total» (a la calculadora)', () => {
    const html = enRuta(createElement(Planes, { cat: cat(), onCalcular: () => undefined }));
    assert.match(html, /href="\/registro"[^>]*>Crear cuenta gratis/);
    assert.match(html, /href="\/registro"[^>]*>Empezar con Torre Pro/);
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

describe('precio por tramos en /precios y en las pantallas de planes', () => {
  /** El catálogo de arriba con tramo en Pro (desde el 41 a 3.33) y en Administradora (desde el 31 a 2.22); Gratis sin tramo. */
  const catTramos = (): Catalogo => {
    const c = cat();
    c.planes = c.planes.map(p => (p.clave === 'pro' ? { ...p, tramo_desde: 41, tramo_precio: '3.33' } : p.clave === 'administradora' ? { ...p, tramo_desde: 31, tramo_precio: '2.22' } : { ...p, tramo_desde: null, tramo_precio: null }));
    return c;
  };
  const tarjeta = (html: string, nombre: string) => new RegExp(`<article[^>]*>(?:(?!</article>).)*<h3[^>]*>${nombre}</h3>.*?</article>`).exec(html)?.[0] ?? '';

  it('la tarjeta de Pro y la de Administradora dicen el mínimo en soles y el tramo («; desde el departamento 41, S/ 3.33 cada uno»), tomado del catálogo', () => {
    const html = enRuta(createElement(Planes, { cat: catTramos(), onCalcular: () => undefined }));
    assert.match(tarjeta(html, 'Pro'), /Desde S\/\s*132\.09 al mes \+ IGV; desde el departamento 41, S\/\s*3\.33 cada uno\./);
    assert.match(tarjeta(html, 'Administradora'), /Desde S\/\s*94\.35 al mes \+ IGV; desde el departamento 31, S\/\s*2\.22 cada uno\./);
    assert.equal((tarjeta(html, 'Pro').match(/desde el departamento 41/g) ?? []).length, 1, 'el tramo se dice una sola vez en la tarjeta (no hay una línea aparte debajo del precio)');
  });

  it('con los valores de fábrica (Pro 3.00 y 61 a 2.00; Administradora 2.50 y 61 a 1.70) la tarjeta dice exactamente lo que pidió Miguel', () => {
    const c = cat();
    c.planes = c.planes.map(p => (p.clave === 'pro'
      ? { ...p, precio_por_unidad: '3.00', unidades_minimas: 20, total_minimo_mes: '60.00', tramo_desde: 61, tramo_precio: '2.00' }
      : p.clave === 'administradora'
        ? { ...p, precio_por_unidad: '2.50', unidades_minimas: 20, total_minimo_mes: '50.00', tramo_desde: 61, tramo_precio: '1.70' }
        : p));
    const html = enRuta(createElement(Planes, { cat: c, onCalcular: () => undefined }));
    assert.match(tarjeta(html, 'Pro'), /Desde S\/\s*60\.00 al mes \+ IGV; desde el departamento 61, S\/\s*2\.00 cada uno\./);
    assert.match(tarjeta(html, 'Administradora'), /Desde S\/\s*50\.00 al mes \+ IGV; desde el departamento 61, S\/\s*1\.70 cada uno\./);
  });

  it('la frase del tramo de la tarjeta: sólo el tramo (desde el departamento N), sin tramo, con un solo campo, desde el 1 o sin precio', async () => {
    const { tramoDeTarjeta } = await import('../src/pages/publico/precios/tramo');
    const f = (monto: string) => `S/ ${monto}`;
    const base = cat().planes.find(p => p.clave === 'pro')!; // precio 7.77
    assert.equal(tramoDeTarjeta({ ...base, tramo_desde: 61, tramo_precio: '2.00' }, 'PEN', f), '; desde el departamento 61, S/ 2.00 cada uno');
    assert.equal(tramoDeTarjeta({ ...base, tramo_desde: 2, tramo_precio: '2.00' }, 'PEN', f), '; desde el departamento 2, S/ 2.00 cada uno', 'desde el 2 ya es un tramo');
    assert.equal(tramoDeTarjeta({ ...base, tramo_desde: null, tramo_precio: null }, 'PEN', f), '', 'sin tramo, nada');
    assert.equal(tramoDeTarjeta({ ...base, tramo_desde: 61, tramo_precio: null }, 'PEN', f), '', 'con sólo uno de los dos campos no hay tramo');
    assert.equal(tramoDeTarjeta({ ...base, tramo_desde: 1, tramo_precio: '2.00' }, 'PEN', f), '', 'un tramo desde el 1 no existe (igual que el servidor)');
    assert.equal(tramoDeTarjeta({ ...base, precio_por_unidad: null }, 'PEN', f), '', 'sin precio en la moneda no hay tramo');
  });

  it('Gratis y un plan sin tramo no dicen nada de tramos', () => {
    const html = enRuta(createElement(Planes, { cat: catTramos(), onCalcular: () => undefined }));
    assert.doesNotMatch(tarjeta(html, 'Gratis'), /desde el \d/);
    const sin = enRuta(createElement(Planes, { cat: cat(), onCalcular: () => undefined }));
    assert.doesNotMatch(sin, /por departamento desde el/);
  });

  it('la frase del tramo se parte en el celular (390 px): el párrafo no usa whitespace-nowrap y la tarjeta no fija un ancho', () => {
    const s = fuente('src/pages/publico/precios/Planes.tsx');
    const linea = /<p className=\{`([^`]*)`\}>\{texto\}<\/p>/.exec(s)?.[1] ?? ''; // el texto del precio base y el tramo viene de lib/seo/textos (textoTope)
    assert.ok(linea, 'el párrafo del precio base existe');
    assert.doesNotMatch(linea, /nowrap/);
    assert.doesNotMatch(s, /\bw-\[\d+px\]|\bmin-w-\[\d+(px|rem)\]/);
  });

  it('la nota de la comparativa menciona el tramo de Pro y el de Administradora', async () => {
    const { Comparativa } = await import('../src/pages/publico/precios/Comparativa');
    const html = enRuta(createElement(Comparativa, { cat: catTramos() }));
    assert.match(html, /Pro cobra S\/\s3\.33 por departamento desde el 41\./);
    assert.match(html, /S\/\s2\.22 desde el departamento 31/);
    assert.doesNotMatch(enRuta(createElement(Comparativa, { cat: cat() })), /por departamento desde el|desde el departamento/);
  });

  it('la calculadora arma el desglose con la cotización del servidor y el catálogo (sin cifras escritas a mano), y no muestra el total anual', () => {
    const s = fuente(RECIBO);
    assert.match(s, /desglosar\(\{/);
    assert.match(s, /tramo_desde: r\.tramo_desde \?\? null/);
    assert.match(s, /decimales: decimalesDe\(moneda\)/);
    assert.match(s, /Promedio por departamento/);
    assert.doesNotMatch(s, /al año|total_anio/, 'sin el total anual');
    assert.match(fuente('src/pages/publico/precios/useTotal.ts'), /tramo_desde\?: number \| null; tramo_precio\?: string \| null; unidades_tramo\?: number/);
  });

  it('Mi plan muestra el detalle de las dos líneas (unidades × precio = base) sólo cuando hay más de una', () => {
    const s = fuente('src/pages/admin/MiPlan.tsx');
    assert.match(s, /c\.cotizacion\.lineas\?\.length \?\? 0\) > 1/);
    assert.match(s, /l\.unidades\} \{l\.unidades === 1 \? 'departamento' : 'departamentos'\} × \{dinero\(l\.precio_unidad_base, c\.moneda\)\} = \{dinero\(l\.base, c\.moneda\)\}/);
    assert.match(fuente('src/pages/shared/_parts/comercial.ts'), /lineas\?: LineaCotizacion\[\]/);
  });

  it('Superadmin › Precios edita «Desde el departamento» y «Precio desde ahí» por plan, y el precio de tramo por moneda; los manda al servidor', () => {
    const s = fuente('src/pages/superadmin/_parts/suscripciones/Precios.tsx');
    assert.match(s, /label="Desde el departamento \(precio por tramos\)"/);
    assert.match(s, /label="Precio desde ahí \(S\/, sin impuesto\)"/);
    assert.match(s, /tramo_desde: tramoDesde\.trim\(\) \? Number\(tramoDesde\) : null, tramo_precio: tramoPrecio\.trim\(\) \? tramoPrecio\.trim\(\) : null/);
    const m = fuente('src/pages/superadmin/_parts/suscripciones/ImpuestosPais.tsx');
    assert.match(m, /tramo_precio_por_unidad: tramo\.trim\(\) \? tramo\.trim\(\) : null/);
    assert.match(m, /const conTramo = plan\.tramo_desde != null/);
  });
});
