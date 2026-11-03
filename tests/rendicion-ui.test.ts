// Pantalla «Rendición del mes»: lo que se dice y cómo se arma cada consulta se prueba de verdad en el módulo puro (`_parts/rendicion/vista.ts`);
// la estructura (rutas, menú, aviso de módulo, impresión) se fija con la fuente (el repo no tiene testing-library: no pinta).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { navPara } from '../src/app/nav';
import {
  consultaRendicion, estadoLineaEgreso, ofreceBlocks, textoDiferencia, textoPct, tituloRendicion, tonoPct, tonoSaldo, urlRendicion, urlRendicionExcel,
} from '../src/pages/admin/_parts/rendicion/vista';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const base = { rol: 'admin' as const, cargo_junta: null, complejo_id: null, junta_unica: false };
const rutas = (u: Parameters<typeof navPara>[0]) => navPara(u).flatMap(g => g.items.map(i => i.to));

describe('la consulta', () => {
  it('la administración manda el condominio; el block sólo si lo eligió', () => {
    assert.equal(consultaRendicion({ complejoId: 7, estructuraId: null, mes: 10, anio: 2026 }), 'mes=10&anio=2026&complejo_id=7');
    assert.equal(consultaRendicion({ complejoId: 7, estructuraId: 3, mes: 10, anio: 2026 }), 'mes=10&anio=2026&complejo_id=7&estructura_id=3');
  });
  it('la junta no manda condominio (el servidor usa el suyo)', () => {
    assert.equal(consultaRendicion({ complejoId: null, estructuraId: null, mes: 9, anio: 2026 }), 'mes=9&anio=2026');
  });
  it('la pantalla y el Excel piden lo mismo', () => {
    const p = { complejoId: 7, estructuraId: 3, mes: 10, anio: 2026 };
    assert.equal(urlRendicion(p), '/api/reportes/rendicion?mes=10&anio=2026&complejo_id=7&estructura_id=3');
    assert.equal(urlRendicionExcel(p), '/api/reportes/rendicion.xlsx?mes=10&anio=2026&complejo_id=7&estructura_id=3');
  });
});

describe('lo que se dice', () => {
  it('el título nombra el mes y el alcance', () => {
    assert.equal(tituloRendicion({ periodo: { mes: 10, anio: 2026, desde: '2026-10-01', hasta: '2026-10-31' }, estructura: { id: 1, nombre: 'Block 1' } }), 'Octubre de 2026 · Block 1');
    assert.equal(tituloRendicion({ periodo: { mes: 1, anio: 2027, desde: '2027-01-01', hasta: '2027-01-31' }, estructura: null }), 'Enero de 2027 · Condominio completo');
  });
  it('cada línea de egreso dice si falta pagarla, o su conformidad', () => {
    assert.deepEqual(estadoLineaEgreso({ estado: 'por_pagar', conformidad: 'por_pagar' }), { tone: 'warn', label: 'Por pagar' });
    assert.deepEqual(estadoLineaEgreso({ estado: 'pagada', conformidad: 'no_aplica' }), { tone: 'ok', label: 'Pagado' });
    assert.deepEqual(estadoLineaEgreso({ estado: 'pagada', conformidad: 'sin_conformidad' }), { tone: 'warn', label: 'Sin conformidad' });
    assert.deepEqual(estadoLineaEgreso({ estado: 'pagada', conformidad: 'conforme' }), { tone: 'ok', label: 'Con conformidad' });
  });
  it('la comparación con el banco dice cuánto sobra o falta', () => {
    const s = (v: string) => `S/ ${v}`;
    assert.deepEqual(textoDiferencia({ diferencia: '0.00', cuadra: true }, s), { tone: 'ok', label: 'Cuadra con el banco' });
    assert.match(textoDiferencia({ diferencia: '5.00', cuadra: false }, s).label, /tiene S\/ 5\.00 más que el banco/);
    assert.match(textoDiferencia({ diferencia: '-12.50', cuadra: false }, s).label, /tiene S\/ 12\.5 menos que el banco/);
  });
  it('el % cobrado: sin emitido es «—»; bajo 70 es malo, hasta 90 se vigila', () => {
    assert.equal(textoPct(null), '—');
    assert.equal(textoPct(54.5), '54.5 %');
    assert.deepEqual([tonoPct(null), tonoPct(95), tonoPct(80), tonoPct(54.5)], [undefined, 'ok', 'warn', 'bad']);
  });
  it('un saldo negativo va en rojo', () => {
    assert.equal(tonoSaldo('-30.00'), 'bad');
    assert.equal(tonoSaldo('0.00'), undefined);
    assert.equal(tonoSaldo('305.00'), undefined);
  });
  it('el selector de block sólo si hay blocks y no es el block fijo de una junta', () => {
    assert.equal(ofreceBlocks(3, false), true);
    assert.equal(ofreceBlocks(0, false), false);
    assert.equal(ofreceBlocks(3, true), false);
  });
});

describe('menú y rutas', () => {
  it('«Rendición del mes» en Cobranza, junto a «Cierres del mes», para admin y superadmin', () => {
    for (const rol of ['admin', 'superadmin'] as const) {
      const cobranza = navPara({ ...base, rol }).find(g => g.label === 'Cobranza')!;
      const orden = cobranza.items.map(i => i.to);
      assert.ok(orden.includes('/admin/rendicion'), rol);
      assert.equal(orden.indexOf('/admin/rendicion'), orden.indexOf('/admin/cierres') + 1, 'justo después de los cierres');
      assert.equal(cobranza.items.find(i => i.to === '/admin/rendicion')!.label, 'Rendición del mes');
    }
  });
  it('la junta (presidente o tesorero) la ve en su grupo; el propietario común, el inquilino y el personal no', () => {
    assert.ok(rutas({ ...base, rol: 'propietario', cargo_junta: 'presidente', complejo_id: 1 }).includes('/junta/rendicion'));
    assert.ok(rutas({ ...base, rol: 'propietario', cargo_junta: 'tesorero', complejo_id: 1 }).includes('/junta/rendicion'));
    for (const rol of ['propietario', 'inquilino', 'mantenimiento', 'seguridad', 'limpieza', 'jardineria'] as const) {
      assert.ok(!rutas({ ...base, rol }).some(r => r.endsWith('/rendicion')), rol);
    }
  });
  it('las rutas existen: /admin/rendicion para la administración y /junta/rendicion para la junta', () => {
    const app = fuente('src/App.tsx');
    assert.match(app, /lazy\(\(\) => import\('\.\/pages\/admin\/Rendicion'\)\)/);
    assert.match(app, /path="\/admin\/rendicion" element=\{<AdminRendicion \/>\}/);
    assert.match(app, /path="\/junta\/rendicion" element=\{<AdminRendicion \/>\}/);
    const i = app.indexOf('path="/admin/rendicion"');
    assert.ok(app.lastIndexOf('<RequireRole roles={[\'superadmin\',\'admin\']} />', i) > app.lastIndexOf('<RequireJunta />', i), 'la ruta de admin va bajo RequireRole admin/superadmin');
    assert.ok(app.indexOf('<RequireJunta />') < app.indexOf('path="/junta/rendicion"'), 'la de la junta va bajo RequireJunta');
  });
});

describe('la pantalla', () => {
  const pantalla = fuente('src/pages/admin/Rendicion.tsx');
  it('sin el módulo `reportes` muestra el aviso con el plan, no un error', () => {
    assert.match(pantalla, /errorCode === 'MODULO_NO_ACTIVO'/);
    assert.match(pantalla, /<AvisoModulo modulo="reportes" \/>/);
  });
  it('descarga el Excel del servidor e imprime con la zona imprimible de siempre', () => {
    assert.match(pantalla, /window\.location\.assign\(urlRendicionExcel\(params\)\)/);
    assert.match(pantalla, /useImprimir\(\)/);
    assert.match(pantalla, /<ZonaImprimible><HojaImprimible r=\{data\} \/><\/ZonaImprimible>/);
    assert.match(pantalla, /Descargar Excel/);
    assert.match(pantalla, /Imprimir \/ PDF/);
  });
  it('la junta de un block no elige block; los filtros no salen al imprimir', () => {
    assert.match(pantalla, /bloqueFijo = !esAdmin && esJunta\(user\) && user\?\.estructura_id != null/);
    assert.match(pantalla, /print:hidden/);
  });
  it('estados de carga, vacío y error; y el dinero siempre con su moneda', () => {
    assert.match(pantalla, /<Skeleton/);
    assert.match(pantalla, /<ErrorState/);
    const secciones = fuente('src/pages/admin/_parts/rendicion/Secciones.tsx');
    assert.match(secciones, /dinero\(/);
    assert.ok(!/toFixed\(|soles\(/.test(secciones), 'nada de formatear el dinero a mano ni en soles fijos');
  });
  it('sigue el sistema de diseño: sin colores a mano ni `dark:` suelto', () => {
    for (const f of ['Rendicion.tsx', '_parts/rendicion/Secciones.tsx']) {
      const s = fuente(`src/pages/admin/${f}`);
      assert.ok(!/\bdark:|\b(gray|slate|blue|red|green)-\d{2,3}\b|#[0-9a-fA-F]{6}\b/.test(s), f);
    }
  });
});
