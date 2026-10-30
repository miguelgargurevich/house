// Conformidad del tesorero: «el dinero llegó a la cuenta». La da SÓLO el tesorero de la junta del block del pago (no el presidente, el secretario ni el vocal;
// otro block → 404), mientras el pago siga por validar; quedan quién y cuándo y la administradora los ve. La administradora valida sólo CON la conformidad
// (409 si falta), salvo que nadie pueda darla (el block no tiene tesorero, o el pago es del propio tesorero); la junta no valida ni rechaza. IA sin claves: nunca hay red.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { pagarCargo, pagarComoResidente } from './helpers/pagoResidente';
import { esperarEvaluaciones } from '../src/server/services/evaluacion';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number };
let e2: { id: number };
let e3: { id: number };
let e4: { id: number };
let eB: { id: number };
type Junta = 'presi1' | 'tesor1' | 'secre1' | 'vocal1' | 'presi2' | 'tesor2' | 'tesorTodo' | 'tesorB' | 'tesorPropio' | 'presi4';
let ids: Record<Junta, number>;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1' | 'prop2' | 'inq1' | Junta, string>;

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  e3 = await prisma.estructura.create({ data: { nombre: 'Block 3', tipo: 'Block', complejo_id: d.complejoA.id } });
  e4 = await prisma.estructura.create({ data: { nombre: 'Block 4', tipo: 'Block', complejo_id: d.complejoA.id } }); // sin tesorero
  eB = await prisma.estructura.create({ data: { nombre: 'Block B', tipo: 'Block', complejo_id: d.complejoB.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } }); // prop1 e inq1
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } }); // prop2
  const hash = await bcrypt.hash(PASSWORD, 4);
  const junta = async (nombre: string, email: string, cargo: string, complejo: { id: number; empresa_id: number | null }, estructura_id: number | null) =>
    (await prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: complejo.empresa_id, complejo_id: complejo.id, cargo_junta: cargo, estructura_id } })).id;
  ids = {
    presi1: await junta('Presidente 1', 'presi1@test.pe', 'presidente', d.complejoA, e1.id),
    tesor1: await junta('Tesorero 1', 'tesor1@test.pe', 'tesorero', d.complejoA, e1.id),
    secre1: await junta('Secretario 1', 'secre1@test.pe', 'secretario', d.complejoA, e1.id),
    vocal1: await junta('Vocal 1', 'vocal1@test.pe', 'vocal', d.complejoA, e1.id),
    presi2: await junta('Presidente 2', 'presi2@test.pe', 'presidente', d.complejoA, e2.id),
    tesor2: await junta('Tesorero 2', 'tesor2@test.pe', 'tesorero', d.complejoA, e2.id),
    tesorTodo: await junta('Tesorero del condominio', 'tesortodo@test.pe', 'tesorero', d.complejoA, null),
    tesorB: await junta('Tesorero B', 'tesorb@test.pe', 'tesorero', d.complejoB, eB.id),
    tesorPropio: await junta('Tesorero con unidad', 'tesorpropio@test.pe', 'tesorero', d.complejoA, e3.id),
    presi4: await junta('Presidente 4', 'presi4@test.pe', 'presidente', d.complejoA, e4.id),
  };
  await prisma.unidad.create({ data: { codigo: 'T3-1', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e3.id, propietario_id: ids.tesorPropio, estado: 'activa' } });
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, evaluacion: 100_000 } }));
  T = {
    super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'),
    prop1: await login(base, 'prop1@test.pe'), prop2: await login(base, 'prop2@test.pe'), inq1: await login(base, 'inq1@test.pe'),
    presi1: await login(base, 'presi1@test.pe'), tesor1: await login(base, 'tesor1@test.pe'), secre1: await login(base, 'secre1@test.pe'), vocal1: await login(base, 'vocal1@test.pe'),
    presi2: await login(base, 'presi2@test.pe'), tesor2: await login(base, 'tesor2@test.pe'), tesorTodo: await login(base, 'tesortodo@test.pe'), tesorB: await login(base, 'tesorb@test.pe'),
    tesorPropio: await login(base, 'tesorpropio@test.pe'), presi4: await login(base, 'presi4@test.pe'),
  };
});
after(async () => {
  await esperarEvaluaciones();
  await cerrar();
  await prisma.$disconnect();
});
afterEach(async () => { await esperarEvaluaciones(); });

const DIA = 86_400_000;
let n = 0;
/** Cargo nuevo (monto 100, pendiente) en la unidad dada y el pago por validar, CON voucher, que registra su dueño. */
async function pagoPorValidar(propietarioToken: string, unidad: { id: number } = d.unidadA1): Promise<number> {
  n += 1;
  const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 1 + (n % 12), anio: 2000 + n, fecha_emision: new Date(Date.now() - 60 * DIA), fecha_vencimiento: new Date(Date.now() + 30 * DIA), estado: 'emitido' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 100, orden: 1 } });
  const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto: 100, estado_pago: 'pendiente' } });
  const r = await pagarCargo(base, propietarioToken, cargo.id, { metodo_pago: 'yape', referencia: 'OP-FALSA' });
  assert.equal(r.status, 201, r.texto);
  return r.body.id;
}
const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);
const dar = (t: string | null, id: number) => llama(t, 'PUT', `/api/pagos/${id}/conformidad`);
const quitar = (t: string | null, id: number) => llama(t, 'DELETE', `/api/pagos/${id}/conformidad`);
const validar = (t: string, id: number, cuerpo: unknown = { estado: 'validado' }) => llama(t, 'PATCH', `/api/pagos/${id}/validacion`, cuerpo);
const pagoDb = (id: number) => prisma.pago.findUniqueOrThrow({ where: { id } });
const auditoria = (id: number, accion: string) => esperar(async () => (await prisma.auditoria.findFirst({ where: { entidad: 'pago', entidad_id: id, accion } })) ?? null);
const filasDe = (id: number, accion: string) => prisma.auditoria.count({ where: { entidad: 'pago', entidad_id: id, accion } });

describe('el tesorero da y quita la conformidad', () => {
  it('el tesorero del block la da: quién y cuándo quedan en el pago, en la respuesta y en la auditoría', async () => {
    const id = await pagoPorValidar(T.prop1);
    const antes = Date.now();
    const r = await dar(T.tesor1, id);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.conformidad.por.nombre, 'Tesorero 1');
    assert.ok(new Date(r.body.conformidad.at).getTime() >= antes - 1000);
    assert.equal(r.body.estado_validacion, 'por_validar', 'dar la conformidad no cierra el pago');
    const p = await pagoDb(id);
    assert.equal(p.conformidad_por_id, ids.tesor1);
    assert.ok(p.conformidad_at);
    assert.equal(p.estado_validacion, 'por_validar');
    assert.equal((await auditoria(id, 'dar_conformidad')).usuario_id, ids.tesor1);
  });

  it('darla dos veces no cambia nada: queda la primera (quién y cuándo)', async () => {
    const id = await pagoPorValidar(T.prop1);
    assert.equal((await dar(T.tesor1, id)).status, 200);
    const primera = (await pagoDb(id)).conformidad_at;
    await new Promise((r) => setTimeout(r, 20));
    const otra = await dar(T.tesor1, id);
    assert.equal(otra.status, 200);
    assert.equal(new Date(otra.body.conformidad.at).getTime(), primera!.getTime());
    assert.equal((await pagoDb(id)).conformidad_at!.getTime(), primera!.getTime());
  });

  it('la deshace mientras el pago sigue por validar; quitarla sin tenerla es un 200 que no cambia nada', async () => {
    const id = await pagoPorValidar(T.prop1);
    assert.equal((await dar(T.tesor1, id)).status, 200);
    const r = await quitar(T.tesor1, id);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.conformidad, null);
    const p = await pagoDb(id);
    assert.equal(p.conformidad_at, null);
    assert.equal(p.conformidad_por_id, null);
    assert.ok(await auditoria(id, 'quitar_conformidad'));
    const sinTenerla = await quitar(T.tesor1, id);
    assert.equal(sinTenerla.status, 200);
    assert.equal(sinTenerla.body.conformidad, null);
    assert.equal(await filasDe(id, 'quitar_conformidad'), 2, 'cada petición exitosa se audita');
    assert.equal((await dar(T.tesor1, id)).status, 200, 'se puede volver a dar');
  });

  it('el tesorero de toda la junta del condominio (sin block) alcanza los pagos de cualquier block', async () => {
    const id = await pagoPorValidar(T.prop2, d.unidadA2); // block 2
    assert.equal((await dar(T.tesorTodo, id)).status, 200);
    assert.equal((await pagoDb(id)).conformidad_por_id, ids.tesorTodo);
  });

  it('un pago por validar SIN voucher también admite la conformidad (llegó el dinero aunque falte el archivo)', async () => {
    const id = await pagoPorValidar(T.prop1);
    await prisma.archivoComprobante.deleteMany({ where: { pago_id: id } });
    assert.equal((await dar(T.tesor1, id)).status, 200);
  });
});

describe('quién puede y quién no', () => {
  it('el tesorero de OTRO block u otro condominio: 404 (dar y quitar), y el pago no cambia', async () => {
    const id = await pagoPorValidar(T.prop1);
    assert.equal((await dar(T.tesor2, id)).status, 404);
    assert.equal((await dar(T.tesorB, id)).status, 404);
    assert.equal((await dar(T.tesor1, id)).status, 200);
    assert.equal((await quitar(T.tesor2, id)).status, 404);
    assert.equal((await quitar(T.tesorB, id)).status, 404);
    assert.equal((await pagoDb(id)).conformidad_por_id, ids.tesor1, 'la de otro block no la quitó');
    assert.equal((await dar(T.tesor1, 999_999)).status, 404);
  });

  it('presidente, secretario y vocal del block: 403; el presidente de otro block: 404 (no ve ese pago)', async () => {
    const id = await pagoPorValidar(T.prop1);
    for (const quien of ['presi1', 'secre1', 'vocal1'] as const) {
      assert.equal((await dar(T[quien], id)).status, 403, `${quien} dar`);
      assert.equal((await quitar(T[quien], id)).status, 403, `${quien} quitar`);
    }
    assert.equal((await dar(T.presi2, id)).status, 404);
    const p = await pagoDb(id);
    assert.equal(p.conformidad_at, null);
    assert.equal(p.conformidad_por_id, null);
    assert.equal(await filasDe(id, 'dar_conformidad'), 0);
  });

  it('la administradora, el superadmin, el propietario y el inquilino: 403; sin sesión: 401', async () => {
    const id = await pagoPorValidar(T.prop1);
    for (const quien of ['adminA', 'adminB', 'super', 'prop1', 'prop2', 'inq1'] as const) {
      assert.equal((await dar(T[quien], id)).status, 403, `${quien} dar`);
      assert.equal((await quitar(T[quien], id)).status, 403, `${quien} quitar`);
    }
    assert.equal((await dar(null, id)).status, 401);
    assert.equal((await pagoDb(id)).conformidad_at, null);
  });

  it('el tesorero no da la conformidad de SU propio pago', async () => {
    const unidadPropia = await prisma.unidad.findFirstOrThrow({ where: { codigo: 'T3-1' } });
    const id = await pagoPorValidar(T.tesorPropio, unidadPropia);
    const r = await dar(T.tesorPropio, id);
    assert.equal(r.status, 403);
    assert.match(r.body.error, /propio pago/);
    assert.equal((await pagoDb(id)).conformidad_at, null);
  });

  it('un tesorero que deja el cargo ya no puede darla (el permiso se relee de la base en cada petición)', async () => {
    const id = await pagoPorValidar(T.prop1);
    const email = 'tesor.saliente@test.pe';
    const hash = await bcrypt.hash(PASSWORD, 4);
    const u = await prisma.usuario.create({ data: { nombre: 'Tesorero saliente', email, rol: 'propietario', password_hash: hash, empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, cargo_junta: 'tesorero', estructura_id: e1.id } });
    const token = await login(base, email);
    await prisma.usuario.update({ where: { id: u.id }, data: { cargo_junta: 'vocal' } });
    assert.equal((await dar(token, id)).status, 403);
    assert.equal((await pagoDb(id)).conformidad_at, null);
  });
});

describe('sólo mientras el pago está por validar', () => {
  it('un pago ya validado o rechazado: 409 al dar y al quitar, y la conformidad dada se conserva', async () => {
    const validado = await pagoPorValidar(T.prop1);
    assert.equal((await dar(T.tesor1, validado)).status, 200);
    assert.equal((await validar(T.adminA, validado)).status, 200);
    const rechazado = await pagoPorValidar(T.prop1);
    assert.equal((await validar(T.adminA, rechazado, { estado: 'rechazado', motivo: 'No coincide el monto' })).status, 200);
    for (const id of [validado, rechazado]) {
      const r = await dar(T.tesor1, id);
      assert.equal(r.status, 409, r.texto);
      assert.match(r.body.error, /ya fue revisado/);
      assert.equal((await quitar(T.tesor1, id)).status, 409);
    }
    assert.equal((await pagoDb(validado)).conformidad_por_id, ids.tesor1, 'la conformidad queda como constancia en el pago validado');
    assert.equal((await pagoDb(rechazado)).conformidad_at, null);
  });
});

describe('lo que ve la administradora', () => {
  it('el detalle del mantenimiento trae `conformidad_exencion` por pago: null si hace falta el check (Validar queda deshabilitado ahí también)', async () => {
    const id = await pagoPorValidar(T.prop1);
    const pago = await prisma.pago.findUniqueOrThrow({ where: { id }, select: { reciboConceptoUnidad: { select: { unidad_id: true, reciboConcepto: { select: { recibo_id: true } } } } } });
    const r = await llama(T.adminA, 'GET', `/api/recibos/${pago.reciboConceptoUnidad!.reciboConcepto!.recibo_id}/mantenimientos/${pago.reciboConceptoUnidad!.unidad_id}`);
    assert.equal(r.status, 200, r.texto);
    const enDetalle = r.body.pagos.find((x: { id: number }) => x.id === id);
    assert.ok(enDetalle, 'el pago sale en el detalle');
    assert.equal(enDetalle.conformidad_exencion, null, 'el block tiene tesorero y el pago no es suyo: hace falta el check');
    assert.equal(enDetalle.tesorero_registrado, true);
  });

  it('el pago trae `conformidad` (null mientras falte; luego quién y cuándo) en el detalle y en la lista, y `tesorero_registrado`', async () => {
    const id = await pagoPorValidar(T.prop1);
    const sin = await llama(T.adminA, 'GET', `/api/pagos/${id}`);
    assert.equal(sin.status, 200);
    assert.equal(sin.body.conformidad, null);
    assert.equal(sin.body.tesorero_registrado, true);
    assert.equal('conformidad_at' in sin.body, false, 'el campo crudo no sale');
    assert.equal('conformidad_por_id' in sin.body, false);
    await dar(T.tesor1, id);
    const con = await llama(T.adminA, 'GET', `/api/pagos/${id}`);
    assert.equal(con.body.conformidad.por.nombre, 'Tesorero 1');
    assert.ok(con.body.conformidad.at);
    const lista = await llama(T.adminA, 'GET', '/api/pagos?estado_validacion=por_validar&pageSize=100');
    assert.equal(lista.body.items.find((p: { id: number }) => p.id === id).conformidad.por.nombre, 'Tesorero 1');
  });

  it('`tesorero_registrado` es false si el block no tiene tesorero (aunque tenga presidente); un tesorero sin block cubre a todos', async () => {
    const unidad4 = await prisma.unidad.create({ data: { codigo: 'B4-1', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e4.id, propietario_id: d.propietario1.id, estado: 'activa' } });
    const id = await pagoPorValidar(T.prop1, unidad4);
    // `tesorTodo` (sin block) cubre el block 4: mientras exista, sí hay tesorero.
    assert.equal((await llama(T.adminA, 'GET', `/api/pagos/${id}`)).body.tesorero_registrado, true);
    await prisma.usuario.update({ where: { id: ids.tesorTodo }, data: { cargo_junta: 'vocal' } });
    try {
      const r = await llama(T.adminA, 'GET', `/api/pagos/${id}`);
      assert.equal(r.body.tesorero_registrado, false);
      assert.equal(r.body.conformidad, null);
      assert.equal((await llama(T.adminA, 'GET', `/api/pagos/${await pagoPorValidar(T.prop1)}`)).body.tesorero_registrado, true, 'el block 1 sigue con su tesorero');
    } finally {
      await prisma.usuario.update({ where: { id: ids.tesorTodo }, data: { cargo_junta: 'tesorero' } });
    }
  });

  it('filtro `conformidad=con|sin` en la lista; un valor raro es 422', async () => {
    const con = await pagoPorValidar(T.prop1);
    const sin = await pagoPorValidar(T.prop1);
    await dar(T.tesor1, con);
    const lista = async (q: string) => (await llama(T.adminA, 'GET', `/api/pagos?estado_validacion=por_validar&pageSize=100&${q}`)).body.items.map((p: { id: number }) => p.id);
    const conC = await lista('conformidad=con');
    assert.ok(conC.includes(con) && !conC.includes(sin));
    const sinC = await lista('conformidad=sin');
    assert.ok(sinC.includes(sin) && !sinC.includes(con));
    assert.equal((await llama(T.adminA, 'GET', '/api/pagos?conformidad=quizas')).status, 422);
  });

  it('la junta (presidente y tesorero) también ve la conformidad en su lista, acotada a su block', async () => {
    const id = await pagoPorValidar(T.prop1);
    await dar(T.tesor1, id);
    for (const quien of ['presi1', 'tesor1'] as const) {
      const r = await llama(T[quien], 'GET', `/api/pagos/${id}`);
      assert.equal(r.status, 200, quien);
      assert.equal(r.body.conformidad.por.nombre, 'Tesorero 1');
    }
    assert.equal((await llama(T.presi2, 'GET', `/api/pagos/${id}`)).status, 404);
  });

  it('el residente NO ve la conformidad ni sus campos, ni en sus pagos ni en sus cargos', async () => {
    const id = await pagoPorValidar(T.prop1);
    await dar(T.tesor1, id);
    const mios = await llama(T.prop1, 'GET', '/api/me/pagos?pageSize=100');
    assert.equal(mios.status, 200);
    const fila = mios.body.items.find((p: { id: number }) => p.id === id);
    assert.ok(fila);
    for (const campo of ['conformidad', 'conformidad_at', 'conformidad_por_id', 'tesorero_registrado']) assert.equal(campo in fila, false, campo);
    const cargos = await llama(T.prop1, 'GET', '/api/me/cargos?pageSize=100');
    assert.equal(cargos.status, 200);
    assert.equal(JSON.stringify(cargos.body).includes('conformidad'), false, 'ni en pagos[] de los cargos');
  });
});

describe('quién valida: sólo la administración', () => {
  it('la junta ya no valida ni rechaza: presidente y tesorero 403, el pago no cambia', async () => {
    const id = await pagoPorValidar(T.prop1);
    await dar(T.tesor1, id);
    for (const quien of ['presi1', 'tesor1', 'secre1', 'vocal1', 'presi2', 'tesorB', 'prop1'] as const) {
      assert.equal((await validar(T[quien], id)).status, 403, `${quien} validar`);
      assert.equal((await validar(T[quien], id, { estado: 'rechazado', motivo: 'No me gusta' })).status, 403, `${quien} rechazar`);
    }
    const p = await pagoDb(id);
    assert.equal(p.estado_validacion, 'por_validar');
    assert.equal(p.validado_por_id, null);
    assert.equal(await filasDe(id, 'validar'), 0);
    assert.equal(await filasDe(id, 'rechazar'), 0);
  });

  it('la administradora valida CON conformidad y la respuesta la trae; otra empresa no puede (404) ni la junta rechazar (403)', async () => {
    const id = await pagoPorValidar(T.prop1);
    await dar(T.tesor1, id);
    assert.equal((await validar(T.adminB, id)).status, 404);
    const r = await validar(T.adminA, id);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.conformidad.por.nombre, 'Tesorero 1');
    const cargo = await prisma.reciboConceptoUnidad.findFirstOrThrow({ where: { pagos: { some: { id } } } });
    assert.equal(cargo.estado_pago, 'pagado');
    const id2 = await pagoPorValidar(T.prop2, d.unidadA2);
    assert.equal((await validar(T.super, id2)).status, 409, 'el superadmin tampoco se salta el check');
    await dar(T.tesor2, id2);
    assert.equal((await validar(T.super, id2)).status, 200, 'con el check, el superadmin sigue pudiendo');
  });
});

/** Sin el tesorero que cubre todo el condominio (`tesorTodo`), el block 4 queda sin tesorero. */
async function sinTesorTodo<R>(fn: () => Promise<R>): Promise<R> {
  await prisma.usuario.update({ where: { id: ids.tesorTodo }, data: { cargo_junta: 'vocal' } });
  try { return await fn(); } finally { await prisma.usuario.update({ where: { id: ids.tesorTodo }, data: { cargo_junta: 'tesorero' } }); }
}
const unidadBlock4 = () => prisma.unidad.create({ data: { codigo: `B4-V${++n}`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e4.id, propietario_id: d.propietario1.id, estado: 'activa' } });

describe('validar exige el check del tesorero (IA + tesorero)', () => {
  it('sin el check: 409 «Falta el check del tesorero del block»; el pago y el cargo no cambian; con el check, valida', async () => {
    const id = await pagoPorValidar(T.prop1);
    const r = await validar(T.adminA, id);
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.body.error, 'Falta el check del tesorero del block');
    const p = await pagoDb(id);
    assert.equal(p.estado_validacion, 'por_validar');
    assert.equal(p.validado_por_id, null);
    assert.equal(await filasDe(id, 'validar'), 0);
    const cargo = await prisma.reciboConceptoUnidad.findFirstOrThrow({ where: { pagos: { some: { id } } } });
    assert.equal(cargo.estado_pago, 'en_revision');
    await dar(T.tesor1, id);
    const ok = await validar(T.adminA, id);
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(ok.body.estado_validacion, 'validado');
    assert.equal((await pagoDb(id)).validado_por_id, d.adminA.id);
    const aud = await auditoria(id, 'validar');
    assert.deepEqual(aud.detalle, { estado: 'validado' }, 'con el check no hay excepción que anotar');
  });

  it('si el tesorero quita su check, la administradora vuelve a recibir el 409', async () => {
    const id = await pagoPorValidar(T.prop1);
    await dar(T.tesor1, id);
    await quitar(T.tesor1, id);
    assert.equal((await validar(T.adminA, id)).status, 409);
    assert.equal((await pagoDb(id)).estado_validacion, 'por_validar');
  });

  it('rechazar NO exige el check', async () => {
    const id = await pagoPorValidar(T.prop1);
    const r = await validar(T.adminA, id, { estado: 'rechazado', motivo: 'No veo el depósito' });
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.estado_validacion, 'rechazado');
  });

  it('el block no tiene tesorero: la administradora valida sola, y la auditoría lo anota', async () => {
    const unidad = await unidadBlock4();
    await sinTesorTodo(async () => {
      const id = await pagoPorValidar(T.prop1, unidad);
      const lectura = await llama(T.adminA, 'GET', `/api/pagos/${id}`);
      assert.equal(lectura.body.tesorero_registrado, false);
      assert.equal(lectura.body.conformidad_exencion, 'sin_tesorero');
      const r = await validar(T.adminA, id);
      assert.equal(r.status, 200, r.texto);
      assert.equal(r.body.estado_validacion, 'validado');
      assert.deepEqual((await auditoria(id, 'validar')).detalle, { estado: 'validado', sin_conformidad: 'sin_tesorero' });
    });
  });

  it('el pago lo registró el propio tesorero (único del block): nadie puede darle el check, la administradora valida sola y queda anotado', async () => {
    const unidadPropia = await prisma.unidad.findFirstOrThrow({ where: { codigo: 'T3-1' } });
    await sinTesorTodo(async () => {
      const id = await pagoPorValidar(T.tesorPropio, unidadPropia);
      assert.equal((await dar(T.tesorPropio, id)).status, 403, 'él no puede');
      const lectura = await llama(T.adminA, 'GET', `/api/pagos/${id}`);
      assert.equal(lectura.body.tesorero_registrado, true);
      assert.equal(lectura.body.conformidad_exencion, 'pago_del_tesorero');
      const r = await validar(T.adminA, id);
      assert.equal(r.status, 200, r.texto);
      assert.deepEqual((await auditoria(id, 'validar')).detalle, { estado: 'validado', sin_conformidad: 'pago_del_tesorero' });
    });
  });

  it('el pago del propio tesorero SÍ exige el check si otro tesorero cubre el block (él sí puede darlo)', async () => {
    const unidadPropia = await prisma.unidad.findFirstOrThrow({ where: { codigo: 'T3-1' } });
    const id = await pagoPorValidar(T.tesorPropio, unidadPropia); // `tesorTodo` cubre todos los blocks
    const lectura = await llama(T.adminA, 'GET', `/api/pagos/${id}`);
    assert.equal(lectura.body.conformidad_exencion, null);
    assert.equal((await validar(T.adminA, id)).status, 409);
    assert.equal((await dar(T.tesorTodo, id)).status, 200);
    assert.equal((await validar(T.adminA, id)).status, 200);
  });

  it('la lista trae `conformidad_exencion` null cuando el check se exige', async () => {
    const id = await pagoPorValidar(T.prop1);
    const lista = await llama(T.adminA, 'GET', '/api/pagos?estado_validacion=por_validar&pageSize=100');
    assert.equal(lista.body.items.find((p: { id: number }) => p.id === id).conformidad_exencion, null);
  });

  it('el pago de un mantenimiento (grupo): el check del principal basta para validar todo el grupo; sin él, 409 y nada cambia', async () => {
    n += 1;
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 4, anio: 1980 + n, fecha_emision: new Date(Date.now() - 40 * DIA), fecha_vencimiento: new Date(Date.now() + 20 * DIA), estado: 'emitido' } });
    for (const [i, monto] of [30, 70].entries()) {
      const concepto = await prisma.concepto.create({ data: { nombre: `Concepto V${n}-${i}`, empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
      const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto, orden: i + 1 } });
      await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: d.unidadA1.id, monto, estado_pago: 'pendiente' } });
    }
    const pagado = await pagarComoResidente(base, T.prop1, recibo.id, d.unidadA1.id, { metodo_pago: 'yape', referencia: 'OP-GRUPO-V' });
    assert.equal(pagado.status, 201, pagado.texto);
    const pagos = await prisma.pago.findMany({ where: { grupo: pagado.body.grupo } });
    const otro = pagos.find((p) => !p.grupo_principal)!;
    assert.equal((await validar(T.adminA, otro.id)).status, 409);
    assert.equal(await prisma.pago.count({ where: { grupo: pagado.body.grupo, estado_validacion: 'por_validar' } }), 2);
    await dar(T.tesor1, otro.id);
    assert.equal((await validar(T.adminA, otro.id)).status, 200);
    assert.equal(await prisma.pago.count({ where: { grupo: pagado.body.grupo, estado_validacion: 'validado' } }), 2);
  });
});

describe('pago de un mantenimiento completo (grupo)', () => {
  it('la conformidad vive en el pago principal aunque se dé con el id de otro pago del grupo; la lista sale con una fila', async () => {
    n += 1;
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 3, anio: 1990 + n, fecha_emision: new Date(Date.now() - 40 * DIA), fecha_vencimiento: new Date(Date.now() + 20 * DIA), estado: 'emitido' } });
    for (const [i, monto] of [40, 60].entries()) {
      const concepto = await prisma.concepto.create({ data: { nombre: `Concepto ${n}-${i}`, empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
      const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto, orden: i + 1 } });
      await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: d.unidadA1.id, monto, estado_pago: 'pendiente' } });
    }
    const pagado = await pagarComoResidente(base, T.prop1, recibo.id, d.unidadA1.id, { metodo_pago: 'yape', referencia: 'OP-GRUPO' });
    assert.equal(pagado.status, 201, pagado.texto);
    const pagos = await prisma.pago.findMany({ where: { grupo: pagado.body.grupo }, orderBy: { id: 'asc' } });
    assert.equal(pagos.length, 2);
    const principal = pagos.find((p) => p.grupo_principal)!;
    const otro = pagos.find((p) => !p.grupo_principal)!;

    assert.equal((await dar(T.tesor1, otro.id)).status, 200);
    assert.equal((await pagoDb(principal.id)).conformidad_por_id, ids.tesor1);
    assert.equal((await pagoDb(otro.id)).conformidad_at, null);
    const lista = await llama(T.adminA, 'GET', '/api/pagos?estado_validacion=por_validar&pageSize=100');
    const filas = lista.body.items.filter((p: { grupo: string | null }) => p.grupo === pagado.body.grupo);
    assert.equal(filas.length, 1);
    assert.equal(filas[0].conformidad.por.nombre, 'Tesorero 1');
    // El detalle del mantenimiento de la administración (desde donde también se valida) lo trae; el del residente, no.
    const detalle = await llama(T.adminA, 'GET', `/api/recibos/${recibo.id}/mantenimientos/${d.unidadA1.id}`);
    assert.equal(detalle.status, 200, detalle.texto);
    const delGrupo = detalle.body.pagos.find((p: { id: number }) => p.id === principal.id);
    assert.equal(delGrupo.conformidad.por.nombre, 'Tesorero 1');
    assert.equal(delGrupo.tesorero_registrado, true);
    const suyo = await llama(T.prop1, 'GET', `/api/me/mantenimientos/${recibo.id}/${d.unidadA1.id}`);
    assert.equal(suyo.status, 200, suyo.texto);
    assert.equal(JSON.stringify(suyo.body).includes('conformidad'), false);
    assert.equal((await quitar(T.tesor1, otro.id)).status, 200);
    assert.equal((await pagoDb(principal.id)).conformidad_at, null);
    assert.equal((await llama(T.adminA, 'GET', `/api/recibos/${recibo.id}/mantenimientos/${d.unidadA1.id}`)).body.pagos.find((p: { id: number }) => p.id === principal.id).conformidad, null);
  });
});
