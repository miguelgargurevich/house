// La marca es «Torre»: ninguna pantalla pública ni asunto o cuerpo de correo vuelve a decir «House».
// Se fija con la fuente porque estos textos son JSX y plantillas que las pruebas no pintan. Los comentarios no cuentan.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const recorrer = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const ruta = join(dir, n);
    if (statSync(ruta).isDirectory()) return recorrer(ruta);
    return /\.(ts|tsx)$/.test(n) ? [ruta] : [];
  });

const lineasVisibles = (ruta: string) => readFileSync(ruta, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(l));

const PANTALLAS_PUBLICAS = [...recorrer('src/pages/publico'), 'src/pages/Login.tsx'];
const CORREOS = [
  ...recorrer('src/server/services/avisos'),
  'src/server/services/invitaciones.ts',
  'src/server/services/comercial/registro.ts',
  'src/server/services/comercial/vencimientos.ts',
  'src/server/services/comercial/plazoGratis.ts',
];

describe('la marca es Torre en lo que ve la persona', () => {
  for (const ruta of [...PANTALLAS_PUBLICAS, ...CORREOS]) {
    it(`${ruta} no dice «House» fuera de los comentarios`, () => {
      assert.deepEqual(lineasVisibles(ruta).filter((l) => /\bHouse\b/.test(l)), []);
    });
  }

  it('el login muestra la marca Torre', () => {
    assert.match(readFileSync('src/pages/Login.tsx', 'utf8'), /<span className="text-xl">Torre<\/span>/);
  });
});
