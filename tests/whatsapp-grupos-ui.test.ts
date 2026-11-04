// Pantalla «WhatsApp»: contador de mensajes y «Mis grupos». Pruebas de los textos y cálculos (puros) y de FUENTE de la UI (regex sobre el .tsx).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { esSugerido } from '../src/server/services/canales/gruposTipos';
import { ORDEN_TIPOS, ROTULO_TIPO, filtrarGrupos, porcentajeDeTope, textoDestino, textoSincronizado, textoTope, tonoDeTope } from '../src/pages/admin/_parts/whatsapp/tipos';
import type { CondominioConBlocks, GrupoGuardado } from '../src/pages/admin/_parts/whatsapp/tipos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const pantalla = f('src/pages/admin/WhatsappSync.tsx');
const misGrupos = f('src/pages/admin/_parts/whatsapp/MisGrupos.tsx');
const contador = f('src/pages/admin/_parts/whatsapp/ContadorWhatsapp.tsx');

const g = (id: number, nombre: string, extra: Partial<GrupoGuardado> = {}): GrupoGuardado => ({ id, nombre, miembros: 10, en_uso: false, destino: null, complejo_id: null, estructura_id: null, ya_no_esta: false, aviso: null, sincronizado_at: null, ...extra });
const condominios: CondominioConBlocks[] = [{ id: 1, nombre: 'Los Libertadores', estructuras: [{ id: 10, nombre: 'Block 3' }, { id: 11, nombre: 'Torre A' }, { id: 12, nombre: null }] }];

describe('contador: cálculos y textos', () => {
  it('«12 de 200» o sólo el número sin tope; el porcentaje se queda en 100 y sin tope es 0', () => {
    assert.equal(textoTope(12, 200), '12 de 200');
    assert.equal(textoTope(12, null), '12');
    assert.equal(porcentajeDeTope(50, 200), 25);
    assert.equal(porcentajeDeTope(250, 200), 100);
    assert.equal(porcentajeDeTope(5, null), 0);
    assert.equal(porcentajeDeTope(5, 0), 0);
  });

  it('la barra se pone ámbar desde el 70 % y roja desde el 90 %', () => {
    assert.deepEqual([0, 69, 70, 89, 90, 100].map(tonoDeTope), ['ok', 'ok', 'warn', 'warn', 'bad', 'bad']);
  });

  it('todos los tipos del servidor tienen su nombre en español', () => {
    assert.deepEqual([...ORDEN_TIPOS].sort(), ['cierre_pendiente', 'comunicado', 'grupo', 'otros', 'por_vencer', 'recibo_emitido', 'vence_hoy', 'vencido']);
    for (const t of ORDEN_TIPOS) assert.ok(ROTULO_TIPO[t].length > 3);
  });

  it('la pantalla usa la API de uso, con barras para el tope de hoy y la cuota de cada condominio, y sin mostrar identificadores', () => {
    assert.match(contador, /useResource<UsoWhatsapp>\('\/api\/whatsapp\/uso'\)/);
    assert.match(contador, /<Medidor titulo="Enviados hoy"/);
    assert.match(contador, /d\.mes\.condominios\.map/);
    assert.match(contador, /label=\{`Cuota mensual de \$\{c\.nombre\}`\}/);
    assert.match(contador, /mañana: hoy se alcanzó el tope diario/);
    assert.doesNotMatch(contador, /jid/i);
  });
});

describe('Mis grupos: buscador y textos', () => {
  const todos = [g(1, 'Vecinos Block 3', { en_uso: true }), g(2, 'Administración'), g(3, 'Junta Torre Ñandú', { en_uso: true }), g(4, 'Proveedores')];

  it('busca sin importar mayúsculas ni tildes, y «sólo los que uso» deja los que están en uso', () => {
    assert.deepEqual(filtrarGrupos(todos, 'administracion').map((x) => x.id), [2]);
    assert.deepEqual(filtrarGrupos(todos, 'ÑANDU').map((x) => x.id), [3]);
    assert.deepEqual(filtrarGrupos(todos, '').map((x) => x.id), [1, 2, 3, 4]);
    assert.deepEqual(filtrarGrupos(todos, '  ', true).map((x) => x.id), [1, 3]);
    assert.deepEqual(filtrarGrupos(todos, 'junta', true).map((x) => x.id), [3]);
    assert.deepEqual(filtrarGrupos(todos, 'zzz'), []);
  });

  it('dice a quién representa: vecinos o junta de un block (del Block 3, de la Torre A), o todo el condominio', () => {
    assert.equal(textoDestino({ destino: 'block', complejo_id: 1, estructura_id: 10 }, condominios), 'Vecinos del Block 3');
    assert.equal(textoDestino({ destino: 'junta_block', complejo_id: 1, estructura_id: 11 }, condominios), 'Junta de la Torre A');
    assert.equal(textoDestino({ destino: 'block', complejo_id: 1, estructura_id: 12 }, condominios), 'Vecinos del Block 12');
    assert.equal(textoDestino({ destino: 'condominio', complejo_id: 1, estructura_id: null }, condominios), 'Todo el condominio Los Libertadores');
    assert.equal(textoDestino({ destino: 'block', complejo_id: 9, estructura_id: 99 }, condominios), 'Vecinos de un block', 'si el block ya no existe no inventa un nombre');
  });

  it('cuándo se trajeron los grupos, o que aún no', () => {
    assert.equal(textoSincronizado(null), 'Aún no has traído tus grupos');
    assert.match(textoSincronizado('2026-11-03T15:42:00Z'), /^Traídos el 3 nov/);
  });

  it('qué grupos vienen marcados al publicar: para un block, los vecinos de ESE block; para todo el condominio, los de cada block y los del condominio; nunca las juntas', () => {
    const block = { destino: 'block', estructura_id: 10 };
    assert.equal(esSugerido(block, 10), true);
    assert.equal(esSugerido(block, 11), false);
    assert.equal(esSugerido(block, null), true);
    assert.equal(esSugerido({ destino: 'condominio', estructura_id: null }, null), true);
    assert.equal(esSugerido({ destino: 'condominio', estructura_id: null }, 10), false);
    assert.equal(esSugerido({ destino: 'junta_block', estructura_id: 10 }, 10), false);
    assert.equal(esSugerido({ destino: 'junta_block', estructura_id: 10 }, null), false);
  });
});

describe('pantalla WhatsApp: fuente', () => {
  it('con el número conectado muestra el contador y «Mis grupos»; sin conectar, sólo el QR', () => {
    assert.match(pantalla, /\{status === 'connected' && \(\s*<>\s*<ContadorWhatsapp \/>\s*<MisGrupos \/>\s*<\/>\s*\)\}/);
  });

  it('«Traer mis grupos» hace UNA llamada (POST), avisa que tarda y la lista sale de GET; el JID nunca viaja', () => {
    assert.match(misGrupos, /api<Datos>\('\/api\/whatsapp\/grupos\/sincronizar', \{ method: 'POST' \}\)/);
    assert.match(misGrupos, /useResource<Datos>\('\/api\/whatsapp\/grupos'\)/);
    assert.match(misGrupos, /Puede tardar hasta 30 segundos/);
    assert.match(misGrupos, /`\/api\/whatsapp\/grupos\/\$\{g\.id\}`, \{ method: 'PUT', json: cuerpo \}/);
    assert.doesNotMatch(misGrupos, /jid/i);
  });

  it('cada grupo tiene su interruptor «Usar en Torre», el selector de a quién representa y «Ya no estás en este grupo»', () => {
    assert.match(misGrupos, /label=\{`Usar «\$\{g\.nombre\}» en Torre`\}/);
    assert.match(misGrupos, /<Select label="Este grupo es de…"/);
    assert.match(misGrupos, /<Select label="Condominio"/);
    assert.match(misGrupos, /<Select label="Block"/);
    assert.match(misGrupos, /Ya no estás en este grupo/);
    assert.match(misGrupos, /<SearchBox value=\{q\} onChange=\{setQ\} placeholder="Buscar un grupo"/);
  });

  it('a 390 px: la fila se apila (flex + grid), los textos largos se parten y los selectores pasan a tres columnas sólo desde sm', () => {
    assert.match(misGrupos, /<li className="grid gap-3 px-4 py-3 sm:px-5">/);
    assert.match(misGrupos, /className="break-words font-medium"/);
    assert.match(misGrupos, /grid gap-3 rounded border border-line bg-surface2 p-3 sm:grid-cols-3/);
    assert.match(contador, /grid gap-5 sm:grid-cols-2/);
    assert.match(pantalla, /grid max-w-3xl gap-6 p-4 sm:p-6/);
  });

  it('apagar un grupo que aún no estaba guardado sólo cierra el editor (no llama al servidor)', () => {
    assert.match(misGrupos, /if \(g\.en_uso\) void enviar\(\{ en_uso: false \}[^;]*; else setEditando\(false\)/);
  });
});
