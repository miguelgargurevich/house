// Cambia la versión de la app en un solo paso (package.json, Android vía build.gradle e iOS en el proyecto de Xcode).
// Uso: npm run version -- 1.1.0 [build]     (si no das build, sube 1 al actual)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const [version, buildArg] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) { console.error('Uso: npm run version -- 1.1.0 [build]'); process.exit(1); }

const rutaPkg = join(raiz, 'package.json');
const pkg = JSON.parse(readFileSync(rutaPkg, 'utf8'));
const build = buildArg ? Number(buildArg) : (pkg.torre?.build ?? 0) + 1;
if (!Number.isInteger(build) || build < 1) { console.error('El build debe ser un entero >= 1.'); process.exit(1); }
if (build <= (pkg.torre?.build ?? 0)) console.warn(`AVISO: el build ${build} no es mayor que el actual (${pkg.torre?.build}). Las tiendas rechazan un build repetido.`);

pkg.version = version;
pkg.torre = { ...pkg.torre, build };
writeFileSync(rutaPkg, JSON.stringify(pkg, null, 2) + '\n');

const rutaXcode = join(raiz, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
let x = readFileSync(rutaXcode, 'utf8');
x = x.replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`).replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
writeFileSync(rutaXcode, x);

console.log(`Versión ${version} (build ${build}). Falta: npm run sync:prod para que el user agent «TorreApp/${version}» llegue a las apps.`);
