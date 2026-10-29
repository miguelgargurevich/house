// Pantallas de la invitación. El repo no monta React con `import.meta.env` en Node: la lógica va en funciones puras (reglas de la contraseña,
// mensaje del alta) y el cableado (ruta, interruptor, acción de reenviar) se fija leyendo la fuente.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { claveLista, reglasClave } from '../src/pages/publico/_parts/clave';
import { mensajeDeAlta } from '../src/pages/admin/_parts/personas/invitacion';
import { passwordSchema } from '../src/server/validation';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

describe('reglas de la contraseña en pantalla', () => {
  it('piden 8 caracteres, letra y número y que coincidan', () => {
    assert.deepEqual(reglasClave('', '').map((r) => r.ok), [false, false, false]);
    assert.deepEqual(reglasClave('abc12', 'abc12').map((r) => r.ok), [false, true, true]);
    assert.deepEqual(reglasClave('abcdefgh', 'abcdefgh').map((r) => r.ok), [true, false, true]);
    assert.deepEqual(reglasClave('abcdefg1', 'otra').map((r) => r.ok), [true, true, false]);
    assert.equal(claveLista('Clave-nueva1', 'Clave-nueva1'), true);
    assert.equal(claveLista('Clave-nueva1', 'Clave-nueva2'), false);
    assert.equal(claveLista('a1'.repeat(37), 'a1'.repeat(37)), false, 'más de 72');
  });

  it('no son más flexibles que el servidor: lo que la pantalla acepta por forma, el servidor lo acepta', () => {
    for (const c of ['Clave-nueva1', 'ñandú2026xx', 'a1b2c3d4']) {
      assert.equal(claveLista(c, c), true, c);
      assert.equal(passwordSchema.safeParse(c).success, true, c);
    }
    for (const c of ['corta1', 'sinnumeros', '12345678']) {
      assert.equal(claveLista(c, c), false, c);
      assert.equal(passwordSchema.safeParse(c).success, false, c);
    }
  });
});

describe('mensaje al crear una persona', () => {
  it('con invitación enviada lo dice y nombra el correo; sin invitación (con contraseña) queda como antes', () => {
    assert.deepEqual(mensajeDeAlta({ invitacion: { estado: 'enviada' } }, 'a@x.pe', 'persona'), { tono: 'ok', texto: 'Persona creado. Le enviamos una invitación a a@x.pe.' });
    assert.deepEqual(mensajeDeAlta({}, 'a@x.pe', 'residente'), { tono: 'ok', texto: 'Residente creado' });
  });
  it('si no se pudo invitar avisa (no es un éxito silencioso) y dice qué hacer', () => {
    const sin = mensajeDeAlta({ invitacion: { estado: 'sin_correo' } }, 'b@sin-correo.invalid', 'residente');
    assert.equal(sin.tono, 'aviso');
    assert.match(sin.texto, /contraseña/);
    const no = mensajeDeAlta({ invitacion: { estado: 'no_enviada', motivo: 'x' } }, 'a@x.pe', 'persona');
    assert.equal(no.tono, 'aviso');
    assert.match(no.texto, /Reenviar invitación/);
  });
});

describe('cableado de las pantallas', () => {
  it('la ruta pública /invitacion existe fuera de la sesión', () => {
    const app = fuente('src/App.tsx');
    assert.match(app, /lazy\(\(\) => import\('\.\/pages\/publico\/Invitacion'\)\)/);
    const antesDeRequireAuth = app.slice(0, app.indexOf('<RequireAuth'));
    assert.match(antesDeRequireAuth, /path="\/invitacion"/);
  });

  it('la página pide los datos con el token, manda la contraseña y entra con la sesión que dejó la cookie', () => {
    const p = fuente('src/pages/publico/Invitacion.tsx');
    assert.match(p, /\/api\/auth\/invitacion\?token=\$\{encodeURIComponent\(token\)\}/);
    assert.match(p, /'\/api\/auth\/invitacion', \{ method: 'POST', json: \{ token, password: clave \} \}/);
    assert.match(p, /await refresh\(\)/);
    assert.match(p, /nav\(HOME\[r\.user\.rol\]/);
    assert.match(p, /Repite la contraseña/);
    assert.match(p, /err\.status === 410/);
  });

  it('el formulario de alta: invitación por defecto, interruptor para ponerle contraseña y sólo entonces se manda', () => {
    const p = fuente('src/pages/admin/_parts/personas/PersonasLista.tsx');
    assert.match(p, /Asignar una contraseña ahora/);
    assert.match(p, /Le enviaremos una invitación a su correo para que cree su contraseña/);
    assert.match(p, /if \(v\.password && \(!nuevo \|\| clavePropia\)\) body\.password = v\.password/);
    assert.match(p, /\(editando !== 'nuevo' \|\| clavePropia\) && \(/, 'el campo de contraseña sólo aparece con el interruptor');
  });

  it('la lista muestra «Invitación pendiente» y ofrece «Reenviar invitación» sólo a esas personas', () => {
    const p = fuente('src/pages/admin/_parts/personas/PersonasLista.tsx');
    assert.match(p, /f\.invitacion_pendiente && <div className="mt-1"><Badge tone="warn">Invitación pendiente<\/Badge>/);
    assert.match(p, /f\.invitacion_pendiente && <IconButton label=\{`Reenviar invitación a \$\{f\.nombre\}`\}/);
    assert.match(p, /\/api\/usuarios\/\$\{f\.id\}\/invitacion`, \{ method: 'POST' \}/);
  });

  it('Usuarios del sistema (superadmin) y Personas comparten esa lista: las dos pantallas lo traen', () => {
    assert.match(fuente('src/pages/superadmin/Usuarios.tsx'), /PersonasLista/);
    assert.match(fuente('src/pages/admin/Personal.tsx'), /PersonasLista/);
    assert.match(fuente('src/pages/admin/Residentes.tsx'), /PersonasLista/);
  });
});
