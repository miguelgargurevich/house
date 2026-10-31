// Pantallas del cierre de la Junta central: lo que se dice y cuándo se ofrece cada acción se prueba de verdad en el módulo puro (`_parts/cierres/vista.ts`);
// la estructura de los componentes se fija con la fuente (el repo no tiene testing-library: no pinta).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { navPara } from '../src/app/nav';
import { RUTAS_JUNTA } from '../src/server/lib/rutasApp';
import { CATEGORIA_ETIQUETA, CATEGORIAS, CATEGORIAS_EGRESO, CATEGORIAS_INGRESO } from '../src/server/services/cierres/central';
import { CATEGORIAS_CENTRAL, ESTADO_APORTE, ESTADO_CENTRAL, camposDeCategoria, detalleMovimiento, erroresDeMovimiento, tituloMovimiento } from '../src/pages/admin/_parts/cierres/vista';
import type { CategoriaCentral } from '../src/pages/admin/_parts/cierres/tipos';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const valido = { monto: '150.00', fecha: '2026-10-02', descripcion: '', pagador: '', estacionamiento: '', tieneVoucher: true };

describe('categorías: la pantalla y el servidor dicen lo mismo', () => {
  it('las mismas cinco categorías, con las mismas etiquetas y el mismo tipo', () => {
    assert.deepEqual(CATEGORIAS_CENTRAL.map(c => c.value), [...CATEGORIAS]);
    for (const c of CATEGORIAS_CENTRAL) assert.equal(c.label, CATEGORIA_ETIQUETA[c.value], c.value);
    assert.deepEqual(CATEGORIAS_CENTRAL.filter(c => c.tipo === 'ingreso').map(c => c.value), [...CATEGORIAS_INGRESO]);
    assert.deepEqual(CATEGORIAS_CENTRAL.filter(c => c.tipo === 'egreso').map(c => c.value), [...CATEGORIAS_EGRESO]);
  });
  it('el alquiler de estacionamiento se dice como se decidió: se paga aparte, a la cuenta de la Junta central', () => {
    assert.match(CATEGORIAS_CENTRAL.find(c => c.value === 'alquiler_estacionamiento')!.ayuda, /aparte, a la cuenta de la Junta central/);
  });
});

describe('qué se pide al registrar cada categoría', () => {
  it('alquiler: quién paga y el estacionamiento, sin «detalle»; servicio y proveedor: su boleta o factura; sólo el proveedor elige proveedor', () => {
    assert.deepEqual(camposDeCategoria('alquiler_estacionamiento'), { pagador: true, estacionamiento: true, proveedor: false, documento: false, descripcion: false });
    assert.deepEqual(camposDeCategoria('servicio'), { pagador: false, estacionamiento: false, proveedor: false, documento: true, descripcion: true });
    assert.deepEqual(camposDeCategoria('proveedor'), { pagador: false, estacionamiento: false, proveedor: true, documento: true, descripcion: true });
    assert.deepEqual(camposDeCategoria('otro_ingreso'), { pagador: true, estacionamiento: false, proveedor: false, documento: false, descripcion: true });
    assert.deepEqual(camposDeCategoria('otro_egreso'), { pagador: false, estacionamiento: false, proveedor: false, documento: false, descripcion: true });
  });
  it('sin voucher no se envía, y dice por qué', () => {
    assert.deepEqual(erroresDeMovimiento({ ...valido, categoria: 'otro_egreso', descripcion: 'Papelería', tieneVoucher: false }), { voucher: 'Adjunta el voucher.' });
  });
  it('el alquiler exige quién paga y el estacionamiento; los demás, el detalle', () => {
    assert.deepEqual(Object.keys(erroresDeMovimiento({ ...valido, categoria: 'alquiler_estacionamiento' })).sort(), ['estacionamiento', 'pagador']);
    assert.deepEqual(erroresDeMovimiento({ ...valido, categoria: 'alquiler_estacionamiento', pagador: 'Juan', estacionamiento: 'E-12' }), {});
    for (const c of ['otro_ingreso', 'servicio', 'proveedor', 'otro_egreso'] as CategoriaCentral[]) {
      assert.deepEqual(Object.keys(erroresDeMovimiento({ ...valido, categoria: c })), ['descripcion'], c);
      assert.deepEqual(erroresDeMovimiento({ ...valido, categoria: c, descripcion: 'X' }), {}, c);
    }
  });
  it('el monto debe ser mayor que cero y con hasta 2 decimales; la fecha, obligatoria', () => {
    const base = { ...valido, categoria: 'otro_ingreso' as const, descripcion: 'X' };
    for (const monto of ['', '0', '0.00', '-5', '12.345', 'abc']) assert.ok(erroresDeMovimiento({ ...base, monto }).monto, monto);
    for (const monto of ['5', '150.5', '150.50']) assert.equal(erroresDeMovimiento({ ...base, monto }).monto, undefined, monto);
    assert.ok(erroresDeMovimiento({ ...base, fecha: '' }).fecha);
  });
});

describe('cómo se muestra cada movimiento y cada aporte', () => {
  const base = { categoria: 'otro_egreso' as const, estacionamiento: null, pagador: null, descripcion: null, proveedor: null };
  it('el alquiler dice qué estacionamiento y quién; lo demás, su detalle y el proveedor', () => {
    assert.equal(tituloMovimiento({ ...base, categoria: 'alquiler_estacionamiento', estacionamiento: 'E-12', pagador: 'Juan Pérez (A-101)' }), 'E-12 · Juan Pérez (A-101)');
    assert.equal(tituloMovimiento({ ...base, categoria: 'alquiler_estacionamiento' }), 'Alquiler de estacionamiento');
    assert.equal(tituloMovimiento({ ...base, categoria: 'proveedor', descripcion: 'Jardinería', proveedor: { id: 1, razon_social: 'Jardines SAC' } }), 'Jardinería · Jardines SAC');
    assert.equal(tituloMovimiento({ ...base, descripcion: 'Papelería' }), 'Papelería');
  });
  it('el detalle dice cobrado (ingreso) o pagado (egreso), el documento, la operación y quién lo registró', () => {
    const m = { tipo: 'egreso' as const, documento: 'F001-9', referencia: 'TRF-1', registrado_por: { id: 2, nombre: 'Rosa' } };
    assert.equal(detalleMovimiento(m, '2 oct. 2026'), 'Pagado el 2 oct. 2026 · Doc. F001-9 · Op. TRF-1 · registrado por Rosa');
    assert.equal(detalleMovimiento({ ...m, tipo: 'ingreso', documento: null, referencia: null, registrado_por: null }, '2 oct. 2026'), 'Cobrado el 2 oct. 2026');
  });
  it('un estado y una insignia para cada situación del servidor', () => {
    assert.deepEqual(Object.keys(ESTADO_CENTRAL).sort(), ['al_dia', 'falta_conformidad', 'faltan_aportes', 'sin_blocks']);
    assert.deepEqual(Object.keys(ESTADO_APORTE).sort(), ['conforme', 'sin_conformidad', 'sin_registrar']);
    assert.equal(ESTADO_CENTRAL.faltan_aportes.tone, 'warn');
    assert.equal(ESTADO_CENTRAL.al_dia.tone, 'ok');
  });
});

describe('menú y rutas', () => {
  const todos = (u: Parameters<typeof navPara>[0]) => navPara(u).flatMap(g => g.items.map(i => i.to));
  const base = { rol: 'propietario', complejo_id: 1 } as const;
  it('«Cierre de la Junta central» es sólo de la Junta central (presidente o tesorero sin block), además de «Aportes de los blocks»', () => {
    for (const cargo of ['tesorero', 'presidente'] as const) {
      const r = todos({ ...base, cargo_junta: cargo, estructura_id: null });
      assert.ok(r.includes('/junta/cierre-central'), cargo);
      assert.ok(r.includes('/junta/aportes'), cargo);
    }
  });
  it('la junta de un block NO lo ve en el menú (sólo su aporte); tampoco un vocal', () => {
    assert.ok(!todos({ ...base, cargo_junta: 'tesorero', estructura_id: 4 }).includes('/junta/cierre-central'));
    assert.ok(!todos({ ...base, cargo_junta: 'presidente', estructura_id: 4 }).includes('/junta/cierre-central'));
    assert.ok(!todos({ ...base, cargo_junta: 'vocal', estructura_id: null }).includes('/junta/cierre-central'));
  });
  it('la administración lo ve como pestaña de «Cierres del mes», no como ítem aparte del menú', () => {
    for (const rol of ['admin', 'superadmin'] as const) assert.ok(!todos({ rol, cargo_junta: null, complejo_id: null }).includes('/junta/cierre-central'), rol);
    const pagina = fuente('src/pages/admin/Cierres.tsx');
    assert.match(pagina, /id: 'junta_central', label: 'Cierre de la Junta central'/);
    assert.match(pagina, /id="junta_central"[\s\S]*<CierreCentral complejoId=\{complejoId\}/);
  });
  it('la ruta está en App.tsx (dentro de RequireJunta) y en la lista de rutas de la junta del asistente', () => {
    assert.match(fuente('src/App.tsx'), /<RequireJunta \/>[\s\S]*path="\/junta\/cierre-central" element=\{<AdminCierresCentral \/>\}/);
    assert.ok((RUTAS_JUNTA as readonly string[]).includes('/junta/cierre-central'));
  });
});

describe('estructura de las pantallas', () => {
  const modal = fuente('src/pages/admin/_parts/cierres/RegistrarMovimientoModal.tsx');
  const cierre = fuente('src/pages/admin/_parts/cierres/CierreCentral.tsx');
  const pagina = fuente('src/pages/admin/CierresCentral.tsx');
  it('registrar: el voucher es obligatorio (no se envía sin archivo) y todo va en UN envío multipart; la administración manda el condominio', () => {
    assert.match(modal, /disabled=\{!archivo \|\| enviando\}/);
    assert.match(modal, /type="file"[\s\S]*required/);
    assert.match(modal, /registrarPagoConVoucher\(`\/api\/cierres\/central\/movimientos\$\{complejoId \? `\?complejo_id=\$\{complejoId\}` : ''\}`/);
    assert.match(modal, /capture="environment"/, 'cámara en el celular');
  });
  it('registrar y quitar sólo se ofrecen si el servidor dice que puede (puede.registrar); el cliente no mira cargos', () => {
    assert.match(cierre, /c\.puede\.registrar && <Bloqueable>\{b => <Button/);
    assert.match(cierre, /puede=\{c\.puede\.registrar\}/);
    assert.doesNotMatch(cierre, /cargo_junta|useAuth/);
    assert.doesNotMatch(modal, /cargo_junta|useAuth/);
  });
  it('se ven los «Blocks que aún no aportan», el saldo del mes, el Fondo de ahorros y el de contingencia aparte', () => {
    assert.match(cierre, /Blocks que aún no aportan/);
    assert.match(cierre, /Saldo del mes/);
    assert.match(cierre, /Fondo de ahorros de la Junta central/);
    assert.match(cierre, /Fondo de contingencia del condominio/);
  });
  it('quitar pide confirmación; el voucher se abre con la sesión (no por enlace directo)', () => {
    assert.match(cierre, /<ConfirmDialog[\s\S]*danger/);
    assert.match(cierre, /abrirVoucher\(id, origen\)/);
    assert.match(fuente('src/pages/admin/_parts/cierres/voucher.ts'), /\/api\/cierres\/central\/movimientos\/\$\{id\}\/voucher/);
  });
  it('celular de 375 px: tarjetas (sin tablas), textos que cortan y botones que envuelven; los colores salen de los tokens (sirve en modo oscuro)', () => {
    for (const f of [cierre, modal]) {
      assert.doesNotMatch(f, /<table/);
      assert.doesNotMatch(f, /#[0-9a-fA-F]{3,6}\b|bg-white|text-black/, 'sin colores fijos');
    }
    assert.match(cierre, /break-words/);
    assert.match(cierre, /flex flex-wrap gap-2/);
    assert.match(cierre, /grid grid-cols-1 gap-3 sm:grid-cols-3/);
  });
  it('la página de la Junta central usa el selector de mes y no el de condominio (usa el suyo)', () => {
    assert.match(pagina, /<PeriodoSelect/);
    assert.match(pagina, /<CierreCentral complejoId=\{null\}/);
    assert.match(pagina, /title="Cierre de la Junta central"/);
  });
});
