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
  'admin-agua': { rol: 'admin', url: '/admin/agua' },
  'admin-conciliacion': { rol: 'admin', url: '/admin/conciliacion' },
  'admin-areas': { rol: 'admin', url: '/admin/areas-comunes' },
  'vecino-reservas': { rol: 'propietario', url: '/propietario/reservas', celular: true, accion: async (p) => {
    await p.getByLabel('Área').selectOption({ label: 'Zona de parrillas' }).catch(() => {});
    await p.getByLabel('Día', { exact: true }).fill('2026-11-01').catch(() => {});
    await asentar(p);
  } },
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

/** Tras el seed local: Evolution FALSO (brief de manuales) + dos grupos «en uso» para que el comunicado los ofrezca. Nunca el Evolution real. */
const prepararGrupos = async (p) => {
  const csrf = (await (await p.request.get(`${APP}/api/auth/me`)).json()).csrf;
  const api = (u, o) => p.request.fetch(APP + u, { ...o, headers: { 'x-csrf-token': csrf, origin: APP } }).then((r) => r.json());
  let d = await api('/api/whatsapp/grupos');
  if (!d.grupos?.length) d = await api('/api/whatsapp/grupos/sincronizar', { method: 'POST' });
  const cond = d.condominios?.[0];
  const b1 = cond?.estructuras?.find((e) => /block 1$/i.test(e.nombre));
  const quiero = [['Vecinos Block 1 · Libertadores', { destino: 'block', estructura_id: b1?.id }], ['Junta Block 1', { destino: 'junta_block', estructura_id: b1?.id }], ['Grupo personal 30', { destino: 'condominio', complejo_id: cond?.id }]];
  for (const [nombre, dest] of quiero) {
    const g = d.grupos.find((x) => x.nombre === nombre);
    if (g && !g.en_uso) await api(`/api/whatsapp/grupos/${g.id}`, { method: 'PUT', data: { en_uso: true, ...dest } });
  }
};
const EXCEL_BLOCK_NUEVO = join(process.cwd(), '.claude/manual/block-15-noviembre.xlsx');

Object.assign(CAPTURAS, {
  'admin-excel-faltantes': { rol: 'admin', url: '/admin/recibos', accion: async (p) => {
    await pulsar(p, p.getByRole('button', { name: /^subir excel/i }));
    const d = p.getByRole('dialog');
    // con un solo condominio, el selector ya viene elegido
    await d.locator('input[type=file]').setInputFiles(EXCEL_BLOCK_NUEVO);
    await pulsar(p, d.getByRole('button', { name: /subir excel y crear recibos/i }));
    await p.getByText('Faltan blocks o departamentos').waitFor({ timeout: 8000 });
    await asentar(p);
  } },
  'admin-estado-cuenta': { rol: 'admin', url: '/admin/morosidad', accion: async (p) => { await pulsar(p, p.getByRole('button', { name: /estado de cuenta de la unidad/i })); await pausa(1200); } },
  'vecino-estado-cuenta': { rol: 'propietario', url: '/propietario/pagos', celular: true, accion: async (p) => { await pulsar(p, p.getByRole('button', { name: /^estado de cuenta/i })); await pausa(1200); } },
  'admin-rendicion': { rol: 'admin', url: '/admin/rendicion', accion: async (p) => { await octubre(p); await pausa(800); } },
  'admin-comunicado-grupos': { rol: 'admin', url: '/admin/comunicados', accion: async (p) => {
    await prepararGrupos(p); await p.reload(); await asentar(p);
    await pulsar(p, p.getByRole('button', { name: /nuevo comunicado/i }));
    await p.getByRole('dialog').getByLabel(/^título/i).fill('Corte de agua el sábado de 9 a 13 h');
    await p.getByText('Junta Block 1').first().scrollIntoViewIfNeeded().catch(() => {}); await p.getByText('Ninguno marcado').first().scrollIntoViewIfNeeded().catch(() => {});
    await p.getByRole('dialog').getByLabel(/Vecinos Block 1/).check().catch(() => {}); await asentar(p);
  } },
  'admin-whatsapp': { rol: 'admin', url: '/admin/whatsapp', accion: async (p) => { await pausa(1200); } },
  'admin-whatsapp-grupos': { rol: 'admin', url: '/admin/whatsapp', accion: async (p) => {
    await prepararGrupos(p); await p.reload(); await asentar(p);
    await p.getByText('Mis grupos').first().scrollIntoViewIfNeeded().catch(() => {});
    await p.getByLabel('Sólo los que uso').check().catch(() => {}); await asentar(p);
  } },
  'admin-condominio-avisos': { rol: 'admin', url: '/admin/condominios/4', accion: async (p) => { await p.getByText('Avisos que salen por WhatsApp').first().scrollIntoViewIfNeeded().catch(() => {}); await asentar(p); } },
  'admin-personal-nuevo': { rol: 'admin', url: '/admin/configuracion', accion: async (p) => { await pulsar(p, p.getByRole('tab', { name: /^personal/i })); await pulsar(p, p.getByRole('button', { name: /nuevo personal/i })); } },
  'admin-residente-editar': { rol: 'admin', url: '/admin/condominios/4', accion: async (p) => {
    await p.getByRole('tab', { name: /residentes/i }).first().waitFor({ timeout: 15000 });
    await pulsar(p, p.getByRole('tab', { name: /residentes/i })); await pausa(1500);
    await pulsar(p, p.getByRole('button', { name: /editar/i })); await pausa(800);
  } },
  'junta-rendicion': { rol: 'tesorero', url: '/junta/rendicion', accion: async (p) => { await octubre(p); await pausa(800); } },
  'junta-comunicado-nuevo': { rol: 'tesorero', url: '/junta/comunicados', accion: (p) => pulsar(p, p.getByRole('button', { name: /nuevo comunicado/i })) },
  'vecino-instalar': { rol: 'propietario', url: '/propietario/inicio', celular: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
});

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
    deviceScaleFactor: 2, colorScheme: 'light', locale: 'es-PE', storageState: cap.rol ? sesiones[cap.rol] : undefined, userAgent: cap.userAgent,
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
