// Graba las escenas de un video de marketing de House con Playwright sobre la app LOCAL (seed de Los Libertadores; ningún dato real).
// Uso: node scripts/marketing/grabar-video.mjs <video> <escritorio|celular>   (video: v1 …; ver ESCENAS)
// Lee la voz de cada escena en .claude/videos/<video>/voz/e<N>.wav (la duración de la escena la manda su audio) y deja un clip por escena en
// .claude/videos/<video>/<formato>/e<N>.webm. El montaje (voz + clips + cierre) lo hace scripts/marketing/montar-video.sh.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? '/opt/homebrew/lib/node_modules/playwright');

const APP = process.env.APP_URL ?? 'http://localhost:5173';
const [video = 'v1', formato = 'escritorio'] = process.argv.slice(2);
const BASE = join(process.cwd(), '.claude/videos', video);
const SALIDA = join(BASE, formato);

/** Cuentas de prueba LOCALES (las del botón de desarrollo del login; nunca de producción). */
const CUENTAS = {
  admin: ['ana.lopez@gestionurbana.com', 'admin1234'],
  propietario: ['javier.castro@prop.com', 'prop1234'],
  tesorero: ['patricia.alarcon.9@prueba.house', 'prop1234'], // tesorera del Block 1 en el seed
};

const FORMATOS = {
  // Playwright graba al tamaño REAL de la ventana (no usa el deviceScaleFactor): el video es del tamaño de la ventana y el montaje lo agranda
  // (lanczos) a 1920×1080 o 1080×1920. Con una ventana menor que el video sale una franja gris.
  escritorio: { viewport: { width: 1600, height: 900 }, video: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
  celular: { viewport: { width: 540, height: 960 }, video: { width: 540, height: 960 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
};

const duracion = (n) => {
  const f = join(BASE, 'voz', `e${n}.wav`);
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
};

// ---------- Cursor visible y movimientos suaves ----------
const CURSOR = `
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    Object.assign(c.style, { position: 'fixed', zIndex: 2147483647, width: '22px', height: '22px', marginLeft: '-11px', marginTop: '-11px', borderRadius: '50%',
      background: 'rgba(15,118,110,.28)', border: '2px solid rgba(15,118,110,.9)', pointerEvents: 'none', transition: 'transform .12s ease-out', left: '-50px', top: '-50px' });
    document.body.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.transform = 'scale(.7)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
  });`;

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
let raton = { x: 200, y: 200 };
async function ir(page, x, y, ms = 650) {
  const pasos = Math.max(8, Math.round(ms / 16));
  for (let i = 1; i <= pasos; i++) {
    const t = i / pasos, e = 1 - Math.pow(1 - t, 3); // ease-out
    await page.mouse.move(raton.x + (x - raton.x) * e, raton.y + (y - raton.y) * e);
    await pausa(ms / pasos);
  }
  raton = { x, y };
}
/** Lleva el cursor al elemento y lo pulsa (o sólo lo señala con `soloSenalar`). */
async function tocar(page, locator, { soloSenalar = false } = {}) {
  const el = locator.first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const b = await el.boundingBox();
  if (!b) return;
  await ir(page, b.x + b.width / 2, b.y + b.height / 2);
  await pausa(180);
  if (!soloSenalar) await el.click();
}
async function desplazar(page, px, ms = 1400) {
  const pasos = 30;
  for (let i = 0; i < pasos; i++) { await page.mouse.wheel(0, px / pasos); await pausa(ms / pasos); }
}
/** Las animaciones CSS de entrada no deben quedar a medias en el cuadro. */
const asentar = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => {});
  // El recuadro «Cuentas de prueba (solo desarrollo)» del login sólo existe en local: no sale en un video de marketing.
  await page.evaluate(() => {
    for (const p of document.querySelectorAll('p')) if (/Cuentas de prueba/i.test(p.textContent ?? '')) p.parentElement?.remove();
  }).catch(() => {});
  await pausa(350);
};

/** Los cierres abren en el mes anterior; el seed local sólo tiene recibo por block en octubre (el del Block 1). */
const octubre = async (page) => { await page.getByLabel(/^mes$/i).first().selectOption('10').catch(() => {}); await asentar(page); };

// ---------- Escenas de cada video (texto en docs/marketing/guiones-videos.md) ----------
const ESCENAS = {
  v1: [
    { rol: null, url: '/login', accion: async (p) => { await ir(p, 1100, 520, 1600); } },
    { rol: 'admin', url: '/admin/recibos', accion: async (p) => { await tocar(p, p.locator('tbody tr')); await asentar(p); await desplazar(p, 260); } },
    { rol: 'propietario', url: '/propietario/cargos', accion: async (p) => { await tocar(p, p.getByRole('button', { name: /ver detalle|ver recibo|detalle/i })); await asentar(p); await desplazar(p, 220); } },
    { rol: 'propietario', url: '/propietario/cargos', accion: async (p) => { await tocar(p, p.getByRole('button', { name: /pagar mantenimiento/i })); await asentar(p); await desplazar(p, 260); } },
    { rol: 'admin', url: '/admin/pagos', accion: async (p) => { await tocar(p, p.locator('tbody tr')); await asentar(p); await desplazar(p, 200); } },
    { rol: 'admin', url: '/admin/recibos', accion: async (p) => { await tocar(p, p.getByRole('button', { name: /avisar a los vecinos/i })); await asentar(p); } },
    { rol: 'admin', url: '/admin/dashboard', accion: async (p) => { await pausa(600); await desplazar(p, 420, 2200); } },
    { rol: null, url: null, cierre: true },
  ],
  v2: [
    { rol: 'admin', url: '/admin/dashboard', accion: async (p) => { await pausa(800); await desplazar(p, 300, 2000); } },
    { rol: 'admin', url: '/admin/recibos', accion: async (p) => { await pausa(500); await desplazar(p, 240); } },
    { rol: 'admin', url: '/admin/pagos', accion: async (p) => { await tocar(p, p.locator('tbody tr')); await asentar(p); await desplazar(p, 260, 2000); } },
    { rol: 'admin', url: '/admin/medios-pago', accion: async (p) => { await pausa(500); await desplazar(p, 320, 2000); } },
    { rol: 'admin', url: '/admin/morosidad', accion: async (p) => { await tocar(p, p.locator('tbody tr')); await asentar(p); await desplazar(p, 200); } },
    { rol: 'admin', url: '/admin/comunicados', accion: async (p) => {
      await tocar(p, p.getByRole('button', { name: /nuevo comunicado/i })); await asentar(p);
      await tocar(p, p.getByRole('dialog').getByLabel(/^título/i)); await p.keyboard.type('Corte de agua el sábado de 9 a 13 h', { delay: 55 });
    } },
    { rol: 'admin', url: '/admin/comunicados', accion: async (p) => { await tocar(p, p.getByRole('tab', { name: /envíos/i })); await asentar(p); await desplazar(p, 200); } },
    { rol: 'admin', url: '/admin/juntas', accion: async (p) => { await tocar(p, p.getByRole('button', { name: /nueva gestión/i })); await asentar(p); } },
    { rol: 'admin', url: '/admin/cierres', accion: async (p) => { await octubre(p); await tocar(p, p.getByText('Block 1').first()); await asentar(p); await desplazar(p, 320, 2200); } },
    { rol: 'admin', url: '/admin/recibos', accion: async (p) => {
      await tocar(p, p.locator('tbody tr')); await asentar(p);
      await tocar(p, p.getByRole('tab', { name: /consolidado del block/i })); await asentar(p); await desplazar(p, 280, 2000);
    } },
    { rol: null, url: null, cierre: true },
  ],
  v3: [
    { rol: 'tesorero', url: '/junta/mi-junta', accion: async (p) => { await pausa(500); await desplazar(p, 220); } },
    { rol: 'tesorero', url: '/junta/pagos', accion: async (p) => { await tocar(p, p.locator('tbody tr')); await asentar(p); await desplazar(p, 240); } },
    { rol: 'tesorero', url: '/junta/medios-pago', accion: async (p) => { await pausa(500); await desplazar(p, 220); } },
    { rol: 'tesorero', url: '/junta/agua', accion: async (p) => { await pausa(500); await desplazar(p, 260); } },
    { rol: 'tesorero', url: '/junta/cierre', accion: async (p) => { await octubre(p); await desplazar(p, 320, 2200); } },
    { rol: 'tesorero', url: '/junta/comunicados', accion: async (p) => { await tocar(p, p.getByRole('button', { name: /nuevo comunicado/i })); await asentar(p); } },
    { rol: null, url: null, cierre: true },
  ],
  v4: [
    { rol: 'propietario', url: '/propietario/inicio', accion: async (p) => { await pausa(500); await desplazar(p, 200); } },
    { rol: 'propietario', url: '/propietario/cargos', accion: async (p) => { await tocar(p, p.getByRole('button', { name: /ver detalle|ver recibo|detalle/i })); await asentar(p); await desplazar(p, 220); } },
    { rol: 'propietario', url: '/propietario/cargos', accion: async (p) => { await tocar(p, p.getByRole('button', { name: /pagar mantenimiento/i })); await asentar(p); await desplazar(p, 260); } },
    { rol: 'propietario', url: '/propietario/pagos', accion: async (p) => { await tocar(p, p.getByRole('tab', { name: /por concepto/i })); await asentar(p); await desplazar(p, 220); } },
    { rol: 'propietario', url: '/propietario/junta', accion: async (p) => { await pausa(500); await desplazar(p, 260); } },
    { rol: 'propietario', url: '/propietario/proveedores', accion: async (p) => { await pausa(500); await desplazar(p, 200); } },
    { rol: 'propietario', url: '/propietario/comunicados', accion: async (p) => { await pausa(500); await desplazar(p, 220); } },
    { rol: null, url: null, cierre: true },
  ],
};

const CIERRE = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0f766e;color:#f0fdfa;font-family:Figtree,system-ui,sans-serif;display:grid;place-items:center}
  .c{text-align:center} .m{display:inline-flex;align-items:center;gap:18px;font-size:64px;font-weight:600}
  .l{width:84px;height:84px;border-radius:20px;background:#f0fdfa;display:grid;place-items:center}
  p{font-size:40px;margin:36px 0 0;opacity:.95} small{display:block;margin-top:22px;font-size:26px;opacity:.75}
  @media (max-aspect-ratio:1/1){.m{font-size:52px}p{font-size:34px}}
</style><div class="c"><div class="m"><span class="l"><svg viewBox="0 0 32 32" width="56" height="56"><path d="M9 24V12.5L16 8l7 4.5V24M13.5 24v-5h5v5" fill="none" stroke="#0f766e" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/></svg></span>House</div>
<p>Tu condominio, en orden.</p><small>house.gargurevich.dev</small></div>`;

async function grabar() {
  const escenas = ESCENAS[video];
  if (!escenas) throw new Error(`No hay escenas para ${video}`);
  const f = FORMATOS[formato];
  if (!f) throw new Error(`Formato desconocido: ${formato}`);
  rmSync(SALIDA, { recursive: true, force: true });
  mkdirSync(SALIDA, { recursive: true });
  const browser = await chromium.launch();
  const recortes = {};
  // Una sola sesión por rol (el login tiene límite de intentos): se guarda en .claude/videos/sesiones/ y la reutilizan todas las escenas
  // y las corridas siguientes mientras siga válida.
  const sesiones = {};
  const dirSesiones = join(process.cwd(), '.claude/videos/sesiones');
  mkdirSync(dirSesiones, { recursive: true });
  for (const rol of new Set(escenas.map((e) => e.rol).filter(Boolean))) {
    const archivo = join(dirSesiones, `${rol}.json`);
    if (existsSync(archivo)) {
      const c = await browser.newContext({ storageState: archivo });
      const ok = (await c.request.get(`${APP}/api/auth/me`)).ok();
      await c.close();
      if (ok) { sesiones[rol] = archivo; continue; }
    }
    const c = await browser.newContext();
    const [email, password] = CUENTAS[rol];
    const r = await c.request.post(`${APP}/api/auth/login`, { data: { email, password } });
    if (!r.ok()) throw new Error(`login ${rol}: ${r.status()}`);
    await c.storageState({ path: archivo });
    sesiones[rol] = archivo;
    await c.close();
  }
  try {
    for (const [i, e] of escenas.entries()) {
      const n = i + 1;
      const largo = duracion(n) * 1000 + 700; // la voz + un respiro
      const tmp = join(SALIDA, `tmp-${n}`);
      const ctx = await browser.newContext({ viewport: f.viewport, deviceScaleFactor: f.deviceScaleFactor, isMobile: f.isMobile, hasTouch: f.hasTouch, colorScheme: 'light', locale: 'es-PE', recordVideo: { dir: tmp, size: f.video }, storageState: e.rol ? sesiones[e.rol] : undefined });
      await ctx.addInitScript(CURSOR);
      const page = await ctx.newPage();
      const abierta = Date.now();
      raton = { x: f.viewport.width * 0.55, y: f.viewport.height * 0.45 };
      if (e.cierre) await page.setContent(CIERRE);
      else { await page.goto(`${APP}${e.url}`); await asentar(page); }
      await page.mouse.move(raton.x, raton.y);
      // Lo que tardó en cargar se recorta en el montaje: el clip empieza con la pantalla ya lista.
      const inicio = Date.now();
      recortes[`e${n}`] = (inicio - abierta) / 1000;
      if (e.accion) await e.accion(page).catch((err) => console.warn(`  escena ${n}: ${err.message.split('\n')[0]}`));
      const resto = largo - (Date.now() - inicio);
      if (resto > 0) await pausa(resto);
      const v = page.video();
      await ctx.close();
      const archivo = await v.path();
      renameSync(archivo, join(SALIDA, `e${n}.webm`));
      rmSync(tmp, { recursive: true, force: true });
      console.log(`escena ${n}: ${(largo / 1000).toFixed(1)} s`);
    }
  } finally {
    await browser.close();
    writeFileSync(join(SALIDA, 'recortes.json'), JSON.stringify(recortes, null, 1));
  }
  console.log('clips:', readdirSync(SALIDA).filter((x) => x.endsWith('.webm')).length, existsSync(SALIDA) ? SALIDA : '');
}

grabar().catch((err) => { console.error(err); process.exit(1); });
