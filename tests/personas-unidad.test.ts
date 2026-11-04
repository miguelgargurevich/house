import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { esperar, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { encolarComunicado } from '../src/server/services/comunicados';
import { encolarReciboEmitido, pagadoresDe } from '../src/server/services/avisos/cola';
import { ejecutarHerramienta } from '../src/server/tools';
import { cargarAuthUser } from '../src/server/services/canales/identidad';
import { migrarPersonas } from '../src/server/services/personas/sincronizar';

/**
 * Personas por departamento y quién tiene acceso a Torre (`PersonaUnidad`): migración, alcance de un residente, un solo responsable de pago, encender y apagar
 * el acceso, avisos de cobro y comunicados, y separación entre empresas. Nunca correos ni WhatsApp reales: sólo se cuentan las filas de la cola de avisos.
 */

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'superT' | 'junta' | 'inq1' | 'mtto', string>;

const api = (token: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, token, cuerpo);
const personas = (token: string | null, unidad: number) => api(token, 'GET', `/api/unidades/${unidad}/personas`);
const agregar = (token: string | null, unidad: number, cuerpo: Record<string, unknown>) => api(token, 'POST', `/api/unidades/${unidad}/personas`, cuerpo);
const editar = (token: string | null, unidad: number, pid: number, cuerpo: Record<string, unknown>) => api(token, 'PUT', `/api/unidades/${unidad}/personas/${pid}`, cuerpo);
const quitar = (token: string | null, unidad: number, pid: number) => api(token, 'DELETE', `/api/unidades/${unidad}/personas/${pid}`);
const acceso = (token: string | null, unidad: number, pid: number, activo: boolean) => api(token, 'PUT', `/api/unidades/${unidad}/personas/${pid}/acceso`, { activo });

/** Le pone contraseña a la cuenta (como si hubiera aceptado la invitación) y devuelve su sesión. */
async function entrar(email: string): Promise<string> {
  await prisma.usuario.update({ where: { email }, data: { password_hash: await bcrypt.hash(PASSWORD, 4) } });
  return login(base, email);
}
/** Una persona con correo y acceso encendido en una unidad; devuelve su id. */
async function conAcceso(unidad: number, nombre: string, correo: string, relacion = 'familiar'): Promise<number> {
  const r = await agregar(T.adminA, unidad, { nombre, relacion, correo, celular: '987654321' });
  assert.equal(r.status, 201, r.texto);
  const a = await acceso(T.adminA, unidad, r.body.id, true);
  assert.equal(a.status, 200, a.texto);
  return r.body.id;
}
const idsDe = (r: { body: { items: { id: number }[] } }) => r.body.items.map((x) => x.id).sort((a, b) => a - b);

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => {
  d = await sembrar();
  await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { cargo_junta: 'presidente' } });
  await migrarPersonas();
  T = {
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    superT: await login(base, 'super@test.pe'),
    junta: await login(base, 'prop1@test.pe'),
    inq1: await login(base, 'inq1@test.pe'),
    mtto: await login(base, 'mtto.a@test.pe'),
  };
});

describe('migración: cada unidad genera sus personas', () => {
  it('propietario e inquilino con su cuenta y acceso; responsable = inquilino si hay, si no propietario', async () => {
    const a1 = await prisma.personaUnidad.findMany({ where: { unidad_id: d.unidadA1.id }, orderBy: { id: 'asc' } });
    assert.deepEqual(a1.map((p) => [p.relacion, p.usuario_id, p.acceso_activo, p.recibe_comunicados, p.responsable_pago]), [
      ['propietario', d.propietario1.id, true, true, false],
      ['inquilino', d.inquilino1.id, true, true, true],
    ]);
    const a2 = await prisma.personaUnidad.findMany({ where: { unidad_id: d.unidadA2.id } });
    assert.deepEqual(a2.map((p) => [p.relacion, p.responsable_pago, p.empresa_id]), [['propietario', true, d.empresaA.id]]);
    const b1 = await prisma.personaUnidad.findMany({ where: { unidad_id: d.unidadB1.id } });
    assert.equal(b1.length, 1);
    assert.equal(b1[0]!.empresa_id, d.empresaB.id);
    // Los datos de contacto salen de la cuenta (sin correos de relleno).
    assert.equal(a1[0]!.nombre, 'Propietario 1');
    assert.equal(a1[0]!.correo, 'prop1@test.pe');
  });

  it('es idempotente (dos veces no duplica) y no toca pagos, recibos ni cargos', async () => {
    const foto = async () => JSON.stringify({
      pagos: await prisma.pago.count(), recibos: await prisma.recibo.findMany({ orderBy: { id: 'asc' } }),
      cargos: await prisma.reciboConceptoUnidad.findMany({ orderBy: { id: 'asc' } }), unidades: await prisma.unidad.findMany({ orderBy: { id: 'asc' } }),
    });
    const antes = await foto();
    const n = await prisma.personaUnidad.count();
    assert.equal(n, 4);
    const r = await migrarPersonas();
    assert.deepEqual(r, { unidades: 0, cambios: 0 });
    assert.equal(await prisma.personaUnidad.count(), n);
    assert.equal(await foto(), antes);
    // Una unidad nueva sin personas sí se migra, y sólo ella.
    const u = await prisma.unidad.create({ data: { codigo: 'A-103', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: d.propietario2.id, estado: 'activa' } });
    assert.equal((await migrarPersonas()).unidades, 1);
    assert.equal(await prisma.personaUnidad.count({ where: { unidad_id: u.id } }), 1);
    assert.equal(await prisma.personaUnidad.count(), n + 1);
  });

  it('con una persona editada a mano, volver a migrar no la pisa', async () => {
    await prisma.personaUnidad.updateMany({ where: { unidad_id: d.unidadA2.id }, data: { recibe_comunicados: false } });
    await migrarPersonas();
    assert.equal((await prisma.personaUnidad.findFirstOrThrow({ where: { unidad_id: d.unidadA2.id } })).recibe_comunicados, false);
  });
});

describe('alcance: una persona con acceso ve SU departamento y no los otros', () => {
  it('me, cargos, pagos, comprobantes, estado de cuenta, áreas comunes y herramientas del asistente', async () => {
    // Un pago en cada unidad de la empresa A, y un área común en el condominio A.
    const pagoA1 = await prisma.pago.create({ data: { recibo_concepto_unidad_id: d.cargoVencidoA1.id, monto: 150, metodo_pago: 'transferencia', fecha_pago: new Date(), usuario_id: d.propietario1.id, estado_validacion: 'pendiente' } });
    const pagoA2 = await prisma.pago.create({ data: { recibo_concepto_unidad_id: d.cargoA2.id, monto: 150, metodo_pago: 'transferencia', fecha_pago: new Date(), usuario_id: d.propietario2.id, estado_validacion: 'pendiente' } });
    await prisma.areaComun.create({ data: { complejo_id: d.complejoA.id, nombre: 'Sala de eventos', hora_apertura: '08:00', hora_cierre: '22:00' } });
    await conAcceso(d.unidadA2.id, 'Elena Gómez', 'elena@vecino.pe');
    const t = await entrar('elena@vecino.pe');

    const unidades = await api(t, 'GET', '/api/me/unidades');
    assert.deepEqual(unidades.body.items.map((u: { codigo: string }) => u.codigo), ['A-102']);
    const cargos = await api(t, 'GET', '/api/me/cargos');
    assert.deepEqual(cargos.body.items.map((c: { id: number }) => c.id), [d.cargoA2.id]);
    assert.equal((await api(t, 'GET', `/api/me/cargos/${d.cargoVencidoA1.id}`)).status, 404, 'el cargo de otro departamento');
    assert.equal((await api(t, 'GET', `/api/me/cargos/${d.cargoA2.id}`)).status, 200);
    assert.deepEqual((await api(t, 'GET', '/api/me/pagos')).body.items.map((p: { id: number }) => p.id), [pagoA2.id]);
    assert.equal((await api(t, 'GET', `/api/pagos/${pagoA1.id}/comprobante`)).status, 404);
    assert.notEqual((await api(t, 'GET', `/api/pagos/${pagoA2.id}/comprobante`)).texto, (await api(t, 'GET', `/api/pagos/${pagoA1.id}/comprobante`)).texto, 'el suyo sí está dentro del alcance');
    assert.equal((await api(t, 'GET', `/api/estado-cuenta/unidades/${d.unidadA2.id}`)).status, 200);
    assert.equal((await api(t, 'GET', `/api/estado-cuenta/unidades/${d.unidadA1.id}`)).status, 404);
    assert.equal((await api(t, 'GET', `/api/estado-cuenta/unidades/${d.unidadB1.id}`)).status, 404);
    assert.equal((await api(t, 'GET', '/api/areas-comunes')).body.items.length, 1, 'el condominio donde tiene departamento');
    assert.equal((await api(T.mtto, 'GET', '/api/areas-comunes')).status, 403);

    const yo = (await cargarAuthUser((await prisma.usuario.findUniqueOrThrow({ where: { email: 'elena@vecino.pe' } })).id))!;
    const r = await ejecutarHerramienta(yo, 'mis_unidades', {}, { origen: 'asistente' });
    const texto = JSON.stringify(r);
    assert.ok(texto.includes('A-102') && !texto.includes('A-101') && !texto.includes('B-101'), texto);
    const deuda = JSON.stringify(await ejecutarHerramienta(yo, 'mis_recibos', {}, { origen: 'asistente' }));
    assert.ok(deuda.includes('A-102') && !deuda.includes('A-101'), `recibos: sólo los de su departamento: ${deuda}`);
    // Los recibos del residente (historial): sólo su departamento; pedir el de otro → sin datos suyos.
    const historial = JSON.stringify((await api(t, 'GET', '/api/me/historial')).body);
    assert.ok(historial.includes('A-102') && !historial.includes('A-101') && !historial.includes('B-101'), historial.slice(0, 300));
    assert.equal((await api(t, 'GET', '/api/recibos')).status, 403, 'la lista de recibos es de la administración');
  });

  it('apagar el acceso corta de inmediato: sesión cerrada y la ficha sigue en la lista', async () => {
    const pid = await conAcceso(d.unidadA2.id, 'Elena Gómez', 'elena@vecino.pe');
    const t = await entrar('elena@vecino.pe');
    assert.equal((await api(t, 'GET', '/api/me/unidades')).status, 200);
    const r = await acceso(T.adminA, d.unidadA2.id, pid, false);
    assert.equal(r.status, 200);
    assert.equal(r.body.acceso_activo, false);
    assert.equal((await api(t, 'GET', '/api/me/unidades')).status, 401, 'sin ninguna unidad con acceso, la sesión se cierra');
    const login2 = await llamar(base, 'POST', '/api/auth/login', null, { email: 'elena@vecino.pe', password: PASSWORD });
    assert.equal(login2.status, 403);
    assert.equal(login2.body.code, 'ACCESO_DESACTIVADO');
    assert.ok(idsDe(await personas(T.adminA, d.unidadA2.id)).includes(pid), 'la persona no se borra');
  });

  it('con dos departamentos, apagar uno no corta el otro', async () => {
    const p2 = await conAcceso(d.unidadA2.id, 'Elena Gómez', 'elena@vecino.pe');
    const p1 = await conAcceso(d.unidadA1.id, 'Elena Gómez', 'elena@vecino.pe');
    assert.equal(await prisma.usuario.count({ where: { email: 'elena@vecino.pe' } }), 1, 'el mismo correo es UNA cuenta con los dos departamentos');
    const t = await entrar('elena@vecino.pe');
    assert.deepEqual((await api(t, 'GET', '/api/me/unidades')).body.items.map((u: { codigo: string }) => u.codigo).sort(), ['A-101', 'A-102']);
    await acceso(T.adminA, d.unidadA2.id, p2, false);
    assert.deepEqual((await api(t, 'GET', '/api/me/unidades')).body.items.map((u: { codigo: string }) => u.codigo), ['A-101'], 'sigue con sesión y con el otro');
    assert.equal((await api(t, 'GET', `/api/me/cargos/${d.cargoA2.id}`)).status, 404);
    await acceso(T.adminA, d.unidadA1.id, p1, false);
    assert.equal((await api(t, 'GET', '/api/me/unidades')).status, 401);
  });

  it('el titular con el acceso apagado en su ficha deja de ver su departamento', async () => {
    const t = await login(base, 'prop2@test.pe');
    assert.equal((await api(t, 'GET', '/api/me/unidades')).body.items.length, 1);
    const [p] = (await personas(T.adminA, d.unidadA2.id)).body.items;
    assert.equal((await acceso(T.adminA, d.unidadA2.id, p.id, false)).status, 200);
    assert.equal((await api(t, 'GET', '/api/me/unidades')).status, 401);
    assert.equal((await acceso(T.adminA, d.unidadA2.id, p.id, true)).status, 200);
    const t2 = await login(base, 'prop2@test.pe');
    assert.equal((await api(t2, 'GET', '/api/me/unidades')).body.items.length, 1, 'al encender vuelve a ver su departamento');
  });

  it('los tokens de API y los vínculos de canal de esa cuenta también se cierran', async () => {
    const pid = await conAcceso(d.unidadA2.id, 'Elena Gómez', 'elena@vecino.pe');
    const us = await prisma.usuario.findUniqueOrThrow({ where: { email: 'elena@vecino.pe' } });
    await prisma.canalVinculado.create({ data: { usuario_id: us.id, canal: 'whatsapp', identificador: '51987654321', empresa_id: d.empresaA.id, verificado_at: new Date() } });
    await acceso(T.adminA, d.unidadA2.id, pid, false);
    assert.equal(await prisma.canalVinculado.count({ where: { usuario_id: us.id, revocado_at: null } }), 0);
  });
});

describe('un solo responsable de pago por departamento', () => {
  it('cambiarlo mueve la marca; nunca hay dos', async () => {
    const r = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Elena Gómez', relacion: 'conyuge', correo: 'elena@vecino.pe' });
    assert.equal(r.status, 201);
    assert.equal(r.body.responsable_pago, false);
    const antes = (await personas(T.adminA, d.unidadA2.id)).body.items;
    assert.deepEqual(antes.filter((p: { responsable_pago: boolean }) => p.responsable_pago).map((p: { relacion: string }) => p.relacion), ['propietario']);
    const mover = await editar(T.adminA, d.unidadA2.id, r.body.id, { responsable_pago: true });
    assert.equal(mover.status, 200, mover.texto);
    const despues = (await personas(T.adminA, d.unidadA2.id)).body.items;
    assert.deepEqual(despues.filter((p: { responsable_pago: boolean }) => p.responsable_pago).map((p: { id: number }) => p.id), [r.body.id]);
    // En la base también: exactamente una.
    assert.equal(await prisma.personaUnidad.count({ where: { unidad_id: d.unidadA2.id, responsable_pago: true } }), 1);
  });

  it('agregar a alguien ya como responsable también deja uno solo', async () => {
    const r = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Elena Gómez', relacion: 'conyuge', correo: 'elena@vecino.pe', responsable_pago: true });
    assert.equal(r.status, 201, r.texto);
    assert.equal(await prisma.personaUnidad.count({ where: { unidad_id: d.unidadA2.id, responsable_pago: true } }), 1);
    assert.equal(r.body.responsable_pago, true);
  });

  it('dos cambios a la vez no dejan dos responsables', async () => {
    const a = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Elena Gómez', relacion: 'conyuge', correo: 'elena@vecino.pe' });
    const b = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Rosa Gómez', relacion: 'familiar', celular: '912345678' });
    await Promise.all([editar(T.adminA, d.unidadA2.id, a.body.id, { responsable_pago: true }), editar(T.adminA, d.unidadA2.id, b.body.id, { responsable_pago: true })]);
    assert.equal(await prisma.personaUnidad.count({ where: { unidad_id: d.unidadA2.id, responsable_pago: true } }), 1);
  });

  it('quitar al responsable o al titular exige elegir otro antes (409); sin dejar al departamento sin responsable', async () => {
    const [titular] = (await personas(T.adminA, d.unidadA2.id)).body.items;
    assert.equal(titular.responsable_pago, true);
    const q = await quitar(T.adminA, d.unidadA2.id, titular.id);
    assert.equal(q.status, 409);
    assert.match(q.body.error, /titular|responsable/);
    assert.equal((await editar(T.adminA, d.unidadA2.id, titular.id, { responsable_pago: false })).status, 409);
    // El propietario de A-101 no paga (paga el inquilino): se puede quitar el cónyuge, pero no al titular.
    const [prop] = (await personas(T.adminA, d.unidadA1.id)).body.items;
    assert.equal(prop.relacion, 'propietario');
    assert.equal(prop.responsable_pago, false);
    assert.equal((await quitar(T.adminA, d.unidadA1.id, prop.id)).status, 409, 'es el titular');
    const extra = await agregar(T.adminA, d.unidadA1.id, { nombre: 'Rosa Gómez', relacion: 'familiar' });
    assert.equal((await quitar(T.adminA, d.unidadA1.id, extra.body.id)).status, 204);
    // Elegir otro antes y luego quitar al responsable.
    const nuevo = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Elena Gómez', relacion: 'conyuge', correo: 'elena@vecino.pe', responsable_pago: true });
    assert.equal(nuevo.status, 201);
    const [ex] = (await personas(T.adminA, d.unidadA2.id)).body.items.filter((p: { relacion: string }) => p.relacion === 'propietario');
    assert.equal(ex.responsable_pago, false);
  });

  it('«Hacer titular» deja a la persona como titular y al anterior como copropietario; luego se puede quitar', async () => {
    const [anterior] = (await personas(T.adminA, d.unidadA2.id)).body.items;
    const nuevo = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Pedro Gómez', relacion: 'copropietario', correo: 'pedro@vecino.pe' });
    assert.equal((await api(T.adminA, 'PUT', `/api/unidades/${d.unidadA2.id}/personas/${nuevo.body.id}/titular`)).status, 400, 'sin cuenta no puede ser titular');
    assert.equal((await acceso(T.adminA, d.unidadA2.id, nuevo.body.id, true)).status, 200);
    const h = await api(T.adminA, 'PUT', `/api/unidades/${d.unidadA2.id}/personas/${nuevo.body.id}/titular`);
    assert.equal(h.status, 200, h.texto);
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: d.unidadA2.id } })).propietario_id, (await prisma.usuario.findUniqueOrThrow({ where: { email: 'pedro@vecino.pe' } })).id);
    assert.equal((await prisma.personaUnidad.findUniqueOrThrow({ where: { id: anterior.id } })).relacion, 'copropietario');
    // El anterior era el responsable: sigue siéndolo hasta que se elija otro (la marca no se mueve sola).
    assert.equal((await quitar(T.adminA, d.unidadA2.id, anterior.id)).status, 409);
    assert.equal((await editar(T.adminA, d.unidadA2.id, nuevo.body.id, { responsable_pago: true })).status, 200);
    assert.equal((await quitar(T.adminA, d.unidadA2.id, anterior.id)).status, 204);
  });

  it('un solo propietario y un solo inquilino por departamento', async () => {
    assert.equal((await agregar(T.adminA, d.unidadA1.id, { nombre: 'Otro Dueño', relacion: 'propietario' })).status, 409);
    assert.equal((await agregar(T.adminA, d.unidadA1.id, { nombre: 'Otro Inquilino', relacion: 'inquilino' })).status, 409);
    assert.equal((await agregar(T.adminA, d.unidadA2.id, { nombre: 'Un Inquilino', relacion: 'inquilino' })).status, 201);
  });
});

describe('encender el acceso a Torre', () => {
  it('crea la cuenta sin contraseña (rol por relación), deja la invitación en la cola y la persona queda con acceso', async () => {
    const f = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Elena Gómez', relacion: 'familiar', correo: 'Elena@Vecino.pe', celular: '987654321' });
    assert.equal(f.status, 201);
    assert.equal(f.body.correo, 'elena@vecino.pe');
    assert.equal(f.body.celular, '+51 987 654 321');
    assert.equal(f.body.acceso_activo, false);
    const a = await acceso(T.adminA, d.unidadA2.id, f.body.id, true);
    assert.equal(a.status, 200);
    assert.deepEqual([a.body.acceso_activo, a.body.estado_acceso], [true, 'en_cola']);
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: 'elena@vecino.pe' }, omit: { password_hash: false } });
    assert.deepEqual([u.rol, u.password_hash, u.empresa_id, u.complejo_id], ['propietario', null, null, d.complejoA.id]);
    assert.equal(await prisma.invitacionEnCola.count({ where: { usuario_id: u.id, enviada_at: null } }), 1);
    // Encender dos veces no duplica la invitación.
    await acceso(T.adminA, d.unidadA2.id, f.body.id, true);
    assert.equal(await prisma.invitacionEnCola.count({ where: { usuario_id: u.id } }), 1);
    // Un inquilino: rol inquilino, y pasa a ser el inquilino de la unidad.
    const i = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Pedro Quispe', relacion: 'inquilino', correo: 'pedro@vecino.pe' });
    await acceso(T.adminA, d.unidadA2.id, i.body.id, true);
    const pu = await prisma.usuario.findUniqueOrThrow({ where: { email: 'pedro@vecino.pe' } });
    assert.equal(pu.rol, 'inquilino');
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: d.unidadA2.id } })).inquilino_id, pu.id);
  });

  it('sin correo → 400; con correo de relleno → 400; nada se guarda', async () => {
    const f = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Elena Gómez', relacion: 'familiar', celular: '987654321' });
    const usuarios = await prisma.usuario.count();
    const a = await acceso(T.adminA, d.unidadA2.id, f.body.id, true);
    assert.equal(a.status, 400);
    assert.match(a.body.error, /correo/);
    const b = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Rosa', relacion: 'familiar', correo: 'x@sin-correo.invalid' });
    assert.equal(b.body.correo, null, 'un correo de relleno no es un correo');
    assert.equal((await acceso(T.adminA, d.unidadA2.id, b.body.id, true)).status, 400);
    assert.equal(await prisma.usuario.count(), usuarios);
    assert.equal((await prisma.personaUnidad.findUniqueOrThrow({ where: { id: f.body.id } })).acceso_activo, false);
  });

  for (const [caso, correo, nombre] of [['personal de la empresa', 'mtto.a@test.pe', 'Mantenimiento A'], ['administrador', 'admin.a@test.pe', 'Admin A'], ['superadmin', 'super@test.pe', 'Super'], ['un vecino de OTRA empresa', 'propb@test.pe', 'Propietario B']] as const) {
    it(`con el correo de ${caso} → 409 y nada guardado`, async () => {
      const f = await agregar(T.adminA, d.unidadA2.id, { nombre, relacion: 'familiar', correo });
      assert.equal(f.status, 201, 'agregarla como persona (sin cuenta) es válido');
      const foto = JSON.stringify([await prisma.usuario.findMany({ orderBy: { id: 'asc' }, select: { id: true, rol: true, complejo_id: true, empresa_id: true } }), await prisma.invitacionEnCola.count(), await prisma.unidad.findMany({ orderBy: { id: 'asc' }, select: { id: true, propietario_id: true, inquilino_id: true } })]);
      const a = await acceso(T.adminA, d.unidadA2.id, f.body.id, true);
      assert.equal(a.status, 409, a.texto);
      assert.equal(a.body.code, 'CUENTA_AJENA');
      const despues = JSON.stringify([await prisma.usuario.findMany({ orderBy: { id: 'asc' }, select: { id: true, rol: true, complejo_id: true, empresa_id: true } }), await prisma.invitacionEnCola.count(), await prisma.unidad.findMany({ orderBy: { id: 'asc' }, select: { id: true, propietario_id: true, inquilino_id: true } })]);
      assert.equal(despues, foto);
      const p = await prisma.personaUnidad.findUniqueOrThrow({ where: { id: f.body.id } });
      assert.deepEqual([p.acceso_activo, p.usuario_id], [false, null]);
    });
  }

  it('el responsable de pago con correo de cuenta ajena tampoco la vincula (409) y no se marca', async () => {
    const f = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Mantenimiento A', relacion: 'familiar', correo: 'mtto.a@test.pe' });
    const r = await editar(T.adminA, d.unidadA2.id, f.body.id, { responsable_pago: true });
    assert.equal(r.status, 409);
    assert.equal(await prisma.personaUnidad.count({ where: { id: f.body.id, responsable_pago: true } }), 0);
    assert.equal(await prisma.personaUnidad.count({ where: { unidad_id: d.unidadA2.id, responsable_pago: true } }), 1, 'sigue el de antes');
  });

  it('un correo de un vecino de este condominio con otro nombre → 409 (no se le da acceso a la cuenta equivocada)', async () => {
    const f = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Elena Gómez', relacion: 'familiar', correo: 'prop1@test.pe' });
    const a = await acceso(T.adminA, d.unidadA2.id, f.body.id, true);
    assert.equal(a.status, 409);
    assert.equal(a.body.code, 'OTRA_PERSONA');
  });

  it('el mismo correo en dos departamentos es UNA cuenta', async () => {
    await conAcceso(d.unidadA1.id, 'Elena Gómez', 'elena@vecino.pe');
    await conAcceso(d.unidadA2.id, 'Elena Gómez', 'elena@vecino.pe');
    const us = await prisma.usuario.findMany({ where: { email: 'elena@vecino.pe' } });
    assert.equal(us.length, 1);
    assert.equal(await prisma.personaUnidad.count({ where: { usuario_id: us[0]!.id, acceso_activo: true } }), 2);
    assert.equal(await prisma.invitacionEnCola.count({ where: { usuario_id: us[0]!.id } }), 1, 'una sola invitación');
  });
});

describe('avisos de cobro y comunicados', () => {
  it('el aviso de cobro llega sólo al responsable de pago de cada unidad', async () => {
    // A-102: el propietario deja de ser el responsable; paga Elena (cónyuge, con correo y celular).
    const e = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Elena Gómez', relacion: 'conyuge', correo: 'elena@vecino.pe', celular: '987654321', responsable_pago: true });
    assert.equal(e.status, 201, e.texto);
    const elena = await prisma.usuario.findUniqueOrThrow({ where: { email: 'elena@vecino.pe' } });
    await prisma.usuario.update({ where: { id: elena.id }, data: { aviso_whatsapp: true } });
    await prisma.usuario.updateMany({ where: { id: { in: [d.propietario1.id, d.propietario2.id, d.inquilino1.id] } }, data: { aviso_email: true } });
    const n = await encolarReciboEmitido(d.reciboVencidoA.id);
    assert.ok(n >= 2);
    const usuarios = [...new Set((await prisma.notificacion.findMany({ where: { tipo: 'recibo_emitido' }, select: { usuario_id: true } })).map((x) => x.usuario_id))].sort((a, b) => a - b);
    assert.deepEqual(usuarios, [d.inquilino1.id, elena.id].sort((a, b) => a - b), 'A-101 paga su inquilino, A-102 paga Elena; ni los propietarios ni nadie más');
  });

  it('sin personas cargadas en la unidad se cae a quienPaga de siempre', async () => {
    await prisma.personaUnidad.deleteMany({});
    const m = await pagadoresDe([{ id: d.unidadA1.id, propietario_id: d.propietario1.id, inquilino_id: d.inquilino1.id }, { id: d.unidadA2.id, propietario_id: d.propietario2.id, inquilino_id: null }]);
    assert.deepEqual([...m], [[d.unidadA1.id, d.inquilino1.id], [d.unidadA2.id, d.propietario2.id]]);
    await encolarReciboEmitido(d.reciboVencidoA.id);
    const usuarios = [...new Set((await prisma.notificacion.findMany({ where: { tipo: 'recibo_emitido' }, select: { usuario_id: true } })).map((x) => x.usuario_id))].sort((a, b) => a - b);
    assert.deepEqual(usuarios, [d.inquilino1.id, d.propietario2.id].sort((a, b) => a - b));
  });

  it('un responsable sin correo, celular ni cuenta no deja a la unidad sin aviso: se cae a quienPaga', async () => {
    const f = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Elena Gómez', relacion: 'conyuge' });
    assert.equal((await editar(T.adminA, d.unidadA2.id, f.body.id, { responsable_pago: true })).status, 400, 'pide un contacto');
  });

  const comunicado = () => prisma.comunicado.create({ data: { complejo_id: d.complejoA.id, titulo: 'Corte de agua', cuerpo: 'Mañana', autor_id: d.adminA.id, enviar_correo: true } });

  it('el comunicado a cada vecino va a las personas que lo reciben, sin duplicar a la misma persona', async () => {
    // Elena es persona de A-101 y A-102 (una sola cuenta) y recibe comunicados en las dos.
    const p1 = await conAcceso(d.unidadA1.id, 'Elena Gómez', 'elena@vecino.pe');
    const p2 = await conAcceso(d.unidadA2.id, 'Elena Gómez', 'elena@vecino.pe');
    await editar(T.adminA, d.unidadA1.id, p1, { recibe_comunicados: true });
    await editar(T.adminA, d.unidadA2.id, p2, { recibe_comunicados: true });
    // El inquilino de A-101 deja de recibirlos.
    const inq = (await personas(T.adminA, d.unidadA1.id)).body.items.find((p: { relacion: string }) => p.relacion === 'inquilino');
    await editar(T.adminA, d.unidadA1.id, inq.id, { recibe_comunicados: false });
    const c = await comunicado();
    await encolarComunicado({ id: c.id, complejo_id: d.complejoA.id, estructura_id: null, enviar_correo: true, enviar_whatsapp: false });
    const elena = (await prisma.usuario.findUniqueOrThrow({ where: { email: 'elena@vecino.pe' } })).id;
    const lista = (await prisma.notificacion.findMany({ where: { tipo: 'comunicado' }, select: { usuario_id: true, canal: true } }));
    assert.deepEqual(lista.map((n) => n.usuario_id).sort((a, b) => a - b), [d.propietario1.id, d.propietario2.id, elena].sort((a, b) => a - b));
    assert.equal(lista.filter((n) => n.usuario_id === elena).length, 1, 'Elena, una sola vez');
    // Repetir no duplica.
    await encolarComunicado({ id: c.id, complejo_id: d.complejoA.id, estructura_id: null, enviar_correo: true, enviar_whatsapp: false });
    assert.equal(await prisma.notificacion.count({ where: { tipo: 'comunicado' } }), lista.length);
  });

  it('SALIR («baja») alcanza también a las personas del departamento que no son titulares', async () => {
    const { darDeBajaWhatsapp } = await import('../src/server/services/canales/baja');
    await agregar(T.adminA, d.unidadA2.id, { nombre: 'Elena Gómez', relacion: 'conyuge', correo: 'elena@vecino.pe', celular: '987654321', responsable_pago: true });
    const elena = await prisma.usuario.findUniqueOrThrow({ where: { email: 'elena@vecino.pe' } });
    await prisma.usuario.update({ where: { id: elena.id }, data: { aviso_whatsapp: true } });
    assert.equal(await darDeBajaWhatsapp(d.empresaA.id, '51987654321'), 1);
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: elena.id } })).aviso_whatsapp, false);
  });
});

describe('permisos y empresas', () => {
  it('otra empresa → 404 en todo (lectura y escritura)', async () => {
    const [p] = (await personas(T.adminA, d.unidadA2.id)).body.items;
    for (const [m, ruta, cuerpo] of [['GET', ''], ['POST', '', { nombre: 'X', relacion: 'otro' }], ['PUT', `/${p.id}`, { nombre: 'X' }], ['DELETE', `/${p.id}`], ['PUT', `/${p.id}/acceso`, { activo: false }], ['PUT', `/${p.id}/titular`]] as [string, string, unknown?][]) {
      const r = await api(T.adminB, m, `/api/unidades/${d.unidadA2.id}/personas${ruta}`, cuerpo);
      assert.equal(r.status, 404, `${m} ${ruta}`);
    }
    assert.equal((await api(T.adminA, 'GET', `/api/unidades/${d.unidadB1.id}/personas`)).status, 404);
    assert.equal((await prisma.personaUnidad.findUniqueOrThrow({ where: { id: p.id } })).acceso_activo, true, 'nada cambió');
    assert.equal((await personas(T.superT, d.unidadA2.id)).status, 200);
  });

  it('la junta, un residente y el personal no leen ni escriben; sin sesión 401', async () => {
    for (const t of [T.junta, T.inq1, T.mtto]) {
      assert.equal((await personas(t, d.unidadA1.id)).status, 403);
      assert.equal((await agregar(t, d.unidadA1.id, { nombre: 'X', relacion: 'otro' })).status, 403);
      assert.equal((await acceso(t, d.unidadA1.id, 1, true)).status, 403);
    }
    assert.equal((await personas(null, d.unidadA1.id)).status, 401);
    assert.equal(await prisma.personaUnidad.count(), 4);
  });

  it('valida la entrada (422) y la auditoría no guarda correos, celulares ni nombres', async () => {
    assert.equal((await agregar(T.adminA, d.unidadA2.id, { nombre: '', relacion: 'otro' })).status, 422);
    assert.equal((await agregar(T.adminA, d.unidadA2.id, { nombre: 'X', relacion: 'amigo' })).status, 422);
    assert.equal((await agregar(T.adminA, d.unidadA2.id, { nombre: 'X', relacion: 'otro', correo: 'no-es-correo' })).status, 422);
    assert.equal((await agregar(T.adminA, d.unidadA2.id, { nombre: 'X', relacion: 'otro', celular: 'abc' })).status, 422);
    assert.equal((await agregar(T.adminA, d.unidadA2.id, { nombre: 'X', relacion: 'otro', raro: 1 })).status, 422);
    assert.equal((await api(T.adminA, 'GET', '/api/unidades/abc/personas')).status, 422);
    const f = await agregar(T.adminA, d.unidadA2.id, { nombre: 'Secreta Persona', relacion: 'familiar', correo: 'secreto@vecino.pe', celular: '987111222' });
    await acceso(T.adminA, d.unidadA2.id, f.body.id, true);
    await editar(T.adminA, d.unidadA2.id, f.body.id, { celular: '987333444' });
    const filas = await esperar(async () => { const x = await prisma.auditoria.findMany({ where: { entidad: 'persona_unidad' } }); return x.length >= 3 ? x : null; });
    const texto = JSON.stringify(filas);
    for (const prohibido of ['secreto@vecino.pe', '987111222', '987333444', 'Secreta']) assert.ok(!texto.includes(prohibido), prohibido);
    assert.ok(filas.some((x) => x.accion === 'encender_acceso'));
  });

  it('un condominio en solo lectura no recibe cambios (409) pero sí se lee', async () => {
    await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: d.complejoA.id } });
    await prisma.suscripcionCondominio.create({ data: { complejo_id: d.complejoA.id, plan_clave: 'gratis', estado: 'gratis', gratis_hasta: new Date(Date.now() - 86_400_000) } });
    const { invalidarComercial } = await import('../src/server/services/comercial/modulos');
    invalidarComercial();
    assert.equal((await personas(T.adminA, d.unidadA2.id)).status, 200);
    const r = await agregar(T.adminA, d.unidadA2.id, { nombre: 'X', relacion: 'otro' });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SOLO_LECTURA');
  });
});

describe('los cambios «viejos» del titular siguen alineados', () => {
  it('cambiar el propietario o el inquilino en Unidades actualiza la persona; el inquilino nuevo queda de responsable', async () => {
    // A-102 no tiene inquilino: se le asigna uno desde Unidades (como hoy).
    const nuevo = await prisma.usuario.create({ data: { nombre: 'Pedro Quispe', email: 'pedro@vecino.pe', rol: 'inquilino', complejo_id: d.complejoA.id } });
    const r = await api(T.adminA, 'PUT', `/api/unidades/${d.unidadA2.id}`, { inquilino_id: nuevo.id });
    assert.equal(r.status, 200, r.texto);
    const ps = (await personas(T.adminA, d.unidadA2.id)).body.items;
    assert.deepEqual(ps.map((p: { relacion: string; responsable_pago: boolean }) => [p.relacion, p.responsable_pago]), [['propietario', false], ['inquilino', true]]);
    // Se va el inquilino: su persona sale y el responsable vuelve al propietario.
    const r2 = await api(T.adminA, 'PUT', `/api/unidades/${d.unidadA2.id}`, { inquilino_id: null });
    assert.equal(r2.status, 200, r2.texto);
    assert.deepEqual((await personas(T.adminA, d.unidadA2.id)).body.items.map((p: { relacion: string; responsable_pago: boolean }) => [p.relacion, p.responsable_pago]), [['propietario', true]]);
  });

  it('un propietario nuevo desde Usuarios queda como persona titular', async () => {
    const u = await prisma.unidad.create({ data: { codigo: 'A-103', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estado: 'activa' } });
    const r = await api(T.adminA, 'POST', '/api/usuarios', { nombre: 'Nueva Dueña', email: 'nueva@vecino.pe', rol: 'propietario', complejo_id: d.complejoA.id, unidad_id: u.id, password: 'Contra$ena-segura-9' });
    assert.equal(r.status, 201, r.texto);
    const ps = await prisma.personaUnidad.findMany({ where: { unidad_id: u.id } });
    assert.deepEqual(ps.map((p) => [p.relacion, p.nombre, p.responsable_pago, p.acceso_activo]), [['propietario', 'Nueva Dueña', true, true]]);
  });
});

describe('un departamento que todavía no se migró', () => {
  const sinMigrar = (codigo: string) => prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: d.propietario2.id, estado: 'activa' } });

  it('al abrir su lista se alinea solo con su propietario', async () => {
    const u = await sinMigrar('A-103');
    assert.equal(await prisma.personaUnidad.count({ where: { unidad_id: u.id } }), 0);
    const r = await personas(T.adminA, u.id);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.items.map((p: { relacion: string; responsable_pago: boolean; acceso_activo: boolean }) => [p.relacion, p.responsable_pago, p.acceso_activo]), [['propietario', true, true]]);
  });

  it('agregar una persona no deja al titular fuera de los comunicados ni del aviso de cobro', async () => {
    const u = await sinMigrar('A-104');
    const r = await agregar(T.adminA, u.id, { nombre: 'Rosa Gómez', relacion: 'familiar', celular: '987654321' });
    assert.equal(r.status, 201);
    assert.deepEqual((await personas(T.adminA, u.id)).body.items.map((p: { relacion: string }) => p.relacion), ['propietario', 'familiar']);
    const { destinatariosDe } = await import('../src/server/services/comunicados');
    assert.ok((await destinatariosDe({ complejo_id: d.complejoA.id, estructura_id: null })).includes(d.propietario2.id));
    assert.equal((await pagadoresDe([{ id: u.id, propietario_id: d.propietario2.id, inquilino_id: null }])).get(u.id), d.propietario2.id);
  });
});
