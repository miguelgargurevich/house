// Junta única (un condominio con una sola junta directiva): menú, rótulo y textos. Pruebas de FUENTE del front (regex sobre los .tsx) y de
// las funciones puras de nav.ts. La regla que decide si un condominio es de junta única está en junta-unica.test.ts (API).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { navPara, rotuloRol } from '../src/app/nav';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const rutas = (u: Parameters<typeof navPara>[0]) => navPara(u).flatMap((g) => g.items).map((i) => i.to);

const tesorera = { rol: 'propietario', cargo_junta: 'tesorero', complejo_id: 1, estructura_id: null } as const;
const presidenta = { rol: 'propietario', cargo_junta: 'presidente', complejo_id: 1, estructura_id: null } as const;
const presidenteDeBlock = { rol: 'propietario', cargo_junta: 'presidente', complejo_id: 1, estructura_id: 3, estructura_nombre: 'Block 1' } as const;

describe('junta única: el menú de la junta', () => {
  it('sin «Aportes de los blocks» ni «Cierre de la Junta central»; queda «Cierre del mes»', () => {
    for (const u of [{ ...tesorera, junta_unica: true }, { ...presidenta, junta_unica: true }]) {
      const r = rutas(u);
      assert.ok(!r.includes('/junta/aportes'), 'no debe salir Aportes de los blocks');
      assert.ok(!r.includes('/junta/cierre-central'), 'no debe salir Cierre de la Junta central');
      assert.ok(r.includes('/junta/cierre'), 'sí sale Cierre del mes');
      assert.ok(r.includes('/junta/mi-junta') && r.includes('/junta/medios-pago') && r.includes('/junta/pagos'));
    }
  });

  it('una junta central de un condominio CON juntas por block (Los Libertadores) sigue con Aportes y Cierre de la Junta central', () => {
    const r = rutas({ ...tesorera, junta_unica: false });
    assert.ok(r.includes('/junta/aportes'));
    assert.ok(r.includes('/junta/cierre-central'));
  });

  it('una junta de block no tiene esas dos entradas, con o sin la marca', () => {
    for (const u of [presidenteDeBlock, { ...presidenteDeBlock, junta_unica: false }]) {
      const r = rutas(u);
      assert.ok(!r.includes('/junta/aportes') && !r.includes('/junta/cierre-central'));
    }
  });

  it('una sesión sin la marca (antes del cambio) se comporta como antes: la Junta central ve sus dos entradas', () => {
    const r = rutas(tesorera);
    assert.ok(r.includes('/junta/aportes') && r.includes('/junta/cierre-central'));
  });

  it('el admin no cambia por esta marca', () => {
    assert.deepEqual(rutas({ rol: 'admin', cargo_junta: null, complejo_id: 1, estructura_id: null, junta_unica: true }), rutas({ rol: 'admin', cargo_junta: null, complejo_id: 1, estructura_id: null }));
  });
});

describe('junta única: el rótulo del usuario', () => {
  it('«Propietario · Tesorero de la junta» y «Propietario · Presidente de la junta»', () => {
    assert.equal(rotuloRol({ rol: 'propietario', cargo_junta: 'tesorero', estructura_id: null, estructura_nombre: null, junta_unica: true }), 'Propietario · Tesorero de la junta');
    assert.equal(rotuloRol({ rol: 'propietario', cargo_junta: 'presidente', estructura_id: null, estructura_nombre: null, junta_unica: true }), 'Propietario · Presidente de la junta');
  });

  it('fuera de junta única el rótulo no cambia: «de la Junta central» y «del Block 1»', () => {
    assert.equal(rotuloRol({ rol: 'propietario', cargo_junta: 'tesorero', estructura_id: null, estructura_nombre: null, junta_unica: false }), 'Propietario · Tesorero de la Junta central');
    assert.equal(rotuloRol({ rol: 'propietario', cargo_junta: 'tesorero', estructura_id: 3, estructura_nombre: 'Block 1', junta_unica: false }), 'Propietario · Tesorero del Block 1');
  });
});

describe('junta única: las pantallas de la junta', () => {
  it('/junta/aportes y /junta/cierre-central dan un aviso claro (no un error) en junta única, y el resto de la junta pasa igual', () => {
    const g = f('src/auth/guards.tsx');
    assert.match(g, /const SOLO_JUNTA_CENTRAL = \['\/junta\/aportes', '\/junta\/cierre-central'\];/);
    assert.match(g, /if \(user\.junta_unica && SOLO_JUNTA_CENTRAL\.includes\(loc\.pathname\)\) return <AvisoJuntaUnica \/>;/);
    assert.match(g, /title="Esta pantalla no aplica a tu condominio"/);
    // El aviso va después de la comprobación de la junta (sin sesión de junta, nada cambia).
    assert.ok(g.indexOf('if (!esJunta(user))') < g.indexOf('SOLO_JUNTA_CENTRAL.includes'));
  });

  it('«Mi junta» de la junta: en junta única sólo la tarjeta de la junta de todo el condominio, titulada «Junta directiva»', () => {
    const s = f('src/pages/admin/Juntas.tsx');
    assert.match(s, /const unica = complejoElegido\?\.junta_unica === true;/);
    assert.match(s, /const visibles = esJunta && unica \? items\.filter\(i => i\.estructura === null\) : items;/);
    assert.match(s, /\{visibles\.map\(f => \(/);
    assert.match(s, /'Junta directiva' : 'Junta directiva del condominio'/);
    assert.match(s, /La junta directiva del condominio con sus miembros|de tu edificio, su correo/);
  });

  it('la tarjeta de la junta de todo el condominio usa el título que le pasa la pantalla', () => {
    const c = f('src/pages/admin/_parts/juntas/JuntaCard.tsx');
    assert.match(c, /title=\{ficha\.estructura == null && tituloCentral \? tituloCentral : nombre\}/);
  });

  it('al crear la junta de un condominio sin junta de block, el botón y el formulario dicen «Junta directiva del condominio»', () => {
    const s = f('src/pages/admin/Juntas.tsx');
    assert.match(s, /const sinBlocksConJunta = \(complejoId: number\) => !items\.some\(i => i\.estructura !== null && i\.vigente !== null && i\.complejo\.id === complejoId\);/);
    assert.match(s, /\{sinBlocksConJunta\(complejoElegido\.id\) \? 'Junta directiva del condominio' : 'Junta central'\}<\/Button>/);
    assert.match(s, /tituloCentral=\{tituloRegistro\}/);
    assert.match(f('src/pages/admin/_parts/juntas/JuntaFormModal.tsx'), /estructura == null && tituloCentral \? tituloCentral : nombreAmbito\(estructura\)/);
  });

  it('la pantalla del vecino: en junta única, «Junta directiva» y «Escríbele a la junta»; la bajada no habla de blocks', () => {
    const card = f('src/pages/residente/_parts/junta/JuntaVecinoCard.tsx');
    assert.match(card, /const unica = centro && item\.junta_unica === true;/);
    assert.match(card, /const nombre = unica \? 'Junta directiva' : nombreJunta\(ambito\);/);
    assert.match(card, /\{unica \? 'Escríbele a la junta' : `Escríbele a \$\{centro \? 'la Junta central' : 'tu junta'\}`\}/);
    const page = f('src/pages/residente/_parts/MiJuntaResidente.tsx');
    assert.match(page, /'Quiénes forman la junta directiva de tu edificio, cómo escribirles y a qué cuenta pagas\.'/);
    assert.match(page, /'Quiénes forman la junta directiva de tu block y la Junta central, cómo escribirles y a qué cuenta pagas\.'/);
  });

  it('fuera de junta única, los textos de siempre siguen (Los Libertadores)', () => {
    const page = f('src/pages/residente/_parts/MiJuntaResidente.tsx');
    assert.match(page, /tu block y la Junta central/);
    const admin = f('src/pages/admin/Juntas.tsx');
    assert.match(admin, /: 'Junta central'\}<\/Button>/);
    assert.match(admin, /La junta de cada \$\{palabra\} con sus miembros/);
  });
});
