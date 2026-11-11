// Qué dirección carga la app. Por defecto, Torre en producción. Para desarrollo: TORRE_URL=http://10.0.2.2:4000 (el emulador de Android
// ve el Mac como 10.0.2.2). `produccion` (o TORRE_URL vacío con --produccion) ignora la variable: es lo que usa el build de tienda.
const fs = require('node:fs');
const path = require('node:path');

const PRODUCCION = 'https://torrecondominios.com';
const INICIO = '/login'; // igual que start_url del manifest de la PWA: quien tiene sesión entra directo a su pantalla

function urlTorre(produccion = process.argv.includes('--produccion')) {
  const x = (produccion ? '' : process.env.TORRE_URL || '').trim().replace(/\/+$/, '');
  if (!x) return PRODUCCION;
  if (!/^https?:\/\/[^/\s]+$/.test(x)) throw new Error(`TORRE_URL inválida: «${x}». Usa algo como http://10.0.2.2:4000 (sin ruta).`);
  return x;
}

const version = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
const esProduccion = (url) => url === PRODUCCION;

module.exports = { PRODUCCION, INICIO, urlTorre, version, esProduccion };
