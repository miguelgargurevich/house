// «Mi junta»: GET /api/me/juntas. El vecino (propietario o inquilino) ve la junta VIGENTE de su block y la Junta central, sólo lectura,
// y NUNCA la de otro block, ni la de otro condominio, ni una gestión cerrada, ni el correo o el celular personal de un miembro.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number };
let e2: { id: number };
let eB: { id: number };
let U: Record<string, number>;
let T: Record<'super' | 'adminA' | 'prop1' | 'prop2' | 'inq1' | 'propB' | 'mtto' | 'seg' | 'ana', string>;

const llama = (t: string | null, ruta = '/api/me/juntas') => llamar(base, 'GET', ruta, t);
const desde = new Date('2026-01-01T00:00:00.000Z');

type Cuenta = Record<string, unknown>;
type Item = { ambito: { complejo: { id: number; nombre: string }; estructura: { id: number; nombre: string | null; tipo: string } | null }; junta: null | { desde: string; correo: string | null; miembros: { cargo: string; nombre: string; departamentos: string[] }[]; cuentas: Cuenta[] } };
const itemsDe = (r: { body: unknown }) => (r.body as { items: Item[] }).items;
const nombres = (items: Item[]) => items.map((i) => i.ambito.estructura?.nombre ?? 'Junta central');

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  eB = await prisma.estructura.create({ data: { nombre: 'Block B', tipo: 'Block', complejo_id: d.complejoB.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } }); // prop1 e inq1
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } }); // prop2
  await prisma.unidad.update({ where: { id: d.unidadB1.id }, data: { estructura_id: eB.id } }); // propB
  const hash = await bcrypt.hash(PASSWORD, 4);
  const propietario = async (clave: string, nombre: string, codigo: string, complejo: { id: number }, empresa: { id: number }, estructura_id: number) => {
    const u = await prisma.usuario.create({ data: { nombre, email: `${clave}@test.pe`, telefono: '+51 987 654 321', rol: 'propietario', password_hash: hash, empresa_id: empresa.id, complejo_id: complejo.id } });
    await prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: complejo.id, empresa_id: empresa.id, estructura_id, propietario_id: u.id, estado: 'activa' } });
    return u.id;
  };
  U = {
    ana: await propietario('ana', 'Ana Presidenta', 'B01-201', d.complejoA, d.empresaA, e1.id),
    beto: await propietario('beto', 'Beto Tesorero', 'B01-202', d.complejoA, d.empresaA, e1.id),
    carla: await propietario('carla', 'Carla Secretaria', 'B01-203', d.complejoA, d.empresaA, e1.id),
    dario: await propietario('dario', 'Darío Vocal', 'B01-204', d.complejoA, d.empresaA, e1.id),
    eva: await propietario('eva', 'Eva del Block 2', 'B02-201', d.complejoA, d.empresaA, e2.id),
    otra: await propietario('otra', 'Olga del Block B', 'BB-201', d.complejoB, d.empresaB, eB.id),
    central: await propietario('central', 'Celia de la Central', 'B01-301', d.complejoA, d.empresaA, e1.id),
  };
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const sesion = (email: string) => login(base, email);
  T = {
    super: await sesion('super@test.pe'), adminA: await sesion('admin.a@test.pe'), prop1: await sesion('prop1@test.pe'), prop2: await sesion('prop2@test.pe'),
    inq1: await sesion('inq1@test.pe'), propB: await sesion('propb@test.pe'), mtto: await sesion('mtto.a@test.pe'), seg: await sesion('seg.a@test.pe'), ana: await sesion('ana@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

/** Una junta (vigente por defecto) con sus miembros y, si se pide, una cuenta por cada `cuentas`. */
async function junta(ambito: { complejo: { id: number }; estructura: { id: number } | null }, miembros: [string, string][], extra: { hasta?: Date; correo?: string; cuentas?: { titular: string; activo?: boolean; qr?: boolean }[] } = {}) {
  const j = await prisma.juntaDirectiva.create({
    data: {
      complejo_id: ambito.complejo.id, estructura_id: ambito.estructura?.id ?? null, desde, hasta: extra.hasta ?? null, correo: extra.correo ?? null,
      miembros: { create: miembros.map(([u, cargo]) => ({ usuario_id: U[u]!, cargo })) },
    },
  });
  for (const c of extra.cuentas ?? []) {
    await prisma.medioPago.create({
      data: {
        complejo_id: ambito.complejo.id, estructura_id: ambito.estructura?.id ?? null, junta_id: j.id, tipo: 'banco', banco: 'BCP', tipo_cuenta: 'ahorros',
        numero_cuenta: '19412345678901', cci: '00219400123456789012', documento_titular: '45678912', titular: c.titular, activo: c.activo ?? true,
        ...(c.qr ? { qr_nombre: 'qr.png', qr_tipo_mime: 'image/png', qr_datos: Buffer.from('qr-secreto') } : {}),
      },
    });
  }
  return j;
}

async function limpiar() {
  await prisma.medioPago.deleteMany();
  await prisma.juntaDirectiva.deleteMany(); // los miembros se van por cascada
  await prisma.unidad.deleteMany({ where: { codigo: { startsWith: 'EXTRA-' } } });
}

/** Deja las cuatro juntas de la prueba: Block 1 (vigente), Block 2 (vigente), Block B (de otro condominio) y la Junta central del condominio A. */
async function sembrarJuntas() {
  await junta({ complejo: d.complejoA, estructura: e1 }, [['dario', 'vocal'], ['carla', 'secretario'], ['beto', 'tesorero'], ['ana', 'presidente']], { correo: 'junta.b1@ejemplo.test', cuentas: [{ titular: 'Junta Block 1', qr: true }] });
  await junta({ complejo: d.complejoA, estructura: e2 }, [['eva', 'presidente']], { correo: 'junta.b2@ejemplo.test', cuentas: [{ titular: 'Junta Block 2' }] });
  await junta({ complejo: d.complejoB, estructura: eB }, [['otra', 'presidente']], { correo: 'junta.bb@ejemplo.test', cuentas: [{ titular: 'Junta Block B' }] });
  await junta({ complejo: d.complejoA, estructura: null }, [['central', 'presidente']], { correo: 'central@ejemplo.test', cuentas: [{ titular: 'Junta Central' }] });
}

describe('GET /api/me/juntas: la junta de mi block y la Junta central', () => {
  beforeEach(limpiar);

  it('el propietario ve la de SU block y la central, el block primero; miembros presidente → tesorero → secretario → vocal con su departamento', async () => {
    await sembrarJuntas();
    const r = await llama(T.prop1);
    assert.equal(r.status, 200, r.texto);
    const items = itemsDe(r);
    assert.deepEqual(nombres(items), ['Block 1', 'Junta central']);
    const b1 = items[0]!;
    assert.equal(b1.ambito.complejo.id, d.complejoA.id);
    assert.equal(b1.junta?.desde, '2026-01-01');
    assert.equal(b1.junta?.correo, 'junta.b1@ejemplo.test');
    assert.deepEqual(b1.junta?.miembros.map((m) => [m.cargo, m.nombre, m.departamentos]), [
      ['presidente', 'Ana Presidenta', ['B01-201']],
      ['tesorero', 'Beto Tesorero', ['B01-202']],
      ['secretario', 'Carla Secretaria', ['B01-203']],
      ['vocal', 'Darío Vocal', ['B01-204']],
    ]);
    assert.deepEqual(b1.junta?.cuentas.map((c) => [c.titular, c.entidad, c.numero_cuenta, c.cci, c.tiene_qr]), [['Junta Block 1', 'BCP', '19412345678901', '00219400123456789012', true]]);
    const central = items[1]!;
    assert.equal(central.ambito.estructura, null);
    assert.equal(central.junta?.correo, 'central@ejemplo.test');
    assert.deepEqual(central.junta?.miembros.map((m) => m.nombre), ['Celia de la Central']);
  });

  it('NO ve la junta de otro block del mismo condominio ni la de otro condominio (ni sus miembros, correos o cuentas)', async () => {
    await sembrarJuntas();
    const r = await llama(T.prop1);
    assert.deepEqual(nombres(itemsDe(r)), ['Block 1', 'Junta central']);
    for (const ajeno of ['Block 2', 'Block B', 'Eva del Block 2', 'Olga del Block B', 'junta.b2@ejemplo.test', 'junta.bb@ejemplo.test', 'Junta Block 2', 'Junta Block B', 'Complejo B']) {
      assert.ok(!r.texto.includes(ajeno), `se coló «${ajeno}»`);
    }
    // Y al revés: el de otro condominio sólo ve lo suyo.
    const rB = await llama(T.propB);
    assert.deepEqual(nombres(itemsDe(rB)), ['Block B']);
    assert.ok(!rB.texto.includes('Ana Presidenta') && !rB.texto.includes('Celia de la Central'));
  });

  it('nunca aparece el correo ni el celular personal de un miembro, ni ids de usuario, documentos ni bytes del QR', async () => {
    await sembrarJuntas();
    const r = await llama(T.prop1);
    for (const secreto of ['@test.pe', '987 654 321', '45678912', 'qr-secreto', 'usuario_id', '"email"', '"telefono"', 'documento_titular', 'creado_por_id', 'qr_datos', 'password']) {
      assert.ok(!r.texto.includes(secreto), `se coló «${secreto}»`);
    }
    for (const j of itemsDe(r).flatMap((i) => (i.junta ? [i.junta] : []))) {
      for (const m of j.miembros) assert.deepEqual(Object.keys(m).sort(), ['cargo', 'departamentos', 'nombre']);
    }
  });

  it('el inquilino lo ve igual que el propietario de su unidad (por inquilino_id)', async () => {
    await sembrarJuntas();
    const p = await llama(T.prop1);
    const i = await llama(T.inq1);
    assert.equal(i.status, 200, i.texto);
    assert.deepEqual(itemsDe(i), itemsDe(p));
    assert.deepEqual(nombres(itemsDe(i)), ['Block 1', 'Junta central']);
    assert.ok(!i.texto.includes('Block 2'));
  });

  it('una gestión cerrada no sale: sólo la vigente; un block cuya única junta está cerrada aparece «sin junta»', async () => {
    await sembrarJuntas();
    await junta({ complejo: d.complejoA, estructura: e1 }, [['eva', 'presidente']], { hasta: new Date('2025-12-31T00:00:00.000Z'), correo: 'vieja.b1@ejemplo.test', cuentas: [{ titular: 'Cuenta vieja' }] });
    await prisma.juntaDirectiva.updateMany({ where: { estructura_id: e2.id }, data: { hasta: new Date('2026-02-01T00:00:00.000Z') } }); // el block 2 se queda sin vigente
    const r1 = await llama(T.prop1);
    assert.ok(!r1.texto.includes('vieja.b1@ejemplo.test') && !r1.texto.includes('Cuenta vieja'));
    assert.deepEqual(itemsDe(r1)[0]!.junta?.miembros.map((m) => m.nombre), ['Ana Presidenta', 'Beto Tesorero', 'Carla Secretaria', 'Darío Vocal']);
    const r2 = await llama(T.prop2);
    assert.deepEqual(nombres(itemsDe(r2)), ['Block 2', 'Junta central']);
    assert.equal(itemsDe(r2)[0]!.junta, null);
    assert.ok(!r2.texto.includes('Eva del Block 2') && !r2.texto.includes('junta.b2@ejemplo.test'));
  });

  it('un block sin junta sale como «sin junta» (sólo su nombre) y sin Junta central no aparece nada de ella', async () => {
    const r = await llama(T.prop2);
    assert.equal(r.status, 200, r.texto);
    assert.deepEqual(itemsDe(r), [{ ambito: { complejo: { id: d.complejoA.id, nombre: 'Complejo A' }, estructura: { id: e2.id, nombre: 'Block 2', tipo: 'Block' } }, junta: null }]);
  });

  it('quien tiene unidades en dos blocks ve las dos juntas, y de cada miembro sólo sus departamentos de ESE block', async () => {
    await sembrarJuntas();
    await prisma.unidad.create({ data: { codigo: 'EXTRA-1', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e1.id, propietario_id: d.propietario2.id, estado: 'activa' } });
    // Ana también es dueña de un departamento en el block 2: no debe aparecer junto a su nombre en la junta del block 1.
    await prisma.unidad.create({ data: { codigo: 'EXTRA-2', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e2.id, propietario_id: U.ana!, estado: 'activa' } });
    const r = await llama(T.prop2);
    const items = itemsDe(r);
    assert.deepEqual(nombres(items), ['Block 1', 'Block 2', 'Junta central']);
    assert.deepEqual(items[0]!.junta?.miembros[0], { cargo: 'presidente', nombre: 'Ana Presidenta', departamentos: ['B01-201'] });
    assert.ok(!r.texto.includes('EXTRA-2'));
  });

  it('dos departamentos en el mismo block no duplican la tarjeta', async () => {
    await sembrarJuntas();
    await prisma.unidad.create({ data: { codigo: 'EXTRA-3', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e1.id, propietario_id: d.propietario1.id, estado: 'activa' } });
    assert.deepEqual(nombres(itemsDe(await llama(T.prop1))), ['Block 1', 'Junta central']);
  });

  it('sólo salen las cuentas ACTIVAS', async () => {
    await junta({ complejo: d.complejoA, estructura: e1 }, [['ana', 'presidente']], { cuentas: [{ titular: 'Cuenta activa' }, { titular: 'Cuenta apagada', activo: false }] });
    const r = await llama(T.prop1);
    assert.deepEqual(itemsDe(r)[0]!.junta?.cuentas.map((c) => c.titular), ['Cuenta activa']);
    assert.ok(!r.texto.includes('Cuenta apagada'));
  });

  it('un presidente de junta lo ve como cualquier vecino (no es la API de gestión)', async () => {
    await sembrarJuntas();
    const r = await llama(T.ana);
    assert.equal(r.status, 200, r.texto);
    assert.ok(!r.texto.includes('@test.pe') && !r.texto.includes('987 654 321'));
  });

  it('sin sesión 401; administración, superadmin y personal → 403', async () => {
    await sembrarJuntas();
    assert.equal((await llama(null)).status, 401);
    for (const t of [T.adminA, T.super, T.mtto, T.seg]) assert.equal((await llama(t)).status, 403);
  });

  it('la API de gestión sigue cerrada a los vecinos (devuelve correo y celular de los miembros)', async () => {
    await sembrarJuntas();
    for (const t of [T.prop1, T.inq1]) assert.equal((await llama(t, '/api/juntas')).status, 403);
  });
});
