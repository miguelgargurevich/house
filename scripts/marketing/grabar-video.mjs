// Graba las escenas de un video de marketing de Torre con Playwright sobre la app LOCAL (seed de Los Libertadores; ningún dato real).
// Uso: node scripts/marketing/grabar-video.mjs <video> <escritorio|celular>   (video: v1 …; ver ESCENAS)
// Lee la voz de cada escena en .claude/videos/<video>/voz/e<N>.wav (la duración de la escena la manda su audio) y deja un clip por escena en
// .claude/videos/<video>/<formato>/e<N>.webm. El montaje (voz + clips + cierre) lo hace scripts/marketing/montar-video.sh.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUENTAS_MANUAL, escenasManual } from './videos-manual.mjs';

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
  // Los videos del manual (m-…) usan además las cuentas de los demás roles: están en videos-manual.mjs.
  ...CUENTAS_MANUAL,
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

/**
 * Personas reales que NO pueden verse en un video: la base local tiene a Miguel (superadmin y presidente del Block 1 en el seed) y UNA cuenta real
 * de administradora («Melina Loayza», correo de Gmail). Se cambian por nombres y correos de prueba, en el texto de toda la pantalla.
 */
const SUSTITUIR = `
  const SUST = [
    [/[\\w.+-]*gargurevich[\\w.+-]*@[\\w.-]+/gi, 'martin@prueba.house'],
    [/Miguel F\\.? Gargurevich|Miguel Gargurevich/g, 'Martín Gallardo Ríos'],
    [/Gargurevich/gi, 'Gallardo'],
    [/Melina Loayza/g, 'Mónica Paredes'],
    [/[\\w.+-]+@gmail\\.com/gi, 'monica.paredes@prueba.house'],
    [/miguel@prueba\\.house/g, 'martin@prueba.house'],
    [/923238432/g, '987654399'], // celular de la cuenta real de la administradora
    [/988491368/g, '987654398'], // celular de Miguel (presidente del Block 1 en el seed)
  ];
  const limpiarNombres = () => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const v = n.nodeValue ?? '';
      if (v.trim() === 'ML') { n.nodeValue = 'MP'; continue; } // iniciales del avatar de «Melina Loayza» → «Mónica Paredes»
      if (!/gargurevich|melina|gmail|miguel@prueba|923238432|988491368/i.test(v)) continue;
      let r = v;
      for (const [re, t] of SUST) r = r.replace(re, t);
      if (r !== v) n.nodeValue = r;
    }
    for (const el of document.querySelectorAll('input,textarea')) {
      const v = el.value ?? '';
      if (!/gargurevich|melina|gmail|923238432|988491368/i.test(v)) continue;
      let r = v;
      for (const [re, t] of SUST) r = r.replace(re, t);
      if (r !== v) el.value = r;
    }
  };`;

/** Antes de pintar: quita la tarjeta «Canales» (en local dice «No configurado») y cambia los nombres reales por unos de prueba. */
const LIMPIEZA = `
  addEventListener('DOMContentLoaded', () => {
    ${SUSTITUIR}
    const limpiar = () => {
      for (const el of document.querySelectorAll('p,div,span')) if (el.children.length === 0 && /Si un canal no está configurado/.test(el.textContent ?? '')) el.closest('[class*="rounded"]')?.remove();
      limpiarNombres();
    };
    new MutationObserver(limpiar).observe(document.body, { childList: true, subtree: true, characterData: true });
  });`;

/** v6 crea un inquilino de prueba: una unidad SIN inquilino (cambia por grabación con UNIDAD_V6=B01-104…). */
const UNIDAD_V6 = process.env.UNIDAD_V6 ?? 'B01-102';
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
  await page.evaluate(`(() => { ${SUSTITUIR}
    for (const p of document.querySelectorAll('p')) if (/Cuentas de prueba/i.test(p.textContent ?? '')) p.parentElement?.remove();
    // En local los envíos están apagados: la tarjeta «Canales» diría «No configurado» y nombraría las variables. No va en un video.
    for (const el of document.querySelectorAll('p,div,span')) if (el.children.length === 0 && /Si un canal no está configurado/.test(el.textContent ?? '')) el.closest('[class*="rounded"]')?.remove();
    limpiarNombres();
  })()`).catch(() => {});
  await pausa(350);
};

/** Pulsa y espera a que la pantalla se asiente. */
const pulsar = async (page, loc) => { await tocar(page, loc); await asentar(page); };

/** Los cierres abren en el mes anterior; el seed local sólo tiene recibo por block en octubre (el del Block 1). */
const octubre = async (page) => { await page.getByLabel(/^mes$/i).first().selectOption('10').catch(() => {}); await asentar(page); };

// ---------- Escenas de cada video (texto en docs/marketing/guiones-videos.md) ----------
let ESCENAS = {
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
    { rol: 'admin', url: '/admin/conciliacion', accion: async (p) => { await pausa(700); await desplazar(p, 360, 2200); } },
    { rol: 'admin', url: '/admin/medios-pago', accion: async (p) => { await pausa(500); await desplazar(p, 320, 2000); } },
    { rol: 'admin', url: '/admin/morosidad', accion: async (p) => { await tocar(p, p.locator('tbody tr')); await asentar(p); await desplazar(p, 200); } },
    { rol: 'admin', url: '/admin/comunicados', accion: async (p) => {
      await tocar(p, p.getByRole('button', { name: /nuevo comunicado/i })); await asentar(p);
      await tocar(p, p.getByRole('dialog').getByLabel(/^título/i)); await p.keyboard.type('Corte de agua el sábado de 9 a 13 h', { delay: 28 });
    } },
    { rol: 'admin', url: '/admin/comunicados', accion: async (p) => {
      await tocar(p, p.getByRole('tab', { name: /notificaciones/i })); await asentar(p);
      // «Canales» carga después del resto: se espera a que aparezca para quitarla (ver `asentar`).
      await p.getByText('Si un canal no está configurado').first().waitFor({ timeout: 4000 }).catch(() => {}); await asentar(p);
      await desplazar(p, 200);
    } },
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
    { rol: 'propietario', url: '/propietario/reservas', accion: async (p) => {
      await p.getByLabel('Área').selectOption({ label: 'Zona de parrillas' }).catch(() => {});
      await p.getByLabel('Día', { exact: true }).fill('2026-11-01').catch(() => {});
      await asentar(p); await desplazar(p, 260);
    } },
    { rol: 'propietario', url: '/propietario/comunicados', accion: async (p) => { await pausa(500); await desplazar(p, 220); } },
    { rol: null, url: null, cierre: true },
  ],
  // v5: lo nuevo para la administradora. Necesita el Evolution FALSO y los grupos de «Mis grupos» (ver docs/marketing/guiones-videos.md, «Cómo se arma»).
  v5: [
    { rol: 'admin', url: '/admin/recibos', accion: async (p) => {
      await tocar(p, p.getByRole('button', { name: /^subir excel/i })); await asentar(p);
      const d = p.getByRole('dialog');
      // con un solo condominio, el selector ya viene elegido
      await d.locator('input[type=file]').setInputFiles(join(process.cwd(), '.claude/manual/block-15-noviembre.xlsx'));
      await tocar(p, d.getByRole('button', { name: /subir excel y crear recibos/i }));
      await p.getByText('Faltan blocks o departamentos').waitFor({ timeout: 8000 }); await asentar(p);
      // En celular el modal desborda de lado (problema de la pantalla, anotado en el handoff): no se desplaza hasta el botón.
      if (formato === 'escritorio') await tocar(p, d.getByRole('button', { name: /crear y cargar el recibo/i }), { soloSenalar: true });
    } },
    { rol: 'admin', url: '/admin/morosidad', accion: async (p) => { await tocar(p, p.getByRole('button', { name: /estado de cuenta de la unidad/i })); await asentar(p); await pausa(900); await desplazar(p, 320, 2400); } },
    { rol: 'admin', url: '/admin/rendicion', accion: async (p) => { await octubre(p); await pausa(600); await desplazar(p, 700, 3200); } },
    { rol: 'admin', url: '/admin/whatsapp', accion: async (p) => { await pausa(700); await tocar(p, p.getByRole('button', { name: /^actualizar/i })); await asentar(p); await desplazar(p, 260, 2200); } },
    { rol: 'admin', url: '/admin/whatsapp', accion: async (p) => {
      await p.getByText('Mis grupos').first().scrollIntoViewIfNeeded(); await asentar(p);
      await tocar(p, p.getByRole('button', { name: /traer mis grupos/i })); await p.getByText(/^Listo:/).first().waitFor({ timeout: 40000 }).catch(() => {}); await asentar(p);
      await tocar(p, p.getByLabel('Sólo los que uso')); await asentar(p); await desplazar(p, 320, 2200);
    } },
    { rol: 'admin', url: '/admin/condominios/4', accion: async (p) => { await p.getByText('Avisos que salen por WhatsApp').first().scrollIntoViewIfNeeded(); await asentar(p); await pausa(900); await desplazar(p, 200, 1800); } },
    { rol: 'admin', url: '/admin/comunicados', accion: async (p) => {
      await tocar(p, p.getByRole('button', { name: /nuevo comunicado/i })); await asentar(p);
      await tocar(p, p.getByRole('dialog').getByLabel(/^título/i)); await p.keyboard.type('Corte de agua el sábado de 9 a 13 h', { delay: 28 });
      await p.getByText('Junta Block 1').first().scrollIntoViewIfNeeded().catch(() => {}); await p.getByText('Ninguno marcado').first().scrollIntoViewIfNeeded().catch(() => {}); await asentar(p); await pausa(600);
      await tocar(p, p.getByRole('dialog').getByLabel(/Junta Block 1/));
    } },
    { rol: null, url: null, cierre: true },
  ],
  // v6: tu equipo en Torre. El correo del residente es nuevo en cada grabación (lleva la hora): sus usuarios de prueba se borran al terminar.
  v6: [
    { rol: 'admin', url: '/admin/configuracion', accion: async (p) => { await pausa(500); await tocar(p, p.getByRole('tab', { name: /^personal/i })); await asentar(p); await desplazar(p, 160, 1500); } },
    { rol: 'admin', url: '/admin/configuracion', accion: async (p) => {
      await pulsar(p, p.getByRole('tab', { name: /^personal/i }));
      await tocar(p, p.getByRole('button', { name: /nuevo personal/i })); await asentar(p);
      const d = p.getByRole('dialog');
      await tocar(p, d.getByLabel('Nombre completo')); await p.keyboard.type('Rosa Medina Salas', { delay: 40 });
      await tocar(p, d.getByLabel('Correo electrónico')); await p.keyboard.type('rosa.medina@prueba.house', { delay: 30 });
      await tocar(p, d.getByLabel('Rol')); await d.getByLabel('Rol').selectOption({ label: 'Seguridad' }).catch(() => {});
    } },
    { rol: 'admin', url: '/admin/configuracion', accion: async (p) => {
      await pulsar(p, p.getByRole('tab', { name: /^personal/i }));
      await tocar(p, p.getByRole('button', { name: /nuevo personal/i })); await asentar(p);
      const d = p.getByRole('dialog');
      await d.getByLabel('Nombre completo').fill('Rosa Medina Salas'); await d.getByLabel('Correo electrónico').fill('rosa.medina@prueba.house'); await d.getByLabel('Rol').selectOption({ label: 'Seguridad' }).catch(() => {});
      await tocar(p, d.getByLabel(/^trabaja en/i)); await d.getByLabel(/^trabaja en/i).selectOption({ index: 1 }).catch(() => {}); await pausa(500);
      await tocar(p, d.getByRole('button', { name: /^crear$/i }), { soloSenalar: true });
    } },
    { rol: 'admin', url: '/admin/condominios/4', accion: async (p) => {
      await p.getByRole('tab', { name: /residentes/i }).first().waitFor({ timeout: 15000 });
      await tocar(p, p.getByRole('tab', { name: /residentes/i })); await asentar(p); await pausa(900);
      await tocar(p, p.getByRole('button', { name: /nuevo residente/i })); await asentar(p);
      const d = p.getByRole('dialog'); const marca = Date.now().toString(36);
      await tocar(p, d.getByLabel('Nombre completo')); await p.keyboard.type('Lucía Vargas Prado', { delay: 40 });
      await tocar(p, d.getByLabel('Correo electrónico')); await p.keyboard.type(`video.${marca}@prueba.house`, { delay: 30 });
      await d.getByLabel('Rol').selectOption({ label: 'Inquilino' }).catch(() => {});
      await tocar(p, d.getByLabel(/^departamento/i)); await p.keyboard.type(UNIDAD_V6, { delay: 40 });
      globalThis.__ultimoResidente = marca;
    } },
    { rol: 'admin', url: '/admin/condominios/4',
      antes: async (a) => {
        await a.goto(`${APP}/admin/condominios/4`); await asentar(a);
        await a.getByRole('tab', { name: /residentes/i }).first().click(); await pausa(1500);
        await a.getByRole('button', { name: /nuevo residente/i }).click(); await pausa(500);
        const d = a.getByRole('dialog');
        await d.getByLabel('Nombre completo').fill('Lucía Vargas Prado'); await d.getByLabel('Correo electrónico').fill(`video.${Date.now().toString(36)}@prueba.house`);
        await d.getByLabel('Rol').selectOption({ label: 'Inquilino' }); await d.getByLabel(/^departamento/i).fill(UNIDAD_V6);
        await d.getByRole('button', { name: /^crear$/i }).click(); await pausa(2500);
      },
      accion: async (p) => {
        await p.getByRole('tab', { name: /residentes/i }).first().waitFor({ timeout: 15000 });
        await p.getByRole('tab', { name: /residentes/i }).first().click(); await asentar(p);
        await p.getByPlaceholder(/buscar/i).first().fill('Lucía Vargas'); await pausa(1000);
        await tocar(p, p.getByRole('button', { name: /reenviar invitación/i }), { soloSenalar: true });
      } },
    { rol: null, url: null, cierre: true },
  ],
};

const CIERRE = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0f766e;color:#f0fdfa;font-family:Figtree,system-ui,sans-serif;display:grid;place-items:center}
  .c{text-align:center} .m{display:inline-flex;align-items:center;gap:18px;font-size:64px;font-weight:600}
  .l{width:84px;height:84px;border-radius:20px;background:#f0fdfa;display:grid;place-items:center}
  p{font-size:40px;margin:36px 0 0;opacity:.95} small{display:block;margin-top:22px;font-size:26px;opacity:.75}
  @media (max-aspect-ratio:1/1){.m{font-size:52px}p{font-size:34px}}
</style><div class="c"><div class="m"><span class="l"><svg viewBox="0 0 32 32" width="56" height="56"><g transform="translate(16 16) scale(1.2) translate(-16 -16)"><rect x="10" y="5.5" width="12" height="21" rx="1.6" fill="none" stroke="#0f766e" stroke-width="2.2"/><g fill="#0f766e"><rect x="13" y="9.5" width="2.2" height="2.2"/><rect x="16.8" y="9.5" width="2.2" height="2.2"/><rect x="13" y="13.8" width="2.2" height="2.2"/><rect x="16.8" y="13.8" width="2.2" height="2.2"/><rect x="13" y="18.1" width="2.2" height="2.2"/><rect x="16.8" y="18.1" width="2.2" height="2.2"/><rect x="14.6" y="21.6" width="2.8" height="4.9"/></g></g></svg></span>Torre</div>
<p>Tu condominio, en orden.</p><small>torrecondominios.com</small></div>`;

async function grabar() {
  // Los videos del manual (m-<rol>-<sección>) viven en videos-manual.mjs: se le pasan las utilidades de grabación.
  if (video.startsWith('m-')) ESCENAS = escenasManual({ APP, formato, ir, tocar, desplazar, asentar, pulsar, pausa, octubre });
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
      const ctx = await browser.newContext({ userAgent: e.ua, viewport: f.viewport, deviceScaleFactor: f.deviceScaleFactor, isMobile: f.isMobile, hasTouch: f.hasTouch, colorScheme: 'light', locale: 'es-PE', recordVideo: { dir: tmp, size: f.video }, storageState: e.rol ? sesiones[e.rol] : undefined });
      await ctx.addInitScript(CURSOR);
      await ctx.addInitScript(LIMPIEZA);
      // `antes`: prepara datos con otra pestaña (fuera de cámara: el clip del video es el de la pestaña principal).
      if (e.antes) { const aux = await ctx.newPage(); await e.antes(aux).catch((err) => console.warn(`  escena ${n} (antes): ${err.message.split('\n')[0]}`)); await aux.close(); }
      const page = await ctx.newPage();
      page.setDefaultTimeout(8000); // un elemento que no está no debe colgar la escena 30 s
      const abierta = Date.now();
      raton = { x: f.viewport.width * 0.55, y: f.viewport.height * 0.45 };
      if (e.cierre) await page.setContent(CIERRE);
      else { await page.goto(`${APP}${e.url}`); await asentar(page); }
      await page.mouse.move(raton.x, raton.y);
      // Lo que tardó en cargar se recorta en el montaje: el clip empieza con la pantalla ya lista.
      const inicio = Date.now();
      recortes[`e${n}`] = (inicio - abierta) / 1000;
      if (e.accion) await e.accion(page).catch((err) => console.warn(`  escena ${n}: ${err.message.split('\n')[0]}`));
      // Verificación: nada de lo que no puede verse (personas reales, «Cuentas de prueba») debe quedar en el texto de la pantalla.
      await asentar(page);
      const fuga = await page.evaluate(() => (document.body.innerText.match(/melina|loayza|gargurevich|gmail|923238432|988491368|cuentas de prueba/gi) ?? []).join(', ')).catch(() => '');
      if (fuga) console.warn(`  escena ${n}: FUGA de datos reales: ${fuga}`);
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
