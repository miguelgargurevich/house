// «Mi junta» del residente: pruebas de FUENTE de la UI (regex sobre el .tsx), del menú y de las listas de rutas. La API se prueba en mi-junta.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { navPara } from '../src/app/nav';
import { RUTAS_POR_ROL, rutaPermitida } from '../src/server/lib/rutasApp';
import { laJunta, mailtoJunta, nombreJunta } from '../src/pages/residente/_parts/junta/tipos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const RES = 'src/pages/residente/';
const app = f('src/App.tsx');
const bloque = (apertura: string) => {
  const i = app.indexOf(apertura);
  assert.ok(i >= 0, `no está ${apertura}`);
  return app.slice(i, app.indexOf('</Route>', i));
};
const usuario = (rol: 'propietario' | 'inquilino', cargo_junta: 'presidente' | null = null) => ({ rol, cargo_junta, complejo_id: 1 }) as const;
const ruta = (rol: 'propietario' | 'inquilino') => `/${rol}/junta`;

describe('«Mi junta» del residente: menú y rutas', () => {
  for (const rol of ['propietario', 'inquilino'] as const) {
    it(`${rol}: «Mi junta» va entre «Mi historial» y «Proveedores» y la ruta está en la lista del rol`, () => {
      const items = navPara(usuario(rol)).flatMap((g) => g.items);
      const i = items.findIndex((x) => x.to === ruta(rol));
      assert.ok(i > 0, 'no hay ítem');
      assert.equal(items[i]!.label, 'Mi junta');
      assert.equal(items[i - 1]!.to, `/${rol}/pagos`);
      assert.equal(items[i + 1]!.to, `/${rol}/proveedores`);
      assert.ok(RUTAS_POR_ROL[rol].includes(ruta(rol)));
      assert.equal(rutaPermitida({ ...usuario(rol), id: 1, email: 'a@b.pe', empresa_id: null, estructura_id: null }, ruta(rol)), ruta(rol));
    });

    it(`${rol}: la ruta de la pantalla está dentro de su RequireRole`, () => {
      assert.match(bloque(`<Route element={<RequireRole roles={['${rol}']} />}>`), new RegExp(`path="${ruta(rol)}" element=\\{<ResidenteMiJunta />\\}`));
    });
  }

  it('los dos roles comparten la misma pantalla y no entran a /junta/mi-junta (la de gestión)', () => {
    assert.match(app, /const ResidenteMiJunta = lazy\(\(\) => import\('\.\/pages\/residente\/MiJunta'\)\)/);
    assert.ok(!RUTAS_POR_ROL.propietario.includes('/junta/mi-junta') && !RUTAS_POR_ROL.inquilino.includes('/junta/mi-junta'));
    assert.ok(!RUTAS_POR_ROL.admin.includes('/propietario/junta'));
  });
});

describe('«Mi junta» del residente: la pantalla', () => {
  const archivos = [`${RES}MiJunta.tsx`, `${RES}_parts/MiJuntaResidente.tsx`, `${RES}_parts/junta/JuntaVecinoCard.tsx`, `${RES}_parts/junta/tipos.ts`];

  it('lee SÓLO /api/me/juntas (nunca la API de gestión, que trae correo y celular de los miembros)', () => {
    const s = f(`${RES}_parts/MiJuntaResidente.tsx`);
    assert.match(s, /useResource<\{ items: JuntaVecino\[\] \}>\('\/api\/me\/juntas'\)/);
    for (const a of archivos) assert.doesNotMatch(f(a), /\/api\/juntas|\/api\/medios-pago(?!\/)/, a);
  });

  it('no pinta ni tipa correo o celular personal de los miembros, ni inyecta HTML', () => {
    for (const a of archivos) {
      const s = f(a);
      assert.doesNotMatch(s, /dangerouslySetInnerHTML|innerHTML/, a);
      assert.doesNotMatch(s, /m\.(email|telefono)|\bemail\b|\btelefono\b/, a);
    }
  });

  it('el correo de la junta es un enlace mailto: «Escríbele a tu junta», y que no se salga del 375 px (break-all)', () => {
    const s = f(`${RES}_parts/junta/JuntaVecinoCard.tsx`);
    assert.match(s, /<a href=\{mailtoJunta\(j\.correo\)\}/);
    assert.match(s, /Escríbele a \{centro \? 'la Junta central' : 'tu junta'\}/);
    assert.match(s, /break-all text-xs font-normal text-muted">\{j\.correo\}/);
  });

  it('la cuenta se copia con «Copiar» (cuenta, CCI y celular) y el QR se ve con el componente de siempre', () => {
    const s = f(`${RES}_parts/junta/JuntaVecinoCard.tsx`);
    assert.match(s, /etiqueta="Cuenta" valor=\{c\.numero_cuenta\}/);
    assert.match(s, /etiqueta="CCI" valor=\{c\.cci\}/);
    assert.match(s, /etiqueta="Celular" valor=\{c\.celular\}/);
    assert.match(s, /navigator\.clipboard\?\.writeText\(valor\)/);
    assert.match(s, /<QrImagen id=\{c\.id\}/);
  });

  it('estado vacío y «sin junta» con texto claro; modo oscuro por los tokens (sin colores fijos)', () => {
    assert.match(f(`${RES}_parts/MiJuntaResidente.tsx`), /<EmptyState icon=\{<UserGroupIcon \/>\} title="Aún no hay una junta para mostrarte"/);
    assert.match(f(`${RES}_parts/junta/JuntaVecinoCard.tsx`), /Aún no hay una junta registrada para \$\{nombre\}/);
    for (const a of archivos) assert.doesNotMatch(f(a), /\b(?:bg|text|border)-(?:white|black|gray|slate|zinc|neutral)\b/, a);
  });

  it('el asistente nombra «Mi junta» con las rutas de los dos roles', () => {
    const p = f('src/config/ai-system-prompt.txt');
    assert.ok(p.includes('[Mi junta](/propietario/junta)') && p.includes('[Mi junta](/inquilino/junta)'));
  });
});

describe('«Mi junta» del residente: textos y enlaces', () => {
  it('«Junta central» si no hay block; «Torre n» si el block no tiene nombre', () => {
    const complejo = { id: 1, nombre: 'C' };
    assert.equal(nombreJunta({ complejo, estructura: null }), 'Junta central');
    assert.equal(laJunta({ complejo, estructura: null }), 'la Junta central');
    assert.equal(nombreJunta({ complejo, estructura: { id: 7, nombre: ' Block 3 ', tipo: 'Block' } }), 'Block 3');
    assert.equal(nombreJunta({ complejo, estructura: { id: 7, nombre: null, tipo: 'Torre' } }), 'Torre 7');
    assert.equal(laJunta({ complejo, estructura: { id: 7, nombre: 'Block 3', tipo: 'Block' } }), 'la junta de Block 3');
  });

  it('mailtoJunta conserva la @ y codifica lo demás (nada de «?subject=» ni espacios crudos en el href)', () => {
    assert.equal(mailtoJunta('junta.b1@ejemplo.test'), 'mailto:junta.b1@ejemplo.test');
    assert.equal(mailtoJunta('a b@x.pe?cc=otro@x.pe'), 'mailto:a%20b@x.pe%3Fcc%3Dotro@x.pe');
  });
});
