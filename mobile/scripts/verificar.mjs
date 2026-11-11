// Antes de generar un build de tienda: comprueba que la configuración que quedó DENTRO de las apps apunta a producción y no trae
// ninguna dirección de desarrollo. Falla (código 1) si encuentra algo.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { PRODUCCION, INICIO } = require('./entorno.cjs');
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const archivos = [
  'android/app/src/main/assets/capacitor.config.json',
  'ios/App/App/capacitor.config.json',
  'www/offline.html',
];
let mal = 0;
for (const rel of archivos) {
  const ruta = join(raiz, rel);
  if (!existsSync(ruta)) { console.log(`- ${rel}: no existe (¿falta \`npm run sync:prod\`? o la plataforma no está agregada)`); continue; }
  const t = readFileSync(ruta, 'utf8');
  const problemas = [];
  if (/10\.0\.2\.2|localhost|127\.0\.0\.1|192\.168\.|"cleartext"\s*:\s*true/.test(t.replace(/https:\/\/localhost/g, ''))) problemas.push('trae una dirección de desarrollo o cleartext');
  if (rel.endsWith('.json')) {
    const c = JSON.parse(t);
    if (c.server?.url !== `${PRODUCCION}${INICIO}`) problemas.push(`server.url es «${c.server?.url}» y debería ser ${PRODUCCION}${INICIO}`);
    if (c.android?.webContentsDebuggingEnabled || c.ios?.webContentsDebuggingEnabled) problemas.push('trae el depurador web encendido');
  }
  console.log(problemas.length ? `X ${rel}: ${problemas.join('; ')}` : `ok ${rel}`);
  mal += problemas.length;
}
if (mal) { console.error('\nNo generes el build de tienda: corre `npm run sync:prod` y vuelve a verificar.'); process.exit(1); }
