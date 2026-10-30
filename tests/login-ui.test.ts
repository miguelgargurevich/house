// El login: panel derecho = una escena compuesta del flujo (recibo → voucher leído y confirmado → cobranza) con tokens propios, sin círculos; ver/ocultar contraseña.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const login = readFileSync('src/pages/Login.tsx', 'utf8');
const panel = readFileSync('src/pages/_login/PanelLogin.tsx', 'utf8');
const escena = readFileSync('src/pages/_login/Escena.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

describe('login', () => {
  it('el panel sale de Login.tsx: lo monta <PanelLogin /> y las escenas viven en _login/', () => {
    assert.match(login, /import PanelLogin from '\.\/_login\/PanelLogin'/);
    assert.ok(login.includes('<PanelLogin />'));
    assert.doesNotMatch(login, /function Escena/);
    assert.doesNotMatch(login, /rounded-full border border-on-brand/);
  });

  it('una sola escena con el flujo en tres tiempos: recibo, voucher con el sello «IA + tesorero» y cobranza', () => {
    for (const parte of ['<Recibo />', '<Voucher />', '<Cobranza />']) assert.ok(escena.includes(parte), parte);
    assert.match(escena, /\/>Voucher leído · Tesorero confirmó\n/);
    // El recibo pasa de «Por pagar» a «Pagado»; el total cuadra con sus conceptos (70 + 50.93 + 35 + 16.10 + 10).
    assert.match(escena, />Por pagar<\/span>/);
    assert.match(escena, /S\/ 182\.03/);
    assert.equal((escena.match(/S\/ 182\.03/g) ?? []).length, 2, 'el voucher paga el total del recibo');
    // La cobranza cuadra: 33 de 36 = 92 % (antes 32 de 36 = 89 %).
    assert.match(escena, /antes="89 %" despues="92 %"/);
    assert.match(escena, /antes="32" despues="33"/);
    assert.match(escena, /<span className="num">36<\/span> departamentos/);
  });

  it('el panel es decorativo, sólo desde lg, y cuenta hechos verdaderos (sin testimonios ni cifras inventadas)', () => {
    assert.match(panel, /<aside className="[^"]*hidden[^"]*lg:[^"]*" aria-hidden="true">/);
    for (const hecho of ['Yape, Plin y transferencias', 'Avisos por WhatsApp y correo', 'Cierre del mes por block']) assert.ok(panel.includes(hecho), hecho);
    assert.doesNotMatch(panel + escena, /testimonio|clientes que confían|\d+ ?\+? condominios/i);
  });

  it('el panel usa tokens propios para claro y oscuro y las superficies del tema', () => {
    assert.match(panel, /bg-escena text-on-escena/);
    assert.equal((css.match(/--escena:/g) ?? []).length, 2);
    assert.match(escena, /bg-escena-tarjeta/);
    assert.doesNotMatch(panel + escena, /\b(?:gray|slate|blue)-\d|#[0-9a-fA-F]{3,6}\b|dark:/);
  });

  it('la entrada es CSS acotado, desde visible, y no se mueve si el sistema lo pide', () => {
    // Todas las animaciones están dentro de la media query de movimiento permitido: sin ella, la escena ya está completa.
    const [fuera, dentro] = escena.split('@media (prefers-reduced-motion: no-preference)');
    assert.ok(dentro, 'falta la media query');
    assert.doesNotMatch(fuera.replace(/@keyframes[^\n]*/g, ''), /animation-name/);
    assert.match(dentro, /\.lg-carta \{ animation-name: lg-sube/);
    assert.match(dentro, /\.lg-sello \{ animation-name: lg-sello/);
    assert.match(escena, /\.lg-antes \{ opacity: 0; visibility: hidden; \}/);
    // Nada de librerías ni de keyframes fuera del componente.
    assert.doesNotMatch(panel + escena, /from 'framer-motion'|from 'gsap'/);
  });

  it('la escena se ajusta al hueco del panel y el panel no estira la página', () => {
    assert.match(panel, /new ResizeObserver\(medir\)/);
    assert.match(panel, /lg:sticky lg:top-0[^"]*lg:h-screen/);
  });

  it('mostrar u ocultar la contraseña con un botón accesible', () => {
    assert.match(login, /type=\{verClave \? 'text' : 'password'\}/);
    assert.match(login, /aria-label=\{verClave \? 'Ocultar contraseña' : 'Mostrar contraseña'\}/);
    assert.match(login, /aria-pressed=\{verClave\}/);
  });

  it('las cuentas de prueba incluyen al tesorero del block y al tesorero central (con la clave del seed)', () => {
    assert.match(login, /\['Tesorero', 'patricia\.alarcon\.9@prueba\.house', 'prop1234'\]/);
    assert.match(login, /\['Tesorero central', 'gustavo\.cruz\.4@prueba\.house', 'prop1234'\]/);
  });
});
