// El seed de la demo: sólo corre contra una base `*_demo`, es determinista (dos corridas → las mismas cuentas y la misma mezcla de pagos), relativo a HOY,
// no deja nada real, y el reinicio nocturno deja la base igual que el seed (conservando al superadmin de la instancia). Cada siembra tarda ~25 s.
import './helpers/env';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { prisma } from './helpers/app';
import { hoyLima } from '../src/server/lib/fechas';
import { auditarCoherencia } from '../src/server/services/demo/coherencia';
import { CUENTAS_DEMO, ROLES_DEMO } from '../src/server/services/demo/cuentas';
import { fijarModoDemo, modoDemo } from '../src/server/services/demo/estado';
import { reiniciarDemo } from '../src/server/services/demo/reinicio';
import { exigirBaseDeDemo, nombreDeBase, pngVoucher, sembrarDemo, type ResumenDemo } from '../src/server/services/demo/sembrar';

const CLAVE_SUPER = 'hash-de-prueba-del-superadmin';

/** Una «huella» de la demo sembrada: cuentas, departamentos y la mezcla de cobranza. NO incluye ids ni horas. */
async function huella() {
  const q = async (sql: string) => (await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql)).map((f) => Object.values(f).map(String).join('|'));
  const filas = [
    ...(await q(`SELECT email, rol, COALESCE(cargo_junta,''), COALESCE(telefono,'') FROM "Usuario" WHERE rol <> 'superadmin' ORDER BY email`)),
    ...(await q(`SELECT u.codigo, c.nombre, p.email, COALESCE(i.email,'') FROM "Unidad" u JOIN "ComplejoHabitacional" c ON c.id = u.complejo_id JOIN "Usuario" p ON p.id = u.propietario_id LEFT JOIN "Usuario" i ON i.id = u.inquilino_id ORDER BY c.nombre, u.codigo`)),
    ...(await q(`SELECT r.anio, r.mes, e.nombre, to_char(r.fecha_vencimiento,'YYYY-MM-DD'), sum(c.monto), count(*) FROM "Recibo" r JOIN "Estructura" e ON e.id = r.estructura_id JOIN "ReciboConcepto" rc ON rc.recibo_id = r.id JOIN "ReciboConceptoUnidad" c ON c.recibo_concepto_id = rc.id GROUP BY 1,2,3,4 ORDER BY 1,2,3`)),
    ...(await q(`SELECT u.codigo, c.estado_pago, count(*), sum(c.monto) FROM "ReciboConceptoUnidad" c JOIN "Unidad" u ON u.id = c.unidad_id GROUP BY 1,2 ORDER BY 1,2`)),
    ...(await q(`SELECT estado_validacion, count(*), sum(monto) FROM "Pago" GROUP BY 1 ORDER BY 1`)),
    ...(await q(`SELECT veredicto, count(*) FROM "EvaluacionComprobante" GROUP BY 1 ORDER BY 1`)),
    ...(await q(`SELECT nombre, miembros::text, en_uso::text FROM "GrupoWhatsapp" ORDER BY nombre`)),
  ];
  return createHash('sha256').update(filas.join('\n')).digest('hex');
}

before(async () => {
  await fijarModoDemo(false);
  // Un superadmin de la instancia (como el que crea `npm run seed:demo -- --superadmin=…`): debe sobrevivir a la siembra y al reinicio.
  await prisma.usuario.deleteMany({ where: { email: 'dueno@instancia.example' } });
  await prisma.usuario.create({ data: { nombre: 'Dueño de la instancia', email: 'dueno@instancia.example', rol: 'superadmin', password_hash: CLAVE_SUPER, correo_verificado: true } });
});
after(async () => {
  await fijarModoDemo(false);
  await prisma.$disconnect();
});

describe('Seed de la demo: protección', () => {
  it('sólo acepta bases cuyo nombre termine en «_demo»', () => {
    assert.equal(nombreDeBase('postgresql://postgres:x@localhost:5433/house_demo'), 'house_demo');
    assert.equal(exigirBaseDeDemo('postgresql://postgres:x@localhost:5433/house_demo'), 'house_demo');
    assert.equal(exigirBaseDeDemo('postgresql://postgres:x@db.remoto.example:5432/torre_demo'), 'torre_demo');
    for (const mala of ['postgresql://postgres:x@localhost:5433/house', 'postgresql://postgres:x@localhost:5433/house_test', 'postgresql://postgres:x@localhost:5433/house_mercado', 'postgresql://postgres:x@localhost:5433/demo_house', 'postgresql://postgres:x@localhost:5433/', 'no es una url', '']) {
      assert.throws(() => exigirBaseDeDemo(mala), /_demo/, `debía rechazar ${String(mala)}`);
    }
  });

  it('con DATABASE_URL apuntando a «house», sembrarDemo aborta antes de tocar nada', async () => {
    const url = process.env.DATABASE_URL;
    const antes = await prisma.usuario.count();
    process.env.DATABASE_URL = 'postgresql://postgres:house@localhost:5433/house';
    try {
      await assert.rejects(sembrarDemo(), /sólo corre contra una base/);
    } finally {
      process.env.DATABASE_URL = url;
    }
    assert.equal(await prisma.usuario.count(), antes);
    assert.equal(await modoDemo(), false); // ni siquiera enciende el modo demo
  });

  it('el voucher de ejemplo es un PNG válido y distinto por semilla', () => {
    const a = pngVoucher(1);
    assert.equal(a.subarray(1, 4).toString('ascii'), 'PNG');
    assert.notEqual(a.toString('base64'), pngVoucher(2).toString('base64'));
    assert.ok(a.length < 200_000);
  });
});

describe('Seed de la demo: contenido', () => {
  let r: ResumenDemo;
  before(async () => { r = await sembrarDemo(); }, { timeout: 180_000 });

  it('2 condominios (6 blocks × 20 y 1 torre de 40), modo demo encendido y coherencia en cero', async () => {
    assert.deepEqual(r.problemas, []);
    assert.deepEqual(r.condominios, [{ nombre: 'Residencial Las Palmeras', blocks: 6, departamentos: 120 }, { nombre: 'Edificio Mirador del Parque', blocks: 1, departamentos: 40 }]);
    assert.equal(await modoDemo(), true);
    assert.deepEqual(await auditarCoherencia(), []);
    const f = await prisma.configuracionDemo.findUniqueOrThrow({ where: { id: 1 } });
    assert.ok(f.sembrada_at);
    assert.equal(f.reiniciando_desde, null);
    assert.equal(await prisma.empresaAdministradora.count(), 1);
    assert.equal((await prisma.empresaAdministradora.findFirstOrThrow()).nombre, 'Administradora Demo SAC');
  });

  it('las 8 cuentas de entrada existen con su rol, su cargo y su situación de cobranza', async () => {
    for (const rol of ROLES_DEMO) assert.ok(await prisma.usuario.findUnique({ where: { email: CUENTAS_DEMO[rol].email } }), `falta ${rol}`);
    const tes = await prisma.usuario.findUniqueOrThrow({ where: { email: CUENTAS_DEMO.tesorero_block.email } });
    assert.equal(tes.cargo_junta, 'tesorero');
    assert.ok(tes.estructura_id);
    const pres = await prisma.usuario.findUniqueOrThrow({ where: { email: CUENTAS_DEMO.presidente_central.email } });
    assert.equal(pres.cargo_junta, 'presidente');
    assert.equal(pres.estructura_id, null);
    const hoy = hoyLima();
    const debe = async (rol: 'propietario_al_dia' | 'propietario_moroso' | 'inquilino') => {
      const u = await prisma.unidad.findFirstOrThrow({ where: { codigo: CUENTAS_DEMO[rol].unidad!, complejo: { nombre: 'Residencial Las Palmeras' } } });
      const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { unidad_id: u.id, estado_pago: 'pendiente' }, include: { reciboConcepto: { include: { recibo: true } } } });
      const recibos = cargos.map((c) => c.reciboConcepto!.recibo!);
      const mes = (x: { anio: number; mes: number }) => `${x.anio}-${x.mes}`;
      return { vencidos: new Set(recibos.filter((x) => x.fecha_vencimiento < hoy).map(mes)).size, meses: new Set(recibos.map(mes)).size };
    };
    assert.deepEqual(await debe('propietario_al_dia'), { vencidos: 0, meses: 1 }); // sólo el recibo del mes, que aún no vence
    assert.deepEqual(await debe('inquilino'), { vencidos: 0, meses: 1 });
    assert.deepEqual(await debe('propietario_moroso'), { vencidos: 3, meses: 4 }); // 3 meses vencidos + el del mes
  });

  it('es relativo a hoy: el recibo del mes en curso existe y vence en el futuro; hay vencidos, por vencer, por validar y rechazados', async () => {
    const hoy = hoyLima();
    const delMes = await prisma.recibo.findMany({ where: { mes: hoy.getUTCMonth() + 1, anio: hoy.getUTCFullYear() } });
    assert.equal(delMes.length, 7);
    assert.ok(delMes.every((x) => x.fecha_vencimiento >= hoy));
    assert.equal(await prisma.recibo.count(), 7 * 6);
    assert.ok(r.por_validar >= 10 && r.rechazados >= 5, `por validar ${r.por_validar}, rechazados ${r.rechazados}`);
  });

  it('las lecturas de «IA» son de ejemplo (nunca un proveedor real) y hay tanto coincidencias como alertas', async () => {
    const por = await prisma.evaluacionComprobante.groupBy({ by: ['proveedor', 'veredicto'], _count: true });
    assert.ok(por.every((x) => x.proveedor === 'demo'));
    assert.ok(por.some((x) => x.veredicto === 'coincide') && por.some((x) => x.veredicto === 'no_coincide'));
  });

  it('WhatsApp de ejemplo, comunicados, reservas, proveedores, tareas y agua; nada real y ningún aviso pendiente', async () => {
    const e = await prisma.empresaAdministradora.findFirstOrThrow();
    assert.equal(e.whatsapp_instance, 'demo-torre');
    assert.ok((await prisma.grupoWhatsapp.count({ where: { en_uso: true } })) >= 7);
    assert.ok((await prisma.comunicado.count()) >= 6 && (await prisma.reserva.count()) >= 6 && (await prisma.proveedor.count()) >= 5);
    assert.ok((await prisma.tareaMantenimiento.count()) >= 4 && (await prisma.lecturaAgua.count()) >= 80);
    assert.equal(await prisma.notificacion.count(), 0);
    assert.equal(await prisma.sesion.count(), 0);
    assert.equal(await prisma.usuario.count({ where: { email: { not: { endsWith: '.example' } }, rol: { not: 'superadmin' } } }), 0);
    assert.equal(await prisma.usuario.count({ where: { rol: { not: 'superadmin' }, NOT: { telefono: { startsWith: '900' } } } }), 0);
  });

  it('conserva al superadmin de la instancia, con su misma clave', async () => {
    const s = await prisma.usuario.findUniqueOrThrow({ where: { email: 'dueno@instancia.example' }, omit: { password_hash: false } });
    assert.equal(s.rol, 'superadmin');
    assert.equal(s.password_hash, CLAVE_SUPER);
  });
});

describe('Reinicio de la demo', () => {
  it('es determinista: el reinicio deja la base igual que el seed (mismas cuentas, mismos montos) y vuelve a quitar lo que se hizo', { timeout: 180_000 }, async () => {
    const antes = await huella();
    // Lo que una visita deja a su paso: un comunicado, un pago anulado de más, una sesión y un aviso.
    const cond = await prisma.complejoHabitacional.findFirstOrThrow({ select: { id: true } });
    await prisma.comunicado.create({ data: { complejo_id: cond.id, titulo: 'Ensuciando la demo', cuerpo: 'x' } });
    await prisma.usuario.update({ where: { email: CUENTAS_DEMO.propietario_moroso.email }, data: { nombre: 'Nombre cambiado por una visita' } });
    const r = await reiniciarDemo();
    assert.equal(r.estado, 'hecho');
    assert.equal(await huella(), antes);
    assert.equal(await prisma.comunicado.count({ where: { titulo: 'Ensuciando la demo' } }), 0);
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { email: CUENTAS_DEMO.propietario_moroso.email } })).nombre, CUENTAS_DEMO.propietario_moroso.nombre);
    assert.deepEqual(await auditarCoherencia(), []);
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { email: 'dueno@instancia.example' }, omit: { password_hash: false } })).password_hash, CLAVE_SUPER);
    assert.equal((await prisma.configuracionDemo.findUniqueOrThrow({ where: { id: 1 } })).reiniciando_desde, null);
  });

  it('sin el modo demostración no reinicia nada; con un reinicio en marcha no empieza otro', async () => {
    await fijarModoDemo(false);
    assert.deepEqual(await reiniciarDemo(), { estado: 'no_es_demo' });
    await fijarModoDemo(true);
    await prisma.configuracionDemo.update({ where: { id: 1 }, data: { reiniciando_desde: new Date() } });
    assert.deepEqual(await reiniciarDemo(), { estado: 'en_curso' });
    await prisma.configuracionDemo.update({ where: { id: 1 }, data: { reiniciando_desde: null } });
  });
});
