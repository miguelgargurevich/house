// Libro de Reclamaciones virtual (Ley 29571, DS 011-2011-PCM): correlativo único y consecutivo por año, plazo de 15 días HÁBILES, copia al consumidor,
// campos obligatorios, reclamo/queja y las mismas defensas anti-abuso del contacto.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { iniciar, llamar, prisma, sembrar } from './helpers/app';
import { correoFalso } from './helpers/correoFalso';
import { comercialCorreo } from '../src/server/services/comercial/configuracion';
import { diasHabilesRestantes, fechaLimite, formatoCorrelativo, sumarDiasHabiles } from '../src/server/services/reclamaciones/plazo';
import { reclamacionSchema } from '../src/server/services/reclamaciones/esquema';
import { registrarReclamacion } from '../src/server/services/reclamaciones/registro';

const original = comercialCorreo.deps;
let correo = correoFalso();
let base: string;
let cerrar: () => Promise<void>;

const hoja = (over: Record<string, unknown> = {}) => ({
  nombre: 'Rosa Quispe Huamán', tipo_documento: 'dni', numero_documento: '45678912', domicilio: 'Jr. Los Pinos 123, Surco, Lima', correo: 'rosa@casa.pe', telefono: '987 654 321',
  menor_de_edad: false, bien_tipo: 'servicio', bien_descripcion: 'Suscripción a Torre Pro', monto_reclamado: '120.50',
  tipo: 'reclamo', detalle: 'Me cobraron dos veces el mismo mes y no recibí respuesta.', pedido: 'Que me devuelvan el cobro duplicado.', acepta_respuesta_correo: true, ...over,
});
const origen = { ip: '127.0.0.1', user_agent: 'prueba' };
/** El día de Lima a las 12:00 (mediodía: lejos de cualquier cambio de día por la zona horaria). */
const lima = (aaaammdd: string) => new Date(`${aaaammdd}T17:00:00Z`);
const dia = (d: Date) => d.toISOString().slice(0, 10);

before(async () => { await sembrar(); });
after(async () => { await prisma.$disconnect(); });
beforeEach(async () => {
  await prisma.reclamacion.deleteMany();
  await prisma.configuracionComercial.update({ where: { id: 1 }, data: { legal_razon_social: 'MIGUEL ARTURO FERNANDEZ GARGUREVICH', legal_ruc: '10409241862', legal_domicilio: 'Av. Las Gaviotas 2121, Santiago de Surco, Lima', legal_correo: 'contacto@torre.ejemplo.test' } });
  correo = correoFalso();
  comercialCorreo.deps = correo.deps;
});
afterEach(async () => { comercialCorreo.deps = original; });

describe('plazo: 15 días hábiles (sábados y domingos no cuentan)', () => {
  it('un lunes: 15 hábiles = el lunes tres semanas después', () => {
    assert.equal(dia(fechaLimite(new Date('2026-11-02T00:00:00Z'))), '2026-11-23');
  });
  it('un viernes y un sábado cruzan fines de semana: el límite cae el mismo viernes 27', () => {
    assert.equal(dia(fechaLimite(new Date('2026-11-06T00:00:00Z'))), '2026-11-27'); // vie → vie (3 semanas exactas)
    assert.equal(dia(fechaLimite(new Date('2026-11-07T00:00:00Z'))), '2026-11-27'); // sáb: el primer hábil es el lunes 9
    assert.equal(dia(fechaLimite(new Date('2026-11-08T00:00:00Z'))), '2026-11-27'); // dom
  });
  it('un miércoles: 15 hábiles = el miércoles 21 días después, no 15 corridos', () => {
    const l = fechaLimite(new Date('2026-11-04T00:00:00Z'));
    assert.equal(dia(l), '2026-11-25');
    assert.notEqual(dia(l), '2026-11-19', 'no son 15 días corridos');
  });
  it('cruza el fin de año', () => { assert.equal(dia(fechaLimite(new Date('2026-12-28T00:00:00Z'))), '2027-01-18'); });
  it('sumarDiasHabiles(…, 1) desde un viernes es el lunes; el día del registro nunca cuenta', () => {
    assert.equal(dia(sumarDiasHabiles(new Date('2026-11-06T00:00:00Z'), 1)), '2026-11-09');
    assert.equal(dia(sumarDiasHabiles(new Date('2026-11-04T00:00:00Z'), 0)), '2026-11-04');
  });
  it('días hábiles que faltan: 0 el día del límite, negativo si venció', () => {
    const limite = new Date('2026-11-23T00:00:00Z');
    assert.equal(diasHabilesRestantes(new Date('2026-11-23T00:00:00Z'), limite), 0);
    assert.equal(diasHabilesRestantes(new Date('2026-11-20T00:00:00Z'), limite), 1);
    assert.equal(diasHabilesRestantes(new Date('2026-11-02T00:00:00Z'), limite), 15);
    assert.equal(diasHabilesRestantes(new Date('2026-11-24T00:00:00Z'), limite), -1);
    assert.equal(diasHabilesRestantes(new Date('2026-11-30T00:00:00Z'), limite), -5);
  });
  it('el correlativo lleva el año y seis cifras', () => { assert.equal(formatoCorrelativo(2026, 1), '2026-000001'); assert.equal(formatoCorrelativo(2027, 123456), '2027-123456'); });
});

describe('registrarReclamacion: correlativo y plazo guardados', () => {
  it('numera 2026-000001, 2026-000002… y reinicia cada año (según la fecha de Lima)', async () => {
    const a = await registrarReclamacion(reclamacionSchema.parse(hoja()), origen, lima('2026-11-04'));
    const b = await registrarReclamacion(reclamacionSchema.parse(hoja()), origen, lima('2026-11-05'));
    const c = await registrarReclamacion(reclamacionSchema.parse(hoja()), origen, lima('2027-01-05'));
    assert.deepEqual([a.correlativo, b.correlativo, c.correlativo], ['2026-000001', '2026-000002', '2027-000001']);
  });

  it('el día es el de Lima: a las 23:30 en Lima del 31-dic (ya es 1-ene en UTC) todavía es 2026', async () => {
    const r = await registrarReclamacion(reclamacionSchema.parse(hoja()), origen, new Date('2027-01-01T04:30:00Z'));
    assert.equal(r.correlativo, '2026-000001');
    assert.equal(r.fecha, '2026-12-31');
  });

  it('guarda el plazo en días hábiles (registrada un sábado → 15 hábiles desde el lunes) y la hoja con el proveedor de la config', async () => {
    const r = await registrarReclamacion(reclamacionSchema.parse(hoja()), origen, lima('2026-11-07'));
    assert.equal(r.fecha_limite, '2026-11-27');
    assert.equal(r.plazo_dias_habiles, 15);
    const f = await prisma.reclamacion.findFirstOrThrow();
    assert.equal(dia(f.fecha_limite), '2026-11-27');
    assert.equal(f.proveedor_ruc, '10409241862');
    assert.equal(f.proveedor_razon_social, 'MIGUEL ARTURO FERNANDEZ GARGUREVICH');
    assert.equal(f.estado, 'pendiente');
    assert.equal(f.monto_reclamado?.toFixed(2), '120.50');
  });

  it('muchas hojas a la vez: cada una toma un número distinto y consecutivo (sin repetidos)', async () => {
    const hoy = lima('2026-11-04');
    const rs = await Promise.all(Array.from({ length: 8 }, () => registrarReclamacion(reclamacionSchema.parse(hoja()), origen, hoy)));
    const numeros = rs.map((r) => r.correlativo).sort();
    assert.deepEqual(numeros, Array.from({ length: 8 }, (_, i) => formatoCorrelativo(2026, i + 1)));
  });

  it('un correlativo repetido lo frena la base (índice único), no sólo el código', async () => {
    await registrarReclamacion(reclamacionSchema.parse(hoja()), origen, lima('2026-11-04'));
    const f = await prisma.reclamacion.findFirstOrThrow();
    const { id: _id, ...copia } = f;
    await assert.rejects(prisma.reclamacion.create({ data: copia }));
  });

  it('sin los datos legales del proveedor no registra nada y dice por qué (503)', async () => {
    await prisma.configuracionComercial.update({ where: { id: 1 }, data: { legal_ruc: null } });
    await assert.rejects(registrarReclamacion(reclamacionSchema.parse(hoja()), origen, lima('2026-11-04')), (e: { status?: number }) => e.status === 503);
    assert.equal(await prisma.reclamacion.count(), 0);
  });
});

describe('POST /api/publico/reclamaciones', () => {
  beforeEach(async () => { ({ base, cerrar } = await iniciar()); });
  afterEach(async () => { await cerrar(); });

  it('registra la hoja y devuelve la constancia con el número, el plazo y los datos del proveedor', async () => {
    const r = await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja());
    assert.equal(r.status, 201, r.texto);
    assert.match(r.body.correlativo, /^\d{4}-000001$/);
    assert.equal(r.body.tipo, 'reclamo');
    assert.equal(r.body.proveedor.ruc, '10409241862');
    assert.equal(r.body.consumidor.correo, 'rosa@casa.pe');
    assert.equal(r.body.plazo_dias_habiles, 15);
    assert.match(r.body.mensaje, new RegExp(r.body.correlativo));
    assert.equal(await prisma.reclamacion.count(), 1);
  });

  it('manda copia al consumidor (con el número y el plazo) y aviso a Torre', async () => {
    const r = await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja());
    const copia = correo.enviados.find((c) => c.para === 'rosa@casa.pe');
    const aviso = correo.enviados.find((c) => c.para === 'contacto@torre.ejemplo.test');
    assert.ok(copia, 'copia al consumidor');
    assert.ok(aviso, 'aviso a Torre');
    assert.ok(copia.asunto.includes(r.body.correlativo));
    assert.ok(copia.texto.includes('Me cobraron dos veces'));
    assert.ok(copia.texto.includes('15 días hábiles'));
    assert.ok(copia.texto.includes('INDECOPI'));
    assert.ok(copia.html.includes(r.body.correlativo));
    const f = await prisma.reclamacion.findFirstOrThrow();
    assert.equal(f.copia_consumidor_enviada, true);
    assert.equal(f.aviso_enviado, true);
  });

  it('con el correo caído la hoja se registra y la constancia sale igual', async () => {
    comercialCorreo.deps = correoFalso({ fallar: true }).deps;
    const r = await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja());
    assert.equal(r.status, 201);
    assert.equal((await prisma.reclamacion.findFirstOrThrow()).copia_consumidor_enviada, false);
  });

  it('acepta reclamo y queja; otro tipo → 422', async () => {
    assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ tipo: 'queja', correo: 'q@casa.pe' }))).body.tipo, 'queja');
    const mal = await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ tipo: 'sugerencia', correo: 'x@casa.pe' }));
    assert.equal(mal.status, 422);
    assert.ok(mal.body.campos.tipo);
  });

  it('campos obligatorios: cada uno que falta → 422 con su campo (por HTTP el primero; el resto contra el esquema), y no registra nada', async () => {
    const r = await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ detalle: undefined }));
    assert.equal(r.status, 422);
    assert.ok(r.body.campos.detalle);
    const obligatorios = ['nombre', 'tipo_documento', 'numero_documento', 'domicilio', 'correo', 'bien_tipo', 'bien_descripcion', 'tipo', 'detalle', 'pedido', 'acepta_respuesta_correo'];
    for (const campo of obligatorios) {
      const e = reclamacionSchema.safeParse(hoja({ [campo]: undefined }));
      assert.equal(e.success, false, campo);
      assert.ok(e.error?.issues.some((i) => i.path[0] === campo), campo);
    }
    assert.equal(await prisma.reclamacion.count(), 0);
  });

  it('sin aceptar que la respuesta llega al correo → 422; el teléfono y el monto son opcionales', async () => {
    assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ acepta_respuesta_correo: false }))).status, 422);
    const r = await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ telefono: '', monto_reclamado: '', correo: 'opc@casa.pe' }));
    assert.equal(r.status, 201, r.texto);
    const f = await prisma.reclamacion.findFirstOrThrow({ where: { consumidor_correo: 'opc@casa.pe' } });
    assert.equal(f.consumidor_telefono, null);
    assert.equal(f.monto_reclamado, null);
  });

  it('el documento se valida según su tipo (DNI 8 dígitos, RUC 11…)', async () => {
    assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ numero_documento: '123' }))).status, 422);
    assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ tipo_documento: 'ruc', numero_documento: '45678912', correo: 'a@casa.pe' }))).status, 422);
    assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ tipo_documento: 'ruc', numero_documento: '20601234567', correo: 'b@casa.pe' }))).status, 201);
  });

  it('menor de edad: pide los datos del padre, madre o apoderado; con ellos, los guarda', async () => {
    const sin = await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ menor_de_edad: true }));
    assert.equal(sin.status, 422);
    assert.ok(sin.body.campos.apoderado_nombre && sin.body.campos.apoderado_numero_documento);
    const con = await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ menor_de_edad: true, apoderado_nombre: 'Pedro Quispe', apoderado_tipo_documento: 'dni', apoderado_numero_documento: '11223344' }));
    assert.equal(con.status, 201, con.texto);
    const f = await prisma.reclamacion.findFirstOrThrow();
    assert.equal(f.menor_de_edad, true);
    assert.equal(f.apoderado_nombre, 'Pedro Quispe');
  });

  it('textos larguísimos y HTML → 422', async () => {
    assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ detalle: 'a'.repeat(3001) }))).status, 422);
    assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ detalle: 'Cobro <script>x</script> indebido' }))).status, 422);
    assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ nombre: '<b>Rosa</b>' }))).status, 422);
    assert.equal(await prisma.reclamacion.count(), 0);
  });

  it('campo trampa lleno → 200 sin registrar, sin número y sin correos', async () => {
    const r = await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ sitio_web: 'http://spam.example' }));
    assert.equal(r.status, 200);
    assert.equal(r.body.correlativo, undefined);
    assert.equal(await prisma.reclamacion.count(), 0);
    assert.equal(correo.enviados.length, 0);
  });

  it('tope por correo: la cuarta hoja con el mismo correo en una hora → 429 (a ese correo sale la copia)', async () => {
    for (let i = 0; i < 3; i++) assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja())).status, 201, `hoja ${i + 1}`);
    assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja())).status, 429);
    assert.equal(await prisma.reclamacion.count(), 3);
  });

  it('tope por IP: la sexta hoja desde la misma conexión → 429 aunque cambie el correo', async () => {
    for (let i = 0; i < 5; i++) assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ correo: `p${i}@casa.pe` }))).status, 201, `hoja ${i + 1}`);
    assert.equal((await llamar(base, 'POST', '/api/publico/reclamaciones', null, hoja({ correo: 'p9@casa.pe' }))).status, 429);
  });
});

describe('el plazo no se calcula en días corridos', () => {
  it('el código del plazo salta sábados y domingos y no suma días corridos', () => {
    const f = readFileSync('src/server/services/reclamaciones/plazo.ts', 'utf8');
    assert.match(f, /esDiaHabil\(d\)/);
    assert.match(f, /getUTCDay\(\)/);
  });
});
