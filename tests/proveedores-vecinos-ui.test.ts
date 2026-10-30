// «Proveedores» del vecino: pruebas de FUENTE de la UI (regex sobre el .tsx), del menú, de las rutas y de los enlaces de contacto. La API está en proveedores-vecinos.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { navPara } from '../src/app/nav';
import { RUTAS_POR_ROL, rutaPermitida } from '../src/server/lib/rutasApp';
import { enlaceEscribir, enlaceLlamar, enlaceWhatsApp } from '../src/pages/residente/_parts/proveedores/enlaces';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const RES = 'src/pages/residente/';
const app = f('src/App.tsx');
const bloque = (apertura: string) => {
  const i = app.indexOf(apertura);
  assert.ok(i >= 0, `no está ${apertura}`);
  return app.slice(i, app.indexOf('</Route>', i));
};
const usuario = (rol: 'propietario' | 'inquilino') => ({ rol, cargo_junta: null, complejo_id: 1 }) as const;

describe('«Proveedores» del vecino: menú y rutas', () => {
  for (const rol of ['propietario', 'inquilino'] as const) {
    const ruta = `/${rol}/proveedores`;
    it(`${rol}: «Proveedores» va justo después de «Mi junta» y la ruta está en la lista del rol`, () => {
      const items = navPara(usuario(rol)).flatMap((g) => g.items);
      const i = items.findIndex((x) => x.to === ruta);
      assert.ok(i > 0, 'no hay ítem');
      assert.equal(items[i]!.label, 'Proveedores');
      assert.equal(items[i - 1]!.to, `/${rol}/junta`);
      assert.equal(items[i + 1]!.to, `/${rol}/comunicados`);
      assert.ok(RUTAS_POR_ROL[rol].includes(ruta));
      assert.equal(rutaPermitida({ ...usuario(rol), id: 1, email: 'a@b.pe', empresa_id: null, estructura_id: null }, ruta), ruta);
    });

    it(`${rol}: la ruta está dentro de su RequireRole`, () => {
      assert.match(bloque(`<Route element={<RequireRole roles={['${rol}']} />}>`), new RegExp(`path="${ruta}" element=\\{<ResidenteProveedores />\\}`));
    });
  }

  it('la administración y el personal no tienen estas rutas', () => {
    for (const rol of ['admin', 'superadmin', 'mantenimiento', 'seguridad', 'limpieza', 'jardineria'] as const) {
      assert.ok(!RUTAS_POR_ROL[rol].some((r) => r.endsWith('/proveedores') && r !== '/admin/proveedores'), rol);
    }
  });
});

describe('«Proveedores» del vecino: la pantalla', () => {
  const archivos = [`${RES}Proveedores.tsx`, `${RES}_parts/proveedores/ProveedoresResidente.tsx`, `${RES}_parts/proveedores/ProveedorVecinoCard.tsx`, `${RES}_parts/proveedores/enlaces.ts`];

  it('lee SÓLO /api/me/proveedores (nunca la API de gestión, que trae notas y RUC)', () => {
    assert.match(f(`${RES}_parts/proveedores/ProveedoresResidente.tsx`), /useResource<\{ items: GrupoProveedores\[\] \}>\('\/api\/me\/proveedores'\)/);
    for (const a of archivos) assert.doesNotMatch(f(a), /\/api\/proveedores/, a);
  });

  it('no pinta ni tipa notas, RUC ni cuentas, y no inyecta HTML', () => {
    for (const a of archivos) {
      const s = f(a);
      const codigo = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // los comentarios sí pueden decir qué NO se muestra
      assert.doesNotMatch(s, /dangerouslySetInnerHTML|innerHTML/, a);
      assert.doesNotMatch(codigo, /\bnotas\b|\bruc\b|cuenta_/i, a);
    }
  });

  it('tiene los botones Llamar, WhatsApp y Escribir, con objetivo táctil de 40 px, y el WhatsApp abre en pestaña nueva sin `opener`', () => {
    const s = f(`${RES}_parts/proveedores/ProveedorVecinoCard.tsx`);
    for (const t of ['Llamar', 'WhatsApp', 'Escribir']) assert.match(s, new RegExp(`>${t}</Accion>`));
    assert.match(s, /h-10/);
    assert.match(s, /rel: 'noopener noreferrer'/);
  });

  it('el estado vacío lo dice claro y las dos rutas comparten la misma pantalla', () => {
    assert.match(f(`${RES}_parts/proveedores/ProveedoresResidente.tsx`), /Tu administración aún no comparte proveedores/);
    assert.match(app, /const ResidenteProveedores = lazy\(\(\) => import\('\.\/pages\/residente\/Proveedores'\)\)/);
  });

  it('usa los colores del tema (modo oscuro) y no colores fijos', () => {
    for (const a of archivos) assert.doesNotMatch(f(a), /#[0-9a-fA-F]{3,6}\b|\b(bg|text|border)-(white|black|gray|slate|zinc)/, a);
  });
});

describe('«Proveedores» del vecino: enlaces de contacto', () => {
  it('Llamar: tel: con el número en formato internacional; un valor que no es teléfono no arma enlace', () => {
    assert.equal(enlaceLlamar('+51 987 654 321'), 'tel:+51987654321');
    assert.equal(enlaceLlamar('987654321'), 'tel:+51987654321');
    assert.equal(enlaceLlamar('javascript:alert(1)'), null);
    assert.equal(enlaceLlamar('abc'), null);
    assert.equal(enlaceLlamar(null), null);
  });

  it('WhatsApp: wa.me con el celular normalizado (sin «+» ni espacios); un fijo o un valor inválido no tiene WhatsApp', () => {
    assert.equal(enlaceWhatsApp('+51 987 654 321'), 'https://wa.me/51987654321');
    assert.equal(enlaceWhatsApp('987-654-321'), 'https://wa.me/51987654321');
    assert.equal(enlaceWhatsApp('01 234 5678'), null, 'fijo de Lima');
    assert.equal(enlaceWhatsApp('12345'), null);
    assert.equal(enlaceWhatsApp(''), null);
  });

  it('Escribir: mailto: con el correo codificado; sin correo no hay enlace', () => {
    assert.equal(enlaceEscribir('ventas@asc.pe'), 'mailto:ventas@asc.pe');
    assert.equal(enlaceEscribir('a b@x.pe?cc=otro@x.pe'), 'mailto:a%20b@x.pe%3Fcc%3Dotro@x.pe');
    assert.equal(enlaceEscribir(null), null);
  });
});

describe('Proveedores de la administración: «Visible para los vecinos»', () => {
  const s = f('src/pages/admin/Proveedores.tsx');
  it('el formulario trae el interruptor, apagado por defecto en un proveedor nuevo, y manda el campo al guardar', () => {
    assert.match(s, /<Interruptor label="Visible para los vecinos"/);
    assert.match(s, /activo: true, visible_vecinos: false, empresa_id: ''/);
    assert.match(s, /visible_vecinos: v\.visible_vecinos/);
  });
  it('la lista tiene la columna «Vecinos» con el cambio rápido (sólo manda ese campo) y la junta no lo cambia en los compartidos', () => {
    assert.match(s, /header: 'Vecinos'/);
    assert.match(s, /json: \{ visible_vecinos: valor \}/);
    assert.match(s, /esJunta && p\.compartido/);
  });
});
