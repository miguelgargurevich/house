// La demo en pantalla: las tarjetas «Entrar como…» de /demo, la franja fija de arriba y la guía «Qué probar». Lo que es lógica se prueba de verdad (roles,
// pasos, casillas, enlaces a los videos); el cableado (la ruta /demo, la franja en la app, la portada de la instancia de demo), con la fuente.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { GUIA, casillasDe, claveDeCasillas, enlaceDeVideo } from '../src/app/demo/guia';
import { ROLES_DEMO, TARJETAS_DEMO, TITULO_DE_ROL, esRolDemo, rolDeDemoDe } from '../src/app/demo/roles';
import { puedeSerDemo } from '../src/app/demo/enlaces';
import { ENTRADA_DEMO, entradaDe, vistaDeDemo } from '../src/pages/publico/demo/logica';
import { ROLES_DEMO as ROLES_SERVIDOR } from '../src/server/services/demo/cuentas';

(globalThis as { React?: unknown }).React = React; // los componentes se compilan con el JSX clásico en las pruebas
const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const APP = fuente('src/App.tsx');
const rutasDeLaApp = new Set([...APP.matchAll(/path="([^"]+)"/g)].map((m) => m[1]!));
const anclasDelManual = new Set((JSON.parse(fuente('docs/marketing/manual-videos.json')) as { id: string }[]).map((e) => e.id));

describe('Los roles de la demo', () => {
  it('son los mismos que los del servidor (POST /api/demo/entrar)', () => {
    assert.deepEqual([...ROLES_DEMO], [...ROLES_SERVIDOR]);
  });

  it('cada rol está en una sola tarjeta; la última junta seguridad y mantenimiento', () => {
    const todos = TARJETAS_DEMO.flatMap((t) => t.roles.map((r) => r.clave));
    assert.deepEqual([...todos].sort(), [...ROLES_DEMO].sort());
    assert.equal(new Set(todos).size, todos.length);
    assert.equal(TARJETAS_DEMO.length, 7);
    assert.deepEqual(TARJETAS_DEMO[6]!.roles.map((r) => r.clave), ['seguridad', 'mantenimiento']);
    for (const t of TARJETAS_DEMO) {
      assert.ok(t.ve.length > 20 && t.ve.length < 140, `«${t.id}»: qué va a ver, en una línea`);
      assert.ok(t.ve.endsWith('.'));
    }
    for (const r of ROLES_DEMO) assert.ok(TITULO_DE_ROL[r], `${r} tiene título`);
  });

  it('esRolDemo rechaza lo que no es un rol', () => {
    assert.equal(esRolDemo('administradora'), true);
    assert.equal(esRolDemo('superadmin'), false);
    assert.equal(esRolDemo(undefined), false);
  });

  it('el rol de quien tiene la sesión: lo guardado al entrar si coincide con la cuenta; si no, se deduce', () => {
    assert.equal(rolDeDemoDe({ rol: 'propietario' }, 'propietario_moroso'), 'propietario_moroso');
    assert.equal(rolDeDemoDe({ rol: 'propietario' }, null), 'propietario_al_dia');
    assert.equal(rolDeDemoDe({ rol: 'propietario', cargo_junta: 'tesorero', estructura_id: 3 }, null), 'tesorero_block');
    assert.equal(rolDeDemoDe({ rol: 'propietario', cargo_junta: 'presidente', estructura_id: null }, null), 'presidente_central');
    assert.equal(rolDeDemoDe({ rol: 'admin' }, 'inquilino'), 'administradora', 'lo guardado de otra cuenta se ignora');
    assert.equal(rolDeDemoDe({ rol: 'inquilino' }, 'inquilino'), 'inquilino');
    assert.equal(rolDeDemoDe({ rol: 'seguridad' }, null), 'seguridad');
    assert.equal(rolDeDemoDe({ rol: 'superadmin' }, null), null);
  });
});

describe('«Qué probar»', () => {
  it('todos los roles tienen pasos; administradora, juntas y vecinos, 6 con casilla', () => {
    for (const r of ROLES_DEMO) assert.ok(GUIA[r].length >= 3, `${r} tiene pasos`);
    for (const r of ['administradora', 'tesorero_block', 'presidente_central', 'propietario_al_dia', 'propietario_moroso', 'inquilino'] as const) assert.equal(GUIA[r].length, 6, r);
  });

  it('la administradora empieza como lo pidió Miguel: morosidad, validar un pago con su voucher, emitir un recibo, avisar (se simula), cerrar el mes', () => {
    const t = GUIA.administradora.map((p) => p.texto.toLowerCase());
    assert.match(t[0]!, /morosidad/);
    assert.match(t[1]!, /valida un pago con su voucher/);
    assert.match(t[2]!, /emite el recibo de un block/);
    assert.match(t[3]!, /avisa a los vecinos \(se simula\)/);
    assert.match(t[4]!, /cierra el mes/);
  });

  it('el vecino mira cuánto debe, paga con el voucher de ejemplo y descarga/ve su recibo', () => {
    const t = GUIA.propietario_al_dia.map((p) => p.texto.toLowerCase()).join(' | ');
    assert.match(t, /mira cuánto debes/);
    assert.match(t, /paga con el voucher de ejemplo/);
  });

  it('los pasos son únicos por rol, llevan a una pantalla que EXISTE en la app y su video a un ancla que existe en el manual', () => {
    for (const r of ROLES_DEMO) {
      const ids = GUIA[r].map((p) => p.id);
      assert.equal(new Set(ids).size, ids.length, `${r}: ids repetidos`);
      for (const p of GUIA[r]) {
        assert.ok(rutasDeLaApp.has(p.ruta), `${r}/${p.id}: la ruta ${p.ruta} no existe en App.tsx`);
        if (p.manual) assert.ok(anclasDelManual.has(p.manual), `${r}/${p.id}: el ancla ${p.manual} no existe en el manual`);
        assert.ok(p.texto.length > 5 && !EMOJI.test(p.texto + (p.ayuda ?? '')));
      }
    }
    for (const r of ROLES_DEMO) assert.ok(rutasDeLaApp.has(ENTRADA_DEMO[r]), `la entrada de ${r} existe`);
  });

  it('el video de cada paso: la dirección del manual con su ancla; sin manual o sin ancla, ninguno', () => {
    const paso = GUIA.administradora[0]!;
    assert.equal(enlaceDeVideo('https://manual.ejemplo/manual.html', paso), 'https://manual.ejemplo/manual.html#admin.morosidad');
    assert.equal(enlaceDeVideo('https://manual.ejemplo/manual.html#rol-admin', paso), 'https://manual.ejemplo/manual.html#admin.morosidad', 'cambia el ancla vieja');
    assert.equal(enlaceDeVideo(null, paso), null);
    assert.equal(enlaceDeVideo('https://manual.ejemplo/m.html', { manual: undefined }), null);
  });

  it('las casillas guardadas: ignora lo roto y lo que ya no es un paso', () => {
    assert.deepEqual([...casillasDe('administradora', JSON.stringify(['morosidad', 'validar', 'ya-no-existe']))], ['morosidad', 'validar']);
    assert.equal(casillasDe('administradora', 'esto no es json').size, 0);
    assert.equal(casillasDe('administradora', '{"a":1}').size, 0);
    assert.equal(casillasDe('administradora', null).size, 0);
    assert.notEqual(claveDeCasillas('administradora'), claveDeCasillas('inquilino'));
  });
});

describe('La guía en pantalla', async () => {
  const { GuiaDemo } = await import('../src/app/demo/GuiaDemo');
  const pinta = (marcadas: string[], urlManual: string | null = 'https://manual.ejemplo/manual.html') =>
    renderToStaticMarkup(createElement(MemoryRouter, null, createElement(GuiaDemo, { rol: 'administradora', urlManual, marcadas: new Set(marcadas), onAlternar: () => undefined, onLimpiar: () => undefined, onCerrar: () => undefined })));

  it('lista los 6 pasos con su casilla, su enlace a la pantalla y su video', () => {
    const h = pinta(['morosidad']);
    assert.match(h, /Qué probar/);
    assert.match(h, /Administradora · 1 de 6/);
    assert.equal((h.match(/type="checkbox"/g) ?? []).length, 6);
    assert.equal((h.match(/checked=""/g) ?? []).length, 1);
    assert.match(h, /href="\/admin\/morosidad"/);
    assert.match(h, /href="https:\/\/manual\.ejemplo\/manual\.html#admin\.pagos"/);
    assert.match(h, /Ver video/);
    assert.match(h, /Empezar de nuevo/);
    assert.ok(!EMOJI.test(h));
  });

  it('sin manual configurado no hay «Ver video»; sin casillas no hay «Empezar de nuevo»', () => {
    const h = pinta([], null);
    assert.ok(!/Ver video/.test(h));
    assert.ok(!/Empezar de nuevo/.test(h));
    assert.match(h, /0 de 6/);
  });
});

describe('Cuándo hay demo y qué muestra /demo', () => {
  it('sólo las direcciones demo.* y local preguntan al servidor: torrecondominios.com no hace ninguna petición de más', () => {
    assert.equal(puedeSerDemo('demo.torrecondominios.com'), true);
    assert.equal(puedeSerDemo('localhost'), true);
    assert.equal(puedeSerDemo('127.0.0.1'), true);
    assert.equal(puedeSerDemo('torrecondominios.com'), false);
    assert.equal(puedeSerDemo('www.torrecondominios.com'), false);
    assert.equal(puedeSerDemo('midemo.example'), false);
  });

  it('las tarjetas sólo en una demo; en cualquier otra instancia, el enlace a la demo', () => {
    assert.equal(vistaDeDemo({ puedeSerDemo: false, cargando: false, demo: false }), 'sin_demo');
    assert.equal(vistaDeDemo({ puedeSerDemo: true, cargando: true, demo: false }), 'cargando');
    assert.equal(vistaDeDemo({ puedeSerDemo: true, cargando: false, demo: true }), 'tarjetas');
    assert.equal(vistaDeDemo({ puedeSerDemo: true, cargando: false, demo: false }), 'sin_demo');
    assert.equal(entradaDe('administradora'), '/admin/dashboard');
    assert.equal(entradaDe('superadmin'), null);
  });
});

describe('El cableado', () => {
  it('la ruta /demo existe y la franja va en la app (Shell) y NO en las pantallas públicas', () => {
    assert.match(APP, /path="\/demo"/);
    const shell = fuente('src/app/Shell.tsx');
    assert.match(shell, /import \{ FranjaDemo \} from '\.\/demo\/FranjaDemo'/);
    assert.match(shell, /<FranjaDemo \/>/);
  });

  it('la franja dice lo que pidió Miguel, con los 3 enlaces', () => {
    const f = fuente('src/app/demo/FranjaDemo.tsx');
    for (const frase of ['Estás en la demo de Torre', 'los datos son de ejemplo y se reinician cada noche', 'Cambiar de rol', 'Crear mi cuenta gratis', 'Hablar por WhatsApp', 'Qué probar']) assert.ok(f.includes(frase), frase);
    // En una instancia que no es demo no se pinta ni se pide el catálogo: el hook del catálogo vive en el componente que sólo se monta en una demo.
    assert.match(f, /return demo \? <FranjaActiva \/> : null/);
    assert.ok(f.indexOf('function FranjaActiva') < f.indexOf('useCatalogo()'));
  });

  it('en la instancia de demo, la portada es /demo; el pie y la cabecera ofrecen el registro de verdad (en torrecondominios.com)', () => {
    const portada = fuente('src/pages/publico/Portada.tsx');
    assert.match(portada, /useModoDemo/);
    assert.match(portada, /<Demo \/>/);
    const marco = fuente('src/pages/publico/Marco.tsx');
    assert.match(marco, /URL_TORRE/);
  });

  it('el inicio de sesión de una demo avisa que se entra por rol', () => {
    const login = fuente('src/pages/Login.tsx');
    assert.match(login, /useModoDemo/);
    assert.match(login, /to="\/demo"/);
  });

  it('ningún archivo nuevo de la demo lleva emojis ni celulares con forma real', () => {
    for (const f of ['src/app/demo/roles.ts', 'src/app/demo/guia.ts', 'src/app/demo/useDemo.ts', 'src/app/demo/FranjaDemo.tsx', 'src/app/demo/GuiaDemo.tsx', 'src/pages/publico/Demo.tsx', 'src/pages/publico/demo/logica.ts']) {
      const t = fuente(f);
      assert.ok(!EMOJI.test(t), `${f}: emojis`);
      assert.ok(!/\b9\d{2}[ -]?\d{3}[ -]?\d{3}\b/.test(t) || /\b900/.test(t), `${f}: celular`);
    }
  });
});

describe('La raíz de la instancia de demo', () => {
  it('en demo.… la raíz lleva a /demo; en cualquier otra dirección es la portada sin esperar a la consulta', () => {
    const raiz = APP.slice(APP.indexOf('function RaizPublica'));
    assert.match(APP, /pathname === '\/' \? <RaizPublica \/>/);
    assert.match(raiz, /!puedeSerDemo\(window\.location\.hostname\)\) return <Portada \/>/);
    assert.match(raiz, /demo \? <Navigate to="\/demo" replace \/> : <Portada \/>/);
  });
});
