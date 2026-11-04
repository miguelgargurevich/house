// Comunicados con junta, grupos de WhatsApp elegidos y vecinos, y la ficha del block que sólo muestra sus grupos: pruebas de FUENTE de la UI (regex sobre el .tsx) y de los textos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { gruposPendientes, motivoDeGrupo, textoGrupos, textoPublicado } from '../src/pages/admin/_parts/comunicados/tipos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const modal = f('src/pages/admin/_parts/comunicados/ComunicadoModal.tsx');
const torres = f('src/pages/admin/_parts/condominio/TorresDelCondominio.tsx');
const tab = f('src/pages/admin/_parts/comunicados/ComunicadosTab.tsx');

describe('comunicado nuevo: junta, grupos y vecinos', () => {
  it('a la junta va marcado por defecto; a cada vecino por WhatsApp, NO', () => {
    assert.match(modal, /enviar_correo: false, enviar_whatsapp: false, enviar_junta: true, fijado: false/);
    assert.match(modal, /label=\{estructuraId \? `A la junta del \$\{palabra\.una\}` : 'A las juntas del condominio'\}/);
    assert.match(modal, /label="Por WhatsApp a cada vecino"[^>]*\{\.\.\.register\('enviar_whatsapp'\)\}/);
  });

  it('los grupos son una lista de casillas con los grupos EN USO del condominio: vienen marcados los del alcance, se pueden marcar otros y NUNCA se manda un grupo sin marcar', () => {
    assert.match(modal, /<legend[^>]*>A los grupos de WhatsApp<\/legend>/);
    assert.match(modal, /const grupos = useMemo\(\(\) => complejo\?\.grupos \?\? \[\], \[complejo\]\)/);
    assert.match(modal, /grupos\.filter\(g => esSugerido\(g, estructuraId \? Number\(estructuraId\) : null\)\)/);
    assert.match(modal, /if \(nuevo\) setGruposSel\(sugeridos\)/);
    assert.match(modal, /<input type="checkbox"[^>]*checked=\{gruposSel\.includes\(g\.id\)\} onChange=\{\(\) => alternarGrupo\(g\.id\)\}/);
    assert.match(modal, /\.\.\.\(gruposSel\.length \? \{ enviar_grupo: true, grupos: gruposSel \} : \{\}\)/);
    assert.doesNotMatch(modal, /enviar_grupo: !!v\.enviar_grupo|Al grupo de WhatsApp del/);
  });

  it('sin grupos en uso lo explica y manda a «WhatsApp › Mis grupos» (el enlace sólo a la administración, no a la junta); sin JID en la pantalla', () => {
    assert.match(modal, /grupos de WhatsApp en uso\. La administración los elige en «WhatsApp» › Mis grupos/);
    assert.match(modal, /\{esAdmin && <Link to="\/admin\/whatsapp"/);
    assert.doesNotMatch(modal, /jid/i);
  });

  it('editar no manda ninguna de las casillas nuevas', () => {
    assert.match(modal, /method: 'PUT', json: \{ titulo: v\.titulo, cuerpo: v\.cuerpo, fijado: v\.fijado \}/);
    assert.match(modal, /enviar_junta: false, fijado: comunicado\.fijado/);
  });

  it('el aviso tras publicar dice qué salió: avisos en cola y/o grupos', () => {
    assert.equal(textoPublicado({ avisos_encolados: 3, enviar_correo: false, enviar_whatsapp: false, enviar_junta: true }), 'Comunicado publicado. Se encolaron 3 avisos por correo y WhatsApp.');
    assert.equal(textoPublicado({ avisos_encolados: 0, enviar_correo: false, enviar_whatsapp: false, enviar_grupo: true, grupos_resultado: [{ estructura_id: 1, nombre: 'Block 1', estado: 'pendiente' }] }), 'Comunicado publicado. Se está enviando al grupo de WhatsApp.');
    assert.match(textoPublicado({ avisos_encolados: 3, enviar_correo: false, enviar_whatsapp: false, enviar_junta: true, grupos_resultado: [{ estructura_id: 1, nombre: 'B1', estado: 'pendiente' }, { estructura_id: 2, nombre: 'B2', estado: 'pendiente' }] }), /3 avisos por correo y WhatsApp y se está enviando a 2 grupos de WhatsApp\.$/);
    assert.match(textoPublicado({ avisos_encolados: 0, enviar_correo: false, enviar_whatsapp: false, enviar_junta: true }), /no se envió ningún aviso/);
  });

  it('el resumen de grupos de la lista: enviados, en curso y con error; y los motivos se ven también en el celular', () => {
    assert.equal(textoGrupos({ grupos_resultado: null }), null);
    assert.equal(textoGrupos({ grupos_resultado: [{ estructura_id: 1, nombre: 'B1', estado: 'enviado' }, { estructura_id: 2, nombre: 'B2', estado: 'fallo', motivo: 'x' }] }), '1 grupo de WhatsApp · 1 con error');
    assert.equal(textoGrupos({ grupos_resultado: [{ grupo_id: 1, nombre: 'B1', estado: 'pendiente' }] }), '0 grupos de WhatsApp · enviando…');
    assert.match(tab, /className="text-xs text-bad md:hidden">\{motivoDeGrupo\(g\)\}/);
    assert.match(tab, /className="block max-w-\[16rem\] text-xs text-bad">\{motivoDeGrupo\(g\)\}/);
    assert.equal(motivoDeGrupo({ grupo_id: 1, nombre: 'Junta', estado: 'fallo' }), 'No se envió al grupo «Junta»');
  });

  it('un grupo que no salió por el tope diario queda «pendiente» (no «enviando…»), con su motivo y un botón para reintentar', () => {
    const c = { grupos_resultado: [{ grupo_id: 1, nombre: 'A', estado: 'enviado' as const }, { grupo_id: 2, nombre: 'B', estado: 'pendiente' as const, motivo: 'Tope diario alcanzado' }] };
    assert.equal(textoGrupos(c), '1 grupo de WhatsApp · 1 pendiente');
    assert.deepEqual(gruposPendientes(c).map((g) => g.nombre), ['B']);
    assert.deepEqual(gruposPendientes({ grupos_resultado: [{ grupo_id: 3, nombre: 'C', estado: 'pendiente' }] }), [], 'sin motivo = se está enviando ahora');
    assert.match(tab, /`\/api\/comunicados\/\$\{c\.id\}\/reintentar-grupos`, \{ method: 'POST' \}/);
    assert.match(tab, /onClick=\{\(\) => void reintentar\(c\)\}>Reintentar/);
  });
});

describe('ficha del block: los grupos de WhatsApp se muestran, se eligen en «WhatsApp»', () => {
  it('ya no hay selector propio ni llamadas a Evolution por block: lee «Mis grupos» (de la base) y manda a la pantalla WhatsApp', () => {
    assert.doesNotMatch(torres, /ModalGrupo|grupos-whatsapp|grupo-whatsapp|whatsapp_grupo/);
    assert.match(torres, /useResource<MisGrupos>\('\/api\/whatsapp\/grupos'\)/);
    assert.match(torres, /g\.en_uso && g\.estructura_id === t\.id/);
    assert.match(torres, /onClick=\{\(\) => navegar\('\/admin\/whatsapp'\)\}/);
  });

  it('la tabla muestra los grupos del block (o «Sin grupo») con a quién representan y el último problema', () => {
    assert.match(torres, /header: 'Grupo de WhatsApp'/);
    assert.match(torres, /Sin grupo/);
    assert.match(torres, /textoDestino\(g, misGrupos\.data\?\.condominios \?\? \[\]\)/);
    assert.match(torres, /g\.aviso && <span className="block text-xs text-bad">/);
  });
});
