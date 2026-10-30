// Lo que va del mes en Mi plan y el Resumen: textos de los topes, aviso al 80 %, mensajes de los vouchers; el superadmin fija los topes por departamento
// y el chat manda el condominio que la barra tiene elegido. Lo que es lógica se prueba de verdad; la conexión, con la fuente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { errorDeRespuesta } from '../src/app/asistente/errores';
import { mensajeVouchers, textoTope, topeAlto, type UsoMes } from '../src/pages/admin/_parts/plan/usoDelMes';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const uso = (over: Partial<UsoMes> = {}): UsoMes => ({
  periodo: '202610', renueva: 'noviembre', asistente: { usadas: 0, tope: 10 }, whatsapp: { usadas: 0, tope: 6 }, vouchers_a_mano: 0, vouchers_ia: 0, ...over,
});

describe('textos del mes', () => {
  it('cada tope dice cuánto va de cuánto; sin tope, sólo cuánto va', () => {
    assert.equal(textoTope('asistente', { usadas: 3, tope: 10 }), 'asistente 3 de 10');
    assert.equal(textoTope('WhatsApp', { usadas: 0, tope: null }), 'WhatsApp 0 (sin tope)');
  });

  it('el aviso salta al 80 % de un tope, no antes; sin tope, nunca', () => {
    assert.equal(topeAlto(uso({ asistente: { usadas: 7, tope: 10 } })), false);
    assert.equal(topeAlto(uso({ asistente: { usadas: 8, tope: 10 } })), true);
    assert.equal(topeAlto(uso({ whatsapp: { usadas: 5, tope: 6 } })), true);
    assert.equal(topeAlto(uso({ asistente: { usadas: 999, tope: null } })), false);
    assert.equal(topeAlto(uso({ asistente: { usadas: 0, tope: 0 } })), false, 'un tope de cero no avisa de nada');
  });
});

describe('mensajes de los vouchers', () => {
  it('en Gratis dice lo que se validó a mano y lo que cambia con Pro', () => {
    assert.equal(
      mensajeVouchers(uso({ vouchers_a_mano: 4 }), 'gratis', false),
      'Este mes validaste a mano 4 vouchers. Con Pro, la IA los lee y valida los que coinciden; tú sólo revisas.',
    );
    assert.equal(mensajeVouchers(uso({ vouchers_a_mano: 1 }), 'gratis', false)?.startsWith('Este mes validaste a mano 1 voucher.'), true);
  });

  it('sin vouchers a mano en Gratis, no dice nada', () => {
    assert.equal(mensajeVouchers(uso({ vouchers_a_mano: 0 }), 'gratis', false), null);
  });

  it('en prueba dice lo que la IA ya validó; un Pro pagado no dice nada de esto', () => {
    assert.equal(mensajeVouchers(uso({ vouchers_ia: 3 }), 'pro', true), 'La IA ya validó 3 vouchers por ti este mes.');
    assert.equal(mensajeVouchers(uso({ vouchers_ia: 0 }), 'pro', true), null);
    assert.equal(mensajeVouchers(uso({ vouchers_a_mano: 5, vouchers_ia: 2 }), 'pro', false), null);
  });
});

describe('el tope llega al asistente como mensaje del servidor', () => {
  it('el 429 del tope se muestra tal cual, no como «muchas consultas»', () => {
    const texto = 'Este condominio usó las consultas al asistente de este mes. Se renuevan el 1 de noviembre.';
    const e = errorDeRespuesta(429, texto);
    assert.equal(e.causa, 'limite_uso');
    assert.equal(e.mensaje, texto);
  });

  it('el 429 de siempre (muchas consultas seguidas) sigue con su texto de antes', () => {
    assert.notEqual(errorDeRespuesta(429, undefined).mensaje, 'Este condominio usó las consultas al asistente de este mes.');
    assert.match(errorDeRespuesta(429, undefined).mensaje, /muchas consultas/);
  });
});

describe('pantallas de los topes', () => {
  it('el superadmin fija los dos topes por departamento (0 a 1000; vacío = sin tope) con su texto', () => {
    const f = fuente('src/pages/superadmin/_parts/suscripciones/Precios.tsx');
    assert.match(f, /label="Consultas al asistente por departamento al mes" type="number" min=\{0\} max=\{1000\}/);
    assert.match(f, /label="Mensajes de WhatsApp por departamento al mes" type="number" min=\{0\} max=\{1000\}/);
    assert.match(f, /asistente_por_unidad_mes: asistente\.trim\(\) \? Number\(asistente\) : null/);
    assert.match(f, /whatsapp_por_unidad_mes: whatsapp\.trim\(\) \? Number\(whatsapp\) : null/);
  });

  it('Mi plan muestra el uso del mes de cada condominio con su aviso al 80 % y los vouchers', () => {
    const f = fuente('src/pages/admin/MiPlan.tsx');
    assert.match(f, /<UsoDelMes uso=\{c\.uso\} plan=\{c\.plan\.clave\} enPrueba=\{c\.en_prueba\} \/>/);
    assert.match(f, /Vas por el 80 % del tope de este mes/);
  });

  it('el Resumen dice lo de los vouchers del condominio elegido', () => {
    const f = fuente('src/pages/admin/_parts/plan/BandaPlan.tsx');
    assert.match(f, /mensajeVouchers\(c\.uso, c\.plan\.clave, c\.en_prueba\)/);
    assert.match(f, /elegido == null \|\| c\.complejo_id === elegido/);
  });

  it('el chat manda el condominio que la barra tiene elegido, y el asistente lo recibe', () => {
    const app = fuente('src/app/Assistant.tsx');
    assert.match(app, /useAsistente\(user\?\.id \?\? 0, pathname, open, useCondominio\(\)\.elegido\)/);
    const hook = fuente('src/app/asistente/useAsistente.ts');
    assert.match(hook, /complejo_id: complejoId \?\? undefined/);
    const ruta = fuente('src/server/routes/aiChat.ts');
    assert.match(ruta, /complejoId: e\.complejoId/);
  });
});
