// Solo lectura en pantalla: la banda fija, los botones desactivados con su motivo, «Te quedan N días gratis» y los textos del plan Gratis con plazo y de Básico.
// Lo que es lógica se prueba de verdad; el cableado, con la fuente. El backend es la fuente de verdad (ver solo-lectura.test.ts).
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { diasGratisTexto, fechaLarga, MOTIVO_SOLO_LECTURA, MOTIVO_SOLO_LECTURA_JUNTA, ofertaDePago, SoloLecturaCtx, textoBanda, vistaSoloLectura, type EstadoOperativo } from '../src/app/soloLectura';
import { duracionGratis, plazoGratisTexto } from '../src/pages/publico/plazoGratis';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const estado = (id: number, over: Partial<EstadoOperativo> = {}): EstadoOperativo => ({
  complejo_id: id, complejo: `Condominio ${id}`, solo_lectura: true, gratis_hasta: '2026-10-29T00:00:00.000Z', solo_lectura_desde: '2026-10-30T00:00:00.000Z', dias_gratis_restantes: null, basico_desde: 'S/ 20', ...over,
});

describe('qué estado vale para la pantalla', () => {
  it('con un condominio elegido, el suyo; sin elegir, sólo si TODOS están en solo lectura', () => {
    const lista = [estado(1), estado(2, { solo_lectura: false })];
    assert.equal(vistaSoloLectura(lista, 1, false).soloLectura, true);
    assert.equal(vistaSoloLectura(lista, 2, false).soloLectura, false);
    assert.equal(vistaSoloLectura(lista, null, false).soloLectura, false, 'con uno que opera, «Todos» no bloquea');
    assert.equal(vistaSoloLectura([estado(1), estado(2)], null, false).soloLectura, true);
    assert.equal(vistaSoloLectura([], null, false).soloLectura, false, 'sin condominios no hay nada que bloquear');
    assert.equal(vistaSoloLectura(lista, 99, false).soloLectura, false, 'un id que no es suyo no bloquea');
  });

  it('el motivo de un botón desactivado: la administración, a Mi plan; la junta, con su administración; sin bloqueo no hay motivo', () => {
    const v = vistaSoloLectura([estado(1)], 1, false);
    assert.equal(v.motivo, MOTIVO_SOLO_LECTURA);
    assert.match(v.motivo!, /Pásalo a un plan de pago desde Mi plan/);
    assert.equal(vistaSoloLectura([estado(1)], 1, true).motivo, MOTIVO_SOLO_LECTURA_JUNTA);
    assert.match(MOTIVO_SOLO_LECTURA_JUNTA, /Pídele a tu administración/);
    assert.equal(vistaSoloLectura([estado(1, { solo_lectura: false })], 1, false).motivo, undefined);
  });

  it('«Te quedan N días gratis», «Hoy es tu último día gratis» y nada si no corre un plazo', () => {
    assert.equal(diasGratisTexto(12), 'Te quedan 12 días gratis');
    assert.equal(diasGratisTexto(1), 'Te quedan 1 día gratis');
    assert.equal(diasGratisTexto(0), 'Hoy es tu último día gratis');
    assert.equal(diasGratisTexto(null), null);
  });

  it('la fecha larga se lee como día calendario (sin correr un día por la zona) y la oferta cita Básico sólo si cabe', () => {
    assert.equal(fechaLarga('2026-10-30T00:00:00.000Z'), '30 de octubre de 2026');
    assert.equal(fechaLarga('2027-01-01T00:00:00.000Z'), '1 de enero de 2027');
    assert.equal(fechaLarga(null), '');
    assert.equal(ofertaDePago('S/ 20'), 'Básico desde S/ 20 o Pro');
    assert.equal(ofertaDePago(null), 'Pro');
  });

  it('el texto de la banda es el pedido: «Este condominio está en solo lectura desde el … Tus datos siguen aquí.»', () => {
    assert.equal(textoBanda({ desde: '2026-10-30T00:00:00.000Z' }), 'Este condominio está en solo lectura desde el 30 de octubre de 2026. Tus datos siguen aquí.');
    assert.equal(textoBanda({ desde: null }), 'Este condominio está en solo lectura. Tus datos siguen aquí.');
  });
});

describe('la banda y los botones, renderizados', () => {
  let ContenidoBanda: typeof import('../src/app/ContenidoBanda').ContenidoBanda;
  let Bloqueable: typeof import('../src/app/Bloqueable').Bloqueable;
  before(async () => {
    (globalThis as { React?: unknown }).React = React; // los componentes se compilan con el JSX clásico en las pruebas
    ({ ContenidoBanda } = await import('../src/app/ContenidoBanda'));
    ({ Bloqueable } = await import('../src/app/Bloqueable'));
  });
  const banda = (junta: boolean) => renderToStaticMarkup(createElement(StaticRouter, { location: '/admin/dashboard' }, createElement(ContenidoBanda, { v: vistaSoloLectura([estado(1)], 1, junta), junta })));

  it('la administración ve el texto, la oferta de Básico o Pro y el botón a Mi plan', () => {
    const html = banda(false);
    assert.match(html, /Este condominio está en solo lectura desde el 30 de octubre de 2026\. Tus datos siguen aquí\./);
    assert.match(html, /Pásalo a un plan de pago para seguir registrando: Básico desde S\/ 20 o Pro\./);
    assert.match(html, /href="\/admin\/mi-plan"[^>]*>Ir a Mi plan/);
    assert.match(html, /data-banda="solo-lectura"/);
  });

  it('la junta ve el texto y se manda con su administración, sin botón a Mi plan', () => {
    const html = banda(true);
    assert.match(html, /Tus datos siguen aquí\./);
    assert.match(html, /Pídele a tu administración/);
    assert.doesNotMatch(html, /Ir a Mi plan/);
  });

  it('un botón envuelto en Bloqueable queda desactivado con el motivo cuando hay solo lectura, y activo sin él', () => {
    const boton = createElement(Bloqueable, { children: (b: boolean) => createElement('button', { disabled: b }, 'Emitir recibo') });
    const bloqueado = renderToStaticMarkup(createElement(SoloLecturaCtx.Provider, { value: vistaSoloLectura([estado(1)], 1, false) }, boton));
    assert.match(bloqueado, /title="Este condominio está en solo lectura: terminó su periodo gratis\./);
    assert.match(bloqueado, /<button disabled="">Emitir recibo<\/button>/);
    const libre = renderToStaticMarkup(createElement(SoloLecturaCtx.Provider, { value: vistaSoloLectura([estado(1, { solo_lectura: false })], 1, false) }, boton));
    assert.doesNotMatch(libre, /disabled|title=/);
  });
});

describe('cableado', () => {
  it('el Shell monta el proveedor y la banda dentro de la barra fija', () => {
    const s = fuente('src/app/Shell.tsx');
    assert.match(s, /<SoloLecturaProvider><ShellInterior \/><\/SoloLecturaProvider>/);
    const barra = s.slice(s.indexOf('sticky top-0 z-30'), s.indexOf('<main id="contenido"'));
    assert.match(barra, /<BandaSoloLectura \/>/, 'la banda va dentro de la barra fija');
  });

  it('el proveedor sólo pide el estado para la administración y la junta, y usa el condominio elegido', () => {
    const s = fuente('src/app/SoloLecturaProvider.tsx');
    assert.match(s, /user\?\.rol === 'admin' \|\| junta/);
    assert.match(s, /\/api\/comercial\/estado-operativo/);
    assert.match(s, /vistaSoloLectura\(data\?\.condominios \?\? \[\], junta \? null : elegido, junta\)/);
  });

  it('las acciones que crean trabajo desactivan su botón con Bloqueable', () => {
    for (const [ruta, textos] of [
      ['src/pages/admin/Recibos.tsx', ['Emitir recibo', 'Subir Excel', 'Avisar']],
      ['src/pages/admin/Pagos.tsx', ['Registrar pago']],
      ['src/pages/admin/Unidades.tsx', ['Nueva unidad']],
      ['src/pages/admin/Conceptos.tsx', ['Nuevo concepto']],
      ['src/pages/admin/Proveedores.tsx', ['Nuevo proveedor']],
      ['src/pages/admin/_parts/comunicados/ComunicadosTab.tsx', ['Nuevo comunicado']],
      ['src/pages/admin/_parts/cierres/DetalleCierre.tsx', ['Registrar pago']],
      ['src/pages/admin/_parts/agua/AguaRecibo.tsx', ['Subir Excel o CSV', 'Guardar lecturas']],
      ['src/pages/admin/_parts/mantenimientos/MantenimientoAdminModal.tsx', ['Registrar pago']],
    ] as const) {
      const f = fuente(ruta);
      assert.match(f, /import \{ Bloqueable \} from/, ruta);
      for (const t of textos) {
        // CADA botón con ese texto (también el del estado vacío) va envuelto y desactivado.
        const apariciones = [...f.matchAll(new RegExp(`(?:>|\\n\\s*)${t}(?:</Button>|<span|\\{)`, 'g'))];
        assert.ok(apariciones.length > 0, `${ruta}: no encontré «${t}»`);
        for (const a of apariciones) assert.match(f.slice(Math.max(0, a.index! - 320), a.index!), /<Bloqueable>\{b => [\s\S]*disabled=\{[^}]*b\}/, `${ruta}: «${t}» sin Bloqueable`);
      }
    }
  });

  it('los movimientos de la Junta central también (ingreso y egreso comparten un botón)', () => {
    const f = fuente('src/pages/admin/_parts/cierres/CierreCentral.tsx');
    assert.match(f, /<Bloqueable>\{b => <Button size="sm" icon=\{<BanknotesIcon className="h-4 w-4" \/>\} disabled=\{b\} onClick=\{\(\) => setRegistrando\(tipo\)\}>/);
  });

  it('Mi plan avisa «Te quedan N días gratis», marca la solo lectura y ofrece Básico o Pro; el Resumen también cuenta los días', () => {
    const m = fuente('src/pages/admin/MiPlan.tsx');
    assert.match(m, /diasGratisTexto\(c\.dias_gratis_restantes\)/);
    assert.match(m, /label: 'Solo lectura', tone: 'bad'/);
    assert.match(m, /Este condominio está en solo lectura desde el \{fechaLarga\(c\.solo_lectura_desde\)\}/);
    assert.match(m, /ofertaDePago\(c\.basico_desde\)/);
    const b = fuente('src/pages/admin/_parts/plan/BandaPlan.tsx');
    assert.match(b, /diasGratisTexto\(c\.dias_gratis_restantes\)/);
    assert.match(b, /!c\.solo_lectura/, 'el resumen no repite la banda de solo lectura');
  });

  it('el superadmin fija los días de Gratis (0 a 365) junto a los de la prueba de Pro', () => {
    const f = fuente('src/pages/superadmin/_parts/suscripciones/Precios.tsx');
    assert.match(f, /dias_gratis: number \| null;/);
    assert.match(f, /label="Días de Gratis" type="number" min=\{0\} max=\{365\}/);
    assert.match(f, /dias_gratis: Number\(f\.dias_gratis\)/);
  });

  it('el modal de solicitud explica por qué Básico no se ofrece con más departamentos que su tope', () => {
    const f = fuente('src/pages/admin/_parts/plan/ModalSolicitud.tsx');
    assert.match(f, /pasadoDelTope/);
    assert.match(f, /Llega hasta \{p\.unidades_maximas\} departamentos/);
  });
});

describe('textos del plan Gratis con plazo y de Básico', () => {
  it('«3 meses» sale de los días que dice el catálogo, no de una cifra escrita en la página', () => {
    assert.equal(duracionGratis(90), '3 meses');
    assert.equal(duracionGratis(30), '1 mes');
    assert.equal(duracionGratis(45), '45 días');
    assert.equal(plazoGratisTexto({ dias_gratis: 90 }), 'por 3 meses');
    assert.equal(plazoGratisTexto({ dias_gratis: null }), 'sin plazo');
  });

  it('ya no queda «para siempre» ni «Para empezar y» en lo que ve el público ni en los Términos', () => {
    for (const ruta of ['src/pages/publico/Portada.tsx', 'src/pages/publico/precios/Planes.tsx', 'src/pages/publico/precios/Recibo.tsx', 'src/pages/publico/precios/Preguntas.tsx', 'src/pages/publico/_parts/PanelRegistro.tsx', 'src/pages/publico/legal/textos.tsx', 'src/server/services/comercial/catalogo.ts', 'docs/legal/terminos.md']) {
      assert.doesNotMatch(fuente(ruta), /para siempre|Para empezar y/i, ruta);
    }
  });

  it('la sección 3 de los Términos dice el plazo y que al vencer queda en solo lectura sin perder datos (en el .md y en la página)', () => {
    for (const ruta of ['docs/legal/terminos.md', 'src/pages/publico/legal/textos.tsx']) {
      const f = fuente(ruta).replace(/<\/?strong>/g, '').replace(/\*\*/g, '');
      assert.match(f, /dura 3 meses/, ruta);
      assert.match(f, /queda en solo lectura/, ruta);
      assert.match(f, /No se borra ningún dato/, ruta);
    }
  });

  it('la página de precios muestra cuatro niveles y la calculadora ofrece Básico a quien se pasa de los 20 de Gratis', () => {
    const p = fuente('src/pages/publico/precios/Planes.tsx');
    assert.match(p, /xl:grid-cols-4/);
    assert.match(p, /find\(p => p\.clave === 'basico'\)/);
    const r = fuente('src/pages/publico/precios/Recibo.tsx');
    assert.match(r, /plan\?\.clave === 'gratis' && basico/);
    assert.match(r, /Ver el total con \{siguiente\.nombre\}/);
    assert.match(r, /grid grid-cols-2 gap-1 rounded bg-surface2 p-1 sm:grid-cols-4/, 'cuatro planes en el selector, sin desborde en el celular');
  });
});
