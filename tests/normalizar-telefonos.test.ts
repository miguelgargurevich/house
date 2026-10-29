// scripts/normalizar-telefonos.ts: la lógica (simular no escribe, aplicar pasa a formato internacional, idempotente), la negativa a correr
// contra una base remota y una corrida en seco del script real sobre la base de pruebas.
import './helpers/env';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { esLocal, normalizarTelefonos } from '../scripts/normalizar-telefonos';
import { prisma, vaciarBase } from './helpers/app';

const exec = promisify(execFile);
const SCRIPT = 'scripts/normalizar-telefonos.ts';

describe('esLocal: sólo localhost, 127.0.0.1 y ::1', () => {
  it('reconoce la base local de pruebas y rechaza una remota o ausente', () => {
    assert.equal(esLocal('postgresql://postgres:house@localhost:5433/house_test_tel'), true);
    assert.equal(esLocal('postgresql://postgres:house@127.0.0.1:5433/house'), true);
    assert.equal(esLocal('postgresql://u:p@db.ejemplo.com:5432/house'), false);
    assert.equal(esLocal('postgresql://u:p@localhost.ejemplo.com/house'), false);
    assert.equal(esLocal(undefined), false);
    assert.equal(esLocal('no es una url'), false);
  });
});

describe('normalizarTelefonos: el campo guardado pasa a formato internacional', () => {
  // El script usa un cliente plano (como en su arranque); el de los tests tiene `omit` y no encaja en su tipo.
  const plano = new PrismaClient();
  let idPeruLegado = 0;
  let idChile = 0;
  let idBasura = 0;
  let idVacio = 0;

  before(async () => {
    await vaciarBase();
    idPeruLegado = (await prisma.empresaAdministradora.create({ data: { nombre: 'Legado', telefono: '987654321' }, select: { id: true } })).id;
    idChile = (await prisma.empresaAdministradora.create({ data: { nombre: 'Chile', telefono: '+56 9 6123 4567' }, select: { id: true } })).id;
    idBasura = (await prisma.empresaAdministradora.create({ data: { nombre: 'Basura', telefono: 'llamar a la oficina' }, select: { id: true } })).id;
    idVacio = (await prisma.empresaAdministradora.create({ data: { nombre: 'Vacío', telefono: '  ' }, select: { id: true } })).id;
  });

  after(async () => {
    await vaciarBase();
    await plano.$disconnect();
  });

  const telefonos = async () => Object.fromEntries((await prisma.empresaAdministradora.findMany({ select: { id: true, telefono: true } })).map((r) => [r.id, r.telefono]));

  it('simular cuenta lo que cambiaría y no escribe nada', async () => {
    const lineas: string[] = [];
    const r = await normalizarTelefonos(plano, false, (l) => lineas.push(l));
    assert.equal(r.revisados, 4);
    assert.equal(r.cambios, 2, 'el legado peruano y el vacío');
    assert.equal(r.escritos, 0);
    assert.deepEqual(r.sinInterpretar, [idBasura], 'lo que no es un teléfono se cuenta, no se toca');
    assert.ok(lineas.some((l) => l.startsWith('EmpresaAdministradora.telefono: 2 cambiarían')), lineas.join(' | '));
    const t = await telefonos();
    assert.equal(t[idPeruLegado], '987654321', 'simular no escribe');
    assert.equal(t[idVacio], '  ');
  });

  it('aplicar: sin prefijo es Perú; el internacional no cambia; el vacío pasa a null', async () => {
    const r = await normalizarTelefonos(plano, true);
    assert.equal(r.escritos, 2);
    const t = await telefonos();
    assert.equal(t[idPeruLegado], '+51 987 654 321');
    assert.equal(t[idChile], '+56 9 6123 4567');
    assert.equal(t[idBasura], 'llamar a la oficina');
    assert.equal(t[idVacio], null);
  });

  it('es idempotente: una segunda corrida no cambia nada', async () => {
    const r = await normalizarTelefonos(plano, true);
    assert.equal(r.cambios, 0);
    assert.equal(r.escritos, 0);
  });
});

describe('scripts/normalizar-telefonos.ts (proceso real)', () => {
  it('se niega a correr contra una base que no es local (sin --produccion) y no se conecta', async () => {
    const err = await exec(process.execPath, ['--import', 'tsx', SCRIPT], { env: { ...process.env, DATABASE_URL: 'postgresql://u:p@db.ejemplo.com:5432/house' } }).then(() => null, (e: { code: number; stderr: string }) => e);
    assert.ok(err, 'debe fallar');
    assert.equal(err.code, 1);
    assert.match(err.stderr, /no es una base local/);
  });

  it('en seco sobre la base de pruebas: avisa, cuenta y no escribe', async () => {
    await vaciarBase();
    const id = (await prisma.empresaAdministradora.create({ data: { nombre: 'Seco', telefono: '987654321' }, select: { id: true } })).id;
    const { stdout } = await exec(process.execPath, ['--import', 'tsx', SCRIPT], { env: process.env });
    assert.match(stdout, /Simulación \(no se escribió nada\): 1 de 1 cambiarían/);
    assert.equal((await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id } })).telefono, '987654321');
    await vaciarBase();
  });
});
