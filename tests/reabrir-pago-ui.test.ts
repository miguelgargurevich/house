// Pantalla de «Volver a revisar» un pago rechazado: las reglas (quién lo ve, el motivo, lo que se le dice a la administración) se prueban de verdad en el módulo puro;
// la estructura de los componentes se fija con la fuente (el repo no tiene testing-library: no pinta).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { errorMotivoReapertura, MOTIVO_REAPERTURA_MAX, MOTIVO_REAPERTURA_MIN, puedeReabrir, textoReabrir } from '../src/pages/admin/_parts/cobranza/reabrir';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const usuario = (rol: string, extra: Record<string, unknown> = {}) => ({ rol, cargo_junta: null, ...extra }) as unknown as Parameters<typeof puedeReabrir>[0];
const MANUAL = JSON.parse(fuente('docs/manual/manual-house.json')) as { kicker: string; secciones: { titulo: string }[] };

describe('quién ve «Volver a revisar»', () => {
  it('la administración y el superadmin, sólo en un pago rechazado', () => {
    for (const rol of ['admin', 'superadmin']) {
      assert.equal(puedeReabrir(usuario(rol), 'rechazado'), true, rol);
      for (const estado of ['por_validar', 'validado', 'anulado']) assert.equal(puedeReabrir(usuario(rol), estado), false, `${rol} ${estado}`);
    }
  });

  it('la junta (presidente, tesorero), el vecino y el personal nunca', () => {
    for (const u of [usuario('propietario', { cargo_junta: 'tesorero' }), usuario('propietario', { cargo_junta: 'presidente' }), usuario('propietario'), usuario('inquilino'), usuario('seguridad'), null, undefined]) {
      assert.equal(puedeReabrir(u as never, 'rechazado'), false, JSON.stringify(u));
    }
  });
});

describe('el motivo y el efecto', () => {
  it('de 5 a 200 caracteres sin contar los espacios de las puntas', () => {
    assert.equal(MOTIVO_REAPERTURA_MIN, 5);
    assert.equal(MOTIVO_REAPERTURA_MAX, 200);
    assert.match(errorMotivoReapertura('')!, /al menos 5 caracteres/);
    assert.match(errorMotivoReapertura('  abc  ')!, /al menos 5 caracteres/);
    assert.equal(errorMotivoReapertura('Lo rechacé por error, el abono sí llegó'), undefined);
    assert.equal(errorMotivoReapertura('x'.repeat(200)), undefined);
    assert.match(errorMotivoReapertura('x'.repeat(201))!, /hasta 200 caracteres/);
  });

  it('una línea de efecto: vuelve a Por validar y el recibo queda en revisión', () => {
    assert.equal(textoReabrir('B01-101'), 'El pago vuelve a Por validar y el recibo de B01-101 queda en revisión.');
    assert.match(textoReabrir(undefined), /^El pago vuelve a Por validar y el recibo queda en revisión\.$/);
  });
});

describe('estructura de las pantallas', () => {
  it('el detalle ofrece «Volver a revisar» sólo si puedeReabrir, apagado y explicado si el servidor dice que no', () => {
    const f = fuente('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx');
    assert.match(f, /puedeReabrir\(user, pago\.estado_validacion\)/);
    assert.match(f, /useReapertura\(pago\?\.id \?\? null, ofreceReabrir\)/);
    assert.match(f, /variant="secondary"[^\n]*ArrowUturnLeftIcon[^\n]*disabled=\{reapertura\.reapertura\?\.puede !== true\}[^\n]*>Volver a revisar<\/Button>/);
    assert.match(f, /reapertura\.reapertura\.motivo/, 'el motivo por el que no se puede se ve');
    assert.match(f, /aria-describedby=\{[^}]*'motivo-no-reabrir'/);
    assert.match(f, /<ReabrirPagoModal/);
    assert.match(f, /onReabierto=\{\(\) => \{ onClose\(\); onRevisado\(\); onReabierto\?\.\(\); \}\}/);
  });

  it('Pagos: al reabrir pasa a la pestaña «Por validar»', () => {
    assert.match(fuente('src/pages/admin/Pagos.tsx'), /onReabierto=\{\(\) => setPestana\('por_validar'\)\}/);
  });

  it('la confirmación pide el motivo (contador y ejemplo), dice el efecto y tiene «Volver a revisar» y «Cancelar»', () => {
    const f = fuente('src/pages/admin/_parts/cobranza/ReabrirPagoModal.tsx');
    assert.match(f, /title="Volver a revisar"/);
    assert.match(f, /label="Motivo"/);
    assert.match(f, /Ejemplo: Lo rechacé por error, el abono sí llegó/);
    assert.match(f, /\{motivo\.length\}\/\{MOTIVO_REAPERTURA_MAX\}/);
    assert.match(f, /textoReabrir\(codigo\)/);
    assert.match(f, /ArrowUturnLeftIcon[^\n]*>Volver a revisar<\/Button>/);
    assert.match(f, />Cancelar<\/Button>/);
    assert.match(f, /`\/api\/pagos\/\$\{pagoId\}\/reabrir`/);
    assert.match(f, /toast\.ok\(/);
    assert.match(f, /errorMotivoReapertura\(motivo\)/);
    assert.doesNotMatch(f, /\p{Extended_Pictographic}/u, 'sin emojis');
  });

  it('el hook pregunta al servidor sólo cuando el pago es rechazado y quien lo ve puede reabrir', () => {
    const f = fuente('src/pages/admin/_parts/cobranza/useReapertura.ts');
    assert.match(f, /activo && pagoId != null \? `\/api\/pagos\/\$\{pagoId\}\/reapertura` : null/);
  });
});

describe('el manual', () => {
  const n = (re: RegExp) => MANUAL.secciones.findIndex(x => re.test(x.titulo)) + 1;
  it('trae «Volver a revisar un pago rechazado» justo después de «Anular un pago ya validado», versión 15', () => {
    assert.equal(n(/^Volver a revisar un pago rechazado$/), n(/^Anular un pago ya validado$/) + 1);
    const t = JSON.stringify(MANUAL.secciones[n(/^Volver a revisar un pago rechazado$/) - 1]);
    for (const frase of ['Rechazados', 'Volver a revisar', 'motivo', 'Por validar', 'auditoría', 'otro voucher']) assert.match(t, new RegExp(frase), frase);
    assert.match(MANUAL.kicker, /\(15\)$/);
  });
});
