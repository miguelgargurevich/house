import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'prop1', string>;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), prop1: await login(base, 'prop1@test.pe') };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('Canales e integraciones: GET /api/llavero/whatsapp', () => {
  it('sólo el superadmin lo ve', async () => {
    for (const t of [T.adminA, T.prop1]) assert.equal((await llamar(base, 'GET', '/api/llavero/whatsapp', t)).status, 403);
  });

  it('por administradora: número vinculado, webhook y personas vinculadas, sin el nombre de la instancia ni datos de contacto', async () => {
    await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: 'instancia-secreta-a', whatsapp_token: 'token-secreto' } });
    await prisma.empresaAdministradora.update({ where: { id: d.empresaB.id }, data: { whatsapp_instance: null } });
    await prisma.canalWebhook.deleteMany();
    await prisma.canalWebhook.create({ data: { empresa_id: d.empresaA.id, instancia: 'instancia-secreta-a', url: 'https://house.test/api/canales/whatsapp/x', secreto_hash: 'f'.repeat(64), registrado_at: new Date() } });
    const r = await llamar(base, 'GET', '/api/llavero/whatsapp', T.super);
    assert.equal(r.status, 200);
    const a = r.body.empresas.find((e: { id: number }) => e.id === d.empresaA.id);
    const b = r.body.empresas.find((e: { id: number }) => e.id === d.empresaB.id);
    assert.deepEqual({ ...a, nombre: undefined }, { id: d.empresaA.id, nombre: undefined, numero_vinculado: true, bot_recibe: true, personas_vinculadas: 0 });
    assert.equal(b.numero_vinculado, false);
    assert.equal(b.bot_recibe, false);
    for (const secreto of ['instancia-secreta-a', 'token-secreto', 'f'.repeat(64)]) assert.ok(!r.texto.includes(secreto), `filtra ${secreto}`);
    assert.equal(typeof r.body.servidor.configurado, 'boolean');
  });
});
