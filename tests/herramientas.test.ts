import './helpers/env';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { CATALOGO, descriptorDe, ejecutarHerramienta, herramientasDe, esquemaParaGemini, depurar, acotar } from '../src/server/tools';
import type { AuthUser } from '../src/server/middleware/auth';
import { MAX_FILAS, pagina } from '../src/server/tools/base';
import { esperar, prisma } from './helpers/app';
import { hallazgosProhibidos, sembrarHerramientas, usuarioDe, type DatosHerramientas } from './helpers/herramientas';

let d: DatosHerramientas;
let U: Record<'super' | 'adminA' | 'adminB' | 'huerfano' | 'prop1' | 'prop2' | 'propB' | 'inq1' | 'mttoA' | 'segA' | 'juntaBlock1' | 'juntaCondominio' | 'vocal', AuthUser>;

before(async () => {
  d = await sembrarHerramientas();
  U = {
    super: await usuarioDe(d.superadmin.id), adminA: await usuarioDe(d.adminA.id), adminB: await usuarioDe(d.adminB.id), huerfano: await usuarioDe(d.adminSinEmpresa.id),
    prop1: await usuarioDe(d.propietario1.id), prop2: await usuarioDe(d.propietario2.id), propB: await usuarioDe(d.propietarioB.id), inq1: await usuarioDe(d.inquilino1.id),
    mttoA: await usuarioDe(d.mantenimientoA.id), segA: await usuarioDe(d.seguridadA.id),
    juntaBlock1: await usuarioDe(d.juntaBlock1.id), juntaCondominio: await usuarioDe(d.juntaCondominio.id), vocal: await usuarioDe(d.vocal.id),
  };
});
after(async () => { await prisma.$disconnect(); });

const usar = (u: AuthUser, nombre: string, entrada: unknown = {}) => ejecutarHerramienta(u, nombre, entrada, { origen: 'asistente' });
async function datos(u: AuthUser, nombre: string, entrada: unknown = {}) {
  const r = await usar(u, nombre, entrada);
  assert.ok(r.ok, `${nombre} falló: ${r.ok ? '' : r.mensaje}`);
  return r.datos as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const texto = (x: unknown) => JSON.stringify(x);
const nombres = (u: AuthUser) => herramientasDe(u).map((h) => h.nombre);

const GESTION = ['resumen_cobranza', 'morosos', 'buscar_unidad', 'detalle_unidad', 'recibos', 'cargos', 'pagos', 'pagos_por_validar', 'cobranza_por_concepto', 'cobranza_por_mes', 'medios_de_pago', 'condominios_y_blocks', 'tareas_de_mantenimiento', 'avisos_recientes'];
const RESIDENTE = ['mis_unidades', 'mi_deuda', 'mis_recibos', 'mis_pagos', 'medios_para_pagar'];
const SUPERADMIN = ['empresas', 'salud_de_la_ia', 'auditoria_reciente'];
// Argumentos de cada herramienta de gestión para recorrerlas todas.
const ARGS: Record<string, unknown> = { detalle_unidad: { codigo: 'A-101' }, buscar_unidad: { texto: '101' } };

describe('catálogo', () => {
  it('son 22 herramientas, todas de solo lectura, con nombre único y descripción útil', () => {
    assert.equal(CATALOGO.length, 22);
    assert.deepEqual(new Set(CATALOGO.map((h) => h.nombre)), new Set([...GESTION, ...RESIDENTE, ...SUPERADMIN]));
    for (const h of CATALOGO) {
      assert.equal(h.solo_lectura, true, h.nombre);
      assert.ok(h.descripcion.length >= 60 && /Ejemplo/.test(h.descripcion), `${h.nombre}: descripción pobre`);
      const s = descriptorDe(h).inputSchema as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.equal(s.type, 'object', h.nombre);
      assert.equal(s.additionalProperties, false, `${h.nombre}: debe rechazar campos de más`);
    }
  });

  it('cada rol recibe sólo lo suyo: residentes mis_*, gestión sin las del residente, personal sin cobranza', () => {
    assert.deepEqual(nombres(U.prop1).sort(), [...RESIDENTE].sort());
    assert.deepEqual(nombres(U.inq1).sort(), [...RESIDENTE].sort());
    assert.deepEqual(nombres(U.adminA).sort(), [...GESTION].sort());
    assert.deepEqual(nombres(U.super).sort(), [...GESTION, ...SUPERADMIN].sort());
    assert.deepEqual(nombres(U.mttoA), []);
    assert.deepEqual(nombres(U.segA), []);
    // La junta (presidente/tesorero) suma la gestión de su ámbito (sin mantenimiento ni avisos); secretario y vocal no ganan nada.
    const junta = nombres(U.juntaBlock1);
    assert.ok(RESIDENTE.every((n) => junta.includes(n)) && junta.includes('morosos') && junta.includes('pagos_por_validar'));
    assert.ok(!junta.includes('tareas_de_mantenimiento') && !junta.includes('avisos_recientes') && !SUPERADMIN.some((n) => junta.includes(n)));
    assert.deepEqual(nombres(U.vocal).sort(), [...RESIDENTE].sort());
  });

  it('los esquemas para Gemini no llevan lo que Gemini rechaza', () => {
    for (const h of CATALOGO) {
      const s = texto(esquemaParaGemini(descriptorDe(h).inputSchema));
      assert.ok(!/additionalProperties|"pattern"|"default"|anyOf|\$schema/.test(s), `${h.nombre}: ${s}`);
    }
  });
});

describe('quién puede ejecutar qué (el rol se revalida en cada llamada)', () => {
  it('mantenimiento y seguridad no ejecutan nada, ni siquiera nombrándolo', async () => {
    for (const u of [U.mttoA, U.segA]) for (const n of [...GESTION, ...RESIDENTE, ...SUPERADMIN]) {
      const r = await usar(u, n, ARGS[n] ?? {});
      assert.equal(r.ok, false, `${u.rol} ejecutó ${n}`);
    }
  });
  it('el residente no ejecuta herramientas de gestión ni de superadmin; el admin no ejecuta las de residente ni las de superadmin', async () => {
    for (const n of [...GESTION, ...SUPERADMIN]) assert.equal((await usar(U.prop2, n, ARGS[n] ?? {})).ok, false, `prop2 ejecutó ${n}`);
    for (const n of [...RESIDENTE, ...SUPERADMIN]) assert.equal((await usar(U.adminA, n)).ok, false, `adminA ejecutó ${n}`);
    for (const n of RESIDENTE) assert.equal((await usar(U.super, n)).ok, false, `superadmin ejecutó ${n}`);
  });
  it('secretario/vocal no ganan gestión; la junta no ejecuta herramientas de plataforma ni de mantenimiento', async () => {
    assert.equal((await usar(U.vocal, 'morosos')).ok, false);
    for (const n of ['tareas_de_mantenimiento', 'avisos_recientes', ...SUPERADMIN]) assert.equal((await usar(U.juntaBlock1, n)).ok, false, n);
  });
  it('una herramienta inventada y una de otro rol responden igual (no se revela el catálogo)', async () => {
    const a = await usar(U.prop1, 'borrar_todo');
    const b = await usar(U.prop1, 'morosos');
    assert.equal(a.ok, false); assert.equal(b.ok, false);
    if (!a.ok && !b.ok) { assert.equal(a.codigo, 'desconocida'); assert.equal(b.codigo, 'sin_permiso'); assert.match(b.mensaje, /No existe la herramienta/); }
  });
  it('un admin sin empresa no ve datos (nunca «todas las huérfanas»)', async () => {
    for (const n of GESTION.filter((x) => x !== 'condominios_y_blocks')) assert.equal((await usar(U.huerfano, n, ARGS[n] ?? {})).ok, false, n);
  });
});

describe('aislamiento entre empresas', () => {
  const MARCAS_B = ['B-101', 'Complejo B', 'Agua B', 'Propietario B', 'Titular de B', 'Tarea de B', 'PAGO-B', 'Empresa B'];
  const MARCAS_A = ['A-101', 'A-102', 'Complejo A', 'Propietario 1', 'Reparar ascensor', 'Junta Block'];

  it('el admin de A nunca ve nada de B en ninguna herramienta de gestión', async () => {
    for (const n of GESTION) {
      const t = texto(await datos(U.adminA, n, ARGS[n] ?? {}));
      for (const m of MARCAS_B) assert.ok(!t.includes(m), `${n} filtra «${m}» de la empresa B`);
    }
  });
  it('y el admin de B nunca ve nada de A', async () => {
    for (const n of GESTION) {
      const t = texto(await datos(U.adminB, n, n === 'detalle_unidad' ? { codigo: 'B-101' } : n === 'buscar_unidad' ? { texto: 'B-1' } : {}));
      for (const m of MARCAS_A) assert.ok(!t.includes(m), `${n} filtra «${m}» de la empresa A`);
    }
  });
  it('el superadmin ve las dos empresas', async () => {
    const m = await datos(U.super, 'morosos');
    assert.deepEqual(m.filas.map((f: any) => f.unidad).sort(), ['A-101', 'A-102', 'B-101']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(m.alcance, 'toda la plataforma');
  });
  it('morosos del admin A: sus dos unidades, con deuda vencida correcta y nombres cortos', async () => {
    const m = await datos(U.adminA, 'morosos');
    assert.equal(m.total_morosos, 2);
    const a101 = m.filas.find((f: any) => f.unidad === 'A-101'); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(a101.deuda_vencida, '183.50'); // 150 + 33.50 del concepto hostil
    assert.equal(a101.propietario, 'Propietario 1');
    assert.equal(a101.inquilino, 'Inquilino 1');
    assert.equal(m.moneda, 'PEN');
    assert.match(m.deuda_vencida_total, /^\d+\.\d{2}$/);
  });
  it('detalle_unidad: un código de otra empresa «no existe»; con el filtro de condominio ajeno tampoco', async () => {
    const r = await datos(U.adminA, 'detalle_unidad', { codigo: 'B-101' });
    assert.equal(r.encontrada, false);
    const r2 = await datos(U.adminA, 'detalle_unidad', { codigo: 'A-101', condominio_id: d.complejoB.id });
    assert.equal(r2.encontrada, false);
    const ok = await datos(U.adminA, 'detalle_unidad', { codigo: 'a-101' });
    assert.equal(ok.encontrada, true);
    assert.equal(ok.unidad, 'A-101');
    assert.ok(ok.cargos_abiertos.length >= 2 && ok.ultimos_pagos.length === 1);
  });
  it('pagos y cobranza_por_mes: los pagos de B no entran en las sumas de A', async () => {
    const p = await datos(U.adminA, 'pagos');
    assert.deepEqual(p.filas.map((x: any) => x.unidad).sort(), ['A-101', 'A-102']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const mes = await datos(U.adminA, 'cobranza_por_mes', { meses: 3 });
    const cobrado = mes.filas.reduce((s: number, f: any) => s + Number(f.cobrado), 0); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(cobrado, 150);
    const sup = await datos(U.super, 'cobranza_por_mes', { meses: 3 });
    assert.equal(sup.filas.reduce((s: number, f: any) => s + Number(f.cobrado), 0), 240); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it('resumen_cobranza: cifras del alcance y del periodo', async () => {
    const r = await datos(U.adminA, 'resumen_cobranza');
    assert.equal(r.emitido, '533.50'); // 150 + 200 + 150 + 33.50
    assert.equal(r.vencido.monto, '333.50');
    assert.equal(r.unidades_morosas, 2);
    assert.equal(r.pagos_por_validar, 1);
    const sep = await datos(U.adminA, 'resumen_cobranza', { periodo: '2026-10' });
    assert.equal(sep.emitido, '200.00');
    const sup = await datos(U.super, 'resumen_cobranza');
    assert.equal(sup.emitido, '623.50');
  });
  it('tareas, avisos, empresas y medios respetan la empresa', async () => {
    const t = await datos(U.adminA, 'tareas_de_mantenimiento');
    assert.deepEqual(t.filas.map((x: any) => x.titulo).sort(), ['Pintar pasillo', 'Reparar ascensor']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const av = await datos(U.adminA, 'avisos_recientes');
    assert.equal(av.total, 1);
    assert.equal((await datos(U.super, 'avisos_recientes')).total, 2);
    const m = await datos(U.adminA, 'medios_de_pago');
    assert.equal(m.filas.length, 2);
    const e = await datos(U.super, 'empresas');
    assert.equal(e.total, 2);
    const c = await datos(U.adminA, 'condominios_y_blocks');
    assert.deepEqual(c.filas.map((x: any) => x.nombre), ['Complejo A']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(c.filas[0].unidades, 2);
  });
});

describe('junta: sólo su block o condominio', () => {
  it('la junta de un block ve únicamente las unidades, pagos, recibos y medios de ese block', async () => {
    const m = await datos(U.juntaBlock1, 'morosos');
    assert.deepEqual(m.filas.map((f: any) => f.unidad), ['A-101']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(m.alcance, 'tu ámbito de junta');
    for (const n of ['pagos', 'pagos_por_validar', 'cargos', 'recibos', 'buscar_unidad', 'resumen_cobranza', 'cobranza_por_concepto', 'medios_de_pago', 'condominios_y_blocks']) {
      const t = texto(await datos(U.juntaBlock1, n, n === 'buscar_unidad' ? { texto: 'A-1' } : {}));
      assert.ok(!t.includes('A-102') && !t.includes('Block 2') && !t.includes('Junta Block 2') && !t.includes('B-101'), `${n} sale del block de la junta`);
    }
    const bloques = await datos(U.juntaBlock1, 'condominios_y_blocks');
    assert.deepEqual(bloques.filas[0].blocks.map((b: any) => b.nombre), ['Block 1']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const det = await datos(U.juntaBlock1, 'detalle_unidad', { codigo: 'A-102' });
    assert.equal(det.encontrada, false);
    const r = await datos(U.juntaBlock1, 'resumen_cobranza');
    assert.equal(r.unidades_morosas, 1);
  });
  it('la junta del condominio ve los blocks de su condominio pero no otro condominio', async () => {
    const m = await datos(U.juntaCondominio, 'morosos');
    assert.deepEqual(m.filas.map((f: any) => f.unidad).sort(), ['A-101', 'A-102']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(!texto(await datos(U.juntaCondominio, 'pagos')).includes('PAGO-B'));
  });
  it('los medios de pago de la junta de un block no incluyen los de otro block', async () => {
    const m = await datos(U.juntaBlock1, 'medios_de_pago');
    assert.deepEqual(m.filas.map((x: any) => x.titular), ['Junta Block 1']); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('residente e inquilino: sólo lo suyo', () => {
  it('cada residente ve sus unidades, su deuda, sus recibos y sus pagos — nunca los de otro', async () => {
    const u1 = await datos(U.prop1, 'mis_unidades');
    assert.deepEqual(u1.filas.map((f: any) => f.unidad), ['A-101']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const u2 = await datos(U.prop2, 'mis_unidades');
    assert.deepEqual(u2.filas.map((f: any) => f.unidad), ['A-102']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual((await datos(U.propB, 'mis_unidades')).filas.map((f: any) => f.unidad), ['B-101']); // eslint-disable-line @typescript-eslint/no-explicit-any
    const inq = await datos(U.inq1, 'mis_unidades');
    assert.deepEqual(inq.filas.map((f: any) => [f.unidad, f.mi_rol]), [['A-101', 'inquilino']]); // eslint-disable-line @typescript-eslint/no-explicit-any

    const deuda1 = await datos(U.prop1, 'mi_deuda');
    assert.equal(deuda1.deuda_total, '383.50'); // 150 + 200 + 33.50
    assert.equal(deuda1.cargos_vencidos, 2);
    assert.equal(deuda1.proximo_vencimiento.monto, '200.00');
    assert.equal((await datos(U.prop2, 'mi_deuda')).deuda_total, '150.00');
    assert.equal((await datos(U.propB, 'mi_deuda')).deuda_total, '90.00');

    for (const n of ['mis_recibos', 'mis_pagos', 'mi_deuda', 'mis_unidades', 'medios_para_pagar']) {
      const t = texto(await datos(U.prop2, n));
      assert.ok(!t.includes('A-101') && !t.includes('B-101') && !t.includes('OP-123'), `${n} de prop2 muestra lo de otro`);
    }
    const pagos1 = await datos(U.prop1, 'mis_pagos');
    assert.deepEqual(pagos1.filas.map((f: any) => f.estado), ['por_validar']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal((await datos(U.propB, 'mis_pagos')).filas.length, 1);
  });
  it('los residentes no tienen ningún argumento para mirar otra unidad o persona', async () => {
    for (const h of herramientasDe(U.prop1)) {
      const props = Object.keys((descriptorDe(h).inputSchema as any).properties ?? {}); // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.ok(!props.some((p) => /unidad|usuario|codigo|condominio|persona|propietario/.test(p)), `${h.nombre} admite ${props}`);
    }
    const r = await usar(U.prop2, 'mis_recibos', { unidad: 'A-101' });
    assert.equal(r.ok, false);
  });
  it('medios_para_pagar: los del block y los del condominio de la persona, no los de otro block ni condominio', async () => {
    const m1 = await datos(U.prop1, 'medios_para_pagar');
    assert.deepEqual(m1.filas.map((f: any) => f.titular), ['Junta Block 1']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(m1.filas[0].tiene_qr, true);
    assert.ok(!texto(m1).includes('qr_datos'));
    const m2 = await datos(U.prop2, 'medios_para_pagar');
    assert.deepEqual(m2.filas.map((f: any) => f.titular), ['Junta Block 2']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual((await datos(U.propB, 'medios_para_pagar')).filas.map((f: any) => f.titular), ['Titular de B']); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

describe('plataforma (superadmin)', () => {
  it('salud_de_la_ia, auditoria_reciente y empresas responden sin claves ni datos sensibles', async () => {
    const s = await datos(U.super, 'salud_de_la_ia');
    assert.equal(typeof s.sana, 'boolean');
    assert.ok(!/api_key|clave_cifrada|sk-|AIza/.test(texto(s)));
    const a = await datos(U.super, 'auditoria_reciente');
    assert.ok(Array.isArray(a.filas));
    const e = await datos(U.super, 'empresas');
    assert.deepEqual(e.filas.map((f: any) => f.nombre), ['Empresa A', 'Empresa B']); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(e.filas[0].usuarios >= 5, true);
  });
});

describe('campos prohibidos', () => {
  it('ninguna herramienta, para ningún rol, devuelve correos, teléfonos, hashes, claves, tokens ni bytes', async () => {
    const casos: [AuthUser, string][] = [];
    for (const u of Object.values(U)) for (const h of herramientasDe(u)) casos.push([u, h.nombre]);
    assert.ok(casos.length > 80);
    for (const [u, n] of casos) {
      const r = await usar(u, n, ARGS[n] ?? {});
      if (!r.ok) continue; // p. ej. el admin huérfano
      const mediosOk = ['medios_de_pago', 'medios_para_pagar'].includes(n);
      assert.deepEqual(hallazgosProhibidos(r.datos, '$', mediosOk), [], `${u.rol} ${n}`);
    }
  });
  it('un correo escrito dentro de un texto de la base (la referencia de un pago) sale omitido', async () => {
    const p = await datos(U.adminA, 'pagos');
    const t = texto(p);
    assert.ok(!t.includes('prop1@test.pe'));
    assert.match(t, /correo omitido/);
  });
  it('los bytes del comprobante y del QR nunca viajan; el QR sólo se indica como «tiene_qr»', async () => {
    const t = texto(await datos(U.adminA, 'pagos')) + texto(await datos(U.adminA, 'medios_de_pago')) + texto(await datos(U.prop1, 'medios_para_pagar'));
    assert.ok(!/comprobante\.png|"datos"|Buffer|"data"|20111111111|qr_datos/.test(t), t.slice(0, 200));
  });
  it('depurar quita campos prohibidos aunque una herramienta futura los devolviera', () => {
    const { valor, quitados } = depurar({ filas: [{ nombre: 'Ana', email: 'a@b.pe', password_hash: 'x', api_key: 'k', nota: 'escribe a ana@x.com' }] });
    assert.equal(quitados, 4);
    assert.deepEqual(valor, { filas: [{ nombre: 'Ana', nota: 'escribe a [correo omitido]' }] });
  });
});

describe('límites, cursor y entradas inválidas', () => {
  before(async () => {
    // 60 unidades morosas más en la empresa A.
    const rc = await prisma.reciboConcepto.findFirstOrThrow({ where: { recibo_id: d.reciboVencidoA.id, concepto_id: d.conceptoA.id } });
    for (let i = 0; i < 60; i++) {
      const un = await prisma.unidad.create({ data: { codigo: `Z-${String(i).padStart(3, '0')}`, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: d.propietario2.id, estado: 'activa' } });
      await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: un.id, monto: 10 + i, estado_pago: 'pendiente' } });
    }
  });

  it('50 filas como máximo por llamada; 51 se rechaza; el cursor recorre todo sin repetir ni perder', async () => {
    assert.equal((await usar(U.adminA, 'morosos', { limite: 51 })).ok, false);
    assert.equal((await usar(U.adminA, 'morosos', { limite: 0 })).ok, false);
    const vistas = new Set<string>();
    let cursor: string | undefined;
    let paginas = 0;
    do {
      const r = await datos(U.adminA, 'morosos', { limite: 50, ...(cursor ? { cursor } : {}) });
      assert.ok(r.filas.length <= 50);
      for (const f of r.filas) { assert.ok(!vistas.has(f.unidad), `repetida ${f.unidad}`); vistas.add(f.unidad); }
      cursor = r.siguiente_cursor ?? undefined;
      paginas++;
      assert.equal(r.hay_mas, cursor !== undefined);
    } while (cursor && paginas < 10);
    assert.equal(vistas.size, 62);
    assert.equal(paginas, 2);
  });
  it('por omisión devuelve 20 filas; las demás herramientas con lista también respetan el tope', async () => {
    assert.equal((await datos(U.adminA, 'morosos')).filas.length, 20);
    for (const n of ['cargos', 'buscar_unidad', 'pagos', 'recibos']) {
      const r = await datos(U.adminA, n, { ...(n === 'buscar_unidad' ? { texto: 'Z-' } : {}), limite: 50 });
      assert.ok(r.filas.length <= 50, n);
    }
    assert.equal((await datos(U.adminA, 'cargos', { limite: 50 })).filas.length, 50);
  });
  it('un cursor inventado o negativo se rechaza', async () => {
    assert.equal((await usar(U.adminA, 'morosos', { cursor: 'x1; DROP TABLE' })).ok, false);
    assert.equal((await usar(U.adminA, 'morosos', { cursor: 'o-5' })).ok, false);
  });
  it('zod estricto: un campo de más, un periodo mal escrito, un tipo equivocado y un estado inexistente se rechazan con mensaje', async () => {
    for (const [n, e] of [['morosos', { admin: true }], ['resumen_cobranza', { periodo: '2026-13' }], ['resumen_cobranza', { periodo: 'septiembre' }], ['cargos', { estado: 'borrado' }], ['pagos', { desde: '01/10/2026' }], ['morosos', { condominio_id: 'uno' }], ['cobranza_por_mes', { meses: 99 }], ['mis_unidades', { x: 1 }]] as [string, unknown][]) {
      const r = await usar(n === 'mis_unidades' ? U.prop1 : U.adminA, n, e);
      assert.equal(r.ok, false, `${n} ${JSON.stringify(e)}`);
      if (!r.ok) assert.equal(r.codigo, 'entrada_invalida');
    }
  });
  it('mi_deuda con muchas unidades: total correcto, las 50 con más deuda y el conteo; la respuesta cabe entera para el asistente', async () => {
    const r = await usar(U.prop2, 'mi_deuda');
    assert.ok(r.ok);
    if (!r.ok) return;
    const d = r.datos as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(d.deuda_total, '2520.00'); // 150 + (10 + … + 69)
    assert.equal(d.unidades_con_deuda, 61);
    assert.equal(d.por_unidad.length, 50);
    assert.equal(d.por_unidad[0].deuda, '150.00');
    assert.ok(!d.truncado, 'no hace falta recortar');
    assert.ok(JSON.stringify(d).length < 12_000);
  });
  it('si la respuesta se recorta por tamaño, el cursor apunta a lo entregado: paginar no pierde ninguna fila', async () => {
    const vistas: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 80; i++) {
      const r = await ejecutarHerramienta(U.adminA, 'morosos', { limite: 50, ...(cursor ? { cursor } : {}) }, { origen: 'asistente', maxCaracteres: 2500 });
      assert.ok(r.ok);
      if (!r.ok) return;
      const d = r.datos as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.ok(JSON.stringify(d).length <= 2500);
      vistas.push(...d.filas.map((f: any) => f.unidad)); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (d.truncado) assert.equal(d.hay_mas, true);
      cursor = d.siguiente_cursor ?? undefined;
      if (!cursor) break;
    }
    assert.equal(vistas.length, 62);
    assert.equal(new Set(vistas).size, 62, 'sin repetidas');
  });
  it('acotar conserva los totales y recorta las listas, aunque no se llamen «filas»', () => {
    const grande = { moneda: 'PEN', aviso: 'x', deuda_total: '10.00', por_unidad: Array.from({ length: 50 }, (_, i) => ({ i, t: 'y'.repeat(200) })) };
    const a = acotar(grande, 3000) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(a.deuda_total, '10.00');
    assert.equal(a.truncado, true);
    assert.ok(JSON.stringify(a).length <= 3000 && a.por_unidad.length >= 1 && a.por_unidad.length < 50);
  });
  it('segunda línea de defensa: aunque la entrada pasara de 50, la paginación nunca pide más de 50 filas (ni menos de 1)', () => {
    assert.deepEqual([pagina({ limite: 5000 }).limite, pagina({ limite: 5000 }).take], [MAX_FILAS, MAX_FILAS + 1]);
    assert.equal(pagina({ limite: -3 }).limite, 1);
    assert.equal(pagina({ limite: 20, cursor: 'o40' }).skip, 40);
  });
  it('una respuesta enorme se recorta y se marca como truncada', async () => {
    const grande = { moneda: 'PEN', aviso: 'x', filas: Array.from({ length: 50 }, (_, i) => ({ i, texto: 'x'.repeat(300) })) };
    const a = acotar(grande, 4000);
    assert.equal(a.truncado, true);
    assert.ok(JSON.stringify(a).length <= 4000);
    assert.ok((a.filas as unknown[]).length < 50 && (a.filas as unknown[]).length >= 1);
  });
});

describe('formato', () => {
  it('montos como texto con 2 decimales y moneda PEN; fechas ISO; periodo AAAA-MM', async () => {
    const c = await datos(U.adminA, 'cargos', { estado: 'vencido' });
    assert.equal(c.moneda, 'PEN');
    for (const f of c.filas) {
      assert.match(f.monto, /^\d+\.\d{2}$/);
      assert.match(f.vencimiento, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(f.periodo, /^\d{4}-\d{2}$/);
      assert.equal(f.estado, 'vencido');
    }
    const p = await datos(U.adminA, 'pagos');
    for (const f of p.filas) assert.match(f.fecha_pago, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-05:00$/);
  });
  it('filtros de cargos: concepto, unidad, periodo y vencimiento', async () => {
    assert.equal((await datos(U.adminA, 'cargos', { concepto: 'manten', unidad: 'a-102' })).filas.length, 1);
    assert.equal((await datos(U.adminA, 'cargos', { periodo: '2026-10' })).filas.length, 1);
    assert.equal((await datos(U.adminA, 'cargos', { vence_desde: '2999-01-01' })).filas.length, 0);
  });
  it('pagos: por estado, método y rango; por_validar con lectura de IA y los más antiguos primero', async () => {
    assert.equal((await datos(U.adminA, 'pagos', { estado: 'por_validar' })).filas.length, 1);
    assert.equal((await datos(U.adminA, 'pagos', { metodo: 'YAPE' })).filas.length, 1);
    assert.equal((await datos(U.adminA, 'pagos', { desde: '2000-01-01', hasta: '2000-01-02' })).filas.length, 0);
    assert.equal((await datos(U.adminA, 'pagos_por_validar')).filas.length, 1);
  });
});

describe('texto hostil de la base', () => {
  it('un concepto con saltos de línea, etiquetas y «instrucciones» sale en una sola línea, sin < > ni comillas invertidas, y con el aviso de datos no confiables', async () => {
    const r = await datos(U.adminA, 'cargos', { unidad: 'A-101', limite: 50 });
    const f = r.filas.find((x: any) => /Ignora/.test(x.concepto)); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(f, 'no apareció el concepto');
    assert.ok(!/[\n\r<>`]/.test(f.concepto), f.concepto);
    assert.match(r.aviso, /DATOS NO CONFIABLES/);
    for (const n of ['mis_recibos']) {
      const t = await datos(U.prop1, n);
      assert.ok(!/[\n<>`]/.test(t.filas.map((x: any) => x.concepto).join('')), n); // eslint-disable-line @typescript-eslint/no-explicit-any
      assert.match(t.aviso, /NO CONFIABLES/);
    }
  });
});

describe('auditoría de cada llamada', () => {
  it('queda usuario, herramienta, origen, filas y argumentos sin datos sensibles; las rechazadas también', async () => {
    await prisma.auditoria.deleteMany({ where: { entidad: 'herramienta' } });
    await ejecutarHerramienta(U.adminA, 'cargos', { estado: 'vencido', concepto: 'x'.repeat(30), limite: 5 }, { origen: 'mcp' });
    await usar(U.prop1, 'morosos');
    await usar(U.adminA, 'cargos', { password: 'secreta', estado: 'zzz' });
    const filas = await esperar(async () => { const f = await prisma.auditoria.findMany({ where: { entidad: 'herramienta' }, orderBy: { id: 'asc' } }); return f.length >= 3 ? f : null; });
    const [a, b, c] = filas.map((f) => ({ ...f, det: f.detalle as any })); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(a!.usuario_id, d.adminA.id);
    assert.equal(a!.accion, 'consultar');
    assert.deepEqual([a!.det.herramienta, a!.det.origen, a!.det.estado], ['cargos', 'mcp', 'ok']);
    assert.equal(typeof a!.det.filas, 'number');
    assert.equal(a!.det.argumentos.limite, 5);
    assert.equal(b!.det.estado, 'sin_permiso');
    assert.equal(b!.det.origen, 'asistente');
    assert.equal(c!.det.estado, 'entrada_invalida');
    assert.equal(c!.det.argumentos.password, '[omitido]');
    assert.ok(!JSON.stringify(filas).includes('secreta'));
  });
  it('auditoria_reciente muestra las consultas por herramienta sin argumentos ni IP', async () => {
    const a = await datos(U.super, 'auditoria_reciente', { entidad: 'herramienta' });
    assert.ok(a.filas.length >= 3);
    for (const f of a.filas) {
      assert.ok(['mcp', 'asistente'].includes(f.origen) && typeof f.herramienta === 'string');
      assert.ok(!('argumentos' in f) && !('ip' in f) && !('detalle' in f));
    }
  });
});

describe('mensajes de error útiles para el modelo', () => {
  it('limite fuera de rango dice el rango, no «debe ser un número»', async () => {
    const r = await usar(U.adminA, 'morosos', { limite: 500 });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.mensaje, /limite máximo: 50/);
    const t = await usar(U.adminA, 'morosos', { limite: 'muchos' });
    if (!t.ok) assert.match(t.mensaje, /limite debe ser un número/);
  });
});
