// Prepara `www/` (lo único local que lleva la app: la pantalla «sin conexión») con la dirección de Torre que toca.
// Se corre solo dentro de `npm run sync`. `--produccion` ignora TORRE_URL.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { urlTorre, INICIO, esProduccion } = require('./entorno.cjs');
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const url = urlTorre();
const plantilla = readFileSync(join(raiz, 'www-src', 'offline.html'), 'utf8');
mkdirSync(join(raiz, 'www'), { recursive: true });
writeFileSync(join(raiz, 'www', 'offline.html'), plantilla.replace('__TORRE_DESTINO__', `${url}${INICIO}`));
// Capacitor exige un index.html en webDir aunque la app cargue la web remota.
writeFileSync(join(raiz, 'www', 'index.html'), `<!doctype html><meta charset="utf-8"><title>Torre</title><meta http-equiv="refresh" content="0;url=${url}${INICIO}">`);

console.log(esProduccion(url) ? `Torre: PRODUCCION (${url})` : `ATENCION: build de DESARROLLO apuntando a ${url}. No lo subas a una tienda.`);
