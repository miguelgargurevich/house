// El contador de WhatsApp dice cuántos mensajes salieron este mes y cuántos evitaron los grupos: «Este mes: 42 mensajes enviados · 1.300 evitados
// gracias a los grupos», con punto de miles; sin grupos en uso, pide asignarlos. La lógica va en funciones puras (`tipos.ts`); aquí se fija el texto
// y el cableado de la pantalla leyendo la fuente (el repo no monta React en un navegador).
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { miles, textoMesGrupos } from '../src/pages/admin/_parts/whatsapp/tipos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const CONTADOR = f('src/pages/admin/_parts/whatsapp/ContadorWhatsapp.tsx');

describe('miles: punto de miles, sin depender del navegador', () => {
  it('separa de tres en tres con punto y no pone nada por debajo de mil', () => {
    assert.equal(miles(0), '0');
    assert.equal(miles(7), '7');
    assert.equal(miles(999), '999');
    assert.equal(miles(1000), '1.000');
    assert.equal(miles(1300), '1.300');
    assert.equal(miles(1234567), '1.234.567');
  });
});

describe('textoMesGrupos: la línea del mes del contador', () => {
  it('con grupos en uso: «Este mes: 42 mensajes enviados · 1.300 evitados gracias a los grupos»', () => {
    assert.equal(textoMesGrupos({ enviados: 42, evitados: 1300, grupos_en_uso: 14 }).linea, 'Este mes: 42 mensajes enviados · 1.300 evitados gracias a los grupos');
  });

  it('en singular cuando es uno: «1 mensaje enviado · 1 evitado»', () => {
    assert.equal(textoMesGrupos({ enviados: 1, evitados: 1, grupos_en_uso: 1 }).linea, 'Este mes: 1 mensaje enviado · 1 evitado gracias a los grupos');
  });

  it('con cero evitados (grupos en uso pero sin recibos a grupo todavía) lo dice con cero, sin inventar', () => {
    assert.equal(textoMesGrupos({ enviados: 0, evitados: 0, grupos_en_uso: 2 }).linea, 'Este mes: 0 mensajes enviados · 0 evitados gracias a los grupos');
  });

  it('sin grupos en uso no muestra el número: sugiere asignar el grupo de cada block', () => {
    const t = textoMesGrupos({ enviados: 42, evitados: 0, grupos_en_uso: 0 });
    assert.equal(t.linea, 'Asigna el grupo de cada block y evita mensajes repetidos.');
    assert.doesNotMatch(t.linea, /evitad|enviad/);
  });

  it('la ayuda explica qué es «evitado» (un mensaje al grupo cuenta como uno) y no promete dinero', () => {
    const ayuda = textoMesGrupos({ enviados: 1, evitados: 1, grupos_en_uso: 1 }).ayuda;
    assert.match(ayuda, /Cada grupo cuenta como un mensaje/);
    assert.doesNotMatch(ayuda, /ahorr|dinero|soles|S\/|costo|precio/i);
  });
});

describe('ContadorWhatsapp: cableado en la pantalla', () => {
  it('pinta la línea del mes ANTES del detalle por condominio, y la toma de textoMesGrupos (no la escribe a mano)', () => {
    const linea = CONTADOR.indexOf('textoMesGrupos(d.mes).linea');
    assert.ok(linea > 0, 'usa textoMesGrupos');
    assert.ok(linea < CONTADOR.indexOf('id="uso-mes"'), 'va antes del título del detalle por condominio');
    assert.match(CONTADOR, /textoMesGrupos\(d\.mes\)\.ayuda/);
  });

  it('lee enviados, evitados y grupos_en_uso del mes que devuelve el servidor (los campos existen en el tipo del navegador)', () => {
    const tipos = f('src/pages/admin/_parts/whatsapp/tipos.ts');
    for (const campo of ['enviados: number;', 'a_grupos: number;', 'evitados: number;', 'grupos_en_uso: number;']) assert.ok(tipos.includes(campo), campo);
  });

  it('no escribe nada que sugiera enviar o integrar desde esta pantalla', () => {
    assert.doesNotMatch(CONTADOR, /Enviar ahora|Integrar|Publicar en grupos/);
  });
});
