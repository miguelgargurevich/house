// Pantalla «Personas del departamento». El repo no monta React en Node: la lógica va en funciones puras (`tipos.ts`, `vista.ts`) y el cableado se fija leyendo la fuente.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { RELACIONES, etiquetaRelacion, formDe, textoDeAcceso, type EstadoAcceso, type Persona } from '../src/pages/admin/_parts/unidades/personas/tipos';
import { hayQueGuardar, lineasDeResumen, type ResumenContactos } from '../src/pages/admin/_parts/contactos/vista';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const DIR = 'src/pages/admin/_parts/unidades/personas';
const cero: ResumenContactos = { filas: 0, filas_con_error: 0, filas_con_aviso: 0, correos_nuevos: 0, correos_cambiados: 0, celulares_nuevos: 0, celulares_cambiados: 0, propietarios_nuevos: 0, inquilinos_nuevos: 0, unidades_unidas: 0, cambian_quien_paga: 0, invitables: 0 };

describe('textos y formulario', () => {
  it('cada estado del acceso tiene su texto, sin emojis; las relaciones son las seis del servidor', () => {
    const estados: EstadoAcceso[] = ['sin_cuenta', 'apagado', 'sin_correo', 'sin_invitar', 'en_cola', 'invitado', 'entro'];
    for (const e of estados) assert.ok(textoDeAcceso(e).length > 10, e);
    assert.match(textoDeAcceso('en_cola'), /en cola/i);
    assert.match(textoDeAcceso('entro'), /entró/);
    assert.deepEqual(RELACIONES.map((r) => r.value), ['propietario', 'copropietario', 'conyuge', 'familiar', 'inquilino', 'otro']);
    assert.equal(etiquetaRelacion('conyuge'), 'Cónyuge');
  });

  it('el formulario de edición parte de la persona (correo y celular vacíos en lugar de null)', () => {
    const p: Persona = { id: 1, unidad_id: 2, nombre: 'Ana', relacion: 'familiar', correo: null, celular: '+51 987 654 321', responsable_pago: true, recibe_comunicados: false, acceso_activo: false, tiene_cuenta: false, estado_acceso: 'sin_cuenta', principal: false };
    assert.deepEqual(formDe(p), { nombre: 'Ana', relacion: 'familiar', correo: '', celular: '+51 987 654 321', responsable_pago: true, recibe_comunicados: false });
  });

  it('el resumen de la carga habla de las personas del departamento y las cuenta para poder guardar', () => {
    assert.deepEqual(lineasDeResumen({ ...cero, personas_nuevas: 2 }), ['Se agregan 2 personas a la lista de sus departamentos (sin usuario en Torre: eso se decide en Unidades).']);
    assert.match(lineasDeResumen({ ...cero, personas_cambiadas: 1 })[0]!, /Se completan los datos de 1 persona/);
    assert.equal(hayQueGuardar({ ...cero, personas_nuevas: 1 }, false), true);
    assert.equal(hayQueGuardar(cero, false), false);
  });
});

describe('cableado y usabilidad', () => {
  it('Unidades abre «Personas del departamento» desde cada fila', () => {
    const l = fuente('src/pages/admin/_parts/unidades/ListaDeUnidades.tsx');
    assert.match(l, /Personas del departamento \$\{f\.codigo\}/);
    assert.match(l, /<PersonasModal key=\{personas\?\.id \?\? 0\} unidad=/, 'con key: al abrir otro departamento no se ve la lista del anterior');
  });

  it('la lista llama a las rutas del servidor y usa el interruptor «Tiene usuario en Torre»', () => {
    const m = fuente(`${DIR}/PersonasModal.tsx`);
    assert.match(m, /\/api\/unidades\/\$\{unidad\.id\}\/personas/);
    assert.match(m, /\/acceso`, \{ method: 'PUT', json: \{ activo \} \}/);
    assert.match(m, /\/titular`, \{ method: 'PUT' \}/);
    assert.match(m, /<Interruptor[\s\S]*label="Tiene usuario en Torre"/);
    assert.match(m, /Paga/);
    assert.match(m, /Recibe comunicados/);
    const f = fuente(`${DIR}/PersonaFormModal.tsx`);
    assert.match(f, /method: 'POST'/);
    assert.match(f, /method: 'PUT'/);
    assert.match(f, /label="Responsable de pago"/);
    assert.match(f, /label="Recibe los comunicados"/);
  });

  it('usable a 375 px: tarjetas (sin tabla), texto que se parte y sin emojis', () => {
    for (const ruta of ['PersonasModal.tsx', 'PersonaFormModal.tsx', 'tipos.ts']) {
      const t = fuente(`${DIR}/${ruta}`);
      assert.equal(/<table/.test(t), false, ruta);
      assert.equal(/\p{Extended_Pictographic}/u.test(t), false, `${ruta}: sin emojis`);
    }
    const m = fuente(`${DIR}/PersonasModal.tsx`);
    assert.match(m, /break-words/);
    assert.match(m, /flex-wrap/);
    assert.match(m, /@heroicons\/react/);
  });

  it('nada de «push» ni «sube la rama» en la pantalla', () => {
    for (const ruta of ['PersonasModal.tsx', 'PersonaFormModal.tsx']) assert.equal(/\bpush\b|sube la rama/i.test(fuente(`${DIR}/${ruta}`)), false, ruta);
  });
});
