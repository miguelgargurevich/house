// Mide, por pantalla y ancho de ventana, cuánto contenido queda escondido detrás de un scroll horizontal (tablas con overflow-x), con las
// cuentas de prueba LOCALES (seed de Los Libertadores + `npm run junta-central:local`).
// Uso: node scripts/pruebas/anchos-tablas.mjs <carpeta-salida> [archivo.json]   (REINICIAR_BACKEND=<script> reinicia el backend antes de cada rol:
// la API local acepta 300 solicitudes cada 15 min por IP)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');
const APP = process.env.APP_URL ?? 'http://localhost:5173', S = process.argv[2], salida = process.argv[3] ?? 'anchos.json', REINICIAR = process.env.REINICIAR_BACKEND;
const ROLES = [
  ['admin', 'ana.lopez@gestionurbana.com', 'admin1234', ['/admin/dashboard','/admin/complejos','/admin/condominios/4','/admin/recibos','/admin/recibos/26','/admin/pagos','/admin/medios-pago','/admin/morosidad','/admin/cierres','/admin/unidades','/admin/residentes','/admin/personal','/admin/mantenimientos','/admin/conceptos','/admin/comunicados','/admin/avisos','/admin/juntas','/admin/proveedores','/admin/configuracion','/admin/mi-plan']],
  ['superadmin', 'miguel.gargurevich@admin.com', 'admin1234', ['/superadmin/empresas','/superadmin/usuarios','/superadmin/auditoria','/superadmin/suscripciones','/superadmin/llavero']],
  ['tesorera', 'patricia.alarcon.9@prueba.house', 'prop1234', ['/junta/pagos','/junta/cierre','/junta/agua','/junta/avisos','/junta/proveedores','/junta/comunicados','/propietario/cargos','/propietario/pagos']],
  ['central', 'gustavo.cruz.4@prueba.house', 'prop1234', ['/junta/aportes','/junta/cierre-central']],
];
const ANCHOS = [1024, 1280, 1440, 1920];
const b = await chromium.launch(); const filas = [];
for (const [rol, email, pw, rutas] of ROLES) {
  if (REINICIAR) execFileSync('bash', [REINICIAR], { stdio: 'ignore' });
  for (const w of ANCHOS) {
    const c = await b.newContext({ viewport: { width: w, height: 900 } });
    await c.request.post(APP + '/api/auth/login', { data: { email, password: pw } });
    const p = await c.newPage();
    for (const ruta of rutas) {
      await p.goto(APP + ruta); await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(250);
      const m = await p.evaluate(() => {
        const main = document.querySelector('main'); const out = [];
        for (const el of document.querySelectorAll('main *')) {
          const cs = getComputedStyle(el);
          if (!['auto', 'scroll'].includes(cs.overflowX)) continue;
          const escondido = el.scrollWidth - el.clientWidth;
          if (escondido > 2 && el.clientWidth > 200) out.push({ escondido, visible: el.clientWidth, cabecera: [...el.querySelectorAll('th')].map(t => t.textContent.trim()).filter(Boolean).slice(0, 8).join(' · ') });
        }
        return { main: Math.round(main.getBoundingClientRect().width), tablas: out };
      });
      filas.push({ rol, ancho: w, ruta, main: m.main, tablas: m.tablas });
    }
    await c.close();
  }
}
await b.close();
writeFileSync(`${S}/${salida}`, JSON.stringify(filas, null, 1));
const malas = filas.filter(f => f.tablas.length);
console.log('mediciones', filas.length, '| con contenido escondido', malas.length);
const porRuta = {};
for (const f of malas) (porRuta[f.ruta] ??= []).push(`${f.ancho}px: ${f.tablas.map(t => '+' + t.escondido + 'px').join(',')}`);
for (const [r, v] of Object.entries(porRuta)) console.log(r, '→', v.join(' | '), '|', malas.find(f => f.ruta === r).tablas[0].cabecera.slice(0, 90));
console.log('ancho de main por ventana:', ANCHOS.map(w => w + '→' + filas.find(f => f.ancho === w).main).join(', '));
