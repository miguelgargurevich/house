// «Tu marca» en pantalla: el repo no monta React en el navegador aquí. La lógica va en funciones puras (`vista.ts`, `cabeceraDocumento.ts`, `src/lib/marca.ts`), los
// componentes que no dependen de la sesión se renderizan de verdad (react-dom/server) y el cableado de la app se fija leyendo la fuente. NO se vio en un navegador.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { before, describe, it } from 'node:test';
import { MARCA_TORRE, VERDE_TORRE_HEX, cssDeMarca, inicialDeMarca, paletaDeMarca, type MarcaUsuario } from '../src/lib/marca';
import { AVISO_AJUSTADO, colorDelSelector, colorParaGuardar, cuerpoDeMarca, errorDeColor, formDeEmpresa, hayCambios, normalizarHex, paletaDeForm } from '../src/pages/admin/_parts/marca/vista';
import { cabeceraDeDocumento, cabeceraSoloConMarca } from '../src/pages/shared/mantenimiento/cabeceraDocumento';
import type { DetalleMantenimiento } from '../src/pages/shared/mantenimiento/tipos';
import type { EstadoCuenta } from '../src/pages/shared/estado-cuenta/tipos';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

const MARCA_A: MarcaUsuario = { empresa_id: 1, razon_social: 'GRUPO PRUEBA SAC', nombre: 'Torres del Sol', logo_url: '/api/empresas/1/logo?v=5', color: '#0057b8', activa: true };
const MARCA_B_SIN_PLAN: MarcaUsuario = { empresa_id: 2, razon_social: 'OTRA SAC', nombre: 'OTRA SAC', logo_url: null, color: null, activa: false };

let Ctx: typeof import('../src/app/marca/contexto').MarcaContext;
let ReciboArticulo: typeof import('../src/pages/shared/mantenimiento/ReciboImprimible').ReciboArticulo;
let EstadoCuentaHoja: typeof import('../src/pages/shared/estado-cuenta/EstadoCuentaHoja').EstadoCuentaHoja;
let VistaPrevia: typeof import('../src/pages/admin/_parts/marca/VistaPrevia').VistaPrevia;
before(async () => {
  (globalThis as { React?: unknown }).React = React;
  ({ MarcaContext: Ctx } = await import('../src/app/marca/contexto'));
  ({ ReciboArticulo } = await import('../src/pages/shared/mantenimiento/ReciboImprimible'));
  ({ EstadoCuentaHoja } = await import('../src/pages/shared/estado-cuenta/EstadoCuentaHoja'));
  ({ VistaPrevia } = await import('../src/pages/admin/_parts/marca/VistaPrevia'));
});

describe('formulario «Tu marca»', () => {
  it('el color se acepta con o sin «#», en 3 o 6 dígitos, y se guarda en minúsculas; lo demás es un error', () => {
    assert.equal(normalizarHex('#0057B8'), '#0057b8');
    assert.equal(normalizarHex('0057b8'), '#0057b8');
    assert.equal(normalizarHex(' #0AF '), '#00aaff');
    for (const malo of ['', 'azul', '#12', '#12345', '#1234567', '#ggg', 'rgb(0,0,0)']) assert.equal(normalizarHex(malo), null, malo);
    assert.equal(errorDeColor(''), null, 'vacío es válido: verde de Torre');
    assert.equal(errorDeColor('#0057b8'), null);
    assert.match(errorDeColor('azul')!, /color como #007565/);
  });

  it('el selector nativo muestra el color escrito o, si no hay, el verde de Torre', () => {
    assert.equal(colorDelSelector(''), VERDE_TORRE_HEX);
    assert.equal(colorDelSelector('zzz'), VERDE_TORRE_HEX);
    assert.equal(colorDelSelector('0057B8'), '#0057b8');
  });

  it('el verde de Torre y el campo vacío se guardan como «sin color» (null)', () => {
    assert.equal(colorParaGuardar(''), null);
    assert.equal(colorParaGuardar('#007565'), null);
    assert.equal(colorParaGuardar('007565'), null);
    assert.equal(colorParaGuardar('#0057B8'), '#0057b8');
    assert.deepEqual(cuerpoDeMarca({ nombre: '  Torres del Sol  ', color: '#0057B8' }), { nombre_comercial: 'Torres del Sol', color_marca: '#0057b8' });
    assert.deepEqual(cuerpoDeMarca({ nombre: '   ', color: '' }), { nombre_comercial: null, color_marca: null });
  });

  it('«Guardar» sólo se habilita con cambios reales', () => {
    const e = { nombre_comercial: 'Torres del Sol', color_marca: '#0057b8' };
    assert.equal(hayCambios(formDeEmpresa(e), e), false);
    assert.equal(hayCambios({ nombre: 'Torres del Sol', color: '0057B8' }, e), false, 'mayúsculas y sin # es lo mismo');
    assert.equal(hayCambios({ nombre: 'Otro', color: '#0057b8' }, e), true);
    assert.equal(hayCambios({ nombre: 'Torres del Sol', color: '' }, e), true, '«Volver al verde de Torre» es un cambio');
    assert.equal(hayCambios({ nombre: '', color: '' }, { nombre_comercial: null, color_marca: null }), false);
  });

  it('la vista previa usa la paleta del color escrito; vacío o inválido, la del verde de Torre; un color claro avisa que se oscureció', () => {
    assert.equal(paletaDeForm('').claro.brand, '0.5 0.1 180');
    assert.equal(paletaDeForm('azul').claro.brand, '0.5 0.1 180');
    assert.equal(paletaDeForm('#0057b8').ajustado, false);
    const claro = paletaDeForm('#ffff00');
    assert.equal(claro.ajustado, true);
    assert.equal(AVISO_AJUSTADO, 'Lo oscurecimos un poco para que el texto se lea.');
  });
});

describe('hoja de estilos de la marca', () => {
  it('lleva los 5 tokens en claro (html:root) y en oscuro (html.dark), con el formato de index.css', () => {
    const { css } = cssDeMarca('#0057b8');
    assert.match(css, /^html:root\{--brand:[\d. ]+;--brand-hover:[\d. ]+;--brand-soft:[\d. ]+;--on-brand:[\d. ]+;--escena:[\d. ]+\}html\.dark\{--brand:/);
    const p = paletaDeMarca('#0057b8');
    assert.ok(css.includes(`--brand:${p.claro.brand}`) && css.includes(`--brand:${p.oscuro.brand}`));
    assert.ok(css.indexOf('html:root') < css.indexOf('html.dark'), 'el oscuro va después: en modo oscuro gana');
  });

  it('inicial del nombre para cuando no hay logo', () => {
    assert.equal(inicialDeMarca('torres del sol'), 'T');
    assert.equal(inicialDeMarca('  «Ñandú» SAC'), 'Ñ');
    assert.equal(inicialDeMarca('   '), 'T');
  });
});

describe('qué lleva la cabecera de un documento', () => {
  it('con la marca activa y la empresa del documento: nombre comercial, logo y color (ajustado) de la marca', () => {
    const c = cabeceraDeDocumento(MARCA_A, { empresaId: 1, razonSocial: 'GRUPO PRUEBA SAC', logoUrl: '/api/empresas/1/logo?v=5' });
    assert.deepEqual([c.nombre, c.logoUrl], ['Torres del Sol', '/api/empresas/1/logo?v=5']);
    assert.equal(c.color, paletaDeMarca('#0057b8').hex.claro.brand);
  });

  it('sin la marca activa: razón social y sin color', () => {
    const c = cabeceraDeDocumento({ ...MARCA_A, activa: false, color: null, nombre: 'GRUPO PRUEBA SAC' }, { empresaId: 1, razonSocial: 'GRUPO PRUEBA SAC' });
    assert.deepEqual([c.nombre, c.color], ['GRUPO PRUEBA SAC', null]);
  });

  it('el documento de OTRA empresa nunca lleva la marca del usuario (nombre ni color): razón social del documento', () => {
    const c = cabeceraDeDocumento(MARCA_A, { empresaId: 2, razonSocial: 'OTRA SAC', logoUrl: null });
    assert.deepEqual([c.nombre, c.logoUrl, c.color], ['OTRA SAC', null, null]);
    // Sin id (estado de cuenta): se compara la razón social.
    assert.deepEqual(cabeceraDeDocumento(MARCA_A, { razonSocial: 'OTRA SAC' }), { nombre: 'OTRA SAC', logoUrl: null, color: null });
    assert.equal(cabeceraDeDocumento(MARCA_A, { razonSocial: 'GRUPO PRUEBA SAC' }).nombre, 'Torres del Sol');
    // Torre (sin empresa) tampoco se mete.
    assert.equal(cabeceraDeDocumento(MARCA_TORRE, { empresaId: 1, razonSocial: 'GRUPO PRUEBA SAC' }).nombre, 'GRUPO PRUEBA SAC');
  });

  it('la rendición (sin dato de empresa) sólo lleva cabecera con la marca activa; con otra razón social, nada', () => {
    assert.deepEqual(cabeceraSoloConMarca(MARCA_TORRE), { nombre: null, logoUrl: null, color: null });
    assert.deepEqual(cabeceraSoloConMarca(MARCA_B_SIN_PLAN), { nombre: null, logoUrl: null, color: null });
    assert.equal(cabeceraSoloConMarca(MARCA_A).nombre, 'Torres del Sol');
    assert.equal(cabeceraSoloConMarca(MARCA_A, 'OTRA SAC').nombre, null);
    assert.equal(cabeceraSoloConMarca(MARCA_A, 'GRUPO PRUEBA SAC').nombre, 'Torres del Sol');
  });
});

/** Recibo mínimo con la empresa del documento. */
const recibo = (empresa: DetalleMantenimiento['empresa']): DetalleMantenimiento => ({
  recibo_id: 2, unidad_id: 1, numero: '2026-10-B01-804', titulo: 'Mantenimiento de octubre de 2026 · B01-804', mes: 10, anio: 2026, fecha_emision: '2026-10-27T00:00:00.000Z', fecha_vencimiento: '2026-11-02T00:00:00.000Z',
  fecha_corte_agua: null, estado: 'pendiente', moneda: 'PEN', total: '100.00', cobrado: '0.00', en_revision: '0.00', saldo: '100.00', deuda_acumulada: '0.00', total_general: '100.00', agua: null, correo_vouchers: null, linea_mora: null,
  condominio: { id: 1, nombre: 'CONDOMINIO PRUEBA', moneda: 'PEN', direccion: null, notas_pago: null, admin_nombre: null, admin_celular: null, admin_correo: null, cabecera_url: null }, empresa,
  unidad: { id: 1, codigo: 'B01-804', estructura: null }, propietario: { id: 1, nombre: 'ANA' }, inquilino: null, conceptos: [{ cargo_id: 1, concepto: 'CUOTA', es_recargo: false, monto: '100.00', cobrado: '0.00', en_revision: '0.00', saldo: '100.00', motivo: null }], medios_pago: [],
} as unknown as DetalleMantenimiento);
const EMPRESA_A = { id: 1, nombre: 'GRUPO PRUEBA SAC', ruc: '20000000001', direccion: null, telefono: null, email: null, logo_url: '/api/empresas/1/logo?v=5' };
const conMarca = (marca: MarcaUsuario | null, hijo: React.ReactElement) => renderToStaticMarkup(marca ? createElement(Ctx.Provider, { value: marca }, hijo) : hijo);

describe('recibo impreso con marca', () => {
  it('con la marca activa de SU empresa: nombre comercial arriba con franja del color, razón social y RUC al pie, «con Torre» al final', () => {
    const h = conMarca(MARCA_A, createElement(ReciboArticulo, { d: recibo(EMPRESA_A) }));
    assert.ok(h.includes('Torres del Sol'));
    assert.ok(h.includes(`background-color:${paletaDeMarca('#0057b8').hex.claro.brand}`), 'franja');
    assert.ok(h.includes('print-color-adjust:exact'), 'el color sale al imprimir');
    assert.ok(h.indexOf('Torres del Sol') < h.indexOf('CONDOMINIO PRUEBA'));
    assert.match(h, /GRUPO PRUEBA SAC<span[^>]*> · RUC 20000000001/);
    assert.ok(h.lastIndexOf('con Torre') > h.lastIndexOf('RUC 20000000001'));
  });

  it('sin marca (o la del usuario es de otra empresa): razón social, sin franja ni color', () => {
    for (const marca of [null, MARCA_TORRE, MARCA_B_SIN_PLAN, { ...MARCA_A, empresa_id: 9, razon_social: 'AJENA SAC', nombre: 'Ajena Comercial', color: '#ff0000' }]) {
      const h = conMarca(marca, createElement(ReciboArticulo, { d: recibo(EMPRESA_A) }));
      assert.ok(!h.includes('Torres del Sol') && !h.includes('Ajena Comercial'));
      assert.ok(!/background-color:#/.test(h.replace(/bg-neutral[^"]*/g, '')), 'sin franja de color');
      assert.ok(h.includes('GRUPO PRUEBA SAC'));
      assert.ok(h.includes('con Torre'));
    }
  });
});

describe('estado de cuenta con marca', () => {
  const estado = (administradora: string | null): EstadoCuenta => ({
    unidad: { id: 1, codigo: 'E-1', tipo: 'Departamento' }, estructura: null, condominio: { id: 1, nombre: 'Condominio Prueba' }, administradora, propietario: 'Elena', inquilino: null, moneda: 'PEN', zona_horaria: 'America/Lima', fecha_corte: '2026-11-03', desde: null, hasta: null,
    totales: { cargado: '0.00', mora: '0.00', pagado: '0.00', en_revision: '0.00', saldo_anterior: '0.00', saldo_deudor: '0.00', meses_vencidos: 0, deuda_vencida: '0.00', pagos_rechazados: 0 }, filas: [],
  });
  const marcaSobreEstado = (marca: MarcaUsuario | null, adm: string | null) => conMarca(marca, createElement(EstadoCuentaHoja, { e: estado(adm) }));

  it('con la marca de la administradora del documento: logo, nombre comercial y franja de color; pie «con Torre»', () => {
    const h = marcaSobreEstado(MARCA_A, 'GRUPO PRUEBA SAC');
    assert.ok(h.includes('Torres del Sol') && h.includes('Administra: Torres del Sol'));
    assert.match(h, /<img[^>]+src="\/api\/empresas\/1\/logo\?v=5"/);
    assert.ok(h.includes(`background-color:${paletaDeMarca('#0057b8').hex.claro.brand}`));
    assert.ok(h.includes('con Torre'));
  });

  it('si la administradora del documento es otra, la marca del usuario no se mete; sin marca queda como siempre', () => {
    for (const [marca, adm] of [[MARCA_A, 'OTRA SAC'], [null, 'GRUPO PRUEBA SAC'], [MARCA_TORRE, 'GRUPO PRUEBA SAC']] as const) {
      const h = marcaSobreEstado(marca, adm);
      assert.ok(!h.includes('Torres del Sol') && !/<img/.test(h) && !/background-color:#/.test(h));
      assert.ok(h.includes(`Administra: ${adm}`));
    }
  });
});

describe('vista previa de la marca', () => {
  it('muestra el nombre, un botón, el encabezado del menú y la cabecera del recibo con el color elegido; en oscuro, las variables del tema oscuro', () => {
    const p = paletaDeMarca('#0057b8');
    const claro = renderToStaticMarkup(createElement(VistaPrevia, { paleta: p, nombre: 'Torres del Sol', logoUrl: null, oscuro: false }));
    assert.ok(claro.includes('Torres del Sol') && claro.includes('Pagar mi recibo') && claro.includes('con Torre'));
    assert.ok(claro.includes(`--brand:${p.claro.brand}`) && !claro.includes(`--brand:${p.oscuro.brand}`));
    assert.ok(claro.includes('>T<'), 'sin logo, la inicial en un cuadro de color');
    const oscuro = renderToStaticMarkup(createElement(VistaPrevia, { paleta: p, nombre: 'Torres del Sol', logoUrl: '/api/empresas/1/logo?v=5', oscuro: true }));
    assert.ok(oscuro.includes(`--brand:${p.oscuro.brand}`));
    assert.match(oscuro, /<img[^>]+src="\/api\/empresas\/1\/logo\?v=5"/);
    assert.ok(oscuro.includes(`background-color:${p.hex.claro.brand}`), 'la hoja del recibo es blanca en los dos temas: franja del tema claro');
  });
});

describe('cableado de la app', () => {
  it('el Shell da la marca del usuario (Torre si no hay), la aplica antes de pintar y el menú muestra su nombre o la de Torre y «con Torre» al pie', () => {
    const shell = fuente('src/app/Shell.tsx');
    assert.match(shell, /user\?\.marca \?\? MARCA_TORRE/);
    assert.match(shell, /<MarcaContext\.Provider value=\{marca\}>\s*<MarcaTema marca=\{marca\} \/>/);
    assert.match(shell, /marca\.activa \? \(|if \(marca\.activa\)/);
    assert.match(shell, /marca\.activa && !riel && <p[^>]*>con Torre<\/p>/);
    assert.match(shell, /\{!soloMarca && 'Torre'\}/, 'sin marca el menú sigue diciendo Torre');
    const tema = fuente('src/app/marca/MarcaTema.tsx');
    assert.match(tema, /useLayoutEffect/);
    assert.match(tema, /return quitarMarca;/, 'al cerrar sesión (se desmonta) vuelve el verde de Torre');
  });

  it('la hoja de marca se escribe en un <style> (no en el style de <html>, que pisaría el modo oscuro) y se quita al salir; título y favicon vuelven', () => {
    const a = fuente('src/app/marca/aplicar.ts');
    assert.match(a, /createElement\('style'\)/);
    assert.ok(!/documentElement\.style/.test(a));
    assert.match(a, /cssDeMarca\(marca\.color\)/);
    assert.match(a, /document\.title = `\$\{marca\.nombre\} · con Torre`/);
    assert.match(a, /export function quitarMarca[\s\S]*document\.title = tituloOriginal[\s\S]*restaurarIcono\(\)/);
  });

  it('el login guarda la marca del usuario; el login y las páginas públicas no pasan por el Shell (siguen siendo de Torre)', () => {
    assert.match(fuente('src/auth/AuthContext.tsx'), /const user = \{ \.\.\.r\.user, marca: r\.marca \}/);
    const login = fuente('src/pages/Login.tsx');
    assert.ok(!/useMarca|MarcaContext|aplicarMarca/.test(login));
  });

  it('Mi empresa y la ficha del superadmin usan «Tu marca»: logo, nombre comercial, selector de color y campo hex sincronizados, vista previa, aviso de ajuste, volver al verde y aviso del plan con enlace a Mi plan', () => {
    const s = fuente('src/pages/admin/_parts/marca/SeccionMarca.tsx');
    assert.match(s, /type="color"/);
    assert.match(s, /value=\{colorDelSelector\(form\.color\)\}/);
    assert.match(s, /value=\{form\.color\}/);
    assert.match(s, /maxLength=\{MAX_NOMBRE_COMERCIAL\}/);
    assert.match(s, /Volver al verde de Torre/);
    assert.match(s, /<VistaPrevia paleta=\{paleta\}/);
    assert.match(s, /paleta\.ajustado && [\s\S]*AVISO_AJUSTADO/);
    assert.match(s, /!empresa\.marca_activa/);
    assert.match(s, /AVISO_SIN_PLAN/);
    assert.match(s, /<Link to="\/admin\/mi-plan"/);
    assert.match(s, /method: 'PUT', json: cuerpoDeMarca\(form\)/);
    assert.match(s, /if \(user\?\.empresa_id === empresa\.id\) await refresh\(\)/, 'la app toma el color al instante');
    assert.match(fuente('src/pages/admin/Configuracion.tsx'), /<SeccionMarca /);
    assert.match(fuente('src/pages/superadmin/EmpresaDetalle.tsx'), /<SeccionMarca [^>]*comoSuperadmin/);
  });

  it('sin emojis en lo nuevo (iconos de Heroicons y componentes de src/ui)', () => {
    const archivos = ['src/lib/marca.ts', 'src/app/marca', 'src/pages/admin/_parts/marca', 'src/pages/shared/mantenimiento/cabeceraMarca.tsx', 'src/pages/shared/mantenimiento/cabeceraDocumento.ts'];
    const todos = archivos.flatMap((a) => (statSync(a).isDirectory() ? readdirSync(a).map((f) => join(a, f)) : [a]));
    for (const f of todos) assert.ok(!/\p{Extended_Pictographic}/u.test(fuente(f)), f);
  });
});
