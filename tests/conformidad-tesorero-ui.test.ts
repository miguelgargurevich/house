// Pantalla de la conformidad del tesorero: la lógica (qué se dice, cuándo se avisa, quién ve qué botón) se prueba de verdad en el módulo puro;
// la estructura de los componentes se fija con la fuente (el repo no tiene testing-library: no pinta).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { esTesorero, insigniaConformidad, puedeValidar, textoConformidad, TEXTO_VALIDAR_SIN_CONFORMIDAD, vistaConformidad } from '../src/pages/admin/_parts/cobranza/conformidad';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const DADA = { at: '2026-10-29T15:00:00.000Z', por: { nombre: 'Rosa Quispe' } };
const fecha = (iso: string) => `el ${iso.slice(0, 10)}`;

describe('qué ve quien valida', () => {
  it('conformidad dada: «Confirmado por el tesorero» con nombre y fecha, también ya validado o rechazado (es constancia)', () => {
    for (const estado of ['por_validar', 'validado', 'rechazado'] as const) {
      const v = vistaConformidad({ estado_validacion: estado, conformidad: DADA, tesorero_registrado: true });
      assert.deepEqual(v, { tipo: 'dada', nombre: 'Rosa Quispe', at: DADA.at });
      assert.equal(textoConformidad(v!, fecha), 'Confirmado por el tesorero: Rosa Quispe · el 2026-10-29');
    }
  });

  it('por validar y aún sin conformidad: aviso «El tesorero aún no confirma…»', () => {
    const v = vistaConformidad({ estado_validacion: 'por_validar', conformidad: null, tesorero_registrado: true });
    assert.deepEqual(v, { tipo: 'falta' });
    assert.equal(textoConformidad(v!, fecha), 'El tesorero aún no confirma que el dinero llegó a la cuenta.');
  });

  it('el block sin tesorero lo dice (en vez de esperar una conformidad que nadie dará)', () => {
    const v = vistaConformidad({ estado_validacion: 'por_validar', conformidad: null, tesorero_registrado: false });
    assert.deepEqual(v, { tipo: 'sin_tesorero' });
    assert.match(textoConformidad(v!, fecha), /El block no tiene tesorero registrado/);
  });

  it('el propio tesorero lee lo que le toca hacer, no «el tesorero aún no confirma»', () => {
    const t = textoConformidad({ tipo: 'falta' }, fecha, true);
    assert.match(t, /Aún no confirmaste/);
    assert.doesNotMatch(t, /El tesorero aún no/);
  });

  it('ya revisado sin conformidad, o sin el dato (el servidor no lo trajo): no se dice nada', () => {
    assert.equal(vistaConformidad({ estado_validacion: 'validado', conformidad: null, tesorero_registrado: true }), null);
    assert.equal(vistaConformidad({ estado_validacion: 'rechazado', conformidad: null }), null);
    assert.equal(vistaConformidad({ estado_validacion: 'por_validar' }), null, 'undefined = no se sabe: no se inventa un aviso');
  });

  it('insignias de la lista: «Con conformidad» / «Sin conformidad» (el block sin tesorero también cuenta como sin)', () => {
    assert.deepEqual(insigniaConformidad({ estado_validacion: 'por_validar', conformidad: DADA }), { tone: 'ok', label: 'Con conformidad' });
    assert.deepEqual(insigniaConformidad({ estado_validacion: 'por_validar', conformidad: null, tesorero_registrado: true }), { tone: 'warn', label: 'Sin conformidad' });
    assert.deepEqual(insigniaConformidad({ estado_validacion: 'por_validar', conformidad: null, tesorero_registrado: false }), { tone: 'warn', label: 'Sin conformidad' });
    assert.equal(insigniaConformidad({ estado_validacion: 'validado', conformidad: null }), null);
  });

  it('el diálogo de validar repite el aviso sin bloquear', () => {
    assert.match(TEXTO_VALIDAR_SIN_CONFORMIDAD, /sin que el tesorero haya confirmado/);
    assert.match(TEXTO_VALIDAR_SIN_CONFORMIDAD, /de todos modos/);
  });
});

describe('quién valida y quién confirma', () => {
  it('valida la administración; la junta (presidente, tesorero, secretario, vocal) y los residentes no', () => {
    assert.equal(puedeValidar({ rol: 'admin' }), true);
    assert.equal(puedeValidar({ rol: 'superadmin' }), true);
    for (const cargo of ['presidente', 'tesorero', 'secretario', 'vocal']) assert.equal(puedeValidar({ rol: 'propietario', cargo_junta: cargo }), false, cargo);
    assert.equal(puedeValidar({ rol: 'inquilino' }), false);
    assert.equal(puedeValidar(null), false);
  });

  it('confirma sólo el tesorero', () => {
    assert.equal(esTesorero({ rol: 'propietario', cargo_junta: 'tesorero' }), true);
    for (const u of [{ rol: 'propietario', cargo_junta: 'presidente' }, { rol: 'propietario', cargo_junta: null }, { rol: 'admin', cargo_junta: 'tesorero' }, null] as const) assert.equal(esTesorero(u as never), false);
  });
});

describe('estructura de las pantallas', () => {
  const modal = fuente('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx');
  const pagos = fuente('src/pages/admin/Pagos.tsx');

  it('el diálogo: botón del tesorero (PUT y DELETE a /conformidad), validar/rechazar sólo para quien valida y confirmación al validar sin conformidad', () => {
    assert.match(modal, /Confirmo que llegó a la cuenta/);
    assert.match(modal, /Quitar mi conformidad/);
    assert.match(modal, /\/conformidad`, \{ method: dar \? 'PUT' : 'DELETE' \}/);
    assert.match(modal, /!validador \?/, 'la junta no ve Validar ni Rechazar');
    assert.match(modal, /Validar de todos modos/);
    assert.match(modal, /faltaConformidad \? setConfirmandoSinConformidad\(true\) : void revisar\('validado'\)/);
    assert.match(modal, /aria-label="Conformidad del tesorero"/);
  });

  it('la lista: insignia por fila, filtro «Conformidad del tesorero» que viaja como `conformidad` y texto de la junta', () => {
    assert.match(pagos, /insigniaConformidad\(p\)/);
    assert.match(pagos, /conformidad: conformidad \|\| undefined/);
    assert.match(pagos, /label="Conformidad del tesorero"/);
    assert.match(pagos, /<option value="con">Con conformidad<\/option>/);
    assert.match(pagos, /<option value="sin">Sin conformidad<\/option>/);
    assert.match(pagos, /la administración valida el pago/);
    assert.doesNotMatch(pagos, /valida el pago si el dinero llegó/, 'el texto viejo (la junta valida) ya no está');
  });

  it('el detalle de mantenimiento de la administración pasa la conformidad al diálogo', () => {
    const m = fuente('src/pages/admin/_parts/mantenimientos/MantenimientoAdminModal.tsx');
    assert.match(m, /conformidad: p\.conformidad, tesorero_registrado: p\.tesorero_registrado/);
  });

  it('el asistente ya no dice que la junta valida y explica la conformidad del tesorero', () => {
    const p = fuente('src/config/ai-system-prompt.txt');
    assert.match(p, /La junta ya no valida ni rechaza pagos: lo hace la administración/);
    assert.match(p, /Confirmo que llegó a la cuenta/);
    assert.doesNotMatch(p, /la administradora o la junta lo validan/);
    assert.doesNotMatch(p, /y validan o rechazan pagos de su ámbito/);
  });
});
