// Cierre del mes por block. Lo facturado al block (suma de los cargos de cada concepto) y lo cobrado; el tesorero del block registra sus pagos CON voucher (a la empresa
// administradora y a la Junta central por lo facturado, agua y luz por la boleta, proveedores por la factura). La conformidad: la administración en el pago a la empresa
// administradora y el tesorero central en el aporte a la Junta central, nunca a su propio registro; servicios y proveedores no la llevan. Multas y fondo de contingencia del
// block van al Fondo de ahorros (no se pagan). La administración lo ve todo; otro block u otra empresa → 404. Sobrante del mes y Fondo de ahorros. Recordatorio el día 5.
import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import { cabecerasDeSesion, iniciar, llamar, login, PASSWORD, prisma, sembrar, type Datos } from './helpers/app';
import { pngUnico } from './helpers/pagoResidente';
import { encolarCierresPendientes } from '../src/server/services/avisos/cierres';
import { sugerirDestino } from '../src/server/services/cierres/destinos';

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let e1: { id: number };
let e2: { id: number };
let eB: { id: number };
let T: Record<'adminA' | 'adminB' | 'prop1' | 'tesor1' | 'presi1' | 'secre1' | 'vocal1' | 'tesor2' | 'presi2' | 'central' | 'presiCentral' | 'tesorB', string>;
let ids: Record<'tesor1' | 'central', number>;
const C: Record<string, { id: number }> = {};
let proveedorA: { id: number };

const llama = (t: string | null, metodo: string, ruta: string, cuerpo?: unknown) => llamar(base, metodo, ruta, t, cuerpo);

async function recibo(estructuraId: number, mes: number, anio: number, partidas: { concepto: { id: number }; recargo?: boolean; cargos: [number, number, string][] }[], complejo = d.complejoA, empresa = d.empresaA) {
  const r = await prisma.recibo.create({ data: { empresa_id: empresa.id, complejo_id: complejo.id, estructura_id: estructuraId, mes, anio, fecha_emision: new Date(Date.UTC(anio, mes - 1, 1)), fecha_vencimiento: new Date(Date.UTC(anio, mes - 1, 20)), estado: 'emitido' } });
  let orden = 0;
  for (const p of partidas) {
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: r.id, concepto_id: p.concepto.id, monto: p.cargos.reduce((s, c) => s + c[1], 0), es_recargo: p.recargo ?? false, orden: ++orden } });
    for (const [unidad_id, monto, estado_pago] of p.cargos) await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id, monto, estado_pago } });
  }
  return r;
}

type Campos = Record<string, string | number | undefined>;
/** Registra el pago de una línea como la pantalla: multipart con los campos y el voucher en `voucher` (`archivo: null` = sin archivo). */
async function registrar(token: string | null, estructuraId: number, campos: Campos, archivo: { bytes: Buffer; tipo: string; nombre: string } | null = { bytes: pngUnico(), tipo: 'image/png', nombre: 'voucher.png' }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries({ fecha_pago: '2026-10-02', referencia: 'OP-1', ...campos })) if (v !== undefined) fd.append(k, String(v));
  if (archivo) fd.append('voucher', new Blob([new Uint8Array(archivo.bytes)], { type: archivo.tipo }), archivo.nombre);
  const r = await fetch(`${base}/api/cierres/block/${estructuraId}/lineas`, { method: 'POST', headers: cabecerasDeSesion(token), body: fd });
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* sin JSON */ }
  return { status: r.status, body, texto };
}

const detalle = (t: string | null, estructuraId: number, mes = 9, anio = 2026) => llama(t, 'GET', `/api/cierres/block/${estructuraId}?mes=${mes}&anio=${anio}`);
const linea = (r: { body: any }, clave: string) => (r.body.lineas as any[]).find((l) => l.linea === clave); // eslint-disable-line @typescript-eslint/no-explicit-any

before(async () => {
  d = await sembrar();
  e1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'Block', complejo_id: d.complejoA.id } });
  e2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'Block', complejo_id: d.complejoA.id } });
  eB = await prisma.estructura.create({ data: { nombre: 'Block B', tipo: 'Block', complejo_id: d.complejoB.id } });
  await prisma.unidad.update({ where: { id: d.unidadA1.id }, data: { estructura_id: e1.id } });
  await prisma.unidad.update({ where: { id: d.unidadA2.id }, data: { estructura_id: e2.id } });
  const unidad1b = await prisma.unidad.create({ data: { codigo: 'A-103', tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, estructura_id: e1.id, propietario_id: d.propietario2.id, estado: 'activa' } });
  const unidadBB = await prisma.unidad.create({ data: { codigo: 'B-102', tipo: 'Departamento', complejo_id: d.complejoB.id, empresa_id: d.empresaB.id, estructura_id: eB.id, propietario_id: d.propietarioB.id, estado: 'activa' } });
  proveedorA = await prisma.proveedor.create({ data: { empresa_id: d.empresaA.id, razon_social: 'Ascensores SAC', rubro: 'ascensores' } });

  const hash = await bcrypt.hash(PASSWORD, 4);
  const junta = async (nombre: string, email: string, cargo: string, complejo: { id: number; empresa_id: number | null }, estructura_id: number | null) =>
    (await prisma.usuario.create({ data: { nombre, email, rol: 'propietario', password_hash: hash, empresa_id: complejo.empresa_id, complejo_id: complejo.id, cargo_junta: cargo, estructura_id } })).id;
  ids = { tesor1: await junta('Tesorero 1', 'tesor1@test.pe', 'tesorero', d.complejoA, e1.id), central: await junta('Tesorero central', 'central@test.pe', 'tesorero', d.complejoA, null) };
  await junta('Presidente 1', 'presi1@test.pe', 'presidente', d.complejoA, e1.id);
  await junta('Secretario 1', 'secre1@test.pe', 'secretario', d.complejoA, e1.id);
  await junta('Vocal 1', 'vocal1@test.pe', 'vocal', d.complejoA, e1.id);
  await junta('Tesorero 2', 'tesor2@test.pe', 'tesorero', d.complejoA, e2.id);
  await junta('Presidente 2', 'presi2@test.pe', 'presidente', d.complejoA, e2.id);
  await junta('Presidente central', 'presicentral@test.pe', 'presidente', d.complejoA, null);
  await junta('Tesorero B', 'tesorb@test.pe', 'tesorero', d.complejoB, eB.id);

  // Conceptos de la empresa A con su destino (los nombres son los de la cuenta real de octubre).
  const concepto = async (nombre: string, destino: string | null, extra: Record<string, unknown> = {}) => (C[nombre] = await prisma.concepto.create({ data: { nombre, empresa_id: d.empresaA.id, destino, ...extra } }));
  await concepto('admin', 'administradora');
  await concepto('luz_comunes', 'central');
  await concepto('agua_comun', 'central');
  await concepto('fondo_condominio', 'central');
  await concepto('luz_block', 'servicio');
  await concepto('ascensor', 'proveedor', { proveedor_id: proveedorA.id });
  await concepto('fondo', 'ahorro_block');
  await concepto('seguridad', null);
  await concepto('mora', 'administradora'); // un recargo va al ahorro aunque su concepto diga otra cosa
  const uA = d.unidadA1.id;
  const uB = unidad1b.id;
  // Septiembre del Block 1: facturado 435.25 (administradora 200.25, Junta central 78, luz 100, ascensor 40, ahorro 10 + multa 7); cobrado 300.25 (ahorro 12).
  await recibo(e1.id, 9, 2026, [
    { concepto: C.admin!, cargos: [[uA, 100.1, 'pagado'], [uB, 100.15, 'pagado']] },
    { concepto: C.luz_comunes!, cargos: [[uA, 30, 'pagado'], [uB, 20, 'pendiente']] },
    { concepto: C.agua_comun!, cargos: [[uA, 10, 'pagado'], [uB, 10, 'pendiente']] },
    { concepto: C.fondo_condominio!, cargos: [[uA, 4, 'pagado'], [uB, 4, 'pagado']] },
    { concepto: C.luz_block!, cargos: [[uA, 60, 'pendiente'], [uB, 40, 'en_revision']] },
    { concepto: C.ascensor!, cargos: [[uA, 20, 'pagado'], [uB, 20, 'pagado']] },
    { concepto: C.fondo!, cargos: [[uA, 5, 'pagado'], [uB, 5, 'pendiente']] },
    { concepto: C.mora!, recargo: true, cargos: [[uB, 7, 'pagado']] },
  ]);
  // Agosto del Block 1: sólo administración, cobrado 30.
  await recibo(e1.id, 8, 2026, [{ concepto: C.admin!, cargos: [[uA, 30, 'pagado']] }]);
  // Julio: un concepto sin clasificar.
  await recibo(e1.id, 7, 2026, [{ concepto: C.admin!, cargos: [[uA, 10, 'pagado']] }, { concepto: C.seguridad!, cargos: [[uA, 12, 'pagado']] }]);
  // Septiembre del Block 2 (administradora 50 y Junta central 15) y del Block B de otro condominio.
  await recibo(e2.id, 9, 2026, [{ concepto: C.admin!, cargos: [[d.unidadA2.id, 50, 'pagado']] }, { concepto: C.luz_comunes!, cargos: [[d.unidadA2.id, 15, 'pagado']] }]);
  const cB = await prisma.concepto.create({ data: { nombre: 'admin B', empresa_id: d.empresaB.id, destino: 'administradora' } });
  await recibo(eB.id, 9, 2026, [{ concepto: cB, cargos: [[unidadBB.id, 77, 'pagado']] }], d.complejoB, d.empresaB);

  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  const entrar = (email: string) => login(base, email);
  T = {
    adminA: await entrar('admin.a@test.pe'), adminB: await entrar('admin.b@test.pe'), prop1: await entrar('prop1@test.pe'),
    tesor1: await entrar('tesor1@test.pe'), presi1: await entrar('presi1@test.pe'), secre1: await entrar('secre1@test.pe'), vocal1: await entrar('vocal1@test.pe'),
    tesor2: await entrar('tesor2@test.pe'), presi2: await entrar('presi2@test.pe'), central: await entrar('central@test.pe'), presiCentral: await entrar('presicentral@test.pe'), tesorB: await entrar('tesorb@test.pe'),
  };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('sugerencia de destino por el nombre del concepto', () => {
  const casos: [string, string | null][] = [
    ['ADMINISTRACION VRANY', 'administradora'],
    ['LUZ AREAS COMUNES DEL CONDOMINIO', 'central'],
    ['AGUA COMUN DEL CONDOMINIO', 'central'],
    ['FONDO DE CONTINGENCIA DEL CONDOMINIO', 'central'],
    ['AGUA DPTO.', 'servicio'],
    ['LUZ COMUN DEL BLOCK', 'servicio'],
    ['MANTENIMIENTO DE ASCENSOR', 'proveedor'],
    ['MANTENIMIENTO DE CISTERNA', 'proveedor'],
    ['MULTA PAGO FUERA DE FECHA', 'ahorro_block'],
    ['FONDO DE CONTINGENCIA DEL BLOCK', 'ahorro_block'],
    ['Contingencia del block', 'ahorro_block'],
    ['Luz de áreas comunes', 'central'],
    ['Agua del departamento', 'servicio'],
    ['Servicio de seguridad', null],
    ['Mantenimiento', null],
  ];
  for (const [nombre, esperado] of casos) it(`${nombre} → ${esperado ?? 'sin sugerencia'}`, () => assert.equal(sugerirDestino(nombre), esperado));
});

describe('destino del concepto (Conceptos, administración)', () => {
  it('se guarda el destino y el proveedor; la lista sugiere sólo lo que no está clasificado', async () => {
    const nuevo = await llama(T.adminA, 'POST', '/api/conceptos', { nombre: 'MANTENIMIENTO DE BOMBAS', tipo_monto: 'variable' });
    assert.equal(nuevo.status, 201, nuevo.texto);
    assert.equal(nuevo.body.destino, null, 'nace sin clasificar: nunca se asume');
    const lista = await llama(T.adminA, 'GET', '/api/conceptos?pageSize=100');
    const fila = lista.body.items.find((c: any) => c.id === nuevo.body.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(fila.destino, null);
    assert.equal(fila.destino_sugerido, 'proveedor');
    const clasif = lista.body.items.find((c: any) => c.id === C.admin!.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(clasif.destino, 'administradora');
    assert.equal(clasif.destino_sugerido, null, 'ya clasificado: no se sugiere');
    const ed = await llama(T.adminA, 'PUT', `/api/conceptos/${nuevo.body.id}`, { destino: 'proveedor', proveedor_id: proveedorA.id });
    assert.equal(ed.status, 200, ed.texto);
    assert.equal(ed.body.destino, 'proveedor');
    assert.equal(ed.body.proveedor_id, proveedorA.id);
  });

  it('un destino inválido (o de la versión anterior), o un proveedor de otra empresa, es 422; con otro destino el proveedor se limpia', async () => {
    assert.equal((await llama(T.adminA, 'PUT', `/api/conceptos/${C.admin!.id}`, { destino: 'inventado' })).status, 422);
    assert.equal((await llama(T.adminA, 'PUT', `/api/conceptos/${C.admin!.id}`, { destino: 'central_comunes' })).status, 422);
    const ajeno = await prisma.proveedor.create({ data: { empresa_id: d.empresaB.id, razon_social: 'Proveedor de B', rubro: 'x' } });
    const r = await llama(T.adminA, 'PUT', `/api/conceptos/${C.ascensor!.id}`, { destino: 'proveedor', proveedor_id: ajeno.id });
    assert.equal(r.status, 422, r.texto);
    const sinProv = await llama(T.adminA, 'PUT', `/api/conceptos/${C.ascensor!.id}`, { destino: 'servicio' });
    assert.equal(sinProv.status, 200);
    assert.equal(sinProv.body.proveedor_id, null);
    await llama(T.adminA, 'PUT', `/api/conceptos/${C.ascensor!.id}`, { destino: 'proveedor', proveedor_id: proveedorA.id }); // lo deja como estaba
  });

  it('un concepto de otra empresa es 404, y la junta y los residentes no clasifican', async () => {
    assert.equal((await llama(T.adminB, 'PUT', `/api/conceptos/${C.admin!.id}`, { destino: 'servicio' })).status, 404);
    assert.equal((await llama(T.tesor1, 'PUT', `/api/conceptos/${C.admin!.id}`, { destino: 'servicio' })).status, 403);
    assert.equal((await prisma.concepto.findUniqueOrThrow({ where: { id: C.admin!.id } })).destino, 'administradora');
  });
});

describe('lo facturado y lo cobrado por línea', () => {
  it('facturado = suma de los cargos del concepto; la Junta central junta sus conceptos; el recargo (multa) no entra a ninguna línea', async () => {
    const r = await detalle(T.tesor1, e1.id);
    assert.equal(r.status, 200, r.texto);
    assert.equal(linea(r, 'administradora').facturado, '200.25'); // 100.10 + 100.15; la multa de 7 NO se suma aquí
    assert.equal(linea(r, 'administradora').cobrado, '200.25');
    assert.equal(linea(r, 'central').facturado, '78.00'); // luz 50 + agua 20 + fondo del condominio 8
    assert.equal(linea(r, 'central').cobrado, '48.00'); // sólo lo pagado: 30 + 10 + 8
    assert.deepEqual(linea(r, 'central').detalle.map((x: any) => x.nombre).sort(), ['agua_comun', 'fondo_condominio', 'luz_comunes']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(linea(r, `concepto:${C.luz_block!.id}`).facturado, '100.00');
    assert.equal(linea(r, `concepto:${C.luz_block!.id}`).cobrado, '0.00', 'pendiente y en revisión no son cobrado');
    assert.equal(linea(r, `concepto:${C.ascensor!.id}`).facturado, '40.00');
    assert.equal(linea(r, `concepto:${C.ascensor!.id}`).proveedor.razon_social, 'Ascensores SAC');
    assert.equal(r.body.facturado_total, '435.25');
    assert.equal(r.body.cobrado_total, '300.25');
    assert.equal(r.body.lineas.length, 4);
  });

  it('multas y fondo de contingencia del block van al Fondo de ahorros: no son una línea por pagar', async () => {
    const r = await detalle(T.tesor1, e1.id);
    assert.equal(r.body.ahorro.facturado, '17.00');
    assert.equal(r.body.ahorro.cobrado, '12.00'); // fondo 5 + multa 7
    assert.deepEqual(r.body.ahorro.conceptos.map((c: any) => [c.nombre, c.facturado]).sort(), [['fondo', '10.00'], ['mora', '7.00']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.body.ahorro_mes, '12.00');
    assert.ok(!r.body.lineas.some((l: any) => l.destino === 'ahorro_block' || l.nombre === 'fondo' || l.nombre === 'mora')); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('un concepto sin destino se avisa como sin clasificar y el mes no se puede dar por cerrado', async () => {
    const r = await detalle(T.adminA, e1.id, 7);
    assert.deepEqual(r.body.sin_clasificar.map((x: any) => [x.nombre, x.facturado]), [['seguridad', '12.00']]); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.body.estado, 'pendiente');
    const reg = await registrar(T.adminA, e1.id, { mes: 7, anio: 2026, linea: 'administradora' });
    assert.equal(reg.status, 201, reg.texto);
    const luego = await detalle(T.adminA, e1.id, 7);
    assert.equal(luego.body.estado, 'por_clasificar', 'pagado todo lo clasificado, falta clasificar');
    assert.equal(luego.body.registrado_completo, false);
    await prisma.egresoBlock.deleteMany({ where: { estructura_id: e1.id, mes: 7 } });
  });

  it('un mes sin recibo no tiene líneas', async () => {
    const r = await detalle(T.tesor1, e1.id, 3);
    assert.equal(r.status, 200);
    assert.equal(r.body.estado, 'sin_recibo');
    assert.deepEqual(r.body.lineas, []);
  });
});

describe('cuentas de destino (empresa administradora y proveedores)', () => {
  const cuenta = { banco: 'BCP', tipo: 'Corriente', numero: '194-1234567-0-11', cci: '00219400123456701157', titular: 'Grupo Vrany SAC' };

  it('la administración guarda la cuenta de la empresa administradora y la del proveedor; el tesorero las ve al registrar', async () => {
    assert.equal((await llama(T.adminA, 'PUT', '/api/cierres/cuentas/administradora', cuenta)).status, 200);
    const prov = await llama(T.adminA, 'PUT', `/api/cierres/cuentas/proveedor/${proveedorA.id}`, { banco: 'BBVA', numero: '0011-0222-33', titular: 'Ascensores SAC' });
    assert.equal(prov.status, 200, prov.texto);
    const r = await detalle(T.tesor1, e1.id);
    assert.equal(r.body.cuentas.administradora.numero, '194-1234567-0-11');
    assert.equal(r.body.cuentas.administradora.titular, 'Grupo Vrany SAC');
    assert.equal(linea(r, `concepto:${C.ascensor!.id}`).proveedor.cuenta.banco, 'BBVA');
    assert.equal(linea(r, `concepto:${C.ascensor!.id}`).proveedor.cuenta.cci, null);
    const lista = await llama(T.adminA, 'GET', '/api/cierres/cuentas');
    assert.equal(lista.body.administradora.banco, 'BCP');
    assert.ok(lista.body.proveedores.some((p: any) => p.id === proveedorA.id && p.numero === '0011-0222-33')); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('la junta y los residentes no las editan (403); otra empresa no toca el proveedor ajeno (404)', async () => {
    for (const t of [T.tesor1, T.presi1, T.central, T.vocal1, T.prop1]) {
      assert.equal((await llama(t, 'PUT', '/api/cierres/cuentas/administradora', cuenta)).status, 403);
      assert.equal((await llama(t, 'PUT', `/api/cierres/cuentas/proveedor/${proveedorA.id}`, cuenta)).status, 403);
      assert.equal((await llama(t, 'GET', '/api/cierres/cuentas')).status, 403);
    }
    assert.equal((await llama(T.adminB, 'PUT', `/api/cierres/cuentas/proveedor/${proveedorA.id}`, cuenta)).status, 404);
    assert.equal((await prisma.proveedor.findUniqueOrThrow({ where: { id: proveedorA.id } })).cuenta_banco, 'BBVA');
    assert.notEqual((await prisma.empresaAdministradora.findUniqueOrThrow({ where: { id: d.empresaB.id } })).cuenta_banco, 'BCP');
  });
});

describe('quién ve el cierre de un block', () => {
  it('lo ven su tesorero, su presidente, el tesorero central y la administración', async () => {
    for (const t of [T.tesor1, T.presi1, T.central, T.presiCentral, T.adminA]) assert.equal((await detalle(t, e1.id)).status, 200);
  });
  it('otro block, otro condominio u otra empresa: 404 (no se revela que existe)', async () => {
    for (const t of [T.tesor2, T.presi2, T.tesorB, T.adminB]) assert.equal((await detalle(t, e1.id)).status, 404);
  });
  it('el secretario, el vocal y un propietario sin cargo: 403; sin sesión: 401', async () => {
    for (const t of [T.secre1, T.vocal1, T.prop1]) assert.equal((await detalle(t, e1.id)).status, 403);
    assert.equal((await detalle(null, e1.id)).status, 401);
  });
  it('la tabla por block: la junta de un block sólo ve el suyo; el central y la administración, todos', async () => {
    const q = `?complejo_id=${d.complejoA.id}&mes=9&anio=2026`;
    const uno = await llama(T.tesor1, 'GET', `/api/cierres${q}`);
    assert.deepEqual(uno.body.blocks.map((b: any) => b.estructura.id), [e1.id]); // eslint-disable-line @typescript-eslint/no-explicit-any
    for (const t of [T.central, T.adminA]) assert.deepEqual((await llama(t, 'GET', `/api/cierres${q}`)).body.blocks.map((b: any) => b.estructura.id), [e1.id, e2.id]); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal((await llama(T.adminB, 'GET', `/api/cierres${q}`)).status, 404, 'el condominio de otra empresa');
    assert.equal((await llama(T.tesor1, 'GET', `/api/cierres?complejo_id=${d.complejoB.id}&mes=9&anio=2026`)).status, 404);
    assert.equal((await llama(T.adminA, 'GET', '/api/cierres?mes=9&anio=2026')).status, 422, 'la administración elige condominio');
    assert.equal((await llama(T.vocal1, 'GET', `/api/cierres${q}`)).status, 403);
  });
});

describe('recordatorio del día 5 al tesorero del block', () => {
  const notis = (usuarioId: number) => prisma.notificacion.findMany({ where: { usuario_id: usuarioId, tipo: 'cierre_pendiente' } });
  let ids2: number;
  let idTesorB: number;

  it('antes del día 5 (en la zona del condominio) no avisa; desde el 5 avisa una sola vez por mes y block', async () => {
    ids2 = (await prisma.usuario.findUniqueOrThrow({ where: { email: 'tesor2@test.pe' } })).id;
    idTesorB = (await prisma.usuario.findUniqueOrThrow({ where: { email: 'tesorb@test.pe' } })).id;
    // 03:00 UTC del 5 es todavía el 4 a las 22:00 en Lima.
    assert.equal(await encolarCierresPendientes(new Date('2026-10-05T03:00:00Z')), 0);
    assert.equal((await notis(ids.tesor1)).length, 0);
    // El Block 2 ya registra todo su cierre: no recibe aviso aunque llegue el día 5. El Block B (otro condominio) no ha registrado nada: su tesorero sí.
    for (const l of ['administradora', 'central']) {
      const reg2 = await registrar(T.tesor2, e2.id, { mes: 9, anio: 2026, linea: l });
      assert.equal(reg2.status, 201, reg2.texto);
    }
    assert.equal(await encolarCierresPendientes(new Date('2026-10-05T10:00:00Z')), 2);
    const n = await notis(ids.tesor1);
    assert.equal(n.length, 1);
    assert.equal(n[0]!.canal, 'email');
    assert.equal(n[0]!.ref_entidad, 'cierre:2026-09');
    assert.equal(n[0]!.ref_id, e1.id);
    assert.match(n[0]!.asunto, /setiembre de 2026/);
    assert.match(n[0]!.cuerpo, /Block 1/);
    assert.match(n[0]!.cuerpo, /Pago a la empresa administradora/);
    assert.equal((await notis(ids2)).length, 0);
    assert.equal((await notis(idTesorB)).length, 1);
    // Repetir el ciclo (cada 15 min) o llegar el día 6 no duplica.
    assert.equal(await encolarCierresPendientes(new Date('2026-10-05T10:15:00Z')), 0);
    assert.equal(await encolarCierresPendientes(new Date('2026-10-06T15:00:00Z')), 0);
    assert.equal((await notis(ids.tesor1)).length, 1);
  });

  it('sólo avisa al tesorero de cada block con pendientes: ni al presidente ni al tesorero central ni al del Block 2 (que ya registró)', async () => {
    const todos = await prisma.notificacion.findMany({ where: { tipo: 'cierre_pendiente' } });
    assert.deepEqual([...new Set(todos.map((n) => n.usuario_id))].sort(), [ids.tesor1, idTesorB].sort());
  });

  it('sólo mira el mes anterior: un cierre viejo no despierta avisos', async () => {
    assert.equal(await encolarCierresPendientes(new Date('2026-12-10T15:00:00Z')), 0, 'diciembre mira noviembre: sin recibo');
  });
});

describe('registrar el pago de una línea (voucher obligatorio)', () => {
  const luz = () => `concepto:${C.luz_block!.id}`;

  it('el tesorero del block registra el pago a la empresa administradora: por defecto, lo facturado', async () => {
    const r = await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: 'administradora', referencia: 'TRF-77' });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.registro.monto_pagado, '200.25');
    assert.equal(r.body.registro.referencia, 'TRF-77');
    assert.equal(r.body.registro.fecha_pago, '2026-10-02');
    assert.equal(r.body.registro.registrado_por.nombre, 'Tesorero 1');
    assert.equal(r.body.registro.conformidad, null);
    const fila = await prisma.egresoBlock.findFirstOrThrow({ where: { estructura_id: e1.id, linea: 'administradora' }, include: { voucher: true } });
    assert.equal(fila.destino, 'administradora');
    assert.equal(fila.facturado.toFixed(2), '200.25');
    assert.ok(fila.voucher && fila.voucher.tamano > 0);
    assert.equal(fila.registrado_por_id, ids.tesor1);
  });

  it('sin voucher no se registra nada: 422 con el campo, también con JSON', async () => {
    const sin = await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: 'central' }, null);
    assert.equal(sin.status, 422);
    assert.ok(sin.body.campos.voucher);
    const json = await llama(T.tesor1, 'POST', `/api/cierres/block/${e1.id}/lineas`, { mes: 9, anio: 2026, linea: 'central', fecha_pago: '2026-10-02' });
    assert.equal(json.status, 422);
    assert.ok(json.body.campos.voucher);
    assert.equal(await prisma.egresoBlock.count({ where: { estructura_id: e1.id, linea: 'central' } }), 0);
  });

  it('un archivo que no es lo que dice, o de un tipo no permitido, se rechaza', async () => {
    const falso = await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: 'central' }, { bytes: Buffer.from('no soy un png'), tipo: 'image/png', nombre: 'a.png' });
    assert.equal(falso.status, 422);
    const raro = await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: 'central' }, { bytes: Buffer.from('<html>'), tipo: 'text/html', nombre: 'a.html' });
    assert.equal(raro.status, 415);
    assert.equal(await prisma.egresoBlock.count({ where: { estructura_id: e1.id, linea: 'central' } }), 0);
  });

  it('agua, luz y proveedores: el monto de la boleta es obligatorio y puede ser distinto de lo facturado', async () => {
    const sin = await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: luz() });
    assert.equal(sin.status, 422);
    assert.ok(sin.body.campos.monto_pagado);
    const ok = await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: luz(), monto_pagado: '98.50' });
    assert.equal(ok.status, 201, ok.texto);
    assert.equal(ok.body.registro.monto_pagado, '98.50');
    const fila = await prisma.egresoBlock.findFirstOrThrow({ where: { estructura_id: e1.id, linea: luz() } });
    assert.equal(fila.facturado.toFixed(2), '100.00', 'la foto de lo facturado queda aparte de lo pagado');
  });

  it('una línea se registra una sola vez (409), y una línea o un mes que no existen se rechazan; el ahorro no se paga', async () => {
    assert.equal((await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: luz(), monto_pagado: 10 })).status, 409);
    assert.equal((await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: 'concepto:99999', monto_pagado: 10 })).status, 422);
    assert.equal((await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: 'inventada' })).status, 422);
    assert.equal((await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: `concepto:${C.fondo!.id}`, monto_pagado: 5 })).status, 422, 'el fondo de ahorros del block no es una línea por pagar');
    assert.equal((await registrar(T.tesor1, e1.id, { mes: 3, anio: 2026, linea: 'central' })).status, 409, 'ese mes no tiene recibo');
    assert.equal(await prisma.egresoBlock.count({ where: { estructura_id: e1.id, mes: 9 } }), 2);
  });

  it('la fecha del pago no puede ser futura ni inválida; el monto debe ser un monto', async () => {
    assert.equal((await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: 'central', fecha_pago: '2999-01-01' })).status, 422);
    assert.equal((await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: 'central', fecha_pago: 'ayer' })).status, 422);
    assert.equal((await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: 'central', monto_pagado: '-5' })).status, 422);
    assert.equal(await prisma.egresoBlock.count({ where: { estructura_id: e1.id, linea: 'central' } }), 0);
  });

  it('el presidente lo ve pero no registra (403); tampoco el secretario, el vocal ni el tesorero central', async () => {
    for (const t of [T.presi1, T.secre1, T.vocal1, T.central, T.presiCentral, T.prop1]) {
      const r = await registrar(t, e1.id, { mes: 9, anio: 2026, linea: 'central' });
      assert.equal(r.status, 403, r.texto);
    }
    assert.equal(await prisma.egresoBlock.count({ where: { estructura_id: e1.id, linea: 'central' } }), 0);
  });

  it('el tesorero de otro block, el de otro condominio y la administración de otra empresa: 404', async () => {
    for (const t of [T.tesor2, T.presi2, T.tesorB, T.adminB]) {
      const r = await registrar(t, e1.id, { mes: 9, anio: 2026, linea: 'central' });
      assert.equal(r.status, 404, r.texto);
    }
    assert.equal(await prisma.egresoBlock.count({ where: { estructura_id: e1.id, linea: 'central' } }), 0);
  });

  it('la administración también registra', async () => {
    const r = await registrar(T.adminA, e1.id, { mes: 9, anio: 2026, linea: 'central' });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.registro.monto_pagado, '78.00');
    assert.equal(r.body.registro.registrado_por.nombre, 'Admin A');
  });

  it('el voucher se ve con su alcance: block, Junta central y administración sí; otro block o empresa, 404', async () => {
    const fila = await prisma.egresoBlock.findFirstOrThrow({ where: { estructura_id: e1.id, linea: 'administradora' } });
    for (const t of [T.tesor1, T.presi1, T.central, T.adminA]) {
      const r = await fetch(`${base}/api/cierres/lineas/${fila.id}/voucher`, { headers: cabecerasDeSesion(t) });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'image/png');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    }
    for (const t of [T.tesor2, T.tesorB, T.adminB]) assert.equal((await fetch(`${base}/api/cierres/lineas/${fila.id}/voucher`, { headers: cabecerasDeSesion(t) })).status, 404);
    assert.equal((await fetch(`${base}/api/cierres/lineas/${fila.id}/voucher`, { headers: cabecerasDeSesion(T.vocal1) })).status, 403);
  });

  it('el estado del mes sigue lo registrado: pendiente hasta pagar todo; luego, sin conformidad', async () => {
    const antes = await detalle(T.tesor1, e1.id);
    assert.equal(antes.body.estado, 'pendiente');
    assert.equal(antes.body.lineas_pagadas, 3);
    assert.equal(antes.body.lineas_total, 4);
    const asc = await registrar(T.tesor1, e1.id, { mes: 9, anio: 2026, linea: `concepto:${C.ascensor!.id}`, monto_pagado: 41, referencia: 'F001-88' });
    assert.equal(asc.status, 201, asc.texto);
    const ya = await detalle(T.tesor1, e1.id);
    assert.equal(ya.body.estado, 'sin_conformidad');
    assert.equal(linea(ya, `concepto:${C.ascensor!.id}`).registro.monto_pagado, '41.00');
    assert.equal(ya.body.puede.registrar, true);
    assert.equal((await detalle(T.presi1, e1.id)).body.puede.registrar, false);
  });
});

describe('sobrante del mes y Fondo de ahorros del block', () => {
  it('sobrante = cobrado (sin lo de ahorro) − pagado; el Fondo suma ahorro + sobrante sólo de los meses con todas sus líneas registradas', async () => {
    // Septiembre: cobrado 300.25 (de ellos 12.00 de multa y fondo) − pagado (200.25 + 78 + 98.50 + 41 = 417.75) → sobrante −129.50.
    const sep = await detalle(T.tesor1, e1.id);
    assert.equal(sep.body.cobrado_total, '300.25');
    assert.equal(sep.body.pagado_total, '417.75');
    assert.equal(sep.body.ahorro_mes, '12.00');
    assert.equal(sep.body.sobrante_mes, '-129.50');
    assert.equal(sep.body.registrado_completo, true);
    assert.equal(sep.body.fondo_ahorros, '-117.50', 'agosto aún sin registrar: no entra al Fondo');
    const ago0 = await detalle(T.tesor1, e1.id, 8);
    assert.equal(ago0.body.sobrante_mes, '30.00');
    assert.equal(ago0.body.ahorro_mes, '0.00');
    assert.equal(ago0.body.fondo_ahorros, '0.00');
    // Agosto: se transfirieron 25 de los 30 facturados (sobrante 5.00) y ya cuenta.
    assert.equal((await registrar(T.tesor1, e1.id, { mes: 8, anio: 2026, linea: 'administradora', monto_pagado: 25 })).status, 201);
    const ago = await detalle(T.tesor1, e1.id, 8);
    assert.equal(ago.body.sobrante_mes, '5.00');
    assert.equal(ago.body.fondo_ahorros, '5.00');
    assert.equal((await detalle(T.tesor1, e1.id)).body.fondo_ahorros, '-112.50', 'septiembre incluye agosto');
  });

  it('la tabla de la administración trae el estado, el sobrante, el ahorro y el Fondo de cada block', async () => {
    const r = await llama(T.adminA, 'GET', `/api/cierres?complejo_id=${d.complejoA.id}&mes=9&anio=2026`);
    const b1 = r.body.blocks.find((b: any) => b.estructura.id === e1.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(b1.estado, 'sin_conformidad');
    assert.equal(b1.sobrante_mes, '-129.50');
    assert.equal(b1.ahorro_mes, '12.00');
    assert.equal(b1.fondo_ahorros, '-112.50');
    assert.equal(b1.facturado_total, '435.25');
    const b2 = r.body.blocks.find((b: any) => b.estructura.id === e2.id); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(b2.estado, 'sin_conformidad');
    assert.equal(b2.sobrante_mes, '0.00');
  });
});

describe('conformidad («llegó a la cuenta»)', () => {
  const egreso = (e: number, l: string) => prisma.egresoBlock.findFirstOrThrow({ where: { estructura_id: e, mes: 9, anio: 2026, linea: l } });
  const adminId = async () => (await prisma.usuario.findUniqueOrThrow({ where: { email: 'admin.a@test.pe' } })).id;

  it('los aportes a la Junta central: los ve el central y la administración; la junta de un block, no', async () => {
    const q = `?complejo_id=${d.complejoA.id}&mes=9&anio=2026`;
    const r = await llama(T.central, 'GET', `/api/cierres/aportes${q}`);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.aportes.length, 2, 'el aporte del Block 1 y el del Block 2');
    assert.ok(r.body.aportes.every((a: any) => a.linea === 'central')); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.body.totales.facturado, '93.00'); // 78 + 15
    assert.equal(r.body.totales.conforme, '0.00');
    assert.equal(r.body.puede.conformidad, true);
    assert.ok(r.body.aportes.find((a: any) => a.estructura.id === e1.id).puede_conformidad); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal((await llama(T.presiCentral, 'GET', `/api/cierres/aportes${q}`)).body.puede.conformidad, false);
    const adm = await llama(T.adminA, 'GET', `/api/cierres/aportes${q}`);
    assert.equal(adm.status, 200);
    assert.equal(adm.body.puede.conformidad, false, 'el aporte a la Junta central lo confirma el tesorero central');
    for (const t of [T.tesor1, T.presi1, T.vocal1]) assert.equal((await llama(t, 'GET', `/api/cierres/aportes${q}`)).status, 403);
    assert.equal((await llama(T.adminB, 'GET', `/api/cierres/aportes${q}`)).status, 404);
    assert.equal((await llama(T.tesorB, 'GET', `/api/cierres/aportes${q}`)).status, 404, 'el central de otro condominio');
  });

  it('los pagos a la empresa administradora los ve la administración; la Junta central, no', async () => {
    const q = `?complejo_id=${d.complejoA.id}&mes=9&anio=2026&destino=administradora`;
    const r = await llama(T.adminA, 'GET', `/api/cierres/aportes${q}`);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.aportes.length, 2);
    assert.equal(r.body.totales.facturado, '250.25'); // 200.25 + 50
    assert.equal(r.body.puede.conformidad, true);
    for (const t of [T.central, T.presiCentral, T.tesor1]) assert.equal((await llama(t, 'GET', `/api/cierres/aportes${q}`)).status, 403);
  });

  it('el tesorero central da la conformidad al aporte a la Junta central; queda quién y cuándo', async () => {
    const e = await egreso(e1.id, 'central');
    const r = await llama(T.central, 'PUT', `/api/cierres/lineas/${e.id}/conformidad`);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.registro.conformidad.por.nombre, 'Tesorero central');
    assert.ok(r.body.registro.conformidad.at);
    const otra = await llama(T.central, 'PUT', `/api/cierres/lineas/${e.id}/conformidad`);
    assert.equal(otra.body.registro.conformidad.at, r.body.registro.conformidad.at, 'idempotente');
    const lista = await llama(T.central, 'GET', `/api/cierres/aportes?complejo_id=${d.complejoA.id}&mes=9&anio=2026`);
    assert.equal(lista.body.totales.conforme, '78.00');
    assert.equal(lista.body.caja_central.recibido, '78.00');
  });

  it('el aporte a la Junta central sólo lo confirma el tesorero central: no el del block, ni el presidente, ni la administración', async () => {
    const e = await egreso(e2.id, 'central');
    for (const t of [T.tesor2, T.presi2, T.presiCentral, T.adminA, T.vocal1]) {
      const r = await llama(t, 'PUT', `/api/cierres/lineas/${e.id}/conformidad`);
      assert.equal(r.status, 403, r.texto);
    }
    assert.equal((await prisma.egresoBlock.findUniqueOrThrow({ where: { id: e.id } })).conformidad_at, null);
  });

  it('el pago a la empresa administradora lo confirma la administración: no el tesorero central, ni el del block, ni el presidente', async () => {
    const e = await egreso(e1.id, 'administradora');
    for (const t of [T.central, T.tesor1, T.presi1, T.presiCentral, T.vocal1]) {
      const r = await llama(t, 'PUT', `/api/cierres/lineas/${e.id}/conformidad`);
      assert.equal(r.status, 403, r.texto);
    }
    assert.equal((await prisma.egresoBlock.findUniqueOrThrow({ where: { id: e.id } })).conformidad_at, null);
    const ok = await llama(T.adminA, 'PUT', `/api/cierres/lineas/${e.id}/conformidad`);
    assert.equal(ok.status, 200, ok.texto);
    assert.equal(ok.body.registro.conformidad.por.nombre, 'Admin A');
    const det = await detalle(T.adminA, e1.id);
    assert.equal(linea(det, 'administradora').puede_conformidad, true, 'quien la dio puede quitarla');
    assert.equal(linea(await detalle(T.tesor1, e1.id), 'administradora').puede_conformidad, false);
    assert.equal(linea(det, 'administradora').lleva_conformidad, true);
  });

  it('el tesorero de otro condominio o la administración de otra empresa: 404', async () => {
    for (const l of ['central', 'administradora']) {
      const e = await egreso(e1.id, l);
      for (const t of [T.tesorB, T.adminB]) assert.equal((await llama(t, 'PUT', `/api/cierres/lineas/${e.id}/conformidad`)).status, 404);
    }
  });

  it('agua, luz y proveedores no llevan conformidad (409), ni para el tesorero central ni para la administración', async () => {
    for (const l of [`concepto:${C.luz_block!.id}`, `concepto:${C.ascensor!.id}`]) {
      const e = await egreso(e1.id, l);
      for (const t of [T.central, T.adminA]) {
        const r = await llama(t, 'PUT', `/api/cierres/lineas/${e.id}/conformidad`);
        assert.equal(r.status, 409, r.texto);
      }
      assert.equal((await prisma.egresoBlock.findUniqueOrThrow({ where: { id: e.id } })).conformidad_at, null);
    }
    const det = await detalle(T.adminA, e1.id);
    assert.equal(linea(det, `concepto:${C.luz_block!.id}`).lleva_conformidad, false);
  });

  it('nadie da la conformidad a su propio registro', async () => {
    // El tesorero central registró el aporte (cuando era tesorero de ese block).
    const c = await egreso(e1.id, 'central');
    await prisma.egresoBlock.update({ where: { id: c.id }, data: { conformidad_at: null, conformidad_por_id: null, registrado_por_id: ids.central } });
    const r = await llama(T.central, 'PUT', `/api/cierres/lineas/${c.id}/conformidad`);
    assert.equal(r.status, 403, r.texto);
    assert.match(r.body.error, /registraste/);
    assert.equal((await prisma.egresoBlock.findUniqueOrThrow({ where: { id: c.id } })).conformidad_at, null);
    await prisma.egresoBlock.update({ where: { id: c.id }, data: { registrado_por_id: await adminId() } });
    // La administración registró el pago a la empresa administradora: otro admin lo confirmaría, ella no.
    const a = await egreso(e1.id, 'administradora');
    await prisma.egresoBlock.update({ where: { id: a.id }, data: { conformidad_at: null, conformidad_por_id: null, registrado_por_id: await adminId() } });
    const r2 = await llama(T.adminA, 'PUT', `/api/cierres/lineas/${a.id}/conformidad`);
    assert.equal(r2.status, 403, r2.texto);
    assert.match(r2.body.error, /registraste/);
    assert.equal((await prisma.egresoBlock.findUniqueOrThrow({ where: { id: a.id } })).conformidad_at, null);
    await prisma.egresoBlock.update({ where: { id: a.id }, data: { registrado_por_id: ids.tesor1 } });
  });

  it('con todas las conformidades el mes queda cerrado; quitar la conformidad lo reabre', async () => {
    const a = await egreso(e1.id, 'administradora');
    const c = await egreso(e1.id, 'central');
    assert.equal((await llama(T.adminA, 'PUT', `/api/cierres/lineas/${a.id}/conformidad`)).status, 200);
    assert.equal((await detalle(T.tesor1, e1.id)).body.estado, 'sin_conformidad', 'falta la del aporte a la Junta central');
    assert.equal((await llama(T.central, 'PUT', `/api/cierres/lineas/${c.id}/conformidad`)).status, 200);
    assert.equal((await detalle(T.tesor1, e1.id)).body.estado, 'cerrado');
    const quitar = await llama(T.central, 'DELETE', `/api/cierres/lineas/${c.id}/conformidad`);
    assert.equal(quitar.status, 200);
    assert.equal(quitar.body.registro.conformidad, null);
    assert.equal((await detalle(T.tesor1, e1.id)).body.estado, 'sin_conformidad');
    assert.equal((await llama(T.tesor1, 'DELETE', `/api/cierres/lineas/${c.id}/conformidad`)).status, 403);
    assert.equal((await llama(T.adminA, 'DELETE', `/api/cierres/lineas/${c.id}/conformidad`)).status, 403);
    assert.equal((await llama(T.central, 'PUT', `/api/cierres/lineas/${c.id}/conformidad`)).status, 200);
  });

  it('un pago con conformidad no se puede borrar; sin ella lo corrige su tesorero o la administración', async () => {
    const conf = await egreso(e1.id, 'administradora');
    const bloqueado = await llama(T.tesor1, 'DELETE', `/api/cierres/lineas/${conf.id}`);
    assert.equal(bloqueado.status, 409, bloqueado.texto);
    const luz = await egreso(e1.id, `concepto:${C.luz_block!.id}`);
    for (const t of [T.presi1, T.central, T.vocal1]) assert.equal((await llama(t, 'DELETE', `/api/cierres/lineas/${luz.id}`)).status, 403);
    for (const t of [T.tesor2, T.tesorB, T.adminB]) assert.equal((await llama(t, 'DELETE', `/api/cierres/lineas/${luz.id}`)).status, 404);
    assert.equal((await llama(T.tesor1, 'DELETE', `/api/cierres/lineas/${luz.id}`)).status, 204);
    assert.equal(await prisma.egresoBlock.count({ where: { id: luz.id } }), 0);
    assert.equal(await prisma.archivoEgresoBlock.count({ where: { egreso_id: luz.id } }), 0, 'el voucher se va con el pago');
    assert.equal((await detalle(T.tesor1, e1.id)).body.estado, 'pendiente');
  });

  it('cada acción queda en la auditoría', async () => {
    const acciones = await prisma.auditoria.findMany({ where: { entidad: 'cierre_block' }, select: { accion: true } });
    for (const a of ['registrar_pago', 'dar_conformidad', 'quitar_conformidad', 'quitar_pago', 'cuenta_administradora', 'cuenta_proveedor']) assert.ok(acciones.some((x) => x.accion === a), a);
  });
});
