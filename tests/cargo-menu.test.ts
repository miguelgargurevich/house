// Rótulo del rol con el cargo en la junta (menú de arriba a la derecha y «Mi perfil»): rol, cargo y block.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rotuloRol } from '../src/app/nav';

const base = { rol: 'propietario' as const, cargo_junta: null, estructura_id: null, estructura_nombre: null };

describe('rotuloRol', () => {
  it('sin cargo, el rol de siempre', () => {
    assert.equal(rotuloRol(base), 'Propietario');
    assert.equal(rotuloRol({ ...base, rol: 'inquilino' }), 'Inquilino');
  });

  it('un cargo de block: rol · cargo del block', () => {
    const block = { ...base, estructura_id: 3, estructura_nombre: 'Block 1' };
    assert.equal(rotuloRol({ ...block, cargo_junta: 'tesorero' }), 'Propietario · Tesorero del Block 1');
    assert.equal(rotuloRol({ ...block, cargo_junta: 'presidente' }), 'Propietario · Presidente del Block 1');
    assert.equal(rotuloRol({ ...block, cargo_junta: 'secretario' }), 'Propietario · Secretario del Block 1');
    assert.equal(rotuloRol({ ...block, cargo_junta: 'vocal' }), 'Propietario · Vocal del Block 1');
  });

  it('la Junta central (sin block): rol · cargo de la Junta central, con cualquier cargo', () => {
    assert.equal(rotuloRol({ ...base, cargo_junta: 'presidente' }), 'Propietario · Presidente de la Junta central');
    assert.equal(rotuloRol({ ...base, cargo_junta: 'tesorero' }), 'Propietario · Tesorero de la Junta central');
    assert.equal(rotuloRol({ ...base, cargo_junta: 'vocal' }), 'Propietario · Vocal de la Junta central');
  });

  it('un block sin nombre no se menciona', () => {
    assert.equal(rotuloRol({ ...base, cargo_junta: 'tesorero', estructura_id: 3, estructura_nombre: null }), 'Propietario · Tesorero');
  });

  it('sin cargo, aunque venga un nombre de block, no se muestra nada del block', () => {
    assert.equal(rotuloRol({ ...base, estructura_id: 3, estructura_nombre: 'Block 1' }), 'Propietario');
  });
});
