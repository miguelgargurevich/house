// Archivo que ya no existe tras un redespliegue: la app recarga sola hasta 3 veces en 2 minutos (con 3 s de espera), no una sola vez.
// Durante el cambio de contenedor el proxy reparte entre el viejo y el nuevo, y una sola recarga inmediata podía volver a fallar.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const EB = readFileSync('src/app/ErrorBoundary.tsx', 'utf8');

describe('recarga por versión nueva', () => {
  it('reintenta hasta 3 veces en 2 minutos, esperando 3 s antes de recargar', () => {
    assert.match(EB, /const INTENTOS = 3;/);
    assert.match(EB, /const VENTANA_MS = 120_000;/);
    assert.match(EB, /setTimeout\(\(\) => location\.reload\(\), ESPERA_MS\)/);
    assert.match(EB, /if \(previas\.length >= INTENTOS\) return false;/);
  });
  it('un valor viejo guardado (un número suelto) no rompe ni deja recargar sin límite', () => {
    assert.match(EB, /Array\.isArray\(guardado\) \? guardado : \[\]/);
  });
});
