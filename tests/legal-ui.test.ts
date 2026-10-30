// Términos, Política de privacidad y consentimiento (Ley 29733): las rutas y los enlaces, la casilla del registro, la sección del
// superadmin, la versión que ve la página igual a la del servidor, y el texto de las páginas igual al de docs/legal/*.md.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, it } from 'node:test';
import { VERSION_LEGAL as VERSION_SERVIDOR } from '../src/server/services/comercial/legal';
import { VERSION_LEGAL as VERSION_PAGINA } from '../src/pages/publico/legal/version';
import { PENDIENTES, textosPrivacidad, textosTerminos, type Legal } from '../src/pages/publico/legal/textos';
import type { DatosLegales } from '../src/pages/publico/legal/datos';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const APP = fuente('src/App.tsx');
const MARCO = fuente('src/pages/publico/Marco.tsx');
const REGISTRO = fuente('src/pages/publico/Registro.tsx');
const LOGIN = fuente('src/pages/Login.tsx');
const PERFIL = fuente('src/pages/shared/Perfil.tsx');
const PRECIOS = fuente('src/pages/superadmin/_parts/suscripciones/Precios.tsx');
const TEXTOS = fuente('src/pages/publico/legal/textos.tsx');

const DATOS: DatosLegales = { razon_social: 'House Perú S.A.C.', ruc: '20601234567', domicilio: 'Av. Ejemplo 123, Surco, Lima', correo: 'privacidad@house.test', version: VERSION_SERVIDOR };

/** Renderiza un bloque de contenido tal como lo pinta la página (con el enrutador, para que los enlaces funcionen). */
const pintar = (el: unknown) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Fragment, null, el as never)));
const cuerpos = (l: Legal) => [...textosPrivacidad(l).secciones, ...textosTerminos(l).secciones].map((s) => s.cuerpo);
/** Texto visible: las etiquetas en línea (negrita, enlace) se quitan sin espacio; las de bloque separan palabras. */
const textoPlano = (html: string) => html.replace(/<\/?(strong|a|span|em|b)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

describe('rutas públicas y pie', () => {
  it('/privacidad y /terminos están en el enrutador, fuera de la sesión (como /precios)', () => {
    assert.match(APP, /<Route path="\/privacidad" element=\{<Privacidad \/>\} \/>/);
    assert.match(APP, /<Route path="\/terminos" element=\{<Terminos \/>\} \/>/);
    assert.match(APP, /const Privacidad = lazy\(\(\) => import\('\.\/pages\/publico\/Privacidad'\)\);/);
    assert.match(APP, /const Terminos = lazy\(\(\) => import\('\.\/pages\/publico\/Terminos'\)\);/);
    const antesDeSesion = APP.slice(0, APP.indexOf('<Route element={<RequireAuth />}>'));
    assert.match(antesDeSesion, /path="\/terminos"/);
    assert.match(antesDeSesion, /path="\/privacidad"/);
  });

  it('el pie de todas las páginas públicas enlaza «Privacidad · Términos»', () => {
    assert.match(MARCO, /<nav aria-label="Legal"[^>]*>\s*<Link to="\/privacidad"[^>]*>Privacidad<\/Link>\s*<span aria-hidden="true">·<\/span>\s*<Link to="\/terminos"[^>]*>Términos<\/Link>/);
  });

  it('el inicio de sesión y «Mi perfil» enlazan las dos políticas, en texto pequeño', () => {
    assert.match(LOGIN, /<p className="mt-4 text-center text-xs text-muted">Lee nuestros <Link to="\/terminos"[^>]*>Términos<\/Link> y nuestra <Link to="\/privacidad"[^>]*>Política de privacidad<\/Link>\.<\/p>/);
    assert.match(PERFIL, /import \{ Link \} from 'react-router-dom';/);
    assert.match(PERFIL, /Cómo tratamos tus datos: <Link to="\/privacidad"[^>]*>Política de privacidad<\/Link>/);
  });

  it('la activación de la cuenta por invitación dice que se aceptan los Términos y la Política, sin casilla', () => {
    const invitacion = fuente('src/pages/publico/Invitacion.tsx');
    assert.match(invitacion, /Al activar tu cuenta aceptas los <Link to="\/terminos"[^>]*>Términos<\/Link> y la <Link to="\/privacidad"[^>]*>Política de privacidad<\/Link>\./);
    assert.doesNotMatch(invitacion, /type="checkbox"/);
  });
});

describe('registro: la casilla es obligatoria y viaja con el envío', () => {
  it('la casilla dice «Acepto los Términos y condiciones y la Política de privacidad» y abre los dos en pestaña nueva', () => {
    assert.match(REGISTRO, /Acepto los <Link to="\/terminos" target="_blank" rel="noopener noreferrer"[^>]*>Términos y condiciones<\/Link> y la <Link to="\/privacidad" target="_blank" rel="noopener noreferrer"[^>]*>Política de privacidad<\/Link>/);
    assert.match(REGISTRO, /<input type="checkbox" checked=\{acepta\}/);
  });

  it('el botón se queda deshabilitado hasta marcar la casilla, y el envío manda acepta_terminos', () => {
    assert.match(REGISTRO, /<Button type="submit" loading=\{busy\} disabled=\{!completo \|\| !acepta\}/);
    assert.match(REGISTRO, /acepta_terminos: acepta/);
  });

  it('la casilla va antes del botón de crear la cuenta', () => {
    assert.ok(REGISTRO.indexOf('type="checkbox"') < REGISTRO.indexOf('Crear cuenta gratis</Button>'));
  });
});

describe('superadmin: los datos legales se editan en Precios, con su sección', () => {
  it('la sección «Datos legales» guarda razón social, RUC, domicilio y correo con PUT /api/comercial/configuracion', () => {
    assert.match(PRECIOS, /<CardHeader title="Datos legales"/);
    for (const k of ['legal_razon_social', 'legal_ruc', 'legal_domicilio', 'legal_correo']) assert.match(PRECIOS, new RegExp(`'${k}'`), k);
    assert.match(PRECIOS, /api\('\/api\/comercial\/configuracion', \{ method: 'PUT', json: f \}\)/);
  });

  it('el RUC pide 11 dígitos con teclado numérico', () => {
    assert.match(PRECIOS, /<Input label="RUC" inputMode="numeric" maxLength=\{11\}/);
  });
});

describe('versión legal: la página y el servidor dicen lo mismo', () => {
  it('VERSION_LEGAL de la página = la del servidor (la que se graba en cada cuenta)', () => {
    assert.equal(VERSION_PAGINA, VERSION_SERVIDOR);
    assert.equal(VERSION_PAGINA, '2026-10-30');
  });
});

describe('textos: fieles a docs/legal/*.md (autoritativos)', () => {
  /** Líneas del markdown sin sintaxis (viñetas, números, negritas, enlaces, celdas de tabla) y sin las que llevan {…}. */
  function lineasDe(ruta: string): string[] {
    const salida: string[] = [];
    for (const crudo of fuente(ruta).split('\n')) {
      const l = crudo.trim();
      if (!l || l.startsWith('#') || l.startsWith('Versión:') || /^\|[-\s|]+\|$/.test(l)) continue;
      const celdas = l.startsWith('|') ? l.split('|').slice(1, -1).map((c) => c.trim()).filter((c) => c && c !== 'Quién' && c !== 'Datos') : [l];
      for (const c of celdas) {
        const limpia = c.replace(/^[-*] |^\d+\. /, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
        if (limpia && !/[{}]/.test(limpia)) salida.push(limpia);
      }
    }
    return salida;
  }

  it('cada párrafo, viñeta, fila de tabla y título de docs/legal aparece en la página (sin los {…} que llenan los datos)', () => {
    const l = { datos: DATOS, cargando: false };
    const html = textoPlano([textosPrivacidad(l).intro, ...cuerpos(l)].map(pintar).join(' ')) + ' ' + textoPlano(
      [...textosPrivacidad(l).secciones, ...textosTerminos(l).secciones].map((s) => s.titulo).join(' · '),
    );
    const faltan: string[] = [];
    for (const ruta of ['docs/legal/politica-privacidad.md', 'docs/legal/terminos.md']) {
      for (const l of lineasDe(ruta)) if (!html.includes(l)) faltan.push(l);
    }
    assert.deepEqual(faltan, []);
  });

  it('los títulos de las secciones son los del markdown (numerados igual)', () => {
    const titulosMd = [...fuente('docs/legal/politica-privacidad.md').matchAll(/^## (.+)$/gm), ...fuente('docs/legal/terminos.md').matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    const titulosPagina = [...textosPrivacidad({ datos: null, cargando: false }).secciones, ...textosTerminos({ datos: null, cargando: false }).secciones].map((s) => s.titulo);
    assert.deepEqual(titulosPagina, titulosMd);
  });

  it('con datos, la página muestra el responsable y no dice «por confirmar» donde ya hay dato', () => {
    const html = textoPlano(cuerpos({ datos: DATOS, cargando: false }).map(pintar).join(' '));
    assert.ok(html.includes('House Perú S.A.C.'));
    assert.ok(html.includes('RUC 20601234567'));
    assert.ok(html.includes('Av. Ejemplo 123, Surco, Lima'));
    assert.ok(html.includes('privacidad@house.test'));
    // Sólo quedan «por confirmar» los pendientes: 3 en la Política (hosting, correo, plazo) y 2 en los Términos (aviso de precios, conservación).
    assert.equal(html.split('por confirmar').length - 1, 5);
  });

  it('sin datos (null), cada dato dice «por confirmar» y nunca aparece «null» ni «undefined»', () => {
    const html = textoPlano(cuerpos({ datos: null, cargando: false }).map(pintar).join(' '));
    assert.ok(html.includes('por confirmar'));
    assert.doesNotMatch(html, /\bnull\b|\bundefined\b/);
  });

  it('con el endpoint respondiendo null en cada dato (lo que llega sin cargar), también dice «por confirmar» y nunca «null»', () => {
    const vacio: DatosLegales = { razon_social: null, ruc: null, domicilio: null, correo: null, version: VERSION_SERVIDOR };
    const html = textoPlano(cuerpos({ datos: vacio, cargando: false }).map(pintar).join(' '));
    // Política: 5 datos (razón, RUC, domicilio, correo ×2) + 3 pendientes = 8. Términos: 3 datos + 2 pendientes = 5.
    assert.equal(html.split('por confirmar').length - 1, 13);
    assert.doesNotMatch(html, /\bnull\b|\bundefined\b/);
  });

  it('mientras carga, el dato muestra «…» con aria-busy (no «por confirmar» parpadeando)', () => {
    const html = pintar(textosTerminos({ datos: null, cargando: true }).secciones[0].cuerpo);
    assert.match(html, /aria-busy="true"/);
    assert.doesNotMatch(html, /por confirmar/);
  });

  it('los pendientes viven en UN solo bloque, con el valor «por confirmar»', () => {
    assert.deepEqual(Object.keys(PENDIENTES).sort(), ['dias_aviso_precios', 'dias_conservacion', 'hosting', 'plazo_auditoria', 'proveedor_correo']);
    for (const v of Object.values(PENDIENTES)) assert.equal(v, 'por confirmar');
    // Ningún otro lugar del módulo escribe el valor a mano: sólo PENDIENTES y la constante POR_CONFIRMAR de DocumentoLegal.
    assert.equal(TEXTOS.split('por confirmar').length - 1, 0);
    assert.doesNotMatch(TEXTOS, /\{(hosting|proveedor_correo|plazo_auditoria|dias_aviso_precios|dias_conservacion)\}/);
  });
});
