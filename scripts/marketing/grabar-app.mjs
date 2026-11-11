// Graba las escenas de un video de Torre en el CELULAR (Android): la app de DESARROLLO (TORRE_URL=http://10.0.2.2:4000) con el backend LOCAL.
// Uso: ANDROID_SERIAL=emulator-5590 node scripts/marketing/grabar-app.mjs <v9|v10> [SOLO=n]
//   · La pantalla se graba con `adb shell screenrecord` (se ve el teléfono real: barra de estado, ícono, splash).
//   · Los toques son reales (`adb shell input tap`, con «Mostrar toques» encendido) y las coordenadas salen del WebView (Playwright `_android`).
//   · Cada escena es un clip e<N>.mp4 + recortes.json en .claude/videos/<video>/celular/. El montaje (voz + clips + cierre) es scripts/marketing/montar-video.sh.
//   · Nunca producción: la app apunta a 10.0.2.2:4000 (backend local). Ningún envío sale del equipo: los avisos están apagados en ese backend.
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crearCierre } from './cierre-app.mjs';

const require = createRequire(import.meta.url);
const { _android: android } = require(process.env.PLAYWRIGHT ?? '/opt/homebrew/lib/node_modules/playwright');

const SERIE = process.env.ANDROID_SERIAL;
if (!SERIE) throw new Error('Falta ANDROID_SERIAL (el emulador que grabas, p. ej. emulator-5590)');
const [video = 'v9'] = process.argv.slice(2);
const SOLO = process.env.SOLO ? Number(process.env.SOLO) : null;
const PKG = 'com.torrecondominios.app';
const HOST = 'http://10.0.2.2:4000'; // el emulador ve el Mac como 10.0.2.2
const BASE = join(process.cwd(), '.claude/videos', video);
const SALIDA = join(BASE, 'celular');
const VOUCHER = join(process.cwd(), '.claude/videos', 'voucher-prueba.jpg');
// Cada toma usa un VECINO de prueba distinto (@prueba.house, con un mantenimiento pendiente y sin pagos; ver la doc). El de v9 es A; el de v10, B
// (su pago de «tarjeta» se crea fuera de cámara antes de grabar y se borra al terminar). La contraseña de prueba de propietarios es la del seed.
const VECINO = process.env.VECINO ?? 'maria.espinoza.160@prueba.house';
const CUENTAS = {
  propietario: [VECINO, 'prop1234'],
  admin: ['ana.lopez@administradorademo.example', 'admin1234'], // administradora del seed
};
const ROL = video === 'v10' ? 'admin' : 'propietario';
const UNIDAD_V10 = process.env.UNIDAD_V10 ?? 'B13-804'; // unidad del vecino B: su pago es el que valida la administradora

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
// `timeout`: un adb colgado no puede dejar el grabador esperando para siempre.
const adb = (...a) => execFileSync('adb', ['-s', SERIE, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 90000 });
const duracion = (n) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(BASE, 'voz', `e${n}.wav`)]).toString().trim());

// ---------- Dispositivo ----------
const tap = (x, y) => adb('shell', 'input', 'tap', String(x), String(y));
const deslizar = (y1, y2, ms = 900) => adb('shell', 'input', 'swipe', '540', String(y1), '540', String(y2), String(ms));
const tecla = (k) => adb('shell', 'input', 'keyevent', k);
function uiDump() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/torre-ui.xml');
  return adb('shell', 'cat', '/sdcard/torre-ui.xml');
}
/** Centro (en píxeles del equipo) del primer nodo con ese texto exacto. */
function centroDeTexto(xml, texto) {
  const re = new RegExp(`text="${texto}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = xml.match(re);
  if (!m) return null;
  return { x: (Number(m[1]) + Number(m[3])) / 2, y: (Number(m[2]) + Number(m[4])) / 2 };
}
/** Abre Torre desde el inicio del teléfono (ícono en la pantalla de inicio o en el cajón de apps). */
async function abrirTorre() {
  tecla('KEYCODE_HOME');
  await pausa(1500);
  for (let intento = 0; intento < 3; intento++) {
    const c = centroDeTexto(uiDump(), 'Torre');
    if (c) { tap(Math.round(c.x), Math.round(c.y)); return; }
    deslizar(1900, 700, 500); // cajón de apps
    await pausa(1200);
  }
  throw new Error('No encuentro el ícono de Torre en el teléfono');
}

// ---------- WebView (Playwright) ----------
let dev, wv, page, dpr = 2.75, y0 = 66;
const webviewTop = (xml) => {
  const m = xml.match(/class="android.webkit.WebView"[^>]*bounds="\[\d+,(\d+)\]\[\d+,\d+\]"/);
  return m ? Number(m[1]) : 66;
};
async function conectar() {
  dev = (await android.devices()).find((d) => d.serial() === SERIE);
  if (!dev) throw new Error(`No veo el equipo ${SERIE} desde Playwright`);
  wv = await dev.webView({ pkg: PKG });
  page = await wv.page();
  page.setDefaultTimeout(12000);
  dpr = await page.evaluate(() => devicePixelRatio);
  y0 = webviewTop(uiDump());
}
/** Quita del DOM lo que no va en un video: el recuadro «Cuentas de prueba» del login y la tarjeta «Canales» (envíos apagados en local). */
const LIMPIAR = `(() => {
  for (const p of document.querySelectorAll('p')) if (/Cuentas de prueba/i.test(p.textContent ?? '')) p.parentElement?.remove();
  for (const el of document.querySelectorAll('p,div,span')) if (el.children.length === 0 && /Si un canal no está configurado/.test(el.textContent ?? '')) el.closest('[class*="rounded"]')?.remove();
})()`;
const asentar = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.evaluate(LIMPIAR).catch(() => {}); await pausa(400); };
/** Cambio de pantalla dentro de la app (sin recargar el WebView: la app es una SPA). */
async function ir(ruta) {
  await page.evaluate((r) => { history.pushState({}, '', r); dispatchEvent(new PopStateEvent('popstate', { state: {} })); }, ruta);
  await pausa(900);
  await asentar();
}
/** Toca el elemento con un toque real del teléfono (se ve el punto de «Mostrar toques»). */
async function tocar(loc) {
  const el = loc.first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const b = await el.boundingBox();
  if (!b) { await el.click(); return; }
  tap(Math.round((b.x + b.width / 2) * dpr), Math.round(y0 + (b.y + b.height / 2) * dpr));
  await pausa(350);
}
/** Señala un elemento sin tocarlo: un anillo sobre la pantalla que se quita a los 2 s (igual que el cursor de la web). */
async function senalar(loc) {
  const el = loc.first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await page.evaluate(() => {
    document.getElementById('__senal')?.remove();
  });
  const b = await el.boundingBox();
  if (!b) return;
  await page.evaluate(({ x, y, w, h }) => {
    const d = document.createElement('div');
    d.id = '__senal';
    Object.assign(d.style, { position: 'fixed', left: `${x - 8}px`, top: `${y - 8}px`, width: `${w + 16}px`, height: `${h + 16}px`, borderRadius: '14px',
      border: '3px solid rgba(15,118,110,.95)', background: 'rgba(15,118,110,.14)', pointerEvents: 'none', zIndex: 2147483647 });
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 2000);
  }, b);
  await pausa(2100);
}
/** Escribe con el teclado, como una persona. */
async function escribir(loc, texto) {
  await tocar(loc);
  await page.keyboard.type(texto, { delay: 35 });
  const v = await loc.first().inputValue().catch(() => '');
  if (v !== texto) await loc.first().fill(texto);
}
/** Desplaza la página hasta que aparezca la fila o el texto (gesto de deslizar, visible). */
async function buscarTexto(texto, maxDeslizes = 14) {
  for (let i = 0; i < maxDeslizes; i++) {
    if (await page.getByText(texto).first().isVisible().catch(() => false)) return true;
    deslizar(1700, 1000, 700);
    await pausa(700);
  }
  return false;
}

// ---------- Escenas ----------
/** Espera a que el cargador de Torre termine (splash) y la pantalla de inicio esté lista. */
const esperaInicio = async () => { await page.waitForLoadState('domcontentloaded').catch(() => {}); await pausa(1200); await asentar(); };

async function iniciarSesion(rol) {
  const [correo, clave] = CUENTAS[rol];
  await escribir(page.getByLabel('Correo electrónico'), correo);
  await escribir(page.getByLabel('Contraseña', { exact: true }), clave);
  await tocar(page.getByRole('button', { name: 'Ingresar' }));
  await page.waitForURL((u) => !/\/login/.test(u.toString()), { timeout: 20000 }).catch(() => {});
  await asentar();
}

const ESCENAS = {
  v9: [
    // 1. El navegador del teléfono: la página /app (copia local; el botón no se toca: la descarga real es de producción).
    { accion: async () => {
      // HOST_NAVEGADOR: el backend cuyo /app se muestra en el navegador (el de la app sigue en HOST).
      adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `${process.env.HOST_NAVEGADOR ?? HOST}/app`);
      await pausa(3000);
      deslizar(1500, 1000, 1300); await pausa(1200);
    } },
    // 2. El ícono de Torre y el splash verde. Después de abrirla, se conecta el WebView.
    { accion: async () => {
      await abrirTorre();
      await pausa(900);
      await conectar();
      await esperaInicio();
    } },
    // 3. Entra con su correo.
    { accion: async () => { await iniciarSesion('propietario'); } },
    // 4. Inicio: la deuda total.
    { accion: async () => {
      await page.getByText('Deuda total').first().waitFor({ timeout: 15000 }).catch(() => {});
      await pausa(900); deslizar(1500, 1300, 900); await pausa(1000);
    } },
    // 5. Pagar mantenimiento: sube el voucher desde la galería (ver «Cómo grabar» en la doc).
    { accion: async () => {
      await tocar(page.getByRole('button', { name: 'Pagar mantenimiento' }));
      await page.getByText('Pagar mantenimiento').first().waitFor({ timeout: 8000 }).catch(() => {});
      await pausa(600);
      await page.locator('input[type=file]').first().setInputFiles(VOUCHER);
      await page.getByText('voucher-prueba.jpg').first().waitFor({ timeout: 8000 }).catch(() => {});
      await pausa(800);
    } },
    // 6. Enviar: el pago queda en revisión (en local no sale ningún aviso).
    { accion: async () => {
      await tocar(page.getByRole('button', { name: 'Enviar pago' }));
      await page.getByText('Pago enviado').first().waitFor({ timeout: 15000 }).catch(() => {});
      await pausa(1500);
    } },
  ],
  v10: [
    // 1. Abre la app y entra con su cuenta de administradora.
    { accion: async () => {
      await abrirTorre();
      await pausa(900);
      await conectar();
      await esperaInicio();
      await iniciarSesion('admin');
    } },
    // 2. Resumen del condominio.
    { accion: async () => {
      await page.getByText('Resumen').first().waitFor({ timeout: 15000 }).catch(() => {});
      await pausa(600); deslizar(1500, 1000, 1000); await pausa(900);
    } },
    // 3. Pagos por validar: abre el pago con su voucher (la lectura de la IA sale en el mismo panel).
    { accion: async () => {
      await ir('/admin/pagos');
      // Filtro «Método de pago» = Tarjeta (el pago de prueba de B es con tarjeta: así la lista es corta); luego se busca su unidad.
      await page.getByLabel('Método de pago').first().selectOption({ label: 'Tarjeta' }).catch(() => {});
      await asentar();
      await buscarTexto(UNIDAD_V10);
      await tocar(page.getByText(UNIDAD_V10).first());
      await page.getByRole('button', { name: 'Validar pago' }).first().waitFor({ timeout: 10000 }).catch(() => {});
      await pausa(1200);
    } },
    // 4. Validar el pago (local).
    { accion: async () => {
      await tocar(page.getByRole('button', { name: 'Validar pago' }));
      await pausa(1500);
      const confirmar = page.getByRole('button', { name: /^confirmar/i });
      if (await confirmar.first().isVisible().catch(() => false)) await tocar(confirmar);
      await pausa(1500);
    } },
    // 5. Morosidad.
    { accion: async () => {
      await ir('/admin/morosidad');
      await pausa(800); deslizar(1500, 1000, 1000); await pausa(900);
    } },
    // 6. Avisar a los vecinos: sólo se señala el botón de avisar, no se pulsa.
    { accion: async () => {
      await ir('/admin/recibos');
      await tocar(page.locator('tbody tr').first());
      await tocar(page.getByRole('button', { name: /avisar a los vecinos/i }));
      await pausa(1000);
      await senalar(page.getByRole('button', { name: /enviar aviso|^avisar$/i }));
    } },
  ],
};

/** Un clip por escena: screenrecord de `limite` s (el montaje corta al largo de la voz). Devuelve el recorte: desde el primer cuadro hasta la acción. */
async function grabarEscena(n, largoMs, accion) {
  const remoto = `/sdcard/torre-${video}-e${n}.mp4`;
  const limite = Math.ceil((largoMs + 2500) / 1000);
  const proc = spawn('adb', ['-s', SERIE, 'shell', 'screenrecord', '--size', '1080x2340', '--bit-rate', '8000000', '--time-limit', String(limite), remoto], { stdio: 'ignore' });
  const cerrado = new Promise((r) => proc.on('close', r));
  const tSpawn = Date.now();
  await pausa(900);
  const tAccion = Date.now();
  try { await accion(); } catch (err) { console.warn(`  escena ${n}: ${err.message.split('\n')[0]}`); }
  const resto = largoMs - (Date.now() - tAccion);
  if (resto > 0) await pausa(resto);
  await Promise.race([cerrado, pausa((limite + 15) * 1000)]);
  adb('pull', remoto, join(SALIDA, `e${n}.mp4`));
  adb('shell', 'rm', '-f', remoto);
  // Recorte: el clip empieza unos 0,4 s después de lanzar screenrecord (arranque del grabador; medido en las pruebas), así que la acción
  // queda a (0,9 s − 0,4 s) del principio. No se mide de la duración del archivo: screenrecord no guarda cuadros cuando la pantalla está quieta.
  return (tAccion - tSpawn) / 1000 - 0.4;
}

async function grabar() {
  const escenas = ESCENAS[video];
  if (!escenas) throw new Error(`No hay escenas para ${video} (v9 o v10)`);
  mkdirSync(SALIDA, { recursive: true });
  const recortes = {};
  // Las escenas de la app + la tarjeta de cierre (la última). La voz de cada una manda el largo.
  const total = escenas.length + 1;
  adb('shell', 'settings', 'put', 'system', 'show_touches', '1');
  adb('shell', 'svc', 'power', 'stayon', 'true');
  adb('shell', 'pm', 'clear', PKG); // cada grabación empieza sin sesión (login de la escena 3 / 1)
  try {
    for (let i = 0; i < total; i++) {
      const n = i + 1;
      if (SOLO && n !== SOLO) continue;
      const largo = duracion(n) * 1000 + 700;
      if (n === total) { recortes[`e${n}`] = await crearCierre(SALIDA, n, largo); console.log(`escena ${n} (cierre): ${(largo / 1000).toFixed(1)} s`); continue; }
      const e = escenas[i];
      recortes[`e${n}`] = await grabarEscena(n, largo, e.accion);
      console.log(`escena ${n}: ${(largo / 1000).toFixed(1)} s · recorte ${recortes[`e${n}`].toFixed(2)} s`);
    }
  } finally {
    await cerrarTodo();
    adb('shell', 'settings', 'put', 'system', 'show_touches', '0');
    adb('shell', 'svc', 'power', 'stayon', 'false');
    if (!SOLO) writeFileSync(join(SALIDA, 'recortes.json'), JSON.stringify(recortes, null, 1));
    else {
      // Con SOLO sólo se graba una escena: se conservan los recortes de las demás.
      const f = join(SALIDA, 'recortes.json');
      const previo = (() => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return {}; } })();
      writeFileSync(f, JSON.stringify({ ...previo, ...recortes }, null, 1));
    }
  }
}

/** Salida limpia: cierra el WebView de Playwright, el screenrecord que haya quedado y los `adb forward` del WebView. Cada paso tiene tope de tiempo
 *  (`dev.close()` se quedaba esperando y el proceso no terminaba). Un guardián deja la salida segura aunque algo siga abierto. */
async function cerrarTodo() {
  setTimeout(() => process.exit(process.exitCode ?? 0), 20000).unref();
  await Promise.race([Promise.resolve(dev?.close?.()).catch(() => {}), pausa(6000)]);
  try { adb('shell', 'pkill', 'screenrecord'); } catch { /* ninguno en curso */ }
  try {
    // Playwright abre un `adb forward tcp:<puerto> localabstract:webview_devtools_remote_<pid>` por WebView; se quitan los de ESTE equipo.
    for (const l of adb('forward', '--list').split('\n')) {
      const m = l.match(/^\S+\s+(tcp:\d+)\s+localabstract:webview_devtools_remote_/);
      if (m) adb('forward', '--remove', m[1]);
    }
  } catch { /* sin forwards */ }
}

grabar().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
