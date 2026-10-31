// Registro público, paso 1 de 2 (sólo la cuenta; el condominio se pide en `/admin/bienvenida`, ver `registro-dos-pasos-ui.test.ts`): la presentación
// (indicador de pasos, celular en su fila, panel de marca junto al formulario) y lo que NO cambia (el señuelo antiabuso y las reglas de la contraseña).
// Estructura fijada con la fuente, como el resto de *-ui.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const registro = fuente('src/pages/publico/Registro.tsx');
const panel = fuente('src/pages/publico/_parts/PanelRegistro.tsx');

describe('Registro: paso 1 de 2, sólo la cuenta', () => {
  it('dice «Paso 1 de 2: tu cuenta», que el condominio se crea después, y muestra el indicador de pasos en el paso 1', () => {
    assert.match(registro, /Paso 1 de 2: tu cuenta/);
    assert.match(registro, /tu condominio lo creas después, al entrar/);
    assert.match(registro, /<IndicadorPasos actual=\{1\} \/>/);
  });

  it('ya no pide nada del condominio: ni administradora o junta, ni nombre del condominio, ni departamentos', () => {
    for (const k of ['empresa', 'condominio', 'unidades']) assert.doesNotMatch(registro, new RegExp(`campo\\('${k}'\\)`), k);
    assert.doesNotMatch(registro, /Tu condominio<|Nombre de tu administradora|N\.º de departamentos|unidades/);
    assert.match(registro, /interface Formulario \{ nombre: string; email: string; celular: string; password: string \}/);
  });

  it('se envían sólo los datos de la cuenta, con los Términos y el señuelo', () => {
    for (const k of ['nombre', 'email', 'password']) assert.match(registro, new RegExp(`campo\\('${k}'\\)`), k);
    assert.match(registro, /'\/api\/publico\/registro', \{ method: 'POST', json: \{ \.\.\.f, email: f\.email\.trim\(\), acepta_terminos: acepta, sitio_web: señuelo \} \}/);
  });

  it('«Revisa tu correo» recuerda que falta el paso 2 (crear el condominio al entrar)', () => {
    assert.match(registro, /Paso 1 de 2 listo\. Cuando confirmes tu correo, entra y crea tu condominio\./);
  });

  it('el señuelo sigue oculto a las personas y fuera del orden de tabulación', () => {
    assert.match(registro, /<div aria-hidden="true" className="absolute -left-\[9999px\]/);
    assert.match(registro, /tabIndex=\{-1\}/);
  });

  it('el celular va en su propia fila: ningún contenedor con grilla lo envuelve (volver a la columna lo rompe)', () => {
    const hastaCelular = registro.slice(0, registro.indexOf('<TelefonoInput label="Celular"'));
    const contenedor = hastaCelular.slice(hastaCelular.lastIndexOf('<div'));
    assert.doesNotMatch(contenedor, /grid/);
  });

  it('la contraseña tiene el ojito (mostrar y ocultar, con etiqueta y estado para el lector de pantalla)', () => {
    assert.match(registro, /type=\{verClave \? 'text' : 'password'\}/);
    assert.match(registro, /aria-label=\{verClave \? 'Ocultar contraseña' : 'Mostrar contraseña'\}/);
    assert.match(registro, /aria-pressed=\{verClave\}/);
  });

  it('la regla de la contraseña se ve en vivo con las reglas compartidas (no un texto fijo que puede desfasarse)', () => {
    assert.match(registro, /reglasClave\(f\.password, ''\)\.slice\(0, 2\)/);
    assert.match(registro, /import \{ reglasClave \} from '\.\/_parts\/clave';/);
  });

  it('tope de largo intacto: nombre 120, correo 160, contraseña 72', () => {
    assert.match(registro, /maxLength=\{120\}/);
    assert.match(registro, /type="email" autoComplete="email" maxLength=\{160\}/);
    assert.match(registro, /maxLength=\{72\}/);
  });
});

describe('Registro: el panel de marca junto al formulario', () => {
  it('el formulario va antes que el panel en el árbol: en celular, una columna con el formulario primero', () => {
    assert.ok(registro.indexOf('<form') > 0);
    assert.ok(registro.indexOf('<form') < registro.indexOf('<PanelRegistro />'));
    assert.match(registro, /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(0,1\.05fr\)\]/);
  });

  it('el panel dice el mismo tope de departamentos del plan Gratis que el servidor', () => {
    assert.match(panel, /Torre Gratis por 3 meses, sin tope de departamentos\./);
  });

  it('el panel también dice «Paso 1 de 2: tu cuenta» y que el condominio se crea después de confirmar el correo', () => {
    assert.match(panel, /Paso 1 de 2: tu cuenta\. Tu condominio lo creas después de confirmar tu correo\./);
  });

  it('las tarjetas de ejemplo son decorativas para el lector de pantalla; la lista de beneficios sí se lee', () => {
    assert.match(panel, /<aside aria-labelledby="panel-registro-titulo"/);
    assert.match(panel, /<div aria-hidden="true" className="mt-8 space-y-3">/);
    assert.match(panel, /<ul className="mt-6 space-y-2\.5 text-sm">/);
  });

  it('sin círculos ni desenfoques de fondo, y sólo colores por token (nada de bg-white, bg-gray-…)', () => {
    assert.doesNotMatch(panel, /\bblur-|rounded-full[^"]*absolute/);
    assert.doesNotMatch(panel + registro, /\b(bg|text)-(white|black|gray|slate|zinc|teal|green|emerald)-\d*/);
    assert.match(panel, /bg-escena p-6 text-on-escena/);
  });
});
