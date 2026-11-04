// Pantallas de «Anular recibo» y «Corregir cargos». El repo no pinta componentes en Node: se prueba la lógica pura (`recibos/correccion.ts`)
// y se comprueba la fuente (qué piden a la API, qué botones hay, quién los ve, qué dicen).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { MOTIVO_ANULAR_MAX, MOTIVO_CORREGIR_MAX, cambiosDe, efectoAnulacion, errorMonto, errorMotivo, montoEscrito, motivoNoSePuedeAnular, pagadoVigente, sePuedeQuitar, tambienSeLleva } from '../src/pages/admin/_parts/recibos/correccion';
import type { CargoCorregible, ResumenAnulacion } from '../src/pages/admin/_parts/recibos/correccion';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const ANULAR = f('src/pages/admin/_parts/recibos/AnularReciboModal.tsx');
const CORREGIR = f('src/pages/admin/_parts/recibos/CorregirCargosModal.tsx');
const PERIODO = f('src/pages/admin/PeriodoRecibo.tsx');
const MANT = f('src/pages/admin/_parts/mantenimientos/MantenimientoAdminModal.tsx');
const MANUAL = JSON.parse(f('docs/manual/manual-house.json')) as { secciones?: { titulo: string; contenido?: unknown }[] };

const resumen = (extra: Partial<ResumenAnulacion> = {}): ResumenAnulacion => ({ recibo_id: 7, mes: 10, anio: 2026, periodo: 'octubre de 2026', torre: 'Block 1', moneda: 'PEN', departamentos: 32, cargos: 96, total: '12480.00', cargos_con_pagos: 0, pagos_rechazados: 0, lecturas_agua: 0, puede: true, bloqueo: null, ...extra });
const cargo = (id: number, concepto: string, monto: string, cobrado = '0.00', en_revision = '0.00'): CargoCorregible => ({ cargo_id: id, concepto, monto, cobrado, en_revision });
const soles = (n: number) => `S/ ${n.toFixed(2)}`;

describe('correccion.ts: lógica de «Anular recibo»', () => {
  it('dice el efecto en una línea, con el número de departamentos y el mes que queda libre', () => {
    assert.equal(efectoAnulacion(resumen()), 'Se quitan los cargos de 32 departamentos y podrás emitir octubre de 2026 de Block 1 de nuevo.');
    assert.equal(efectoAnulacion(resumen({ departamentos: 1, torre: null })), 'Se quitan los cargos de 1 departamento y podrás emitir octubre de 2026 de nuevo.');
  });

  it('el motivo exige de 5 a 200 caracteres (sin contar los espacios de los lados) al anular, y hasta 300 al corregir', () => {
    assert.ok(errorMotivo('abcd', MOTIVO_ANULAR_MAX));
    assert.ok(errorMotivo('   abcd   ', MOTIVO_ANULAR_MAX));
    assert.equal(errorMotivo('Mes equivocado', MOTIVO_ANULAR_MAX), undefined);
    assert.ok(errorMotivo('x'.repeat(201), MOTIVO_ANULAR_MAX));
    assert.equal(errorMotivo('x'.repeat(300), MOTIVO_CORREGIR_MAX), undefined);
    assert.ok(errorMotivo('x'.repeat(301), MOTIVO_CORREGIR_MAX));
  });

  it('con pagos vigentes explica por qué no se puede; sin ellos, no hay nada que explicar', () => {
    assert.equal(motivoNoSePuedeAnular(resumen()), null);
    assert.equal(motivoNoSePuedeAnular(null), null);
    assert.equal(motivoNoSePuedeAnular(resumen({ puede: false, cargos_con_pagos: 2, bloqueo: 'Este recibo tiene pagos: anúlalos o recházalos antes' })), 'Este recibo tiene pagos: anúlalos o recházalos antes');
    assert.match(motivoNoSePuedeAnular(resumen({ puede: false, bloqueo: null }))!, /tiene pagos/);
  });

  it('avisa lo que además se lleva: pagos rechazados y lecturas de agua con su foto', () => {
    assert.deepEqual(tambienSeLleva(resumen()), []);
    assert.deepEqual(tambienSeLleva(resumen({ pagos_rechazados: 1, lecturas_agua: 1 })), ['1 pago rechazado (quedan en la auditoría)', '1 lectura de agua, con su foto: tendrás que volver a cargarlas']);
    assert.match(tambienSeLleva(resumen({ pagos_rechazados: 3 }))[0]!, /^3 pagos rechazados/);
  });
});

describe('correccion.ts: lógica de «Corregir cargos»', () => {
  it('lo pagado vigente es lo validado más lo que está en revisión', () => {
    assert.equal(pagadoVigente(cargo(1, 'M', '100', '50.00', '20.00')), 70);
    assert.equal(pagadoVigente(cargo(1, 'M', '100')), 0);
  });

  it('un cargo se quita sólo si nadie lo pagó ni tiene un pago en revisión', () => {
    assert.equal(sePuedeQuitar(cargo(1, 'M', '100')), true);
    assert.equal(sePuedeQuitar(cargo(1, 'M', '100', '10.00')), false);
    assert.equal(sePuedeQuitar(cargo(1, 'M', '100', '0.00', '10.00')), false);
  });

  it('el monto nuevo no puede ser inválido, cero ni quedar por debajo de lo ya pagado', () => {
    const c = cargo(1, 'Mantenimiento', '100.00', '50.00', '20.00');
    assert.ok(errorMonto('', c, soles));
    assert.ok(errorMonto('abc', c, soles));
    assert.ok(errorMonto('10.123', c, soles));
    assert.match(errorMonto('0', c, soles)!, /Quitar este cargo/);
    assert.match(errorMonto('69.99', c, soles)!, /lo ya pagado \(S\/ 70\.00\)/);
    assert.equal(errorMonto('70', c, soles), undefined, 'igual a lo pagado sí');
    assert.equal(errorMonto('70,5', c, soles), undefined, 'acepta la coma decimal');
    assert.equal(errorMonto('150', c, soles), undefined, 'subir también se puede');
    assert.equal(montoEscrito(' 12,5 '), '12.5');
    assert.equal(montoEscrito('1e3'), null);
  });

  it('manda sólo lo que cambió: los quitados como quitar, los de monto distinto como corregir, el resto nada', () => {
    const cs = [cargo(1, 'Mantenimiento', '100.00'), cargo(2, 'Agua', '30.00'), cargo(3, 'Multa', '20.00'), cargo(4, 'Gas', '15.00')];
    assert.deepEqual(cambiosDe(cs, {}, new Set()), []);
    assert.deepEqual(cambiosDe(cs, { 1: '100.00', 2: '30' }, new Set()), [], 'el mismo monto escrito de otra forma no es un cambio');
    assert.deepEqual(cambiosDe(cs, { 1: '80,5', 3: '20.00' }, new Set([2, 4])), [
      { cargo_id: 1, concepto: 'Mantenimiento', accion: 'corregir', monto: '80.5' },
      { cargo_id: 2, concepto: 'Agua', accion: 'quitar' },
      { cargo_id: 4, concepto: 'Gas', accion: 'quitar' },
    ]);
    assert.deepEqual(cambiosDe(cs, { 2: '5' }, new Set([2])), [{ cargo_id: 2, concepto: 'Agua', accion: 'quitar' }, ], 'quitar manda sobre el monto escrito');
  });
});

describe('las pantallas: qué piden a la API y quién las ve', () => {
  it('«Anular recibo» manda el motivo y «avisar» a POST /anular, con «avisar» marcado de entrada', () => {
    assert.match(ANULAR, /\/api\/recibos\/\$\{reciboId\}\/anular/);
    assert.match(ANULAR, /json: \{ motivo: motivo\.trim\(\), avisar \}/);
    assert.match(ANULAR, /useState\(true\)/, 'la casilla «Avisar a los vecinos» viene marcada');
    assert.match(ANULAR, /Avisar a los vecinos/);
    assert.match(ANULAR, /Al grupo de WhatsApp no se envía nada/);
    assert.match(ANULAR, /variant="danger"/);
    assert.match(ANULAR, /efectoAnulacion\(resumen\)/, 'el modal dice el efecto en una línea');
    assert.match(ANULAR, /disabled=\{!puede \|\| b\}/, 'sin permiso de anular (con pagos) o en solo lectura, el botón está apagado');
    assert.match(ANULAR, /<Bloqueable>/);
  });

  it('el periodo trae «Anular recibo» (secundaria, de peligro), apagada con pagos y explicada; al anular vuelve a la lista', () => {
    assert.match(PERIODO, /\/api\/recibos\/\$\{reciboId\}\/anulacion/);
    assert.match(PERIODO, /Anular recibo/);
    assert.match(PERIODO, /variant="secondary" className="text-bad"/);
    assert.match(PERIODO, /disabled=\{b \|\| !anulacion\.data \|\| !anulacion\.data\.puede\}/);
    assert.match(PERIODO, /motivoNoSePuedeAnular\(anulacion\.data\)/);
    assert.match(PERIODO, /navigate\('\/admin\/recibos'/);
    assert.match(PERIODO, /<AnularReciboModal/);
  });

  it('«Corregir cargos» usa POST /corregir y /quitar con el motivo, y no el PUT genérico', () => {
    assert.match(CORREGIR, /\/api\/recibo-concepto-unidades\/\$\{c\.cargo_id\}\/quitar/);
    assert.match(CORREGIR, /\/api\/recibo-concepto-unidades\/\$\{c\.cargo_id\}\/corregir/);
    assert.doesNotMatch(CORREGIR, /method: 'PUT'|method: 'DELETE'/);
    assert.match(CORREGIR, /json: \{ monto: c\.monto, motivo: motivo\.trim\(\) \}/);
    assert.match(CORREGIR, /Quitar este cargo/);
    assert.match(CORREGIR, /El vecino no recibe aviso/);
    assert.match(CORREGIR, /<Bloqueable>/);
  });

  it('el botón «Corregir cargos» del recibo del departamento sólo lo ve la administración', () => {
    assert.match(MANT, /puedeValidar\(user\) && d\.conceptos\.length > 0/);
    assert.match(MANT, /Corregir cargos/);
    assert.match(MANT, /<CorregirCargosModal/);
  });

  it('los textos están en español con tuteo, sin emojis y sin hablar de «push»', () => {
    for (const [nombre, src] of Object.entries({ ANULAR, CORREGIR })) {
      assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, `${nombre}: sin emojis`);
      assert.doesNotMatch(src, /\bpush\b/i, nombre);
      assert.doesNotMatch(src, /\busted\b|\bpuede usted\b/i, nombre);
    }
    assert.match(ANULAR, /Ve a Pagos, y vuelve cuando no quede ninguno vigente/);
  });
});

describe('el manual', () => {
  const secciones = MANUAL.secciones ?? [];
  const buscar = (re: RegExp) => secciones.find(x => re.test(x.titulo));

  it('trae «Anular un recibo» y «Corregir el cargo de un departamento», con sus pasos y lo que no se puede', () => {
    const anular = JSON.stringify(buscar(/^Anular un recibo$/));
    for (const frase of ['Anular recibo', 'Avisar a los vecinos', 'motivo', 'grupo de WhatsApp no se envía nada', 'pagos']) assert.match(anular, new RegExp(frase), frase);
    const corregir = JSON.stringify(buscar(/^Corregir el cargo de un departamento$/));
    for (const frase of ['Corregir cargos', 'Quitar este cargo', 'motivo', 'ya pagó']) assert.match(corregir, new RegExp(frase), frase);
  });

  it('la tabla inicial apunta a las secciones que son: cada rango empieza y termina donde dice', () => {
    const n = (re: RegExp) => secciones.findIndex(x => re.test(x.titulo)) + 1;
    const filas = (secciones[0] as unknown as { tabla: { filas: string[][] } }).tabla.filas;
    const rango = (rol: RegExp) => filas.find(x => rol.test(x[0]!))![2]!;
    assert.equal(rango(/^Administradora$/), `Secciones 07 a ${n(/^Tu marca: logo/)}`);
    assert.match(rango(/^Junta directiva/), new RegExp(`^Secciones ${n(/^Mi junta$/)} a ${n(/^Si tu edificio tiene una sola junta$/)}$`));
    assert.equal(rango(/^Inquilino$/), `Sección ${n(/^Si alquilas$/)}`);
    assert.equal(rango(/^Superadmin/), `Sección ${n(/^Entrar como otra persona/)}`);
  });
});
