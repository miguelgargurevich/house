// Multimoneda en el frontend: `dinero(monto, moneda)` (símbolo, decimales y separadores de cada moneda), las sumas por moneda que nunca mezclan monedas,
// el render real del recibo imprimible, del consumo de agua y del selector de país/moneda (react-dom/server), y la fuente de las pantallas clave:
// lo del condominio va con `dinero()` y su moneda; `soles()` queda sólo para lo de House (suscripción, Mi plan, /precios).
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { before, describe, it } from 'node:test';
import { alertaAgua } from '../src/server/lib/agua';
import { avisoAgua } from '../src/pages/admin/_parts/agua/calculo';
import { cifras, cifrasPorMoneda, type ResumenHistorial } from '../src/pages/residente/_parts/historial';
import { dinero, dineroCorto, dinerosPorMoneda, soles, sumaPorMoneda } from '../src/ui/format';
import { monto2 } from '../src/pages/shared/mantenimiento/formato';
import type { AguaMantenimiento, DetalleMantenimiento } from '../src/pages/shared/mantenimiento/tipos';

const NBSP = ' ';
const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

let ReciboArticulo: typeof import('../src/pages/shared/mantenimiento/ReciboImprimible').ReciboArticulo;
let ConsumoAgua: typeof import('../src/pages/shared/mantenimiento/ConsumoAgua').ConsumoAgua;
let ProgresoCobro: typeof import('../src/pages/admin/_parts/cobranza/ProgresoCobro').ProgresoCobro;
let SelectorPaisMoneda: typeof import('../src/pages/admin/_parts/condominio/SelectorPaisMoneda').SelectorPaisMoneda;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ ReciboArticulo } = await import('../src/pages/shared/mantenimiento/ReciboImprimible'));
  ({ ConsumoAgua } = await import('../src/pages/shared/mantenimiento/ConsumoAgua'));
  ({ ProgresoCobro } = await import('../src/pages/admin/_parts/cobranza/ProgresoCobro'));
  ({ SelectorPaisMoneda } = await import('../src/pages/admin/_parts/condominio/SelectorPaisMoneda'));
});

describe('dinero(): el símbolo, los decimales y los separadores de cada moneda', () => {
  it('soles: idéntico a soles() de siempre (S/ 272.15, espacio duro)', () => {
    for (const v of [0, 20, 272.15, 1272.15, 1234567.89, -5.5, '150.5', null, undefined, Number.NaN, 'abc']) assert.equal(dinero(v, 'PEN'), soles(v as number), String(v));
    assert.equal(dinero(272.15, 'PEN'), `S/${NBSP}272.15`);
    assert.equal(dinero('272.15'), `S/${NBSP}272.15`, 'sin moneda, soles');
    assert.equal(dinero(272.15, null), `S/${NBSP}272.15`);
  });

  it('dólares, pesos chilenos (sin decimales), euros (símbolo después) y otras', () => {
    assert.equal(dinero(20, 'USD'), `US$${NBSP}20.00`);
    assert.equal(dinero('1500.5', 'USD'), `US$${NBSP}1,500.50`);
    assert.equal(dinero(1234567, 'CLP'), `$${NBSP}1.234.567`);
    assert.equal(dinero('15000.6', 'CLP'), `$${NBSP}15.001`);
    assert.equal(dinero(1234.5, 'EUR'), `1.234,50${NBSP}€`);
    assert.equal(dinero(2500000, 'PYG'), `₲${NBSP}2.500.000`);
    assert.equal(dinero(99.9, 'MXN'), `$${NBSP}99.90`);
  });

  it('el eje de los gráficos: enteros sin decimales, con centavos completo', () => {
    assert.equal(dineroCorto(1200, 'PEN'), 'S/ 1,200');
    assert.equal(dineroCorto(1200.5, 'PEN'), `S/${NBSP}1,200.50`);
    assert.equal(dineroCorto(1200, 'USD'), 'US$ 1,200');
  });

  it('coincide con monto2 sin símbolo: los decimales son los de la moneda', () => {
    assert.equal(monto2('272.15'), '272.15');
    assert.equal(monto2('272.15', 'PEN'), '272.15');
    assert.equal(monto2('15000', 'CLP'), '15000');
    assert.equal(monto2(null, 'CLP'), '0');
    assert.equal(monto2(undefined), '0.00');
  });
});

describe('sumas por moneda: nunca se suman monedas distintas', () => {
  const filas = [{ monto: '100', moneda: 'PEN' }, { monto: 40, moneda: 'USD' }, { monto: '50.5', moneda: 'PEN' }, { monto: null, moneda: 'USD' }, { monto: 7 }];

  it('una suma por moneda, en orden de aparición; sin moneda cuenta como soles', () => {
    assert.deepEqual(sumaPorMoneda(filas), [{ moneda: 'PEN', total: 157.5 }, { moneda: 'USD', total: 40 }]);
  });

  it('el texto trae cada moneda con lo suyo', () => {
    assert.equal(dinerosPorMoneda(filas), `S/${NBSP}157.50 · US$${NBSP}40.00`);
    assert.equal(dinerosPorMoneda([{ monto: 10, moneda: 'USD' }]), `US$${NBSP}10.00`);
    assert.equal(dinerosPorMoneda([]), `S/${NBSP}0.00`);
  });
});

const resumen = (extra: Partial<ResumenHistorial> = {}): ResumenHistorial => ({
  pagado: '340.00', promedio_mes: '85.00', deuda_actual: '235.00', en_revision: '0.00', meses_a_tiempo: 3, meses_evaluados: 4, meses_en_periodo: 4, agua_promedio_m3: null, ...extra,
});

describe('«Mi historial»: las cifras en la moneda de las unidades', () => {
  it('una moneda: cada cifra en la suya; sin moneda, soles como siempre', () => {
    const usd = cifras(resumen(), null, 'USD');
    assert.equal(usd[0]!.value, `US$${NBSP}340.00`);
    assert.equal(usd[2]!.value, `US$${NBSP}235.00`);
    assert.equal(cifras(resumen(), null)[0]!.value, `S/${NBSP}340.00`);
  });

  it('con dos monedas las cifras de dinero van una vez por moneda, rotuladas, y la puntualidad una sola vez', () => {
    const r = resumen({
      pagado: null, promedio_mes: null, deuda_actual: null, en_revision: null,
      por_moneda: { PEN: { pagado: '100.00', promedio_mes: '50.00', deuda_actual: '10.00', en_revision: '0.00' }, USD: { pagado: '20.00', promedio_mes: '20.00', deuda_actual: '5.00', en_revision: '0.00' } },
    });
    const s = cifrasPorMoneda(r, null);
    assert.deepEqual(s.map(x => x.label), ['Pagado (PEN)', 'Promedio por mes (PEN)', 'Deuda de hoy (PEN)', 'Pagado (USD)', 'Promedio por mes (USD)', 'Deuda de hoy (USD)', 'Puntualidad']);
    assert.equal(s[0]!.value, `S/${NBSP}100.00`);
    assert.equal(s[3]!.value, `US$${NBSP}20.00`);
  });
});

const detalle = (moneda: string, agua?: Partial<AguaMantenimiento>): DetalleMantenimiento => ({
  recibo_id: 2, unidad_id: 1, numero: '2026-10-B01-804', titulo: 'Mantenimiento de octubre de 2026 · B01-804', mes: 10, anio: 2026, moneda,
  fecha_emision: '2026-10-27T00:00:00.000Z', fecha_vencimiento: '2026-11-02T00:00:00.000Z', fecha_corte_agua: null, estado: 'pendiente',
  total: '272.15', cobrado: '0.00', en_revision: '0.00', saldo: '272.15', deuda_acumulada: '0.00', total_general: '272.15',
  agua: { fecha_anterior: '2026-09-10T00:00:00.000Z', lectura_anterior: '1416.574', fecha_actual: '2026-10-10T00:00:00.000Z', lectura_actual: '1430.897', factor: '4.9300', consumo_m3: '14.323', monto: '70.61', tiene_foto: false, foto_url: null, ...agua },
  correo_vouchers: null, linea_mora: null,
  condominio: { id: 1, nombre: 'CONDOMINIO PRUEBA', moneda, direccion: null, notas_pago: null, admin_nombre: null, admin_celular: null, admin_correo: null, cabecera_url: null },
  empresa: null, unidad: { id: 1, codigo: 'B01-804', estructura: null }, propietario: { id: 1, nombre: 'PROPIETARIO DE PRUEBA' }, inquilino: null,
  conceptos: [{ cargo_id: 1, concepto: 'MANTENIMIENTO', es_recargo: false, monto: '201.54', cobrado: '0.00', en_revision: '0.00', saldo: '201.54', motivo: null }, { cargo_id: 2, concepto: 'AGUA DPTO.', es_recargo: false, monto: '70.61', cobrado: '0.00', en_revision: '0.00', saldo: '70.61', motivo: null }],
  pagos: [], medios_pago: [],
});
const texto = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toUpperCase();

describe('recibo imprimible y consumo de agua con la moneda del condominio', () => {
  it('en soles: «MONTO S/» y «CONSUMO S/», como siempre', () => {
    const t = texto(renderToStaticMarkup(createElement(ReciboArticulo, { d: detalle('PEN') })));
    assert.ok(t.includes('MONTO S/') && t.includes('CONSUMO S/'), t);
    assert.ok(t.includes('272.15') && t.includes('70.61'));
  });

  it('en dólares: «MONTO US$» y «CONSUMO US$»; en pesos chilenos los montos van sin decimales', () => {
    const usd = texto(renderToStaticMarkup(createElement(ReciboArticulo, { d: detalle('USD') })));
    assert.ok(usd.includes('MONTO US$') && usd.includes('CONSUMO US$'), usd);
    assert.ok(!usd.includes('MONTO S/'));
    const clp = texto(renderToStaticMarkup(createElement(ReciboArticulo, { d: detalle('CLP', { monto: '70610' }) })));
    assert.ok(clp.includes('MONTO $') && clp.includes('70610') && !clp.includes('70610.00'), clp);
    assert.ok(clp.includes('272') && !clp.includes('272.15'), 'el total también va sin decimales');
  });

  it('el detalle del agua nombra la moneda: factor «US$ 4.93 por m³» y «Consumo en dólares»', () => {
    const h = renderToStaticMarkup(createElement(ConsumoAgua, { agua: detalle('USD').agua!, codigo: 'B01-804', moneda: 'USD' }));
    assert.match(h, /US\$ 4\.93 por m³/);
    assert.match(h, /Consumo en dólares/);
    assert.match(h, new RegExp(`US\\$${NBSP}70\\.61`));
    const pen = renderToStaticMarkup(createElement(ConsumoAgua, { agua: detalle('PEN').agua!, codigo: 'B01-804' }));
    assert.match(pen, /S\/ 4\.93 por m³/);
    assert.match(pen, /Consumo en soles/);
  });

  it('la barra de avance de cobranza dice el monto en la moneda del recibo', () => {
    assert.match(renderToStaticMarkup(createElement(ProgresoCobro, { cobrado: '50', total: '100', moneda: 'USD' })), new RegExp(`50 % · US\\$${NBSP}50\\.00 de US\\$${NBSP}100\\.00`));
    assert.match(renderToStaticMarkup(createElement(ProgresoCobro, { cobrado: '50', total: '100' })), new RegExp(`S/${NBSP}50\\.00 de S/${NBSP}100\\.00`));
  });

  it('la vista previa del aviso del agua dice lo mismo que el servidor, en cada moneda', () => {
    for (const moneda of [undefined, 'PEN', 'USD', 'CLP']) {
      assert.equal(avisoAgua('80.00', '70.00', moneda), alertaAgua('80.00', '70.00', moneda), String(moneda));
    }
    assert.equal(avisoAgua('70.60', '70.58', 'USD'), null);
  });
});

describe('selector de país y moneda del condominio', () => {
  it('lista los países con su bandera y las monedas con su símbolo y código; al crear ofrece «el de tu empresa»', () => {
    const h = renderToStaticMarkup(createElement(SelectorPaisMoneda, { valor: { pais: 'CL', moneda: 'CLP' }, onCambio: () => undefined }));
    assert.match(h, /🇨🇱 Chile/);
    assert.match(h, /🇵🇪 Perú/);
    assert.match(h, /S\/ · Sol peruano \(PEN\)/);
    assert.match(h, /<option value="CLP" selected="">/);
    assert.match(h, /<option value="CL" selected="">/);
    assert.doesNotMatch(h, /El de tu empresa/);
    const nuevo = renderToStaticMarkup(createElement(SelectorPaisMoneda, { valor: { pais: '', moneda: '' }, onCambio: () => undefined, alCrear: true }));
    assert.match(nuevo, /El de tu empresa/);
    assert.match(nuevo, /La de su país/);
  });
});

describe('fuente de las pantallas: lo del condominio con dinero(), lo de House con soles()', () => {
  const DEL_CONDOMINIO = [
    'src/pages/admin/Dashboard.tsx', 'src/pages/admin/Morosidad.tsx', 'src/pages/admin/Pagos.tsx', 'src/pages/admin/PeriodoRecibo.tsx', 'src/pages/admin/CondominioDetalle.tsx',
    'src/pages/admin/_parts/agua/AguaRecibo.tsx', 'src/pages/admin/_parts/cobranza/EmitirReciboModal.tsx', 'src/pages/admin/_parts/cobranza/ProgresoCobro.tsx',
    'src/pages/admin/_parts/cobranza/RegistrarPagoModal.tsx', 'src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx', 'src/pages/admin/_parts/mantenimientos/BloquesPeriodo.tsx',
    'src/pages/admin/_parts/mantenimientos/FormPagoMantenimiento.tsx', 'src/pages/admin/_parts/mantenimientos/MantenimientoAdminModal.tsx', 'src/pages/admin/_parts/mantenimientos/MantenimientosLista.tsx',
    'src/pages/residente/_parts/CargosResidente.tsx', 'src/pages/residente/_parts/DetalleMantenimientoModal.tsx', 'src/pages/residente/_parts/HistorialGraficos.tsx',
    'src/pages/residente/_parts/InicioResidente.tsx', 'src/pages/residente/_parts/MantenimientoItem.tsx', 'src/pages/residente/_parts/PagarPanel.tsx', 'src/pages/residente/_parts/PagosResidente.tsx',
    'src/pages/residente/_parts/historial.ts', 'src/pages/shared/evaluacion.tsx', 'src/pages/shared/mantenimiento/ConsumoAgua.tsx', 'src/pages/shared/mantenimiento/Desglose.tsx',
    'src/pages/superadmin/Dashboard.tsx',
  ];
  const DE_HOUSE = ['src/pages/admin/MiPlan.tsx', 'src/pages/admin/_parts/plan/ComoPagar.tsx', 'src/pages/admin/_parts/plan/HistorialPagos.tsx', 'src/pages/publico/precios/Planes.tsx', 'src/pages/superadmin/Suscripciones.tsx'];

  it('ninguna pantalla del condominio llama a soles() ni a un «S/» fijo', () => {
    for (const f of DEL_CONDOMINIO) {
      const s = fuente(f);
      assert.ok(!/\bsoles\(/.test(s), `${f} todavía usa soles()`);
      assert.ok(!/[`'"]S\/ ?\$?\{?/.test(s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), `${f} tiene un «S/» fijo`);
    }
  });

  it('las pantallas del condominio sí usan dinero() con la moneda de la respuesta', () => {
    for (const f of DEL_CONDOMINIO.filter(x => !/ConsumoAgua|HistorialGraficos|historial\.ts|evaluacion/.test(x) || /dinero/.test(fuente(x)))) {
      assert.match(fuente(f), /\bdinero(Corto)?\(|dinerosPorMoneda\(/, `${f} no usa dinero()`);
    }
    assert.match(fuente('src/pages/admin/Dashboard.tsx'), /Object\.entries\(data\.por_moneda \?\? \{\}\)/, 'el panel separa por moneda');
    assert.match(fuente('src/pages/admin/Dashboard.tsx'), /bloques\.map\(\(\[moneda, b\]\) => \(\s*<Card key=\{moneda\}>/, 'un gráfico por moneda');
    assert.match(fuente('src/pages/superadmin/Dashboard.tsx'), /Object\.entries\(data\.por_moneda \?\? \{\}\)/, 'el panel de la plataforma separa por moneda');
    assert.match(fuente('src/pages/admin/Morosidad.tsx'), /Object\.entries\(cifras\.data\.resumen\.por_moneda \?\? \{\}\)/, 'morosidad separa por moneda');
    assert.match(fuente('src/pages/admin/Pagos.tsx'), /dinerosPorMoneda\(montosPagina\)/, 'la suma de la página va por moneda');
    assert.doesNotMatch(fuente('src/pages/admin/Pagos.tsx'), /reduce\(\(s, p\) => s \+/, 'Pagos ya no suma la página sin mirar la moneda');
  });

  it('lo de House (suscripción, Mi plan, /precios) sigue en soles', () => {
    for (const f of DE_HOUSE) assert.match(fuente(f), /\bsoles\b/, `${f} debería seguir con soles()`);
    assert.match(fuente('src/ui/format.ts'), /export function soles\(/);
  });

  it('la configuración elige país y moneda: ModalDeComplejo (por condominio) y Mi empresa (país por defecto)', () => {
    const m = fuente('src/pages/admin/_parts/condominio/ModalDeComplejo.tsx');
    assert.match(m, /SelectorPaisMoneda/);
    assert.match(m, /body\.pais = /);
    assert.match(m, /body\.moneda = /);
    const c = fuente('src/pages/admin/Configuracion.tsx');
    assert.match(c, /<PaisEmpresa /);
    assert.match(fuente('src/pages/admin/_parts/condominio/PaisEmpresa.tsx'), /json: \{ pais: valor \}/);
  });
});

describe('ficha del condominio: el símbolo de la mora nunca queda vacío', () => {
  it('sin moneda elegida («La de su país») muestra la del país, y simboloDe(\'\') es soles', async () => {
    const { simboloDe } = await import('../src/lib/paises');
    assert.equal(simboloDe(''), 'S/');
    assert.match(readFileSync('src/pages/admin/_parts/condominio/ModalDeComplejo.tsx', 'utf8'), /simboloDe\(paisMoneda\.moneda \|\| monedaDelPais\(paisMoneda\.pais\)\)/);
  });
});
