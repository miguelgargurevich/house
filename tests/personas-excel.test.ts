import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import XLSX from 'xlsx';
import { cabecerasDeSesion, darCortesia, iniciar, login, prisma, sembrar, type Datos } from './helpers/app';
import { ENCABEZADOS_PERSONAS } from '../src/server/services/contactos/plantilla';
import { leerContactos, leerRelacion } from '../src/server/services/contactos/lector';
import { migrarPersonas } from '../src/server/services/personas/sincronizar';

/**
 * Carga de contactos con la columna opcional `Relación` (una fila por persona): copropietarios, cónyuges, familiares y otros se agregan a la lista de personas del
 * departamento; sin esa columna el archivo se lee exactamente como antes (ver `contactos-excel.test.ts`). La vista previa no escribe nada.
 */

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let adminA: string;

type Celda = string | number | null;
const aXlsx = (filas: Celda[][]): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Contactos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
/** Una fila «por persona»: Block, Dpto, Relación, Nombre, Correo, Celular. */
const fp = (block: string, dpto: number | string, relacion: Celda = null, nombre: Celda = null, correo: Celda = null, celular: Celda = null): Celda[] => [block, dpto, relacion, nombre, correo, celular];
const porPersona = (...filas: Celda[][]): Buffer => aXlsx([[...ENCABEZADOS_PERSONAS], ...filas]);

interface Resp { status: number; body: any; texto: string; headers: Headers } // eslint-disable-line @typescript-eslint/no-explicit-any
async function leer(r: Response): Promise<Resp> {
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* no es JSON */ }
  return { status: r.status, body, texto, headers: r.headers };
}
const subir = async (archivo: Buffer, complejoId: number, campos: Record<string, string> = {}): Promise<Resp> => {
  const f = new FormData();
  f.append('complejo_id', String(complejoId));
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  f.append('archivo', new Blob([new Uint8Array(archivo)]), 'contactos.xlsx');
  return leer(await fetch(`${base}/api/contactos/excel`, { method: 'POST', headers: cabecerasDeSesion(adminA), body: f }));
};
const guardar = (archivo: Buffer, c: number, extra: Record<string, string> = {}) => subir(archivo, c, { confirmar: 'true', ...extra });
const plantilla = async (complejoId: number, formato = '') => {
  const r = await fetch(`${base}/api/contactos/plantilla.xlsx?complejo_id=${complejoId}${formato ? `&formato=${formato}` : ''}`, { headers: cabecerasDeSesion(adminA) });
  const libro = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
  return { status: r.status, libro, filas: XLSX.utils.sheet_to_json<string[]>(libro.Sheets.Contactos!, { header: 1, defval: '' }), buffer: Buffer.from(XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' })) };
};

interface Condo { id: number; unidad: Record<string, number>; propietario: Record<string, number> }
let nCondo = 0;
/** Block 1 con 101, 102 y 103 (cada una con su propietario de relleno), ya migradas a «personas». */
async function nuevoCondo(): Promise<Condo> {
  const complejo = await prisma.complejoHabitacional.create({ data: { nombre: `Condominio ${++nCondo}`, tipo: 'Edificio', empresa_id: d.empresaA.id } });
  await darCortesia(complejo.id);
  const b1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: complejo.id } });
  const unidad: Record<string, number> = {};
  const propietario: Record<string, number> = {};
  for (const [dpto, nombre] of [['101', 'Ana Pérez Gómez'], ['102', 'Luis Ramos Díaz'], ['103', 'María Torres Vega']] as const) {
    const p = await prisma.usuario.create({ data: { nombre, email: `b1-${dpto}-c${complejo.id}@sin-correo.invalid`, rol: 'propietario' } });
    const u = await prisma.unidad.create({ data: { codigo: `B01-${dpto}`, tipo: 'departamento', complejo_id: complejo.id, empresa_id: d.empresaA.id, estructura_id: b1.id, propietario_id: p.id, estado: 'activa' } });
    unidad[dpto] = u.id;
    propietario[dpto] = p.id;
  }
  await migrarPersonas();
  return { id: complejo.id, unidad, propietario };
}

/** Todo lo que una carga podría tocar, para comprobar que NO se tocó. */
async function foto() {
  return JSON.stringify({
    usuarios: await prisma.usuario.findMany({ orderBy: { id: 'asc' }, select: { id: true, nombre: true, email: true, telefono: true, rol: true, updated_at: true } }),
    unidades: await prisma.unidad.findMany({ orderBy: { id: 'asc' }, select: { id: true, propietario_id: true, inquilino_id: true, updated_at: true } }),
    personas: await prisma.personaUnidad.findMany({ orderBy: { id: 'asc' } }),
    cola: await prisma.invitacionEnCola.count(),
  });
}
const personasDe = (unidad: number) => prisma.personaUnidad.findMany({ where: { unidad_id: unidad }, orderBy: { id: 'asc' } });

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
beforeEach(async () => {
  d = await sembrar();
  nCondo = 0;
  adminA = await login(base, 'admin.a@test.pe');
});

describe('lector con la columna Relación', () => {
  it('reconoce la columna y las relaciones (sin tildes ni mayúsculas) y junta las personas de cada departamento', () => {
    assert.equal(leerRelacion('Cónyuge'), 'conyuge');
    assert.equal(leerRelacion(' ESPOSA '), 'conyuge');
    assert.equal(leerRelacion('Hijo'), 'familiar');
    assert.equal(leerRelacion('Co-propietaria'), 'copropietario');
    assert.equal(leerRelacion(''), null);
    assert.equal(leerRelacion('amigo'), undefined);
    const l = leerContactos(porPersona(
      fp('Block 1', 101, 'Propietario', 'Ana Pérez', 'ANA@vecino.pe', '987654321'),
      fp('Block 1', 101, 'Cónyuge', 'Pedro Pérez', 'pedro@vecino.pe'),
      fp('Block 1', 101, 'Inquilino', 'Luis Díaz'),
      fp('Block 1', 102),
    ));
    assert.equal(l.por_persona, true);
    assert.equal(l.filas.length, 2, 'una fila por departamento');
    assert.equal(l.filas[0]!.propietario.correo, 'ana@vecino.pe');
    assert.equal(l.filas[0]!.inquilino.nombre, 'Luis Díaz');
    assert.deepEqual(l.filas[0]!.filas, { propietario: 2, inquilino: 4 }, 'cada persona apunta a SU fila del Excel');
    assert.deepEqual(l.extras.map((e) => [e.fila, e.relacion, e.datos.nombre]), [[3, 'conyuge', 'Pedro Pérez']]);
  });

  it('sin la columna, todo se lee como siempre (sin extras)', () => {
    const l = leerContactos(aXlsx([['Block', 'Dpto', 'Propietario', 'Correo propietario'], ['Block 1', 101, 'Ana', 'ana@vecino.pe']]));
    assert.equal(l.por_persona, false);
    assert.deepEqual(l.extras, []);
    assert.equal(l.filas[0]!.filas, undefined);
  });
});

describe('vista previa y guardado con una fila por persona', () => {
  const archivo = () => porPersona(
    fp('Block 1', 101, 'Propietario', 'Ana Pérez', 'ana@vecino.pe', '987654321'),
    fp('Block 1', 101, 'Cónyuge', 'Pedro Pérez', 'pedro@vecino.pe', '912345678'),
    fp('Block 1', 101, 'Familiar', 'Rosa Pérez', null, '955555555'),
    fp('Block 1', 102, 'Inquilino', 'Luis Nuevo', 'luis@vecino.pe'),
    fp('Block 1', 103),
  );

  it('la vista previa cuenta lo que se agregaría y NO escribe nada', async () => {
    const c = await nuevoCondo();
    const antes = await foto();
    const r = await subir(archivo(), c.id);
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.body.code, 'REVISAR_CONTACTOS');
    assert.equal(r.body.resumen.filas, 3, 'tres departamentos');
    assert.equal(r.body.resumen.filas_con_error, 0);
    assert.equal(r.body.resumen.personas_nuevas, 2);
    assert.equal(r.body.resumen.personas_cambiadas, 0);
    assert.equal(r.body.resumen.inquilinos_nuevos, 1);
    assert.match(r.body.error, /se agregan 2 personas a la lista/);
    assert.equal(await foto(), antes);
  });

  it('guardar crea las personas (sin cuenta ni acceso), el inquilino nuevo con su cuenta, y deja un solo responsable', async () => {
    const c = await nuevoCondo();
    const r = await guardar(archivo(), c.id);
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.personas_agregadas, 2);
    const p101 = await personasDe(c.unidad['101']!);
    assert.deepEqual(p101.map((p) => [p.relacion, p.nombre, p.correo, p.celular, p.usuario_id != null, p.acceso_activo, p.recibe_comunicados, p.responsable_pago]), [
      ['propietario', 'Ana Pérez Gómez', 'ana@vecino.pe', '+51 987 654 321', true, true, true, true],
      ['conyuge', 'Pedro Pérez', 'pedro@vecino.pe', '+51 912 345 678', false, false, false, false],
      ['familiar', 'Rosa Pérez', null, '+51 955 555 555', false, false, false, false],
    ]);
    // El correo y el celular del titular llegaron a su cuenta Y a su persona; los extras no crearon cuentas.
    assert.equal(await prisma.usuario.count({ where: { email: { in: ['pedro@vecino.pe'] } } }), 0);
    const p102 = await personasDe(c.unidad['102']!);
    assert.deepEqual(p102.map((p) => [p.relacion, p.responsable_pago]), [['propietario', false], ['inquilino', true]], 'llegó un inquilino: él recibe el aviso de cobro, como siempre');
    for (const u of [c.unidad['101']!, c.unidad['102']!, c.unidad['103']!]) assert.equal(await prisma.personaUnidad.count({ where: { unidad_id: u, responsable_pago: true } }), 1);
    // La fila vacía de 103 no creó nada.
    assert.deepEqual((await personasDe(c.unidad['103']!)).map((p) => p.relacion), ['propietario']);
  });

  it('volver a subir el mismo archivo no cambia nada (ni duplica personas)', async () => {
    const c = await nuevoCondo();
    await guardar(archivo(), c.id);
    const antes = await foto();
    const r = await subir(archivo(), c.id);
    assert.equal(r.status, 409);
    assert.equal(r.body.resumen.personas_nuevas, 0);
    assert.equal(r.body.resumen.personas_cambiadas, 0);
    assert.match(r.body.error, /no hay cambios que guardar/);
    const g = await guardar(archivo(), c.id);
    assert.equal(g.status, 201);
    assert.equal(await foto(), antes, 'guardar lo mismo no cambia nada');
    assert.equal(await prisma.personaUnidad.count({ where: { unidad_id: c.unidad['101']! } }), 3);
  });

  it('completa el correo o celular de una persona ya cargada; sin «actualizar» no cambia el que ya tiene; el nombre nunca cambia', async () => {
    const c = await nuevoCondo();
    await guardar(porPersona(fp('Block 1', 101, 'Familiar', 'Rosa Pérez', null, '955555555')), c.id);
    const r1 = await guardar(porPersona(fp('Block 1', 101, 'Familiar', 'Rosa Pérez', 'rosa@vecino.pe', '966666666')), c.id);
    assert.equal(r1.status, 201, r1.texto);
    const rosa = (await personasDe(c.unidad['101']!)).find((p) => p.relacion === 'familiar')!;
    assert.deepEqual([rosa.correo, rosa.celular], ['rosa@vecino.pe', '+51 955 555 555'], 'el correo se completa; el celular que ya tenía no cambia sin actualizar');
    assert.ok(r1.body.problemas.some((p: { nivel: string; mensaje: string }) => p.nivel === 'aviso' && /otro celular/.test(p.mensaje)));
    await guardar(porPersona(fp('Block 1', 101, 'Familiar', 'Rosa Pérez', null, '966666666')), c.id, { actualizar: 'true' });
    assert.equal((await personasDe(c.unidad['101']!)).find((p) => p.relacion === 'familiar')!.celular, '+51 966 666 666');
  });

  it('una persona con usuario en Torre no cambia de correo desde el Excel (es el de su acceso)', async () => {
    const c = await nuevoCondo();
    await guardar(porPersona(fp('Block 1', 101, 'Cónyuge', 'Pedro Pérez', 'pedro@vecino.pe')), c.id);
    const pedro = (await personasDe(c.unidad['101']!)).find((p) => p.relacion === 'conyuge')!;
    const token = adminA;
    const a = await fetch(`${base}/api/unidades/${c.unidad['101']}/personas/${pedro.id}/acceso`, { method: 'PUT', headers: { ...cabecerasDeSesion(token), 'content-type': 'application/json' }, body: JSON.stringify({ activo: true }) });
    assert.equal(a.status, 200);
    const r = await guardar(porPersona(fp('Block 1', 101, 'Cónyuge', 'Pedro Pérez', 'otro@vecino.pe')), c.id, { actualizar: 'true' });
    assert.equal(r.status, 201);
    assert.equal((await prisma.personaUnidad.findUniqueOrThrow({ where: { id: pedro.id } })).correo, 'pedro@vecino.pe');
    assert.ok(r.body.problemas.some((p: { mensaje: string }) => /ya tiene usuario en Torre/.test(p.mensaje)));
  });

  it('errores por fila: relación mal escrita, dos propietarios, sin nombre, departamento que no existe; las demás filas sí se guardan', async () => {
    const c = await nuevoCondo();
    const r = await guardar(porPersona(
      fp('Block 1', 101, 'Amigo', 'Alguien', 'a@vecino.pe'),
      fp('Block 1', 101, 'Propietario', 'Ana Pérez'),
      fp('Block 1', 101, 'Propietario', 'Otra Persona'),
      fp('Block 1', 102, 'Familiar', null, 'x@vecino.pe'),
      fp('Block 1', 999, 'Familiar', 'Nadie', null),
      fp('Block 1', 103, 'Familiar', 'Ok Persona', 'ok@vecino.pe'),
      fp('Block 1', 103, null, 'Sin Relación', 'sr@vecino.pe'),
    ), c.id);
    assert.equal(r.status, 201, r.texto);
    const msgs = r.body.problemas.map((p: { fila: number; nivel: string; mensaje: string }) => `${p.fila}:${p.nivel}:${p.mensaje}`);
    assert.ok(msgs.some((m: string) => /^2:error:La relación «Amigo» no es válida/.test(m)), msgs.join('\n'));
    assert.ok(msgs.some((m: string) => /^4:error:Hay más de un propietario/.test(m)), msgs.join('\n'));
    assert.ok(msgs.some((m: string) => /^5:error:Familiar: falta el nombre/.test(m)), msgs.join('\n'));
    assert.ok(msgs.some((m: string) => /^6:error:El departamento «999» no existe/.test(m)), msgs.join('\n'));
    assert.ok(msgs.some((m: string) => /^8:error:Falta la relación/.test(m)), msgs.join('\n'));
    assert.deepEqual((await personasDe(c.unidad['103']!)).map((p) => p.nombre), ['María Torres Vega', 'Ok Persona']);
    assert.equal(r.body.resumen.personas_nuevas, 1);
  });

  it('el condominio de otra empresa → 404 (como la carga de siempre)', async () => {
    const c = await nuevoCondo();
    const adminB = await login(base, 'admin.b@test.pe');
    const f = new FormData();
    f.append('complejo_id', String(c.id));
    f.append('archivo', new Blob([new Uint8Array(archivo())]), 'x.xlsx');
    assert.equal((await fetch(`${base}/api/contactos/excel`, { method: 'POST', headers: cabecerasDeSesion(adminB), body: f })).status, 404);
  });
});

describe('plantilla con una fila por persona', () => {
  it('sin personas extra es la de siempre (una fila por unidad)', async () => {
    const c = await nuevoCondo();
    const p = await plantilla(c.id);
    assert.equal(p.filas[0]!.length, 8);
    assert.equal(p.filas.length, 1 + 3);
  });

  it('con personas extra sale una fila por persona, y la unidad sin personas, una fila vacía', async () => {
    const c = await nuevoCondo();
    await prisma.personaUnidad.create({ data: { unidad_id: c.unidad['101']!, empresa_id: d.empresaA.id, nombre: 'Pedro Pérez', relacion: 'conyuge', correo: 'pedro@vecino.pe', celular: '+51 912 345 678' } });
    await prisma.personaUnidad.deleteMany({ where: { unidad_id: c.unidad['103']! } });
    await prisma.unidad.update({ where: { id: c.unidad['103']! }, data: { propietario_id: null } });
    const p = await plantilla(c.id);
    assert.deepEqual(p.filas[0], [...ENCABEZADOS_PERSONAS]);
    assert.deepEqual(p.filas.slice(1), [
      ['Block 1', '101', 'Propietario', 'Ana Pérez Gómez', '', ''],
      ['Block 1', '101', 'Cónyuge', 'Pedro Pérez', 'pedro@vecino.pe', '+51 912 345 678'],
      ['Block 1', '102', 'Propietario', 'Luis Ramos Díaz', '', ''],
      ['Block 1', '103', '', '', '', ''],
    ]);
    assert.equal(/\.invalid/.test(JSON.stringify(p.filas)), false, 'ningún correo de relleno');
  });

  it('`formato=personas` la pide así aunque no haya extras; `formato=clasico` la de siempre; otro valor → 422', async () => {
    const c = await nuevoCondo();
    assert.deepEqual((await plantilla(c.id, 'personas')).filas[0], [...ENCABEZADOS_PERSONAS]);
    await prisma.personaUnidad.create({ data: { unidad_id: c.unidad['101']!, empresa_id: d.empresaA.id, nombre: 'Pedro Pérez', relacion: 'conyuge' } });
    assert.equal((await plantilla(c.id, 'clasico')).filas[0]!.length, 8);
    const r = await fetch(`${base}/api/contactos/plantilla.xlsx?complejo_id=${c.id}&formato=otro`, { headers: cabecerasDeSesion(adminA) });
    assert.equal(r.status, 422);
  });

  it('la plantilla tal como se descargó, sin llenar, se vuelve a subir sin cambios ni errores', async () => {
    const c = await nuevoCondo();
    await prisma.personaUnidad.create({ data: { unidad_id: c.unidad['101']!, empresa_id: d.empresaA.id, nombre: 'Pedro Pérez', relacion: 'conyuge', correo: 'pedro@vecino.pe', celular: '+51 912 345 678' } });
    await prisma.personaUnidad.create({ data: { unidad_id: c.unidad['102']!, empresa_id: d.empresaA.id, nombre: 'Rosa Pérez', relacion: 'familiar' } });
    const p = await plantilla(c.id);
    const antes = await foto();
    const r = await subir(p.buffer, c.id);
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.body.resumen.filas, 3);
    assert.equal(r.body.resumen.filas_con_error, 0);
    assert.equal(r.body.resumen.filas_con_aviso, 0);
    for (const k of ['correos_nuevos', 'correos_cambiados', 'celulares_nuevos', 'celulares_cambiados', 'propietarios_nuevos', 'inquilinos_nuevos', 'unidades_unidas', 'cambian_quien_paga', 'invitables', 'personas_nuevas', 'personas_cambiadas']) assert.equal(r.body.resumen[k], 0, k);
    assert.equal(await foto(), antes);
  });
});
