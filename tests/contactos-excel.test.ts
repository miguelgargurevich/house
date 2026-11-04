import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import bcrypt from 'bcrypt';
import XLSX from 'xlsx';
import { hoyLima } from '../src/server/lib/fechas';
import { cabecerasDeSesion, darCortesia, esperar, iniciar, llamar, login, prisma, sembrar, type Datos } from './helpers/app';
import type { DepsAvisos } from '../src/server/services/avisos/canales';
import { quienPaga } from '../src/server/services/avisos/cola';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';
import { comercialDeps, invalidarComercial } from '../src/server/services/comercial/modulos';
import { diasParaVaciar, procesarInvitaciones } from '../src/server/services/contactos/cola';
import { buscarCabecera, clasificarEncabezado, leerContactos, leerPersona, normalizarEncabezado } from '../src/server/services/contactos/lector';
import { mismaPersona } from '../src/server/services/contactos/plan';
import { ENCABEZADOS, ordenarUnidades } from '../src/server/services/contactos/plantilla';

/**
 * Carga de contactos de los vecinos por Excel: plantilla prellenada, vista previa (409 REVISAR_CONTACTOS, no escribe nada), guardado en una transacción,
 * separación entre empresas e invitaciones en tandas (tope por día de Lima). Nunca correos reales: el envío es un `fetch` falso.
 * Cada prueba arma su propio condominio de la empresa A para contar exacto.
 */

let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'adminA' | 'adminB' | 'superT' | 'junta' | 'vecino', string>;

type Celda = string | number | null;
const aXlsx = (filas: Celda[][]): Buffer => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), 'Contactos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
};
/** Una fila de la plantilla: Block, Dpto, Propietario, Correo prop., Celular prop., Inquilino, Correo inq., Celular inq. */
const fila = (block: string, dpto: number | string, prop: Celda = null, correo: Celda = null, cel: Celda = null, inq: Celda = null, correoInq: Celda = null, celInq: Celda = null): Celda[] => [block, dpto, prop, correo, cel, inq, correoInq, celInq];
const excel = (...filas: Celda[][]): Buffer => aXlsx([[...ENCABEZADOS], ...filas]);

interface Resp { status: number; body: any; texto: string; headers: Headers } // eslint-disable-line @typescript-eslint/no-explicit-any
async function leer(r: Response): Promise<Resp> {
  const texto = await r.text();
  let body: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try { body = JSON.parse(texto); } catch { /* no es JSON */ }
  return { status: r.status, body, texto, headers: r.headers };
}
const subir = async (token: string | null, archivo: Buffer | null, complejoId: number | string | null, campos: Record<string, string> = {}): Promise<Resp> => {
  const f = new FormData();
  if (complejoId != null) f.append('complejo_id', String(complejoId));
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  if (archivo) f.append('archivo', new Blob([new Uint8Array(archivo)]), 'contactos.xlsx');
  return leer(await fetch(`${base}/api/contactos/excel`, { method: 'POST', headers: cabecerasDeSesion(token), body: f }));
};
const guardar = (token: string | null, archivo: Buffer, complejoId: number, extra: Record<string, string> = {}) => subir(token, archivo, complejoId, { confirmar: 'true', ...extra });
const plantilla = async (token: string | null, complejoId: number | string) => fetch(`${base}/api/contactos/plantilla.xlsx?complejo_id=${complejoId}`, { headers: cabecerasDeSesion(token) });

// ---------- Condominio de prueba ----------
const NOMBRES = { '1-101': 'Ana Pérez Gómez', '1-102': 'Luis Ramos Díaz', '1-103': 'María Torres Vega', '1-104': 'Carlos Soto Rojas', '2-101': 'Rosa Medina Paz', '2-102': 'Carlos Soto' } as const;
interface Condo { id: number; b1: number; b2: number; unidad: Record<string, number>; propietario: Record<string, number> }
let nCondo = 0;
/** Block 1 (101…104, más 105 inactiva) y Block 2 (101, 102), cada una con su propietario de relleno (`…@sin-correo.invalid`). */
async function nuevoCondo(): Promise<Condo> {
  const complejo = await prisma.complejoHabitacional.create({ data: { nombre: `Condominio ${++nCondo}`, tipo: 'Edificio', empresa_id: d.empresaA.id } });
  await darCortesia(complejo.id);
  const b1 = await prisma.estructura.create({ data: { nombre: 'Block 1', tipo: 'block', complejo_id: complejo.id } });
  const b2 = await prisma.estructura.create({ data: { nombre: 'Block 2', tipo: 'block', complejo_id: complejo.id } });
  const unidad: Record<string, number> = {};
  const propietario: Record<string, number> = {};
  for (const [clave, nombre] of Object.entries(NOMBRES)) {
    const [blk, dpto] = clave.split('-') as [string, string];
    const p = await prisma.usuario.create({ data: { nombre, email: `b${blk}-${dpto}-c${complejo.id}@sin-correo.invalid`, rol: 'propietario' } });
    const u = await prisma.unidad.create({ data: { codigo: `B0${blk}-${dpto}`, tipo: 'departamento', complejo_id: complejo.id, empresa_id: d.empresaA.id, estructura_id: blk === '1' ? b1.id : b2.id, propietario_id: p.id, estado: 'activa' } });
    unidad[clave] = u.id;
    propietario[clave] = p.id;
  }
  // Inactiva: no sale en la plantilla ni se puede cargar.
  const pi = await prisma.usuario.create({ data: { nombre: 'Dueño Inactivo', email: `b1-105-c${complejo.id}@sin-correo.invalid`, rol: 'propietario' } });
  await prisma.unidad.create({ data: { codigo: 'B01-105', tipo: 'departamento', complejo_id: complejo.id, empresa_id: d.empresaA.id, estructura_id: b1.id, propietario_id: pi.id, estado: 'inactiva' } });
  return { id: complejo.id, b1: b1.id, b2: b2.id, unidad, propietario };
}

/** Todo lo que una carga podría tocar, para comprobar que NO se tocó. */
async function foto() {
  return JSON.stringify({
    usuarios: await prisma.usuario.findMany({ orderBy: { id: 'asc' }, select: { id: true, nombre: true, email: true, telefono: true, rol: true, empresa_id: true, complejo_id: true, aviso_email: true, aviso_whatsapp: true, updated_at: true } }),
    unidades: await prisma.unidad.findMany({ orderBy: { id: 'asc' }, select: { id: true, propietario_id: true, inquilino_id: true, updated_at: true } }),
    cola: await prisma.invitacionEnCola.count(),
    tokens: await prisma.tokenInvitacion.count(),
  });
}

/** El archivo de la prueba grande: 6 filas, una con error. */
const archivoGrande = () => excel(
  fila('Block 1', 101, 'Ana Pérez', 'ana@vecino.pe', '987654321', 'Pedro Quispe', 'pedro@vecino.pe', '912345678'),
  fila('Block 1', 102, 'Luis Ramos', 'LUIS@vecino.pe'),
  fila('Block 1', 103, 'María Torres', null, '961234567'),
  fila('Block 1', 104, 'Carlos Soto Rojas', 'carlos@vecino.pe', '955555555'),
  fila('Block 2', 102, 'Carlos Soto', 'carlos@vecino.pe'),
  fila('Block 2', 101, 'Rosa Medina', null, 'abc'),
);

// ---------- Correo y reloj falsos ----------
interface Correo { para: string; asunto: string; texto: string }
let enviados: Correo[] = [];
let respuestaCorreo = 200;
const depsFalsas = (): DepsAvisos => ({
  ahora: () => comercialDeps.ahora(),
  esperar: async () => {},
  azar: () => 0,
  env: { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'Torre <avisos@ejemplo.test>' },
  fetch: (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), 'https://api.resend.com/emails', 'sólo Resend, y falso');
    const b = JSON.parse(String(init?.body));
    if (respuestaCorreo === 200) enviados.push({ para: b.to[0], asunto: b.subject, texto: b.text });
    return new Response('{}', { status: respuestaCorreo });
  }) as typeof fetch,
});
const depsOriginal = comercialCorreo.deps;
const relojOriginal = comercialDeps.ahora;
const fijarReloj = (iso: string) => { comercialDeps.ahora = () => new Date(iso); };

before(async () => {
  d = await sembrar();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000 } }));
});
after(async () => { await cerrar(); await prisma.$disconnect(); });
// Cada prueba parte de una base recién sembrada: los correos de una no pueden chocar con los de otra (los vecinos de una MISMA empresa sí se juntan por correo).
beforeEach(async () => {
  d = await sembrar();
  nCondo = 0;
  // La junta: un propietario con cargo de presidente en un block.
  await prisma.usuario.update({ where: { id: d.propietario1.id }, data: { cargo_junta: 'presidente' } });
  T = {
    adminA: await login(base, 'admin.a@test.pe'),
    adminB: await login(base, 'admin.b@test.pe'),
    superT: await login(base, 'super@test.pe'),
    junta: await login(base, 'prop1@test.pe'),
    vecino: await login(base, 'inq1@test.pe'),
  };
  enviados = [];
  respuestaCorreo = 200;
  comercialCorreo.deps = depsFalsas;
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { url_publica: 'https://house.ejemplo.test', invitaciones_por_dia: 90 } });
  invalidarComercial();
});
afterEach(() => { comercialCorreo.deps = depsOriginal; comercialDeps.ahora = relojOriginal; });

describe('lector del Excel', () => {
  it('reconoce los encabezados sin mayúsculas ni tildes y en cualquier orden', () => {
    assert.equal(normalizarEncabezado('  Teléfono   del Propietario '), 'telefono del propietario');
    assert.deepEqual(clasificarEncabezado('block'), { tipo: 'block' });
    assert.deepEqual(clasificarEncabezado('torre'), { tipo: 'block' });
    assert.deepEqual(clasificarEncabezado('dpto'), { tipo: 'dpto' });
    assert.deepEqual(clasificarEncabezado('departamento'), { tipo: 'dpto' });
    assert.deepEqual(clasificarEncabezado('correo propietario'), { tipo: 'persona', persona: 'propietario', dato: 'correo' });
    assert.deepEqual(clasificarEncabezado('e mail del inquilino'), { tipo: 'persona', persona: 'inquilino', dato: 'correo' });
    assert.deepEqual(clasificarEncabezado('whatsapp inquilino'), { tipo: 'persona', persona: 'inquilino', dato: 'celular' });
    assert.deepEqual(clasificarEncabezado('apellidos y nombres'), { tipo: 'persona', persona: 'propietario', dato: 'nombre' });
    assert.deepEqual(clasificarEncabezado('inquilino'), { tipo: 'persona', persona: 'inquilino', dato: 'nombre' });
    assert.equal(clasificarEncabezado('total'), null);
  });

  it('encuentra la fila de encabezados debajo de un título y lee un Excel parecido (columnas en otro orden, sin Block)', () => {
    const buf = aXlsx([
      ['CONTACTOS DEL CONDOMINIO'],
      [],
      ['CELULAR', 'Correo electrónico', 'Depto.', 'Apellidos y Nombres'],
      ['987 654 321', ' ANA@Vecino.PE ', 101, 'Ana Pérez'],
      [null, null, null, null],
      ['', 'rosa@vecino.pe', '102', 'Rosa'],
    ]);
    const l = leerContactos(buf);
    assert.equal(l.filas.length, 2);
    assert.deepEqual(l.filas.map((f) => f.fila), [4, 6], 'el número de fila es el del Excel');
    assert.equal(l.filas[0]!.propietario.correo, 'ana@vecino.pe');
    assert.equal(l.filas[0]!.propietario.celular, '+51 987 654 321');
    assert.equal(l.filas[0]!.dpto, '101');
    assert.equal(l.filas[1]!.propietario.celular, '');
    assert.deepEqual(buscarCabecera([['x']]), null);
  });

  it('valida correo y celular; un correo de relleno (.invalid) cuenta como vacío', () => {
    assert.deepEqual(leerPersona('Ana', 'no-es-correo', '').errores, ['El correo no es válido']);
    assert.match(leerPersona('Ana', '', 'abc').errores[0]!, /celular no es válido/);
    const rel = leerPersona('Ana', 'b1-101@sin-correo.invalid', '');
    assert.equal(rel.correo, '');
    assert.deepEqual(rel.errores, []);
    assert.equal(leerPersona('Ana', '', 56961234567).celular.startsWith('+56'), true, 'celular de otro país con su código');
  });

  it('un archivo que no es Excel o sin encabezados → 422 en español', async () => {
    const c = await nuevoCondo();
    const r1 = await subir(T.adminA, Buffer.from('esto no es un excel'), c.id);
    assert.equal(r1.status, 422, r1.texto);
    const r2 = await subir(T.adminA, aXlsx([['hola', 'mundo'], [1, 2]]), c.id);
    assert.equal(r2.status, 422);
    assert.match(r2.body.error, /encabezados/);
    const r3 = await subir(T.adminA, null, c.id);
    assert.equal(r3.status, 422);
  });

  it('nombres: la misma persona comparte algún nombre o apellido (sin tildes, con un error de tipeo)', () => {
    assert.equal(mismaPersona('Ana Pérez Gómez', 'ANA PEREZ'), true);
    assert.equal(mismaPersona('Carlos Soto Rojas', 'Soto Rojas, Carlos'), true);
    assert.equal(mismaPersona('Rodriguez Martinez', 'Rodrigues Martinez'), true, 'una letra mal');
    assert.equal(mismaPersona('Ana Pérez', 'Luis Ramos'), false);
    assert.equal(mismaPersona('Ana Pérez', ''), true, 'sin nombre que comparar no se puede decir que sean distintas');
  });
});

describe('plantilla', () => {
  it('una fila por unidad ACTIVA, ordenada por block y dpto, con lo que Torre tiene; los correos .invalid salen vacíos', async () => {
    const c = await nuevoCondo();
    await prisma.usuario.update({ where: { id: c.propietario['1-101']! }, data: { email: 'ana.real@vecino.pe', telefono: '+51 987 654 321' } });
    const inq = await prisma.usuario.create({ data: { nombre: 'Pedro Quispe', email: `inq-c${c.id}@sin-correo.invalid`, rol: 'inquilino', telefono: '+51 912 345 678' } });
    await prisma.unidad.update({ where: { id: c.unidad['1-101']! }, data: { inquilino_id: inq.id } });

    const r = await plantilla(T.adminA, c.id);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /spreadsheetml/);
    assert.match(r.headers.get('content-disposition') ?? '', /contactos-condominio-\d+\.xlsx/);
    const libro = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
    assert.deepEqual(libro.SheetNames, ['Contactos', 'Instrucciones']);
    const filas = XLSX.utils.sheet_to_json<string[]>(libro.Sheets.Contactos!, { header: 1, defval: '' });
    assert.deepEqual(filas[0], [...ENCABEZADOS]);
    assert.equal(filas.length, 1 + 6, 'las 6 activas; la inactiva no sale');
    assert.deepEqual(filas.slice(1).map((f) => `${f[0]}/${f[1]}`), ['Block 1/101', 'Block 1/102', 'Block 1/103', 'Block 1/104', 'Block 2/101', 'Block 2/102']);
    assert.deepEqual(filas[1], ['Block 1', '101', 'Ana Pérez Gómez', 'ana.real@vecino.pe', '+51 987 654 321', 'Pedro Quispe', '', '+51 912 345 678'], 'datos reales sí; el correo del inquilino es de relleno: vacío');
    assert.deepEqual(filas[2], ['Block 1', '102', 'Luis Ramos Díaz', '', '', '', '', '']);
    const todo = JSON.stringify(XLSX.utils.sheet_to_json(libro.Sheets.Contactos!, { header: 1 }));
    assert.equal(/\.invalid/.test(todo), false, 'ningún correo de relleno en la plantilla');
    const ayuda = XLSX.utils.sheet_to_json<string[]>(libro.Sheets.Instrucciones!, { header: 1 }).flat().join(' ');
    assert.match(ayuda, /Subir contactos/);
  });

  it('descargar la plantilla queda en la auditoría, sólo con cantidades', async () => {
    const c = await nuevoCondo();
    await plantilla(T.adminA, c.id);
    const a = await prisma.auditoria.findFirst({ where: { accion: 'descargar_plantilla_contactos', entidad_id: c.id } });
    assert.ok(a);
    assert.deepEqual(a.detalle, { unidades: 6 });
  });

  it('el orden: por número de block, luego departamento numérico', () => {
    const u = (codigo: string, bloque: string | null) => ({ codigo, estructura: bloque ? { nombre: bloque } : null });
    const r = ordenarUnidades([u('B02-101', 'Block 2'), u('B01-1001', 'Block 1'), u('B01-201', 'Block 1'), u('B01-101', 'Block 1'), u('X-1', null)]);
    assert.deepEqual(r.map((x) => x.codigo), ['B01-101', 'B01-201', 'B01-1001', 'B02-101', 'X-1']);
  });

  it('sin permisos: junta y vecino → 403; otra empresa → 404; sin sesión → 401; superadmin sí', async () => {
    const c = await nuevoCondo();
    assert.equal((await plantilla(T.junta, c.id)).status, 403);
    assert.equal((await plantilla(T.vecino, c.id)).status, 403);
    assert.equal((await plantilla(T.adminB, c.id)).status, 404);
    assert.equal((await plantilla(null, c.id)).status, 401);
    assert.equal((await plantilla(T.superT, c.id)).status, 200);
    assert.equal((await plantilla(T.adminA, 'abc')).status, 422);
    assert.equal((await plantilla(T.adminA, 999999)).status, 404);
  });
});

describe('vista previa (sin confirmar)', () => {
  it('409 REVISAR_CONTACTOS con los números exactos y CERO cambios en la base', async () => {
    const c = await nuevoCondo();
    const antes = await foto();
    const r = await subir(T.adminA, archivoGrande(), c.id);
    assert.equal(r.status, 409, r.texto);
    assert.equal(r.body.code, 'REVISAR_CONTACTOS');
    assert.match(r.body.error, /Todavía no se guardó nada/);
    assert.deepEqual(r.body.resumen, {
      filas: 6, filas_con_error: 1, filas_con_aviso: 0,
      correos_nuevos: 4, correos_cambiados: 0,
      celulares_nuevos: 4, celulares_cambiados: 0,
      propietarios_nuevos: 0, inquilinos_nuevos: 1,
      unidades_unidas: 1, cambian_quien_paga: 1,
      invitables: 4,
    });
    assert.equal(r.body.problemas_total, 1);
    assert.deepEqual(r.body.problemas[0], { fila: 7, unidad: 'B02-101', persona: 'propietario', nivel: 'error', mensaje: 'Propietario: El celular no es válido (con 9 dígitos, o con el código de país: +51 987 654 321)' });
    assert.equal(await foto(), antes, 'la vista previa no cambió NADA (ni usuarios, ni unidades, ni cola, ni invitaciones)');
    assert.equal(await prisma.auditoria.count({ where: { accion: 'cargar_contactos' } }), 0);
    assert.equal(enviados.length, 0);
  });

  it('repetir la vista previa da lo mismo; con confirmar=false también es vista previa', async () => {
    const c = await nuevoCondo();
    const a = await subir(T.adminA, archivoGrande(), c.id);
    const b = await subir(T.adminA, archivoGrande(), c.id, { confirmar: 'false' });
    assert.equal(b.status, 409);
    assert.deepEqual(a.body.resumen, b.body.resumen);
  });

  it('problemas por fila: correo inválido, dpto o block inexistente, unidad inactiva, dpto repetido, sin nombre', async () => {
    const c = await nuevoCondo();
    const r = await subir(T.adminA, excel(
      fila('Block 1', 101, 'Ana', 'ana-sin-arroba'),
      fila('Block 1', 999, 'Nadie', 'nadie@vecino.pe'),
      fila('Block 9', 101, 'Otro', 'otro@vecino.pe'),
      fila('Block 1', 105, 'Dueño Inactivo', 'inactivo@vecino.pe'),
      fila('Block 1', 102, 'Luis Ramos', 'luis@vecino.pe'),
      fila('Block 1', 102, 'Luis Ramos', 'luis2@vecino.pe'),
      fila('', 103, 'María', 'maria@vecino.pe'),
    ), c.id);
    assert.equal(r.status, 409, r.texto);
    const por = new Map<number, string>(r.body.problemas.map((p: { fila: number; mensaje: string }) => [p.fila, p.mensaje]));
    assert.match(por.get(2)!, /correo no es válido/);
    assert.match(por.get(3)!, /«999» no existe/);
    assert.match(por.get(4)!, /no tiene el block «Block 9»/);
    assert.match(por.get(5)!, /no está activo/);
    assert.match(por.get(7)!, /repetido en el Excel \(también en la fila 6\)/);
    assert.match(por.get(8)!, /Falta el block/);
    assert.equal(por.has(6), false, 'la primera fila de 102 está bien');
    assert.equal(r.body.resumen.filas_con_error, 6);
    assert.equal(r.body.resumen.correos_nuevos, 1, 'sólo Luis');
  });

  it('un nombre que no se parece al registrado: aviso y no se carga ese contacto (el nombre nunca cambia)', async () => {
    const c = await nuevoCondo();
    const r = await subir(T.adminA, excel(fila('Block 1', 101, 'Jorge Quispe', 'jorge@vecino.pe', '987654321')), c.id);
    assert.equal(r.status, 409);
    assert.equal(r.body.resumen.filas_con_aviso, 1);
    assert.equal(r.body.resumen.correos_nuevos, 0);
    assert.equal(r.body.resumen.celulares_nuevos, 0);
    assert.match(r.body.problemas[0].mensaje, /no se parece al registrado/);
    assert.equal(r.body.problemas[0].nivel, 'aviso');
  });

  it('la plantilla tal como se descargó, sin llenar, se vuelve a subir sin cambios ni errores', async () => {
    const c = await nuevoCondo();
    const buf = Buffer.from(await (await plantilla(T.adminA, c.id)).arrayBuffer());
    const r = await subir(T.adminA, buf, c.id);
    assert.equal(r.status, 409);
    assert.equal(r.body.resumen.filas, 6);
    assert.equal(r.body.resumen.filas_con_error, 0);
    assert.equal(r.body.resumen.filas_con_aviso, 0);
    for (const k of ['correos_nuevos', 'correos_cambiados', 'celulares_nuevos', 'celulares_cambiados', 'propietarios_nuevos', 'inquilinos_nuevos', 'unidades_unidas', 'cambian_quien_paga', 'invitables']) assert.equal(r.body.resumen[k], 0, k);
    assert.match(r.body.error, /no hay cambios que guardar/);
  });
});

describe('guardar (confirmar=true)', () => {
  it('actualiza a los propietarios de relleno, crea inquilinos y cambia quién paga', async () => {
    const c = await nuevoCondo();
    const antes = await prisma.usuario.count();
    const r = await guardar(T.adminA, archivoGrande(), c.id);
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.guardado, true);
    assert.equal(r.body.creados, 1);
    assert.equal(r.body.invitaciones_encoladas, 0);
    assert.equal(await prisma.usuario.count(), antes + 1, 'sólo Pedro es nuevo');

    const ana = await prisma.usuario.findUniqueOrThrow({ where: { id: c.propietario['1-101']! } });
    assert.equal(ana.email, 'ana@vecino.pe');
    assert.equal(ana.telefono, '+51 987 654 321');
    assert.equal(ana.nombre, 'Ana Pérez Gómez', 'el nombre no se toca');
    assert.equal(ana.aviso_email, true);
    assert.equal(ana.aviso_whatsapp, true, 'hay celular → WhatsApp encendido');
    const luis = await prisma.usuario.findUniqueOrThrow({ where: { id: c.propietario['1-102']! } });
    assert.equal(luis.email, 'luis@vecino.pe', 'el correo se guarda en minúsculas');
    assert.equal(luis.telefono, null);
    assert.equal(luis.aviso_whatsapp, false, 'sin celular no se enciende WhatsApp');
    const maria = await prisma.usuario.findUniqueOrThrow({ where: { id: c.propietario['1-103']! } });
    assert.match(maria.email, /\.invalid$/, 'sin correo en el Excel conserva el de relleno');
    assert.equal(maria.telefono, '+51 961 234 567');
    assert.equal(maria.aviso_whatsapp, true);

    // El inquilino nuevo: rol inquilino, asignado a la unidad, y desde ahora es quien paga.
    const u101 = await prisma.unidad.findUniqueOrThrow({ where: { id: c.unidad['1-101']! } });
    assert.ok(u101.inquilino_id);
    const pedro = await prisma.usuario.findUniqueOrThrow({ where: { id: u101.inquilino_id! } });
    assert.deepEqual([pedro.nombre, pedro.rol, pedro.email, pedro.telefono, pedro.empresa_id, pedro.complejo_id], ['Pedro Quispe', 'inquilino', 'pedro@vecino.pe', '+51 912 345 678', null, c.id]);
    assert.equal(u101.propietario_id, ana.id, 'el propietario sigue siendo el mismo');
    assert.equal(quienPaga(u101), pedro.id, 'el aviso de cobro ahora va al inquilino');

    // La fila con error no se guardó.
    const rosa = await prisma.usuario.findUniqueOrThrow({ where: { id: c.propietario['2-101']! } });
    assert.match(rosa.email, /\.invalid$/);
    assert.equal(rosa.telefono, null);
    assert.equal(r.body.problemas_total, 1);
  });

  it('una misma persona (mismo correo) con varias unidades queda como UN usuario con todas; la de relleno queda sin unidades y conserva su historial', async () => {
    const c = await nuevoCondo();
    // La segunda ficha de relleno ya tiene un pago registrado a su nombre: no debe perderse.
    const concepto = await prisma.concepto.create({ data: { nombre: 'Mant', empresa_id: d.empresaA.id, tipo_monto: 'fijo' } });
    const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: c.id, mes: 9, anio: 2026, fecha_emision: new Date(), fecha_vencimiento: new Date(), estado: 'emitido', descripcion: 'x' } });
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: concepto.id, monto: 100, orden: 1 } });
    const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: c.unidad['2-102']!, monto: 100, estado_pago: 'pagado' } });
    const pago = await prisma.pago.create({ data: { recibo_concepto_unidad_id: cargo.id, usuario_id: c.propietario['2-102']!, monto: 100, metodo_pago: 'efectivo' } });

    const r = await guardar(T.adminA, archivoGrande(), c.id);
    assert.equal(r.status, 201, r.texto);
    const con = await prisma.usuario.findMany({ where: { email: 'carlos@vecino.pe' } });
    assert.equal(con.length, 1, 'un solo usuario con ese correo');
    assert.equal(con[0]!.id, c.propietario['1-104'], 'se queda la ficha del primer departamento');
    const suyas = await prisma.unidad.findMany({ where: { propietario_id: con[0]!.id }, orderBy: { codigo: 'asc' } });
    assert.deepEqual(suyas.map((x) => x.codigo), ['B01-104', 'B02-102']);
    // La ficha de relleno quedó sin unidades pero sigue ahí, con su pago.
    const vieja = await prisma.usuario.findUnique({ where: { id: c.propietario['2-102']! } });
    assert.ok(vieja, 'no se borra a nadie');
    assert.match(vieja.email, /\.invalid$/);
    assert.equal((await prisma.pago.findUniqueOrThrow({ where: { id: pago.id } })).usuario_id, vieja.id, 'el historial de pagos no se mueve');
    assert.equal(await prisma.unidad.count({ where: { propietario_id: vieja.id } }), 0);
  });

  it('mismo correo para personas con nombres distintos → error en esa fila y no se guarda', async () => {
    const c = await nuevoCondo();
    const r = await guardar(T.adminA, excel(
      fila('Block 1', 101, 'Ana Pérez', 'compartido@vecino.pe'),
      fila('Block 1', 102, 'Luis Ramos', 'compartido@vecino.pe'),
    ), c.id);
    assert.equal(r.status, 201);
    assert.equal(r.body.problemas_total, 1);
    assert.match(r.body.problemas[0].mensaje, /mismo correo aparece para personas distintas/);
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { id: c.propietario['1-101']! } })).email, 'compartido@vecino.pe');
    assert.match((await prisma.usuario.findUniqueOrThrow({ where: { id: c.propietario['1-102']! } })).email, /\.invalid$/);
    assert.equal(await prisma.usuario.count({ where: { email: 'compartido@vecino.pe' } }), 1);
  });

  it('un propietario y un inquilino no pueden compartir correo', async () => {
    const c = await nuevoCondo();
    const r = await subir(T.adminA, excel(fila('Block 1', 101, 'Ana Pérez', 'mismo@vecino.pe', null, 'Ana Pérez', 'mismo@vecino.pe')), c.id);
    assert.equal(r.status, 409);
    assert.equal(r.body.resumen.filas_con_error, 1);
    assert.match(r.body.problemas[0].mensaje, /ya es de un propietario/);
  });

  it('un correo real ya cargado sólo cambia con actualizar=true (y lo mismo el celular)', async () => {
    const c = await nuevoCondo();
    await prisma.usuario.update({ where: { id: c.propietario['1-102']! }, data: { email: 'luis.viejo@vecino.pe', telefono: '+51 900 000 001' } });
    const archivo = excel(fila('Block 1', 102, 'Luis Ramos', 'luis.nuevo@vecino.pe', '999888777'));

    const sin = await guardar(T.adminA, archivo, c.id);
    assert.equal(sin.status, 201, sin.texto);
    assert.equal(sin.body.problemas_total, 2, 'un aviso por el correo y otro por el celular');
    assert.ok(sin.body.problemas.every((p: { nivel: string }) => p.nivel === 'aviso'));
    let luis = await prisma.usuario.findUniqueOrThrow({ where: { id: c.propietario['1-102']! } });
    assert.deepEqual([luis.email, luis.telefono], ['luis.viejo@vecino.pe', '+51 900 000 001'], 'sin actualizar no cambia nada');

    const prev = await subir(T.adminA, archivo, c.id, { actualizar: 'true' });
    assert.equal(prev.body.resumen.correos_cambiados, 1);
    assert.equal(prev.body.resumen.celulares_cambiados, 1);
    assert.equal(prev.body.resumen.correos_nuevos, 0);
    const con = await guardar(T.adminA, archivo, c.id, { actualizar: 'true' });
    assert.equal(con.status, 201, con.texto);
    luis = await prisma.usuario.findUniqueOrThrow({ where: { id: c.propietario['1-102']! } });
    assert.deepEqual([luis.email, luis.telefono], ['luis.nuevo@vecino.pe', '+51 999 888 777']);
  });

  it('un propietario sin dueño registrado y un inquilino sin correo se crean con su nombre (correo de relleno)', async () => {
    const c = await nuevoCondo();
    await prisma.unidad.update({ where: { id: c.unidad['1-103']! }, data: { propietario_id: null } });
    const r = await guardar(T.adminA, excel(
      fila('Block 1', 103, 'Nuevo Dueño', 'dueno@vecino.pe', null, 'Inquilina Sin Correo', null, '977666555'),
    ), c.id);
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.creados, 2);
    const u = await prisma.unidad.findUniqueOrThrow({ where: { id: c.unidad['1-103']! }, include: { propietario: true, inquilino: true } });
    assert.deepEqual([u.propietario?.nombre, u.propietario?.email, u.propietario?.rol], ['Nuevo Dueño', 'dueno@vecino.pe', 'propietario']);
    assert.deepEqual([u.inquilino?.nombre, u.inquilino?.rol, u.inquilino?.telefono, u.inquilino?.aviso_email, u.inquilino?.aviso_whatsapp], ['Inquilina Sin Correo', 'inquilino', '+51 977 666 555', false, true]);
    assert.match(u.inquilino!.email, /^u\d+-inq@sin-correo\.invalid$/);
  });

  it('el aviso de cobro va al inquilino y deja de ir al propietario', async () => {
    const c = await nuevoCondo();
    await guardar(T.adminA, excel(fila('Block 1', 104, 'Carlos Soto', 'carlos@vecino.pe', null, 'Inés Vega', 'ines@vecino.pe')), c.id);
    const u = await prisma.unidad.findUniqueOrThrow({ where: { id: c.unidad['1-104']! } });
    const ines = await prisma.usuario.findUniqueOrThrow({ where: { email: 'ines@vecino.pe' } });
    assert.equal(quienPaga(u), ines.id);
    assert.notEqual(quienPaga(u), u.propietario_id);
  });

  it('la auditoría guarda sólo cantidades: nunca nombres, correos ni celulares', async () => {
    const c = await nuevoCondo();
    await guardar(T.adminA, archivoGrande(), c.id);
    const a = await esperar(() => prisma.auditoria.findFirst({ where: { accion: 'cargar_contactos', entidad_id: c.id } })); // la auditoría se escribe tras responder
    const texto = JSON.stringify(a.detalle);
    for (const dato of ['ana@vecino.pe', 'carlos', 'Pedro', 'Quispe', '987654321', '912345678', '+51', '@']) assert.equal(texto.includes(dato), false, `la auditoría no debe llevar «${dato}»`);
    assert.equal((a.detalle as { correos_nuevos: number }).correos_nuevos, 4);
    assert.equal((a.detalle as { creados: number }).creados, 1);
  });

  it('subir dos veces el mismo archivo no duplica nada', async () => {
    const c = await nuevoCondo();
    await guardar(T.adminA, archivoGrande(), c.id);
    const despues = await foto();
    const otra = await subir(T.adminA, archivoGrande(), c.id);
    assert.equal(otra.status, 409);
    assert.equal(otra.body.resumen.correos_nuevos, 0);
    assert.equal(otra.body.resumen.inquilinos_nuevos, 0);
    assert.equal(otra.body.resumen.unidades_unidas, 0);
    assert.equal(await foto(), despues);
    const dos = await guardar(T.adminA, archivoGrande(), c.id);
    assert.equal(dos.status, 201);
    assert.equal(dos.body.creados, 0);
    assert.equal(await prisma.usuario.count({ where: { email: 'pedro@vecino.pe' } }), 1);
  });
});

describe('separación entre empresas y cuentas que no se vinculan', () => {
  it('un correo de otra empresa, de personal, de administración o de superadmin → error y NADA guardado', async () => {
    const c = await nuevoCondo();
    const ajenos = ['propb@test.pe', 'mtto.a@test.pe', 'admin.a@test.pe', 'admin.b@test.pe', 'super@test.pe', 'seg.a@test.pe'];
    // Las 4 primeras filas son del Block 1; las 2 últimas del Block 2.
    const archivo = excel(
      fila('Block 1', 101, 'Ana Pérez', ajenos[0]!), fila('Block 1', 102, 'Luis Ramos', ajenos[1]!), fila('Block 1', 103, 'María Torres', ajenos[2]!), fila('Block 1', 104, 'Carlos Soto', ajenos[3]!),
      fila('Block 2', 101, 'Rosa Medina', ajenos[4]!), fila('Block 2', 102, 'Carlos Soto', ajenos[5]!),
    );
    const antes = await foto();
    const prev = await subir(T.adminA, archivo, c.id);
    assert.equal(prev.status, 409);
    assert.equal(prev.body.resumen.filas_con_error, 6);
    assert.equal(prev.body.resumen.correos_nuevos, 0);
    assert.ok(prev.body.problemas.every((p: { mensaje: string }) => /no se puede vincular a este condominio/.test(p.mensaje)));
    const r = await guardar(T.adminA, archivo, c.id);
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.creados, 0);
    assert.equal(r.body.actualizados, 0);
    assert.equal(r.body.unidades_asignadas, 0);
    // Nada cambió: ninguna unidad quedó vinculada a una cuenta ajena, ninguna cuenta ajena se tocó.
    assert.equal((await foto()).replace(/"cola":\d+,"tokens":\d+/, ''), antes.replace(/"cola":\d+,"tokens":\d+/, ''));
    for (const [clave, id] of Object.entries(c.propietario)) assert.match((await prisma.usuario.findUniqueOrThrow({ where: { id } })).email, /\.invalid$/, clave);
  });

  it('un inquilino con el correo de una cuenta ajena tampoco se vincula', async () => {
    const c = await nuevoCondo();
    const r = await guardar(T.adminA, excel(fila('Block 1', 101, null, null, null, 'Pedro Quispe', 'propb@test.pe')), c.id);
    assert.equal(r.status, 201);
    assert.equal(r.body.problemas_total, 1);
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: c.unidad['1-101']! } })).inquilino_id, null);
    assert.equal((await prisma.usuario.findUniqueOrThrow({ where: { email: 'propb@test.pe' } })).empresa_id, d.empresaB.id);
  });

  it('un residente de la MISMA empresa con nombre parecido sí se junta; con nombre distinto no', async () => {
    const c = await nuevoCondo();
    // Residente de la empresa A en otro condominio de la empresa A (A-102 de Complejo A).
    const sinMatch = await guardar(T.adminA, excel(fila('Block 1', 101, 'Ana Pérez', 'prop2@test.pe')), c.id);
    assert.equal(sinMatch.body.problemas_total, 1, 'Ana Pérez ≠ Propietario 2');
    assert.match(sinMatch.body.problemas[0].mensaje, /personas distintas/);
    await prisma.usuario.update({ where: { id: c.propietario['1-101']! }, data: { nombre: 'Propietario Dos' } });
    const ok = await guardar(T.adminA, excel(fila('Block 1', 101, 'Propietario Dos', 'prop2@test.pe')), c.id);
    assert.equal(ok.body.problemas_total, 0, ok.texto);
    assert.equal((await prisma.unidad.findUniqueOrThrow({ where: { id: c.unidad['1-101']! } })).propietario_id, d.propietario2.id);
  });

  it('junta y vecino → 403; otra empresa → 404; sin sesión → 401; el condominio de otra empresa no se puede cargar ni revisar', async () => {
    const c = await nuevoCondo();
    const archivo = archivoGrande();
    const antes = await foto();
    assert.equal((await subir(T.junta, archivo, c.id)).status, 403);
    assert.equal((await guardar(T.junta, archivo, c.id)).status, 403);
    assert.equal((await subir(T.vecino, archivo, c.id)).status, 403);
    assert.equal((await subir(T.adminB, archivo, c.id)).status, 404);
    assert.equal((await guardar(T.adminB, archivo, c.id)).status, 404);
    assert.equal((await subir(null, archivo, c.id)).status, 401);
    assert.equal((await subir(T.adminA, archivo, 'abc')).status, 422);
    assert.equal((await subir(T.adminA, archivo, null)).status, 422);
    assert.equal((await subir(T.adminA, archivo, c.id, { confirmar: 'quizas' })).status, 422);
    assert.equal(await foto(), antes);
    assert.equal((await subir(T.superT, archivo, c.id)).status, 409, 'el superadmin sí puede revisar');
  });

  it('el administrador de otra empresa tampoco ve el estado de las invitaciones ni puede encolarlas', async () => {
    const c = await nuevoCondo();
    assert.equal((await llamar(base, 'GET', `/api/contactos/invitaciones?complejo_id=${c.id}`, T.adminB)).status, 404);
    assert.equal((await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminB, { complejo_id: c.id })).status, 404);
    assert.equal((await llamar(base, 'GET', `/api/contactos/invitaciones?complejo_id=${c.id}`, T.junta)).status, 403);
    assert.equal((await llamar(base, 'POST', '/api/contactos/invitaciones', T.junta, { complejo_id: c.id })).status, 403);
    assert.equal(await prisma.invitacionEnCola.count(), 0);
  });

  it('un condominio en solo lectura no recibe contactos (409 SOLO_LECTURA), pero sí se puede revisar', async () => {
    const c = await nuevoCondo();
    await prisma.suscripcionCondominio.deleteMany({ where: { complejo_id: c.id } });
    await prisma.suscripcionCondominio.create({ data: { complejo_id: c.id, plan_clave: 'gratis', modulos: [], estado: 'gratis', gratis_hasta: new Date(hoyLima().getTime() - 2 * 86_400_000) } });
    invalidarComercial();
    const prev = await subir(T.adminA, archivoGrande(), c.id);
    assert.equal(prev.status, 409);
    assert.equal(prev.body.code, 'REVISAR_CONTACTOS');
    const r = await guardar(T.adminA, archivoGrande(), c.id);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'SOLO_LECTURA');
    assert.equal((await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id })).body.code, 'SOLO_LECTURA');
  });
});

describe('invitaciones en tandas', () => {
  /** Un condominio con 4 vecinos con correo real y sin contraseña. */
  async function condoConCorreos() {
    const c = await nuevoCondo();
    const r = await guardar(T.adminA, excel(
      fila('Block 1', 101, 'Ana Pérez', 'ana@vecino.pe'),
      fila('Block 1', 102, 'Luis Ramos', 'luis@vecino.pe'),
      fila('Block 1', 103, 'María Torres', 'maria@vecino.pe'),
      fila('Block 1', 104, 'Carlos Soto', 'carlos@vecino.pe'),
    ), c.id);
    assert.equal(r.status, 201, r.texto);
    return c;
  }
  const estado = async (id: number) => (await llamar(base, 'GET', `/api/contactos/invitaciones?complejo_id=${id}`, T.adminA)).body;

  it('guardar con «invitar» deja en cola (nadie recibe nada en el momento); el estado dice cuántas y en cuántos días', async () => {
    const c = await nuevoCondo();
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { invitaciones_por_dia: 2 } });
    fijarReloj('2026-11-04T15:00:00Z');
    const r = await guardar(T.adminA, excel(
      fila('Block 1', 101, 'Ana Pérez', 'ana@vecino.pe'), fila('Block 1', 102, 'Luis Ramos', 'luis@vecino.pe'), fila('Block 1', 103, 'María Torres', 'maria@vecino.pe'), fila('Block 1', 104, 'Carlos Soto', 'carlos@vecino.pe'), fila('Block 2', 101, 'Rosa Medina', null, '987654321'),
    ), c.id, { invitar: 'true' });
    assert.equal(r.status, 201, r.texto);
    assert.equal(r.body.invitaciones_encoladas, 4, 'Rosa no tiene correo');
    assert.equal(enviados.length, 0, 'guardar no manda ninguna invitación');
    assert.equal(await prisma.tokenInvitacion.count(), 0);
    const e = await estado(c.id);
    assert.deepEqual(e, { enviadas: 0, en_cola: 4, por_encolar: 0, por_dia: 2, enviadas_hoy: 0, dias: 2 });
  });

  it('la tanda manda como máximo el tope por día de Lima, en orden, sin repetir', async () => {
    const c = await condoConCorreos();
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { invitaciones_por_dia: 2 } });
    const enc = await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id });
    assert.equal(enc.status, 201, enc.texto);
    assert.equal(enc.body.encoladas, 4);

    fijarReloj('2026-11-04T15:00:00Z'); // 10:00 en Lima
    const t1 = await procesarInvitaciones();
    assert.deepEqual([t1.enviadas, t1.en_cola, t1.cortada], [2, 2, false]);
    assert.deepEqual(enviados.map((x) => x.para), ['ana@vecino.pe', 'luis@vecino.pe'], 'en el orden en que se pidieron');
    for (const m of enviados) assert.match(m.asunto, /Te invitaron a Torre/);

    fijarReloj('2026-11-04T23:30:00Z'); // 18:30 del mismo día en Lima
    const t2 = await procesarInvitaciones();
    assert.equal(t2.enviadas, 0, 'el tope de hoy ya está cubierto');
    assert.equal(enviados.length, 2);
    assert.deepEqual(await estado(c.id), { enviadas: 2, en_cola: 2, por_encolar: 0, por_dia: 2, enviadas_hoy: 2, dias: 1 });

    fijarReloj('2026-11-05T15:00:00Z'); // día siguiente
    const t3 = await procesarInvitaciones();
    assert.deepEqual([t3.enviadas, t3.en_cola], [2, 0]);
    assert.deepEqual(enviados.map((x) => x.para), ['ana@vecino.pe', 'luis@vecino.pe', 'maria@vecino.pe', 'carlos@vecino.pe']);
    const t4 = await procesarInvitaciones();
    assert.equal(t4.enviadas, 0);
    assert.equal(enviados.length, 4, 'nadie recibe dos invitaciones');
    assert.equal(new Set(enviados.map((x) => x.para)).size, 4);
    assert.equal(await prisma.tokenInvitacion.count(), 4);
    assert.deepEqual(await estado(c.id), { enviadas: 4, en_cola: 0, por_encolar: 0, por_dia: 2, enviadas_hoy: 2, dias: 0 });
  });

  it('el día es el de Lima, no el de UTC: a medianoche de Lima el cupo se renueva aunque en UTC sea el mismo día', async () => {
    const c = await condoConCorreos();
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { invitaciones_por_dia: 2 } });
    await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id });
    fijarReloj('2026-11-05T04:50:00Z'); // 23:50 del 4-nov en Lima
    assert.equal((await procesarInvitaciones()).enviadas, 2);
    fijarReloj('2026-11-05T04:58:00Z'); // 23:58 en Lima: mismo día de Lima
    assert.equal((await procesarInvitaciones()).enviadas, 0);
    fijarReloj('2026-11-05T05:02:00Z'); // 00:02 del 5-nov en Lima (en UTC sigue siendo 5-nov, el mismo día que arriba)
    assert.equal((await procesarInvitaciones()).enviadas, 2, 'día nuevo en Lima');
  });

  it('encolar de nuevo no duplica; quien ya tiene una invitación vigente no se encola ni se manda otra', async () => {
    const c = await condoConCorreos();
    const uno = await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id });
    assert.equal(uno.body.encoladas, 4);
    const dos = await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id });
    assert.equal(dos.body.encoladas, 0, 'ya están en cola');
    assert.equal(await prisma.invitacionEnCola.count(), 4);
    fijarReloj('2026-11-04T15:00:00Z');
    assert.equal((await procesarInvitaciones()).enviadas, 4);
    assert.equal((await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id })).body.encoladas, 0, 'ya tienen invitación vigente');
    assert.equal((await procesarInvitaciones()).enviadas, 0);
    assert.equal(enviados.length, 4);
    // Pasados 7 días la invitación venció: se puede volver a encolar a quien aún no entró.
    fijarReloj('2026-11-12T15:00:00Z');
    assert.equal((await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id })).body.encoladas, 4);
  });

  it('nunca se invita a un correo de relleno (.invalid) ni a quien ya tiene contraseña, ni aunque estén en la cola', async () => {
    const c = await nuevoCondo(); // 6 propietarios de relleno
    const conClave = await prisma.usuario.create({ data: { nombre: 'Ya Entró', email: 'yaentro@vecino.pe', rol: 'inquilino', password_hash: await bcrypt.hash('x'.repeat(10), 4) } });
    await prisma.unidad.update({ where: { id: c.unidad['1-101']! }, data: { inquilino_id: conClave.id } });
    const sinClave = await prisma.usuario.create({ data: { nombre: 'Por Entrar', email: 'porentrar@vecino.pe', rol: 'inquilino' } });
    await prisma.unidad.update({ where: { id: c.unidad['1-102']! }, data: { inquilino_id: sinClave.id } });

    const r = await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id });
    assert.equal(r.body.encoladas, 1, 'sólo el que tiene correo real y no tiene contraseña');
    assert.equal(r.body.por_encolar, 0);

    // Aunque alguien los meta a la cola a mano, la tanda los descarta sin mandar nada.
    const malos = [conClave.id, c.propietario['1-103']!];
    await prisma.invitacionEnCola.createMany({ data: malos.map((usuario_id) => ({ usuario_id, complejo_id: c.id })) });
    fijarReloj('2026-11-04T15:00:00Z');
    const t = await procesarInvitaciones();
    assert.equal(t.enviadas, 1);
    assert.equal(t.descartadas, 2);
    assert.deepEqual(enviados.map((x) => x.para), ['porentrar@vecino.pe']);
    const filas = await prisma.invitacionEnCola.findMany({ where: { usuario_id: { in: malos } }, orderBy: { usuario_id: 'asc' } });
    assert.deepEqual(filas.map((f) => f.motivo).sort(), ['sin_correo', 'ya_tiene_acceso']);
    assert.ok(filas.every((f) => f.descartada_at && !f.enviada_at));
  });

  it('un block: sólo se encolan los vecinos de ese block', async () => {
    const c = await nuevoCondo();
    await guardar(T.adminA, excel(fila('Block 1', 101, 'Ana Pérez', 'ana@vecino.pe'), fila('Block 2', 101, 'Rosa Medina', 'rosa@vecino.pe')), c.id);
    const r = await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id, estructura_id: c.b2 });
    assert.equal(r.body.encoladas, 1);
    const fila2 = await prisma.invitacionEnCola.findFirstOrThrow({ include: { usuario: true } });
    assert.equal(fila2.usuario.email, 'rosa@vecino.pe');
    const otroCondo = await nuevoCondo();
    assert.equal((await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id, estructura_id: otroCondo.b1 })).status, 404, 'un block de otro condominio no vale');
  });

  it('un fallo del correo corta la tanda sin gastar el cupo y se reintenta en el siguiente ciclo', async () => {
    const c = await condoConCorreos();
    await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id });
    fijarReloj('2026-11-04T15:00:00Z');
    respuestaCorreo = 500;
    const caida = await procesarInvitaciones();
    assert.deepEqual([caida.enviadas, caida.cortada, caida.en_cola], [0, true, 4]);
    assert.equal(await prisma.tokenInvitacion.count(), 0, 'no queda ningún enlace de una invitación que no salió');
    respuestaCorreo = 200;
    const ok = await procesarInvitaciones();
    assert.deepEqual([ok.enviadas, ok.en_cola], [4, 0]);
  });

  it('una dirección que el proveedor rechaza se descarta a la tercera, sin frenar a las demás', async () => {
    const c = await condoConCorreos();
    await llamar(base, 'POST', '/api/contactos/invitaciones', T.adminA, { complejo_id: c.id });
    fijarReloj('2026-11-04T15:00:00Z');
    const original = comercialCorreo.deps;
    comercialCorreo.deps = () => ({ ...depsFalsas(), fetch: (async (_u: string | URL | Request, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      if (b.to[0] === 'luis@vecino.pe') return new Response('{}', { status: 422 });
      enviados.push({ para: b.to[0], asunto: b.subject, texto: b.text });
      return new Response('{}', { status: 200 });
    }) as typeof fetch });
    try {
      const t1 = await procesarInvitaciones();
      assert.equal(t1.enviadas, 3, 'las otras tres salen');
      assert.equal(t1.en_cola, 1);
      fijarReloj('2026-11-05T15:00:00Z');
      await procesarInvitaciones();
      fijarReloj('2026-11-06T15:00:00Z');
      const t3 = await procesarInvitaciones();
      assert.equal(t3.descartadas, 1);
      assert.equal(t3.en_cola, 0);
      const luis = await prisma.invitacionEnCola.findFirstOrThrow({ where: { motivo: 'fallo' } });
      assert.equal(luis.intentos, 2, 'las dos primeras sólo contaron el intento; la tercera la descartó');
    } finally { comercialCorreo.deps = original; }
  });

  it('diasParaVaciar: el cupo de hoy cuenta y los días siguientes traen el tope completo', () => {
    assert.equal(diasParaVaciar(0, 90, 90), 0);
    assert.equal(diasParaVaciar(30, 90, 90), 1);
    assert.equal(diasParaVaciar(448, 90, 90), 5);
    assert.equal(diasParaVaciar(100, 0, 90), 2, 'hoy ya no sale ninguna: mañana 90 y pasado 10');
    assert.equal(diasParaVaciar(100, 50, 90), 2);
    assert.equal(diasParaVaciar(4, 2, 2), 2);
  });

  it('el resumen de la vista previa cuenta las invitaciones que se encolarían, sin los que ya tienen contraseña', async () => {
    const c = await nuevoCondo();
    await prisma.usuario.update({ where: { id: c.propietario['1-101']! }, data: { email: 'ana@vecino.pe', password_hash: await bcrypt.hash('x'.repeat(10), 4) } });
    const r = await subir(T.adminA, excel(fila('Block 1', 101, 'Ana Pérez', 'ana@vecino.pe'), fila('Block 1', 102, 'Luis Ramos', 'luis@vecino.pe')), c.id);
    assert.equal(r.body.resumen.invitables, 1, 'Ana ya tiene contraseña');
  });
});

describe('tope diario en Precios', () => {
  it('el superadmin lo edita (≥ 1); la administradora no; el valor de fábrica es 90', async () => {
    const cfg = await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } });
    assert.equal(cfg.invitaciones_por_dia, 90);
    const ok = await llamar(base, 'PUT', '/api/comercial/configuracion', T.superT, { invitaciones_por_dia: 50 });
    assert.equal(ok.status, 200, ok.texto);
    assert.equal((await prisma.configuracionComercial.findUniqueOrThrow({ where: { id: 1 } })).invitaciones_por_dia, 50);
    for (const malo of [0, -1, 1.5, 5001, 'x']) assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.superT, { invitaciones_por_dia: malo })).status, 422, String(malo));
    assert.equal((await llamar(base, 'PUT', '/api/comercial/configuracion', T.adminA, { invitaciones_por_dia: 10 })).status, 403);
    const g = await llamar(base, 'GET', '/api/comercial/catalogo', T.superT);
    assert.equal(g.status, 200, g.texto);
    assert.equal(g.body.configuracion.invitaciones_por_dia, 50, 'Precios lo recibe para mostrarlo');
  });
});
