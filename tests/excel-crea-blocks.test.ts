import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import XLSX from 'xlsx';
import { invalidarComercial } from '../src/server/services/comercial/modulos';
import { MAX_UNIDADES_NUEVAS, mensajeFaltantes, resumirFaltantes } from '../src/server/services/crearFaltantesExcel';
import { codigoDeUnidad, correoDeRelleno, dptoCreable, nombreDeBlock, pisoDeDpto } from '../src/server/lib/excelRecibos';
import { cabecerasDeSesion, darCortesia, esperar, iniciar, login, prisma, sembrar, type Datos } from './helpers/app';

/**
 * POST /api/recibos/excel con `crear_faltantes`: el Excel de un block que el condominio aún no tiene crea el block, sus pisos, sus departamentos y
 * sus propietarios (sin correo ni acceso) en la MISMA transacción del recibo. Sin `crear_faltantes` sólo muestra qué se crearía (409, sin escribir nada).
 * Cada prueba usa su propio condominio (con su «Block 1» de producción: B01-101…B01-104) para contar exacto.
 */

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'super' | 'adminA' | 'adminB' | 'prop1', string>;

type Celda = string | number | null;
const aXlsx = (filas: Celda[][]): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Consolidado');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};

const CONCEPTO_PROPIO = 'CONCEPTO DE ESTA PRUEBA';
/** El mismo formato de siempre: 2 conceptos (ADMINISTRACION y el propio) y las 3 columnas de totales. */
const excel = (filas: Celda[][]): Buffer => aXlsx([
  [null, 'GRUPO PRUEBA'],
  [null, null, null, 'MES: Octubre 2026', null, null, 'VENCIMIENTO:', null, '02 DE NOVIEMBRE DE 2026'],
  ['BLOCK', 'Dpto.', 'Apellidos y Nombres', 'ADMINISTRACION', CONCEPTO_PROPIO, 'TOTAL MANT', 'DEUDA ACUMULADA', 'TOTAL'],
  ...filas,
  ['TOTALES', null, null, 0, 0, 0, 0, 0],
]);
const nombreDe = (n: number, dpto: number | string) => `  Pérez   Gómez ${n}-${dpto}  `; // con espacios de más: se recorta
const fila = (block: string, dpto: number | string, nombre: string | null = nombreDe(Number(block.replace(/\D/g, '')), dpto), adm = 100, luz = 5): Celda[] => [block, dpto, nombre, adm, luz, adm + luz, 0, adm + luz];
/** Los 32 departamentos de un block como el real: 8 pisos × 4 (101…104, 201…, 804). */
const DPTOS_32 = [1, 2, 3, 4, 5, 6, 7, 8].flatMap((p) => [1, 2, 3, 4].map((k) => p * 100 + k));
const filasBlock = (n: number, dptos = DPTOS_32) => dptos.map((x) => fila(`B.${n}`, x));

const subir = async (token: string | null, archivo: Buffer, complejoId: number, faltantes: 'true' | 'false' | 'x' | null = null) => {
  const f = new FormData();
  f.append('complejo_id', String(complejoId));
  if (faltantes != null) f.append('crear_faltantes', faltantes);
  f.append('archivo', new Blob([new Uint8Array(archivo)]), 'recibos.xlsx');
  const r = await fetch(`${base}/api/recibos/excel`, { method: 'POST', headers: cabecerasDeSesion(token), body: f });
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* no es JSON */ }
  return { status: r.status, body, texto };
};

/** El catálogo no trae tope en Gratis (lo fija el superadmin desde Precios): estas pruebas lo ponen y lo devuelven a como estaba. */
async function conTopeGratis(tope: number, fn: () => Promise<void>) {
  const antes = (await prisma.planComercial.findUniqueOrThrow({ where: { clave: 'gratis' } })).unidades_maximas;
  await prisma.planComercial.update({ where: { clave: 'gratis' }, data: { unidades_maximas: tope } });
  invalidarComercial();
  try { await fn(); } finally {
    await prisma.planComercial.update({ where: { clave: 'gratis' }, data: { unidades_maximas: antes } });
    invalidarComercial();
  }
}

let nCondo = 0;
/** Un condominio de la empresa A con su «Block 1» (8 pisos no: 2 pisos, 4 departamentos B01-101…B01-104 con propietario). */
async function nuevoCondominio(plan: 'cortesia' | 'gratis' = 'cortesia') {
  const complejo = await prisma.complejoHabitacional.create({ data: { nombre: `Condominio ${++nCondo}`, tipo: 'Edificio', empresa_id: d.empresaA.id } });
  if (plan === 'cortesia') await darCortesia(complejo.id);
  else { await prisma.suscripcionCondominio.create({ data: { complejo_id: complejo.id, plan_clave: 'gratis', modulos: [], estado: 'gratis' } }); invalidarComercial(); }
  const block1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: complejo.id } });
  const pisos = await Promise.all([1, 2].map((numero) => prisma.piso.create({ data: { numero, estructura_id: block1.id } })));
  for (const dpto of [101, 102, 103, 104]) {
    const prop = await prisma.usuario.create({ data: { nombre: `DUEÑO ORIGINAL ${dpto}`, email: `fixture${complejo.id}-${dpto}@test.pe`, rol: 'propietario' } });
    await prisma.unidad.create({ data: { codigo: `B01-${dpto}`, tipo: 'departamento', complejo_id: complejo.id, empresa_id: d.empresaA.id, estructura_id: block1.id, piso_id: pisos[dpto < 200 ? 0 : 1].id, propietario_id: prop.id, estado: 'activa' } });
  }
  return { id: complejo.id, block1Id: block1.id };
}

/** Todo lo que el Excel puede escribir (el recuento de usuarios y conceptos es global: las pruebas corren una a la vez en esta base). */
const contar = async (complejoId: number) => ({
  estructuras: await prisma.estructura.count({ where: { complejo_id: complejoId } }),
  pisos: await prisma.piso.count({ where: { estructura: { complejo_id: complejoId } } }),
  unidades: await prisma.unidad.count({ where: { complejo_id: complejoId } }),
  recibos: await prisma.recibo.count({ where: { complejo_id: complejoId } }),
  recibosConceptos: await prisma.reciboConcepto.count({ where: { recibo: { complejo_id: complejoId } } }),
  cargos: await prisma.reciboConceptoUnidad.count({ where: { unidad: { complejo_id: complejoId } } }),
  usuarios: await prisma.usuario.count(),
  conceptos: await prisma.concepto.count(),
  notificaciones: await prisma.notificacion.count(),
});
const propietarioDeUnidad = (complejoId: number, codigo: string) =>
  prisma.unidad.findFirstOrThrow({ where: { complejo_id: complejoId, codigo }, include: { propietario: { omit: { password_hash: false } }, piso: true, estructura: true } });

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), adminB: await login(base, 'admin.b@test.pe'), prop1: await login(base, 'prop1@test.pe') };
});
after(async () => {
  await cerrar();
  await prisma.$disconnect();
});

describe('Excel que crea lo que falta: vista previa (sin escribir nada)', () => {
  it('un block nuevo → 409 FALTAN_UNIDADES con los números exactos, y CERO filas nuevas en la base', async () => {
    const c = await nuevoCondominio();
    const antes = await contar(c.id);
    const r = await subir(T.adminA, excel(filasBlock(2)), c.id);
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.body.code, 'FALTAN_UNIDADES');
    assert.deepEqual(r.body.faltantes.totales, { blocks: 1, pisos: 8, unidades: 32, propietarios: 32 });
    assert.deepEqual(r.body.faltantes.blocks, [{ nombre: 'Block 2', nuevo: true, pisos: 8, unidades: DPTOS_32.map((x) => `B02-${x}`).sort(), propietarios: 32 }]);
    assert.match(r.body.error, /Se van a crear el Block 2, 8 pisos, 32 departamentos y 32 propietarios\./);
    assert.deepEqual(await contar(c.id), antes, 'ni block, ni pisos, ni unidades, ni usuarios, ni recibos, ni siquiera el concepto del Excel');
    assert.ok(!r.texto.includes('Pérez'), 'la respuesta trae sólo conteos y códigos, no nombres de personas');
  });

  it('el mismo Excel con crear_faltantes=false no crea nada y se salta las filas (sin recibo de ese block)', async () => {
    const c = await nuevoCondominio();
    const antes = await contar(c.id);
    const r = await subir(T.adminA, excel(filasBlock(2)), c.id, 'false');
    assert.equal(r.status, 422, r.texto);
    assert.deepEqual(await contar(c.id), antes);
  });

  it('crear_faltantes con un valor que no es true/false → 422 y no escribe nada', async () => {
    const c = await nuevoCondominio();
    const antes = await contar(c.id);
    const r = await subir(T.adminA, excel(filasBlock(2)), c.id, 'x');
    assert.equal(r.status, 422, r.texto);
    assert.deepEqual(await contar(c.id), antes);
  });
});

describe('Excel que crea lo que falta: confirmar con crear_faltantes=true', () => {
  it('crea el block, sus 8 pisos, 32 unidades, 32 propietarios con el correo de relleno y el recibo con sus cargos', async () => {
    const c = await nuevoCondominio();
    const antes = await contar(c.id);
    const r = await subir(T.adminA, excel(filasBlock(2)), c.id, 'true');
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(r.body.creado.totales, { blocks: 1, pisos: 8, unidades: 32, propietarios: 32 });
    assert.equal(r.body.unidades_procesadas, 32);

    const block = await prisma.estructura.findFirstOrThrow({ where: { complejo_id: c.id, nombre: 'Block 2' }, include: { pisos: { orderBy: { numero: 'asc' } } } });
    assert.equal(block.tipo, 'block');
    assert.deepEqual(block.pisos.map((p) => p.numero), [1, 2, 3, 4, 5, 6, 7, 8]);

    const unidades = await prisma.unidad.findMany({ where: { complejo_id: c.id, estructura_id: block.id }, include: { piso: true, propietario: { omit: { password_hash: false } } }, orderBy: { codigo: 'asc' } });
    assert.equal(unidades.length, 32);
    for (const un of unidades) {
      const dpto = Number(un.codigo.slice(4));
      assert.match(un.codigo, /^B02-[1-8]0[1-4]$/);
      assert.equal(un.tipo, 'departamento');
      assert.equal(un.estado, 'activa');
      assert.equal(un.empresa_id, d.empresaA.id);
      assert.equal(un.complejo_id, c.id);
      assert.equal(un.piso?.numero, Math.floor(dpto / 100), `piso de ${un.codigo}`);
      assert.equal(un.piso?.estructura_id, block.id);
      const p = un.propietario!;
      assert.equal(p.rol, 'propietario');
      assert.equal(p.email, `b2-${dpto}@sin-correo.invalid`);
      assert.equal(p.nombre, `Pérez Gómez 2-${dpto}`, 'recortado y sin espacios de más');
      assert.equal(p.password_hash, null, 'sin contraseña');
      assert.equal(p.empresa_id, null, 'los residentes no llevan empresa');
      assert.equal(p.telefono, null);
    }

    const recibo = await prisma.recibo.findFirstOrThrow({ where: { complejo_id: c.id, estructura_id: block.id, mes: 10, anio: 2026 } });
    assert.equal(recibo.estado, 'emitido');
    assert.equal(recibo.descripcion, 'Mantenimiento de octubre de 2026 · Block 2');
    assert.equal(await prisma.reciboConceptoUnidad.count({ where: { reciboConcepto: { recibo_id: recibo.id } } }), 64, '32 unidades × 2 conceptos');

    const despues = await contar(c.id);
    assert.deepEqual({ estructuras: despues.estructuras - antes.estructuras, pisos: despues.pisos - antes.pisos, unidades: despues.unidades - antes.unidades, usuarios: despues.usuarios - antes.usuarios, recibos: despues.recibos - antes.recibos, cargos: despues.cargos - antes.cargos }, { estructuras: 1, pisos: 8, unidades: 32, usuarios: 32, recibos: 1, cargos: 64 });
    assert.equal(despues.notificaciones, antes.notificaciones, 'los propietarios sin correo no reciben avisos');
  });

  it('el monto de cada cargo sale del Excel, en la unidad creada', async () => {
    const c = await nuevoCondominio();
    const r = await subir(T.adminA, excel([fila('B.2', 101, 'LUIS RUIZ', 123.69, 8.554566)]), c.id, 'true');
    assert.equal(r.status, 201, r.texto);
    const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { unidad: { complejo_id: c.id, codigo: 'B02-101' } }, include: { reciboConcepto: { include: { concepto: true } } } });
    assert.deepEqual(cargos.map((x) => [x.reciboConcepto?.concepto?.nombre, x.monto.toString()]).sort(), [['ADMINISTRACION', '123.69'], [CONCEPTO_PROPIO, '8.55']]);
  });

  it('la auditoría registra lo creado como conteos y códigos, sin nombres ni correos', async () => {
    const c = await nuevoCondominio();
    const r = await subir(T.adminA, excel(filasBlock(2, [101, 102])), c.id, 'true');
    assert.equal(r.status, 201, r.texto);
    const a = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'crear_desde_excel', entidad_id: r.body.recibo_id } }));
    const detalle = a.detalle as { creado: { blocks: number; pisos: number; unidades: number; propietarios: number; blocks_nuevos: string[]; codigos: string[] } };
    assert.deepEqual(detalle.creado, { blocks: 1, pisos: 1, unidades: 2, propietarios: 2, blocks_nuevos: ['Block 2'], codigos: ['B02-101', 'B02-102'] });
    assert.ok(!JSON.stringify(a.detalle).match(/Pérez|sin-correo/), 'sin datos personales');
  });

  it('subir de nuevo el mismo Excel no duplica nada: reemplaza el recibo y no vuelve a crear block, unidades ni propietarios', async () => {
    const c = await nuevoCondominio();
    assert.equal((await subir(T.adminA, excel(filasBlock(2)), c.id, 'true')).status, 201);
    const antes = await contar(c.id);
    for (const faltantes of [null, 'true'] as const) {
      const r = await subir(T.adminA, excel(filasBlock(2)), c.id, faltantes);
      assert.equal(r.status, 201, r.texto);
      assert.equal(r.body.creado, undefined, 'ya no falta nada');
      assert.equal(r.body.recibos.find((x: { torre: string }) => x.torre === 'Block 2').accion, 'reemplazado');
    }
    assert.deepEqual(await contar(c.id), antes);
  });

  it('Excel mixto: el Block 1 que ya existe no se toca (ni su propietario aunque el nombre del Excel sea otro) y el Block 2 nuevo se crea', async () => {
    const c = await nuevoCondominio();
    const antesDeUnidad = await propietarioDeUnidad(c.id, 'B01-101');
    const mixto = excel([...[101, 102, 103, 104].map((x) => fila('B.1', x, 'OTRO NOMBRE DISTINTO')), ...filasBlock(2, [101, 102])]);

    const previa = await subir(T.adminA, mixto, c.id);
    assert.equal(previa.status, 409, previa.texto);
    assert.deepEqual(previa.body.faltantes.totales, { blocks: 1, pisos: 1, unidades: 2, propietarios: 2 }, 'sólo lo del Block 2');
    assert.deepEqual(previa.body.faltantes.blocks.map((b: { nombre: string }) => b.nombre), ['Block 2']);

    const r = await subir(T.adminA, mixto, c.id, 'true');
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(r.body.recibos.map((x: { torre: string; accion: string }) => [x.torre, x.accion]), [['Block 1', 'creado'], ['Block 2', 'creado']]);
    const despuesDeUnidad = await propietarioDeUnidad(c.id, 'B01-101');
    assert.equal(despuesDeUnidad.id, antesDeUnidad.id);
    assert.equal(despuesDeUnidad.propietario_id, antesDeUnidad.propietario_id, 'no cambió de propietario');
    assert.equal(despuesDeUnidad.propietario?.nombre, 'DUEÑO ORIGINAL 101', 'ni se renombró');
    assert.equal(despuesDeUnidad.piso_id, antesDeUnidad.piso_id);
    assert.equal(await prisma.estructura.count({ where: { complejo_id: c.id } }), 2);
  });

  it('un departamento nuevo en un block que ya existe se crea ahí (con su piso, creándolo si falta) y el block no se duplica', async () => {
    const c = await nuevoCondominio(); // Block 1 tiene los pisos 1 y 2
    const r = await subir(T.adminA, excel([fila('B.1', 101), fila('B.1', 105, 'NUEVA DUEÑA'), fila('B.1', 305, 'OTRA DUEÑA')]), c.id, 'true');
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(r.body.creado.totales, { blocks: 0, pisos: 1, unidades: 2, propietarios: 2 });
    assert.deepEqual(r.body.creado.blocks, [{ nombre: 'Block 1', nuevo: false, pisos: 1, unidades: ['B01-105', 'B01-305'], propietarios: 2 }]);
    const u105 = await propietarioDeUnidad(c.id, 'B01-105');
    const u305 = await propietarioDeUnidad(c.id, 'B01-305');
    assert.equal(u105.estructura_id, c.block1Id);
    assert.equal(u105.piso?.numero, 1);
    assert.equal(u305.piso?.numero, 3);
    assert.equal(u305.piso?.estructura_id, c.block1Id);
    assert.equal(u105.propietario?.email, 'b1-105@sin-correo.invalid');
    assert.equal(await prisma.estructura.count({ where: { complejo_id: c.id } }), 1);
    assert.equal(await prisma.piso.count({ where: { estructura_id: c.block1Id } }), 3, 'se agregó el piso 3; los 2 que había siguen');
  });

  it('una fila sin nombre crea la unidad sin propietario (y no crea ningún usuario por ella)', async () => {
    const c = await nuevoCondominio();
    const usuarios = await prisma.usuario.count();
    const r = await subir(T.adminA, excel([fila('B.2', 101, 'CON NOMBRE'), fila('B.2', 102, null), fila('B.2', 103, '   ')]), c.id, 'true');
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(r.body.creado.totales, { blocks: 1, pisos: 1, unidades: 3, propietarios: 1 });
    assert.equal((await propietarioDeUnidad(c.id, 'B02-102')).propietario_id, null);
    assert.equal((await propietarioDeUnidad(c.id, 'B02-103')).propietario_id, null);
    assert.equal((await propietarioDeUnidad(c.id, 'B02-101')).propietario?.nombre, 'CON NOMBRE');
    assert.equal(await prisma.usuario.count(), usuarios + 1);
  });

  it('si el correo de relleno ya lo tiene otro usuario (de otro condominio) NO se reutiliza: el propietario nuevo lleva el sufijo -2', async () => {
    const c = await nuevoCondominio();
    const ajeno = await prisma.usuario.create({ data: { nombre: 'PROPIETARIO DE OTRO CONDOMINIO', email: 'b4-101@sin-correo.invalid', rol: 'propietario' } });
    const r = await subir(T.adminA, excel([fila('B.4', 101, 'DUEÑO NUEVO'), fila('B.4', 102, 'OTRO NUEVO')]), c.id, 'true');
    assert.equal(r.status, 201, r.texto);
    const u = await propietarioDeUnidad(c.id, 'B04-101');
    assert.equal(u.propietario?.email, 'b4-101-2@sin-correo.invalid');
    assert.equal(u.propietario?.nombre, 'DUEÑO NUEVO');
    assert.notEqual(u.propietario_id, ajeno.id);
    assert.equal((await propietarioDeUnidad(c.id, 'B04-102')).propietario?.email, 'b4-102@sin-correo.invalid');
    assert.equal(await prisma.unidad.count({ where: { propietario_id: ajeno.id } }), 0, 'el usuario ajeno no quedó ligado a una unidad de este condominio');
    const intacto = await prisma.usuario.findUniqueOrThrow({ where: { id: ajeno.id } });
    assert.equal(intacto.nombre, 'PROPIETARIO DE OTRO CONDOMINIO');
  });

  it('dos colisiones seguidas siguen buscando: -2 ocupado → -3', async () => {
    const c = await nuevoCondominio();
    await prisma.usuario.createMany({ data: [{ nombre: 'A', email: 'b5-101@sin-correo.invalid', rol: 'propietario' }, { nombre: 'B', email: 'b5-101-2@sin-correo.invalid', rol: 'propietario' }] });
    assert.equal((await subir(T.adminA, excel([fila('B.5', 101, 'NUEVO')]), c.id, 'true')).status, 201);
    assert.equal((await propietarioDeUnidad(c.id, 'B05-101')).propietario?.email, 'b5-101-3@sin-correo.invalid');
  });

  it('casos raros: departamento «PH» sin piso, «5» sin piso, «0101» = 101, bloque «B.2» y «Block 2» son el mismo; «10-1» y «0» se saltan con aviso', async () => {
    const c = await nuevoCondominio();
    const r = await subir(T.adminA, excel([fila('B.2', 'ph', 'DUEÑO PH'), fila('B.2', 5, 'DUEÑO 5'), fila('Block 2', '0101', 'DUEÑO 101'), fila('B.2', '10-1', 'MALO'), fila('B.2', 0, 'CERO'), fila('B.2', 6100, 'MUY ALTO')]), c.id, 'true');
    assert.equal(r.status, 201, r.texto);
    assert.deepEqual(r.body.creado.blocks, [{ nombre: 'Block 2', nuevo: true, pisos: 1, unidades: ['B02-101', 'B02-5', 'B02-PH'], propietarios: 3 }]);
    assert.equal((await propietarioDeUnidad(c.id, 'B02-PH')).piso_id, null);
    assert.equal((await propietarioDeUnidad(c.id, 'B02-PH')).propietario?.email, 'b2-ph@sin-correo.invalid');
    assert.equal((await propietarioDeUnidad(c.id, 'B02-5')).piso_id, null);
    assert.equal((await propietarioDeUnidad(c.id, 'B02-101')).piso?.numero, 1);
    assert.equal(r.body.filas_saltadas, 4, 'las 3 filas malas y la de TOTALES');
    assert.equal(r.body.advertencias.filter((a: string) => a.includes('no es un número de departamento que se pueda crear')).length, 3);
  });

  it('un código que ya existe fuera de ese block (unidad suelta) no se duplica ni se toca: la fila se salta con aviso y lo demás sigue', async () => {
    const c = await nuevoCondominio();
    const suelta = await prisma.unidad.create({ data: { codigo: 'B07-101', tipo: 'departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estado: 'activa' } });
    const r = await subir(T.adminA, excel([fila('B.7', 101, 'CHOCA'), fila('B.7', 102, 'ENTRA')]), c.id, 'true');
    assert.equal(r.status, 201, r.texto);
    assert.ok(r.body.advertencias.includes('B.7 Dpto. 101: ya existe una unidad con el código B07-101 fuera de ese block; se saltó la fila'));
    assert.equal(await prisma.unidad.count({ where: { complejo_id: c.id, codigo: 'B07-101' } }), 1);
    const igual = await prisma.unidad.findUniqueOrThrow({ where: { id: suelta.id } });
    assert.equal(igual.estructura_id, null);
    assert.equal(igual.propietario_id, null);
    assert.deepEqual(r.body.creado.blocks.map((b: { unidades: string[] }) => b.unidades), [['B07-102']]);
  });

  it('una unidad que existe pero está inactiva no se vuelve a crear ni se carga: aviso y fila saltada', async () => {
    const c = await nuevoCondominio();
    const inactiva = await prisma.unidad.findFirstOrThrow({ where: { complejo_id: c.id, codigo: 'B01-104' } });
    await prisma.unidad.update({ where: { id: inactiva.id }, data: { estado: 'inactiva' } });
    const antes = await contar(c.id);
    const r = await subir(T.adminA, excel([fila('B.1', 101), fila('B.1', 104)]), c.id);
    assert.equal(r.status, 201, r.texto);
    assert.ok(r.body.advertencias.includes('B.1 Dpto. 104: la unidad existe pero no está activa; se saltó la fila'));
    assert.equal(r.body.creado, undefined);
    assert.equal((await contar(c.id)).unidades, antes.unidades);
  });

  it('en un condominio SIN blocks no se crea nada (aunque se pida): sigue el emparejamiento por departamento de siempre', async () => {
    const antes = await contar(d.complejoB.id);
    const r = await subir(T.adminB, excel(filasBlock(2, [901, 902])), d.complejoB.id, 'true');
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.creado, undefined);
    assert.equal(r.body.unidades_procesadas, 0);
    assert.ok(r.body.advertencias.includes('B.2 Dpto. 901: no existe la unidad; se saltó la fila'));
    const despues = await contar(d.complejoB.id);
    assert.equal(despues.estructuras, antes.estructuras);
    assert.equal(despues.unidades, antes.unidades);
  });

  it('el superadmin también puede: las unidades llevan la empresa del condominio, no la suya', async () => {
    const c = await nuevoCondominio();
    const r = await subir(T.super, excel(filasBlock(3, [101])), c.id, 'true');
    assert.equal(r.status, 201, r.texto);
    assert.equal((await propietarioDeUnidad(c.id, 'B03-101')).empresa_id, d.empresaA.id);
  });
});

describe('Excel que crea lo que falta: permisos y topes', () => {
  it('un admin de otra empresa no puede ni ver la vista previa ni crear: 422 «no existe o no tienes acceso» y nada queda escrito', async () => {
    const c = await nuevoCondominio();
    const antes = await contar(c.id);
    for (const faltantes of [null, 'true'] as const) {
      const r = await subir(T.adminB, excel(filasBlock(2)), c.id, faltantes);
      assert.equal(r.status, 422, r.texto);
      assert.match(r.body.error, /complejo_id/);
      assert.equal(r.body.faltantes, undefined, 'no filtra qué le falta al condominio ajeno');
    }
    assert.deepEqual(await contar(c.id), antes);
  });

  it('un residente → 403 y nada queda escrito', async () => {
    const c = await nuevoCondominio();
    const antes = await contar(c.id);
    const r = await subir(T.prop1, excel(filasBlock(2)), c.id, 'true');
    assert.equal(r.status, 403, r.texto);
    assert.deepEqual(await contar(c.id), antes);
  });

  it('sin sesión → 401', async () => {
    const c = await nuevoCondominio();
    assert.equal((await subir(null, excel(filasBlock(2)), c.id, 'true')).status, 401);
  });

  it('tope del plan Gratis (20): 4 que hay + 32 nuevas no caben → 403 LIMITE_UNIDADES, en la vista previa y al confirmar, y nada queda escrito', async () => {
    await conTopeGratis(20, async () => {
      const c = await nuevoCondominio('gratis');
      const antes = await contar(c.id);
      for (const faltantes of [null, 'true'] as const) {
        const r = await subir(T.adminA, excel(filasBlock(2)), c.id, faltantes);
        assert.equal(r.status, 403, r.texto);
        assert.equal(r.body.code, 'LIMITE_UNIDADES');
        assert.equal(r.body.limite, 20);
        assert.equal(r.body.actuales, 4);
      }
      assert.deepEqual(await contar(c.id), antes);
    });
  });

  it('tope del plan Gratis: 4 + 16 = 20 cabe justo y se crea; una más no', async () => {
    await conTopeGratis(20, async () => {
      const c = await nuevoCondominio('gratis');
      const justo = [1, 2, 3, 4].flatMap((p) => [1, 2, 3, 4].map((k) => p * 100 + k)); // 16
      const r = await subir(T.adminA, excel(filasBlock(2, justo)), c.id, 'true');
      assert.equal(r.status, 201, r.texto);
      assert.equal(await prisma.unidad.count({ where: { complejo_id: c.id } }), 20);
      const otra = await subir(T.adminA, excel(filasBlock(3, [101])), c.id, 'true');
      assert.equal(otra.status, 403, otra.texto);
      assert.equal(otra.body.code, 'LIMITE_UNIDADES');
      assert.equal(await prisma.unidad.count({ where: { complejo_id: c.id } }), 20);
      assert.equal(await prisma.estructura.count({ where: { complejo_id: c.id, nombre: 'Block 3' } }), 0);
    });
  });

  it('el tope no afecta a un Excel que no crea nada (todo existe): sigue cargando el recibo en Gratis aunque pase de 20', async () => {
    await conTopeGratis(20, async () => {
      const c = await nuevoCondominio('gratis');
      for (let i = 0; i < 18; i++) await prisma.unidad.create({ data: { codigo: `X-${c.id}-${i}`, tipo: 'departamento', complejo_id: c.id, empresa_id: d.empresaA.id, estado: 'activa' } });
      const r = await subir(T.adminA, excel([101, 102, 103, 104].map((x) => fila('B.1', x))), c.id);
      assert.equal(r.status, 201, r.texto);
      assert.equal(r.body.unidades_procesadas, 4);
    });
  });

  it(`más de ${MAX_UNIDADES_NUEVAS} departamentos nuevos de una vez → 422 y nada queda escrito`, async () => {
    const c = await nuevoCondominio();
    const antes = await contar(c.id);
    const muchas = Array.from({ length: MAX_UNIDADES_NUEVAS + 1 }, (_, i) => fila('B.2', 101 + i, null));
    const r = await subir(T.adminA, excel(muchas), c.id, 'true');
    assert.equal(r.status, 422, r.texto);
    assert.match(r.body.error, /máximo por subida/);
    assert.deepEqual(await contar(c.id), antes);
  });
});

describe('Excel que crea lo que falta: todo o nada (una sola transacción)', () => {
  it('si el recibo de otro block de la misma subida falla (409: ya tiene pagos), no queda ni el block nuevo ni sus pisos, unidades o propietarios', async () => {
    const c = await nuevoCondominio();
    // El Block 1 ya tiene su recibo, con un cargo pagado: reemplazarlo falla DESPUÉS de crear lo que falta.
    assert.equal((await subir(T.adminA, excel([101, 102].map((x) => fila('B.1', x))), c.id)).status, 201);
    await prisma.reciboConceptoUnidad.updateMany({ where: { unidad: { complejo_id: c.id, codigo: 'B01-101' } }, data: { estado_pago: 'pagado' } });
    const antes = await contar(c.id);
    const r = await subir(T.adminA, excel([...[101, 102].map((x) => fila('B.1', x)), ...filasBlock(6, [101, 102, 201])]), c.id, 'true');
    assert.equal(r.status, 409, r.texto);
    assert.match(r.body.error, /ya tiene pagos registrados/);
    assert.deepEqual(await contar(c.id), antes, 'ni block, ni pisos, ni unidades, ni usuarios, ni conceptos');
    assert.equal(await prisma.estructura.count({ where: { complejo_id: c.id, nombre: 'Block 6' } }), 0);
    assert.equal(await prisma.usuario.count({ where: { email: { startsWith: 'b6-' } } }), 0);
  });
});

describe('crearFaltantesExcel: funciones puras', () => {
  it('dptoCreable: número 1–6099 en forma canónica, código corto alfanumérico en mayúsculas, lo demás null', () => {
    assert.deepEqual(['101', ' 0101 ', 804, '5', 6099].map(dptoCreable), ['101', '101', '804', '5', '6099']);
    assert.deepEqual(['ph', 'A1', 'a1b2c3d4e5'].map(dptoCreable), ['PH', 'A1', 'A1B2C3D4E5']);
    assert.deepEqual(['', '0', '6100', '101.5', '10-1', 'a1b2c3d4e5f', '1 01', null, undefined].map(dptoCreable), [null, null, null, null, null, null, null, null, null]);
  });
  it('pisoDeDpto: floor(dpto/100); menor que 100 o no numérico → null', () => {
    assert.deepEqual(['101', '804', '1204', '99', '5', 'PH'].map(pisoDeDpto), [1, 8, 12, null, null, null]);
  });
  it('código, nombre y correo con las convenciones de producción', () => {
    assert.equal(nombreDeBlock(5), 'Block 5');
    assert.equal(codigoDeUnidad(5, '101'), 'B05-101');
    assert.equal(codigoDeUnidad(12, '804'), 'B12-804');
    assert.equal(codigoDeUnidad(100, '101'), 'B100-101');
    assert.equal(correoDeRelleno(5, '101'), 'b5-101@sin-correo.invalid');
    assert.equal(correoDeRelleno(12, 'PH'), 'b12-ph@sin-correo.invalid');
  });
  it('mensajeFaltantes: singular, plural, varios blocks y departamentos en blocks que ya existen', () => {
    const un = (numero: number, dpto: string, estructuraId: number | null = null) => ({ clave: `${numero}|${dpto}`, numero, dpto, codigo: codigoDeUnidad(numero, dpto), nombre: 'X', estructuraId, piso: 1 });
    const uno = resumirFaltantes([un(2, '101')], [], new Map());
    assert.match(mensajeFaltantes(uno), /Se van a crear el Block 2, 1 piso, 1 departamento y 1 propietario\. /);
    const varios = resumirFaltantes([un(2, '101'), un(3, '101'), un(1, '105', 7)], [{ id: 7, nombre: 'Block 1' }], new Map([[7, new Set([1])]]));
    assert.match(mensajeFaltantes(varios), /Se van a crear los blocks Block 2 y Block 3, 2 pisos, 3 departamentos y 3 propietarios\. Incluye 1 departamento en un block que ya existe \(Block 1\)\./);
    assert.deepEqual(varios.totales, { blocks: 2, pisos: 2, unidades: 3, propietarios: 3 });
  });
});
