// Pantalla de «Anular pago»: las reglas (quién lo ve, el motivo, lo que se le dice a la administración) se prueban de verdad en el módulo puro;
// la estructura de los componentes se fija con la fuente (el repo no tiene testing-library: no pinta).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { errorMotivoAnulacion, MOTIVO_ANULACION_MAX, MOTIVO_ANULACION_MIN, puedeAnular, textoAnular } from '../src/pages/admin/_parts/cobranza/anular';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const usuario = (rol: string, extra: Record<string, unknown> = {}) => ({ rol, cargo_junta: null, ...extra }) as unknown as Parameters<typeof puedeAnular>[0];

describe('quién ve «Anular pago»', () => {
  it('la administración y el superadmin, sólo en un pago validado', () => {
    for (const rol of ['admin', 'superadmin']) {
      assert.equal(puedeAnular(usuario(rol), 'validado'), true, rol);
      for (const estado of ['por_validar', 'rechazado', 'anulado']) assert.equal(puedeAnular(usuario(rol), estado), false, `${rol} ${estado}`);
    }
  });

  it('la junta (presidente, tesorero), el vecino y el personal nunca', () => {
    for (const u of [usuario('propietario', { cargo_junta: 'tesorero' }), usuario('propietario', { cargo_junta: 'presidente' }), usuario('propietario'), usuario('inquilino'), usuario('seguridad'), null, undefined]) {
      assert.equal(puedeAnular(u as never, 'validado'), false, JSON.stringify(u));
    }
  });
});

describe('el motivo', () => {
  it('de 5 a 200 caracteres sin contar los espacios de las puntas', () => {
    assert.equal(MOTIVO_ANULACION_MIN, 5);
    assert.equal(MOTIVO_ANULACION_MAX, 200);
    assert.match(errorMotivoAnulacion('')!, /al menos 5 caracteres/);
    assert.match(errorMotivoAnulacion('  abc  ')!, /al menos 5 caracteres/);
    assert.equal(errorMotivoAnulacion('Pago duplicado'), undefined);
    assert.equal(errorMotivoAnulacion('  12345  '), undefined);
    assert.equal(errorMotivoAnulacion('x'.repeat(200)), undefined);
    assert.match(errorMotivoAnulacion('x'.repeat(201))!, /hasta 200 caracteres/);
  });

  it('lo que se dice antes de confirmar: el recibo vuelve a pendiente y el vecino recibe un aviso', () => {
    const t = textoAnular('B01-101');
    assert.match(t, /El recibo de B01-101 vuelve a quedar pendiente/);
    assert.match(t, /el vecino recibe un aviso/);
    assert.match(textoAnular(undefined), /^El recibo vuelve a quedar pendiente/);
  });
});

describe('estructura de las pantallas', () => {
  it('Pagos: pestaña «Anulados» junto a Por validar, Validados y Rechazados, con quién, cuándo y el motivo', () => {
    const f = fuente('src/pages/admin/Pagos.tsx');
    assert.match(f, /type Pestana = 'por_validar' \| 'validado' \| 'rechazado' \| 'anulado'/);
    assert.match(f, /\{ id: 'anulado', label: 'Anulados' \}/);
    assert.match(f, /No hay pagos anulados/);
    assert.match(f, /anulado_por\.nombre/);
    assert.match(f, /motivo_anulacion/);
    assert.match(f, /anulado_at/);
  });

  it('el detalle ofrece «Anular pago» sólo si puedeAnular, y muestra el pago ya anulado sin recargar', () => {
    const f = fuente('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx');
    assert.match(f, /puedeAnular\(user, estadoPago \?\? pago\.estado_validacion\)/);
    assert.match(f, /variant="secondary"[^\n]*border-bad[^\n]*NoSymbolIcon[^\n]*>Anular pago<\/Button>/);
    assert.match(f, /<AnularPagoModal/);
    assert.match(f, /onAnulado=\{r => \{ setAnulado\(\{ \.\.\.r, id: pago\.id \}\); onRevisado\(\); \}\}/, 'recarga la lista y el detalle');
    assert.match(f, /Pago anulado\{pago\.anulado_at/);
  });

  it('la confirmación pide el motivo (contador y ejemplo), explica qué pasa y tiene «Anular» y «Cancelar»', () => {
    const f = fuente('src/pages/admin/_parts/cobranza/AnularPagoModal.tsx');
    assert.match(f, /title="Anular pago"/);
    assert.match(f, /label="Motivo"/);
    assert.match(f, /Ejemplo: Pago duplicado/);
    assert.match(f, /\{motivo\.length\}\/\{MOTIVO_ANULACION_MAX\}/);
    assert.match(f, /textoAnular\(codigo\)/);
    assert.match(f, /variant="danger"[^\n]*>Anular<\/Button>/);
    assert.match(f, />Cancelar<\/Button>/);
    assert.match(f, /`\/api\/pagos\/\$\{pagoId\}\/anular`/);
    assert.match(f, /toast\.ok\(/);
    assert.match(f, /errorMotivoAnulacion\(motivo\)/);
    assert.doesNotMatch(f, /\p{Extended_Pictographic}/u, 'sin emojis');
  });

  it('el pago anulado se ve como anulado (insignia, estado de cuenta, vecino y mantenimiento), nunca como validado', () => {
    assert.match(fuente('src/ui/Badge.tsx'), /anulado: \{ tone: 'neutral', label: 'Anulado' \}/);
    assert.match(fuente('src/pages/shared/estado-cuenta/tipos.ts'), /anulado: 'Anulado \(no suma\)'/);
    assert.match(fuente('src/pages/shared/estado-cuenta/EstadoCuentaHoja.tsx'), /pagos_anulados > 0/);
    const v = fuente('src/pages/residente/_parts/PagosResidente.tsx');
    assert.match(v, /Pago anulado por la administración/);
    assert.match(v, /La administración anuló este pago/);
    assert.match(fuente('src/pages/shared/mantenimiento/Desglose.tsx'), /p\.estado_validacion === 'anulado'/);
    assert.match(fuente('src/pages/admin/_parts/avisos/EnviosTab.tsx'), /pago_anulado: 'Pago anulado'/);
  });

  it('la junta usa la misma pantalla pero no ve el botón: la pestaña es de lectura', () => {
    assert.match(fuente('src/App.tsx'), /\/junta\/pagos" element=\{<AdminPagos \/>\}/);
    assert.match(fuente('src/pages/admin/_parts/cobranza/anular.ts'), /puedeValidar\(user\) && estado === 'validado'/);
  });
});
