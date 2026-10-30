// Datos del responsable para la Política de privacidad y los Términos (Ley 29733): el endpoint público sólo expone esos datos y el
// superadmin los valida al guardarlos (RUC de 11 dígitos, correo válido; vacío = «por confirmar»).
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar } from './helpers/app';
import { VERSION_LEGAL } from '../src/server/services/comercial/legal';

let base: string;
let cerrar: () => Promise<void>;
let superadmin: string;

before(async () => {
  await sembrar();
  ({ base, cerrar } = await iniciar());
  superadmin = await login(base, 'super@test.pe');
});
after(async () => { await cerrar(); await prisma.$disconnect(); });

beforeEach(async () => {
  await prisma.configuracionComercial.update({
    where: { id: 1 },
    data: { correo_superadmin: 'miguel@house.test', url_publica: 'https://house.ejemplo.test', legal_razon_social: null, legal_ruc: null, legal_domicilio: null, legal_correo: null },
  });
});

const LEGAL = { legal_razon_social: 'House Perú S.A.C.', legal_ruc: '20601234567', legal_domicilio: 'Av. Ejemplo 123, Surco, Lima', legal_correo: 'privacidad@house.test' };

describe('GET /api/publico/legal (sin sesión)', () => {
  it('devuelve SOLO razón social, RUC, domicilio, correo y versión: las mismas claves, nada más de la configuración', async () => {
    const r = await llamar(base, 'GET', '/api/publico/legal', null);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(Object.keys(r.body).sort(), ['correo', 'domicilio', 'razon_social', 'ruc', 'version']);
    assert.equal(r.body.version, VERSION_LEGAL);
  });

  it('sin datos cargados, cada dato sale como null (la página dice «por confirmar»)', async () => {
    const r = await llamar(base, 'GET', '/api/publico/legal', null);
    assert.deepEqual(r.body, { razon_social: null, ruc: null, domicilio: null, correo: null, version: VERSION_LEGAL });
  });

  it('con datos cargados los devuelve, y nunca el correo del superadmin ni datos de pago', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { ...LEGAL, pago_banco: 'BCP', pago_cuenta: '191-0000000-0-00', pago_yape: '999 888 777' } });
    const r = await llamar(base, 'GET', '/api/publico/legal', null);
    assert.deepEqual(r.body, { razon_social: 'House Perú S.A.C.', ruc: '20601234567', domicilio: 'Av. Ejemplo 123, Surco, Lima', correo: 'privacidad@house.test', version: VERSION_LEGAL });
    assert.doesNotMatch(r.texto, /miguel@house\.test/);
    assert.doesNotMatch(r.texto, /191-0000000|999 888 777|BCP/);
  });
});

describe('PUT /api/comercial/configuracion: datos legales validados', () => {
  it('guarda un RUC de 11 dígitos, un correo válido y un domicilio', async () => {
    const r = await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, LEGAL);
    assert.equal(r.status, 200, r.texto);
    const c = await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } });
    assert.equal(c.legal_ruc, '20601234567');
    assert.equal(c.legal_correo, 'privacidad@house.test');
  });

  it('un RUC que no tiene 11 dígitos → 422 y no guarda nada', async () => {
    for (const ruc of ['2060123456', '206012345678', '2060123456A', '20-6012345']) {
      const r = await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { legal_ruc: ruc });
      assert.equal(r.status, 422, `${ruc}: ${r.texto}`);
      assert.equal(r.body.campos.legal_ruc, 'El RUC tiene 11 dígitos');
    }
    assert.equal((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).legal_ruc, null);
  });

  it('un correo que no es correo → 422', async () => {
    const r = await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { legal_correo: 'no-es-correo' });
    assert.equal(r.status, 422);
    assert.equal(r.body.campos.legal_correo, 'Correo inválido');
  });

  it('un campo vacío se guarda como null («por confirmar»), no como texto vacío', async () => {
    await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, LEGAL);
    const r = await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, { legal_ruc: '', legal_correo: '', legal_domicilio: '   ' });
    assert.equal(r.status, 200, r.texto);
    const c = await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } });
    assert.equal(c.legal_ruc, null);
    assert.equal(c.legal_correo, null);
    assert.equal(c.legal_domicilio, null);
  });

  it('la auditoría anota qué campos cambiaron, no sus valores', async () => {
    await llamar(base, 'PUT', '/api/comercial/configuracion', superadmin, LEGAL);
    const a = await prisma.auditoria.findFirst({ where: { entidad: 'configuracion_comercial' }, orderBy: { id: 'desc' } });
    assert.ok(JSON.stringify(a!.detalle).includes('legal_ruc'));
    assert.ok(!JSON.stringify(a!.detalle).includes('20601234567'));
  });
});
