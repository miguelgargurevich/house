// Pantalla de la conformidad del tesorero: la lógica (qué se dice, cuándo se avisa, quién ve qué botón) se prueba de verdad en el módulo puro;
// la estructura de los componentes se fija con la fuente (el repo no tiene testing-library: no pinta).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  esTesorero, estadoRevision, exencionDe, faltaCheckParaValidar, insigniaConformidad, MOTIVO_FALTA_CHECK, puedeValidar, textoConformidad, textoEstadoRevision, TEXTO_VALIDAR_SIN_CHECK, vistaConformidad,
} from '../src/pages/admin/_parts/cobranza/conformidad';

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
    assert.match(textoConformidad(v!, fecha), /El tesorero aún no da su check/);
    assert.match(textoConformidad(v!, fecha), /no se puede validar hasta que lo dé/);
  });

  it('el block sin tesorero lo dice (en vez de esperar una conformidad que nadie dará)', () => {
    const v = vistaConformidad({ estado_validacion: 'por_validar', conformidad: null, tesorero_registrado: false });
    assert.deepEqual(v, { tipo: 'sin_tesorero' });
    assert.match(textoConformidad(v!, fecha), /El block no tiene tesorero registrado/);
    assert.match(textoConformidad(v!, fecha), /Puedes validar tú; quedará anotado/);
  });

  it('el pago del propio tesorero también lo dice: nadie puede darle el check y la administradora valida sola', () => {
    const v = vistaConformidad({ estado_validacion: 'por_validar', conformidad: null, tesorero_registrado: true, conformidad_exencion: 'pago_del_tesorero' });
    assert.deepEqual(v, { tipo: 'pago_del_tesorero' });
    assert.match(textoConformidad(v!, fecha), /lo registró el tesorero del block/);
  });

  it('el propio tesorero lee lo que le toca hacer, no «el tesorero aún no confirma»', () => {
    const t = textoConformidad({ tipo: 'falta' }, fecha, true);
    assert.match(t, /Aún no confirmaste/);
    assert.doesNotMatch(t, /El tesorero aún no/);
    assert.match(t, /sin tu check el pago no se valida/);
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

  it('al validar sin el check (sólo si nadie puede darlo) se repite el aviso y se dice que queda anotado', () => {
    assert.match(TEXTO_VALIDAR_SIN_CHECK, /sin el check del tesorero porque nadie puede darlo/);
    assert.match(TEXTO_VALIDAR_SIN_CHECK, /auditoría/);
  });
});

const BASE = { estado_validacion: 'por_validar' as const, tesorero_registrado: true };

describe('cuándo se bloquea Validar', () => {
  it('check exigido y pendiente → bloqueado, con el motivo del servidor', () => {
    assert.equal(faltaCheckParaValidar({ ...BASE, conformidad: null, conformidad_exencion: null }), true);
    assert.match(MOTIVO_FALTA_CHECK, /Falta el check del tesorero del block/);
  });

  it('con el check dado, o si nadie puede darlo (block sin tesorero o pago del propio tesorero) → no se bloquea', () => {
    assert.equal(faltaCheckParaValidar({ ...BASE, conformidad: DADA, conformidad_exencion: null }), false);
    assert.equal(faltaCheckParaValidar({ ...BASE, conformidad: null, conformidad_exencion: 'sin_tesorero' }), false);
    assert.equal(faltaCheckParaValidar({ ...BASE, conformidad: null, conformidad_exencion: 'pago_del_tesorero' }), false);
  });

  it('sin el dato del servidor no se inventa un bloqueo: la conformidad desconocida, o la exención desconocida, dejan el botón (el 409 manda)', () => {
    assert.equal(faltaCheckParaValidar({ ...BASE }), false, 'conformidad sin traer');
    assert.equal(faltaCheckParaValidar({ ...BASE, conformidad: null }), false, 'exención sin traer y con tesorero: lo decide el servidor');
    assert.equal(exencionDe({ tesorero_registrado: false }), 'sin_tesorero', 'sin tesorero se deduce aunque el servidor no mande la exención');
    assert.equal(faltaCheckParaValidar({ estado_validacion: 'por_validar', conformidad: null, tesorero_registrado: false }), false);
  });

  it('un pago ya revisado nunca se bloquea', () => {
    assert.equal(faltaCheckParaValidar({ estado_validacion: 'validado', conformidad: null, conformidad_exencion: null }), false);
  });
});

describe('estado por pago: Voucher · IA · Tesorero', () => {
  const ev = (estado: string, veredicto: string | null = null) => ({ estado, veredicto });
  const conVoucher = { comprobante: { nombre: 'v.png' } };

  it('voucher ✓, IA coincide, tesorero pendiente', () => {
    assert.equal(textoEstadoRevision({ ...BASE, ...conVoucher, conformidad: null, conformidad_exencion: null, evaluacion: ev('completada', 'coincide') }), 'Voucher ✓ · IA: coincide · Tesorero: pendiente');
  });

  it('la IA «duda» con cualquier veredicto que no sea coincide, y «no leído» si no hubo lectura', () => {
    for (const v of ['no_coincide', 'revisar', 'ilegible']) assert.equal(estadoRevision({ ...BASE, ...conVoucher, evaluacion: ev('completada', v) }).ia.label, 'duda', v);
    for (const e of ['error', 'no_disponible']) assert.equal(estadoRevision({ ...BASE, ...conVoucher, evaluacion: ev(e) }).ia.label, 'no leído', e);
    assert.equal(estadoRevision({ ...BASE, ...conVoucher, evaluacion: null }).ia.label, 'no leído');
    assert.equal(estadoRevision({ ...BASE, ...conVoucher, evaluacion: ev('pendiente') }).ia.label, 'evaluando…');
  });

  it('tesorero ✓ cuando dio el check; «no aplica» cuando nadie puede darlo; sin voucher dice «falta»', () => {
    assert.equal(estadoRevision({ ...BASE, ...conVoucher, conformidad: DADA }).tesorero.label, '✓');
    assert.equal(estadoRevision({ ...BASE, ...conVoucher, conformidad: null, conformidad_exencion: 'sin_tesorero' }).tesorero.label, 'no aplica');
    assert.equal(estadoRevision({ ...BASE, conformidad: null, conformidad_exencion: null }).voucher, 'falta');
    assert.equal(textoEstadoRevision({ ...BASE, ...conVoucher, conformidad: DADA, evaluacion: ev('completada', 'coincide') }), 'Voucher ✓ · IA: coincide · Tesorero: ✓');
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
    assert.match(modal, /Validar sin el check/);
    assert.match(modal, /validaSinCheck \? setConfirmandoSinCheck\(true\) : void revisar\('validado'\)/);
    assert.match(modal, /disabled=\{enviando !== null \|\| sinVoucher \|\| bloqueadoPorCheck\}/, 'Validar se deshabilita sin el check');
    assert.match(modal, /id="motivo-sin-check"/, 'y dice por qué');
    assert.match(modal, /aria-label="Estado de la revisión"/);
    assert.match(modal, /aria-label="Conformidad del tesorero"/);
  });

  it('la lista: insignia por fila, filtro «Conformidad del tesorero» que viaja como `conformidad` y texto de la junta', () => {
    assert.match(pagos, /insigniaConformidad\(p\)/);
    assert.match(pagos, /<EstadoRevision pago=\{p\} \/>/, 'la lista por validar muestra Voucher · IA · Tesorero');
    assert.match(pagos, /Validado por IA \+ tesorero/);
    assert.match(pagos, /conformidad: conformidad \|\| undefined/);
    assert.match(pagos, /label="Conformidad del tesorero"/);
    assert.match(pagos, /<option value="con">Con conformidad<\/option>/);
    assert.match(pagos, /<option value="sin">Sin conformidad<\/option>/);
    assert.match(pagos, /la administración valida el pago/);
    assert.doesNotMatch(pagos, /valida el pago si el dinero llegó/, 'el texto viejo (la junta valida) ya no está');
  });

  it('el interruptor de la validación automática explica la regla «IA + tesorero»', () => {
    const t = fuente('src/pages/admin/_parts/medios/ValidacionAutomaticaIA.tsx');
    assert.match(t, /y el tesorero del block da su check/);
    assert.match(t, /Si el block no tiene tesorero, o el pago lo registró el propio tesorero/);
    assert.match(t, /esa persona tampoco puede validar sin el check del tesorero/);
  });

  it('el detalle de mantenimiento de la administración pasa la conformidad al diálogo', () => {
    const m = fuente('src/pages/admin/_parts/mantenimientos/MantenimientoAdminModal.tsx');
    assert.match(m, /conformidad: p\.conformidad, tesorero_registrado: p\.tesorero_registrado/);
  });

  it('el asistente ya no dice que la junta valida y explica la conformidad del tesorero', () => {
    const p = fuente('src/config/ai-system-prompt.txt');
    assert.match(p, /La junta ya no valida ni rechaza pagos: lo hace la administración/);
    assert.match(p, /Confirmo que llegó a la cuenta/);
    assert.match(p, /Falta el check del tesorero del block/);
    assert.match(p, /la IA leyó que el voucher coincide y el tesorero dio su check/);
    assert.doesNotMatch(p, /el aviso no la frena/, 'ya no se dice que la falta de conformidad no frena a la administradora');
    assert.doesNotMatch(p, /la administradora o la junta lo validan/);
    assert.doesNotMatch(p, /y validan o rechazan pagos de su ámbito/);
  });
});
