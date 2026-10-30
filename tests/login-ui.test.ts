// El login: escena del producto (recibo, recordatorio, cobro) en vez de círculos decorativos; ver/ocultar contraseña; panel con tokens propios.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const login = readFileSync('src/pages/Login.tsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');

describe('login', () => {
  it('sin los círculos de fondo: el panel muestra el producto (recibo, recordatorio y cobro)', () => {
    assert.doesNotMatch(login, /rounded-full border border-on-brand/);
    for (const parte of ['<EscenaRecibo />', '<EscenaAviso />', '<EscenaGrafico />', '<EscenaCobro />']) assert.ok(login.includes(parte), parte);
    // El gráfico de cobranza mensual termina en el mismo 92 % de la tarjeta de cobro, y se describe para lectores de pantalla.
    assert.match(login, /\['Oct', 92\]/);
    assert.match(login, /role="img" aria-label="Porcentaje cobrado de mayo a octubre/);
    // El total del recibo cuadra con sus conceptos (70 + 50.93 + 35 + 16.10 + 10).
    assert.match(login, /S\/ 182\.03/);
  });

  it('el panel usa tokens propios para claro y oscuro (no el brand claro del modo oscuro) y anima desde visible', () => {
    assert.match(login, /bg-escena text-on-escena/);
    assert.equal((css.match(/--escena:/g) ?? []).length, 2);
    assert.match(login, /motion-safe:animate-\[sube-corto_/);
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
