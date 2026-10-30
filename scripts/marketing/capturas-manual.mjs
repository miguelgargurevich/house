// Toma las capturas del manual de usuario de House con Playwright sobre la app LOCAL (seed de Los Libertadores; ningún dato real).
// Uso: node scripts/marketing/capturas-manual.mjs [nombre…]  →  .claude/manual/capturas/<nombre>.jpg (sin nombres: todas)
// Las cuentas son las de prueba del seed local; una sola sesión por rol (el login tiene límite de intentos).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? '/opt/homebrew/lib/node_modules/playwright');

const APP = process.env.APP_URL ?? 'http://localhost:5173';
const SALIDA = join(process.cwd(), '.claude/manual/capturas');

const CUENTAS = {
  admin: ['ana.lopez@gestionurbana.com', 'admin1234'],
  tesorero: ['patricia.alarcon.9@prueba.house', 'prop1234'],
  propietario: ['javier.castro@prop.com', 'prop1234'],
  // «Ver mi voucher» sólo aparece si el pago trae su comprobante: en el seed, los vecinos con un pago por validar (pestaña «En revisión»).
  pagador: ['ana.huaman.38@prueba.house', 'prop1234'],
  inquilino: ['valentina.ruiz@inq.com', 'inq1234'],
  mantenimiento: ['maria.fernandez@gestionurbana.com', 'mtto1234'],
  seguridad: ['pedro.sanchez@gestionurbana.com', 'seg1234'],
};

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const asentar = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  // La limpieza se repite con un MutationObserver: la tarjeta «Canales» y el nombre llegan después de la carga inicial.
  await page.evaluate(() => {
    const limpiar = () => {
      for (const p of document.querySelectorAll('p')) if (/Cuentas de prueba/i.test(p.textContent ?? '')) p.parentElement?.remove();
      // La tarjeta «Canales» dice «No configurado» en local: no se muestra en el manual.
      for (const el of document.querySelectorAll('p,div,span')) if (el.children.length === 0 && /Si un canal no está configurado/.test(el.textContent ?? '')) el.closest('[class*="rounded"]')?.remove();
      // El seed pone a Miguel (persona real) de presidente del Block 1: en un manual público sale un nombre de prueba.
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n; (n = w.nextNode());) if (/Miguel Gargurevich|miguel@prueba/.test(n.nodeValue ?? '')) n.nodeValue = n.nodeValue.replace(/Miguel Gargurevich/g, 'Martín Gallardo Ríos').replace(/miguel@prueba\.house/g, 'martin@prueba.house');
    };
    limpiar();
    new MutationObserver(limpiar).observe(document.body, { childList: true, subtree: true });
  }).catch(() => {});
  await pausa(700);
};
const octubre = async (p) => { await p.getByLabel(/^mes$/i).first().selectOption('10').catch(() => {}); await asentar(p); };
const pulsar = async (p, loc) => { await loc.first().click({ timeout: 5000 }).catch(() => {}); await asentar(p); };

/** nombre → rol, ruta, acción previa y si es en celular. */
const CAPTURAS = {
  login: { rol: null, url: '/login' },
  registro: { rol: null, url: '/registro' },
  // Las secciones de precios aparecen al bajar (animación): baja toda la página y vuelve a la fila de tarjetas.
  precios: { rol: null, url: '/precios', accion: async (p) => {
    for (let y = 0; y < 14; y++) { await p.mouse.wheel(0, 600); await pausa(180); }
    await p.getByText('Más elegido').first().scrollIntoViewIfNeeded().catch(() => {});
    await pausa(900);
  } },
  'admin-resumen': { rol: 'admin', url: '/admin/dashboard' },
  'admin-recibos': { rol: 'admin', url: '/admin/recibos' },
  'admin-periodo': { rol: 'admin', url: '/admin/recibos', accion: (p) => pulsar(p, p.locator('tbody tr')) },
  'admin-consolidado': { rol: 'admin', url: '/admin/recibos', accion: async (p) => { await pulsar(p, p.locator('tbody tr')); await pulsar(p, p.getByRole('tab', { name: /consolidado del block/i })); } },
  'admin-avisar': { rol: 'admin', url: '/admin/recibos', accion: (p) => pulsar(p, p.getByRole('button', { name: /avisar a los vecinos/i })) },
  'admin-pagos': { rol: 'admin', url: '/admin/pagos' },
  'admin-pago-detalle': { rol: 'admin', url: '/admin/pagos', accion: (p) => pulsar(p, p.locator('tbody tr')) },
  'admin-medios': { rol: 'admin', url: '/admin/medios-pago' },
  'admin-morosidad': { rol: 'admin', url: '/admin/morosidad' },
  'admin-morosidad-detalle': { rol: 'admin', url: '/admin/morosidad', accion: (p) => pulsar(p, p.locator('tbody tr')) },
  'admin-cierres': { rol: 'admin', url: '/admin/cierres', accion: async (p) => { await octubre(p); } },
  'admin-comunicado-nuevo': { rol: 'admin', url: '/admin/comunicados', accion: (p) => pulsar(p, p.getByRole('button', { name: /nuevo comunicado/i })) },
  'admin-notificaciones': { rol: 'admin', url: '/admin/comunicados', accion: (p) => pulsar(p, p.getByRole('tab', { name: /notificaciones/i })) },
  'admin-juntas': { rol: 'admin', url: '/admin/juntas' },
  'admin-conceptos': { rol: 'admin', url: '/admin/conceptos' },
  'admin-unidades': { rol: 'admin', url: '/admin/unidades' },
  'admin-proveedores': { rol: 'admin', url: '/admin/proveedores' },
  'admin-mantenimiento': { rol: 'admin', url: '/admin/mantenimientos' },
  'junta-mi-junta': { rol: 'tesorero', url: '/junta/mi-junta' },
  'junta-pagos': { rol: 'tesorero', url: '/junta/pagos', accion: (p) => pulsar(p, p.locator('tbody tr')) },
  'junta-medios': { rol: 'tesorero', url: '/junta/medios-pago' },
  'junta-cierre': { rol: 'tesorero', url: '/junta/cierre', accion: octubre },
  'junta-agua': { rol: 'tesorero', url: '/junta/agua' },
  'vecino-inicio': { rol: 'propietario', url: '/propietario/inicio', celular: true },
  'vecino-recibos': { rol: 'propietario', url: '/propietario/cargos', celular: true },
  'vecino-detalle': { rol: 'propietario', url: '/propietario/cargos', celular: true, accion: (p) => pulsar(p, p.getByRole('button', { name: /ver detalle|ver recibo|detalle/i })) },
  'vecino-ver-voucher': { rol: 'pagador', url: '/propietario/cargos', celular: true, accion: async (p) => { await pulsar(p, p.getByRole('tab', { name: /en revisión/i }).or(p.getByRole('button', { name: /en revisión/i }))); await pulsar(p, p.getByRole('button', { name: /ver detalle/i })); await pulsar(p, p.getByRole('button', { name: /ver mi voucher/i })); } },
  'vecino-ampliar': { rol: 'pagador', url: '/propietario/cargos', celular: true, accion: async (p) => { await pulsar(p, p.getByRole('tab', { name: /en revisión/i }).or(p.getByRole('button', { name: /en revisión/i }))); await pulsar(p, p.getByRole('button', { name: /ver detalle/i })); await pulsar(p, p.getByRole('button', { name: /ver mi voucher/i })); await pulsar(p, p.getByRole('button', { name: /^ampliar/i })); await pausa(2000); } },
  'vecino-pagar': { rol: 'propietario', url: '/propietario/cargos', celular: true, accion: (p) => pulsar(p, p.getByRole('button', { name: /pagar mantenimiento/i })) },
  'vecino-historial': { rol: 'propietario', url: '/propietario/pagos', celular: true, accion: (p) => pulsar(p, p.getByRole('tab', { name: /por concepto/i })) },
  'vecino-junta': { rol: 'propietario', url: '/propietario/junta', celular: true },
  'vecino-proveedores': { rol: 'propietario', url: '/propietario/proveedores', celular: true },
  'vecino-comunicados': { rol: 'propietario', url: '/propietario/comunicados', celular: true },
  'inquilino-inicio': { rol: 'inquilino', url: '/inquilino/inicio', celular: true },
  'mantenimiento-tareas': { rol: 'mantenimiento', url: '/mantenimiento/tareas', celular: true },
  'seguridad-inicio': { rol: 'seguridad', url: '/seguridad/inicio', celular: true },
  'perfil': { rol: 'propietario', url: '/perfil', celular: true },
};

const pedidas = process.argv.slice(2);
const lista = Object.entries(CAPTURAS).filter(([n]) => !pedidas.length || pedidas.includes(n));
mkdirSync(SALIDA, { recursive: true });

const browser = await chromium.launch();
const sesiones = {};
for (const rol of new Set(lista.map(([, c]) => c.rol).filter(Boolean))) {
  const c = await browser.newContext();
  const [email, password] = CUENTAS[rol];
  const r = await c.request.post(`${APP}/api/auth/login`, { data: { email, password } });
  if (!r.ok()) throw new Error(`login ${rol}: ${r.status()}`);
  sesiones[rol] = await c.storageState();
  await c.close();
}

for (const [nombre, cap] of lista) {
  const ctx = await browser.newContext({
    ...(cap.celular ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } }),
    deviceScaleFactor: 2, colorScheme: 'light', locale: 'es-PE', storageState: cap.rol ? sesiones[cap.rol] : undefined,
  });
  const page = await ctx.newPage();
  try {
    await page.goto(APP + cap.url);
    await asentar(page);
    if (cap.accion) await cap.accion(page);
    await page.screenshot({ path: join(SALIDA, `${nombre}.jpg`), type: 'jpeg', quality: 78 });
    console.log('ok', nombre);
  } catch (e) {
    console.log('FALLÓ', nombre, e.message.split('\n')[0]);
  }
  await ctx.close();
}
await browser.close();
