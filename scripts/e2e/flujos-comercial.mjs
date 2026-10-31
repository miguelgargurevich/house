// Flujos comerciales E2E de Torre (house): recorre EN EL NAVEGADOR, como lo haría cada persona, la portada y los precios, el alta de una
// administradora en dos pasos, su plan (Gratis → solicitud de Pro → pago que registra el superadmin), el plazo vencido (solo lectura), el
// límite de un condominio en Gratis y las pantallas de la superadministración. La API directa sólo prepara datos (el paso 1 del registro)
// y fabrica el token del correo, porque no hay correo real (en la base sólo se guarda su hash).
//
// Flujos (cada uno independiente; `publico` corre en escritorio y celular):
//   publico        portada, precios (calculadora «Ver mi total»), /privacidad y /terminos
//   registro       registro en DOS pasos: cuenta + correo → condominio; correo repetido, login sin confirmar, paso 2 no repetible
//   plan           cuenta nueva: prueba de Pro dentro del plazo gratis → «Pasar a Pro» → el superadmin registra el pago → Pro activo
//   solo-lectura   plazo vencido (por SQL): el formulario abierto recibe el 409 SOLO_LECTURA en pantalla; al recargar, aviso y botones bloqueados
//   un-condominio  Torre Gratis ya tiene su condominio: «Nuevo condominio» explica por qué no
//   superadmin     resumen, empresa de la cuenta nueva con su condominio, usuarios, auditoría y registro público abierto
//
// Levantar el backend ANTES (desde el checkout principal, que tiene el dist/; sin correo ni WhatsApp):
//   bash ~/Projectos/house/scripts/e2e/levantar.sh 4101 house_e2e_comercial
// Correr desde este worktree (BASE_URL y E2E_DB por defecto: localhost:4101 y house_e2e_comercial):
//   node scripts/e2e/flujos-comercial.mjs                (todos los flujos)
//   node scripts/e2e/flujos-comercial.mjs registro,plan  (sólo esos)
// Apagar al terminar:  kill $(lsof -tiTCP:4101 -sTCP:LISTEN)
// Límite de registros (5 por hora por IP): cada página manda su propia IP en X-Forwarded-For (ver `nuevaPagina`), así que no estorba.
// Capturas en scripts/e2e/capturas/ (ignoradas en git); cada corrida se agrega a scripts/e2e/resultados/comercial.json.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:4101';
const E2E_DB = process.env.E2E_DB ?? 'house_e2e_comercial';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE_URL)) throw new Error('Sólo corre contra localhost: crea cuentas y pagos.');
if (!/^house_e2e[a-z0-9_]*$/.test(E2E_DB)) throw new Error('E2E_DB debe empezar con house_e2e (nunca house ni house_test).');

const AQUI = dirname(fileURLToPath(import.meta.url));
const CAPTURAS = join(AQUI, 'capturas');
const RESULTADOS = join(AQUI, 'resultados');
mkdirSync(CAPTURAS, { recursive: true });
mkdirSync(RESULTADOS, { recursive: true });

const TODOS = ['publico', 'registro', 'plan', 'solo-lectura', 'un-condominio', 'superadmin'];
const pedidos = process.argv[2] ? process.argv[2].split(',').map((s) => s.trim()) : TODOS;
const desconocidos = pedidos.filter((f) => !TODOS.includes(f));
if (desconocidos.length) {
  console.error(`Flujos desconocidos: ${desconocidos.join(', ')}. Válidos: ${TODOS.join(', ')}`);
  process.exit(2);
}

// Datos de prueba: contraseñas propias de esta corrida (la semilla del superadmin es la pública de recorrido-pantallas.mjs).
const CORRIDA = Date.now().toString(36);
const CLAVE = 'Torre2026clave';
const CELULAR = '987654321';
const SUPER = { email: 'miguel.gargurevich@admin.com', clave: 'admin1234' };

const resultados = [];
let contador = 0;
/** El registro público admite 5 cuentas por hora y por IP (y el backend no lo deja configurar): ver el comentario de arriba. */
const AVISO_LIMITE = ' · límite de registros por IP (5 por hora): reinicia el backend con levantar.sh … --sin-copiar y corre el resto';

// ---------------------------------------------------------------- Base de datos y token del correo
/** Consulta SQL en la base E2E (contenedor house-pg). La base ya fue validada arriba; las cadenas que se pasan son nuestras. */
function sql(q) {
  return execFileSync('docker', ['exec', 'house-pg', 'psql', '-U', 'postgres', '-d', E2E_DB, '-X', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', q], { encoding: 'utf8' }).trim();
}

const hashToken = (t) => createHash('sha256').update(t).digest('hex');

/** No hay correo: fabrica el token del enlace, guarda su hash en la fila más nueva de verificación de la cuenta y devuelve el token en claro. */
function fabricarTokenVerificacion(email) {
  const token = randomBytes(32).toString('base64url');
  sql(`update "TokenVerificacionCorreo" set token_hash='${hashToken(token)}', expira_at=now()+interval '1 day', usado_at=null
       where id=(select t.id from "TokenVerificacionCorreo" t join "Usuario" u on u.id=t.usuario_id where u.email='${email}' order by t.id desc limit 1)`);
  return token;
}

/** Fecha de hoy en Lima menos `n` días, como timestamp a medianoche UTC (así se guardan los plazos). */
const diaLima = (n) => `((now() at time zone 'America/Lima')::date ${n >= 0 ? '+' : '-'} ${Math.abs(n)})::timestamp`;

// ---------------------------------------------------------------- Pasos, capturas y errores
async function foto(page, nombre) {
  contador += 1;
  const archivo = `${String(contador).padStart(2, '0')}-${nombre}.png`;
  await page.screenshot({ path: join(CAPTURAS, archivo), fullPage: true }).catch(() => {});
  return archivo;
}

/** Un paso: lo que hace una persona en una pantalla. Si falla, captura, anota el error y sigue con el resto. */
async function paso(flujo, nombre, page, fn) {
  const t0 = Date.now();
  try {
    const nota = (await fn()) || '';
    const archivo = await foto(page, nombre);
    resultados.push({ flujo, paso: nombre, ok: true, nota, foto: archivo, ms: Date.now() - t0, errores: [...page.errores] });
    console.log(`  ok    ${nombre}${nota ? ` — ${nota}` : ''}${page.errores.length ? `  [anotado: ${page.errores.join(' | ')}]` : ''}`);
  } catch (e) {
    const mensaje = String(e.message || e).split('\n')[0].slice(0, 300);
    const archivo = await foto(page, `${nombre}-FALLA`);
    resultados.push({ flujo, paso: nombre, ok: false, nota: mensaje, foto: archivo, ms: Date.now() - t0, errores: [...page.errores] });
    console.log(`  FALLA ${nombre} — ${mensaje}`);
  }
  page.errores.length = 0;
}

/** Página nueva con escritorio 1366×900 o celular 390×844; anota errores de JS, de consola y respuestas 5xx de la API. */
// Cada página sale con su propia IP de documentación (192.0.2.x) en X-Forwarded-For: el backend confía en un proxy y cuenta el límite de
// 5 registros por hora por esa IP, así que una corrida completa no choca con el límite ni hace falta reiniciar el backend entre tandas.
let ipFalsa = Math.floor(Math.random() * 200);
async function nuevaPagina(browser, { movil = false } = {}) {
  const opciones = movil
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1366, height: 900 } };
  const ctx = await browser.newContext({ ...opciones, locale: 'es-PE', extraHTTPHeaders: { 'X-Forwarded-For': `192.0.2.${(ipFalsa++ % 254) + 1}` } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(`pageerror: ${String(e).slice(0, 160)}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errores.push(`consola: ${m.text().slice(0, 160)}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) page.errores.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE_URL, '')}`);
  });
  return { ctx, page };
}

/** Desborde horizontal: en cualquier pantalla el ancho de la página no puede pasar del de la ventana. */
async function sinDesborde(page) {
  const d = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (d > 0) throw new Error(`desborde horizontal de ${d} px`);
  return `sin desborde (${d} px)`;
}

/**
 * El backend guarda el estado de cada condominio 30 s (caché, `comercialDeps.ttlMs`): hasta que vence, una escritura todavía lo ve operativo
 * aunque ya esté vencido (hallazgo en docs/HANDOFF.md). Tras cambiar la base se espera un poco más que esa ventana, para que el siguiente alta
 * lea el estado nuevo. Un `GET` no sirve de señal: el estado de lectura y el de escritura no son el mismo camino.
 */
const CACHE_ESTADO_MS = 31_000;
const esperarCacheDelBackend = () => new Promise((resolver) => setTimeout(resolver, CACHE_ESTADO_MS));

/** Ninguna página pública puede decir «House» ni «para siempre». */
async function sinPalabrasProhibidas(page) {
  const texto = await page.evaluate(() => document.body.innerText);
  const malas = [/\bHouse\b/, /para siempre/i].filter((re) => re.test(texto));
  if (malas.length) throw new Error(`dice algo prohibido: ${malas.map(String).join(', ')}`);
  return 'sin «House» ni «para siempre»';
}

// ---------------------------------------------------------------- Acciones de persona
const respuestaDe = (page, metodo, fragmento) =>
  page.waitForResponse((r) => r.url().includes(fragmento) && r.request().method() === metodo);

/** Pone usuario y clave en el formulario de entrada y pulsa «Ingresar». */
async function llenarLogin(page, email, clave) {
  await page.getByLabel(/^Correo electrónico/).fill(email);
  await page.getByLabel(/^Contraseña/).fill(clave);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

async function ingresarComo(page, email, clave) {
  await page.goto(`${BASE_URL}/login`);
  await llenarLogin(page, email, clave);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
}

const datosCuenta = (tag) => ({
  email: `${tag}.${CORRIDA}@prueba.house`,
  persona: `Persona ${tag} ${CORRIDA}`,
  empresa: `Administradora ${tag} ${CORRIDA}`,
  condominio: `Condominio ${tag} ${CORRIDA}`,
});

/** Paso 2 (con sesión): nombre de la administradora, del condominio y departamentos (aproximado). */
async function pasoDos(page, d) {
  await page.getByLabel(/^Nombre de tu administradora/).fill(d.empresa);
  await page.getByLabel(/^Nombre del condominio/).fill(d.condominio);
  await page.getByLabel(/^N\.º de departamentos/).fill('120');
  const [resp] = await Promise.all([
    respuestaDe(page, 'POST', '/api/comercial/primer-condominio'),
    page.getByRole('button', { name: 'Crear mi condominio' }).click(),
  ]);
  if (resp.status() !== 201) throw new Error(`crear el condominio respondió ${resp.status()}`);
  await page.getByRole('heading', { name: `¡Listo! Creamos ${d.condominio}` }).waitFor();
}

/**
 * Cuenta lista para usar, para los flujos que no prueban el registro: paso 1 por API, correo confirmado con el token fabricado,
 * entrada y paso 2. Deja la sesión abierta en `page`.
 */
async function cuentaNueva(page, tag) {
  const d = datosCuenta(tag);
  const r = await page.request.post(`${BASE_URL}/api/publico/registro`, {
    data: { nombre: d.persona, email: d.email, celular: CELULAR, password: CLAVE, acepta_terminos: true },
  });
  if (r.status() !== 202) throw new Error(`paso 1 por API respondió ${r.status()}${r.status() === 429 ? AVISO_LIMITE : ''}`);
  await page.goto(`${BASE_URL}/verificar-correo?token=${encodeURIComponent(fabricarTokenVerificacion(d.email))}`);
  await page.getByRole('heading', { name: '¡Correo confirmado!' }).waitFor();
  await ingresarComo(page, d.email, CLAVE);
  await page.waitForURL(/\/admin\/bienvenida/, { timeout: 15000 });
  await pasoDos(page, d);
  return d;
}

// ---------------------------------------------------------------- Flujos
const flujos = {};

flujos.publico = async (browser) => {
  for (const movil of [false, true]) {
    const vista = movil ? 'celular' : 'escritorio';
    const F = `Público (${vista})`;
    const { ctx, page } = await nuevaPagina(browser, { movil });
    try {
      await paso(F, `portada-${vista}`, page, async () => {
        await page.goto(`${BASE_URL}/`);
        await page.getByRole('link', { name: 'Crear cuenta gratis' }).first().waitFor();
        return `${await sinPalabrasProhibidas(page)} · ${await sinDesborde(page)}`;
      });

      await paso(F, `precios-planes-${vista}`, page, async () => {
        await page.goto(`${BASE_URL}/precios`);
        for (const plan of ['Torre Gratis', 'Torre Básico', 'Torre Pro', 'Torre Administradora']) {
          await page.getByText(plan, { exact: true }).first().waitFor();
        }
        return `4 planes · ${await sinPalabrasProhibidas(page)} · ${await sinDesborde(page)}`;
      });

      await paso(F, `precios-calculadora-${vista}`, page, async () => {
        const total = () => page.locator('#recibo p.text-5xl').first().innerText();
        // «Ver mi total» del plan Pro (en celular, si el enlace está plegado, se despliega solo al tocarlo).
        const enlace = page.getByRole('link', { name: 'Ver mi total' }).first();
        await enlace.scrollIntoViewIfNeeded();
        await enlace.click();
        await page.locator('#recibo').waitFor();
        const deptos = page.locator('#deptos');
        // Punto de partida fijo: Torre Pro con 20 departamentos. Con Básico y 20 cuesta menos (S/ 20 contra S/ 50 de Pro).
        await Promise.all([
          page.waitForResponse((r) => r.url().includes('/api/publico/cotizar')),
          page.locator('#recibo label', { hasText: 'Torre Pro' }).first().click(),
        ]);
        await Promise.all([page.waitForResponse((r) => r.url().includes('/api/publico/cotizar')), deptos.fill('20')]);
        const a = await total();
        await Promise.all([page.waitForResponse((r) => r.url().includes('/api/publico/cotizar')), deptos.fill('300')]);
        const b = await total();
        await deptos.fill('20');
        await Promise.all([
          page.waitForResponse((r) => r.url().includes('/api/publico/cotizar')),
          page.locator('#recibo label', { hasText: 'Torre Básico' }).first().click(),
        ]);
        const c = await total();
        if (a === b) throw new Error(`cambiar los departamentos no cambió el total (${a})`);
        if (a === c) throw new Error(`cambiar de plan no cambió el total (${a})`);
        return `20 deptos ${a} · 300 deptos ${b} · Básico 20 deptos ${c} · ${await sinDesborde(page)}`;
      });

      await paso(F, `privacidad-${vista}`, page, async () => {
        await page.goto(`${BASE_URL}/privacidad`);
        await page.getByRole('heading', { level: 1, name: /privacidad/i }).waitFor();
        return `${await sinPalabrasProhibidas(page)} · ${await sinDesborde(page)}`;
      });

      await paso(F, `terminos-${vista}`, page, async () => {
        await page.goto(`${BASE_URL}/terminos`);
        await page.getByRole('heading', { level: 1, name: /términos/i }).waitFor();
        return `${await sinPalabrasProhibidas(page)} · ${await sinDesborde(page)}`;
      });
    } finally {
      await ctx.close();
    }
  }
};

flujos.registro = async (browser) => {
  const F = 'Registro en dos pasos';
  const d = datosCuenta('reg');
  const { ctx, page } = await nuevaPagina(browser);
  try {
    await paso(F, 'paso-1-formulario-de-la-cuenta', page, async () => {
      await page.goto(`${BASE_URL}/registro`);
      await page.getByLabel(/^Tu nombre/).fill(d.persona);
      await page.getByLabel(/^Correo electrónico/).fill(d.email);
      await page.getByLabel(/^Celular/).fill(CELULAR);
      await page.getByLabel(/^Contraseña/).fill(CLAVE);
      await page.getByLabel(/Acepto los/).check();
      await page.getByRole('button', { name: 'Crear cuenta gratis' }).waitFor();
      return 'sólo nombre, correo, celular y contraseña';
    });

    await paso(F, 'paso-1-envia-y-pide-revisar-el-correo', page, async () => {
      const [resp] = await Promise.all([
        respuestaDe(page, 'POST', '/api/publico/registro'),
        page.getByRole('button', { name: 'Crear cuenta gratis' }).click(),
      ]);
      if (resp.status() !== 202) throw new Error(`registro respondió ${resp.status()}${resp.status() === 429 ? AVISO_LIMITE : ''}`);
      await page.getByRole('heading', { name: 'Revisa tu correo' }).waitFor();
      await page.getByText(/Paso 1 de 2 listo/).waitFor();
      return '202 · «Revisa tu correo»';
    });

    await paso(F, 'correo-repetido-misma-respuesta-sin-cuenta-nueva', page, async () => {
      await page.goto(`${BASE_URL}/registro`);
      await page.getByLabel(/^Tu nombre/).fill(d.persona);
      await page.getByLabel(/^Correo electrónico/).fill(d.email);
      await page.getByLabel(/^Celular/).fill(CELULAR);
      await page.getByLabel(/^Contraseña/).fill(CLAVE);
      await page.getByLabel(/Acepto los/).check();
      const [resp] = await Promise.all([
        respuestaDe(page, 'POST', '/api/publico/registro'),
        page.getByRole('button', { name: 'Crear cuenta gratis' }).click(),
      ]);
      if (resp.status() !== 202) throw new Error(`registro repetido respondió ${resp.status()} (se esperaba 202, igual que el primero)`);
      await page.getByRole('heading', { name: 'Revisa tu correo' }).waitFor();
      const cuentas = sql(`select count(*) from "Usuario" where email='${d.email}'`);
      if (cuentas !== '1') throw new Error(`hay ${cuentas} cuentas con el mismo correo`);
      return '202 igual · 1 sola cuenta';
    });

    await paso(F, 'login-antes-de-confirmar-no-entra', page, async () => {
      await page.goto(`${BASE_URL}/login`);
      await llenarLogin(page, d.email, CLAVE);
      await page.getByText(/Confirma tu correo para entrar/).waitFor();
      return 'mensaje de correo sin confirmar';
    });

    await paso(F, 'confirma-el-correo-con-el-enlace', page, async () => {
      const token = fabricarTokenVerificacion(d.email);
      await page.goto(`${BASE_URL}/verificar-correo?token=${encodeURIComponent(token)}`);
      await page.getByRole('heading', { name: '¡Correo confirmado!' }).waitFor();
      return 'enlace de un solo uso aceptado';
    });

    await paso(F, 'entra-y-cae-en-el-paso-2', page, async () => {
      await page.goto(`${BASE_URL}/login`);
      await llenarLogin(page, d.email, CLAVE);
      await page.waitForURL(/\/admin\/bienvenida/, { timeout: 15000 });
      // Aunque pida otra pantalla, la administradora sin condominio cae en la bienvenida.
      await page.goto(`${BASE_URL}/admin/recibos`);
      await page.waitForURL(/\/admin\/bienvenida/, { timeout: 15000 });
      await page.getByRole('heading', { name: 'Te damos la bienvenida a Torre' }).waitFor();
      return `/admin/recibos redirige a la bienvenida · ${await sinDesborde(page)}`;
    });

    await paso(F, 'paso-2-crea-el-condominio-y-llega-al-resumen', page, async () => {
      await page.getByLabel(/^Nombre de tu administradora/).fill(d.empresa);
      await page.getByLabel(/^Nombre del condominio/).fill(d.condominio);
      await page.getByLabel(/^N\.º de departamentos/).fill('120');
      const [resp] = await Promise.all([
        respuestaDe(page, 'POST', '/api/comercial/primer-condominio'),
        page.getByRole('button', { name: 'Crear mi condominio' }).click(),
      ]);
      if (resp.status() !== 201) throw new Error(`crear el condominio respondió ${resp.status()}`);
      await page.waitForURL(/\/admin\/dashboard/, { timeout: 15000 });
      await page.getByRole('heading', { name: `¡Listo! Creamos ${d.condominio}` }).waitFor();
      return `201 · tarjeta «¡Listo!» en el Resumen · ${await sinDesborde(page)}`;
    });

    await paso(F, 'paso-2-no-se-repite', page, async () => {
      await page.goto(`${BASE_URL}/admin/bienvenida`);
      await page.waitForURL((u) => !u.pathname.endsWith('/admin/bienvenida'), { timeout: 15000 });
      // La pantalla ya no ofrece el formulario: se intenta de nuevo a mano, con sesión y su token CSRF (como lo mandaría la app).
      const sesion = await page.request.post(`${BASE_URL}/api/auth/login`, { data: { email: d.email, password: CLAVE } });
      const { csrf } = await sesion.json();
      const r = await page.request.post(`${BASE_URL}/api/comercial/primer-condominio`, {
        headers: { 'X-CSRF-Token': csrf, Origin: BASE_URL },
        data: { empresa: d.empresa, condominio: `${d.condominio} bis`, unidades: 50 },
      });
      if (r.status() !== 409) throw new Error(`un segundo primer condominio respondió ${r.status()} (se esperaba 409)`);
      return 'recargar → Resumen · envío repetido 409';
    });
  } finally {
    await ctx.close();
  }
};

flujos.plan = async (browser) => {
  const F = 'Plan: prueba de Pro, solicitud y pago';
  const admin = await nuevaPagina(browser);
  const sa = await nuevaPagina(browser);
  try {
    let d;
    await paso(F, 'prepara-la-cuenta-nueva', admin.page, async () => {
      d = await cuentaNueva(admin.page, 'plan');
      return `condominio «${d.condominio}»`;
    });
    if (!d) throw new Error('sin cuenta: el resto del flujo no puede correr');

    await paso(F, 'mi-plan-muestra-el-plazo-gratis-y-la-prueba', admin.page, async () => {
      await admin.page.goto(`${BASE_URL}/admin/mi-plan`);
      await admin.page.getByText(/Te quedan \d+ días? gratis/).first().waitFor();
      await admin.page.getByText(/Prueba de Torre Pro/).first().waitFor();
      await admin.page.getByText(/queda en solo lectura/).first().waitFor();
      const dias = Number(sql(`select (s.gratis_hasta::date - (now() at time zone 'America/Lima')::date) from "SuscripcionCondominio" s join "ComplejoHabitacional" c on c.id=s.complejo_id where c.nombre='${d.condominio}'`));
      const config = Number(sql(`select dias_gratis from "ConfiguracionComercial" limit 1`));
      if (Math.abs(dias - config) > 1) throw new Error(`el plazo gratis es de ${dias} días; la configuración dice ${config}`);
      return `plazo gratis ${dias} días (configuración: ${config}) · ${await sinDesborde(admin.page)}`;
    });

    await paso(F, 'pasar-a-pro-deja-la-solicitud', admin.page, async () => {
      await admin.page.getByRole('button', { name: /Cambiar de plan|Elegir un plan/ }).first().click();
      const dialogo = admin.page.getByRole('dialog');
      await dialogo.getByText(/Elige el plan/).waitFor();
      await dialogo.locator('label').filter({ has: admin.page.getByText('Torre Pro', { exact: true }) }).click();
      const [resp] = await Promise.all([
        respuestaDe(admin.page, 'POST', '/solicitud'),
        dialogo.getByRole('button', { name: 'Enviar solicitud' }).click(),
      ]);
      if (!resp.ok()) throw new Error(`enviar la solicitud respondió ${resp.status()}`);
      await admin.page.getByText('Pediste el plan Torre Pro').waitFor();
      return `solicitud registrada (${resp.status()})`;
    });

    await paso(F, 'superadmin-ve-la-solicitud-y-registra-el-pago', sa.page, async () => {
      await ingresarComo(sa.page, SUPER.email, SUPER.clave);
      await sa.page.goto(`${BASE_URL}/superadmin/suscripciones`);
      await sa.page.getByPlaceholder('Buscar condominio o empresa…').fill(d.condominio);
      await sa.page.getByRole('button', { name: `Registrar pago de ${d.condominio}` }).click();
      const dialogo = sa.page.getByRole('dialog');
      await dialogo.getByText(`Registrar pago · ${d.condominio}`).waitFor();
      const [resp] = await Promise.all([
        respuestaDe(sa.page, 'POST', '/pagos'),
        dialogo.getByRole('button', { name: 'Registrar pago', exact: true }).click(),
      ]);
      if (!resp.ok()) throw new Error(`registrar el pago respondió ${resp.status()}`);
      await sa.page.getByText('Pago registrado: la vigencia se extendió').waitFor();
      return `pago registrado (${resp.status()})`;
    });

    await paso(F, 'administradora-ve-pro-activo', admin.page, async () => {
      await admin.page.goto(`${BASE_URL}/admin/mi-plan`);
      await admin.page.locator('dd', { hasText: 'Torre Pro' }).first().waitFor();
      const pendiente = await admin.page.getByText('Pediste el plan Torre Pro').count();
      if (pendiente) throw new Error('la solicitud sigue apareciendo después del pago');
      return `Plan: Torre Pro · sin solicitud pendiente · ${await sinDesborde(admin.page)}`;
    });
  } finally {
    await admin.ctx.close();
    await sa.ctx.close();
  }
};

flujos['solo-lectura'] = async (browser) => {
  const F = 'Plazo vencido: solo lectura';
  const { ctx, page } = await nuevaPagina(browser);
  try {
    let d;
    await paso(F, 'prepara-la-cuenta-nueva', page, async () => {
      d = await cuentaNueva(page, 'solo');
      return `condominio «${d.condominio}»`;
    });
    if (!d) throw new Error('sin cuenta: el resto del flujo no puede correr');

    // La pantalla de comunicados se abre ANTES de vencer el plazo: así el formulario llega con los botones activos, como en una sesión que ya estaba abierta.
    await paso(F, 'abre-el-formulario-antes-de-que-venza', page, async () => {
      await page.goto(`${BASE_URL}/admin/comunicados`);
      await page.getByRole('button', { name: 'Nuevo comunicado' }).first().click();
      await page.getByRole('dialog').getByText('Nuevo comunicado').waitFor();
      return 'formulario abierto con los botones activos';
    });

    await paso(F, 'vence-el-plazo-gratis-y-la-prueba', page, async () => {
      sql(`update "SuscripcionCondominio" set es_prueba=true, plan_clave='pro', vigente_hasta=${diaLima(-1)}, gratis_hasta=${diaLima(-1)}
           where complejo_id=(select id from "ComplejoHabitacional" where nombre='${d.condominio}')`);
      await esperarCacheDelBackend();
      return 'vigente_hasta y gratis_hasta = ayer (Lima): Gratis vencido · espera 31 s a que venza la caché del backend';
    });

    await paso(F, 'publicar-recibe-solo-lectura-409', page, async () => {
      const dialogo = page.getByRole('dialog');
      // El selector de condominio sólo aparece con más de uno; con uno solo el comunicado va a ese.
      if (await dialogo.getByLabel('Condominio').count()) {
        const opcion = await dialogo.getByLabel('Condominio').locator('option').filter({ hasText: d.condominio }).first().getAttribute('value');
        await dialogo.getByLabel('Condominio').selectOption(opcion);
      }
      await dialogo.getByLabel(/^Título/).fill(`Aviso de prueba ${CORRIDA}`);
      await dialogo.getByLabel(/^Mensaje/).fill('Texto de prueba del flujo de solo lectura.');
      const [resp] = await Promise.all([
        respuestaDe(page, 'POST', '/api/comunicados'),
        dialogo.getByRole('button', { name: 'Publicar' }).click(),
      ]);
      if (resp.status() !== 409) throw new Error(`publicar respondió ${resp.status()} (se esperaba 409 SOLO_LECTURA)`);
      // El error del formulario sale como aviso (toast), no dentro del diálogo.
      await page.locator('[role=status], [role=alert]').filter({ hasText: /solo lectura/i }).first().waitFor();
      return '409 · aviso de solo lectura en pantalla';
    });

    await paso(F, 'al-recargar-aviso-y-botones-bloqueados', page, async () => {
      await page.goto(`${BASE_URL}/admin/comunicados`);
      await page.getByText(/Este condominio está en solo lectura desde el/).first().waitFor();
      const boton = page.getByRole('button', { name: 'Nuevo comunicado' }).first();
      await boton.waitFor();
      if (await boton.isEnabled()) throw new Error('«Nuevo comunicado» sigue activo en solo lectura');
      await page.locator('[data-banda="solo-lectura"]').waitFor();
      return `aviso y «Nuevo comunicado» desactivado · ${await sinDesborde(page)}`;
    });

    await paso(F, 'puede-seguir-mirando', page, async () => {
      await page.goto(`${BASE_URL}/admin/recibos`);
      await page.getByRole('heading', { name: 'Recibos' }).first().waitFor();
      return 'Recibos se ve';
    });
  } finally {
    await ctx.close();
  }
};

flujos['un-condominio'] = async (browser) => {
  const F = 'Un condominio en Torre Gratis';
  const { ctx, page } = await nuevaPagina(browser);
  try {
    let d;
    await paso(F, 'prepara-la-cuenta-nueva', page, async () => {
      d = await cuentaNueva(page, 'uno');
      return `condominio «${d.condominio}»`;
    });
    if (!d) throw new Error('sin cuenta: el resto del flujo no puede correr');

    await paso(F, 'la-prueba-vence-y-queda-en-gratis', page, async () => {
      // La prueba de Pro se vence y la cuenta sigue en Torre Gratis dentro de su plazo (no solo lectura): es la cuenta que no puede abrir otro condominio.
      sql(`update "SuscripcionCondominio" set es_prueba=true, plan_clave='pro', vigente_hasta=${diaLima(-1)}
           where complejo_id=(select id from "ComplejoHabitacional" where nombre='${d.condominio}')`);
      return 'prueba vencida; Gratis dentro del plazo';
    });

    await paso(F, 'nuevo-condominio-explica-por-que-no', page, async () => {
      await page.goto(`${BASE_URL}/admin/complejos`);
      const r = await page.request.get(`${BASE_URL}/api/comercial/puede-agregar-condominio`);
      const cuerpo = await r.json();
      if (cuerpo.puede !== false) throw new Error(`la API dice que sí puede agregar otro condominio`);
      await page.getByRole('button', { name: 'Nuevo condominio' }).first().click();
      await page.getByText(/Torre Gratis incluye un condominio/).first().waitFor();
      if (await page.getByLabel(/^Nombre del condominio/).count()) throw new Error('se abrió el formulario de un segundo condominio');
      return 'API: puede=false · motivo en pantalla, sin formulario';
    });
  } finally {
    await ctx.close();
  }
};

flujos.superadmin = async (browser) => {
  const F = 'Superadministración';
  const admin = await nuevaPagina(browser);
  const sa = await nuevaPagina(browser);
  try {
    let d;
    await paso(F, 'prepara-una-empresa-con-condominio', admin.page, async () => {
      d = await cuentaNueva(admin.page, 'sa');
      return `empresa «${d.empresa}»`;
    });
    if (!d) throw new Error('sin cuenta: el resto del flujo no puede correr');

    await paso(F, 'resumen-de-la-plataforma', sa.page, async () => {
      await ingresarComo(sa.page, SUPER.email, SUPER.clave);
      await sa.page.goto(`${BASE_URL}/superadmin/dashboard`);
      await sa.page.getByRole('heading', { name: 'Resumen de la plataforma' }).waitFor();
      return `${await sinDesborde(sa.page)}`;
    });

    await paso(F, 'empresa-de-la-cuenta-nueva-con-su-condominio', sa.page, async () => {
      await sa.page.goto(`${BASE_URL}/superadmin/empresas`);
      await sa.page.getByPlaceholder('Buscar por nombre o RUC').fill(d.empresa);
      await sa.page.getByText(d.empresa, { exact: true }).first().click();
      await sa.page.waitForURL(/\/superadmin\/empresas\/\d+/);
      await sa.page.getByRole('heading', { name: d.empresa }).waitFor();
      await sa.page.getByRole('tab', { name: 'Condominios' }).click();
      await sa.page.getByText(d.condominio, { exact: true }).first().waitFor();
      return `condominio «${d.condominio}» en la empresa`;
    });

    await paso(F, 'usuarios', sa.page, async () => {
      await sa.page.goto(`${BASE_URL}/superadmin/usuarios`);
      await sa.page.getByRole('heading', { name: 'Usuarios' }).first().waitFor();
      return `${await sinDesborde(sa.page)}`;
    });

    await paso(F, 'auditoria-registra-la-cuenta', sa.page, async () => {
      await sa.page.goto(`${BASE_URL}/superadmin/auditoria`);
      await sa.page.getByRole('heading', { name: 'Auditoría' }).first().waitFor();
      await sa.page.getByText(d.persona, { exact: true }).first().waitFor({ timeout: 15000 });
      return `aparece «${d.persona}»`;
    });

    await paso(F, 'registro-publico-abierto', sa.page, async () => {
      await sa.page.goto(`${BASE_URL}/superadmin/suscripciones`);
      await sa.page.getByRole('tab', { name: 'Precios y pagos' }).click();
      const casilla = sa.page.getByLabel('Registro público abierto');
      await casilla.waitFor();
      if (!(await casilla.isChecked())) throw new Error('el registro público figura cerrado');
      return 'registro público abierto (sin cambiar nada)';
    });
  } finally {
    await admin.ctx.close();
    await sa.ctx.close();
  }
};

// ---------------------------------------------------------------- Corrida
const browser = await chromium.launch();
try {
  for (const flujo of pedidos) {
    console.log(`\n${flujo}`);
    try {
      await flujos[flujo](browser);
    } catch (e) {
      const mensaje = String(e.message || e).split('\n')[0].slice(0, 300);
      resultados.push({ flujo, paso: '(flujo interrumpido)', ok: false, nota: mensaje, foto: null, ms: 0, errores: [] });
      console.log(`  FALLA flujo interrumpido — ${mensaje}`);
    }
  }
} finally {
  await browser.close();
}

// Cada invocación se agrega al historial de comercial.json (una corrida = una invocación; con el límite de registros se hace en tandas).
const ok = resultados.filter((r) => r.ok).length;
const total = resultados.length;
const ruta = join(RESULTADOS, 'comercial.json');
let corridas = [];
try { corridas = JSON.parse(readFileSync(ruta, 'utf8')).corridas ?? []; } catch { /* primera vez */ }
corridas.push({ corrida: CORRIDA, fecha: new Date().toISOString(), base: BASE_URL, base_datos: E2E_DB, flujos: pedidos, ok, total, pasos: resultados });
writeFileSync(ruta, JSON.stringify({ corridas }, null, 2));
console.log(`\nok ${ok}/${total}`);
const fallas = resultados.filter((r) => !r.ok);
for (const f of fallas) console.log(`  FALLA [${f.flujo}] ${f.paso}: ${f.nota}`);
process.exit(fallas.length ? 1 : 0);
