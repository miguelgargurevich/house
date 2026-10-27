// Tipo de unidad en el formulario y en la lista: la etiqueta bonita, el valor canónico y el tipo que llega de la base.
// El repo no tiene testing-library: el formulario se fija con tests de fuente y el módulo puro se importa.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { etiquetaTipoUnidad, normalizarTipoUnidad, TIPOS_UNIDAD } from '../src/pages/admin/_parts/unidades/tipoUnidad';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const MODAL = 'src/pages/admin/_parts/unidades/ModalDeUnidad.tsx';
const LISTA = 'src/pages/admin/_parts/unidades/ListaDeUnidades.tsx';

describe('lista de tipos: valor canónico y etiqueta', () => {
  it('los valores van en minúscula, sin tilde, y la etiqueta lleva la tilde', () => {
    assert.deepEqual(TIPOS_UNIDAD.map(t => t.value), ['departamento', 'casa', 'local', 'estacionamiento', 'deposito']);
    assert.equal(TIPOS_UNIDAD.find(t => t.value === 'deposito')?.label, 'Depósito');
    assert.equal(TIPOS_UNIDAD.find(t => t.value === 'departamento')?.label, 'Departamento');
  });

  it('normalizar quita mayúsculas, tildes y espacios', () => {
    assert.equal(normalizarTipoUnidad('Depósito'), 'deposito');
    assert.equal(normalizarTipoUnidad('  DEPARTAMENTO '), 'departamento');
    assert.equal(normalizarTipoUnidad('departamento'), 'departamento');
  });

  it('una unidad con tipo viejo («Departamento», «Depósito») se muestra con su etiqueta', () => {
    assert.equal(etiquetaTipoUnidad('departamento'), 'Departamento');
    assert.equal(etiquetaTipoUnidad('Depósito'), 'Depósito');
    assert.equal(etiquetaTipoUnidad('deposito'), 'Depósito');
  });

  it('un tipo que no está en la lista se muestra tal cual, sin romper la vista', () => {
    assert.equal(etiquetaTipoUnidad('Bodega'), 'Bodega');
  });
});

describe('formulario de unidad: el select preselecciona el tipo de la unidad', () => {
  it('al editar, el tipo se normaliza antes de ponerlo en el select (no queda vacío)', () => {
    assert.match(fuente(MODAL), /tipo: normalizarTipoUnidad\(unidad\.tipo\)/);
  });

  it('una unidad nueva nace con departamento', () => {
    assert.match(fuente(MODAL), /tipo: 'departamento'/);
  });

  it('las opciones usan el valor canónico y la etiqueta', () => {
    assert.match(fuente(MODAL), /<option key=\{t\.value\} value=\{t\.value\}>\{t\.label\}<\/option>/);
  });

  it('un tipo viejo fuera de la lista aparece como opción para no dejar el select vacío', () => {
    assert.match(fuente(MODAL), /!TIPOS_UNIDAD\.some\(t => t\.value === tipoElegido\)/);
  });
});

describe('lista de unidades: muestra la etiqueta, no el valor guardado', () => {
  it('la columna y la línea del móvil usan etiquetaTipoUnidad', () => {
    const src = fuente(LISTA);
    assert.match(src, /cell: f => etiquetaTipoUnidad\(f\.tipo\)/);
    assert.match(src, /\{etiquetaTipoUnidad\(f\.tipo\)\}\{f\.estructura/);
  });
});
