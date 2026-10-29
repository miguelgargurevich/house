// El recibo imprimible se parece a la primera cara del impreso de la administradora (referencia: docs/ejemplos/…, B01-804 de octubre 2026): mismo orden
// de bloques y, si falta un dato (foto, lectura, corte, logo, contacto), el bloque se omite sin dejar huecos. Se renderiza el componente de verdad
// (react-dom/server) y se mira el HTML; la vista previa de las cuentas del formulario de lecturas se compara con las del servidor.
import './helpers/env';
import assert from 'node:assert/strict';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { before, describe, it } from 'node:test';
import { cuentaLectura, alertaAgua } from '../src/server/lib/agua';
import { Prisma } from '@prisma/client';
import { avisoAgua, cuentaAgua } from '../src/pages/admin/_parts/agua/calculo';
import type { DetalleMantenimiento } from '../src/pages/shared/mantenimiento/tipos';

// tsx compila el JSX con `React.createElement`: se deja `React` global y se importan los componentes después (como en asistente-mensajes.test.ts).
let ReciboArticulo: typeof import('../src/pages/shared/mantenimiento/ReciboImprimible').ReciboArticulo;
let ConsumoAgua: typeof import('../src/pages/shared/mantenimiento/ConsumoAgua').ConsumoAgua;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ ReciboArticulo } = await import('../src/pages/shared/mantenimiento/ReciboImprimible'));
  ({ ConsumoAgua } = await import('../src/pages/shared/mantenimiento/ConsumoAgua'));
});

const CONCEPTOS = [
  ['ADMINISTRACIÓN GRUPO PRUEBA SAC', '123.69'], ['LUZ AREAS COMUNES DEL CONDOMINIO', '8.55'], ['LUZ COMUN DEL BLOCK', '30.25'], ['AGUA COMUN DEL CONDOMINIO', '2.53'],
  ['AGUA DPTO.', '70.63'], ['FONDO DE CONTINGENCIA DEL BLOCK', '15.00'], ['FONDO DE CONTINGENCIA DEL CONDOMINIO', '3.00'], ['MANTENIMIENTO DE ASCENSOR', '13.00'],
  ['MANTENIMIENTO DE CISTERNAS', '5.50'],
] as const;

/** B01-804 de octubre 2026 con datos de prueba (la cuenta es falsa). */
const completo = (): DetalleMantenimiento => ({
  recibo_id: 2, unidad_id: 1, numero: '2026-10-B01-804', titulo: 'Mantenimiento de octubre de 2026 · B01-804', mes: 10, anio: 2026,
  fecha_emision: '2026-10-27T00:00:00.000Z', fecha_vencimiento: '2026-11-02T00:00:00.000Z', fecha_corte_agua: '2026-11-10T00:00:00.000Z', estado: 'pendiente', moneda: 'PEN',
  total: '272.15', cobrado: '0.00', en_revision: '0.00', saldo: '272.15', deuda_acumulada: '0.00', total_general: '272.15',
  agua: { fecha_anterior: '2026-09-10T00:00:00.000Z', lectura_anterior: '1416.574', fecha_actual: '2026-10-10T00:00:00.000Z', lectura_actual: '1430.897', factor: '4.9300', consumo_m3: '14.323', monto: '70.61', tiene_foto: true, foto_url: '/api/recibos/2/agua/1/foto?v=1' },
  correo_vouchers: 'junta.block1@example.com', linea_mora: 'MULTA PAGO FUERA DE FECHA',
  condominio: { id: 1, nombre: 'CONDOMINIO LOS LIBERTADORES DE SURCO', moneda: 'PEN', direccion: 'AV. GAVIOTAS N° 2121 - SANTIAGO DE SURCO', notas_pago: 'Todo pago en ventanilla tiene un cobro adicional de 9 soles\n\nLos pagos realizados en provincia tienen un cobro adicional de 9 soles', admin_nombre: 'ADMINISTRADORA DE PRUEBA', admin_celular: '999 000 111', admin_correo: 'adm@example.com', cabecera_url: '/api/complejos/1/cabecera?v=1' },
  empresa: { id: 1, nombre: 'GRUPO PRUEBA SAC', ruc: '20000000001', direccion: null, telefono: null, email: null, logo_url: '/api/empresas/1/logo?v=1' },
  unidad: { id: 1, codigo: 'B01-804', estructura: { id: 1, nombre: 'Block 1' } },
  propietario: { id: 1, nombre: 'FERNANDEZ GARGUVERICH MIGUEL ARTURO' }, inquilino: null,
  conceptos: CONCEPTOS.map(([concepto, monto], i) => ({ cargo_id: i + 1, concepto, es_recargo: false, monto, cobrado: '0.00', en_revision: '0.00', saldo: monto, motivo: null })),
  pagos: [],
  medios_pago: [{ id: 1, tipo: 'banco', ambito: 'block', banco: 'BCP', entidad: 'BCP', moneda: 'PEN', moneda_nombre: 'Soles', servicio: null, instruccion: null, tipo_cuenta: 'ahorros', numero_cuenta: '191-0000000-0-00', cci: '00219100000000000000', titular: 'TITULAR DE PRUEBA', celular: null, tiene_qr: false }],
});

const html = (d: DetalleMantenimiento) => renderToStaticMarkup(createElement(ReciboArticulo, { d }));
const texto = (d: DetalleMantenimiento) => html(d).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toUpperCase();

describe('recibo imprimible: los bloques de la primera cara del impreso, en su orden', () => {
  it('trae todo, de arriba abajo, como el impreso', () => {
    const t = texto(completo());
    const orden = [
      'CONDOMINIO LOS LIBERTADORES DE SURCO', 'AV. GAVIOTAS N° 2121 - SANTIAGO DE SURCO', 'RECIBO DE MANTENIMIENTO MENSUAL', 'AÑO:', 'MES:', 'FECHA DE EMISIÓN:', '27/10/2026',
      'PROPIETARIO (A):', 'FERNANDEZ GARGUVERICH MIGUEL ARTURO', 'BLOCK:', 'DPTO:', 'CONCEPTO', 'MONTO S/',
      'ADMINISTRACIÓN GRUPO PRUEBA SAC', 'AGUA DPTO.', 'MANTENIMIENTO DE CISTERNAS', 'MULTA PAGO FUERA DE FECHA', 'TOTAL MANTENIMIENTO', 'DEUDA ACUMULADA Y/O SALDO A FAVOR',
      'LECTURA DE CONTÓMETRO', 'DETALLE DEL CONSUMO DE AGUA', '10/09/2026', '10/10/2026', 'LECT. ANT.', 'LECT. ACTUAL', 'CONSUMO M3', 'FACTOR', 'CONSUMO S/', '1416.574', '1430.897', '14.323', '4.93',
      'CANCELAR ÚNICAMENTE EN AGENTES BCP O A TRAVÉS DE TRANSFERENCIA Y ENVIAR VOUCHER DE DEPÓSITO',
      'CUENTA DE AHORROS BCP', 'NRO. CTA:', '191-0000000-0-00', 'CCI:', 'NOMBRE:', 'CORREO:', 'JUNTA.BLOCK1@EXAMPLE.COM',
      'FECHA DE VENCIMIENTO', '02 DE NOVIEMBRE DE 2026', 'FECHA CORTE DE AGUA', '10 DE NOVIEMBRE DE 2026',
      'TODO PAGO EN VENTANILLA', 'LOS PAGOS REALIZADOS EN PROVINCIA', 'ADMINISTRACIÓN: ADMINISTRADORA DE PRUEBA', 'CELULAR DE ADMINISTRACIÓN: 999 000 111', 'CORREO ELECTRÓNICO ADM: ADM@EXAMPLE.COM',
    ];
    let desde = 0;
    for (const x of orden) {
      const i = t.indexOf(x, desde);
      assert.ok(i >= 0, `falta «${x}» (o está fuera de orden) después de la posición ${desde}`);
      desde = i;
    }
    const h = html(completo());
    assert.match(h, /<img[^>]+src="\/api\/complejos\/1\/cabecera\?v=1"/, 'foto de cabecera');
    assert.match(h, /<img[^>]+src="\/api\/recibos\/2\/agua\/1\/foto\?v=1"/, 'foto del contómetro');
    assert.match(h, /<img[^>]+src="\/api\/empresas\/1\/logo\?v=1"/, 'logo al pie');
    assert.ok(h.lastIndexOf('/api/empresas/1/logo') > h.lastIndexOf('CORREO ELECTRÓNICO ADM'), 'el logo va al final');
  });

  it('los 9 conceptos con su monto y la línea de multa en 0.00 aunque el departamento no la deba', () => {
    const t = texto(completo());
    for (const [c, m] of CONCEPTOS) assert.match(t, new RegExp(`${c.replace(/[.]/g, '\\.')} ${m.replace('.', '\\.')}`), c);
    assert.match(t, /MULTA PAGO FUERA DE FECHA 0\.00/);
    assert.match(t, /TOTAL MANTENIMIENTO 272\.15/);
    assert.match(t, /DEUDA ACUMULADA Y\/O SALDO A FAVOR 0\.00/);
    assert.match(t, /TOTAL 272\.15/);
    assert.doesNotMatch(texto({ ...completo(), linea_mora: null }), /MULTA PAGO FUERA DE FECHA/, 'sin concepto de multa en el recibo no se inventa');
  });

  it('con deuda acumulada, el TOTAL es el total general (mantenimiento + deuda)', () => {
    const t = texto({ ...completo(), deuda_acumulada: '230.00', total_general: '502.15' });
    assert.match(t, /TOTAL MANTENIMIENTO 272\.15/);
    assert.match(t, /DEUDA ACUMULADA Y\/O SALDO A FAVOR 230\.00/);
    assert.match(t, /TOTAL 502\.15/);
  });

  it('las notas de pago son una línea por renglón (los vacíos se descartan)', () => {
    const h = html(completo());
    assert.equal((h.match(/Todo pago en ventanilla|Los pagos realizados en provincia/g) ?? []).length, 2);
    assert.ok(!/<li[^>]*>\s*<\/li>/.test(h), 'ningún renglón vacío');
  });
});

describe('recibo imprimible: si falta un dato, el bloque se omite sin dejar huecos', () => {
  it('sin foto de cabecera, sin logo y sin contacto: no hay imágenes ni líneas vacías; el título ocupa todo el ancho', () => {
    const d = completo();
    d.condominio = { ...d.condominio!, cabecera_url: null, notas_pago: null, admin_nombre: null, admin_celular: null, admin_correo: null };
    d.empresa = { ...d.empresa!, logo_url: null };
    d.agua = { ...d.agua!, tiene_foto: false, foto_url: null };
    const h = html(d);
    assert.doesNotMatch(h, /<img/, 'ninguna imagen');
    const t = texto(d);
    for (const x of ['ADMINISTRACIÓN:', 'CELULAR DE ADMINISTRACIÓN', 'CORREO ELECTRÓNICO ADM', 'TODO PAGO EN VENTANILLA', 'LECTURA DE CONTÓMETRO']) assert.ok(!t.includes(x), x);
    assert.ok(t.includes('DETALLE DEL CONSUMO DE AGUA'), 'el detalle del consumo sigue aunque no haya foto');
    assert.ok(!h.includes('sm:grid-cols-[2fr_3fr]'), 'sin foto el encabezado no reserva su columna');
    assert.ok(!/class="[^"]*sm:grid-cols-2/.test(h.slice(h.indexOf('aria-label="Consumo de agua"'), h.indexOf('aria-label="Consumo de agua"') + 200)), 'sin foto el detalle del agua ocupa todo el ancho');
    assert.match(t, /GRUPO PRUEBA SAC · RUC 20000000001/, 'sin logo, el nombre de la empresa al pie');
  });

  it('sin lectura de agua no sale el bloque de agua; sin fecha de corte no sale su caja', () => {
    const d = { ...completo(), agua: null, fecha_corte_agua: null };
    const t = texto(d);
    for (const x of ['LECTURA DE CONTÓMETRO', 'DETALLE DEL CONSUMO DE AGUA', 'CONSUMO M3', 'FECHA CORTE DE AGUA']) assert.ok(!t.includes(x), x);
    assert.ok(t.includes('FECHA DE VENCIMIENTO'));
  });

  it('sin medios de pago no hay cajas de cuenta ni el aviso del banco; se dice que los consulte', () => {
    const t = texto({ ...completo(), medios_pago: [], correo_vouchers: null });
    for (const x of ['CUENTA DE AHORROS', 'NRO. CTA', 'CANCELAR ÚNICAMENTE']) assert.ok(!t.includes(x), x);
    assert.ok(t.includes('CONSULTA LOS MEDIOS DE PAGO CON LA JUNTA'));
  });

  it('sin correo del block no hay renglón «Correo:»; sin estructura no hay recuadro «Block:»', () => {
    const d = { ...completo(), correo_vouchers: null };
    d.unidad = { ...d.unidad, estructura: null };
    const t = texto(d);
    assert.ok(!t.includes('CORREO: '), 'sin correo');
    assert.ok(!t.includes('BLOCK:'), 'sin block');
    assert.ok(t.includes('DPTO: B01-804'));
  });

  it('las cuentas del block y las del condominio se rotulan sólo cuando hay de las dos clases (nadie paga a la equivocada)', () => {
    const d = completo();
    assert.ok(!texto(d).includes('CUENTAS DE BLOCK 1'), 'con un solo grupo no hace falta el rótulo');
    d.medios_pago = [...d.medios_pago, { ...d.medios_pago[0], id: 2, ambito: 'condominio', numero_cuenta: '999-9999999-9-99', titular: 'OTRO TITULAR' }];
    const t = texto(d);
    assert.ok(t.includes('CUENTAS DE BLOCK 1') && t.includes('CUENTAS DEL CONDOMINIO CONDOMINIO LOS LIBERTADORES DE SURCO'));
    assert.ok(t.indexOf('CUENTAS DE BLOCK 1') < t.indexOf('CUENTAS DEL CONDOMINIO'));
  });

  it('el recibo se pagó parcialmente: aparece cuánto va pagado y el saldo del mantenimiento', () => {
    const t = texto({ ...completo(), cobrado: '100.00', saldo: '172.15' });
    assert.match(t, /PAGADO \(ESTE MANTENIMIENTO\) 100\.00/);
    assert.match(t, /SALDO POR PAGAR \(ESTE MANTENIMIENTO\) 172\.15/);
    assert.doesNotMatch(texto(completo()), /PAGADO \(ESTE/, 'sin pagos no se agregan renglones');
  });
});

describe('detalle del residente: consumo de agua', () => {
  it('muestra lecturas con su fecha, m³, factor, monto y la foto ampliable', () => {
    const d = completo();
    const h = renderToStaticMarkup(createElement(ConsumoAgua, { agua: d.agua!, codigo: 'B01-804' }));
    const t = h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const x of ['Lectura anterior (10/09/2026)', '1416.574', 'Lectura actual (10/10/2026)', '1430.897', '14.323 m³', 'S/ 4.93 por m³', 'S/ 70.61']) assert.ok(t.includes(x), x);
    assert.match(h, /aria-label="Ampliar la foto del contómetro"/);
    assert.doesNotMatch(renderToStaticMarkup(createElement(ConsumoAgua, { agua: { ...d.agua!, foto_url: null, tiene_foto: false }, codigo: 'B01-804' })), /Ampliar/);
  });
});

describe('vista previa del formulario de lecturas = cuentas del servidor', () => {
  const casos: [string, string, string][] = [
    ['1416.574', '1430.897', '4.9313'], ['0', '8.12', '4.93'], ['100.5', '108.614', '4.93'], ['3.000', '4.000', '0.835'], ['1', '1.001', '0.125'], ['999999.999', '1000000', '99.9999'],
    ['0.100', '0.300', '4.9300'], ['12', '12', '4.93'], ['1,5', '2,25', '4,9'],
  ];
  it('mismos m³ y mismo monto (half-up) que `lib/agua.ts`, sin coma flotante', () => {
    for (const [a, c, f] of casos) {
      const n = (s: string) => new Prisma.Decimal(s.replace(',', '.'));
      const srv = cuentaLectura({ lectura_anterior: n(a), lectura_actual: n(c), factor: n(f) });
      assert.deepEqual(cuentaAgua(a, c, f), { consumo_m3: srv.consumo_m3, monto: srv.monto }, `${a} → ${c} × ${f}`);
    }
  });
  it('lectura menor, factor cero o texto → sin cuenta', () => {
    assert.equal(cuentaAgua('10', '9.999', '4.93'), null);
    assert.equal(cuentaAgua('10', '12', '0'), null);
    assert.equal(cuentaAgua('diez', '12', '4.93'), null);
    assert.equal(cuentaAgua('', '12', '4.93'), null);
  });
  it('el aviso salta igual que en el servidor: sólo con más de S/ 0.05', () => {
    for (const [l, r] of [['70.63', '70.58'], ['70.64', '70.58'], ['70.58', '70.64'], ['59.16', '60.00'], ['40.03', '40.00']] as const) {
      assert.equal(avisoAgua(l, r), alertaAgua(l, r), `${l} contra ${r}`);
    }
    assert.equal(avisoAgua('10.00', null), null);
  });
});
