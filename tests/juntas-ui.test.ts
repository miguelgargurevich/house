// Juntas directivas: pruebas de FUENTE de la UI (regex sobre el .tsx), de rutas/menú y de las funciones puras de la pantalla.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { navPara } from '../src/app/nav';
import { RUTAS_JUNTA, RUTAS_POR_ROL, rutaPermitida } from '../src/server/lib/rutasApp';
import { cargoRepetido, diaSiguiente, nombreGestion, palabraDe, textoCuentaJunta } from '../src/pages/admin/_parts/juntas/tipos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const ADMIN = 'src/pages/admin/';
const JUNTAS = `${ADMIN}_parts/juntas/`;
const app = f('src/App.tsx');
/** El bloque de rutas (`<Route element={…}>` … `</Route>`) que arranca en `apertura`. */
const bloque = (apertura: string) => {
  const i = app.indexOf(apertura);
  assert.ok(i >= 0, `no está ${apertura}`);
  return app.slice(i, app.indexOf('</Route>', i));
};
const items = (r: Parameters<typeof navPara>[0]) => navPara(r).flatMap((g) => g.items.map((i) => `${i.label}|${i.to}`));
const usuario = (rol: 'propietario' | 'inquilino' | 'admin', cargo_junta: 'presidente' | 'tesorero' | 'secretario' | 'vocal' | null = null) => ({ rol, cargo_junta, complejo_id: 1 }) as const;

describe('juntas: rutas y menú', () => {
  it('«Juntas directivas» (/admin/juntas) está en el grupo Operación del admin y del superadmin, y la ruta en el bloque de administración', () => {
    for (const rol of ['admin', 'superadmin'] as const) {
      const operacion = navPara(usuario('admin')).find((g) => g.label === 'Operación');
      assert.ok(operacion?.items.some((i) => i.label === 'Juntas directivas' && i.to === '/admin/juntas'), rol);
      assert.ok(RUTAS_POR_ROL[rol].includes('/admin/juntas'), rol);
    }
    assert.match(bloque("<RequireRole roles={['superadmin','admin']} />"), /path="\/admin\/juntas" element=\{<AdminJuntas \/>\}/);
  });

  it('«Mi junta» (/junta/mi-junta) abre el grupo Junta del presidente y el tesorero, dentro de RequireJunta; secretario, vocal y residentes no la tienen', () => {
    for (const cargo of ['presidente', 'tesorero'] as const) {
      const junta = navPara(usuario('propietario', cargo)).find((g) => g.label === 'Junta');
      assert.equal(junta?.items[0]?.label, 'Mi junta');
      assert.equal(junta?.items[0]?.to, '/junta/mi-junta');
      assert.equal(rutaPermitida({ ...usuario('propietario', cargo), id: 1, email: 'x@y.pe', empresa_id: null, estructura_id: null }, '/junta/mi-junta'), '/junta/mi-junta');
    }
    assert.match(bloque('<RequireJunta />'), /path="\/junta\/mi-junta" element=\{<AdminJuntas \/>\}/);
    assert.ok(RUTAS_JUNTA.includes('/junta/mi-junta'));
    for (const u of [usuario('propietario', 'secretario'), usuario('propietario', 'vocal'), usuario('propietario'), usuario('inquilino')]) {
      assert.ok(!items(u).some((i) => i.endsWith('/junta/mi-junta') || i.endsWith('/admin/juntas')), JSON.stringify(u));
      assert.equal(rutaPermitida({ ...u, id: 1, email: 'x@y.pe', empresa_id: null, estructura_id: null }, '/junta/mi-junta'), null);
      assert.equal(rutaPermitida({ ...u, id: 1, email: 'x@y.pe', empresa_id: null, estructura_id: null }, '/admin/juntas'), null);
    }
  });

  it('las rutas de residentes no incluyen la pantalla de juntas', () => {
    for (const rol of ['propietario', 'inquilino'] as const) assert.ok(!RUTAS_POR_ROL[rol].some((r) => /juntas|mi-junta/.test(r)), rol);
    assert.doesNotMatch(bloque("<RequireRole roles={['propietario']} />"), /juntas|mi-junta/);
  });
});

describe('juntas: la pantalla', () => {
  const p = f(`${ADMIN}Juntas.tsx`);
  const card = f(`${JUNTAS}JuntaCard.tsx`);

  it('se llama «Mi junta» para el presidente/tesorero y «Juntas directivas» para la administración, y la API decide quién gestiona', () => {
    assert.match(p, /title=\{esJunta \? 'Mi junta' : 'Juntas directivas'\}/);
    assert.match(p, /esJunta = user\?\.rol === 'propietario'/);
    assert.match(p, /const puedeGestionar = lista\.data\?\.puede_gestionar \?\? false/);
    assert.match(p, /<JuntaFormModal entrada=\{registrando\} soloCorreo=\{!puedeGestionar\}/);
  });

  it('una tarjeta por block con Editar, Nueva gestión (sólo la administración) e Historial; un block sin junta muestra «Registrar la junta»', () => {
    assert.match(p, /<JuntaCard\b[\s\S]*puedeGestionar=\{puedeGestionar\}/);
    assert.match(card, />Editar<\/Button>/);
    assert.match(card, /\{puedeGestionar && <Button [^\n]*onClick=\{\(\) => onNuevaGestion\(j\)\}>Nueva gestión<\/Button>\}/);
    assert.match(card, />Historial\{ficha\.anteriores > 0/);
    assert.match(card, /\{puedeGestionar && <Button [^\n]*onClick=\{onRegistrar\}>Registrar la junta<\/Button>\}/);
    assert.match(card, /Cuenta donde pagan los vecinos/);
    assert.match(card, /Correo de la junta/);
  });

  it('muestra de cada miembro cargo, nombre, departamento, correo y celular, sin romper el 375 px', () => {
    assert.match(card, /cargoLabel\(m\.cargo\)/);
    assert.match(card, /break-words font-medium">\{m\.nombre\}/);
    assert.match(card, /Dpto\. \$\{m\.departamentos\.join\(', '\)\}/);
    assert.match(card, /break-all text-xs text-muted">\{m\.email\}/);
    assert.match(card, /\{m\.telefono && <p className="num text-xs text-muted">\{m\.telefono\}<\/p>\}/);
    assert.match(card, /className="grid gap-2 sm:grid-cols-2"/); // una columna en el celular
    assert.match(card, /className="num break-all">Cuenta \{m\.numero_cuenta\}/);
    assert.match(card, /className="num break-all">CCI \{m\.cci\}/);
    assert.match(card, /Titular: \{m\.titular\}/);
    assert.match(p, /className="grid gap-4 lg:grid-cols-2"/);
  });

  it('la cuenta de la junta se edita con el formulario de medio de pago de siempre, dentro de la junta (sin elegir a quién va)', () => {
    assert.match(p, /<MedioFormModal[\s\S]*junta=\{cuenta \? \{ complejo_id: cuenta\.junta\.complejo_id, estructura: cuenta\.junta\.estructura, desde: cuenta\.junta\.desde \} : undefined\}/);
    const m = f(`${ADMIN}_parts/medios/MedioFormModal.tsx`);
    assert.match(m, /\{nuevo && !unCondominio && !junta && \(/);
    assert.match(m, /\{nuevo && junta && <p [^>]*>\{textoCuentaJunta\(\{ desde: junta\.desde \}\)\}/);
    assert.match(m, /\{medio\.junta \? <>\{textoCuentaJunta\(medio\.junta\)\} · <\/> : 'Para: '\}/);
  });

  it('ningún archivo de juntas inyecta HTML', () => {
    for (const a of [`${ADMIN}Juntas.tsx`, ...['JuntaCard', 'JuntaFormModal', 'NuevaGestionModal', 'HistorialModal', 'MiembrosEditor', 'JuntasResumen'].map((n) => `${JUNTAS}${n}.tsx`)]) {
      assert.doesNotMatch(f(a), /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/, a);
    }
  });
});

describe('juntas: formularios', () => {
  it('registrar/editar y nueva gestión caben en 375 px (una columna) y la junta sólo edita el correo', () => {
    const form = f(`${JUNTAS}JuntaFormModal.tsx`);
    const nueva = f(`${JUNTAS}NuevaGestionModal.tsx`);
    for (const s of [form, nueva]) assert.match(s, /className="grid gap-4 sm:grid-cols-2"/);
    assert.match(form, /json: soloCorreo \? \{ correo \} : \{ correo, notas: v\.notas\.trim\(\) \|\| null, miembros: api_miembros \}/);
    assert.match(form, /\{!soloCorreo && \(/);
    assert.match(form, /\{nueva && \(\s*<Input\s+label="Inicio de la gestión" type="date"/);
    assert.match(nueva, /POST[\s\S]*nueva-gestion|`\/api\/juntas\/\$\{junta\.id\}\/nueva-gestion`/);
    assert.match(nueva, /min=\{diaSiguiente\(junta\.desde\)\}/);
    assert.match(nueva, /label="La cuenta sigue siendo la misma"/);
    assert.match(nueva, /misma_cuenta: activas\.length > 0 && v\.misma_cuenta/);
  });

  it('el editor de miembros: una fila por persona (persona arriba, cargo y quitar debajo en el celular), sólo propietarios del block y avisa del presidente/tesorero repetido', () => {
    const m = f(`${JUNTAS}MiembrosEditor.tsx`);
    assert.match(m, /className="flex flex-col gap-2 rounded-lg border border-line p-3 sm:flex-row sm:items-end"/);
    assert.match(m, /`\/api\/juntas\/candidatos\?complejo_id=\$\{complejoId\}/);
    assert.match(m, /disabled=\{\(elegidos\.has\(String\(c\.id\)\) && String\(c\.id\) !== f\.usuario_id\) \|\| otra\}/);
    assert.match(m, /\(ya está en otra junta\)/);
    assert.match(m, /Sólo puede haber un \{repetido\}/);
    assert.match(m, /Un solo presidente, un solo tesorero y un solo secretario/);
  });

  it('el historial es de sólo lectura (sin formularios ni botones de guardar) y pide el de ESE block', () => {
    const h = f(`${JUNTAS}HistorialModal.tsx`);
    assert.match(h, /\/api\/juntas\/historial\?complejo_id=\$\{ambito\.complejo_id\}&estructura_id=\$\{ambito\.estructura\?\.id \?\? 'ninguna'\}/);
    assert.doesNotMatch(h, /<form|type="submit"|method: '(POST|PUT|PATCH|DELETE)'/);
    assert.match(h, /Del \{fechaCorta\(j\.desde\)\} al \{fechaCorta\(j\.hasta\)\}/);
  });
});

describe('juntas: Medios de pago y Personas', () => {
  it('Medios de pago muestra arriba, por block, la junta vigente (presidente, tesorero, correo) con enlace a la junta', () => {
    const mp = f(`${ADMIN}MediosPago.tsx`);
    assert.match(mp, /<JuntasResumen complejoId=\{complejo\} torreId=\{torre\} esJunta=\{esJunta\} \/>/);
    assert.ok(mp.indexOf('<JuntasResumen') < mp.indexOf('<DataTable'), 'el resumen va arriba de la lista');
    const r = f(`${JUNTAS}JuntasResumen.tsx`);
    assert.match(r, /const enlace = esJunta \? '\/junta\/mi-junta' : '\/admin\/juntas'/);
    assert.match(r, /Presidente: \{quien\(f\.vigente, 'presidente'\)\}/);
    assert.match(r, /Tesorero: \{quien\(f\.vigente, 'tesorero'\)\}/);
    assert.match(r, /Correo: \{f\.vigente\.correo \?\? 'sin correo'\}/);
    assert.match(r, /break-all/); // el correo no rompe el 375 px
    assert.match(r, /grid gap-3 border-t border-line p-4 sm:grid-cols-2 lg:grid-cols-3/);
    assert.match(r, /torreId === 'ninguna' \? null/); // un medio de todo el condominio no tiene junta de block
  });

  it('Personas ya no edita el cargo de junta: sólo lo muestra y manda a «Juntas directivas»; no envía cargo_junta ni estructura_id', () => {
    const per = f(`${ADMIN}_parts/personas/PersonasLista.tsx`);
    assert.doesNotMatch(per, /register\('cargo_junta'\)/);
    assert.doesNotMatch(per, /body\.cargo_junta|body\.estructura_id/);
    assert.doesNotMatch(per, /label="Cargo en la junta"|label="Torre de la junta"/);
    assert.match(per, /Cargo en la junta: <span className="font-medium text-ink">\{editando\.cargo_junta \? cargoLabel\(editando\.cargo_junta\) : 'Ninguno'\}<\/span>/);
    assert.match(per, /se gestiona en <Link[^>]*to="\/admin\/juntas">Juntas directivas<\/Link>/);
    assert.match(per, /key: 'cargo', header: 'Cargo'/); // la columna de la lista sigue
  });
});

describe('juntas: funciones de la pantalla', () => {
  it('nombreGestion: «2026» o «2024-2025»; textoCuentaJunta: «Cuenta de la junta 2026 (desde …)»', () => {
    assert.equal(nombreGestion({ desde: '2026-01-01', hasta: null }), '2026');
    assert.equal(nombreGestion({ desde: '2024-01-01', hasta: '2025-12-31' }), '2024-2025');
    assert.equal(nombreGestion({ desde: '2025-03-01', hasta: '2025-12-31' }), '2025');
    assert.match(textoCuentaJunta({ desde: '2026-01-01' }), /^Cuenta de la junta 2026 \(desde .*2026\)$/);
  });

  it('palabraDe: «block» si todos los edificios son blocks; «torre» si hay otros o ninguno (la junta del condominio no cuenta)', () => {
    assert.equal(palabraDe([{ estructura: { tipo: 'Block' } }, { estructura: { tipo: 'block' } }, { estructura: null }]), 'block');
    assert.equal(palabraDe([{ estructura: { tipo: 'Block' } }, { estructura: { tipo: 'Torre' } }]), 'torre');
    assert.equal(palabraDe([{ estructura: null }]), 'torre');
    assert.equal(palabraDe([]), 'torre');
  });

  it('cargoRepetido avisa del presidente, el tesorero y el secretario repetidos (no de los vocales); diaSiguiente respeta los bisiestos', () => {
    assert.equal(cargoRepetido([{ cargo: 'presidente' }, { cargo: 'presidente' }]), 'presidente');
    assert.equal(cargoRepetido([{ cargo: 'tesorero' }, { cargo: 'tesorero' }]), 'tesorero');
    assert.equal(cargoRepetido([{ cargo: 'secretario' }, { cargo: 'secretario' }]), 'secretario');
    assert.equal(cargoRepetido([{ cargo: 'vocal' }, { cargo: 'vocal' }, { cargo: 'secretario' }]), null);
    assert.equal(diaSiguiente('2026-02-28'), '2026-03-01');
    assert.equal(diaSiguiente('2024-02-28'), '2024-02-29');
    assert.equal(diaSiguiente('2026-12-31'), '2027-01-01');
  });
});

describe('juntas: el seed muestra el historial', () => {
  it('Los Libertadores siembra una junta vigente por block y, en el Block 1, una gestión anterior cerrada con su cuenta inactiva', () => {
    const s = f('prisma/seed-libertadores.ts');
    assert.match(s, /prisma\.juntaDirectiva\.create/);
    assert.match(s, /hasta: new Date\(Date\.UTC\(2025, 11, 31\)\)/);
    assert.match(s, /junta_id: juntaVigente\.get\(b\)!/);
    assert.match(s, /activo: false, creado_por_id: ana, junta_id: juntaB1Anterior\.id/);
    assert.match(s, /prisma\.juntaDirectiva\.deleteMany/); // el seed borra antes de sembrar
  });
});

describe('juntas: orden de los blocks', () => {
  it('la lista ordena los blocks de forma natural (Block 2 antes que Block 10)', () => {
    const s = readFileSync('src/server/routes/juntas.ts', 'utf8');
    assert.match(s, /localeCompare\(y\.nombre \?\? '', 'es', \{ numeric: true \}\)/);
  });
});

describe('Junta central y cargos que faltan', () => {
  it('la junta de todo el condominio se llama «Junta central» y la tarjeta muestra el hueco de presidente, tesorero o secretario sin asignar', async () => {
    const { nombreAmbito, laJuntaDe } = await import('../src/pages/admin/_parts/juntas/tipos');
    assert.equal(nombreAmbito(null), 'Junta central');
    assert.equal(laJuntaDe(null), 'la Junta central');
    assert.equal(laJuntaDe({ id: 1, nombre: 'Block 1' }), 'la junta de Block 1');
    const c = readFileSync('src/pages/admin/_parts/juntas/JuntaCard.tsx', 'utf8');
    assert.match(c, /CARGOS_UNICOS\.filter\(c => !j\.miembros\.some/);
    assert.match(c, /Sin asignar/);
    assert.match(readFileSync('src/pages/admin/Juntas.tsx', 'utf8'), />Junta central<\/Button>/);
  });
});
