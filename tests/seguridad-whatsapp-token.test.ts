import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';

const TOKEN = 'tok-whatsapp-que-no-debe-salir-0123456789';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;

before(async () => {
  d = await sembrar();
  await prisma.empresaAdministradora.update({ where: { id: d.empresaA.id }, data: { whatsapp_instance: `house_empresa_${d.empresaA.id}`, whatsapp_token: TOKEN } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('el token de la instancia de WhatsApp nunca sale por la API', () => {
  it('GET /api/empresas y /api/empresas/:id (admin y superadmin) no traen whatsapp_token', async () => {
    for (const email of ['admin.a@test.pe', 'super@test.pe']) {
      const t = await login(base, email);
      const lista = await llamar(base, 'GET', '/api/empresas', t);
      assert.equal(lista.status, 200);
      const una = await llamar(base, 'GET', `/api/empresas/${d.empresaA.id}`, t);
      assert.equal(una.status, 200);
      for (const r of [lista, una]) {
        assert.ok(!r.texto.includes(TOKEN), `${email}: el token salió en la respuesta`);
        assert.ok(!r.texto.includes('whatsapp_token'), `${email}: el campo whatsapp_token salió en la respuesta`);
      }
    }
  });

  it('editar la empresa (PUT) tampoco lo devuelve', async () => {
    const t = await login(base, 'admin.a@test.pe');
    const r = await llamar(base, 'PUT', `/api/empresas/${d.empresaA.id}`, t, { nombre: 'Empresa A' });
    assert.equal(r.status, 200, r.texto);
    assert.ok(!r.texto.includes(TOKEN) && !r.texto.includes('whatsapp_token'));
  });
});
