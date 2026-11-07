import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import { CAMPOS_DE_AMBITO, CODIGO_CAMPO_DE_AMBITO, exigirMismoAmbito, rechazarAmbito } from '../src/server/lib/ambito';

// S1 de la simulación de mercado: un PUT/POST con un campo de ámbito (empresa_id, complejo_id, estructura_id) que el endpoint no acepta
// ya no responde 200/201 «ignorándolo»: es 422 con código CAMPO_DE_AMBITO. Con el MISMO valor que ya tiene el recurso, se acepta.

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'super' | 'prop1', string>;
let medioId: number;
let comunicadoId: number;
let proveedorId: number;

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = {
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    super: await login(base, 'super@test.pe'),
    prop1: await login(base, 'prop1@test.pe'),
  };
  const medio = await llama(T.adminA, 'POST', '/api/medios-pago', { tipo: 'yape', celular: '987654321', titular: 'María Pérez', complejo_id: d.complejoA.id });
  assert.equal(medio.status, 201, medio.texto);
  medioId = medio.body.id;
  const com = await llama(T.adminA, 'POST', '/api/comunicados', { titulo: 'Corte de agua', cuerpo: 'El sábado no habrá agua por mantenimiento de la cisterna.', complejo_id: d.complejoA.id });
  assert.equal(com.status, 201, com.texto);
  comunicadoId = com.body.id;
  proveedorId = (await prisma.proveedor.create({ data: { razon_social: 'Gasfitería A', rubro: 'otros', empresa_id: d.empresaA.id } })).id;
});

after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);

/** 422 con el código estable y el campo señalado en `campos`. */
function rechazado(r: { status: number; body: any }, campo: string) { // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.equal(r.body.code, CODIGO_CAMPO_DE_AMBITO, JSON.stringify(r.body));
  assert.ok(campo in r.body.campos, JSON.stringify(r.body));
  assert.match(r.body.error, new RegExp(`${campo}:`));
}

describe('S1: campos de ámbito estrictos', () => {
  describe('unidades', () => {
    it('PUT con empresa_id ajeno → 422 y la unidad queda igual; con el mismo, 200', async () => {
      const antes = await prisma.unidad.findUniqueOrThrow({ where: { id: d.unidadA1.id } });
      rechazado(await llama(T.adminA, 'PUT', `/api/unidades/${d.unidadA1.id}`, { descripcion: 'cambio', empresa_id: d.empresaB.id }), 'empresa_id');
      assert.deepEqual(await prisma.unidad.findUniqueOrThrow({ where: { id: d.unidadA1.id } }), antes, 'no se aplicó nada');
      const ok = await llama(T.adminA, 'PUT', `/api/unidades/${d.unidadA1.id}`, { descripcion: 'cambio', empresa_id: d.empresaA.id });
      assert.equal(ok.status, 200, ok.texto);
      assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: d.unidadA1.id } })).descripcion, 'cambio');
    });
    it('PATCH también; y una unidad de OTRO cliente sigue siendo 404 (no se revela con el 422)', async () => {
      rechazado(await llama(T.adminA, 'PATCH', `/api/unidades/${d.unidadA1.id}`, { empresa_id: d.empresaB.id }), 'empresa_id');
      assert.equal((await llama(T.adminA, 'PUT', `/api/unidades/${d.unidadB1.id}`, { empresa_id: d.empresaB.id })).status, 404);
    });
    it('POST con empresa_id → 422 y no se crea', async () => {
      const n = await prisma.unidad.count();
      rechazado(await llama(T.adminA, 'POST', '/api/unidades', { codigo: 'A-900', tipo: 'departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaB.id }), 'empresa_id');
      assert.equal(await prisma.unidad.count(), n);
    });
    it('complejo_id de otro cliente sigue rechazado (422) y la unidad no se mueve', async () => {
      const r = await llama(T.adminA, 'PUT', `/api/unidades/${d.unidadA1.id}`, { complejo_id: d.complejoB.id });
      assert.equal(r.status, 422, r.texto);
      assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: d.unidadA1.id } })).complejo_id, d.complejoA.id);
    });
  });

  describe('usuarios', () => {
    it('PUT al personal con empresa_id ajeno → 422 y no cambia; con la propia, 200', async () => {
      const antes = await prisma.usuario.findUniqueOrThrow({ where: { id: d.mantenimientoA.id } });
      rechazado(await llama(T.adminA, 'PUT', `/api/usuarios/${d.mantenimientoA.id}`, { nombre: 'Otro nombre', empresa_id: d.empresaB.id }), 'empresa_id');
      assert.deepEqual(await prisma.usuario.findUniqueOrThrow({ where: { id: d.mantenimientoA.id } }), antes);
      const ok = await llama(T.adminA, 'PUT', `/api/usuarios/${d.mantenimientoA.id}`, { nombre: 'Otro nombre', empresa_id: d.empresaA.id });
      assert.equal(ok.status, 200, ok.texto);
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: d.mantenimientoA.id } })).empresa_id, d.empresaA.id);
    });
    it('PUT a un residente con empresa_id ajeno → 422; el superadmin tampoco puede darle empresa', async () => {
      rechazado(await llama(T.adminA, 'PUT', `/api/usuarios/${d.propietario2.id}`, { empresa_id: d.empresaB.id }), 'empresa_id');
      const r = await llama(T.super, 'PUT', `/api/usuarios/${d.propietario2.id}`, { empresa_id: d.empresaB.id });
      assert.equal(r.status, 422, r.texto);
      assert.match(r.body.error, /no tiene empresa propia/);
      assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: d.propietario2.id } })).empresa_id, d.empresaA.id, 'sin cambios');
    });
    it('POST con empresa_id ajeno → 422 y no se crea el usuario', async () => {
      const n = await prisma.usuario.count();
      rechazado(await llama(T.adminA, 'POST', '/api/usuarios', { nombre: 'Nuevo', email: 'nuevo.a@test.pe', rol: 'seguridad', empresa_id: d.empresaB.id }), 'empresa_id');
      assert.equal(await prisma.usuario.count(), n);
    });
    it('el superadmin sí elige la empresa del personal que crea (lo hace la pantalla)', async () => {
      const r = await llama(T.super, 'POST', '/api/usuarios', { nombre: 'Guardia B', email: 'guardia.b@test.pe', rol: 'seguridad', empresa_id: d.empresaB.id });
      assert.equal(r.status, 201, r.texto);
      assert.equal(r.body.empresa_id, d.empresaB.id);
    });
  });

  describe('comunicados', () => {
    it('PUT con complejo_id/empresa_id ajeno → 422 y el comunicado queda igual; con el mismo condominio, 200', async () => {
      const antes = await prisma.comunicado.findUniqueOrThrow({ where: { id: comunicadoId } });
      rechazado(await llama(T.adminA, 'PUT', `/api/comunicados/${comunicadoId}`, { titulo: 'Nuevo título', complejo_id: d.complejoB.id }), 'complejo_id');
      rechazado(await llama(T.adminA, 'PUT', `/api/comunicados/${comunicadoId}`, { titulo: 'Nuevo título', empresa_id: d.empresaB.id }), 'empresa_id');
      assert.deepEqual(await prisma.comunicado.findUniqueOrThrow({ where: { id: comunicadoId } }), antes);
      const ok = await llama(T.adminA, 'PUT', `/api/comunicados/${comunicadoId}`, { titulo: 'Nuevo título', complejo_id: d.complejoA.id });
      assert.equal(ok.status, 200, ok.texto);
      assert.equal((await prisma.comunicado.findUniqueOrThrow({ where: { id: comunicadoId } })).titulo, 'Nuevo título');
    });
    it('POST con empresa_id → 422 y no se publica nada', async () => {
      const n = await prisma.comunicado.count();
      rechazado(await llama(T.adminA, 'POST', '/api/comunicados', { titulo: 'X', cuerpo: 'Texto del aviso para todos.', complejo_id: d.complejoA.id, empresa_id: d.empresaB.id }), 'empresa_id');
      assert.equal(await prisma.comunicado.count(), n);
    });
  });

  describe('conceptos', () => {
    it('PUT con empresa_id ajeno → 422 y el concepto queda igual; con la propia, 200', async () => {
      const antes = await prisma.concepto.findUniqueOrThrow({ where: { id: d.conceptoA.id } });
      rechazado(await llama(T.adminA, 'PUT', `/api/conceptos/${d.conceptoA.id}`, { nombre: 'Renombrado', empresa_id: d.empresaB.id }), 'empresa_id');
      assert.deepEqual(await prisma.concepto.findUniqueOrThrow({ where: { id: d.conceptoA.id } }), antes);
      const ok = await llama(T.adminA, 'PUT', `/api/conceptos/${d.conceptoA.id}`, { nombre: 'Renombrado', empresa_id: d.empresaA.id });
      assert.equal(ok.status, 200, ok.texto);
      assert.equal(ok.body.empresa_id, d.empresaA.id);
    });
    it('POST con empresa_id ajeno → 422 (ya no lo crea en SU empresa); con la propia, 201', async () => {
      const n = await prisma.concepto.count();
      rechazado(await llama(T.adminA, 'POST', '/api/conceptos', { nombre: 'Fondo', empresa_id: d.empresaB.id }), 'empresa_id');
      assert.equal(await prisma.concepto.count(), n, 'no se creó en ninguna empresa');
      const ok = await llama(T.adminA, 'POST', '/api/conceptos', { nombre: 'Fondo', empresa_id: d.empresaA.id });
      assert.equal(ok.status, 201, ok.texto);
      assert.equal(ok.body.empresa_id, d.empresaA.id);
    });
    it('sin empresa_id sigue funcionando (es lo que manda la pantalla)', async () => {
      assert.equal((await llama(T.adminA, 'POST', '/api/conceptos', { nombre: 'Sin empresa en el cuerpo' })).status, 201);
    });
  });

  describe('recibos', () => {
    it('PUT con empresa_id o complejo_id ajeno → 422 y el recibo queda igual; con el mismo complejo, 200', async () => {
      const antes = await prisma.recibo.findUniqueOrThrow({ where: { id: d.reciboVencidoA.id } });
      rechazado(await llama(T.adminA, 'PUT', `/api/recibos/${d.reciboVencidoA.id}`, { descripcion: 'x', empresa_id: d.empresaB.id }), 'empresa_id');
      rechazado(await llama(T.adminA, 'PUT', `/api/recibos/${d.reciboVencidoA.id}`, { descripcion: 'x', complejo_id: d.complejoB.id }), 'complejo_id');
      assert.deepEqual(await prisma.recibo.findUniqueOrThrow({ where: { id: d.reciboVencidoA.id } }), antes);
      const ok = await llama(T.adminA, 'PUT', `/api/recibos/${d.reciboVencidoA.id}`, { descripcion: 'x', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id });
      assert.equal(ok.status, 200, ok.texto);
    });
    it('POST (emitir) con empresa_id → 422 y no se emite nada', async () => {
      const n = await prisma.recibo.count();
      rechazado(await llama(T.adminA, 'POST', '/api/recibos', { complejo_id: d.complejoA.id, empresa_id: d.empresaB.id, mes: 11, anio: 2026, fecha_emision: '2026-11-01', fecha_vencimiento: '2026-11-15', conceptos: [{ concepto_id: d.conceptoA.id, monto: 100 }] }), 'empresa_id');
      assert.equal(await prisma.recibo.count(), n);
    });
  });

  describe('medios de pago', () => {
    it('PUT con empresa_id/complejo_id ajeno → 422 y el medio no cambia de condominio; con el mismo, 200', async () => {
      const cuerpo = { tipo: 'yape', celular: '987654321', titular: 'María Pérez' };
      rechazado(await llama(T.adminA, 'PUT', `/api/medios-pago/${medioId}`, { ...cuerpo, complejo_id: d.complejoB.id }), 'complejo_id');
      rechazado(await llama(T.adminA, 'PUT', `/api/medios-pago/${medioId}`, { ...cuerpo, empresa_id: d.empresaB.id }), 'empresa_id');
      assert.equal((await prisma.medioPago.findUniqueOrThrow({ where: { id: medioId } })).complejo_id, d.complejoA.id);
      const ok = await llama(T.adminA, 'PUT', `/api/medios-pago/${medioId}`, { ...cuerpo, titular: 'María P.', complejo_id: d.complejoA.id, estructura_id: null });
      assert.equal(ok.status, 200, ok.texto);
      assert.equal((await prisma.medioPago.findUniqueOrThrow({ where: { id: medioId } })).titular, 'María P.');
    });
    it('PATCH con complejo_id ajeno → 422; POST con empresa_id → 422', async () => {
      rechazado(await llama(T.adminA, 'PATCH', `/api/medios-pago/${medioId}`, { activo: false, complejo_id: d.complejoB.id }), 'complejo_id');
      assert.equal((await prisma.medioPago.findUniqueOrThrow({ where: { id: medioId } })).activo, true);
      const n = await prisma.medioPago.count();
      rechazado(await llama(T.adminA, 'POST', '/api/medios-pago', { tipo: 'plin', celular: '987654322', titular: 'Otra', complejo_id: d.complejoA.id, empresa_id: d.empresaB.id }), 'empresa_id');
      assert.equal(await prisma.medioPago.count(), n);
    });
  });

  describe('otras rutas con el mismo patrón', () => {
    it('proveedores: la empresa no se cambia (PUT) ni se elige con empresa ajena (POST de la administradora)', async () => {
      rechazado(await llama(T.adminA, 'PUT', `/api/proveedores/${proveedorId}`, { empresa_id: d.empresaB.id }), 'empresa_id');
      assert.equal((await prisma.proveedor.findUniqueOrThrow({ where: { id: proveedorId } })).empresa_id, d.empresaA.id);
      assert.equal((await llama(T.adminA, 'PUT', `/api/proveedores/${proveedorId}`, { empresa_id: d.empresaA.id })).status, 200);
      const n = await prisma.proveedor.count();
      rechazado(await llama(T.adminA, 'POST', '/api/proveedores', { razon_social: 'Pintura SAC', rubro: 'otros', empresa_id: d.empresaB.id }), 'empresa_id');
      assert.equal(await prisma.proveedor.count(), n);
    });
    it('condominios: la administradora no se cambia por el PUT (ni siquiera el superadmin); con la misma, 200', async () => {
      for (const t of [T.adminA, T.super]) {
        const r = await llama(t, 'PUT', `/api/complejos/${d.complejoA.id}`, { nombre: 'Complejo A', empresa_id: d.empresaB.id });
        assert.equal(r.status, 422, r.texto);
        assert.equal((await prisma.complejoHabitacional.findUniqueOrThrow({ where: { id: d.complejoA.id } })).empresa_id, d.empresaA.id);
      }
      assert.equal((await llama(T.adminA, 'PUT', `/api/complejos/${d.complejoA.id}`, { nombre: 'Complejo A', empresa_id: d.empresaA.id })).status, 200);
    });
    it('condominios: el POST de la administradora con empresa_id ajeno → 422', async () => {
      const n = await prisma.complejoHabitacional.count();
      rechazado(await llama(T.adminB, 'POST', '/api/complejos', { nombre: 'Colado', tipo: 'Edificio', empresa_id: d.empresaA.id }), 'empresa_id');
      assert.equal(await prisma.complejoHabitacional.count(), n);
    });
    it('áreas comunes: el condominio no se cambia (PATCH); con el mismo, 200; POST con empresa_id → 422', async () => {
      const a = await llama(T.adminA, 'POST', '/api/areas-comunes', { complejo_id: d.complejoA.id, nombre: 'Piscina', hora_apertura: '09:00', hora_cierre: '20:00' });
      assert.equal(a.status, 201, a.texto);
      rechazado(await llama(T.adminA, 'PATCH', `/api/areas-comunes/${a.body.id}`, { nombre: 'Piscina 2', complejo_id: d.complejoB.id }), 'complejo_id');
      assert.equal((await prisma.areaComun.findUniqueOrThrow({ where: { id: a.body.id } })).nombre, 'Piscina');
      assert.equal((await llama(T.adminA, 'PATCH', `/api/areas-comunes/${a.body.id}`, { nombre: 'Piscina 2', complejo_id: d.complejoA.id })).status, 200);
      const n = await prisma.areaComun.count();
      rechazado(await llama(T.adminA, 'POST', '/api/areas-comunes', { complejo_id: d.complejoA.id, nombre: 'Sauna', hora_apertura: '09:00', hora_cierre: '20:00', empresa_id: d.empresaB.id }), 'empresa_id');
      assert.equal(await prisma.areaComun.count(), n);
    });
    it('juntas: la junta no cambia de condominio ni de block (PUT); POST con empresa_id → 422', async () => {
      const n = await prisma.juntaDirectiva.count();
      rechazado(await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, desde: '2026-01-01', miembros: [], empresa_id: d.empresaB.id }), 'empresa_id');
      assert.equal(await prisma.juntaDirectiva.count(), n);
      const j = await llama(T.adminA, 'POST', '/api/juntas', { complejo_id: d.complejoA.id, desde: '2026-01-01', miembros: [] });
      assert.equal(j.status, 201, j.texto);
      rechazado(await llama(T.adminA, 'PUT', `/api/juntas/${j.body.id}`, { notas: 'x', complejo_id: d.complejoB.id }), 'complejo_id');
      assert.equal((await llama(T.adminA, 'PUT', `/api/juntas/${j.body.id}`, { notas: 'x', complejo_id: d.complejoA.id })).status, 200);
    });
    it('estructuras: complejo_id ajeno en PUT sigue siendo 422', async () => {
      const e = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
      const r = await llama(T.adminA, 'PUT', `/api/estructuras/${e.id}`, { complejo_id: d.complejoB.id });
      assert.equal(r.status, 422, r.texto);
      assert.equal((await prisma.estructura.findUniqueOrThrow({ where: { id: e.id } })).complejo_id, d.complejoA.id);
    });
  });
});

describe('S1: la regla central (unidad)', () => {
  it('los campos de ámbito que el esquema declara los valida la ruta, no se rechazan aquí', () => {
    assert.doesNotThrow(() => rechazarAmbito({ complejo_id: 5, estructura_id: null }, { permitidos: ['complejo_id', 'estructura_id'] }));
  });
  it('al crear, uno no declarado sobra (aunque sea null)', () => {
    for (const campo of CAMPOS_DE_AMBITO) assert.throws(() => rechazarAmbito({ [campo]: null }), { status: 422, code: CODIGO_CAMPO_DE_AMBITO });
  });
  it('al editar: igual al actual (número o texto) pasa; distinto o ausente en la fila no', () => {
    assert.doesNotThrow(() => rechazarAmbito({ empresa_id: '7' }, { actual: { empresa_id: 7 } }));
    assert.doesNotThrow(() => rechazarAmbito({ estructura_id: null }, { actual: { estructura_id: null } }));
    assert.throws(() => rechazarAmbito({ empresa_id: 8 }, { actual: { empresa_id: 7 } }), { status: 422 });
    assert.throws(() => rechazarAmbito({ estructura_id: 3 }, { actual: { estructura_id: null } }), { status: 422 });
    assert.throws(() => rechazarAmbito({ empresa_id: 3 }, { actual: {} }), { status: 422 });
  });
  it('sin campos de ámbito, o un cuerpo que no es objeto, no hace nada (el esquema se queja)', () => {
    assert.doesNotThrow(() => rechazarAmbito({ nombre: 'x' }));
    assert.doesNotThrow(() => rechazarAmbito(null));
    assert.doesNotThrow(() => rechazarAmbito([{ empresa_id: 1 }]));
  });
  it('exigirMismoAmbito: sin valor no hace nada; igual pasa; distinto es 422 con el mensaje que corresponde', () => {
    assert.doesNotThrow(() => exigirMismoAmbito('empresa_id', undefined, 1, 'crear'));
    assert.doesNotThrow(() => exigirMismoAmbito('empresa_id', 1, 1, 'cambiar'));
    assert.throws(() => exigirMismoAmbito('empresa_id', 2, 1, 'crear'), /se toma de tu cuenta/);
    assert.throws(() => exigirMismoAmbito('empresa_id', 2, 1, 'cambiar'), /No se puede cambiar la empresa/);
  });
});
