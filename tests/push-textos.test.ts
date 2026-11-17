import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TIPOS, type DatosAviso, type TipoAviso } from '../src/server/services/avisos/plantillas';
import { TIPOS_CON_PUSH, esSeguro, recortar, rutaPush, textoPush, LARGO_MAXIMO_CUERPO, LARGO_MAXIMO_TITULO } from '../src/server/services/push/textos';

const datos = (extra: Partial<DatosAviso> = {}): DatosAviso => ({
  nombre: 'María Pérez', periodo: 'octubre de 2026', monto: 'S/ 1,350.50', vencimiento: '02/11/2026', vence: new Date(Date.UTC(2026, 10, 2)),
  concepto: 'Mantenimiento', motivo: 'El voucher es de otro banco y no se lee', condominio: 'Los Libertadores', dias: 2, bloque: 'Block 1',
  departamentos: [{ codigo: 'B01-804', torre: 'Block 1', monto: 'S/ 1,350.50' }], titulo: 'Corte de agua el sábado', texto: 'Cuerpo largo del comunicado', ...extra,
});

describe('push: textos sin datos sensibles', () => {
  it('cada tipo con push da título y cuerpo cortos, sin montos, nombres, motivos ni documentos', () => {
    for (const tipo of TIPOS_CON_PUSH) {
      const t = textoPush(tipo, datos({ central: false }));
      assert.ok(t, `${tipo} debe tener texto`);
      assert.ok(t.titulo.length <= LARGO_MAXIMO_TITULO && t.cuerpo.length <= LARGO_MAXIMO_CUERPO, `${tipo} largo`);
      const todo = `${t.titulo} ${t.cuerpo}`;
      assert.ok(!/S\/|1,350|350\.50/.test(todo), `${tipo} no debe llevar el monto: ${todo}`);
      assert.ok(!/María|Pérez/.test(todo), `${tipo} no debe llevar el nombre`);
      assert.ok(!/otro banco/.test(todo), `${tipo} no debe llevar el motivo del rechazo`);
      assert.ok(esSeguro(t.titulo) && esSeguro(t.cuerpo));
    }
  });

  it('pago_validado e ia_restablecida no se empujan; los demás tipos del catálogo, salvo esos dos, sí', () => {
    assert.equal(textoPush('pago_validado', datos()), null);
    assert.equal(textoPush('ia_restablecida', datos()), null);
    const sin = TIPOS.filter((t: TipoAviso) => !TIPOS_CON_PUSH.has(t));
    assert.deepEqual([...sin].sort(), ['ia_restablecida', 'pago_validado']);
  });

  it('el recibo emitido dice el periodo y la fecha de vencimiento', () => {
    const t = textoPush('recibo_emitido', datos())!;
    assert.match(t.titulo, /octubre de 2026/);
    assert.match(t.cuerpo, /lunes 2 de noviembre/);
  });

  it('por_vencer dice cuándo vence', () => {
    assert.match(textoPush('por_vencer', datos({ dias: 2 }))!.titulo, /en 2 días/);
    assert.match(textoPush('por_vencer', datos({ dias: 1 }))!.titulo, /mañana/);
  });

  it('un comunicado con título normal lo muestra; con un monto o un documento, sólo dice que hay un comunicado', () => {
    assert.equal(textoPush('comunicado', datos({ titulo: 'Corte de agua el sábado' }))!.cuerpo, 'Corte de agua el sábado');
    for (const malo of ['Cuota extraordinaria S/ 50', 'Cobro de 120 soles', 'Deposita a la cuenta 12345678901', 'Total US$ 80', 'Pago $ 15']) {
      const t = textoPush('comunicado', datos({ titulo: malo }))!;
      assert.equal(t.cuerpo, 'Tu administración publicó un comunicado. Ábrelo en Torre.', malo);
    }
  });

  it('un título largo de comunicado se recorta con «…»', () => {
    const t = textoPush('comunicado', datos({ titulo: 'a'.repeat(300) }))!;
    assert.equal(t.cuerpo.length, LARGO_MAXIMO_CUERPO);
    assert.ok(t.cuerpo.endsWith('…'));
  });

  it('el cierre central y el del block dicen cosas distintas', () => {
    assert.match(textoPush('cierre_pendiente', datos({ central: true }))!.titulo, /Junta central/);
    assert.match(textoPush('cierre_pendiente', datos({ central: false }))!.cuerpo, /^Block 1: registra/);
  });

  it('la red de seguridad: un periodo con un número largo hace que el aviso no salga', () => {
    assert.equal(textoPush('recibo_emitido', datos({ periodo: 'periodo 12345678' })), null);
  });

  it('esSeguro y recortar', () => {
    assert.equal(esSeguro('Tu recibo de octubre de 2026'), true);
    assert.equal(esSeguro('DNI 45678912'), false);
    assert.equal(esSeguro('S/ 20'), false);
    assert.equal(esSeguro('1,234.50'), false);
    assert.equal(recortar('corto', 10), 'corto');
    assert.equal(recortar('abcdefghij', 5), 'abcd…');
  });

  it('la ruta interna es la del correo según el rol, y el inicio si no hay una', () => {
    assert.equal(rutaPush('recibo_emitido', 'propietario', 'recibo'), '/propietario/cargos');
    assert.equal(rutaPush('pago_rechazado', 'inquilino', 'pago'), '/inquilino/pagos');
    assert.equal(rutaPush('comunicado', 'propietario', 'comunicado'), '/propietario/comunicados');
    assert.equal(rutaPush('cierre_pendiente', 'propietario', 'cierre:2026-10'), '/junta/cierre');
    assert.equal(rutaPush('cierre_pendiente', 'propietario', 'cierre-central:2026-10'), '/junta/cierre-central');
    assert.equal(rutaPush('ia_caida', 'superadmin', 'ia'), '/superadmin/llavero');
    assert.equal(rutaPush('recibo_emitido', 'admin', 'recibo'), '/'); // el admin no tiene «cargos»: cae en su inicio
    for (const t of TIPOS_CON_PUSH) {
      const r = rutaPush(t, 'propietario', null);
      assert.ok(r.startsWith('/') && !r.startsWith('//'), `${t}: ${r}`);
    }
  });
});
