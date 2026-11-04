// Comunicados a departamentos elegidos y recordatorio a los morosos: pruebas de FUENTE de la UI (regex sobre el .tsx) y de los textos puros.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ELEGIDOS, alcanceLabel, codigosElegidos, textoPublicado } from '../src/pages/admin/_parts/comunicados/tipos';
import { textoDepartamentos, textoEnviado } from '../src/pages/admin/_parts/morosidad/tipos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const COM = 'src/pages/admin/_parts/comunicados/';
const MOR = 'src/pages/admin/_parts/morosidad/';
const modal = f(`${COM}ComunicadoModal.tsx`);
const elegir = f(`${COM}ElegirDepartamentos.tsx`);
const morosidad = f('src/pages/admin/Morosidad.tsx');
const recordatorio = f(`${MOR}RecordatorioDeudaModal.tsx`);

describe('comunicados a departamentos elegidos: la pantalla', () => {
  it('«Para quién» tiene la opción «Departamentos elegidos»; la junta de un block también la ve (el selector ya no va bloqueado)', () => {
    assert.match(modal, /<option value=\{ELEGIDOS\}>Departamentos elegidos<\/option>/);
    assert.equal(ELEGIDOS, 'elegidos');
    assert.doesNotMatch(modal, /disabled=\{ambitos\.fijo\}/);
  });

  it('con departamentos elegidos van `unidades` y SIN junta ni grupos; sin marcar ninguno no se envía', () => {
    assert.match(modal, /if \(elegidos && unidadesSel\.length === 0\) \{ toast\.error\('Marca al menos un departamento'\); return; \}/);
    const rama = /json: elegidos\s*\/\/[^\n]*\n\s*\? (\{[^\n]*\})\n/.exec(modal)?.[1] ?? '';
    assert.match(rama, /unidades: unidadesSel/);
    assert.doesNotMatch(rama, /enviar_junta|enviar_grupo|grupos:/, 'con elegidos la API rechaza junta y grupos');
  });

  it('esconde la junta y los grupos de WhatsApp con elegidos, y lo explica', () => {
    assert.match(modal, /\{!elegidos && \(\s*<Interruptor\s+label=\{estructuraId \? `A la junta/);
    assert.match(modal, /\{nuevo && !elegidos && \(\s*<fieldset className="grid gap-2 sm:col-span-2">\s*<legend[^>]*>A los grupos de WhatsApp/);
    assert.match(modal, /No va a la junta ni a los grupos de WhatsApp/);
  });

  it('la junta de un block elige dentro de SU block (sin selector de block); el admin elige el block o todo el condominio', () => {
    assert.match(modal, /const estructuraEfectiva = elegidos \? \(ambitos\.fijo \? String\(bloques\[0\]\?\.id \?\? ''\) : bloqueElegidos\) : estructuraId;/);
    assert.match(modal, /\{elegidos && !ambitos\.fijo && \(\s*<Select label=\{`De qué \$\{palabra\.una\} los eliges`\}/);
  });

  it('al cambiar de condominio o block se limpian los marcados', () => {
    assert.match(modal, /useEffect\(\(\) => \{ setUnidadesSel\(\[\]\); \}, \[complejoId, estructuraEfectiva, comunicado\]\);/);
  });
});

describe('comunicados a departamentos elegidos: la lista para marcar', () => {
  it('usa la lista de la API del alcance, con buscador y «Marcar todos» / «Quitar marcas» (de los que se ven)', () => {
    assert.match(elegir, /\/api\/comunicados\/departamentos\?/);
    assert.match(elegir, /<SearchBox/);
    assert.match(elegir, />Marcar todos\{q\.trim\(\) \? ' los que se ven' : ''\}</);
    assert.match(elegir, />Quitar marcas</);
    assert.match(elegir, /const marcarVisibles = \(\) => onChange\(\[\.\.\.new Set\(\[\.\.\.value, \.\.\.visibles\.map\(x => x\.id\)\]\)\]\);/);
  });

  it('busca por código y titular sin importar tildes ni mayúsculas', () => {
    assert.match(elegir, /norm\(`\$\{x\.codigo\} \$\{x\.titular \?\? ''\}`\)\.includes\(t\)/);
    assert.match(elegir, /normalize\('NFD'\)\.replace\(\/\\p\{M\}\/gu, ''\)\.toLowerCase\(\)/);
  });

  it('se usa a 375 px: filas de 44 px, lista con scroll propio, textos que no se salen', () => {
    assert.match(elegir, /min-h-11/);
    assert.match(elegir, /max-h-72 overflow-y-auto/);
    assert.match(elegir, /break-words/);
    assert.match(elegir, /flex flex-wrap items-center gap-2/);
  });

  it('cada casilla se lee por su texto (código y titular) y el contador avisa al lector de pantalla', () => {
    assert.match(elegir, /<label className="flex min-h-11 cursor-pointer items-center gap-3[^"]*">\s*<input type="checkbox"/);
    assert.match(elegir, /aria-live="polite"/);
  });
});

describe('Morosidad: recordatorio a los marcados', () => {
  it('casilla por fila, «Marcar todos los de esta página» (indeterminada si sólo algunas) y botón «Enviar recordatorio»', () => {
    assert.match(morosidad, /aria-label=\{`Marcar la unidad \$\{texto\(m\.unidad\)\} para el recordatorio`\}/);
    assert.match(morosidad, /<span className="font-medium">Marcar todos los de esta página<\/span>/);
    assert.match(morosidad, /cabeceraRef\.current\.indeterminate = marcadasEnPagina > 0 && !todasEnPagina/);
    assert.match(morosidad, />Enviar recordatorio<\/Button>/);
  });

  it('el botón se apaga sin marcados, con más de 500 y en solo lectura; cambiar de condominio o block limpia las marcas', () => {
    assert.match(morosidad, /disabled=\{marcadas\.size === 0 \|\| marcadas\.size > MAX_RECORDATORIO \|\| b\}/);
    assert.match(morosidad, /const MAX_RECORDATORIO = 500;/);
    assert.match(morosidad, /<Bloqueable>\{b => <Button icon=\{<PaperAirplaneIcon/);
    assert.match(morosidad, /useEffect\(\(\) => \{ setMarcadas\(new Map\(\)\); \}, \[complejo, torre\]\);/);
  });

  it('marcar todos conserva lo marcado en otras páginas y sólo toca las filas con unidad', () => {
    assert.match(morosidad, /const alternarPagina = \(\) => setMarcadas\(prev => \{ const n = new Map\(prev\); for \(const f of filasMarcables\) \{ if \(todasEnPagina\) n\.delete\(f\.id\); else n\.set\(f\.id, f\.codigo\); \} return n; \}\);/);
    assert.match(morosidad, /const filasMarcables = list\.items\.flatMap\(m => \{ const id = idUnidad\(m\); return id != null \? \[\{ id, codigo: texto\(m\.unidad\) \}\] : \[\]; \}\);/);
  });

  it('la casilla de la fila no abre el detalle (la fila entera es tocable)', () => {
    // `vieneDeControlInterno` deja pasar los input: el clic en la casilla no dispara `onRowClick`.
    assert.match(f('src/ui/a11y.ts'), /INTERACTIVOS = '[^']*\binput\b/);
  });
});

describe('Morosidad: el modal del recordatorio', () => {
  it('la vista previa pide `confirmar: false` y SÓLO «Enviar» pide `confirmar: true`', () => {
    const previa = /json: \{ unidades: ids, canales, confirmar: false \}/.exec(recordatorio);
    const envio = /json: \{ unidades: ids, canales, confirmar: true \}/.exec(recordatorio);
    assert.ok(previa && envio, 'las dos llamadas');
    assert.equal(recordatorio.match(/confirmar: true/g)?.length, 1);
    assert.ok(recordatorio.indexOf('async function enviar') < envio!.index && envio!.index > previa!.index);
  });

  it('se recalcula la vista previa al cambiar canales y no se puede enviar sin nadie que reciba', () => {
    assert.match(recordatorio, /const clave = `\$\{ids\.join\(','\)\}\|\$\{correo\}\|\$\{whatsapp\}`;/);
    assert.match(recordatorio, /disabled=\{cargando \|\| !plan \|\| plan\.por_avisar === 0\}/);
    assert.match(recordatorio, /Elige al menos un canal/);
  });

  it('muestra lo pedido: responsables, por correo, por WhatsApp, sin canal, ya recibieron hoy, la cuota de WhatsApp y el texto', () => {
    for (const t of ['Recibirán el recordatorio', 'Por correo', 'Por WhatsApp', 'Responsables de pago', 'Sin canal activo', 'Ya recibieron uno hoy', 'Así lo recibe cada responsable']) assert.ok(recordatorio.includes(t), t);
    assert.match(recordatorio, /Quedan \$\{w\.restantes\} de \$\{w\.tope\} mensajes este mes\./);
    assert.match(recordatorio, /no alcanza para todos/);
  });

  it('el texto del mensaje es TEXTO (con sus saltos de línea), nunca HTML', () => {
    assert.match(recordatorio, /whitespace-pre-line break-words/);
    for (const a of [recordatorio, elegir, f(`${MOR}tipos.ts`)]) assert.doesNotMatch(a, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/);
  });

  it('sin emojis en las pantallas nuevas', () => {
    for (const a of [recordatorio, elegir, modal, morosidad]) assert.doesNotMatch(a, /\p{Extended_Pictographic}/u);
  });
});

describe('textos de los comunicados y del recordatorio', () => {
  it('«Para quién» dice cuántos departamentos y dónde; la lista, sus códigos', () => {
    assert.equal(alcanceLabel({ estructura: null }), 'Todo el condominio');
    assert.equal(alcanceLabel({ estructura: { id: 1, nombre: 'Block 1' } }), 'Block 1');
    assert.equal(alcanceLabel({ estructura: { id: 1, nombre: 'Block 1' }, unidades: [3] }), '1 departamento elegido · Block 1');
    assert.equal(alcanceLabel({ estructura: null, unidades: [3, 4, 5] }), '3 departamentos elegidos · Todo el condominio');
    assert.equal(codigosElegidos({ departamentos: [] }), null);
    assert.equal(codigosElegidos({}), null);
    assert.equal(codigosElegidos({ departamentos: [{ id: 1, codigo: 'A-101' }, { id: 2, codigo: 'A-103' }] }), 'A-101, A-103');
    assert.equal(codigosElegidos({ departamentos: ['A-1', 'A-2', 'A-3', 'A-4', 'A-5', 'A-6'].map((codigo, id) => ({ id, codigo })) }), 'A-1, A-2, A-3, A-4 y 2 más');
  });

  it('al publicar dice a cuántos departamentos', () => {
    const base = { enviar_correo: true, enviar_whatsapp: false, enviar_junta: false, enviar_grupo: false, grupos_resultado: null };
    assert.equal(textoPublicado({ ...base, avisos_encolados: 3, unidades: [1, 2] }), 'Comunicado publicado para 2 departamentos. Se encolaron 3 avisos por correo.');
    assert.equal(textoPublicado({ ...base, avisos_encolados: 1, unidades: [1] }), 'Comunicado publicado para 1 departamento. Se encolaron 1 aviso por correo.');
    assert.equal(textoPublicado({ ...base, avisos_encolados: 0, unidades: [1] }), 'Comunicado publicado para 1 departamento. Nadie tiene activado ese canal, así que no se envió ningún aviso.');
    assert.equal(textoPublicado({ ...base, avisos_encolados: 2 }), 'Comunicado publicado. Se encolaron 2 avisos por correo.', 'sin elegidos, como siempre');
  });

  it('al enviar el recordatorio dice cuántos avisos y por qué ninguno', () => {
    assert.equal(textoDepartamentos(1), '1 departamento');
    assert.equal(textoDepartamentos(3), '3 departamentos');
    assert.match(textoEnviado({ avisos_encolados: 4, por_avisar: 2 }), /^Recordatorio en camino: 4 avisos encolados para 2 departamentos\./);
    assert.match(textoEnviado({ avisos_encolados: 1, por_avisar: 1 }), /1 aviso encolado para 1 departamento\./);
    assert.match(textoEnviado({ avisos_encolados: 0, por_avisar: 0 }), /ya se les recordó hoy o no tienen un canal activo/);
  });
});
