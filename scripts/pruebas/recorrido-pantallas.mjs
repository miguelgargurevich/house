// Recorrido de pantallas: entra con cada cuenta de prueba LOCAL (seed de Los Libertadores) a cada pantalla de su menú, en escritorio y, para
// residentes, junta y personal, en celular; anota errores de la API (≥ 400), de la página y de la consola, mensajes de error, redirecciones y desborde.
// Uso: node scripts/pruebas/recorrido-pantallas.mjs <carpeta-salida> <id-condominio> <id-empresa>   (deja <carpeta>/smoke.json)
// La API local acepta 300 solicitudes cada 15 min por IP: con REINICIAR_BACKEND=<script> reinicia el backend antes de cada rol.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');
const APP = process.env.APP_URL ?? 'http://localhost:5173', S = process.argv[2], REINICIAR = process.env.REINICIAR_BACKEND;
const [CX, EMP] = process.argv.slice(3);
const ROLES = [
  ['Superadministrador', 'miguel.gargurevich@admin.com', 'admin1234', ['/superadmin/dashboard','/superadmin/empresas',`/superadmin/empresas/${EMP}`,'/superadmin/usuarios','/superadmin/auditoria','/superadmin/llavero','/superadmin/integraciones','/superadmin/suscripciones','/perfil'], false],
  ['Administradora', 'ana.lopez@gestionurbana.com', 'admin1234', ['/admin/dashboard','/admin/complejos',`/admin/condominios/${CX}`,'/admin/recibos','/admin/recibos/26','/admin/pagos','/admin/medios-pago','/admin/morosidad','/admin/cierres','/admin/unidades','/admin/residentes','/admin/personal','/admin/mantenimientos','/admin/conceptos','/admin/comunicados','/admin/avisos','/admin/juntas','/admin/whatsapp','/admin/proveedores','/admin/configuracion','/admin/mi-plan','/perfil'], false],
  ['Propietario', 'javier.castro@prop.com', 'prop1234', ['/propietario/inicio','/propietario/unidades','/propietario/cargos','/propietario/pagos','/propietario/junta','/propietario/proveedores','/propietario/comunicados','/perfil'], true],
  ['Inquilino', 'valentina.ruiz@inq.com', 'inq1234', ['/inquilino/inicio','/inquilino/cargos','/inquilino/pagos','/inquilino/junta','/inquilino/proveedores','/inquilino/comunicados','/perfil'], true],
  ['Tesorera del block', 'patricia.alarcon.9@prueba.house', 'prop1234', ['/propietario/inicio','/junta/mi-junta','/junta/medios-pago','/junta/pagos','/junta/cierre','/junta/agua','/junta/comunicados','/junta/avisos','/junta/proveedores'], true],
  ['Presidente del block', 'miguel@prueba.house', 'prop1234', ['/junta/mi-junta','/junta/pagos','/junta/cierre','/junta/comunicados'], false],
  ['Tesorero central', 'gustavo.cruz.4@prueba.house', 'prop1234', ['/junta/mi-junta','/junta/pagos','/junta/aportes','/junta/cierre-central','/junta/comunicados','/junta/medios-pago'], true],
  ['Presidenta central', 'teresa.neyra.3@prueba.house', 'prop1234', ['/junta/mi-junta','/junta/aportes','/junta/cierre-central'], false],
  ['Mantenimiento', 'maria.fernandez@gestionurbana.com', 'mtto1234', ['/mantenimiento/inicio','/mantenimiento/tareas','/perfil'], true],
  ['Limpieza', 'limpieza@prueba.house', 'pers1234', ['/limpieza/inicio','/limpieza/tareas'], true],
  ['Jardinería', 'jardineria@prueba.house', 'pers1234', ['/jardineria/inicio','/jardineria/tareas'], true],
  ['Seguridad', 'pedro.sanchez@gestionurbana.com', 'seg1234', ['/seguridad/inicio','/seguridad/unidades','/perfil'], true],
  ['Público', null, null, ['/login','/precios','/registro'], true],
];
const b = await chromium.launch(); const filas = [];
for (const [rol, email, pw, rutas, movil] of ROLES) {
  if (REINICIAR) execFileSync('bash', [REINICIAR], { stdio: 'ignore' }); // el límite de 300 solicitudes por IP es en memoria
  const vps = movil ? [['escritorio', { width: 1366, height: 860 }], ['celular', { width: 390, height: 844 }]] : [['escritorio', { width: 1366, height: 860 }]];
  for (const [fmt, vp] of vps) {
    const c = await b.newContext({ viewport: vp, isMobile: fmt === 'celular', hasTouch: fmt === 'celular' });
    let login = '—';
    if (email) { const r = await c.request.post(APP + '/api/auth/login', { data: { email, password: pw } }); login = r.status(); }
    const p = await c.newPage(); let err = [];
    p.on('pageerror', e => err.push('JS: ' + e.message.slice(0, 120)));
    p.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) err.push('consola: ' + m.text().slice(0, 120)); });
    p.on('response', x => { const u = x.url(); if (u.includes('/api/') && x.status() >= 400) err.push(`${x.status()} ${x.request().method()} ${u.replace(APP, '').split('?')[0]}`); });
    for (const ruta of rutas) {
      err = []; const t0 = Date.now();
      await p.goto(APP + ruta).catch(e => err.push('nav: ' + e.message.slice(0, 80)));
      await p.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => err.push('timeout networkidle'));
      await p.waitForTimeout(300);
      const info = await p.evaluate(() => ({ url: location.pathname, h1: document.querySelector('h1')?.textContent?.trim() ?? '', roto: /Algo salió mal|No se pudo cargar|Error inesperado/i.test(document.body.innerText), desborde: document.documentElement.scrollWidth - innerWidth }));
      const redirige = info.url !== ruta.split('?')[0];
      filas.push({ rol, fmt, login, ruta, h1: info.h1, ms: Date.now() - t0, redirige: redirige ? info.url : '', roto: info.roto, desborde: info.desborde, errores: [...new Set(err)] });
    }
    await c.close();
  }
  console.log(rol, 'listo');
}
await b.close();
writeFileSync(`${S}/smoke.json`, JSON.stringify(filas, null, 1));
const malas = filas.filter(f => f.errores.length || f.roto || f.redirige || f.desborde > 0);
console.log('pantallas', filas.length, '| con observaciones', malas.length);
for (const f of malas) console.log(`${f.rol} · ${f.fmt} · ${f.ruta} → ${f.redirige ? 'redirige a ' + f.redirige + ' · ' : ''}${f.roto ? 'mensaje de error · ' : ''}${f.desborde > 0 ? 'desborde ' + f.desborde + 'px · ' : ''}${f.errores.join(' | ')}`);
