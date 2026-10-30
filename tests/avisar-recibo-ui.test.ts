// «Avisar a los vecinos» en la pantalla de recibos. El repo no pinta componentes en Node: se comprueba la fuente (qué piden a la API,
// qué botones hay y que el mensaje para el grupo no lleva montos ni nombres).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const MODAL = f('src/pages/admin/_parts/recibos/AvisarVecinosModal.tsx');
const PERIODO = f('src/pages/admin/PeriodoRecibo.tsx');
const LISTA = f('src/pages/admin/Recibos.tsx');

describe('AvisarVecinosModal: vista previa, envío y mensaje para el grupo', () => {
  it('lee la vista previa y el mensaje, y envía con POST a la misma ruta', () => {
    assert.match(MODAL, /useResource<Vista>\(`\/api\/recibos\/\$\{reciboId\}\/avisar`\)/);
    assert.match(MODAL, /useResource<\{ texto: string \}>\(`\/api\/recibos\/\$\{reciboId\}\/mensaje-grupo`\)/);
    assert.match(MODAL, /api<Resultado>\(`\/api\/recibos\/\$\{reciboId\}\/avisar`, \{ method: 'POST' \}\)/);
  });

  it('dice cuántos llegan por correo y por WhatsApp, y cuántos no tienen canal', () => {
    assert.match(MODAL, /Le llegará a <strong>\{v\.por_correo\}<\/strong> por correo y <strong>\{v\.por_whatsapp\}<\/strong> por WhatsApp; <strong>\{v\.sin_canal\}<\/strong> no tienen correo ni celular\./);
  });

  it('no se puede enviar sin nadie nuevo ni durante la espera de 2 minutos', () => {
    assert.match(MODAL, /const puedeEnviar = !!v && v\.por_avisar > 0 && espera === 0 && !enviando;/);
    assert.match(MODAL, /<Button loading=\{enviando\} disabled=\{!puedeEnviar\}/);
  });

  it('después de enviar muestra el resultado con enlace a Comunicados › Notificaciones', () => {
    assert.match(MODAL, /<Link to=\{`\$\{location\.pathname\.startsWith\('\/junta'\) \? '\/junta' : '\/admin'\}\/avisos\?tipo=recibo_emitido`\}[^>]*>Ver en Comunicados › Notificaciones<\/Link>/);
    assert.match(MODAL, /toast\.ok\(`Quedaron en cola/);
  });

  it('el botón de copiar usa el portapapeles y, si no se puede, deja el texto seleccionado', () => {
    assert.match(MODAL, /Copiar mensaje para el grupo de WhatsApp/);
    assert.match(MODAL, /navigator\.clipboard\.writeText\(grupo\.data\?\.texto \?\? ''\)/);
    assert.match(MODAL, /textoRef\.current\?\.select\(\)/);
  });

  it('el texto del grupo es de solo lectura y no muestra montos ni nombres de vecinos', () => {
    assert.match(MODAL, /<Textarea ref=\{textoRef\} label="Mensaje para el grupo de WhatsApp" ocultarEtiqueta readOnly/);
    assert.ok(!/\bdinero\b|\bnombre\b|\bmonto\b|\bcontacto\b/i.test(MODAL.replace(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, '')), 'el modal no toca montos, nombres ni contactos');
  });
});

describe('pantallas que abren el aviso', () => {
  it('el periodo tiene el botón «Avisar a los vecinos» junto al estado', () => {
    assert.match(PERIODO, /<Button variant="secondary" icon=\{<MegaphoneIcon className="h-4 w-4" \/>\} onClick=\{\(\) => setAvisando\(true\)\}>Avisar a los vecinos<\/Button>/);
    assert.match(PERIODO, /\{avisando && <AvisarVecinosModal reciboId=\{reciboId\} titulo=\{titulo\} onClose=\{\(\) => setAvisando\(false\)\} \/>\}/);
  });

  it('en la lista hay una acción por fila que no abre el periodo al pulsarla', () => {
    assert.match(LISTA, /key: 'avisar'/);
    assert.match(LISTA, /onClick=\{e => \{ e\.stopPropagation\(\); setAvisando\(r\); \}\}/);
    assert.match(LISTA, /<AvisarVecinosModal reciboId=\{avisando\.id\} titulo=\{etiquetaRecibo\(avisando\)\}/);
  });
});
