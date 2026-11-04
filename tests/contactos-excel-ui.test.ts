// Pantalla de la carga de contactos. El repo no monta React en Node: la lógica va en funciones puras (`vista.ts`) y el cableado se fija leyendo la fuente.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { hayQueGuardar, lineasDeResumen, textoCola, type ResumenContactos } from '../src/pages/admin/_parts/contactos/vista';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const cero: ResumenContactos = { filas: 0, filas_con_error: 0, filas_con_aviso: 0, correos_nuevos: 0, correos_cambiados: 0, celulares_nuevos: 0, celulares_cambiados: 0, propietarios_nuevos: 0, inquilinos_nuevos: 0, unidades_unidas: 0, cambian_quien_paga: 0, invitables: 0 };

describe('textos del resumen', () => {
  it('una frase por cosa que cambia, con singular y plural; nada si no cambia nada', () => {
    assert.deepEqual(lineasDeResumen(cero), []);
    assert.deepEqual(lineasDeResumen({ ...cero, correos_nuevos: 1, celulares_nuevos: 4, inquilinos_nuevos: 1, cambian_quien_paga: 1, unidades_unidas: 2 }), [
      'Se agregan 1 correo.',
      'Se agregan 4 celulares.',
      'Se crean 1 inquilino.',
      '1 departamento pasa a avisar de los cobros al inquilino.',
      '2 departamentos pasan a la persona que ya tiene ese mismo correo.',
    ]);
    assert.match(lineasDeResumen({ ...cero, correos_cambiados: 3 })[0]!, /Se cambian 3 correos que ya estaban cargados/);
  });

  it('se puede guardar si algo cambia, o si la casilla de invitar tiene a quién dejar en cola', () => {
    assert.equal(hayQueGuardar(cero, false), false);
    assert.equal(hayQueGuardar(cero, true), false);
    assert.equal(hayQueGuardar({ ...cero, invitables: 3 }, false), false);
    assert.equal(hayQueGuardar({ ...cero, invitables: 3 }, true), true);
    assert.equal(hayQueGuardar({ ...cero, celulares_nuevos: 1 }, false), true);
  });

  it('la línea de la cola: «X invitaciones enviadas, Y en cola (salen en N días)»', () => {
    assert.equal(textoCola({ enviadas: 12, en_cola: 436, por_encolar: 0, por_dia: 90, enviadas_hoy: 12, dias: 5 }), '12 invitaciones enviadas, 436 en cola (salen en 5 días)');
    assert.equal(textoCola({ enviadas: 1, en_cola: 1, por_encolar: 0, por_dia: 90, enviadas_hoy: 0, dias: 1 }), '1 invitación enviada, 1 en cola (salen en 1 día)');
    assert.equal(textoCola({ enviadas: 448, en_cola: 0, por_encolar: 0, por_dia: 90, enviadas_hoy: 0, dias: 0 }), '448 invitaciones enviadas, 0 en cola');
  });
});

describe('cableado', () => {
  it('el panel está en la pestaña Residentes de la ficha, sólo para admin y superadmin, y recarga la lista al guardar', () => {
    const f = fuente('src/pages/admin/CondominioDetalle.tsx');
    assert.match(f, /puedeCargarContactos = user\?\.rol === 'admin' \|\| esSuper/);
    assert.match(f, /\{puedeCargarContactos && <PanelContactos complejoId=\{complejoId\}/);
    assert.match(f, /<div key=\{versionResidentes\}>\s*<PersonasLista tipo="residente" complejoId=\{complejoId\} sinEncabezado \/>/);
  });

  it('el panel descarga la plantilla, sube contactos e invita a los pendientes por condominio o block', () => {
    const p = fuente('src/pages/admin/_parts/contactos/PanelContactos.tsx');
    assert.match(p, /Descargar plantilla de contactos/);
    assert.match(p, /Subir contactos/);
    assert.match(p, /Invitar a los pendientes/);
    assert.match(p, /\/api\/contactos\/invitaciones/);
    assert.match(p, /Todo el condominio/);
    const c = fuente('src/pages/admin/_parts/contactos/cliente.ts');
    assert.match(c, /\/api\/contactos\/plantilla\.xlsx\?complejo_id=/);
    assert.match(c, /\/api\/contactos\/excel/);
  });

  it('el modal sólo guarda tras la vista previa: «Revisar archivo» no confirma y «Guardar contactos» sí', () => {
    const m = fuente('src/pages/admin/_parts/contactos/ModalContactos.tsx');
    assert.match(m, /enviar\(false\)[\s\S]*Revisar archivo/);
    assert.match(m, /enviar\(true\)[\s\S]*Guardar contactos/);
    assert.match(m, /Actualizar los datos ya cargados/);
    assert.match(m, /Enviar invitación a los que tienen correo/);
    const c = fuente('src/pages/admin/_parts/contactos/cliente.ts');
    assert.match(c, /if \(p\.confirmar\) fd\.append\('confirmar', 'true'\)/);
    assert.match(c, /res\.status === 409 && data\?\.code === 'REVISAR_CONTACTOS'/);
  });

  it('usable a 390 px: los problemas son tarjetas (sin tabla) y no hay emojis', () => {
    const m = fuente('src/pages/admin/_parts/contactos/ModalContactos.tsx');
    assert.equal(/<table/.test(m), false);
    assert.match(m, /overflow-y-auto/);
    assert.match(m, /break-words/);
    for (const ruta of ['ModalContactos.tsx', 'PanelContactos.tsx', 'vista.ts']) assert.equal(/\p{Extended_Pictographic}/u.test(fuente(`src/pages/admin/_parts/contactos/${ruta}`)), false, ruta);
  });

  it('Precios edita el tope diario de invitaciones y lo manda al servidor', () => {
    const p = fuente('src/pages/superadmin/_parts/suscripciones/Precios.tsx');
    assert.match(p, /invitaciones_por_dia: number/);
    assert.match(p, /label="Invitaciones por día" type="number" min=\{1\} max=\{5000\}/);
    assert.match(p, /invitaciones_por_dia: Number\(f\.invitaciones_por_dia\)/);
  });
});
