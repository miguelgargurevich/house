// La torre en las pantallas y los nombres de mes. El repo no pinta componentes: la lógica pura se prueba importándola y las pantallas con
// pruebas de fuente (lo que cada una pide a la API y lo que muestra).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { MESES, nombreDelMes, periodo, tituloRecibo } from '../src/ui/format';
import { MESES as MESES_SERVIDOR, descripcionRecibo, nombreMes, periodoTexto } from '../src/server/lib/periodo';
import { resumenSubida } from '../src/pages/admin/_parts/cobranza/resumenExcel';
import { etiquetaRecibo, nombreMes as nombreMesEmitir } from '../src/pages/admin/_parts/cobranza/comun';
import { etiquetaTorre, hayVariosCondominios, nombreTorre } from '../src/pages/admin/_parts/cobranza/torres';
import { leerCabecera, mesNumero } from '../src/server/lib/excelRecibos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const ADMIN = 'src/pages/admin/';
const COB = 'src/pages/admin/_parts/cobranza/';
const RES = 'src/pages/residente/_parts/';

describe('nombres de mes: una sola ayuda por lado y en el Perú se dice «setiembre»', () => {
  it('servidor y frontend tienen la MISMA lista de meses', () => {
    assert.deepEqual([...MESES], [...MESES_SERVIDOR]);
    assert.equal(MESES[8], 'setiembre');
  });

  it('el servidor: periodoTexto, nombreMes y la descripción del recibo (con y sin torre)', () => {
    assert.equal(nombreMes(9), 'setiembre');
    assert.equal(periodoTexto(10, 2026), 'octubre de 2026');
    assert.equal(descripcionRecibo(10, 2026), 'Mantenimiento de octubre de 2026');
    assert.equal(descripcionRecibo(9, 2026, 'Block 1'), 'Mantenimiento de setiembre de 2026 · Block 1');
    assert.equal(nombreMes(13), '13', 'un mes fuera de rango sale como número, no como «undefined»');
  });

  it('el frontend: periodo() y tituloRecibo() usan «setiembre» en los 12 meses', () => {
    assert.equal(periodo(9, 2026), 'Setiembre de 2026');
    assert.equal(periodo(10, 2026), 'Octubre de 2026');
    assert.equal(nombreDelMes(9), 'setiembre');
    assert.equal(tituloRecibo(10, 2026), 'Mantenimiento de octubre de 2026');
    assert.equal(tituloRecibo(10, 2026, 'Block 1'), 'Mantenimiento de octubre de 2026 · Block 1');
    assert.equal(tituloRecibo(9, 2026, 'Block 2'), 'Mantenimiento de setiembre de 2026 · Block 2');
    assert.ok(!MESES.some((m) => /septiembre/.test(m)));
    for (let m = 1; m <= 12; m++) assert.ok(!/septiembre/i.test(periodo(m, 2026)));
  });

  it('el selector de mes de «Emitir recibo» sale de la misma ayuda (Setiembre, no Septiembre)', () => {
    assert.equal(nombreMesEmitir(9), 'Setiembre');
    assert.equal(nombreMesEmitir(1), 'Enero');
    const emitir = f(`${COB}EmitirReciboModal.tsx`);
    assert.match(emitir, /nombreMes\(m\)/);
  });

  it('no queda ninguna lista de meses copiada en el frontend ni en el servidor (salvo las dos ayudas y el alias del lector)', () => {
    for (const ruta of ['src/pages/admin/_parts/cobranza/resumenExcel.ts', 'src/pages/admin/_parts/cobranza/comun.ts', 'src/server/routes/recibos.ts', 'src/server/lib/mantenimientos.ts', 'src/server/services/avisos/plantillas.ts', 'src/server/tools/base.ts']) {
      assert.doesNotMatch(f(ruta), /'enero',\s*'febrero'|'Enero',\s*'Febrero'/i, ruta);
    }
    assert.doesNotMatch(f('src/ui/format.ts'), /Intl\.DateTimeFormat\('es-PE', \{ month: 'long'/, 'periodo() ya no depende del ICU del navegador (que dice septiembre)');
  });

  it('el lector del Excel sigue aceptando «septiembre» y «setiembre»', () => {
    assert.equal(mesNumero('septiembre'), 9);
    assert.equal(mesNumero('Setiembre'), 9);
    assert.deepEqual(leerCabecera([[null, 'MES: Septiembre 2026']]).mes, 9);
    assert.deepEqual(leerCabecera([[null, 'MES: Setiembre 2026']]).mes, 9);
    assert.equal(leerCabecera([[null, 'MES', 'Setiembre'], ['LIBERTADORES SETIEMBRE 2026']]).anio, 2026, 'el año del título también con «setiembre»');
    assert.equal(leerCabecera([[null, 'MES: Septiembre'], ['LIBERTADORES SEPTIEMBRE 2026']]).anio, 2026);
  });
});

describe('la torre: ayudas puras', () => {
  it('nombreTorre y etiquetaTorre (con varios condominios, «Block 1» se rotula con su condominio)', () => {
    assert.equal(nombreTorre({ id: 4, nombre: 'Block 1' }), 'Block 1');
    assert.equal(nombreTorre({ id: 4, nombre: null }), 'Torre 4');
    const a = { id: 1, nombre: 'Block 1', complejo: { id: 10, nombre: 'Libertadores' } };
    const b = { id: 2, nombre: 'Block 1', complejo: { id: 11, nombre: 'Surco' } };
    assert.equal(hayVariosCondominios([a, b]), true);
    assert.equal(hayVariosCondominios([a]), false);
    assert.equal(etiquetaTorre(a, true), 'Block 1 · Libertadores');
    assert.equal(etiquetaTorre(a, false), 'Block 1');
  });

  it('etiquetaRecibo: cada torre tiene su opción (no N opciones iguales)', () => {
    const base = { mes: 10, anio: 2026, complejo: { id: 1, nombre: 'Libertadores' } };
    const a = etiquetaRecibo({ ...base, estructura: { id: 1, nombre: 'Block 1' } });
    const b = etiquetaRecibo({ ...base, estructura: { id: 2, nombre: 'Block 2' } });
    assert.equal(a, 'Octubre de 2026 · Block 1 · Libertadores');
    assert.notEqual(a, b);
    assert.equal(etiquetaRecibo({ ...base, estructura: null }), 'Octubre de 2026 · Libertadores');
  });

  it('resumenSubida: un renglón por torre y el título dice «uno por torre»', () => {
    const r = resumenSubida({
      recibo_id: 1, mes: 9, anio: 2026, unidades_procesadas: 64, filas_saltadas: 0, conceptos: 5,
      recibos: [
        { recibo_id: 1, estructura_id: 1, torre: 'Block 1', accion: 'creado', unidades_procesadas: 32 },
        { recibo_id: 2, estructura_id: 2, torre: 'Block 2', accion: 'reemplazado', unidades_procesadas: 32 },
      ],
    });
    assert.equal(r.titulo, 'Recibos de setiembre de 2026 cargados: uno por torre');
    assert.deepEqual(r.torres, ['Block 1: creado (32 departamentos)', 'Block 2: reemplazado (32 departamentos)']);
    const uno = resumenSubida({ recibo_id: 1, mes: 10, anio: 2026, unidades_procesadas: 1, filas_saltadas: 0, conceptos: 1, recibos: [{ recibo_id: 1, estructura_id: 1, torre: 'Block 1', accion: 'creado', unidades_procesadas: 1 }] });
    assert.equal(uno.titulo, 'Recibo de octubre de 2026 · Block 1 cargado');
    assert.deepEqual(uno.torres, ['Block 1: creado (1 departamento)']);
  });
});

describe('pantallas: la torre se ve y se filtra', () => {
  it('Recibos: columna Torre, filtro por torre y por condominio, y «Todo el condominio» para el recibo sin torre', () => {
    const s = f(`${ADMIN}Recibos.tsx`);
    assert.match(s, /key: 'torre', header: 'Torre'/);
    assert.match(s, /estructura_id: torre \|\| undefined/);
    assert.match(s, /SelectoresUbicacion/);
    assert.match(s, /Todo el condominio/);
    assert.match(f(`${COB}SelectoresUbicacion.tsx`), /Todas las torres/);
  });

  it('Emitir recibo: elige torre o «todas» (un recibo por torre) y manda estructura_id sólo si eligió una', () => {
    const s = f(`${COB}EmitirReciboModal.tsx`);
    assert.match(s, /Todas las torres \(un recibo por torre\)/);
    assert.match(s, /estructura_id: Number\(v\.estructura_id\)/);
    assert.match(s, /Se emitirá un recibo por cada torre/);
    assert.doesNotMatch(s, /Se generará un cargo por cada unidad activa del condominio\.<\/Alert>/, 'el texto único «para todo el condominio» ya no es el único');
  });

  it('Subir Excel: dice que cada torre del archivo crea o reemplaza SU recibo y muestra el resultado por torre', () => {
    const s = f(`${COB}SubirExcelModal.tsx`);
    assert.match(s, /Cada torre del archivo \(columna BLOCK\) crea o reemplaza SU recibo/);
    assert.match(s, /resumen\.torres/);
  });

  it('Periodo: el título lleva la torre y un recibo de torre va directo a sus departamentos (sin selector ni vista agrupada)', () => {
    const s = f(`${ADMIN}PeriodoRecibo.tsx`);
    assert.match(s, /tituloRecibo\(p\.mes, p\.anio, p\.estructura/);
    assert.match(s, /const deTorre = Boolean\(p\?\.estructura\)/);
    assert.match(s, /const agrupado = !deTorre && \(bloques\.data\?\.agrupado \?\? false\)/);
    assert.match(s, /\{agrupado && \(\s*<Select label="Torre"/);
    assert.match(s, /BloquesPeriodo/, 'un recibo viejo que mezcla torres sigue agrupado');
  });

  it('Pagos: columna Torre/Condominio, filtros por condominio y torre, y avisa si la suma junta varias torres', () => {
    const s = f(`${ADMIN}Pagos.tsx`);
    assert.match(s, /key: 'torre', header: 'Torre'/);
    assert.match(s, /complejo_id: complejo \|\| undefined, estructura_id: torre \|\| undefined/);
    assert.match(s, /SelectoresUbicacion[^>]*oculto=\{junta\}/, 'la junta no lista torres (sólo ve la suya)');
    assert.match(s, /Suma \$\{torresEnPagina\} torres/);
  });

  it('Validar pago: muestra el departamento con su torre y el condominio', () => {
    const s = f(`${COB}ValidarPagoModal.tsx`);
    assert.match(s, /label: 'Departamento'/);
    assert.match(s, /label: 'Condominio'/);
    assert.match(s, /estructura\?\.nombre/);
  });

  it('Registrar pago: el periodo se rotula con la torre y cada departamento muestra la suya', () => {
    const s = f(`${COB}RegistrarPagoModal.tsx`);
    assert.match(s, /etiquetaRecibo\(r\)/);
    assert.match(s, /m\.unidad\.estructura\?\.nombre/);
  });

  it('Recibo imprimible: la cabecera lleva la torre y «Dónde pagar» separa las cuentas del block y las del condominio', () => {
    const s = f('src/pages/shared/mantenimiento/ReciboImprimible.tsx');
    assert.match(s, /Recibo de mantenimiento\{block \? ` · \$\{block\}` : ''\}/);
    assert.match(s, /m\.ambito === 'block'/);
    assert.match(s, /Cuentas de \$\{block\}/);
    assert.match(s, /Cuentas del condominio/);
  });

  it('Morosidad: filtro de condominio con sus torres, columna Condominio, CSV con Condominio y cifras de todo el filtro', () => {
    const s = f(`${ADMIN}Morosidad.tsx`);
    assert.match(s, /SelectoresUbicacion/);
    assert.match(s, /complejo_id: complejo \|\| undefined/);
    assert.match(s, /key: 'complejo', header: 'Condominio'/);
    assert.match(s, /\['Unidad', 'Condominio', 'Torre'/);
    assert.match(s, /cifras\.data/);
  });

  it('Panel: filtra por condominio/torre, desglosa por torre y los meses salen de la ayuda única', () => {
    const s = f(`${ADMIN}Dashboard.tsx`);
    assert.match(s, /por_torre/);
    assert.match(s, /SelectoresUbicacion/);
    assert.match(s, /nombreDelMes\(/);
    assert.doesNotMatch(s, /Intl\.DateTimeFormat\('es-PE', \{ month: 'short'/);
  });

  it('Avisos: filtro por torre y de qué recibo/torre trata cada aviso', () => {
    const s = f(`${ADMIN}Avisos.tsx`);
    assert.match(s, /estructura_id: torre \|\| undefined/);
    assert.match(s, /key: 'recibo', header: 'Recibo'/);
    assert.match(s, /a\.contexto\?\.unidad\?\.torre \?\? r\.torre/);
  });

  it('Residente: el block va junto al código de la unidad en recibos, pagos, inicio, cómo pagar y mis unidades', () => {
    assert.match(f(`${RES}MantenimientoItem.tsx`), /mant\.unidad\.estructura\?\.nombre/);
    assert.match(f(`${RES}CargosResidente.tsx`), /m\.unidad\.estructura\?\.nombre/);
    assert.match(f(`${RES}PagosResidente.tsx`), /p\.unidad\.estructura\?\.nombre/);
    assert.match(f(`${RES}InicioResidente.tsx`), /proximo_mantenimiento\.torre/);
    assert.match(f(`${RES}ComoPagar.tsx`), /mant\.unidad\.estructura\?\.nombre/);
    assert.match(f(`${RES}PagarModal.tsx`), /mant\.unidad\.estructura\?\.nombre/);
    assert.match(f(`${RES}UnidadesResidente.tsx`), /u\.estructura\?\.nombre/);
  });
});
