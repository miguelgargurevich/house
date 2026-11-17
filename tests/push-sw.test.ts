// Service worker de los avisos push del navegador (public/sw.js). Se ejecuta en `node:vm` con un `self` falso: lo que muestra, adónde lleva al tocar el aviso
// (sólo rutas internas) y que no intercepta ninguna petición.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const script = readFileSync('public/sw.js', 'utf8');
const ORIGEN = 'https://torrecondominios.com';

type Oyente = (e: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

function cargar(ventanas: Array<{ url: string; navigate?: (u: string) => Promise<unknown>; focus?: () => Promise<unknown> }> = []) {
  const oyentes: Record<string, Oyente> = {};
  const mostradas: Array<{ titulo: string; opciones: any }> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const abiertas: string[] = [];
  let skip = 0; let claim = 0;
  const self = {
    location: { origin: ORIGEN },
    addEventListener: (n: string, f: Oyente) => { oyentes[n] = f; },
    skipWaiting: () => { skip++; },
    registration: { showNotification: (titulo: string, opciones: unknown) => { mostradas.push({ titulo, opciones }); return Promise.resolve(); } },
    clients: {
      claim: () => { claim++; return Promise.resolve(); },
      matchAll: () => Promise.resolve(ventanas),
      openWindow: (u: string) => { abiertas.push(u); return Promise.resolve(); },
    },
  };
  vm.runInNewContext(script, { self, URL, JSON });
  const empujar = (data: unknown) => {
    const esperas: Promise<unknown>[] = [];
    oyentes.push!({ data: data === undefined ? null : { json: () => { if (data instanceof Error) throw data; return data; } }, waitUntil: (p: Promise<unknown>) => esperas.push(p) });
    return Promise.all(esperas);
  };
  const tocar = async (ruta: unknown, sinData = false) => {
    const cerrada = { v: false };
    const esperas: Promise<unknown>[] = [];
    oyentes.notificationclick!({ notification: { close: () => { cerrada.v = true; }, data: sinData ? undefined : { ruta } }, waitUntil: (p: Promise<unknown>) => esperas.push(p) });
    await Promise.all(esperas);
    return cerrada.v;
  };
  return { oyentes, mostradas, abiertas, empujar, tocar, contadores: () => ({ skip, claim }) };
}

describe('service worker de avisos push', () => {
  it('sólo escucha install, activate, push y notificationclick: no intercepta peticiones ni guarda nada en caché', () => {
    const { oyentes, contadores } = cargar();
    assert.deepEqual(Object.keys(oyentes).sort(), ['activate', 'install', 'notificationclick', 'push']);
    assert.ok(!/\bfetch\b|caches\./.test(script.replace(/\/\*[\s\S]*?\*\//g, '')), 'sin fetch ni caché');
    oyentes.install!({}); oyentes.activate!({ waitUntil: () => {} });
    assert.deepEqual(contadores(), { skip: 1, claim: 1 });
  });

  it('un push con título, cuerpo y ruta muestra la notificación con el ícono de Torre y la ruta en data', async () => {
    const sw = cargar();
    await sw.empujar({ titulo: 'Tu recibo vence hoy', cuerpo: 'Recibo de octubre de 2026.', ruta: '/propietario/cargos' });
    assert.equal(sw.mostradas.length, 1);
    assert.equal(sw.mostradas[0]!.titulo, 'Tu recibo vence hoy');
    assert.equal(sw.mostradas[0]!.opciones.body, 'Recibo de octubre de 2026.');
    assert.equal(sw.mostradas[0]!.opciones.icon, '/icon-192.png');
    assert.deepEqual(JSON.parse(JSON.stringify(sw.mostradas[0]!.opciones.data)), { ruta: '/propietario/cargos' });
  });

  it('Safari exige mostrar SIEMPRE algo: sin datos, con JSON roto o con tipos raros sale «Torre»', async () => {
    for (const raro of [undefined, new Error('no es json'), {}, { titulo: 42, cuerpo: {}, ruta: [] }, null]) {
      const sw = cargar();
      await sw.empujar(raro);
      assert.equal(sw.mostradas.length, 1, JSON.stringify(raro));
      assert.equal(sw.mostradas[0]!.titulo, 'Torre');
      assert.deepEqual(JSON.parse(JSON.stringify(sw.mostradas[0]!.opciones.data)), { ruta: '/' });
    }
  });

  it('una ruta que no es interna (otro sitio, esquema, «//», «\\» o control) cae en el inicio', async () => {
    for (const mala of ['https://evil.example/x', '//evil.example/x', 'javascript:alert(1)', '/\\evil.example', '/a\u0000b', 'propietario/cargos', '', 'a'.repeat(2001)]) {
      const sw = cargar();
      await sw.empujar({ titulo: 't', cuerpo: 'c', ruta: mala });
      assert.deepEqual(JSON.parse(JSON.stringify(sw.mostradas[0]!.opciones.data)), { ruta: '/' }, mala);
    }
  });

  it('recorta títulos y cuerpos descomunales', async () => {
    const sw = cargar();
    await sw.empujar({ titulo: 'T'.repeat(500), cuerpo: 'C'.repeat(900), ruta: '/' });
    assert.equal(sw.mostradas[0]!.titulo.length, 120);
    assert.equal(sw.mostradas[0]!.opciones.body.length, 300);
  });

  it('al tocar el aviso lo cierra y, si Torre ya está abierta, lleva ESA pestaña a la ruta (sin abrir otra)', async () => {
    const navegadas: string[] = []; let enfocada = 0;
    const sw = cargar([{ url: 'https://otro-sitio.example/', navigate: async () => null }, { url: `${ORIGEN}/propietario/inicio`, navigate: async (u) => { navegadas.push(u); return { focus: async () => { enfocada++; } }; } }]);
    assert.equal(await sw.tocar('/propietario/cargos'), true, 'cierra el aviso');
    assert.deepEqual(navegadas, [`${ORIGEN}/propietario/cargos`]);
    assert.equal(enfocada, 1);
    assert.deepEqual(sw.abiertas, []);
  });

  it('si Torre no está abierta, abre una ventana en la ruta; una ruta mala o ausente abre el inicio', async () => {
    const sw = cargar([{ url: 'https://otro-sitio.example/' }]); // otra ventana de otro sitio no cuenta
    await sw.tocar('/junta/cierre');
    await sw.tocar('https://evil.example/x');
    await sw.tocar(undefined, true);
    assert.deepEqual(sw.abiertas, [`${ORIGEN}/junta/cierre`, `${ORIGEN}/`, `${ORIGEN}/`]);
  });
});
