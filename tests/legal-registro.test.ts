// Registro público y consentimiento (Ley 29733): sin aceptar los Términos y la Política no se crea nada; aceptando, la cuenta
// guarda la versión y la fecha en la misma transacción que la empresa (paso 1: la cuenta; el condominio se crea en el paso 2).
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, prisma, sembrar } from './helpers/app';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';
import { VERSION_LEGAL } from '../src/server/services/comercial/legal';
import { comercialDeps } from '../src/server/services/comercial/modulos';

const depsFalsas = (): DepsAvisos => ({
  ahora: () => comercialDeps.ahora(),
  env: { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'House <house@ejemplo.test>' },
  fetch: (async () => new Response('{}', { status: 200 })) as typeof fetch,
});
const depsOriginal = comercialCorreo.deps;

const registro = (over: Record<string, unknown> = {}) => ({
  nombre: 'Rosa Quispe', email: 'rosa@casa.pe', celular: '987 654 321', password: 'Cl4ve-segura-2026', ...over,
});

let base: string;
let cerrar: () => Promise<void>;

before(async () => { await sembrar(); });
beforeEach(async () => {
  comercialCorreo.deps = depsFalsas;
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { correo_superadmin: 'miguel@house.test', url_publica: 'https://house.ejemplo.test' } });
  ({ base, cerrar } = await iniciar({ rateLimits: { registroIp: 100, registroCorreo: 100 } }));
});
afterEach(async () => { comercialCorreo.deps = depsOriginal; await cerrar(); });
after(async () => { await prisma.$disconnect(); });

describe('registro: aceptar los Términos y la Política de privacidad', () => {
  for (const [nombre, valor] of [['no viene', undefined], ['viene en false', false], ['viene como texto «true»', 'true']] as const) {
    it(`si ${nombre} → 422 con el mensaje en español y no crea nada`, async () => {
      const r = await llamar(base, 'POST', '/api/publico/registro', null, registro({ acepta_terminos: valor }));
      assert.equal(r.status, 422, r.texto);
      assert.equal(r.body.campos.acepta_terminos, 'Debes aceptar los términos y la política de privacidad');
      assert.equal(await prisma.usuario.count({ where: { email: 'rosa@casa.pe' } }), 0);
      assert.equal(await prisma.empresaAdministradora.count({ where: { nombre: 'Rosa Quispe' } }), 0, 'la empresa provisional lleva el nombre de la persona');
    });
  }

  it('aceptando (true) guarda la versión vigente y la fecha de aceptación en el usuario', async () => {
    const antes = Date.now();
    const r = await llamar(base, 'POST', '/api/publico/registro', null, registro({ acepta_terminos: true }));
    assert.equal(r.status, 202, r.texto);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: 'rosa@casa.pe' } });
    assert.equal(u.terminos_version, VERSION_LEGAL);
    assert.ok(u.terminos_aceptados_at, 'hay fecha de aceptación');
    assert.ok(Math.abs(u.terminos_aceptados_at!.getTime() - antes) < 60_000, `fecha ${u.terminos_aceptados_at}`);
  });

  it('la versión la pone el servidor: lo que mande el cliente no la cambia', async () => {
    await llamar(base, 'POST', '/api/publico/registro', null, registro({ email: 'otra@casa.pe', acepta_terminos: true, terminos_version: '1999-01-01' }));
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: 'otra@casa.pe' } });
    assert.equal(u.terminos_version, VERSION_LEGAL);
  });
});
