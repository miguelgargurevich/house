// Estado de cuenta en pantalla e impreso: se renderiza la hoja de verdad (react-dom/server) y se mira el HTML; el cableado (Unidades, Morosidad,
// Mi historial), la hoja blanca fija (oscuro), el A4 y el celular de 390 px se fijan con la fuente, como el resto de la UI.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { before, describe, it } from 'node:test';
import { consultaDeRango, type EstadoCuenta } from '../src/pages/shared/estado-cuenta/tipos';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
let EstadoCuentaHoja: typeof import('../src/pages/shared/estado-cuenta/EstadoCuentaHoja').EstadoCuentaHoja;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ EstadoCuentaHoja } = await import('../src/pages/shared/estado-cuenta/EstadoCuentaHoja'));
});

const fila = (mes: number, extra: Record<string, unknown> = {}) => ({
  recibo_id: mes, anio: 2025, mes, periodo: `2025-${String(mes).padStart(2, '0')}`, fecha_vencimiento: `2025-${String(mes).padStart(2, '0')}-20`, estado: 'pagado',
  cargo: '150.00', por_concepto: [{ concepto: 'Mantenimiento', monto: '100.00', es_mora: false }, { concepto: 'Agua', monto: '50.00', es_mora: false }], mora: '0.00',
  pagado: '150.00', en_revision: '0.00', saldo: '0.00', saldo_acumulado: '0.00',
  pagos: [{ id: mes, fecha: `2025-${String(mes).padStart(2, '0')}-18`, operacion: 'OP-123', metodo: 'yape', monto: '150.00', estado: 'validado', sin_detalle: false }], ...extra,
});

const datos = (extra: Partial<EstadoCuenta> = {}): EstadoCuenta => ({
  unidad: { id: 1, codigo: 'E-1', tipo: 'Departamento' }, estructura: { id: 1, nombre: 'Block 1' }, condominio: { id: 1, nombre: 'Condominio Prueba' }, administradora: 'Empresa A',
  propietario: 'Elena Dueña', inquilino: 'Iván Inquilino', moneda: 'PEN', zona_horaria: 'America/Lima', fecha_corte: '2026-11-03', desde: '2025-01', hasta: '2025-03',
  totales: { cargado: '470.00', mora: '20.00', pagado: '150.00', en_revision: '170.00', saldo_anterior: '40.00', saldo_deudor: '190.00', meses_vencidos: 1, deuda_vencida: '150.00', pagos_rechazados: 1 },
  filas: [
    fila(1, { saldo_acumulado: '40.00' }),
    fila(2, { estado: 'en_revision', cargo: '170.00', mora: '20.00', pagado: '0.00', en_revision: '170.00', saldo: '0.00', saldo_acumulado: '40.00', por_concepto: [{ concepto: 'Mantenimiento', monto: '150.00', es_mora: false }, { concepto: 'Multa por pago fuera de fecha', monto: '20.00', es_mora: true }], pagos: [{ id: 2, fecha: '2025-02-15', operacion: 'OP-777', metodo: null, monto: '170.00', estado: 'por_validar', sin_detalle: false }] }),
    fila(3, { estado: 'vencido', pagado: '0.00', saldo: '150.00', saldo_acumulado: '190.00', pagos: [{ id: 3, fecha: '2025-03-10', operacion: null, metodo: null, monto: '150.00', estado: 'rechazado', sin_detalle: false }] }),
  ] as EstadoCuenta['filas'],
  ...extra,
});

const html = (e: EstadoCuenta) => renderToStaticMarkup(createElement(EstadoCuentaHoja, { e }));
const texto = (e: EstadoCuenta) => html(e).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('la hoja del estado de cuenta', () => {
  it('cabecera: condominio, administradora, dueño e inquilino por nombre, block, departamento y fecha de corte', () => {
    const t = texto(datos());
    for (const x of ['Condominio Prueba', 'Administra: Empresa A', 'Estado de cuenta', 'Elena Dueña', 'Iván Inquilino', 'Block 1', 'E-1', '03/11/2026']) assert.ok(t.includes(x), x);
    assert.ok(t.includes('Ene 2025 a Mar 2025'));
  });

  it('una fila por mes con cargo, pagado, saldo y el saldo ACUMULADO; el saldo anterior abre la tabla', () => {
    const h = html(datos());
    assert.equal((h.match(/<tbody/g) ?? []).length, 4, 'saldo anterior + 3 meses');
    const t = texto(datos());
    assert.ok(t.includes('Saldo anterior') && t.includes('40.00'));
    for (const acumulado of ['40.00', '190.00']) assert.ok(t.includes(acumulado), acumulado);
    const acumulados = [...h.matchAll(/<td[^>]*font-bold[^>]*>([\d.]+)<\/td>/g)].map(x => x[1]);
    assert.deepEqual(acumulados, ['40.00', '40.00', '40.00', '190.00'], 'saldo anterior y la columna «Acumulado» de cada mes (no el saldo del mes): la última fila es el saldo deudor');
    assert.match(h, /<tfoot>/);
  });

  it('pagos: fecha, n.º de operación, monto y estado; el rechazado dice que no suma y el por validar, que aún no resta', () => {
    const t = texto(datos());
    assert.ok(t.includes('18/01/2025') && t.includes('Op. OP-123') && t.includes('Validado'));
    assert.ok(t.includes('Por validar') && t.includes('OP-777'));
    assert.ok(t.includes('Rechazado (no suma)'));
    assert.ok(t.includes('(aún no resta)'));
    assert.ok(t.includes('Los pagos rechazados se muestran pero no se cuentan'));
  });

  it('la mora sale marcada dentro del detalle del mes y en las notas', () => {
    const t = texto(datos());
    assert.ok(t.includes('Multa por pago fuera de fecha (mora) 20.00'));
    assert.ok(t.includes('ya está incluida en el cargo'));
  });

  it('sin recibos ni saldo anterior: un aviso, no una tabla vacía; sin inquilino no hay renglón de inquilino', () => {
    const e = datos({ filas: [], desde: null, hasta: null, inquilino: null, totales: { ...datos().totales, saldo_anterior: '0.00', pagos_rechazados: 0 } });
    assert.ok(texto(e).includes('no tiene recibos en el periodo'));
    assert.doesNotMatch(html(e), /<table/);
    assert.ok(!texto(e).includes('Inquilino (a)'));
  });

  it('un pago registrado sin voucher se rotula, sin inventar operación', () => {
    const e = datos();
    (e.filas[0] as { pagos: unknown[] }).pagos = [{ id: null, fecha: null, operacion: null, metodo: null, monto: '150.00', estado: 'validado', sin_detalle: true }];
    const t = texto(e);
    assert.ok(t.includes('Registrado sin voucher') && t.includes('Sin fecha'));
  });
});

describe('rangos', () => {
  it('cada opción del selector es un rango que acepta el servidor (AAAA-MM)', () => {
    assert.equal(consultaDeRango('ultimos', 2026), '');
    assert.equal(consultaDeRango('anio', 2026), '?desde=2026-01&hasta=2026-12');
    assert.equal(consultaDeRango('anio_pasado', 2026), '?desde=2025-01&hasta=2025-12');
    assert.equal(consultaDeRango('todo', 2026), '?desde=2000-01');
  });
});

describe('cableado y diseño', () => {
  it('la hoja es BLANCA con tinta oscura fija (también en modo oscuro) y se imprime en A4 con la zona imprimible', () => {
    assert.match(fuente('src/pages/shared/estado-cuenta/EstadoCuentaHoja.tsx'), /bg-white p-3 text-\[11px\] leading-snug text-neutral-900/);
    const m = fuente('src/pages/shared/estado-cuenta/EstadoCuentaModal.tsx');
    assert.match(m, /<ZonaImprimible><EstadoCuentaHoja e=\{data\} \/><\/ZonaImprimible>/);
    assert.match(m, /window\.print\(\)/);
    assert.match(m, /\/estado-cuenta\.xlsx\$\{consulta\}/, 'el Excel baja con el mismo rango que se ve');
  });

  it('390 px: tabla de 5 columnas de ancho fijo (sin desborde horizontal), textos largos que bajan de línea y selectores a todo el ancho', () => {
    const h = fuente('src/pages/shared/estado-cuenta/EstadoCuentaHoja.tsx');
    assert.match(h, /w-full table-fixed border-collapse/);
    assert.match(h, /<colgroup>/);
    assert.doesNotMatch(h, /min-w-\[/, 'ningún ancho mínimo que fuerce scroll horizontal');
    assert.match(h, /break-words/);
    assert.match(h, /grid-cols-2 gap-1\.5 sm:grid-cols-4/);
    assert.match(fuente('src/pages/shared/estado-cuenta/EstadoCuentaModal.tsx'), /className="w-full sm:w-56"/);
  });

  it('el botón «Estado de cuenta» está en Unidades, Morosidad (sin abrir también el detalle del mes) y Mi historial', () => {
    const u = fuente('src/pages/admin/_parts/unidades/ListaDeUnidades.tsx');
    assert.match(u, /Estado de cuenta de la unidad \$\{f\.codigo\}/);
    assert.match(u, /<EstadoCuentaModal /);
    const m = fuente('src/pages/admin/Morosidad.tsx');
    assert.match(m, /Estado de cuenta de la unidad/);
    assert.match(m, /ev\.stopPropagation\(\)/);
    const hr = fuente('src/pages/residente/_parts/HistorialResidente.tsx');
    assert.match(hr, />Estado de cuenta<\/Button>/);
    assert.match(hr, /<EstadoCuentaModal/);
  });

  it('con varios departamentos el modal ofrece el selector; el contrato de la API lo documenta', () => {
    assert.match(fuente('src/pages/shared/estado-cuenta/EstadoCuentaModal.tsx'), /unidades\.length > 1 &&/);
    assert.match(fuente('docs/API-CONTRATO.md'), /GET \/api\/estado-cuenta\/unidades\/:id\?desde=AAAA-MM/);
  });
});
