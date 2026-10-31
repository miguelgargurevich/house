// Registro en dos pasos, lado pantalla: la administradora SIN condominios cae en la bienvenida (paso 2) desde cualquier pantalla de la administración,
// con el menú reducido; al crear su condominio llega al Resumen con la bienvenida (paso 3). Lo puro (menú) se prueba por comportamiento; lo demás, con la fuente,
// como el resto de *-ui.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { NAV, NAV_SIN_CONDOMINIO, navPara } from '../src/app/nav';
import { elegidoValido, SIN_SELECTOR } from '../src/app/condominio';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const app = fuente('src/App.tsx');
const guarda = fuente('src/app/RequireCondominio.tsx');
const proveedor = fuente('src/app/CondominioProvider.tsx');
const shell = fuente('src/app/Shell.tsx');
const bienvenida = fuente('src/pages/admin/Bienvenida.tsx');
const listo = fuente('src/pages/admin/_parts/BienvenidaListo.tsx');
const resumen = fuente('src/pages/admin/Dashboard.tsx');
const pasos = fuente('src/pages/publico/_parts/IndicadorPasos.tsx');

const admin = { rol: 'admin' as const, cargo_junta: null, complejo_id: null, estructura_id: null };

describe('menú de la administradora sin condominios', () => {
  it('sólo ve «Bienvenida» (no el menú completo); con condominios, el menú de siempre', () => {
    const sin = navPara(admin, { sinCondominios: true });
    assert.deepEqual(sin.flatMap(g => g.items.map(i => i.to)), ['/admin/bienvenida']);
    assert.equal(navPara(admin, { sinCondominios: false }), NAV.admin);
    assert.equal(navPara(admin), NAV.admin);
    assert.equal(NAV_SIN_CONDOMINIO, sin);
  });

  it('sólo cambia para el rol admin: el superadmin y los demás roles no pierden su menú', () => {
    for (const rol of ['superadmin', 'propietario', 'inquilino', 'mantenimiento', 'seguridad'] as const) {
      assert.equal(navPara({ ...admin, rol }, { sinCondominios: true }), NAV[rol], rol);
    }
  });

  it('el Shell le pasa al menú si no hay condominios', () => {
    assert.match(shell, /const \{ sinCondominios \} = useCondominio\(\);/);
    assert.match(shell, /navPara\(user, \{ sinCondominios \}\)/);
  });
});

describe('guarda: cualquier pantalla de la administración manda a la bienvenida mientras no haya condominio', () => {
  it('actúa sólo con el rol admin y sólo con la lista cargada y vacía; mientras llega no pinta la pantalla', () => {
    assert.match(guarda, /if \(user\?\.rol !== 'admin'\) return <Outlet \/>;/);
    assert.match(guarda, /if \(sinCondominios\) return <Navigate to=\{RUTA_BIENVENIDA\} replace \/>;/);
    assert.match(guarda, /if \(!listo && !error\) return/);
    assert.match(guarda, /RUTA_BIENVENIDA = '\/admin\/bienvenida'/);
  });

  it('el estado «sin condominios» sale de la lista ya cargada, sin error y vacía', () => {
    assert.match(proveedor, /sinCondominios: activo && cargado && !lista\.error && condominios\.length === 0/);
    assert.match(proveedor, /listo: activo && cargado && !lista\.error/);
    assert.equal(SIN_SELECTOR.sinCondominios, false);
    assert.equal(SIN_SELECTOR.listo, false);
    assert.equal(elegidoValido(null, []), null, 'sin condominios no hay nada elegido (el selector no se rompe)');
  });

  it('todas las rutas /admin/* de la administración y Mi plan van dentro de la guarda; la bienvenida, no (si no, se redirigiría a sí misma)', () => {
    const guardaEn = app.indexOf('<Route element={<RequireCondominio />}>');
    assert.ok(guardaEn > 0);
    const bienvenidaEn = app.indexOf('path="/admin/bienvenida"');
    assert.ok(bienvenidaEn > 0 && bienvenidaEn < guardaEn, 'la bienvenida va fuera de la guarda');
    assert.match(app, /<Route element=\{<RequireRole roles=\{\['admin'\]\} \/>\}>\s*<Route path="\/admin\/bienvenida" element=\{<AdminBienvenida \/>\} \/>/);
    const rutasAdmin = [...app.matchAll(/path="(\/admin\/[^"]+)"/g)].map(m => ({ ruta: m[1]!, en: m.index! })).filter(r => r.ruta !== '/admin/bienvenida');
    assert.ok(rutasAdmin.length >= 20, `rutas de admin: ${rutasAdmin.length}`);
    for (const r of rutasAdmin) {
      assert.ok(r.en > guardaEn, `${r.ruta} va después de abrir la guarda`);
    }
    assert.equal((app.match(/<RequireCondominio \/>/g) ?? []).length, 2, 'una guarda para el grupo admin/superadmin y otra para Mi plan');
    // Los demás roles no pasan por la guarda.
    assert.ok(app.indexOf('path="/propietario/inicio"') > app.lastIndexOf('<RequireCondominio />'));
    assert.ok(app.indexOf('path="/superadmin/dashboard"') < guardaEn);
  });
});

describe('paso 2: la pantalla de bienvenida', () => {
  it('muestra el indicador (Cuenta ✓, Condominio, Listo), «Paso 2 de 2: tu condominio» y pide los tres datos', () => {
    assert.match(bienvenida, /<IndicadorPasos actual=\{2\} \/>/);
    assert.match(bienvenida, /Paso 2 de 2: tu condominio/);
    for (const t of ['Nombre de tu administradora o junta', 'Nombre del condominio', 'N\\.º de departamentos', 'hint="Aproximado"']) assert.match(bienvenida, new RegExp(t), t);
    assert.match(bienvenida, /Te damos la bienvenida a Torre/, 'neutro en género');
  });

  it('envía al endpoint del paso 2 con los campos que valida el servidor y va al Resumen con el nombre en el estado', () => {
    assert.match(bienvenida, /api\('\/api\/comercial\/primer-condominio', \{ method: 'POST', json: \{ empresa: f\.empresa, condominio: f\.condominio, unidades: Number\(f\.unidades\) \} \}\)/);
    assert.match(bienvenida, /await recargar\(\);\s*nav\('\/admin\/dashboard', \{ replace: true, state: \{ bienvenida: f\.condominio\.trim\(\) \} \}\)/);
  });

  it('con 409 (ya tiene condominio) recarga la lista y no muestra un error; quien ya tiene condominio no ve esta pantalla', () => {
    assert.match(bienvenida, /err instanceof ApiError && err\.status === 409\) \{ await recargar\(\)/);
    assert.match(bienvenida, /if \(!sinCondominios && !enviando\.current\) return <Navigate to="\/admin\/dashboard" replace \/>;/);
    assert.match(bienvenida, /if \(user\?\.rol !== 'admin'\) return <Navigate/);
  });

  it('el botón no se activa con campos vacíos', () => {
    assert.match(bienvenida, /const completo = Object\.values\(f\)\.every\(v => v\.trim\(\) !== ''\);/);
    assert.match(bienvenida, /disabled=\{!completo\}/);
  });
});

describe('paso 3: el Resumen da la bienvenida con los siguientes pasos', () => {
  it('el Resumen muestra la tarjeta sólo si llega el nombre del condominio por el estado de la navegación', () => {
    assert.match(resumen, /useLocation\(\)\.state as \{ bienvenida\?: unknown \}/);
    assert.match(resumen, /typeof nuevo === 'string' && nuevo !== '' && <BienvenidaListo condominio=\{nuevo\} \/>/);
  });

  it('los siguientes pasos son enlaces: subir el Excel del recibo, medios de pago e invitar a la junta; el indicador marca «Listo»', () => {
    assert.match(listo, /<IndicadorPasos actual=\{3\} \/>/);
    for (const [ruta, titulo] of [['/admin/recibos', 'Sube el Excel del recibo'], ['/admin/medios-pago', 'Agrega tus medios de pago'], ['/admin/juntas', 'Invita a la junta directiva']]) {
      assert.match(listo, new RegExp(`to: '${ruta}', titulo: '${titulo}'`), titulo);
    }
    assert.match(listo, /<Link to=\{s\.to\}/);
    assert.match(listo, /¡Listo! Creamos \{condominio\}/);
  });
});

describe('indicador de pasos', () => {
  it('«Cuenta · Condominio · Listo»; los pasos hechos llevan ✓ (y se leen como «listo»), el actual aria-current', () => {
    assert.match(pasos, /\['Cuenta', 'Condominio', 'Listo'\]/);
    assert.match(pasos, /const hecho = n < actual;/);
    assert.match(pasos, /aria-current=\{aqui \? 'step' : undefined\}/);
    assert.match(pasos, /<span className="sr-only"> \(listo\)<\/span>/);
  });
});
