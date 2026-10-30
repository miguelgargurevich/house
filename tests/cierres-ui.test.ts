// Pantallas del cierre del mes: lo que se dice y cuándo se ofrece cada acción se prueba de verdad en el módulo puro (`_parts/cierres/vista.ts`);
// la estructura de los componentes se fija con la fuente (el repo no tiene testing-library: no pinta).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DESTINO_ETIQUETA, DESTINOS as DESTINOS_SERVIDOR } from '../src/server/services/cierres/destinos';
import { navPara } from '../src/app/nav';
import {
  DESTINOS, detalleRegistro, estadoLinea, etiquetaDestino, montoSugerido, periodoPorDefecto, puedeQuitarPago, puedeRegistrarLinea, textoCuenta, tieneCuenta,
} from '../src/pages/admin/_parts/cierres/vista';
import type { RegistroLinea } from '../src/pages/admin/_parts/cierres/tipos';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const registro = (extra: Partial<RegistroLinea> = {}): RegistroLinea => ({
  id: 1, monto_pagado: '200.25', fecha_pago: '2026-10-02', referencia: 'TRF-77', observaciones: null, registrado_por: { id: 3, nombre: 'Rosa Quispe' },
  created_at: '2026-10-02T15:00:00.000Z', voucher: { nombre: 'v.png', tipo_mime: 'image/png', tamano: 100 }, conformidad: null, ...extra,
});

describe('destinos: la pantalla y el servidor dicen lo mismo', () => {
  it('los mismos cinco destinos y las mismas etiquetas', () => {
    assert.deepEqual(DESTINOS.map(d => d.value), [...DESTINOS_SERVIDOR]);
    for (const d of DESTINOS) assert.equal(d.label, DESTINO_ETIQUETA[d.value], d.value);
  });
  it('sin destino se dice «Sin clasificar»', () => {
    assert.equal(etiquetaDestino(null), 'Sin clasificar');
    assert.equal(etiquetaDestino('ahorro_block'), 'Fondo de ahorros del block');
  });
});

describe('estado de cada línea', () => {
  it('sin pago: por pagar; con pago y sin conformidad que dar: pagado', () => {
    assert.deepEqual(estadoLinea({ registro: null, lleva_conformidad: true }), { tone: 'warn', label: 'Por pagar' });
    assert.deepEqual(estadoLinea({ registro: registro(), lleva_conformidad: false }), { tone: 'ok', label: 'Pagado' });
  });
  it('a la empresa administradora o a la Junta central: pagado pero falta la conformidad, hasta que se da', () => {
    assert.deepEqual(estadoLinea({ registro: registro(), lleva_conformidad: true }), { tone: 'info', label: 'Pagado · falta conformidad' });
    assert.deepEqual(estadoLinea({ registro: registro({ conformidad: { at: '2026-10-03T10:00:00.000Z', por: { id: 9, nombre: 'Tesorero central' } } }), lleva_conformidad: true }), { tone: 'ok', label: 'Con conformidad' });
  });
});

describe('qué se propone y qué se ofrece', () => {
  it('administradora y Junta central: se propone lo facturado; servicios y proveedores: el monto lo escribe el tesorero (boleta o factura)', () => {
    assert.equal(montoSugerido({ destino: 'administradora', facturado: '200.25' }), '200.25');
    assert.equal(montoSugerido({ destino: 'central', facturado: '78.00' }), '78.00');
    assert.equal(montoSugerido({ destino: 'servicio', facturado: '100.00' }), '');
    assert.equal(montoSugerido({ destino: 'proveedor', facturado: '40.00' }), '');
  });
  it('«Registrar pago» sólo a quien puede registrar, en una línea viva sin pago', () => {
    assert.equal(puedeRegistrarLinea(true, { registro: null, obsoleta: false }), true);
    assert.equal(puedeRegistrarLinea(false, { registro: null, obsoleta: false }), false, 'el presidente lo ve pero no registra');
    assert.equal(puedeRegistrarLinea(true, { registro: registro(), obsoleta: false }), false);
    assert.equal(puedeRegistrarLinea(true, { registro: null, obsoleta: true }), false);
  });
  it('«Quitar pago» mientras no tenga conformidad', () => {
    assert.equal(puedeQuitarPago(true, { registro: registro() }), true);
    assert.equal(puedeQuitarPago(true, { registro: registro({ conformidad: { at: 'x', por: null } }) }), false);
    assert.equal(puedeQuitarPago(false, { registro: registro() }), false);
    assert.equal(puedeQuitarPago(true, { registro: null }), false);
  });
  it('el detalle del pago dice cuándo, quién y la operación', () => {
    assert.equal(detalleRegistro(registro(), iso => `el ${iso}`), 'Pagado el el 2026-10-02 · registrado por Rosa Quispe · Op. TRF-77');
    assert.equal(detalleRegistro(registro({ registrado_por: null, referencia: null }), iso => iso), 'Pagado el 2026-10-02');
  });
});

describe('cuentas de destino', () => {
  it('se muestran en una línea, sin los campos vacíos', () => {
    assert.equal(textoCuenta({ banco: 'BCP', tipo: 'Corriente', numero: '194-1', cci: '0021', titular: 'Grupo Vrany SAC' }), 'BCP · Corriente · 194-1 · CCI 0021 · Grupo Vrany SAC');
    assert.equal(textoCuenta({ banco: 'BBVA', tipo: null, numero: null, cci: null, titular: null }), 'BBVA');
    assert.equal(textoCuenta(null), '');
    assert.equal(tieneCuenta({ banco: null, tipo: null, numero: null, cci: null, titular: null }), false);
  });
});

describe('el mes que se cierra', () => {
  it('por defecto el anterior al actual; en enero, diciembre del año pasado', () => {
    assert.deepEqual(periodoPorDefecto(new Date(2026, 9, 29)), { mes: 9, anio: 2026 });
    assert.deepEqual(periodoPorDefecto(new Date(2027, 0, 5)), { mes: 12, anio: 2026 });
  });
});

describe('menú y rutas', () => {
  const todos = (u: Parameters<typeof navPara>[0]) => navPara(u).flatMap(g => g.items.map(i => i.to));
  it('la administración y el superadmin ven «Cierres del mes» en Cobranza', () => {
    for (const rol of ['admin', 'superadmin'] as const) assert.ok(todos({ rol, cargo_junta: null, complejo_id: null }).includes('/admin/cierres'), rol);
  });
  it('«Aportes de los blocks» es sólo de la Junta central; «Cierre del mes», de toda junta (presidente o tesorero)', () => {
    const base = { rol: 'propietario', complejo_id: 1 } as const;
    assert.ok(todos({ ...base, cargo_junta: 'tesorero', estructura_id: 4 }).includes('/junta/cierre'));
    assert.ok(!todos({ ...base, cargo_junta: 'tesorero', estructura_id: 4 }).includes('/junta/aportes'));
    assert.ok(todos({ ...base, cargo_junta: 'tesorero', estructura_id: null }).includes('/junta/aportes'));
    assert.ok(todos({ ...base, cargo_junta: 'presidente', estructura_id: null }).includes('/junta/aportes'));
    assert.ok(!todos({ ...base, cargo_junta: 'vocal', estructura_id: null }).some(r => r.startsWith('/junta/')));
  });
  it('App.tsx tiene las tres rutas, las de la junta dentro de RequireJunta', () => {
    const app = fuente('src/App.tsx');
    assert.match(app, /path="\/admin\/cierres" element=\{<AdminCierres \/>\}/);
    assert.match(app, /<RequireJunta \/>[\s\S]*path="\/junta\/cierre" element=\{<AdminCierres \/>\}[\s\S]*path="\/junta\/aportes" element=\{<AdminCierresAportes \/>\}/);
  });
});

describe('estructura de las pantallas', () => {
  const modal = fuente('src/pages/admin/_parts/cierres/RegistrarLineaModal.tsx');
  const detalle = fuente('src/pages/admin/_parts/cierres/DetalleCierre.tsx');
  const pagina = fuente('src/pages/admin/Cierres.tsx');
  it('registrar un pago: el voucher es obligatorio (no se envía sin archivo) y todo va en UN envío multipart', () => {
    assert.match(modal, /disabled=\{!archivo \|\| enviando\}/);
    assert.match(modal, /type="file"[\s\S]*required/);
    assert.match(modal, /registrarPagoConVoucher\(`\/api\/cierres\/block\/\$\{cierre\.estructura\.id\}\/lineas`/);
    assert.match(modal, /capture="environment"/, 'cámara en el celular');
  });
  it('cada línea se muestra como tarjeta (celular de 375 px): montos en rejilla, textos que cortan y botones que envuelven', () => {
    assert.match(detalle, /grid grid-cols-2 gap-3 sm:grid-cols-3/);
    assert.match(detalle, /break-words/);
    assert.match(detalle, /flex flex-wrap gap-2/);
    assert.doesNotMatch(detalle, /<table/);
  });
  it('el Fondo de ahorros se muestra aparte, con «de multas y contingencia» y el «sobrante del mes»', () => {
    assert.match(detalle, /Fondo de ahorros del block/);
    assert.match(detalle, /De multas y contingencia/);
    assert.match(detalle, /Sobrante del mes/);
    assert.doesNotMatch(detalle, /Caja del block/);
  });
  it('la conformidad se ofrece sólo si el servidor dice que puede (puede_conformidad) y no se prueba en el cliente quién es quién', () => {
    assert.match(detalle, /l\.puede_conformidad/);
    assert.doesNotMatch(detalle, /cargo_junta|useAuth/);
  });
  it('la página: administración con pestañas y condominio propio (el selector de arriba no se toca); la junta, directo a su block', () => {
    assert.match(pagina, /title=\{esAdmin \? 'Cierres del mes' : 'Cierre del mes'\}/);
    assert.match(pagina, /id: 'administradora'[\s\S]*id: 'central'[\s\S]*id: 'cuentas'/);
    assert.match(pagina, /!esAdmin && data\.blocks\.length === 1/);
  });
  it('Conceptos: el destino se elige en el formulario, la sugerencia se ofrece sin aplicarse sola', () => {
    const c = fuente('src/pages/admin/Conceptos.tsx');
    assert.match(c, /label="Destino al cerrar el mes"/);
    assert.match(c, /Usar esta sugerencia/);
    assert.match(c, /destino: v\.destino \|\| null/, 'sin elegir se guarda null: nunca se asume');
  });
});
