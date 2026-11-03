// Comunicados con junta, grupo de WhatsApp y vecinos, y la ficha del block con su grupo: pruebas de FUENTE de la UI (regex sobre el .tsx) y de los textos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { textoGrupos, textoPublicado } from '../src/pages/admin/_parts/comunicados/tipos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const modal = f('src/pages/admin/_parts/comunicados/ComunicadoModal.tsx');
const torres = f('src/pages/admin/_parts/condominio/TorresDelCondominio.tsx');
const tab = f('src/pages/admin/_parts/comunicados/ComunicadosTab.tsx');

describe('comunicado nuevo: junta, grupo y vecinos', () => {
  it('a la junta va marcado por defecto; a cada vecino por WhatsApp, NO', () => {
    assert.match(modal, /enviar_junta: true, enviar_grupo: false/);
    assert.match(modal, /enviar_correo: false, enviar_whatsapp: false, enviar_junta: true/);
    assert.match(modal, /label=\{estructuraId \? `A la junta del \$\{palabra\.una\}` : 'A las juntas del condominio'\}/);
    assert.match(modal, /label="Por WhatsApp a cada vecino"[^>]*\{\.\.\.register\('enviar_whatsapp'\)\}/);
  });

  it('al grupo: se marca solo si el alcance tiene grupo, va deshabilitado si no, y NUNCA se manda sin grupo', () => {
    assert.match(modal, /const hayGrupo = conGrupo\.length > 0/);
    assert.match(modal, /if \(nuevo\) setValue\('enviar_grupo', hayGrupo\)/);
    assert.match(modal, /label=\{`Al grupo de WhatsApp del \$\{palabra\.una\}`\}\s*disabled=\{!hayGrupo\}/);
    assert.match(modal, /enviar_grupo: !!v\.enviar_grupo && hayGrupo/);
    assert.match(modal, /La administración lo elige en la ficha del/);
  });

  it('editar no manda ninguna de las casillas nuevas', () => {
    assert.match(modal, /method: 'PUT', json: \{ titulo: v\.titulo, cuerpo: v\.cuerpo, fijado: v\.fijado \}/);
    assert.match(modal, /enviar_junta: false, enviar_grupo: false, fijado: comunicado\.fijado/);
  });

  it('el aviso tras publicar dice qué salió: avisos en cola y/o grupos', () => {
    assert.equal(textoPublicado({ avisos_encolados: 3, enviar_correo: false, enviar_whatsapp: false, enviar_junta: true }), 'Comunicado publicado. Se encolaron 3 avisos por correo y WhatsApp.');
    assert.equal(textoPublicado({ avisos_encolados: 0, enviar_correo: false, enviar_whatsapp: false, enviar_grupo: true, grupos_resultado: [{ estructura_id: 1, nombre: 'Block 1', estado: 'pendiente' }] }), 'Comunicado publicado. Se está enviando al grupo de WhatsApp del block.');
    assert.match(textoPublicado({ avisos_encolados: 3, enviar_correo: false, enviar_whatsapp: false, enviar_junta: true, grupos_resultado: [{ estructura_id: 1, nombre: 'B1', estado: 'pendiente' }, { estructura_id: 2, nombre: 'B2', estado: 'pendiente' }] }), /3 avisos por correo y WhatsApp y se está enviando a 2 grupos de WhatsApp\.$/);
    assert.match(textoPublicado({ avisos_encolados: 0, enviar_correo: false, enviar_whatsapp: false, enviar_junta: true }), /no se envió ningún aviso/);
  });

  it('el resumen de grupos de la lista: enviados, en curso y con error; y los motivos se ven también en el celular', () => {
    assert.equal(textoGrupos({ grupos_resultado: null }), null);
    assert.equal(textoGrupos({ grupos_resultado: [{ estructura_id: 1, nombre: 'B1', estado: 'enviado' }, { estructura_id: 2, nombre: 'B2', estado: 'fallo', motivo: 'x' }] }), '1 grupo de WhatsApp · 1 con error');
    assert.equal(textoGrupos({ grupos_resultado: [{ estructura_id: 1, nombre: 'B1', estado: 'pendiente' }] }), '0 grupos de WhatsApp · enviando…');
    assert.match(tab, /className="text-xs text-bad md:hidden">\{g\.motivo/);
    assert.match(tab, /className="block max-w-\[16rem\] text-xs text-bad">\{g\.motivo/);
  });
});

describe('ficha del block: grupo de WhatsApp', () => {
  it('se elige de una lista (Select), nunca se escribe el identificador a mano', () => {
    const m = torres.slice(torres.indexOf('function ModalGrupo'));
    assert.match(m, /<Select label="Grupo del block"/);
    assert.doesNotMatch(m, /<Input|<Textarea|<TelefonoInput/);
    assert.match(m, /`\/api\/estructuras\/\$\{torre\.id\}\/grupos-whatsapp`/);
    assert.match(m, /`\/api\/estructuras\/\$\{torre\.id\}\/grupo-whatsapp`, \{ method: 'PUT', json: \{ jid: nuevo \} \}/);
  });

  it('sin WhatsApp conectado explica que primero se conecte, con enlace a «WhatsApp»; y avisa cuando el número ya no está en el grupo', () => {
    assert.match(torres, /!datos\.conectado \? \(\s*<Alert tone="warn">\s*Primero conecta tu número de WhatsApp[\s\S]*to="\/admin\/whatsapp"/);
    assert.match(torres, /datos\.actual\?\.aviso && <Alert tone="bad">/);
    assert.match(torres, /whatsapp_grupo_aviso && <span className="block text-xs text-bad sm:hidden">/);
  });

  it('la tabla muestra el grupo (o «Sin grupo») y un botón por block', () => {
    assert.match(torres, /header: 'Grupo de WhatsApp'/);
    assert.match(torres, /Sin grupo/);
    assert.match(torres, /label=\{`Grupo de WhatsApp de \$\{nombreDe\(t\)\}`\}/);
  });
});
