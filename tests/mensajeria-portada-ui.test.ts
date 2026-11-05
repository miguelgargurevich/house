// La sección «Mensajería inteligente» de la portada y el botón flotante de WhatsApp en /registro. Se pinta con `renderToStaticMarkup` lo que se
// puede pintar sin red; el cableado de la portada y de Registro se fija leyendo la fuente.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'node:test';
import { MENSAJERIA, MensajeriaInteligente } from '../src/pages/publico/portada/MensajeriaInteligente';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const PORTADA = f('src/pages/publico/Portada.tsx');
const SECCION = f('src/pages/publico/portada/MensajeriaInteligente.tsx');
const MARCO = f('src/pages/publico/Marco.tsx');
const REGISTRO = f('src/pages/publico/Registro.tsx');
const html = renderToStaticMarkup(createElement(MensajeriaInteligente));
const texto = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('portada: la sección «Mensajería inteligente»', () => {
  it('va en la portada entre «Juntas» y «Una pantalla para cada quien»', () => {
    const juntas = PORTADA.indexOf('<Juntas />');
    const mensajeria = PORTADA.indexOf('<MensajeriaInteligente />');
    const roles = PORTADA.indexOf('aria-labelledby="roles-titulo"');
    assert.ok(juntas > 0 && mensajeria > juntas, 'después de Juntas');
    assert.ok(roles > mensajeria, 'antes de los roles');
  });

  it('tiene el título, la bajada exacta y el ejemplo del condominio de 14 blocks y 448 departamentos', () => {
    assert.match(html, /<h2[^>]*id="mensajeria-titulo"[^>]*>Mensajería inteligente<\/h2>/);
    assert.ok(texto.includes('Lo general, al grupo de cada block; lo personal, directo al vecino. Menos mensajes, nadie silencia a la administración y tu número corre menos riesgo de bloqueo.'));
    assert.ok(texto.includes('Un condominio de 14 blocks y 448 departamentos: el recibo del mes son 14 mensajes, no 448.'));
  });

  it('la comparación dibuja 448 puntos contra 14 (decorativos: las cifras van escritas) y el número escrito coincide', () => {
    assert.equal((html.match(/rounded-\[2px\] bg-line/g) ?? []).length, 448, '448 mensajes directos, uno por departamento');
    assert.equal((html.match(/rounded-md bg-brand/g) ?? []).length, 14, '14 mensajes, uno por block');
    assert.match(html, /<div aria-hidden="true" class="mt-4 grid grid-cols-\[repeat\(28,minmax\(0,1fr\)\)\]/, 'la cuadrícula de 448 va oculta a los lectores');
    assert.match(html, /<span class="num text-3xl font-semibold tracking-\[-0\.02em\]">448<\/span>/);
    assert.match(html, /<span class="num text-3xl font-semibold tracking-\[-0\.02em\] text-brand">14<\/span>/);
  });

  it('tiene tres puntos: grupos por block, tú eliges qué avisos van por WhatsApp, tope diario y pausas', () => {
    assert.equal((html.match(/<li/g) ?? []).length, 3);
    assert.deepEqual(MENSAJERIA.puntos.map((p) => p.titulo), ['Un grupo por block', 'Tú eliges qué avisos van por WhatsApp', 'Tope diario y pausas']);
    for (const p of MENSAJERIA.puntos) assert.ok(texto.includes(p.titulo), p.titulo);
  });

  it('no promete ahorro de dinero ni cifras de costo: sólo menos mensajes y un número cuidado', () => {
    assert.doesNotMatch(texto, /ahorr|dinero|soles|S\/|costo|precio|barat|pagas menos|%/i);
    assert.doesNotMatch(SECCION, /ahorr|dinero|costo|barat/i);
  });

  it('usa Heroicons (sin emojis ni imágenes) y el mismo título que el resto de la portada', () => {
    assert.match(SECCION, /from '@heroicons\/react\/24\/outline'/);
    assert.doesNotMatch(SECCION, /\p{Extended_Pictographic}/u, 'sin emojis');
    assert.doesNotMatch(html, /<img/);
    assert.ok(SECCION.includes("const titulo = 'text-[clamp(2rem,4.4vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.03em]';"), 'el mismo título que Juntas y Roles');
  });

  it('no lleva cifras de clientes ni nombres de condominios reales: el ejemplo es hipotético', () => {
    assert.doesNotMatch(texto, /Los Libertadores|Surco|GRUPO VRANY|Miguel/);
  });
});

describe('botón flotante de WhatsApp en /registro', () => {
  it('Registro pasa `sinWhatsapp` en sus dos pantallas (el formulario y «Revisa tu correo»), y ninguna queda sin él', () => {
    assert.match(REGISTRO, /<Marco ancho="max-w-xl" sinWhatsapp>/);
    assert.match(REGISTRO, /\n\s*<Marco sinWhatsapp>\n/);
    assert.doesNotMatch(REGISTRO, /<Marco(?: ancho="[^"]*")?>/, 'ningún <Marco> sin la prop');
  });

  it('Marco declara la prop con valor por defecto false y sólo pinta el flotante si no está puesta', () => {
    assert.match(MARCO, /sinWhatsapp = false/);
    assert.match(MARCO, /\{redes\?\.whatsapp && !sinWhatsapp && <WhatsappFlotante enlace=\{redes\.whatsapp\.enlace\} \/>\}/);
  });

  it('Contacto y el Libro de Reclamaciones (formularios con «Enviar» a ancho completo al final) también lo ocultan; la portada y precios no', () => {
    assert.match(f('src/pages/publico/Contacto.tsx'), /<Marco sinWhatsapp>\n\s+<div className="grid gap-10/);
    assert.match(f('src/pages/publico/LibroReclamaciones.tsx'), /<Marco ancho="max-w-3xl" sinWhatsapp>\n\s+<h1/);
    for (const archivo of ['src/pages/publico/Portada.tsx', 'src/pages/publico/Precios.tsx']) {
      assert.doesNotMatch(f(archivo), /sinWhatsapp/, archivo);
    }
  });
});
