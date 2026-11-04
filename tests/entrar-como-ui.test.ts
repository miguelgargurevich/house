// «Entrar como» en pantalla: la barra fija, el modal con el motivo, la búsqueda del superadmin y el historial. Lo que es lógica se prueba de verdad
// (minutos, textos, motivo); el cableado, con la fuente. El backend es la fuente de verdad (ver entrar-como.test.ts).
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { rotuloRol } from '../src/app/nav';
import { MOTIVO_MAX, MOTIVO_MIN, errorDeMotivo, minutosRestantes, quedanTexto } from '../src/auth/impersonacion-lib';

(globalThis as { React?: unknown }).React = React; // los componentes se compilan con el JSX clásico en las pruebas
const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

describe('minutos que quedan', () => {
  const t0 = Date.parse('2026-11-04T15:00:00.000Z');
  it('redondea hacia arriba: «quedan 1 min» hasta el último segundo; 0 al vencer o con una fecha inválida', () => {
    assert.equal(minutosRestantes('2026-11-04T15:30:00.000Z', t0), 30);
    assert.equal(minutosRestantes('2026-11-04T15:00:01.000Z', t0), 1);
    assert.equal(minutosRestantes('2026-11-04T15:00:00.000Z', t0), 0);
    assert.equal(minutosRestantes('2026-11-04T14:00:00.000Z', t0), 0, 'ya venció: nunca negativo');
    assert.equal(minutosRestantes('no-es-fecha', t0), 0);
    assert.equal(minutosRestantes(new Date('2026-11-04T15:10:30.000Z'), t0), 11);
  });
  it('el texto: «quedan N min», «queda 1 min» y, a cero, que terminó', () => {
    assert.equal(quedanTexto(25), 'quedan 25 min');
    assert.equal(quedanTexto(1), 'queda 1 min');
    assert.equal(quedanTexto(0), 'terminó la sesión');
  });
});

describe('el motivo, como lo pide el servidor', () => {
  it('de 5 a 200 caracteres sin contar los espacios de los bordes', () => {
    assert.match(errorDeMotivo('')!, /mínimo 5/);
    assert.match(errorDeMotivo('   abc  ')!, /mínimo 5/);
    assert.match(errorDeMotivo('abcd')!, /mínimo 5/);
    assert.equal(errorDeMotivo('abcde'), null);
    assert.equal(errorDeMotivo(`  ${'x'.repeat(MOTIVO_MAX)}  `), null);
    assert.match(errorDeMotivo('x'.repeat(MOTIVO_MAX + 1))!, /Máximo 200/);
    assert.equal(MOTIVO_MIN, 5);
  });
});

describe('la barra fija', async () => {
  const { ContenidoBarra } = await import('../src/app/ContenidoBarra');
  const usuario = { rol: 'propietario' as const, cargo_junta: 'tesorero' as const, estructura_id: 7, estructura_nombre: 'Block 1', junta_unica: false };
  const html = (over: Partial<Parameters<typeof ContenidoBarra>[0]> = {}) =>
    renderToStaticMarkup(createElement(ContenidoBarra, { nombre: 'Patricia Alarcón', rotulo: rotuloRol(usuario), minutos: 25, saliendo: false, error: null, onVolver: () => undefined, ...over }));

  it('dice como quién estás, su rol con el cargo, cuánto queda y trae «Volver a mi cuenta»', () => {
    const h = html();
    assert.match(h, /Estás viendo Torre como/);
    assert.match(h, /Patricia Alarcón/);
    assert.match(h, /Propietario · Tesorero del Block 1/);
    assert.match(h, /quedan 25 min/);
    assert.match(h, /Volver a mi cuenta/);
  });

  it('no se puede cerrar: sólo hay un botón y es el de volver; sin emojis', () => {
    const h = html();
    assert.equal((h.match(/<button/g) ?? []).length, 1);
    assert.doesNotMatch(h, /Cerrar|Descartar|aria-label="[^"]*cerrar/i);
    assert.doesNotMatch(h, EMOJI);
  });

  it('usa los colores de advertencia (tokens warn, con modo oscuro por variables) y se adapta al celular', () => {
    const h = html();
    assert.match(h, /bg-warn-soft/);
    assert.match(h, /text-warn/);
    assert.match(h, /flex-wrap/, 'a 375 px el texto y el botón bajan en vez de salirse');
    assert.match(h, /w-full sm:w-auto/, 'el botón ocupa todo el ancho en el celular');
    assert.match(h, /role="region"/);
    assert.match(h, /aria-label="Sesión de soporte"/);
  });

  it('el botón muestra que está saliendo y un error si no se pudo salir', () => {
    assert.match(html({ saliendo: true }), /aria-busy="true"/);
    assert.match(html({ error: 'No se pudo completar la operación' }), /role="alert"[^>]*>No se pudo completar la operación/);
    assert.match(html({ minutos: 0 }), /terminó la sesión/);
  });
});

describe('el cableado', () => {
  it('el Shell pinta la barra arriba de la cabecera y «Cerrar sesión» vuelve a la cuenta del superadmin; el asistente no se abre', () => {
    const s = fuente('src/app/Shell.tsx');
    assert.match(s, /<BarraImpersonacion \/>\s*<header/);
    assert.match(s, /if \(user\.impersonando\) \{ void volverAMiCuenta\(\)/);
    assert.match(s, /!user\.impersonando && <IconButton label=\{chat\.abierto/);
    assert.match(s, /!user\.impersonando && <Assistant/);
  });

  it('la barra lee `impersonando` del usuario, cuenta los minutos y, al llegar a cero, pregunta al servidor', () => {
    const s = fuente('src/app/BarraImpersonacion.tsx');
    assert.match(s, /user\?\.impersonando/);
    assert.match(s, /minutosRestantes\(imp\.expira_at, ahora\)/);
    assert.match(s, /minutos <= 0[\s\S]*void refresh\(\)/);
    assert.match(s, /rotuloRol\(user\)/);
  });

  it('entrar y volver: POST al servidor, el CSRF nuevo y recarga completa en el inicio del rol; si volver da 401, al inicio de sesión', () => {
    const s = fuente('src/auth/impersonacion.ts');
    assert.match(s, /'\/api\/impersonacion', \{ method: 'POST', json: \{ usuario_id: usuarioId, motivo \} \}/);
    assert.match(s, /'\/api\/impersonacion\/salir'/);
    assert.match(s, /window\.location\.assign\(HOME\[r\.user\.rol\]\)/);
    assert.match(s, /e\.status === 401[\s\S]*window\.location\.assign\('\/login'\)/);
  });

  it('el modal exige el motivo antes de llamar al servidor', () => {
    const s = fuente('src/pages/superadmin/_parts/EntrarComoModal.tsx');
    assert.match(s, /errorDeMotivo\(motivo\)/);
    assert.match(s, /if \(e\) \{ setError\(e\); return; \}/);
    assert.match(s, /entrarComo\(persona\.id, motivo\.trim\(\)\)/);
  });

  it('Superadmin › Usuarios del sistema tiene la pestaña «Entrar como», y el botón no sale para superadmins', () => {
    assert.match(fuente('src/pages/superadmin/Usuarios.tsx'), /label: 'Entrar como'/);
    const s = fuente('src/pages/superadmin/_parts/EntrarComo.tsx');
    assert.match(s, /f\.rol === 'superadmin' \|\| !f\.rol/);
    assert.match(s, /aria-label=\{`Entrar como \$\{f\.nombre\}`\}/);
    assert.match(s, /'\/api\/usuarios'/);
  });

  it('Superadmin › Auditoría muestra el historial (quién, a quién, motivo, inicio, fin y cómo terminó) y marca lo hecho en soporte', () => {
    const a = fuente('src/pages/superadmin/Auditoria.tsx');
    assert.match(a, /label: 'Entrar como'/);
    assert.match(a, /Soporte: \{r\.impersonador\.nombre\}/);
    const i = fuente('src/pages/superadmin/_parts/Impersonaciones.tsx');
    for (const h of ['Inicio', 'Quién', 'A quién', 'Motivo', 'Fin', 'Cómo terminó']) assert.match(i, new RegExp(`header: '${h}'`));
    assert.match(i, /'\/api\/impersonacion'/);
    for (const f of ['salir', 'vencio', 'revocada']) assert.match(i, new RegExp(`${f}: \\{ label:`));
  });

  it('el usuario de la sesión trae `impersonando` desde /auth/me', () => {
    assert.match(fuente('src/auth/AuthContext.tsx'), /impersonando\?: Impersonando \| null/);
  });
});
