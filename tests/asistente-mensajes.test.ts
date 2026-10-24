// Acciones sobre los mensajes del asistente (sin navegador): reescribir, regenerar, nombrar, buscar, exportar y el marcado de las acciones.
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  exportarMarkdown, filtrarConversaciones, nombreArchivoDe, paraRegenerar, puedeRegenerar, reescribir, ultimoEnviado, validarTitulo,
} from '../src/app/asistente/acciones';
import { enviarMensaje } from '../src/app/asistente/cliente';
import type { ConversacionResumen, MensajeChat } from '../src/app/asistente/tipos';

const u = (id: string, texto: string, idServidor?: number): MensajeChat => ({ id, rol: 'user', texto, estado: 'ok', ...(idServidor ? { idServidor } : {}) });
const a = (id: string, texto: string, estado: MensajeChat['estado'] = 'ok'): MensajeChat => ({ id, rol: 'assistant', texto, estado });
const hilo = [u('u1', 'Primera', 10), a('a1', 'R1'), u('u2', 'Segunda', 12), a('a2', 'R2'), u('u3', 'Tercera', 14), a('a3', 'R3')];

describe('reescribir («Editar» un mensaje)', () => {
  it('quita ESE mensaje y todo lo posterior (no desde el siguiente) y devuelve su texto', () => {
    const r = reescribir(hilo, 'u2')!;
    assert.deepEqual(r.restantes.map((m) => m.id), ['u1', 'a1']);
    assert.equal(r.texto, 'Segunda');
    assert.equal(r.desdeIdServidor, 12);
  });
  it('el primero deja la vista vacía; un mensaje sin id de base da null; sólo aplica a mensajes del usuario o que existen', () => {
    assert.deepEqual(reescribir(hilo, 'u1')!.restantes, []);
    assert.equal(reescribir([u('x', 'sin guardar')], 'x')!.desdeIdServidor, null);
    assert.equal(reescribir(hilo, 'a1'), null);
    assert.equal(reescribir(hilo, 'no-existe'), null);
    assert.equal(reescribir([], 'u1'), null);
  });
  it('no muta la lista original', () => {
    const copia = JSON.stringify(hilo);
    reescribir(hilo, 'u1');
    assert.equal(JSON.stringify(hilo), copia);
  });
});

describe('regenerar', () => {
  it('reutiliza el ÚLTIMO mensaje del usuario y reemplaza su respuesta (no la duplica)', () => {
    const r = paraRegenerar(hilo)!;
    assert.deepEqual(r.restantes.map((m) => m.id), ['u1', 'a1', 'u2', 'a2']);
    assert.equal(r.texto, 'Tercera');
    assert.equal(r.desdeIdServidor, 14);
  });
  it('con un error al final también funciona (es lo que hace «Reintentar»); sin mensajes del usuario no hay nada que regenerar', () => {
    const conError = [u('u1', 'Hola', 5), { ...a('a1', '', 'error'), error: { causa: 'modelo' as const, mensaje: 'x' } }];
    assert.deepEqual(paraRegenerar(conError)!.restantes, []);
    assert.equal(paraRegenerar([a('a1', 'solo')]), null);
    assert.equal(paraRegenerar([]), null);
  });
  it('sólo se ofrece en la ÚLTIMA respuesta, terminada y sin otro turno en curso', () => {
    assert.equal(puedeRegenerar(hilo, 5, false), true);
    assert.equal(puedeRegenerar(hilo, 3, false), false, 'no en respuestas anteriores');
    assert.equal(puedeRegenerar(hilo, 5, true), false, 'no mientras hay un turno en curso');
    assert.equal(puedeRegenerar(hilo, 4, false), false, 'no en mensajes del usuario');
    assert.equal(puedeRegenerar([u('u', 'x'), a('a', 'parcial', 'transmitiendo')], 1, false), false);
  });
});

describe('↑ recupera lo último enviado', () => {
  it('el último mensaje del usuario; null si no hay', () => {
    assert.equal(ultimoEnviado(hilo), 'Tercera');
    assert.equal(ultimoEnviado([a('a', 'x')]), null);
    assert.equal(ultimoEnviado([]), null);
  });
});

describe('nombrar conversaciones', () => {
  it('1–80 caracteres, sin HTML ni control; recorta espacios', () => {
    assert.deepEqual(validarTitulo('  Recibos de marzo '), { ok: true, titulo: 'Recibos de marzo' });
    assert.deepEqual(validarTitulo('a'.repeat(80)), { ok: true, titulo: 'a'.repeat(80) });
    for (const mal of ['', '   ', 'a'.repeat(81), '<script>', 'a > b', 'x\u0007y']) assert.equal(validarTitulo(mal).ok, false, mal);
  });
});

describe('buscar en el historial', () => {
  const lista: ConversacionResumen[] = [
    { id: '1', titulo: 'Mis recibos de marzo', updated_at: '2026-10-01' },
    { id: '2', titulo: 'Cómo pago con Yape', updated_at: '2026-10-02' },
    { id: '3', titulo: 'Reserva de ÁREA común', updated_at: '2026-10-03' },
  ];
  it('sin distinguir mayúsculas ni tildes; vacío = todas', () => {
    assert.deepEqual(filtrarConversaciones(lista, 'RECIBOS').map((c) => c.id), ['1']);
    assert.deepEqual(filtrarConversaciones(lista, 'como pago').map((c) => c.id), ['2']);
    assert.deepEqual(filtrarConversaciones(lista, 'area').map((c) => c.id), ['3']);
    assert.deepEqual(filtrarConversaciones(lista, '   ').map((c) => c.id), ['1', '2', '3']);
    assert.deepEqual(filtrarConversaciones(lista, 'zzz'), []);
  });
});

describe('exportar a Markdown', () => {
  const fecha = new Date('2026-10-23T15:00:00-05:00');
  it('título, fecha y los turnos en orden; sin vacíos, sin parciales en curso y sin métricas', () => {
    const md = exportarMarkdown('Mis recibos', [u('1', 'Hola'), { ...a('2', 'Respuesta **uno**'), modelo: 'openai/secreto', latencia_ms: 900 }, a('3', '', 'error'), u('4', 'Otra'), a('5', 'a medias', 'transmitiendo')], fecha);
    assert.equal(md, '# Mis recibos\n\n_Exportada de House el 23 de octubre de 2026._\n\n## Tú\n\nHola\n\n## Asistente\n\nRespuesta **uno**\n\n## Tú\n\nOtra\n');
    assert.ok(!md.includes('secreto') && !md.includes('900'));
  });
  it('el título multilínea queda en una línea; conversación sin texto no revienta', () => {
    assert.match(exportarMarkdown('uno\n## dos', [], fecha), /^# uno ## dos\n/);
    assert.match(exportarMarkdown('   ', [], fecha), /^# Conversación\n/);
  });
  it('nombre de archivo seguro con fecha', () => {
    assert.equal(nombreArchivoDe('¿Cómo pago, con Yape?', fecha), 'como-pago-con-yape-2026-10-23.md');
    assert.equal(nombreArchivoDe('///', fecha), 'conversacion-2026-10-23.md');
    const tarde = new Date('2026-10-23T22:30:00-05:00'); // ya es 24 en UTC, pero en Lima sigue siendo el 23
    assert.equal(nombreArchivoDe('x', tarde), 'x-2026-10-23.md');
    assert.match(exportarMarkdown('x', [], tarde), /el 23 de octubre de 2026/);
    assert.ok(nombreArchivoDe('a'.repeat(200), fecha).length <= 50 + '-2026-10-23.md'.length);
  });
});

describe('el cliente entrega el id del mensaje guardado', () => {
  it('meta trae mensaje_id sólo si es un entero', async () => {
    const enc = new TextEncoder();
    const resp = (cuerpo: string) => (async () => new Response(new ReadableStream({ start(c) { c.enqueue(enc.encode(cuerpo)); c.close(); } }), { status: 200 })) as unknown as typeof fetch;
    const deps = (f: typeof fetch) => ({ fetch: f, csrf: () => ({}) });
    const sse = (d: unknown) => `event: meta\ndata: ${JSON.stringify(d)}\n\n` + 'event: done\ndata: {}\n\n';
    const con = [];
    for await (const ev of enviarMensaje(deps(resp(sse({ conversacion_id: 'c1', mensaje_id: 42 }))), { message: 'x' })) con.push(ev);
    assert.deepEqual(con[0], { tipo: 'meta', conversacion_id: 'c1', mensaje_id: 42 });
    const sin = [];
    for await (const ev of enviarMensaje(deps(resp(sse({ conversacion_id: 'c1', mensaje_id: 'x' }))), { message: 'x' })) sin.push(ev);
    assert.deepEqual(sin[0], { tipo: 'meta', conversacion_id: 'c1' });
  });
});

describe('marcado de las acciones (render del servidor)', () => {
  // Los componentes se escriben para el transformador automático de Vite; aquí tsx usa el clásico y necesita `React` global.
  let Markdown: typeof import('../src/app/asistente/Markdown').Markdown;
  let textoDe: typeof import('../src/app/asistente/Markdown').textoDe;
  let Mensajes: typeof import('../src/app/asistente/Mensajes').Mensajes;
  before(async () => {
    (globalThis as { React?: unknown }).React = React;
    ({ Markdown, textoDe } = await import('../src/app/asistente/Markdown'));
    ({ Mensajes } = await import('../src/app/asistente/Mensajes'));
  });
  const noop = () => undefined;
  const copiar = async () => true;
  const html = (ms: MensajeChat[], extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Mensajes, {
    mensajes: ms, verMetricas: false, onNavegar: noop, onCopiar: copiar, onEditar: noop, onRegenerar: noop, onReintentarConAuto: noop, onUsarAutoSiempre: noop, autoYaGuardado: false, ocupado: false, ...extra,
  }));

  it('el mensaje del usuario tiene «Copiar mensaje» y «Editar mensaje», visibles con hover/foco y siempre en táctil, y su texto se puede seleccionar', () => {
    const h = html([u('1', 'Hola mundo'), a('2', 'Respuesta')]);
    assert.match(h, /aria-label="Copiar mensaje"/);
    assert.match(h, /aria-label="Editar mensaje"/);
    assert.match(h, /group-hover:opacity-100/);
    assert.match(h, /focus-within:opacity-100/);
    assert.match(h, /\[@media\(hover:none\)\]:opacity-100/);
    assert.match(h, /select-text[^"]*"[^>]*>Hola mundo/);
    assert.ok(!/select-none|pointer-events-none|\binert\b/.test(h), 'nada impide seleccionar');
  });
  it('objetivos táctiles de 44 px (h-11 w-11) en las acciones', () => {
    const h = html([u('1', 'Hola'), a('2', 'Respuesta')]);
    for (const etiqueta of ['Copiar mensaje', 'Editar mensaje', 'Copiar respuesta', 'Regenerar respuesta']) {
      const boton = new RegExp(`<button[^>]*aria-label="${etiqueta}"[^>]*>`).exec(h)?.[0] ?? '';
      assert.match(boton, /h-11 w-11/, etiqueta);
    }
  });
  it('«Regenerar» sólo en la última respuesta terminada; no mientras hay un turno en curso', () => {
    const dos = [u('1', 'a'), a('2', 'r1'), u('3', 'b'), a('4', 'r2')];
    assert.equal((html(dos).match(/Regenerar respuesta/g) ?? []).length, 2, 'aria-label + title de UN solo botón');
    assert.ok(!html(dos, { ocupado: true }).includes('Regenerar respuesta'));
  });
  it('error de modelo fijo: «Reintentar con Auto» y «Usar Auto siempre» (no si Auto ya es el ajuste); otro error: «Reintentar»', () => {
    const modelo = [u('1', 'x'), { ...a('2', '', 'error'), error: { causa: 'modelo' as const, mensaje: 'El modelo GPT OSS Safeguard 20B no respondió; prueba con Auto.' } }];
    const h = html(modelo);
    assert.match(h, /Reintentar con Auto/);
    assert.match(h, /Usar Auto siempre/);
    assert.match(h, /GPT OSS Safeguard 20B/);
    assert.ok(!h.includes('openai/'));
    assert.ok(!html(modelo, { autoYaGuardado: true }).includes('Usar Auto siempre'));
    const otro = [u('1', 'x'), { ...a('2', '', 'error'), error: { causa: 'caido' as const, mensaje: 'No disponible' } }];
    assert.match(html(otro), />Reintentar</);
    assert.ok(!html(otro).includes('Reintentar con Auto'));
    assert.match(html(modelo), /select-text/, 'el texto del error también se puede seleccionar');
  });
  it('cada bloque de código del Markdown trae su botón «Copiar código»; el texto copiado es el código sin la marca de lenguaje', () => {
    const h = renderToStaticMarkup(createElement(Markdown, { texto: 'Mira:\n\n```ts\nconst a = 1;\n```\n\ny\n\n```\nsin lenguaje\n```\n', onNavegar: noop, onCopiar: copiar }));
    assert.equal((h.match(/aria-label="Copiar código"/g) ?? []).length, 2);
    assert.match(h, /<span>ts<\/span>/);
    assert.match(h, /select-text/);
    assert.equal(textoDe(createElement('code', null, 'const a = ', createElement('span', null, '1;'))), 'const a = 1;');
  });
});
