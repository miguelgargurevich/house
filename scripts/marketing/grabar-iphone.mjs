// Graba las escenas de un video de Torre en el IPHONE (simulador): la app de DESARROLLO (TORRE_URL=http://localhost:4000) con el backend LOCAL.
// Uso: WDA_DD=<carpeta> node scripts/marketing/grabar-iphone.mjs <v9|v10> [SOLO=n] [SIN_VIDEO=1]
//   · La pantalla se graba con `xcrun simctl io <udid> recordVideo` (se ve el teléfono real: barra de estado, inicio, splash).
//   · Los toques y el teclado son reales (XCUITest vía Appium, ver ios-driver.mjs); el WebView de la app se lee con JavaScript (inspector de Safari
//     a través de Appium) sólo para saber DÓNDE tocar; el toque en sí es nativo. Sobre la página se dibuja un círculo en cada toque (el simulador
//     no los muestra en la grabación).
//   · Cada escena es un clip e<N>.mp4 + recortes.json en .claude/videos/<video>/iphone/. El montaje: `FONDO=0x0f766e scripts/marketing/montar-video.sh <v> iphone`.
//   · La escena 1 de v9 es la página PÚBLICA torrecondominios.com/app en Safari (sin iniciar sesión). El resto, la app contra el backend local.
//   · Termina solo: cierra la sesión de Appium y sale con process.exit.
// SIN_VIDEO=1 ejecuta las acciones sin grabar (para depurar una escena).
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crearCierre } from './cierre-app.mjs';
import { SesionIOS } from './ios-driver.mjs';

const UDID = '8948E401-E7BA-479B-AF87-99BF2ED2CA2C'; // «Torre iPhone 16» (HTTP/3 apagado). No se usan otros simuladores.
const BUNDLE = 'com.torrecondominios.app';
const APPIUM = process.env.APPIUM_URL ?? 'http://127.0.0.1:4723';
const HOST = 'http://localhost:4000';
const [video = 'v9'] = process.argv.slice(2);
const SOLO = process.env.SOLO ? Number(process.env.SOLO) : null;
const SIN_VIDEO = process.env.SIN_VIDEO === '1';
const BASE = join(process.cwd(), '.claude/videos', video);
const SALIDA = join(BASE, 'iphone');
const VOZ = join(BASE, 'voz-iphone');
const VOUCHER = join(process.cwd(), '.claude/videos', 'voucher-prueba.jpg');
// Un vecino de prueba DISTINTO por toma (@prueba.house, con un mantenimiento pendiente y sin pagos). Los de Android fueron A (v9) y C (v10).
const VECINO = process.env.VECINO ?? 'giovanna.pacheco.41@prueba.house'; // v9: B02-204 (una sola unidad)
const VECINO_V10 = process.env.VECINO_V10 ?? 'carlos.diaz.39@prueba.house'; // v10: B02-202 (su pago lo valida la administradora)
const UNIDAD_V10 = process.env.UNIDAD_V10 ?? 'B02-202';
const CUENTAS = {
  propietario: [VECINO, 'prop1234'],
  admin: ['ana.lopez@administradorademo.example', 'admin1234'], // administradora de la lista DEMO del Login
};
const ROL = video === 'v10' ? 'admin' : 'propietario';

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const sh = (cmd, ...a) => execFileSync(cmd, a, { encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
const duracion = (n) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(VOZ, `e${n}.wav`)]).toString().trim());
const psql = (sql) => execFileSync('docker', ['exec', 'house-pg', 'psql', '-U', 'postgres', '-d', 'house', '-At', '-F', '|', '-c', sql], { encoding: 'utf8' }).trim();

let ses; // sesión de Appium
let ox = 0, oy = 59; // de píxeles CSS de la página a puntos de la pantalla (medido con CALIBRAR=1: (0, 59) en «Torre iPhone 16»)

// ---------- Datos de la toma (fuera de cámara) ----------
/** Cliente de la API local con cookie y CSRF, como la app (sólo para preparar y limpiar datos de prueba; nunca producción). */
async function api(correo, clave) {
  const r = await fetch(`${HOST}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: HOST }, body: JSON.stringify({ email: correo, password: clave }) });
  if (!r.ok) throw new Error(`login ${correo}: ${r.status}`);
  const cookie = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrf } = await r.json();
  return async (metodo, ruta, cuerpo) => {
    const res = await fetch(`${HOST}${ruta}`, { method: metodo, headers: { cookie, 'x-csrf-token': csrf, origin: HOST }, body: cuerpo });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${metodo} ${ruta}: ${res.status} ${j.error ?? ''}`);
    return j;
  };
}
/** v10: el vecino de prueba paga con tarjeta (voucher de prueba) y el tesorero da su conformidad, para que la administradora lo valide en cámara. */
async function prepararPagoV10() {
  const fila = psql(`select u.id, rc.recibo_id from "Unidad" u join "ReciboConceptoUnidad" rcu on rcu.unidad_id=u.id join "ReciboConcepto" rc on rc.id=rcu.recibo_concepto_id where u.codigo='${UNIDAD_V10}' and rcu.estado_pago='pendiente' and not rc.es_recargo order by rc.recibo_id desc limit 1`);
  const [unidadId, reciboId] = fila.split('|');
  if (!unidadId) throw new Error(`${UNIDAD_V10} no tiene un mantenimiento pendiente`);
  const vecino = await api(VECINO_V10, 'prop1234');
  const form = new FormData();
  form.set('metodo_pago', 'tarjeta');
  form.set('voucher', new Blob([readFileSync(VOUCHER)], { type: 'image/jpeg' }), 'voucher-prueba.jpg');
  const { pago_id, grupo } = await vecino('POST', `/api/me/mantenimientos/${reciboId}/${unidadId}/pagos`, form);
  const tesorero = await api('gustavo.cruz.4@prueba.house', 'prop1234'); // tesorero del condominio (lista DEMO: «Tesorero central»)
  await tesorero('PUT', `/api/pagos/${pago_id}/conformidad`);
  console.log(`pago de prueba creado: ${UNIDAD_V10} · pago ${pago_id} · grupo ${grupo}`);
  return { reciboId, unidadId, grupo };
}
/** Deja la base como estaba: borra SOLO los pagos creados en esta toma (id mayor al máximo de antes de grabar y del vecino de la toma) y devuelve a
 *  `pendiente` únicamente los cargos de ESOS pagos. Nunca consulta por unidad ni por vecino a secas: un vecino puede tener historial pagado. */
function limpiarPagosDeLaToma(maxAntes, correo) {
  const filas = psql(`select p.id, p.recibo_concepto_unidad_id from "Pago" p join "Usuario" u on u.id=p.usuario_id where p.id > ${Number(maxAntes)} and u.email='${correo.replace(/'/g, '')}'`).split('\n').filter(Boolean).map((f) => f.split('|').map(Number));
  if (filas.length > 40) throw new Error(`Limpieza abortada: ${filas.length} pagos nuevos de ${correo} (se esperaban pocos)`);
  if (!filas.length) { console.log(`limpieza ${correo}: sin pagos nuevos`); return; }
  const pagos = filas.map((f) => f[0]).join(','), cargos = filas.map((f) => f[1]).join(',');
  psql(`delete from "Pago" where id in (${pagos})`);
  psql(`update "ReciboConceptoUnidad" set estado_pago='pendiente', fecha_pago=null, url_voucher=null where id in (${cargos}) and estado_pago in ('en_revision','pagado')`);
  console.log(`limpieza ${correo}: ${filas.length} pago(s) de la toma borrados (ids ${filas[0][0]}..${filas[filas.length - 1][0]}); sus cargos, en pendiente`);
}

// ---------- WebView ----------
/** Página: el elemento visible que cumple `d` ({sel, texto, n}); se desplaza hasta verlo y se devuelve su rectángulo en píxeles CSS. */
const BUSCAR = `const d = arguments[0];
  const re = d.texto ? new RegExp(d.texto, 'i') : null;
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  let els = [...document.querySelectorAll(d.sel || 'button,a,[role=button],[role=tab],label,summary')].filter(vis);
  if (re) els = els.filter((e) => re.test((e.innerText || e.value || e.getAttribute('aria-label') || e.placeholder || '').trim()));
  els = els.filter((e) => !els.some((o) => o !== e && e.contains(o)));
  const el = els[d.n || 0];
  if (!el) return null;
  el.scrollIntoView({ block: d.centro === false ? 'nearest' : 'center', behavior: 'instant' });
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };`;
/** Círculo de «toque» sobre la página (se quita solo). */
const TOQUE = `const [x, y] = arguments;
  const d = document.createElement('div');
  Object.assign(d.style, { position: 'fixed', left: (x - 28) + 'px', top: (y - 28) + 'px', width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(40,40,40,.28)',
    border: '2px solid rgba(255,255,255,.85)', pointerEvents: 'none', zIndex: 2147483647, transition: 'transform .45s ease-out, opacity .45s ease-out', transform: 'scale(.6)', opacity: '1' });
  document.body.appendChild(d);
  requestAnimationFrame(() => { d.style.transform = 'scale(1)'; setTimeout(() => { d.style.opacity = '0'; }, 250); });
  setTimeout(() => d.remove(), 900);`;
/** Quita del DOM lo que no va en un video: el recuadro «Cuentas de prueba» del login y la tarjeta «Canales» (envíos apagados en local). */
const LIMPIAR = `for (const p of document.querySelectorAll('p')) if (/Cuentas de prueba/i.test(p.textContent ?? '')) p.parentElement?.remove();
  for (const el of document.querySelectorAll('p,div,span')) if (el.children.length === 0 && /Si un canal no está configurado/.test(el.textContent ?? '')) el.closest('[class*="rounded"]')?.remove();
  return true;`;

/** SÓLO PARA LA GRABACIÓN: los campos de la web miden 14 px y iOS hace zoom al enfocarlos (la página se corre y se desalinea). Se fija `maximum-scale=1`
 *  en la página (no en el código de Torre). Es un defecto real de la web en iPhone: ver el HANDOFF. */
const SIN_ZOOM = `let m = document.querySelector('meta[name=viewport]');
  if (!m) { m = document.createElement('meta'); m.name = 'viewport'; document.head.appendChild(m); }
  if (!/maximum-scale/.test(m.content)) m.content = (m.content || 'width=device-width, initial-scale=1') + ', maximum-scale=1';
  return true;`;

const web = (script, ...args) => ses.js(script, ...args);
const esperarWeb = async (cuerpo, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await web(cuerpo).catch(() => false)) return true; await pausa(400); } return false; };
const asentar = async () => { await esperarWeb('return document.readyState === "complete"', 8000); await web(LIMPIAR).catch(() => {}); await web(SIN_ZOOM).catch(() => {}); await pausa(400); };
const hayTexto = (re) => esperarWeb(`return new RegExp(${JSON.stringify(re)}, 'i').test(document.body.innerText)`);

/** Cambio de pantalla dentro de la app (SPA, sin recargar). */
async function ir(ruta) {
  await web('history.pushState({}, "", arguments[0]); dispatchEvent(new PopStateEvent("popstate", { state: {} }));', ruta);
  await pausa(900);
  await asentar();
}
/** Toque nativo real sobre el elemento de la página, con el círculo de toque. */
async function tocar(d) {
  const r = await web(BUSCAR, d);
  if (!r) throw new Error(`No encuentro ${JSON.stringify(d)}`);
  await pausa(250);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  await web(TOQUE, cx, cy);
  await ses.tocar(cx + ox, cy + oy);
  await pausa(450);
}
/** Teclea con el teclado, tecla por tecla, en el campo tocado. */
async function escribir(d, texto) {
  await tocar(d);
  await pausa(300);
  const tipo = await web('const e = document.activeElement; return e && e.type === "password" ? "SecureTextField" : e && e.tagName === "TEXTAREA" ? "TextView" : "TextField"');
  await ses.teclear(texto, tipo);
  const v = await web('return document.activeElement && document.activeElement.value').catch(() => '');
  if (v !== texto) { // el teclado no escribió todo: se completa por la página
    await web('const el = document.activeElement; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, arguments[0]); el.dispatchEvent(new Event("input", { bubbles: true }));', texto);
  }
}
/** Desplaza con un gesto real de arrastre (el dedo sube = baja la página). */
// Empieza siempre dentro del contenido (nunca sobre la barra inferior de Safari: un gesto hacia arriba ahí abre el resumen de pestañas).
const deslizar = (dy = 380, seg = 0.7) => { const y1 = Math.min(560 + dy / 2, 660); return ses.arrastrar(200, y1, 200, y1 - dy, seg); };

/** Calibra el paso de píxeles CSS a puntos con el botón «Ingresar» (lo ve la página y el árbol nativo). */
async function calibrar() {
  const r = await web(BUSCAR, { texto: '^ingresar$', centro: false });
  if (!r) return;
  await ses.nativo();
  try {
    const e = await ses.buscar('-ios predicate string', "label == 'Ingresar' AND type == 'XCUIElementTypeButton'", 4000);
    const n = await ses.rect(e);
    ox = n.x - r.x; oy = n.y - r.y;
  } catch { /* se queda la última calibración */ }
  await ses.webview();
}
async function conectarApp() {
  await ses.webview(25000);
  await esperarWeb('return document.readyState === "complete"', 15000);
  await asentar();
  if (process.env.CALIBRAR === '1') await calibrar(); // el desfase es siempre (0, 59) en este simulador; calibrar cuesta ~1 s de cámara
  console.log(`  WebView listo (desfase ${ox.toFixed(1)}, ${oy.toFixed(1)})`);
}
async function iniciarSesion(rol) {
  const [correo, clave] = CUENTAS[rol];
  await escribir({ sel: 'input[type=email], input[name=email], input[autocomplete=username]' }, correo);
  await escribir({ sel: 'input[type=password]' }, clave);
  await tocar({ texto: '^ingresar$', sel: 'button' });
  await esperarWeb('return !/\\/login/.test(location.pathname)', 20000);
  await asentar();
}

// ---------- Teléfono ----------
/** Fuera de cámara: deja el teléfono en la página del inicio donde está el ícono de Torre y guarda su posición (el toque se da en cámara, sin esperas). */
let iconoTorre = null;
async function prepararInicio() {
  await ses.nativo();
  await ses.mobile('pressButton', { name: 'home' });
  await pausa(900);
  await ses.mobile('activateApp', { bundleId: 'com.apple.springboard' });
  await pausa(600);
  const icono = () => ses.elemento('-ios predicate string', "type == 'XCUIElementTypeIcon' AND label == 'Torre' AND visible == 1");
  let e = await icono().catch(() => null);
  if (!e) { await ses.arrastrar(340, 560, 60, 560, 0.35); await pausa(900); e = await icono(); }
  const r = await ses.rect(e);
  iconoTorre = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}
/** En cámara: toque sobre el ícono de Torre en el inicio del teléfono (si venimos de otra pantalla, antes se vuelve al inicio). */
async function abrirTorreDesdeInicio() {
  if (!iconoTorre) await prepararInicio();
  await pausa(500);
  await ses.tocar(iconoTorre.x, iconoTorre.y);
}

/** Safari: lleva el bloque «iPhone» de /app a la posición exacta con un desplazamiento suave por JavaScript (el WebView de Safari por Appium). Si falla, se queda la
 *  posición del gesto. El encabezado «iPhone» queda a 270 px del borde: la tarjeta cabe entera y el pie de la página, con la razón social completa, no entra en cuadro. */
async function ajustarBloqueIphone() {
  try {
    const w = (await ses.contextos()).find((c) => /torrecondominios\.com\/app/.test(c.url ?? ''));
    if (!w) return;
    await ses.contexto(w.id);
    await ses.js(`const h = [...document.querySelectorAll('h2,h3')].find((x) => /^iPhone$/i.test(x.textContent.trim()));
      if (h) window.scrollTo({ top: window.scrollY + h.getBoundingClientRect().top - 270, behavior: 'smooth' }); return !!h;`);
    await pausa(1800);
  } catch (err) { console.warn(`  ajuste del bloque de iPhone: ${err.message.split('\n')[0]}`); }
  finally { await ses.nativo(); }
}

/** Abre la dirección en Safari y comprueba (árbol nativo) que cargó; si no, reintenta (hasta 8 veces). Termina en el inicio del teléfono, con la página ya cargada
 *  en Safari. Cierra Torre antes: si Safari se abre desde la app, muestra «◀ Torre» en la barra de estado. */
async function cargarSafari(url) {
  for (let i = 1; i <= 8; i++) {
    for (const app of [BUNDLE, 'com.apple.mobilesafari']) { try { sh('xcrun', 'simctl', 'terminate', UDID, app); } catch { /* cerrada */ } }
    await pausa(800);
    // Safari arranca con UNA pestaña vacía: se borra su estado de pestañas (si no, abre el resumen de pestañas y acumula las que fallaron).
    const lib = join(process.env.HOME, 'Library/Developer/CoreSimulator/Devices', UDID, 'data/Library/Safari');
    for (const f of ['SafariTabs.db', 'SafariTabs.db-wal', 'SafariTabs.db-shm', 'BrowserState.db', 'BrowserState.db-wal', 'BrowserState.db-shm']) rmSync(join(lib, f), { force: true });
    sh('xcrun', 'simctl', 'openurl', UDID, url);
    await pausa(6500);
    await ses.nativo();
    await ses.mobile('activateApp', { bundleId: 'com.apple.mobilesafari' });
    const fuente = await ses.cmd('GET', '/source');
    if (/Safari no puede abrir la p/i.test(fuente) || /pesta(ñ|n)as"/.test(fuente.match(/label="\d+ pesta[^"]*"/)?.[0] ?? '') && /Nav\. privada/.test(fuente)) { console.log(`  Safari: intento ${i} sin cargar, reintento`); continue; }
    if (/torrecondominios\.com/.test(fuente)) { await ses.mobile('pressButton', { name: 'home' }); await pausa(1200); return; }
  }
  throw new Error('Safari no cargó torrecondominios.com/app en 8 intentos');
}
/** Sin sesión: borra los datos web de la app (cookies, almacenamiento) en el simulador; el ícono se queda donde está. */
function reiniciarApp() {
  try { sh('xcrun', 'simctl', 'terminate', UDID, BUNDLE); } catch { /* no estaba abierta */ }
  const datos = sh('xcrun', 'simctl', 'get_app_container', UDID, BUNDLE, 'data').trim();
  for (const d of ['Library/WebKit', 'Library/Cookies', 'Library/HTTPStorages', 'Library/Caches', 'tmp']) rmSync(join(datos, d), { recursive: true, force: true });
}

// ---------- Escenas ----------
const ESCENAS = {
  v9: [
    // 1. Safari: la página pública /app de producción, con el bloque de iPhone («Agregar a inicio»). Sin iniciar sesión, sin tocar nada de la página.
    //    Fuera de cámara (antes) se carga la página hasta que abra (el QUIC del simulador la corta a veces); en cámara: inicio del teléfono → ícono de Safari.
    { antes: async () => { await cargarSafari('https://torrecondominios.com/app'); },
      accion: async () => {
      await ses.nativo();
      await pausa(900);
      const e = await ses.buscar('-ios predicate string', "type == 'XCUIElementTypeIcon' AND label == 'Safari' AND visible == 1", 5000);
      const r = await ses.rect(e);
      await ses.tocar(r.x + r.width / 2, r.y + r.height / 2);
      await pausa(2200);
      await deslizar(420, 1.3); await pausa(700); // gesto real hacia el bloque de iPhone
      await ajustarBloqueIphone(); // afina la posición: el bloque entero a la vista y el pie de la página (razón social completa) FUERA de cuadro
    } },
    // 2. El ícono de Torre en el inicio del teléfono → splash → pantalla de entrar.
    { accion: async () => {
      await abrirTorreDesdeInicio();
      await pausa(900);
      await conectarApp();
    }, antes: async () => { reiniciarApp(); await prepararInicio(); } },
    // 3. Entra con su correo.
    { accion: async () => { await iniciarSesion('propietario'); } },
    // 4. Inicio: la deuda total.
    { accion: async () => {
      await hayTexto('Deuda total');
      await pausa(900); await deslizar(260, 0.8); await pausa(1000);
    } },
    // 5. Pagar mantenimiento: elige el voucher de la fototeca (selector nativo de iOS).
    { accion: async () => {
      await tocar({ texto: 'Pagar mantenimiento', sel: 'button' });
      await hayTexto('voucher|comprobante');
      await pausa(600);
      await elegirVoucherDeFototeca();
    } },
    // 6. Enviar: el pago queda en revisión (en local no sale ningún aviso).
    { accion: async () => {
      await ses.webview().catch(() => {});
      await tocar({ texto: 'Enviar pago', sel: 'button' });
      await hayTexto('Pago enviado');
      await pausa(1500);
    } },
  ],
  v10: [
    // 1. Abre la app desde el ícono y entra con su cuenta de administradora.
    { accion: async () => {
      await abrirTorreDesdeInicio();
      await pausa(900);
      await conectarApp();
      await iniciarSesion('admin');
    }, antes: async () => { reiniciarApp(); await prepararInicio(); } },
    // 2. Resumen del condominio.
    { accion: async () => {
      await hayTexto('Resumen');
      await pausa(600); await deslizar(300, 0.9); await pausa(900);
    } },
    // 3. Pagos por validar: abre el pago con su voucher (la lectura de la IA sale en el mismo panel).
    { accion: async () => {
      await ir('/admin/pagos');
      await web('const s=[...document.querySelectorAll("select")].find(x=>/Método de pago/i.test(x.getAttribute("aria-label")||x.labels?.[0]?.innerText||"")); if(s){const o=[...s.options].find(o=>/Tarjeta/i.test(o.text)); if(o){s.value=o.value; s.dispatchEvent(new Event("change",{bubbles:true}));}}');
      await asentar();
      await hayTexto(UNIDAD_V10);
      await tocar({ texto: UNIDAD_V10, sel: 'tr,li,a,button,[role=button],div' });
      await esperarWeb('return [...document.querySelectorAll("button")].some(b=>/validar pago/i.test(b.innerText))', 10000);
      await pausa(1200);
    } },
    // 4. Validar el pago (local).
    { accion: async () => {
      await tocar({ texto: 'Validar pago', sel: 'button' });
      await pausa(1500);
      const hayConfirmar = await web('return [...document.querySelectorAll("button")].some(b=>/^confirmar/i.test(b.innerText.trim()))').catch(() => false);
      if (hayConfirmar) await tocar({ texto: '^confirmar', sel: 'button' });
      await pausa(1500);
    } },
    // 5. Morosidad.
    { accion: async () => {
      await ir('/admin/morosidad');
      await pausa(800); await deslizar(300, 0.9); await pausa(900);
    } },
    // 6. Avisar a los vecinos: sólo se señala el botón de avisar, no se pulsa.
    { antes: async () => { await ir('/admin/recibos'); await esperarWeb('return document.querySelectorAll("tbody tr").length > 0', 15000); },
      accion: async () => {
      await tocar({ sel: 'tbody tr' });
      await tocar({ texto: 'avisar a los vecinos', sel: 'button' });
      await pausa(500);
      await senalar({ texto: 'enviar aviso|^avisar$', sel: 'button' });
    } },
  ],
};

/** Señala un botón sin pulsarlo: un anillo sobre la pantalla que se quita a los 2 s. */
async function senalar(d) {
  const r = await web(BUSCAR, d);
  if (!r) return;
  await web(`const [x, y, w, h] = arguments; document.getElementById('__senal')?.remove();
    const e = document.createElement('div'); e.id = '__senal';
    Object.assign(e.style, { position: 'fixed', left: (x - 8) + 'px', top: (y - 8) + 'px', width: (w + 16) + 'px', height: (h + 16) + 'px', borderRadius: '14px',
      border: '3px solid rgba(15,118,110,.95)', background: 'rgba(15,118,110,.14)', pointerEvents: 'none', zIndex: 2147483647 });
    document.body.appendChild(e); setTimeout(() => e.remove(), 2000);`, r.x, r.y, r.w, r.h);
  await pausa(2100);
}

/** Toca el campo del voucher y elige la foto de la fototeca con el selector nativo de iOS. */
async function elegirVoucherDeFototeca() {
  await tocar({ sel: 'label,button,[role=button]', texto: 'voucher|comprobante|foto|galer|adjunt|elegir|subir' });
  await ses.nativo();
  await pausa(600);
  const tocarNativo = async (pred, ms = 6000) => { const e = await ses.buscar('-ios predicate string', pred, ms); const r = await ses.rect(e); await ses.tocar(r.x + r.width / 2, r.y + r.height / 2); await pausa(500); };
  await tocarNativo("label CONTAINS[c] 'Fototeca' OR label CONTAINS[c] 'Photo Library' OR label CONTAINS[c] 'Biblioteca'").catch(() => {});
  await pausa(900);
  // El voucher de prueba es la única foto de este año (agregada con `xcrun simctl addmedia`): su nombre no trae «de <año>» («Foto, 10-noviembre, 8:38 p. m.»).
  let fotos = await ses.cmd('POST', '/elements', { using: '-ios predicate string', value: "type == 'XCUIElementTypeImage' AND visible == 1 AND label MATCHES '^Foto, [0-9]+-.*'" });
  if (!fotos.length) fotos = await ses.cmd('POST', '/elements', { using: '-ios predicate string', value: "type == 'XCUIElementTypeImage' AND visible == 1 AND label BEGINSWITH 'Foto'" });
  if (!fotos.length) throw new Error('No hay fotos visibles en el selector');
  const ultima = Object.values(fotos[0])[0];
  const r = await ses.rect(ultima);
  await ses.tocar(r.x + r.width / 2, r.y + r.height / 2);
  await pausa(1000);
  // Con la foto elegida el selector muestra la vista previa («1 foto seleccionada»): se confirma con «Listo» / «Agregar».
  await tocarNativo("type == 'XCUIElementTypeButton' AND (label == 'Listo' OR label == 'Agregar' OR label == 'Done' OR label == 'Add')", 5000).catch(() => {});
  await pausa(900);
  await ses.webview().catch(() => {});
  await pausa(500);
}

// ---------- Grabación ----------
/** Si una acción falla, deja una captura del simulador para ver dónde se quedó (en iphone/error-e<N>.png). */
function fotoDeError(n, sufijo = 'error') { try { sh('xcrun', 'simctl', 'io', UDID, 'screenshot', join(SALIDA, `${sufijo}-e${n}.png`)); } catch { /* sin captura */ } }

/** Un clip por escena (recordVideo). Devuelve el recorte: desde el primer cuadro hasta la acción. */
async function grabarEscena(n, largoMs, escena) {
  if (escena.antes) await escena.antes();
  if (SIN_VIDEO) {
    try { await escena.accion(); } catch (err) { console.warn(`  escena ${n}: ${err.message.split('\n')[0]}`); fotoDeError(n); }
    await pausa(500);
    return 0;
  }
  const archivo = join(SALIDA, `e${n}.mp4`);
  rmSync(archivo, { force: true });
  const proc = spawn('xcrun', ['simctl', 'io', UDID, 'recordVideo', '--codec', 'h264', '--force', archivo], { stdio: ['ignore', 'ignore', 'pipe'] });
  const cerrado = new Promise((r) => proc.on('close', r));
  const empezo = new Promise((r) => { proc.stderr.on('data', (b) => { if (/Recording started/i.test(String(b))) r(Date.now()); }); setTimeout(() => r(Date.now()), 8000); });
  const tInicio = await empezo;
  await pausa(300);
  const tAccion = Date.now();
  try { await escena.accion(); } catch (err) { console.warn(`  escena ${n}: ${err.message.split('\n')[0]}`); fotoDeError(n); }
  const resto = largoMs - (Date.now() - tAccion);
  if (resto > 0) await pausa(resto);
  if (process.env.FOTO_FIN === '1') fotoDeError(n, 'fin');
  proc.kill('SIGINT'); // simctl cierra el archivo al recibir SIGINT
  await Promise.race([cerrado, pausa(20000)]);
  if (proc.exitCode === null) proc.kill('SIGKILL');
  return (tAccion - tInicio) / 1000;
}

async function grabar() {
  const escenas = ESCENAS[video];
  if (!escenas) throw new Error(`No hay escenas para ${video} (v9 o v10)`);
  mkdirSync(SALIDA, { recursive: true });
  const recortes = {};
  let maxPago = 0;
  const total = escenas.length + 1;
  ses = await SesionIOS.crear({ base: APPIUM, udid: UDID, extra: { 'appium:derivedDataPath': process.env.WDA_DD } });
  try {
    maxPago = Number(psql('select coalesce(max(id),0) from "Pago"')); // los pagos de la toma son los que quedan por encima
    console.log(`Pago.max(id) antes de la toma: ${maxPago}`);
    if (video === 'v10') await prepararPagoV10();
    for (let i = 0; i < total; i++) {
      const n = i + 1;
      if (SOLO && n !== SOLO) continue;
      const largo = duracion(n) * 1000 + 700;
      if (n === total) { recortes[`e${n}`] = await crearCierre(SALIDA, n, largo); console.log(`escena ${n} (cierre): ${(largo / 1000).toFixed(1)} s`); continue; }
      recortes[`e${n}`] = await grabarEscena(n, largo, escenas[i]);
      console.log(`escena ${n}: ${(largo / 1000).toFixed(1)} s · recorte ${recortes[`e${n}`].toFixed(2)} s`);
    }
  } finally {
    await cerrarTodo();
    if (!SIN_VIDEO) {
      const f = join(SALIDA, 'recortes.json');
      const previo = SOLO ? (() => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } })() : {};
      writeFileSync(f, JSON.stringify({ ...previo, ...recortes }, null, 1));
    }
    // La base local queda como estaba (también si la toma falló a medias): sólo se borra lo creado en la toma.
    try { limpiarPagosDeLaToma(maxPago, video === 'v10' ? VECINO_V10 : VECINO); } catch (err) { console.warn(`limpieza: ${err.message}`); }
  }
}

/** Salida limpia: cierra la sesión de Appium (con tope) y deja un guardián por si algo sigue abierto. */
async function cerrarTodo() {
  setTimeout(() => process.exit(process.exitCode ?? 0), 20000).unref();
  await Promise.race([ses?.cerrar(), pausa(10000)]);
}

grabar().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
