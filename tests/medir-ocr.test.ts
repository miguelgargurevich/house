// Script de medición `medir:ocr` (scripts/medir-ocr-vs-ia.ts): SÓLO LECTURA. Cuenta cuántas evaluaciones de IA habría aceptado el OCR solo y si coincide con lo que
// guardó la IA. Nada sale a la red (IA y OCR falsos) y la base es la de pruebas.
import './helpers/env';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, login, prisma, sembrar, type Datos } from './helpers/app';
import { dnsFalso, restaurarDns } from './helpers/gateways';
import { pagarCargo, pngUnico } from './helpers/pagoResidente';
import { hoyLima } from '../src/server/lib/fechas';
import { guardarOcr } from '../src/server/lib/gatewaysAdmin';
import { limpiarTodo } from '../src/server/lib/cooldown';
import { esperarEvaluaciones } from '../src/server/services/evaluacion';
import { guardar as guardarClaveLlavero, llaveroDeps } from '../src/server/services/llavero';
import { ocrDeps } from '../src/server/services/ocrVoucher';
import { olvidarTodoUso } from '../src/server/services/rotacion';
import { baseEsLocal, CONCURRENCIA, discrepancias, formatearInforme, leerOpciones, LIMITE_POR_DEFECTO, medir } from '../scripts/medir-ocr-vs-ia';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const DIA = 86_400_000;
const HOY = hoyLima().getTime();
const iso = (dias = 0) => new Date(HOY + dias * DIA).toISOString().slice(0, 10);
const fechaTexto = (dias = 0) => iso(dias).split('-').reverse().join('/');

// =====================================================================================================
describe('argumentos y barrera de la base', () => {
  it('--limite: por defecto 50; acepta «--limite N» y «--limite=N»; rechaza lo que no sea un entero 1–5000 y las opciones desconocidas', () => {
    assert.deepEqual(leerOpciones([]), { limite: LIMITE_POR_DEFECTO, soloLecturaRemota: false });
    assert.equal(LIMITE_POR_DEFECTO, 50);
    assert.equal(leerOpciones(['--limite', '200']).limite, 200);
    assert.equal(leerOpciones(['--limite=7']).limite, 7);
    assert.equal(leerOpciones(['--solo-lectura-remota']).soloLecturaRemota, true);
    for (const malo of [['--limite'], ['--limite', '0'], ['--limite', '-3'], ['--limite', 'abc'], ['--limite', '5001'], ['--limite', '1.5'], ['--borrar']]) {
      assert.throws(() => leerOpciones(malo), Error, malo.join(' '));
    }
  });

  it('baseEsLocal: sólo localhost, 127.0.0.1 y ::1; sin URL o con una ilegible no es local', () => {
    assert.equal(baseEsLocal('postgresql://postgres:x@localhost:5433/house'), true);
    assert.equal(baseEsLocal('postgresql://postgres:x@127.0.0.1:5432/house'), true);
    assert.equal(baseEsLocal('postgresql://postgres:x@[::1]:5432/house'), true);
    assert.equal(baseEsLocal('postgresql://postgres:x@db.ejemplo.com:5432/house'), false);
    assert.equal(baseEsLocal('postgresql://postgres:x@localhost.ejemplo.com:5432/house'), false);
    assert.equal(baseEsLocal('no es una url'), false);
    assert.equal(baseEsLocal(undefined), false);
  });

  it('con una DATABASE_URL remota el script aborta (código 2) sin tocar la base, salvo --solo-lectura-remota', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/medir-ocr-vs-ia.ts'], {
      env: { ...process.env, DATABASE_URL: 'postgresql://postgres:x@db.ejemplo.com:5432/house' }, encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /no es localhost/);
    assert.equal(r.stdout, '');
  });

  it('discrepancias: monto (±0,01), fecha y operación (sin mayúsculas ni espacios); lo que el OCR no leyó cuenta como discrepancia', () => {
    const ia = { monto: 100, fecha: '2026-10-22', numero_operacion: 'AB12345' };
    assert.deepEqual(discrepancias({ monto: 100.01, fecha: '2026-10-22', numero_operacion: ' ab12345 ' }, ia), []);
    assert.deepEqual(discrepancias({ monto: 100.02, fecha: '2026-10-22', numero_operacion: 'AB12345' }, ia), ['monto']);
    assert.deepEqual(discrepancias({ monto: 100, fecha: '2026-10-23', numero_operacion: 'AB12345' }, ia), ['fecha']);
    assert.deepEqual(discrepancias({ monto: 100, fecha: '2026-10-22', numero_operacion: 'AB12346' }, ia), ['operacion']);
    assert.deepEqual(discrepancias({ monto: null, fecha: null, numero_operacion: null }, ia), ['monto', 'fecha', 'operacion']);
    assert.deepEqual(discrepancias({ monto: 100, fecha: '2026-10-22', numero_operacion: 'AB12345' }, null), ['monto', 'fecha', 'operacion']);
  });
});

// =====================================================================================================
let base: string;
let cerrar: () => Promise<void>;
let d: Datos;
let T: Record<'prop1', string>;
let unidades: { id: number }[];

let llamadasIA = 0;
let responder: () => Response | Promise<Response> = () => okIA('{}');
const fetchOriginal = llaveroDeps.fetch;
const ocrOriginal = { ...ocrDeps };
const okIA = (texto: string) => new Response(JSON.stringify({ choices: [{ message: { content: texto } }], candidates: [{ content: { parts: [{ text: texto }] } }] }), { status: 200 });
const lecIA = (operacion: string) => JSON.stringify({
  es_comprobante_de_pago: true, legible: true, medio: 'yape', estado_operacion: 'exitosa', monto: 100, moneda: 'PEN', fecha: iso(), numero_operacion: operacion,
  destinatario_nombre: 'Maria Perez Garcia', destino_numero: '321',
});
const voucher = (o: { monto?: string; operacion?: string } = {}) =>
  ['¡Yapeaste!', `S/ ${o.monto ?? '100'}`, 'Maria Perez Garcia', `${fechaTexto()} | 09:14 a. m.`, 'Celular: *** *** 321', 'Código de operación', o.operacion ?? '1234567'].join('\n');

/** Lo que el OCR «lee» de cada archivo, por su contenido; `null` = el servicio no responde. */
const textoDe = new Map<string, string | null>();
let ocrActivos = 0;
let ocrMaximo = 0;
let ocrLlamadas = 0;

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  dnsFalso();
  d = await sembrar();
  const hijas = ['M-1', 'M-2', 'M-3', 'M-4', 'M-5', 'M-6'];
  unidades = [];
  for (const codigo of hijas) unidades.push(await prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: d.complejoA.id, empresa_id: d.empresaA.id, propietario_id: d.propietario1.id, estado: 'activa' } }));
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, evaluacion: 100_000 } }));
  T = { prop1: await login(base, 'prop1@test.pe') };
  llaveroDeps.fetch = async () => { llamadasIA += 1; return responder(); };
});
after(async () => {
  llaveroDeps.fetch = fetchOriginal;
  Object.assign(ocrDeps, ocrOriginal);
  restaurarDns();
  delete process.env.LLAVERO_ENC_KEY;
  await esperarEvaluaciones();
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  delete process.env.GEMINI_API_KEY;
  await prisma.claveIntegracion.deleteMany();
  await prisma.configuracionOcr.deleteMany(); // mientras la IA evalúa, sin OCR: así lee la IA
  await guardarClaveLlavero({ proveedor: 'openai', clave: 'clave-falsa-openai-0001', usuarioId: d.superadmin.id });
  await prisma.evaluacionComprobante.deleteMany();
  await prisma.medioPago.deleteMany();
  await prisma.medioPago.create({ data: { complejo_id: d.complejoA.id, tipo: 'yape', celular: '987654321', titular: 'María Pérez García', creado_por_id: d.adminA.id } });
  await prisma.complejoHabitacional.update({ where: { id: d.complejoA.id }, data: { validacion_automatica_ia: false } });
  limpiarTodo();
  olvidarTodoUso();
  llamadasIA = 0;
  ocrActivos = 0; ocrMaximo = 0; ocrLlamadas = 0;
  textoDe.clear();
  Object.assign(ocrDeps, ocrOriginal, {
    fetch: async (_url: string, init: { body?: unknown }) => {
      ocrLlamadas += 1;
      ocrActivos += 1; ocrMaximo = Math.max(ocrMaximo, ocrActivos);
      try {
        await new Promise((r) => setTimeout(r, 15)); // para que se solapen las llamadas
        const blob = (init.body as FormData).get('file') as Blob;
        const clave = Buffer.from(await blob.arrayBuffer()).toString('latin1');
        const texto = textoDe.get(clave);
        return texto == null ? new Response('{}', { status: 502 }) : new Response(JSON.stringify({ text: texto, pages: 1, blocks: [] }));
      } finally { ocrActivos -= 1; }
    },
  });
});
afterEach(async () => { await esperarEvaluaciones(); });

let k = 0;
/** Un pago evaluado por la IA (que leyó `operacionIA`); el OCR «leerá» luego `textoOcr` de ese archivo. Devuelve el id del pago. */
async function pagoDeLaIA(unidad: { id: number }, operacionIA: string, textoOcr: string | null): Promise<number> {
  k += 1;
  const recibo = await prisma.recibo.create({ data: { empresa_id: d.empresaA.id, complejo_id: d.complejoA.id, mes: 10, anio: 2000 + k, fecha_emision: new Date(HOY - 60 * DIA), fecha_vencimiento: new Date(HOY + 30 * DIA), estado: 'emitido' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: 100, orden: 1 } });
  const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto: 100, estado_pago: 'pendiente' } });
  const bytes = pngUnico();
  textoDe.set(bytes.toString('latin1'), textoOcr);
  responder = () => okIA(lecIA(operacionIA));
  const r = await pagarCargo(base, T.prop1, cargo.id, { metodo_pago: 'yape', referencia: 'OP-FALSA' }, { bytes, tipo: 'image/png', nombre: 'voucher.png' });
  assert.equal(r.status, 201, r.texto);
  await esperarEvaluaciones();
  const ev = await prisma.evaluacionComprobante.findUniqueOrThrow({ where: { pago_id: r.body.id } });
  assert.equal(ev.proveedor, 'openai', 'la lectura guardada es de la IA');
  return r.body.id;
}
const configurarOcr = () => guardarOcr({ modo: 'interno', clave: 'clave-ocr-falsa' }, d.superadmin.id);

describe('medir(): recorre las evaluaciones de IA, pasa el OCR y reporta', () => {
  it('cuenta lo que el OCR aceptaría solo y dónde discrepa con la IA (por pago_id y campo), con tope de 4 a la vez, sin escribir nada y sin llamar a la IA', async () => {
    const a = await pagoDeLaIA(unidades[0]!, 'OPA11111', voucher({ operacion: 'OPA11111' })); // OCR = IA
    const b = await pagoDeLaIA(unidades[1]!, 'OPB22222', voucher({ operacion: 'OPB99999' })); // OCR acepta pero lee otra operación
    const c = await pagoDeLaIA(unidades[2]!, 'OPC33333', voucher({ monto: '99', operacion: 'OPC33333' })); // OCR no alcanza (monto)
    const e = await pagoDeLaIA(unidades[3]!, 'OPE44444', null); // OCR caído
    const f = await pagoDeLaIA(unidades[4]!, 'OPF55555', voucher({ operacion: 'OPF55555' }));
    const g = await pagoDeLaIA(unidades[5]!, 'OPG66666', voucher({ operacion: 'OPG66666' }));
    await configurarOcr();

    const antes = {
      evaluaciones: await prisma.evaluacionComprobante.findMany({ orderBy: { id: 'asc' } }),
      pagos: await prisma.pago.findMany({ orderBy: { id: 'asc' }, select: { id: true, estado_validacion: true, fecha_pago: true, fecha_origen: true, validado_por_ia: true, conformidad_at: true } }),
      auditoria: await prisma.auditoria.count(),
      notificaciones: await prisma.notificacion.count(),
    };
    const iaAntes = llamadasIA;

    const informe = await medir(50);

    assert.deepEqual(
      { ...informe, discrepancias: informe.discrepancias },
      {
        evaluadas: 6, ocrSinLectura: 1, ocrNoAlcanza: 1, ocrAlcanza: 4, omitidas: 0,
        coinciden: { monto: 4, fecha: 4, operacion: 3 },
        discrepancias: [{ pago_id: b, campos: ['operacion'] }],
      },
    );
    assert.equal(ocrLlamadas, 6, 'un OCR por evaluación');
    assert.ok(ocrMaximo <= CONCURRENCIA && CONCURRENCIA === 4, `a lo sumo 4 a la vez (máximo visto: ${ocrMaximo})`);
    assert.ok(ocrMaximo >= 2, 'y sí corre en paralelo');
    assert.equal(llamadasIA, iaAntes, 'nunca llama a la IA');
    // Sólo lectura: la base queda idéntica.
    assert.deepEqual(await prisma.evaluacionComprobante.findMany({ orderBy: { id: 'asc' } }), antes.evaluaciones);
    assert.deepEqual(await prisma.pago.findMany({ orderBy: { id: 'asc' }, select: { id: true, estado_validacion: true, fecha_pago: true, fecha_origen: true, validado_por_ia: true, conformidad_at: true } }), antes.pagos);
    assert.equal(await prisma.auditoria.count(), antes.auditoria);
    assert.equal(await prisma.notificacion.count(), antes.notificaciones);
    void [a, c, e, f, g];

    // El informe no imprime datos del voucher ni de personas.
    const texto = formatearInforme(informe);
    assert.match(texto, new RegExp(`#${b}: operacion`));
    assert.match(texto, /habría aceptado solo: 4 de 6/);
    assert.doesNotMatch(texto, /Maria|Perez|OPB|1234567|987654321|Yape|321/);
  });

  it('--limite: sólo mira las N evaluaciones más recientes', async () => {
    await pagoDeLaIA(unidades[0]!, 'OPA11111', voucher({ operacion: 'OPA11111' }));
    await pagoDeLaIA(unidades[1]!, 'OPB22222', voucher({ operacion: 'OPB22222' }));
    const ultimo = await pagoDeLaIA(unidades[2]!, 'OPC33333', voucher({ operacion: 'OPC33333' }));
    await configurarOcr();
    const informe = await medir(1);
    assert.equal(informe.evaluadas, 1);
    assert.equal(ocrLlamadas, 1);
    assert.equal(informe.ocrAlcanza, 1);
    void ultimo;
  });

  it('sin OCR configurado no hay nada que medir: todo cuenta como «sin lectura» (y no se llama a ningún servicio)', async () => {
    await pagoDeLaIA(unidades[0]!, 'OPA11111', voucher({ operacion: 'OPA11111' }));
    const informe = await medir(50);
    assert.equal(informe.ocrSinLectura, 1);
    assert.equal(informe.ocrAlcanza, 0);
    assert.equal(ocrLlamadas, 0);
  });

  it('ignora las evaluaciones que leyó el propio OCR, las que no terminaron y las que no tienen proveedor', async () => {
    const id = await pagoDeLaIA(unidades[0]!, 'OPA11111', voucher({ operacion: 'OPA11111' }));
    await prisma.evaluacionComprobante.update({ where: { pago_id: id }, data: { proveedor: 'ocr' } });
    const otro = await pagoDeLaIA(unidades[1]!, 'OPB22222', voucher({ operacion: 'OPB22222' }));
    await prisma.evaluacionComprobante.update({ where: { pago_id: otro }, data: { estado: 'error' } });
    const tercero = await pagoDeLaIA(unidades[2]!, 'OPC33333', voucher({ operacion: 'OPC33333' }));
    await prisma.evaluacionComprobante.update({ where: { pago_id: tercero }, data: { proveedor: null } });
    await configurarOcr();
    assert.equal((await medir(50)).evaluadas, 0);
  });
});
