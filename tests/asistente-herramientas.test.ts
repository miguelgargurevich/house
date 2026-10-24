import './helpers/env';
import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import { cabecerasDeSesion, esperar, iniciar, llamar, login, prisma } from './helpers/app';
import { chatOk, estado, flujoSse, fuerzaTexto, flujoSoloLlamada, flujoTextoYLlamada, herramientasDeclaradas, instalarIA, parsearSse, pideHerramientas, resultadosDe, sistemaDe, type LlamadaIA } from './helpers/ia';
import { sembrarHerramientas, usuarioDe, type DatosHerramientas } from './helpers/herramientas';
import { cooldownDeps, limpiarTodo } from '../src/server/lib/cooldown';
import { limpiarModelosMalos } from '../src/server/lib/modelosMalos';
import { limpiarSinHerramientas, sinHerramientas } from '../src/server/lib/modelosSinHerramientas';
import { MAX_CONSULTAS, MAX_RONDAS } from '../src/server/services/asistente/herramientas';
import { elegirHerramientas } from '../src/server/services/asistente/respaldo';
import { olvidarCausas, olvidarSaludEnMemoria } from '../src/server/services/asistente/salud';
import { olvidarTodoUso } from '../src/server/services/rotacion';

const ENC = 'clave-maestra-de-pruebas-que-supera-32-caracteres';
const MSG = 'Hola, ¿me ayudas con una consulta sobre mi cuenta de House, por favor?';
const MSG_MOROSOS = '¿Quiénes deben más en mi empresa? Dame la lista de morosos, por favor.';

let base: string;
let cerrar: () => Promise<void>;
let D: DatosHerramientas;
let T: Record<'super' | 'adminA' | 'prop1' | 'prop2' | 'mtto', string>;
let ia: ReturnType<typeof instalarIA>;
let manejador: (l: LlamadaIA) => Response | Promise<Response> = () => chatOk('Hola');
let reloj: number | null = null;
const relojOriginal = cooldownDeps.ahora;
const consolaOriginal = { log: console.log, warn: console.warn, error: console.error, info: console.info };

before(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  D = await sembrarHerramientas();
  ({ base, cerrar } = await iniciar({ rateLimits: { api: 100_000, login: 100_000, ai: 100_000, llavero: 100_000 } }));
  T = { super: await login(base, 'super@test.pe'), adminA: await login(base, 'admin.a@test.pe'), prop1: await login(base, 'prop1@test.pe'), prop2: await login(base, 'prop2@test.pe'), mtto: await login(base, 'mtto.a@test.pe') };
  ia = instalarIA((l) => manejador(l));
  cooldownDeps.ahora = () => reloj ?? Date.now();
});
after(async () => {
  ia.restaurar();
  cooldownDeps.ahora = relojOriginal;
  delete process.env.LLAVERO_ENC_KEY;
  delete process.env.ASISTENTE_HERRAMIENTAS;
  await cerrar();
  await prisma.$disconnect();
});
beforeEach(async () => {
  process.env.LLAVERO_ENC_KEY = ENC;
  delete process.env.ASISTENTE_HERRAMIENTAS;
  delete process.env.GEMINI_API_KEY;
  await prisma.claveIntegracion.deleteMany();
  await prisma.conversacionIA.deleteMany();
  await prisma.auditoria.deleteMany();
  await prisma.estadoIA.deleteMany();
  limpiarTodo(); limpiarModelosMalos(); limpiarSinHerramientas(); olvidarTodoUso(); olvidarCausas(); olvidarSaludEnMemoria();
  reloj = null;
  ia.llamadas.length = 0;
  manejador = () => chatOk('Hola');
  for (const k of ['log', 'warn', 'error', 'info'] as const) console[k] = () => undefined;
});
afterEach(() => { Object.assign(console, consolaOriginal); });

const guardar = async (proveedor: string, clave: string) => (await llamar(base, 'PUT', `/api/llavero/${proveedor}`, T.super, { clave })).body as { id: number };
const chat = (token: string, mensaje = MSG, extra: Record<string, unknown> = {}) => llamar(base, 'POST', '/api/ai-chat', token, { message: mensaje, ...extra });
async function stream(token: string, mensaje = MSG) {
  const r = await fetch(`${base}/api/ai-chat/stream`, { method: 'POST', headers: { 'content-type': 'application/json', ...cabecerasDeSesion(token) }, body: JSON.stringify({ message: mensaje }) });
  const texto = await r.text();
  return { status: r.status, eventos: parsearSse(texto) };
}
const chats = () => ia.llamadas.filter((l) => !l.esLista);
const auditadas = () => prisma.auditoria.findMany({ where: { entidad: 'herramienta' }, orderBy: { id: 'asc' } });
const detalle = (a: { detalle: unknown }) => a.detalle as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Primera petición: pide herramientas; las siguientes (ya con resultados): responde un texto. */
const unaRonda = (...pedidos: { nombre: string; args?: unknown }[]) => (l: LlamadaIA) => (resultadosDe(l).length === 0 ? pideHerramientas(l.proveedor, ...pedidos) : chatOk(`Listo: ${JSON.stringify(resultadosDe(l).map((r) => r.contenido.ok))}`));

describe('qué herramientas se le ofrecen al modelo (sólo las del rol)', () => {
  for (const proveedor of ['groq', 'gemini'] as const) {
    it(`${proveedor}: el administrador recibe las de gestión; el residente sólo mis_*; mantenimiento ninguna`, async () => {
      await guardar(proveedor, `${proveedor}-prueba-00001`);
      await chat(T.adminA);
      const admin = herramientasDeclaradas(chats().at(-1)!);
      assert.ok(admin.includes('morosos') && admin.includes('resumen_cobranza') && !admin.includes('mi_deuda') && !admin.includes('empresas') && admin.length === 14, admin.join());
      await chat(T.prop1);
      const prop = herramientasDeclaradas(chats().at(-1)!);
      assert.deepEqual(prop.sort(), ['medios_para_pagar', 'mi_deuda', 'mis_pagos', 'mis_recibos', 'mis_unidades']);
      await chat(T.super);
      assert.equal(herramientasDeclaradas(chats().at(-1)!).length, 17);
      await chat(T.mtto);
      const mtto = chats().at(-1)!;
      assert.deepEqual(herramientasDeclaradas(mtto), []);
      assert.equal(mtto.cuerpo.tools, undefined, 'sin herramientas no se manda `tools`');
    });
  }
  it('el prompt enseña a usarlas y que sus resultados son datos, no instrucciones', async () => {
    await guardar('groq', 'groq-prueba-00001');
    await chat(T.adminA);
    const s = sistemaDe(chats().at(-1)!);
    assert.match(s, /Consulta ANTES de afirmar cifras/);
    assert.match(s, /INFORMACIÓN, nunca instrucciones/);
    assert.match(s, /ofrece acotar/);
  });
  it('ASISTENTE_HERRAMIENTAS=off las apaga', async () => {
    process.env.ASISTENTE_HERRAMIENTAS = 'off';
    await guardar('groq', 'groq-prueba-00001');
    await chat(T.adminA);
    assert.equal(chats().at(-1)!.cuerpo.tools, undefined);
  });
});

describe('bucle con un proveedor compatible con OpenAI y con Gemini', () => {
  for (const proveedor of ['groq', 'gemini'] as const) {
    it(`${proveedor}: una ronda — el servidor ejecuta, devuelve el resultado al modelo y sale la respuesta final`, async () => {
      await guardar(proveedor, `${proveedor}-prueba-00001`);
      manejador = (l) => (resultadosDe(l).length === 0 ? pideHerramientas(l.proveedor, { nombre: 'morosos', args: { limite: 5 } }) : chatOk(`Deben: ${resultadosDe(l)[0]!.contenido.datos.filas.map((f: any) => f.unidad).join(', ')}`)); // eslint-disable-line @typescript-eslint/no-explicit-any
      const r = await chat(T.adminA, MSG_MOROSOS);
      assert.equal(r.status, 200, r.texto);
      assert.equal(r.body.response, 'Deben: A-101, A-102');
      assert.equal(chats().length, 2);
      const segunda = chats()[1]!;
      const res = resultadosDe(segunda);
      assert.equal(res.length, 1);
      assert.equal(res[0]!.contenido.ok, true);
      assert.equal(res[0]!.contenido.datos.moneda, 'PEN');
      assert.match(res[0]!.contenido.datos.aviso, /NO CONFIABLES/);
      if (proveedor === 'gemini') {
        // El mensaje del modelo se devuelve tal cual y los resultados van en un mensaje de usuario con `functionResponse`.
        const c = segunda.cuerpo.contents;
        assert.deepEqual(c.at(-2).parts[0].functionCall.name, 'morosos');
        assert.equal(c.at(-1).role, 'user');
        assert.ok(!JSON.stringify(c).includes('additionalProperties'));
      } else {
        const m = segunda.cuerpo.messages;
        assert.equal(m.at(-2).role, 'assistant');
        assert.equal(m.at(-2).tool_calls[0].function.name, 'morosos');
        assert.deepEqual([m.at(-1).role, m.at(-1).tool_call_id], ['tool', 'call_0']);
      }
      // Auditoría y métricas del turno: nombre y tiempo, sin argumentos.
      const a = await esperar(async () => { const f = await auditadas(); return f.length ? f : null; });
      assert.deepEqual([detalle(a[0]!).herramienta, detalle(a[0]!).origen, detalle(a[0]!).estado, a[0]!.usuario_id], ['morosos', 'asistente', 'ok', D.adminA.id]);
      const msg = await prisma.mensajeIA.findFirstOrThrow({ where: { rol: 'assistant' }, orderBy: { id: 'desc' } });
      const usadas = msg.herramientas as { nombre: string; ms: number; estado: string }[];
      assert.deepEqual(usadas.map((u) => [u.nombre, u.estado]), [['morosos', 'ok']]);
      assert.equal(typeof usadas[0]!.ms, 'number');
      assert.ok(!JSON.stringify(msg.herramientas).includes('limite'), 'las métricas no guardan argumentos');
      assert.equal(msg.tokens_entrada, 20 + 11, 'los tokens suman las rondas');
    });
  }

  it('varias rondas encadenadas (compatible): se ejecutan en orden y el residente sólo ve lo suyo', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = (l) => {
      const n = resultadosDe(l).length;
      if (n === 0) return pideHerramientas(l.proveedor, { nombre: 'mi_deuda' });
      if (n === 1) return pideHerramientas(l.proveedor, { nombre: 'mis_recibos', args: { estado: 'vencido' } });
      return chatOk(`Debes ${resultadosDe(l)[0]!.contenido.datos.deuda_total}`);
    };
    const r = await chat(T.prop1, '¿Cuánto debo y cuáles son mis recibos vencidos?');
    assert.equal(r.body.response, 'Debes 383.50');
    assert.equal(chats().length, 3);
    const todo = JSON.stringify(chats().map((c) => c.cuerpo));
    assert.ok(!todo.includes('A-102') && !todo.includes('B-101'), 'nada de otra unidad llegó al modelo');
  });

  it('tope de rondas: tras 4 rondas se le exige contestar con texto (tool_choice none / mode NONE)', async () => {
    for (const proveedor of ['groq', 'gemini'] as const) {
      await prisma.claveIntegracion.deleteMany();
      ia.llamadas.length = 0;
      limpiarTodo();
      await guardar(proveedor, `${proveedor}-prueba-00001`);
      let n = 0;
      manejador = (l) => (fuerzaTexto(l) ? chatOk('Con lo que tengo') : pideHerramientas(l.proveedor, { nombre: 'resumen_cobranza', args: { periodo: `2026-0${(n++ % 9) + 1}` } }));
      const r = await chat(T.adminA, '¿Cómo vamos con la cobranza mes por mes?');
      assert.equal(r.body.response, 'Con lo que tengo', proveedor);
      assert.equal(chats().length, MAX_RONDAS + 1, proveedor);
      assert.equal(fuerzaTexto(chats().at(-1)!), true);
      assert.ok(chats().slice(0, -1).every((c) => !fuerzaTexto(c)));
    }
  });

  it(`tope de ${MAX_CONSULTAS} consultas por turno: las demás reciben un error y no se ejecutan ni se auditan`, async () => {
    await guardar('groq', 'groq-prueba-00001');
    const pedidos = Array.from({ length: 9 }, (_, i) => ({ nombre: 'resumen_cobranza', args: { periodo: `2026-0${i + 1}` } }));
    manejador = unaRonda(...pedidos);
    const r = await chat(T.adminA, '¿Cobranza de cada mes?');
    assert.equal(r.status, 200);
    const res = resultadosDe(chats()[1]!);
    assert.equal(res.length, 9);
    assert.equal(res.filter((x) => x.contenido.ok).length, MAX_CONSULTAS);
    assert.match(res.at(-1)!.contenido.error, /consultas en este turno/);
    const a = await esperar(async () => { const f = await auditadas(); return f.length >= MAX_CONSULTAS ? f : null; });
    assert.equal(a.length, MAX_CONSULTAS);
  });

  it('una herramienta inventada o de otro rol se rechaza SIN datos y el turno sigue', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = unaRonda({ nombre: 'borrar_usuarios', args: { id: 1 } }, { nombre: 'morosos' }, { nombre: 'empresas' }, { nombre: 'mis_pagos' });
    const r = await chat(T.prop2, '¿Quiénes deben en el condominio? Usa morosos y empresas.');
    assert.equal(r.status, 200);
    const res = resultadosDe(chats()[1]!);
    assert.deepEqual(res.slice(0, 3).map((x) => x.contenido.ok), [false, false, false]);
    assert.equal(res[3]!.contenido.ok, true, 'la suya sí');
    const texto = JSON.stringify(res);
    assert.ok(!texto.includes('A-101') && !texto.includes('B-101') && !texto.includes('Empresa'), texto.slice(0, 300));
    const a = await esperar(async () => { const f = await auditadas(); return f.length >= 4 ? f : null; });
    assert.deepEqual(a.map((x) => detalle(x).estado), ['desconocida', 'sin_permiso', 'sin_permiso', 'ok']);
  });

  it('argumentos inválidos (campo de más, límite pasado de 50): error claro para el modelo y nada ejecutado', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = unaRonda({ nombre: 'morosos', args: { limite: 500 } }, { nombre: 'pagos', args: { sql: 'select * from "Usuario"' } });
    await chat(T.adminA, MSG_MOROSOS);
    const res = resultadosDe(chats()[1]!);
    assert.deepEqual(res.map((x) => x.contenido.ok), [false, false]);
    assert.match(res[0]!.contenido.error, /Argumentos inválidos/);
  });

  it('el mantenimiento no tiene herramientas: si el modelo igual las pide, no recibe nada', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = unaRonda({ nombre: 'morosos' });
    await chat(T.mtto, MSG_MOROSOS);
    const res = resultadosDe(chats().at(-1)!);
    assert.ok(res.length === 0 || res.every((x) => x.contenido.ok === false));
    assert.ok(!JSON.stringify(chats().map((c) => c.cuerpo)).includes('A-101'));
  });

  it('texto hostil en la base: llega al modelo como dato (una línea, sin etiquetas) junto con el aviso, y el prompt no cambia', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = unaRonda({ nombre: 'cargos', args: { unidad: 'A-101', limite: 50 } });
    await chat(T.adminA, 'Muéstrame los cargos de A-101');
    const res = resultadosDe(chats()[1]!)[0]!.contenido;
    const concepto = res.datos.filas.map((f: any) => f.concepto).find((c: string) => /Ignora/.test(c)); // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.ok(concepto && !/[\n<>`]/.test(concepto));
    assert.match(res.datos.aviso, /DATOS NO CONFIABLES/);
    assert.equal(sistemaDe(chats()[0]!), sistemaDe(chats()[1]!), 'el sistema no cambia con los resultados');
  });

  it('el tiempo del turno es acotado: pasado el tope se exige texto aunque no se llegara a 4 rondas', async () => {
    await guardar('groq', 'groq-prueba-00001');
    reloj = Date.now();
    manejador = (l) => {
      if (fuerzaTexto(l)) return chatOk('Con el tiempo que había');
      reloj = reloj! + 60_000; // la consulta «tarda» un minuto
      return pideHerramientas(l.proveedor, { nombre: 'resumen_cobranza' });
    };
    const r = await chat(T.adminA, '¿Cobranza?');
    assert.equal(r.body.response, 'Con el tiempo que había');
    assert.equal(chats().length, 2);
    assert.equal(fuerzaTexto(chats()[1]!), true);
  });
});

describe('streaming y eventos', () => {
  it('SSE: «herramienta» ejecutando → listo antes del texto; el texto final llega como delta y luego done', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = (l) => (resultadosDe(l).length === 0 ? flujoSoloLlamada(l.proveedor, { nombre: 'resumen_cobranza' }) : flujoSse(l.proveedor, 'Van ', 'bien.'));
    const r = await stream(T.adminA, '¿Cómo vamos con la cobranza?');
    assert.equal(r.status, 200);
    const nombres = r.eventos.map((e) => e.evento);
    assert.deepEqual(nombres.filter((n) => n === 'herramienta'), ['herramienta', 'herramienta']);
    assert.deepEqual(r.eventos.filter((e) => e.evento === 'herramienta').map((e) => e.datos), [{ nombre: 'resumen_cobranza', estado: 'ejecutando' }, { nombre: 'resumen_cobranza', estado: 'listo' }]);
    const iFin = nombres.indexOf('done');
    assert.ok(nombres.indexOf('herramienta') < nombres.indexOf('delta') && nombres.lastIndexOf('herramienta') < nombres.indexOf('delta'));
    assert.ok(iFin > nombres.lastIndexOf('delta'));
    assert.equal(r.eventos.filter((e) => e.evento === 'delta').map((e) => e.datos.texto).join(''), 'Van bien.');
  });
  it('sin herramientas en juego el texto sigue saliendo token a token', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = (l) => flujoSse(l.proveedor, 'Uno ', 'dos ', 'tres');
    const r = await stream(T.prop1, '¿Cómo pago mis recibos?');
    assert.deepEqual(r.eventos.filter((e) => e.evento === 'delta').map((e) => e.datos.texto), ['Uno ', 'dos ', 'tres']);
    assert.equal(r.eventos.filter((e) => e.evento === 'herramienta').length, 0);
  });
  for (const proveedor of ['groq', 'gemini'] as const) {
    it(`${proveedor}: si el modelo escribe texto Y luego pide una herramienta, lo ya dicho se conserva y la respuesta se completa`, async () => {
      await guardar(proveedor, `${proveedor}-prueba-00001`);
      manejador = (l) => (resultadosDe(l).length === 0 ? flujoTextoYLlamada(l.proveedor, 'Déjame revisar. ', { nombre: 'mi_deuda' }) : chatOk('Debes S/ 383.50.'));
      const r = await stream(T.prop1, '¿Cuánto debo?');
      const texto = r.eventos.filter((e) => e.evento === 'delta').map((e) => e.datos.texto).join('');
      assert.match(texto, /^Déjame revisar\./);
      assert.match(texto, /Debes S\/ 383\.50\.$/);
      assert.deepEqual(r.eventos.filter((e) => e.evento === 'herramienta').map((e) => e.datos.estado), ['ejecutando', 'listo']);
      assert.equal(r.eventos.at(-1)!.evento, 'done');
    });
  }
});

describe('rutas que no admiten herramientas', () => {
  const rechazo = () => estado(400, {}, '{"error":{"message":"tools are not supported for this model"}}');

  it('un 400 «tools not supported»: la ruta queda marcada (el modelo NO se retira), se responde con DATOS VERIFICADOS y la siguiente consulta ni lo intenta', async () => {
    const k = await guardar('groq', 'groq-prueba-00001');
    manejador = (l) => (l.cuerpo.tools ? rechazo() : chatOk('Deben A-101 y A-102.'));
    const r = await chat(T.adminA, MSG_MOROSOS);
    assert.equal(r.status, 200, r.texto);
    assert.equal(r.body.response, 'Deben A-101 y A-102.');
    const [primera, segunda] = chats();
    assert.ok(primera!.cuerpo.tools && !segunda!.cuerpo.tools);
    const sistema = sistemaDe(segunda!);
    assert.match(sistema, /DATOS VERIFICADOS \(consulta en vivo\)/);
    assert.match(sistema, /«morosos»/);
    assert.match(sistema, /A-101/);
    assert.ok(!/B-101|Empresa B/.test(sistema));
    assert.equal(sinHerramientas('groq', primera!.modelo!), true);
    assert.equal((await prisma.claveIntegracion.findUniqueOrThrow({ where: { id: k.id } })).estado, 'sin_probar', 'no se rechaza ni enfría la clave');
    assert.ok(!(await prisma.modeloIA.count({ where: { estado: 'deprecado' } })));
    ia.llamadas.length = 0;
    const r2 = await chat(T.adminA, MSG_MOROSOS);
    assert.equal(r2.status, 200);
    assert.equal(chats().length, 1, 'sin repetir la llamada fallida');
    assert.ok(!chats()[0]!.cuerpo.tools);
    assert.match(sistemaDe(chats()[0]!), /DATOS VERIFICADOS \(consulta en vivo\)/);
  });
  it('el respaldo sólo consulta lo que el rol tiene: un residente que pregunta por morosos no recibe datos de gestión', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = (l) => (l.cuerpo.tools ? rechazo() : chatOk('ok'));
    await chat(T.prop2, '¿Quiénes son los morosos y cuánto debo yo?');
    const sistema = sistemaDe(chats().at(-1)!);
    assert.match(sistema, /«mi_deuda»/);
    assert.ok(!/«morosos»|A-101|B-101/.test(sistema));
    const a = await esperar(async () => { const f = await auditadas(); return f.length ? f : null; });
    assert.ok(a.every((x) => ['mi_deuda'].includes(detalle(x).herramienta)));
  });
  it('un modelo conocido por no llamar herramientas (Gemma) va directo al respaldo, sin probar tools', async () => {
    const k = await guardar('openrouter', 'openrouter-prueba-001');
    await prisma.claveIntegracion.update({ where: { id: k.id }, data: { modelo: 'google/gemma-4-31b-it:free' } });
    await chat(T.adminA, MSG_MOROSOS);
    assert.equal(chats().length, 1);
    assert.ok(!chats()[0]!.cuerpo.tools);
    assert.match(sistemaDe(chats()[0]!), /DATOS VERIFICADOS \(consulta en vivo\)/);
  });
  it('los 400 que no hablan de herramientas NO marcan la ruta (sigue la rotación de siempre)', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = () => estado(400);
    await chat(T.adminA);
    assert.equal(sinHerramientas('groq', 'openai/gpt-oss-120b'), false);
  });
  it('contingencia (ninguna ruta responde): la respuesta armada por código incluye los datos que pidió el mensaje, con su alcance', async () => {
    await guardar('groq', 'groq-prueba-00001');
    manejador = () => estado(500);
    const r = await chat(T.adminA, MSG_MOROSOS);
    assert.equal(r.body.modo, 'contingencia');
    assert.match(r.body.response, /Lo que pediste/);
    assert.match(r.body.response, /A-101/);
    assert.ok(!/B-101|Empresa B/.test(r.body.response));
    const prop = await chat(T.prop2, MSG_MOROSOS);
    assert.ok(!/A-101|B-101/.test(prop.body.response));
    const msg = await prisma.mensajeIA.findFirstOrThrow({ where: { modo: 'contingencia' }, orderBy: { id: 'asc' } });
    assert.ok((msg.herramientas as { nombre: string }[]).some((h) => h.nombre === 'morosos'));
  });
});

describe('enrutador determinista', () => {
  it('elige 1–2 herramientas por palabras clave, sólo las del rol, con argumentos por defecto seguros', async () => {
    const adm = await usuarioDe(D.adminA.id);
    const res = await usuarioDe(D.propietario1.id);
    const mtto = await usuarioDe(D.mantenimientoA.id);
    const sup = await usuarioDe(D.superadmin.id);
    const n = (u: typeof adm, m: string) => elegirHerramientas(u, m).map((e) => e.nombre);
    assert.deepEqual(n(adm, '¿Quiénes son los morosos?'), ['morosos']);
    assert.deepEqual(n(adm, '¿Cómo vamos con la cobranza y quiénes deben?'), ['morosos', 'resumen_cobranza']);
    assert.deepEqual(n(adm, '¿Qué pagos hay por validar?'), ['pagos_por_validar']);
    assert.deepEqual(n(adm, 'Cómo está la A-101'), ['detalle_unidad']);
    assert.equal(elegirHerramientas(adm, 'Cómo está la A-101')[0]!.entrada.codigo, 'A-101');
    assert.deepEqual(n(res, '¿Cuánto debo?'), ['mi_deuda']);
    assert.deepEqual(n(res, '¿Dónde pago? Mis recibos vencidos'), ['mis_recibos', 'medios_para_pagar']);
    assert.deepEqual(n(res, 'quiénes son los morosos'), [], 'el residente no tiene morosos');
    assert.deepEqual(n(mtto, '¿Quiénes deben? ¿Cuánto debo?'), []);
    assert.deepEqual(n(sup, '¿Por qué el asistente está lento?'), ['salud_de_la_ia']);
    assert.deepEqual(n(adm, '¿Por qué el asistente está lento?'), [], 'salud de la IA es de plataforma');
    assert.deepEqual(n(adm, 'hola, ¿cómo estás?'), []);
    for (const u of [adm, res, sup]) assert.ok(elegirHerramientas(u, 'morosos cobranza pagos recibos deuda unidades mantenimiento avisos').length <= 2);
  });
});
