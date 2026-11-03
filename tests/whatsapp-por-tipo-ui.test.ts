// Sección «Avisos por WhatsApp» de la ficha del condominio. El repo no pinta componentes en Node: se comprueba la fuente
// (los textos que pide la administración, a quién le pega la API y que el plan sin WhatsApp no deja tocar la lista).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ROTULO_WHATSAPP, TIPOS_WHATSAPP_CONFIGURABLES, WHATSAPP_POR_DEFECTO, esTipoWhatsappConfigurable } from '../src/server/services/avisos/whatsappTipos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const SECCION = f('src/pages/admin/_parts/condominio/AvisosWhatsapp.tsx');
const FICHA = f('src/pages/admin/CondominioDetalle.tsx');
const MODAL = f('src/pages/admin/_parts/condominio/ModalDeComplejo.tsx');
const RUTA = f('src/server/routes/complejos.ts');

describe('lista de tipos que la administración puede activar', () => {
  it('son los siete de WhatsApp, con los nombres que pidió la administración', () => {
    assert.deepEqual([...TIPOS_WHATSAPP_CONFIGURABLES], ['recibo_emitido', 'por_vencer', 'vence_hoy', 'vencido', 'pago_validado', 'pago_rechazado', 'cierre_pendiente']);
    assert.deepEqual(
      TIPOS_WHATSAPP_CONFIGURABLES.map((t) => ROTULO_WHATSAPP[t]),
      ['Recibo del mes', 'Recordatorio 2 días antes', 'Vence hoy', 'Venció', 'Pago validado', 'Pago rechazado', 'Cierre del mes pendiente (al tesorero)'],
    );
  });

  it('por defecto va todo menos pago validado (que sale sólo por correo y en la app)', () => {
    assert.ok(!WHATSAPP_POR_DEFECTO.includes('pago_validado'));
    assert.equal(WHATSAPP_POR_DEFECTO.length, TIPOS_WHATSAPP_CONFIGURABLES.length - 1);
    for (const t of ['ia_caida', 'ia_restablecida', 'comunicado']) assert.equal(esTipoWhatsappConfigurable(t), false, t);
  });
});

describe('sección en la ficha', () => {
  it('la ficha monta la sección con la lista guardada y si el plan trae WhatsApp', () => {
    assert.match(FICHA, /import \{ AvisosWhatsapp \} from '\.\/_parts\/condominio\/AvisosWhatsapp'/);
    assert.match(FICHA, /<AvisosWhatsapp[^>]*complejoId=\{c\.id\}[^>]*lista=\{c\.whatsapp_avisos\}[^>]*planWhatsapp=\{c\.whatsapp_plan\}/);
  });

  it('una casilla por tipo, con el texto de cada uno, y la línea que explica la cuota y el tope', () => {
    assert.match(SECCION, /<h3 id="avisos-whatsapp"[^>]*>Avisos por WhatsApp<\/h3>/);
    assert.match(SECCION, /TIPOS_WHATSAPP_CONFIGURABLES\.map\(\(t\) =>/);
    assert.match(SECCION, /type="checkbox"/);
    assert.match(SECCION, /\{ROTULO_WHATSAPP\[t\]\}/);
    assert.match(SECCION, /cuota mensual del plan/);
    assert.match(SECCION, /tope diario del número/);
    assert.match(SECCION, /El correo no cambia/);
  });

  it('si el plan no trae WhatsApp lo dice con el aviso del módulo y deshabilita la lista', () => {
    assert.match(SECCION, /const sinPlan = planWhatsapp === false;/);
    assert.match(SECCION, /\{sinPlan && <AvisoModulo modulo="whatsapp_avisos" \/>\}/);
    assert.match(SECCION, /<fieldset disabled=\{sinPlan\}/);
  });

  it('guarda con PATCH a la ficha, sólo con la lista en orden fijo, y recarga al terminar', () => {
    assert.match(SECCION, /api\(`\/api\/complejos\/\$\{complejoId\}`, \{ method: 'PATCH', json: \{ whatsapp_avisos: TIPOS_WHATSAPP_CONFIGURABLES\.filter\(\(t\) => sel\.includes\(t\)\) \} \}\)/);
    assert.match(SECCION, /onGuardado\(\);/);
    assert.match(SECCION, /disabled=\{!cambio \|\| busy\}/);
  });

  it('la sección no aparece en el formulario de edición (la lista se guarda aparte, con su botón)', () => {
    assert.ok(!MODAL.includes('whatsapp_avisos: v.'), 'el formulario de Editar no envía la lista');
  });
});

describe('API de la ficha', () => {
  it('complejos.ts valida la lista contra los siete tipos, sin repetidos, y devuelve si el plan trae WhatsApp', () => {
    assert.match(RUTA, /whatsapp_avisos: z\s*\.array\(z\.enum\(TIPOS_WHATSAPP_CONFIGURABLES/);
    assert.match(RUTA, /\.refine\(\(lista\) => new Set\(lista\)\.size === lista\.length, 'Hay tipos de aviso repetidos'\)/);
    assert.match(RUTA, /whatsapp_plan: conWhatsapp\.has\(c\.id as number\)/);
    assert.match(RUTA, /moduloActivo\(id as number, 'whatsapp_avisos'\)/);
  });
});
