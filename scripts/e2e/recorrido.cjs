// Recorrido E2E de House LOCAL, como lo haría cada persona: la administradora sube el Excel del mes y carga el agua, el vecino paga con su
// voucher desde el celular, la administradora o la junta validan o rechazan, un pago en efectivo, y el personal. Usa las cuentas de
// `.claude/cuentas-prueba-local.md` (npx tsx .claude/cuentas-prueba-local.ts) sobre la copia local de producción.
// ANTES: backend SIN envíos reales (la base local tiene vecinos reales):
//   RESEND_API_KEY= MAIL_FROM= EVOLUTION_URL= EVOLUTION_APIKEY= AVISOS_PLANIFICADOR=off npm run backend   y   npm run dev
// Para repetir desde cero, respalda la base antes (pg_dump) y restáurala después: el recorrido crea el recibo de noviembre y pagos.
// Uso: PLAYWRIGHT=<ruta a node_modules/playwright> node scripts/e2e/recorrido.cjs [emitir,pagar,validar,rechazo,efectivo,personal]
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL || 'http://localhost:5173';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('El recorrido sólo corre contra localhost: crea recibos y pagos.');
const OUT = path.join(__dirname, 'capturas');
fs.mkdirSync(OUT, { recursive: true });
const md = fs.readFileSync(path.join(__dirname, '../../.claude/cuentas-prueba-local.md'), 'utf8');
const clave = (email) => (md.split('\n').find((l) => l.includes(email)) || '').match(/`([^`]+)`/)?.[1];
const EXCEL = path.join(__dirname, 'block-1-noviembre.xlsx');

const CUENTAS = {
  admin: 'admin.vrany@house.test',
  propietario: 'b1-804@sin-correo.invalid',
  junta: 'b1-403@sin-correo.invalid',
  inquilino: 'inquilino.prueba@house.test',
  mantenimiento: 'mantenimiento.prueba@house.test',
  seguridad: 'seguridad.prueba@house.test',
  superadmin: 'superadmin.prueba@house.test',
};

const resultados = [];
let n = 0;
const estados = {};

async function sesion(browser, rol, movil = false) {
  const opts = movil ? { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } : { viewport: { width: 1366, height: 900 } };
  const ctx = await browser.newContext({ ...opts, storageState: estados[rol], locale: 'es-PE' });
  const page = await ctx.newPage();
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push('pageerror: ' + String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errores.push(m.text().slice(0, 160)); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) page.errores.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
  if (!estados[rol]) {
    await page.goto(BASE + '/login');
    await page.getByLabel(/correo/i).fill(CUENTAS[rol]);
    await page.getByLabel(/contraseña/i).first().fill(clave(CUENTAS[rol]));
    await page.getByRole('button', { name: /ingresar|entrar|iniciar/i }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
    estados[rol] = await ctx.storageState();
  }
  return { ctx, page };
}

async function foto(page, nombre) {
  n += 1;
  const f = `${String(n).padStart(2, '0')}-${nombre}.png`;
  await page.screenshot({ path: path.join(OUT, f), fullPage: true }).catch(() => {});
  return f;
}

async function paso(flujo, nombre, page, fn) {
  const t0 = Date.now();
  try {
    const nota = await fn();
    const f = await foto(page, nombre);
    resultados.push({ flujo, paso: nombre, ok: true, nota: nota || '', foto: f, ms: Date.now() - t0, errores: [...page.errores] });
    console.log(`  ok    ${nombre}${nota ? ' — ' + nota : ''}${page.errores.length ? '  [consola: ' + page.errores.join(' | ') + ']' : ''}`);
  } catch (e) {
    const f = await foto(page, nombre + '-FALLA');
    resultados.push({ flujo, paso: nombre, ok: false, nota: String(e.message || e).split('\n')[0].slice(0, 300), foto: f, ms: Date.now() - t0, errores: [...page.errores] });
    console.log(`  FALLA ${nombre} — ${String(e.message || e).split('\n')[0].slice(0, 300)}`);
  }
  page.errores.length = 0;
}

const toast = (page, re = /\S/) => page.locator('[role=status], [role=alert]').filter({ hasText: re }).last();

/** Voucher de prueba: una constancia de transferencia genérica dibujada en HTML y fotografiada. */
async function voucher(browser, { monto, operacion, nombre }) {
  const p = await browser.newPage({ viewport: { width: 420, height: 640 } });
  await p.setContent(`<html><body style="font-family:Arial;background:#f3f4f6;margin:0;padding:24px">
  <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 4px #0002">
   <div style="color:#0b4ea2;font-weight:bold;font-size:20px">Banco de Prueba</div>
   <div style="color:#16a34a;font-size:18px;margin:16px 0">✔ Transferencia exitosa</div>
   <div style="font-size:30px;font-weight:bold">S/ ${monto}</div>
   <table style="margin-top:18px;font-size:14px;width:100%">
    <tr><td style="color:#666">Fecha</td><td>${new Date().toLocaleDateString('es-PE')} 10:42</td></tr>
    <tr><td style="color:#666">N.º de operación</td><td>${operacion}</td></tr>
    <tr><td style="color:#666">Desde</td><td>${nombre}</td></tr>
    <tr><td style="color:#666">Para</td><td>JUNTA DIRECTIVA BLOCK 1</td></tr>
    <tr><td style="color:#666">Cuenta destino</td><td>***-***-**7392</td></tr>
    <tr><td style="color:#666">Concepto</td><td>Mantenimiento noviembre</td></tr>
   </table></div></body></html>`);
  const f = path.join(OUT, `voucher-${operacion}.png`);
  await p.screenshot({ path: f });
  await p.close();
  return f;
}

// ---------------------------------------------------------------- Flujos
const FLUJOS = {};

FLUJOS.emitir = async (browser) => {
  const F = 'Administradora emite el recibo de noviembre';
  const { ctx, page } = await sesion(browser, 'admin');
  await paso(F, 'admin-recibos', page, async () => { await page.goto(BASE + '/admin/recibos'); await page.getByRole('heading', { name: 'Recibos' }).waitFor(); });
  await paso(F, 'admin-subir-excel', page, async () => {
    await page.getByRole('button', { name: 'Subir Excel' }).first().click();
    const d = page.getByRole('dialog');
    await d.locator('select').first().selectOption({ label: await d.locator('select option').nth(1).textContent() });
    await d.locator('input[type=file]').setInputFiles(EXCEL);
    await d.getByRole('button', { name: /Subir Excel y crear recibos/ }).click();
    await d.getByText(/departamentos/).first().waitFor({ timeout: 30000 });
    const texto = (await d.innerText()).replace(/\s+/g, ' ');
    return texto.slice(texto.indexOf('Recibos por torre') > 0 ? texto.indexOf('Recibos por torre') : 0).slice(0, 220);
  });
  await paso(F, 'admin-abrir-recibo-noviembre', page, async () => {
    await page.keyboard.press('Escape');
    await page.goto(BASE + '/admin/recibos');
    await page.getByRole('link', { name: /Noviembre (de )?2026/i }).first().click();
    await page.getByText('Emitido').first().waitFor();
    await page.waitForTimeout(800);
    const emitido = await page.locator('dd, [class*=num]').first().innerText().catch(() => '');
    estados.reciboNoviembre = page.url().split('/').pop();
    return `recibo ${estados.reciboNoviembre} · ${emitido}`;
  });
  await paso(F, 'admin-agua-y-datos', page, async () => {
    await page.getByRole('tab', { name: /Agua y datos/ }).click();
    await page.getByLabel('Fecha de corte del agua').fill('2026-12-10');
    await page.getByLabel('Fecha de corte del agua').locator('xpath=ancestor::div[1]/following-sibling::button | ancestor::div[2]//button[normalize-space()="Guardar"]').first().click();
    await toast(page).waitFor({ timeout: 8000 });
    const t1 = await toast(page).innerText();
    await page.getByLabel('Lectura actual de B01-804').fill('1445.210');
    await page.getByLabel('Fecha actual de B01-804').fill('2026-11-10');
    await page.getByRole('button', { name: /Guardar lecturas/ }).click();
    await page.waitForTimeout(1500);
    const fila = await page.getByLabel('Lectura actual de B01-804').locator('xpath=ancestor::tr').innerText();
    return `corte: «${t1}» · 804: ${fila.replace(/\s+/g, ' ').slice(0, 160)}`;
  });
  await paso(F, 'admin-recibo-impreso-804', page, async () => {
    await page.getByRole('tab', { name: 'Departamentos' }).click();
    await page.getByLabel('Buscar departamento').fill('B01-804');
    await page.waitForTimeout(800);
    await page.getByText('B01-804').first().click();
    const d = page.getByRole('dialog');
    await d.waitFor();
    const b = d.getByRole('button', { name: /recibo|imprimir/i }).first();
    const nombre = await b.innerText();
    await b.click();
    await page.waitForTimeout(1500);
    const impreso = await page.getByRole('dialog').last().innerText();
    return `botón «${nombre}» · ${/NOVIEMBRE|Noviembre/.test(impreso) ? 'dice noviembre' : 'NO dice noviembre'} · ${/1445|1,445/.test(impreso) ? 'trae la lectura' : 'sin la lectura nueva'} · ${/10\/12\/2026|10 de diciembre|10-dic/i.test(impreso) ? 'trae el corte' : 'sin la fecha de corte'}`;
  });
  await ctx.close();
};

FLUJOS.pagar = async (browser) => {
  const F = 'Propietario (B01-804) paga noviembre con su voucher, en el celular';
  const { ctx, page } = await sesion(browser, 'propietario', true);
  let monto = '';
  await paso(F, 'propietario-inicio', page, async () => { await page.goto(BASE + '/propietario/inicio'); await page.waitForLoadState('networkidle'); return (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 200); });
  await paso(F, 'propietario-cargos', page, async () => {
    await page.goto(BASE + '/propietario/cargos');
    await page.getByText(/Noviembre (de )?2026/i).first().waitFor({ timeout: 10000 });
  });
  await paso(F, 'propietario-como-pagar', page, async () => {
    const tarjeta = page.locator('div.p-4').filter({ hasText: /Noviembre (de )?2026/i }).first();
    await tarjeta.getByRole('button', { name: /Pagar mantenimiento/ }).click();
    const d = page.getByRole('dialog');
    await d.getByText(/Cómo pagar/).first().waitFor();
    await page.waitForTimeout(1000);
    const t = (await d.innerText()).replace(/\s+/g, ' ');
    return t.slice(0, 260);
  });
  await paso(F, 'propietario-registrar-voucher', page, async () => {
    const d = page.getByRole('dialog');
    await d.getByRole('button', { name: /Ya pagué/ }).click();
    await d.getByText('Monto a pagar').waitFor();
    await page.waitForTimeout(800);
    monto = (await d.locator('p.num').first().innerText()).replace(/[^\d.,]/g, '');
    const archivo = await voucher(browser, { monto, operacion: '04512873', nombre: 'MIGUEL FERNANDEZ G.' });
    await d.getByLabel('¿Cómo pagaste?').selectOption('transferencia');
    await d.getByLabel(/Referencia/).fill('04512873');
    await d.getByLabel(/Adjuntar comprobante/).setInputFiles(archivo);
    return `monto ${monto}`;
  });
  await paso(F, 'propietario-pago-enviado', page, async () => {
    const d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'Confirmar pago' }).click();
    await d.getByText(/quedó registrado/).waitFor({ timeout: 15000 });
    await page.waitForTimeout(12000); // deja correr la revisión automática del voucher
    return (await d.innerText()).replace(/\s+/g, ' ').slice(0, 260);
  });
  await paso(F, 'propietario-mis-pagos', page, async () => {
    await page.keyboard.press('Escape');
    await page.goto(BASE + '/propietario/pagos');
    await page.waitForLoadState('networkidle');
    return (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 220);
  });
  await ctx.close();
};

FLUJOS.validar = async (browser) => {
  const F = 'Administradora valida el voucher de B01-804';
  const { ctx, page } = await sesion(browser, 'admin');
  await paso(F, 'admin-pagos-por-validar', page, async () => {
    await page.goto(BASE + '/admin/pagos');
    await page.getByText('B01-804').first().waitFor({ timeout: 10000 });
    return (await page.locator('tr').filter({ hasText: 'B01-804' }).first().innerText()).replace(/\s+/g, ' ');
  });
  await paso(F, 'admin-revisar-voucher', page, async () => {
    await page.locator('tr').filter({ hasText: 'B01-804' }).first().getByRole('button', { name: 'Revisar' }).click();
    const d = page.getByRole('dialog');
    await d.waitFor();
    await page.waitForTimeout(1500);
    return (await d.innerText()).replace(/\s+/g, ' ').slice(0, 400);
  });
  await paso(F, 'admin-validar', page, async () => {
    await page.getByRole('dialog').getByRole('button', { name: 'Validar pago' }).click();
    await toast(page, /validad|pagado/i).waitFor({ timeout: 8000 });
    return await toast(page, /validad|pagado/i).innerText();
  });
  await ctx.close();
  const p2 = await sesion(browser, 'propietario', true);
  await paso(F, 'propietario-ve-pagado', p2.page, async () => {
    await p2.page.goto(BASE + '/propietario/cargos');
    await p2.page.getByRole('tab', { name: 'Pagados' }).click();
    const tarjeta = p2.page.locator('div.p-4').filter({ hasText: /Noviembre (de )?2026/i }).first();
    await tarjeta.waitFor();
    return (await tarjeta.innerText()).replace(/\s+/g, ' ');
  });
  await p2.ctx.close();
};

FLUJOS.rechazo = async (browser) => {
  const F = 'Inquilino (B01-102) sube un voucher con monto equivocado; la junta lo rechaza; paga de nuevo';
  const { ctx, page } = await sesion(browser, 'inquilino', true);
  await paso(F, 'inquilino-paga-mal', page, async () => {
    await page.goto(BASE + '/inquilino/cargos');
    const tarjeta = page.locator('div.p-4').filter({ hasText: /Noviembre (de )?2026/i }).first();
    await tarjeta.getByRole('button', { name: /Pagar mantenimiento/ }).click();
    const d = page.getByRole('dialog');
    await d.getByRole('button', { name: /Ya pagué/ }).click();
    await d.getByText('Monto a pagar').waitFor();
    const archivo = await voucher(browser, { monto: '150.00', operacion: '77100221', nombre: 'INQUILINO DE PRUEBA' });
    await d.getByLabel('¿Cómo pagaste?').selectOption('yape');
    await d.getByLabel(/Adjuntar comprobante/).setInputFiles(archivo);
    await d.getByRole('button', { name: 'Confirmar pago' }).click();
    await d.getByText(/quedó registrado/).waitFor({ timeout: 15000 });
    await page.waitForTimeout(12000);
    return (await d.innerText()).replace(/\s+/g, ' ').slice(0, 240);
  });
  await ctx.close();
  const j = await sesion(browser, 'junta', true);
  await paso(F, 'junta-pagos', j.page, async () => {
    await j.page.goto(BASE + '/junta/pagos');
    await j.page.getByText('B01-102').first().waitFor({ timeout: 10000 });
  });
  await paso(F, 'junta-rechaza', j.page, async () => {
    const p = j.page;
    const fila = p.locator('tr, li, div.p-4').filter({ hasText: 'B01-102' }).first();
    await fila.getByRole('button', { name: 'Revisar' }).click().catch(async () => { await fila.click(); });
    const d = p.getByRole('dialog');
    await d.waitFor();
    await p.waitForTimeout(1500);
    const visto = (await d.innerText()).replace(/\s+/g, ' ').slice(0, 300);
    await d.getByRole('button', { name: 'Rechazar' }).click();
    await d.getByLabel('Motivo del rechazo').fill('El voucher es por S/ 150.00 y el mantenimiento de noviembre es mayor. Paga la diferencia o sube el voucher correcto.');
    await d.getByRole('button', { name: 'Confirmar rechazo' }).click();
    await toast(p, /rechaz/i).waitFor({ timeout: 8000 });
    return `${visto} → ${await toast(p, /rechaz/i).innerText()}`;
  });
  await j.ctx.close();
  const i2 = await sesion(browser, 'inquilino', true);
  await paso(F, 'inquilino-ve-rechazo', i2.page, async () => {
    await i2.page.goto(BASE + '/inquilino/cargos');
    const tarjeta = i2.page.locator('div.p-4').filter({ hasText: /Noviembre (de )?2026/i }).first();
    await tarjeta.getByText(/rechazado/i).first().waitFor({ timeout: 8000 });
    return (await tarjeta.innerText()).replace(/\s+/g, ' ');
  });
  await paso(F, 'inquilino-paga-de-nuevo', i2.page, async () => {
    const p = i2.page;
    const tarjeta = p.locator('div.p-4').filter({ hasText: /Noviembre (de )?2026/i }).first();
    await tarjeta.getByRole('button', { name: /Pagar de nuevo/ }).click();
    const d = p.getByRole('dialog');
    await d.getByRole('button', { name: /Ya pagué/ }).click();
    await d.getByText('Monto a pagar').waitFor();
    await p.waitForTimeout(800);
    const monto = (await d.locator('p.num').first().innerText()).replace(/[^\d.,]/g, '');
    const archivo = await voucher(browser, { monto, operacion: '77100388', nombre: 'INQUILINO DE PRUEBA' });
    await d.getByLabel(/Adjuntar comprobante/).setInputFiles(archivo);
    await d.getByRole('button', { name: 'Confirmar pago' }).click();
    await d.getByText(/quedó registrado/).waitFor({ timeout: 15000 });
    return `segundo voucher por S/ ${monto}`;
  });
  await i2.ctx.close();
};

FLUJOS.efectivo = async (browser) => {
  const F = 'Administradora registra a mano un pago en efectivo (B01-101, que arrastra deuda)';
  const { ctx, page } = await sesion(browser, 'admin');
  await paso(F, 'admin-registrar-pago', page, async () => {
    await page.goto(BASE + '/admin/pagos');
    await page.getByRole('button', { name: 'Registrar pago' }).first().click();
    const d = page.getByRole('dialog');
    await d.getByLabel('Periodo y torre').waitFor();
    const opciones = await d.getByLabel('Periodo y torre').locator('option').allInnerTexts();
    const nov = opciones.find((o) => /noviembre/i.test(o));
    if (nov) await d.getByLabel('Periodo y torre').selectOption({ label: nov });
    await d.getByLabel('Código de departamento').fill('101');
    await page.waitForTimeout(1200);
    await d.getByText('B01-101').first().click();
    await page.waitForTimeout(800);
    return `periodos: ${opciones.join(' / ')} · ${(await d.innerText()).replace(/\s+/g, ' ').slice(0, 300)}`;
  });
  await paso(F, 'admin-confirma-efectivo', page, async () => {
    const d = page.getByRole('dialog');
    const metodo = d.getByLabel(/Método|Cómo/);
    if (await metodo.count()) await metodo.first().selectOption('efectivo').catch(() => {});
    await d.getByRole('button', { name: /Registrar|Guardar/ }).last().click();
    await toast(page).waitFor({ timeout: 8000 });
    return await toast(page).innerText();
  });
  await paso(F, 'admin-morosidad', page, async () => {
    await page.goto(BASE + '/admin/morosidad');
    await page.waitForLoadState('networkidle');
    return (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300);
  });
  await paso(F, 'admin-dashboard', page, async () => {
    await page.goto(BASE + '/admin/dashboard');
    await page.waitForLoadState('networkidle');
    return (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 300);
  });
  await ctx.close();
};

FLUJOS.personal = async (browser) => {
  const F = 'Personal: mantenimiento cierra su tarea y seguridad consulta un departamento';
  const m = await sesion(browser, 'mantenimiento', true);
  await paso(F, 'mantenimiento-tareas', m.page, async () => {
    await m.page.goto(BASE + '/mantenimiento/tareas');
    await m.page.waitForLoadState('networkidle');
    const b = m.page.getByRole('button', { name: /Completar|Terminar|Marcar|hecha|Iniciar/i }).first();
    const nombre = await b.innerText();
    await b.click();
    await m.page.waitForTimeout(800);
    const confirmar = m.page.getByRole('dialog').getByRole('button', { name: /Completar|Guardar|Confirmar|Marcar/i });
    if (await confirmar.count()) await confirmar.last().click();
    await toast(m.page).waitFor({ timeout: 8000 });
    return `«${nombre}» → ${await toast(m.page).innerText()}`;
  });
  await m.ctx.close();
  const s = await sesion(browser, 'seguridad', true);
  await paso(F, 'seguridad-busca-804', s.page, async () => {
    await s.page.goto(BASE + '/seguridad/unidades');
    await s.page.getByRole('searchbox').or(s.page.getByPlaceholder(/buscar/i)).first().fill('804');
    await s.page.waitForTimeout(1200);
    return (await s.page.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 240);
  });
  await s.ctx.close();
};

(async () => {
  const browser = await chromium.launch();
  const elegidos = process.argv[2] ? process.argv[2].split(',') : Object.keys(FLUJOS);
  for (const k of elegidos) {
    console.log(`\n== ${k}`);
    try { await FLUJOS[k](browser); } catch (e) { console.log(`  FALLA (flujo) ${String(e.message || e).split('\n')[0]}`); resultados.push({ flujo: k, paso: '(sesión)', ok: false, nota: String(e.message || e).split('\n')[0] }); }
  }
  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'resultado.json'), JSON.stringify(resultados, null, 1));
  const malos = resultados.filter((r) => !r.ok).length;
  console.log(`\n${resultados.length - malos} ok · ${malos} fallas`);
})();
