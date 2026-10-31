// Flujos de operación de House, de punta a punta, EN EL NAVEGADOR y como lo haría cada persona (clics y formularios reales).
// La API directa sólo sirve para leer la base de prueba (elegir unidades con cargo pendiente, leer el correo que el servidor
// guardó) y para fabricar el token de invitación (no hay correo: se guarda el hash sha256 y aquí se genera el token).
//
// Cubre (en orden por defecto): cobro · pago-voucher · validar · rechazo · efectivo · comunicado · invitacion · junta · personal · perfil
// Dependencias: `validar` busca el voucher que dejó `pago-voucher` (por la referencia E2E de la corrida o, si corre sola, el último
// voucher E2E por validar). La regla «IA + tesorero» exige la conformidad de la tesorera del block antes de validar: `validar` la
// pide en /junta/pagos cuando el block tiene tesorero. Los demás flujos eligen su unidad con cargo pendiente, así que dos corridas
// seguidas no se pisan sin recopiar la base.
//
// Levantar el backend (base aislada, dist/ del checkout principal, sin correo ni WhatsApp):
//   bash ~/Projectos/house/scripts/e2e/levantar.sh 4102 house_e2e_operacion
// Correr (sin argumento = todos; o una lista separada por comas):
//   node scripts/e2e/flujos-operacion.mjs
//   node scripts/e2e/flujos-operacion.mjs cobro,pago-voucher,validar
// Salida: capturas en scripts/e2e/capturas/, resultado en scripts/e2e/resultados/operacion.json, código 1 si algún paso falla.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('/opt/homebrew/lib/node_modules/playwright');

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURAS = join(HERE, 'capturas');
const RESULTADOS = join(HERE, 'resultados');
const EXCEL_NOVIEMBRE = join(HERE, 'block-1-noviembre.xlsx');
mkdirSync(CAPTURAS, { recursive: true });
mkdirSync(RESULTADOS, { recursive: true });

const BASE = process.env.BASE_URL || 'http://localhost:4102';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('Este script sólo corre contra localhost: crea recibos, pagos y cuentas.');
const E2E_DB = process.env.E2E_DB || 'house_e2e_operacion';
if (!E2E_DB.startsWith('house_e2e')) throw new Error(`La base debe empezar con house_e2e (recibí «${E2E_DB}»).`);

// Cuentas de la semilla de Los Libertadores (contraseñas de PRUEBA, públicas en scripts/pruebas/recorrido-pantallas.mjs).
const CLAVE_PROPIETARIO = 'prop1234';
const CLAVE_INQUILINO = 'inq1234';
const CUENTA = {
  admin: { correo: 'ana.lopez@gestionurbana.com', clave: 'admin1234' },
  tesorera1: { correo: 'patricia.alarcon.9@prueba.house', clave: CLAVE_PROPIETARIO }, // tesorera del Block 1
  tesorero_central: { correo: 'gustavo.cruz.4@prueba.house', clave: CLAVE_PROPIETARIO },
  mantenimiento: { correo: 'maria.fernandez@gestionurbana.com', clave: 'mtto1234' },
  seguridad: { correo: 'pedro.sanchez@gestionurbana.com', clave: 'seg1234' },
  javier: { correo: 'javier.castro@prop.com', clave: CLAVE_PROPIETARIO }, // propietario de B03-502
};
const CONDOMINIO = /Los Libertadores/;
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];

const RUN = Date.now().toString(36); // identifica esta corrida: correos, referencias de voucher y títulos únicos
const resultados = [];
const sesiones = {}; // storageState por correo: se entra una vez por corrida
const usadas = new Set(); // códigos de unidad ya elegidos en esta corrida (no se reusan entre flujos)
const estado = {}; // datos que pasan de un flujo a otro dentro de la corrida
let capturas = 0;

// ---------------------------------------------------------------- Base (sólo lectura, salvo el token de invitación)
function sql(consulta) {
  const salida = execFileSync('docker', ['exec', 'house-pg', 'psql', '-U', 'postgres', '-d', E2E_DB, '-At', '-F', '\t', '-c', consulta], { encoding: 'utf8' });
  return salida.trim() === '' ? [] : salida.trim().split('\n').map((l) => l.split('\t'));
}

/** Elige una unidad del block con cargo pendiente, con residente que pueda entrar, sin junta y no usada en esta corrida. */
function elegirUnidad(bloque, { orden = "1", excluir = [] } = {}) {
  const fuera = [...usadas, ...excluir].map((c) => `'${c}'`).join(',') || "''";
  const [fila] = sql(`
    select u.codigo, coalesce(p.email,''), coalesce(i.email,''),
      coalesce((select string_agg(x.email, ',') from "MiembroJunta" m join "JuntaDirectiva" j on j.id = m.junta_id
                join "Usuario" x on x.id = m.usuario_id where j.estructura_id = u.estructura_id and m.cargo = 'tesorero'), ''),
      (select r.id from "ReciboConceptoUnidad" rcu join "ReciboConcepto" rc on rc.id = rcu.recibo_concepto_id
         join "Recibo" r on r.id = rc.recibo_id
        where rcu.unidad_id = u.id and rcu.estado_pago = 'pendiente' order by r.anio desc, r.mes desc limit 1)
    from "Unidad" u join "Estructura" e on e.id = u.estructura_id
    left join "Usuario" p on p.id = u.propietario_id
    left join "Usuario" i on i.id = u.inquilino_id
    where e.nombre = '${bloque}' and u.estado = 'activa'
      and not exists (select 1 from "MiembroJunta" m where m.usuario_id in (u.propietario_id, u.inquilino_id))
      and exists (select 1 from "ReciboConceptoUnidad" rcu where rcu.unidad_id = u.id and rcu.estado_pago = 'pendiente')
      and u.codigo not in (${fuera})
    order by ${orden}, u.codigo limit 1`);
  if (!fila) throw new Error(`No hay en ${bloque} una unidad con cargo pendiente sin usar en esta corrida: siembra más cargos.`);
  usadas.add(fila[0]);
  return { codigo: fila[0], bloque, propietario: fila[1], inquilino: fila[2], tesoreros: fila[3] ? fila[3].split(',') : [], reciboId: fila[4] };
}

/** Rol de la cuenta en la base: decide su contraseña de prueba y a qué Cargos entra. */
const rolDe = (correo) => sql(`select rol from "Usuario" where email = '${correo}'`)[0]?.[0] ?? 'propietario';
const claveDe = (correo) => (rolDe(correo) === 'inquilino' ? CLAVE_INQUILINO : CLAVE_PROPIETARIO);
const rutaCargos = (correo) => (rolDe(correo) === 'inquilino' ? '/inquilino/cargos' : '/propietario/cargos');
const rutaInicio = (correo) => (rolDe(correo) === 'inquilino' ? '/inquilino/inicio' : '/propietario/inicio');
/** Fila de tabla (o tarjeta) que contiene el código de la unidad. */
const filaCon = (page, codigo) => page.getByText(codigo, { exact: true }).first().locator('xpath=ancestor::*[self::tr or self::li or self::article][1]');
/** Fila del pago de la unidad en la lista de pagos: la lista va de a 20, así que pasa de página con «Página siguiente». */
async function filaDePago(page, codigo) {
  await page.waitForLoadState('networkidle').catch(() => {}); // la lista se vuelve a pedir al cargar: no clicar una fila que va a cambiar
  for (let pagina = 1; pagina <= 40; pagina++) {
    // En escritorio es una tabla (tr); en celular, tarjetas (li o article). Sólo lo visible: la tabla oculta también trae el código.
    const fila = page.locator('tr:visible, li:visible, article:visible').filter({ hasText: codigo }).first();
    if (await fila.waitFor({ state: 'attached', timeout: 5000 }).then(() => true, () => false)) return fila; // la lista carga sola
    const siguiente = page.getByRole('button', { name: 'Página siguiente' });
    if (!(await siguiente.count()) || (await siguiente.isDisabled())) break;
    await siguiente.click();
    await page.waitForLoadState('networkidle');
  }
  throw new Error(`No aparece ${codigo} en la lista de pagos (se revisaron las páginas con «Página siguiente»).`);
}

// ---------------------------------------------------------------- Navegador
async function sesion(browser, { correo, clave, movil = false }) {
  const modo = movil
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1366, height: 900 } };
  const ctx = await browser.newContext({ ...modo, locale: 'es-PE', storageState: sesiones[correo] });
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  page.errores = []; // errores de JS y 5xx del paso en curso
  page.consola = []; // errores de consola (sólo anotados)
  page.on('pageerror', (e) => page.errores.push('error de página: ' + String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.consola.push(m.text().slice(0, 160)); });
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) page.errores.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
  if (!sesiones[correo]) {
    await page.goto(BASE + '/login');
    await page.getByLabel('Correo electrónico').fill(correo);
    await page.getByLabel('Contraseña', { exact: true }).fill(clave);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
    sesiones[correo] = await ctx.storageState();
  }
  return { ctx, page };
}

/** Voucher de prueba: una constancia de transferencia dibujada en HTML y fotografiada (como `voucher()` de recorrido.cjs). */
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
    <tr><td style="color:#666">Para</td><td>JUNTA DIRECTIVA</td></tr>
    <tr><td style="color:#666">Cuenta destino</td><td>***-***-**7392</td></tr>
    <tr><td style="color:#666">Concepto</td><td>Mantenimiento</td></tr>
   </table></div></body></html>`);
  const ruta = join(CAPTURAS, `voucher-${operacion}.png`);
  await p.screenshot({ path: ruta });
  await p.close();
  return ruta;
}

const slug = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);

async function paso(flujo, nombre, page, fn) {
  const t0 = Date.now();
  page.errores.length = 0;
  page.consola.length = 0;
  let ok = true;
  let nota = '';
  try {
    nota = (await fn()) || '';
    const desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => 0);
    if (desborde > 0) { ok = false; nota = `desborde horizontal de ${desborde} px`; }
    if (page.errores.length) { ok = false; nota = `${nota ? nota + ' · ' : ''}${page.errores.join(' | ')}`; }
  } catch (e) {
    ok = false;
    nota = String(e.message || e).replace(/\s+/g, ' ').slice(0, 400);
  }
  capturas += 1;
  const foto = `${flujo}-${String(capturas).padStart(2, '0')}-${slug(nombre)}${ok ? '' : '-FALLA'}.png`;
  await page.screenshot({ path: join(CAPTURAS, foto), fullPage: true }).catch(() => {});
  resultados.push({ flujo, paso: nombre, ok, nota, foto, ms: Date.now() - t0, consola: [...page.consola] });
  console.log(`  ${ok ? 'ok   ' : 'FALLA'} ${nombre}${nota ? ' — ' + nota : ''}${page.consola.length ? '  [consola: ' + page.consola.join(' | ') + ']' : ''}`);
  return ok;
}

/** Un flujo que se interrumpe (login, dato que falta) queda como un paso fallido: los demás flujos siguen. */
function interrumpido(flujo, e) {
  const nota = String(e.message || e).replace(/\s+/g, ' ').slice(0, 400);
  resultados.push({ flujo, paso: '(flujo interrumpido)', ok: false, nota, foto: '', ms: 0, consola: [] });
  console.log(`  FALLA flujo interrumpido — ${nota}`);
}

const toast = (page, re) => page.locator('[role=status], [role=alert]').filter({ hasText: re }).last();

/** Elige en un <select> la primera opción cuyo texto cumple la expresión regular. */
async function elegirOpcion(select, re) {
  // Las opciones suelen llegar por la red: se espera a que aparezca la que se busca.
  for (let intento = 0; intento < 40; intento++) {
    const valor = await select.locator('option').evaluateAll((os, src) => os.find((o) => new RegExp(src, 'i').test(o.textContent))?.value ?? null, re.source);
    if (valor) return void (await select.selectOption(valor));
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No hay opción que coincida con ${re}`);
}

/** Entra al panel de Cargos o Mis recibos desde el menú, o por URL si el menú no lo muestra. */
async function irACargos(page, base) {
  const enlace = page.getByRole('link', { name: /^(Mis recibos|Mis cargos|Cargos)$/ }).first();
  if (await enlace.count()) await enlace.click();
  else await page.goto(BASE + base);
}

// ---------------------------------------------------------------- Flujos
const FLUJOS = {};

FLUJOS.cobro = async (browser) => {
  const F = 'cobro';
  const { ctx, page } = await sesion(browser, { correo: CUENTA.admin.correo, clave: CUENTA.admin.clave });
  try {
    await paso(F, 'recibos', page, async () => {
      await page.goto(BASE + '/admin/recibos');
      await page.getByRole('heading', { name: 'Recibos' }).waitFor();
    });
    await paso(F, 'abrir-recibo-del-mes', page, async () => {
      await page.getByRole('link', { name: /Octubre (de )?2026/i }).first().click();
      await page.waitForURL(/\/admin\/recibos\/\d+/);
      await page.getByText(/Emitido|Pagado|Pendiente|Vencido/).first().waitFor();
      return `recibo ${page.url().split('/').pop()}`;
    });
    await paso(F, 'imprimir-recibo', page, async () => {
      await page.getByRole('button', { name: /Imprimir/ }).first().click();
      const d = page.getByRole('dialog').last();
      await d.waitFor();
      await page.waitForTimeout(500);
      const texto = (await d.innerText()).replace(/\s+/g, ' ');
      await page.keyboard.press('Escape');
      return `impresión con ${texto.length} caracteres`;
    });
    await paso(F, 'emitir-noviembre-con-excel', page, async () => {
      await page.goto(BASE + '/admin/recibos');
      await page.getByRole('heading', { name: 'Recibos' }).waitFor();
      await page.waitForLoadState('networkidle'); // la lista llega por la red: no decidir antes de verla
      const yaEmitido = await page.getByRole('link', { name: /Noviembre (de )?2026/i }).first().waitFor({ timeout: 5000 }).then(() => true, () => false);
      if (yaEmitido) return 'ya estaba emitido (corrida anterior): no se vuelve a subir';
      await page.getByRole('button', { name: 'Subir Excel' }).first().click();
      const d = page.getByRole('dialog');
      await d.waitFor();
      await elegirOpcion(d.locator('select').first(), CONDOMINIO); // el Excel trae la columna BLOCK: cada block crea su recibo
      await d.locator('input[type=file]').setInputFiles(EXCEL_NOVIEMBRE);
      await d.getByRole('button', { name: /Subir Excel y crear recibos/ }).click();
      await d.getByText(/departamentos/).first().waitFor({ timeout: 30000 });
      await page.keyboard.press('Escape');
      return 'Excel de noviembre (Block 1) subido';
    });
  } catch (e) { interrumpido(F, e); }
  await ctx.close();
};

FLUJOS['pago-voucher'] = async (browser) => {
  const F = 'pago-voucher';
  const u = elegirUnidad('Block 3', { orden: `(p.email = '${CUENTA.javier.correo}') desc` });
  if (u.propietario !== CUENTA.javier.correo) console.log(`  (javier ya no tiene cargo pendiente: paga ${u.codigo} de ${u.propietario})`);
  const ref = `E2E-${RUN}-pagar`;
  const correo = u.propietario || u.inquilino;
  estado.refPagar = ref;
  estado.unidadPagar = u.codigo;
  estado.bloquePagar = u.bloque;
  const { ctx, page } = await sesion(browser, { correo, clave: claveDe(correo), movil: true }).catch((e) => { interrumpido(F, e); return {}; });
  if (!page) return;
  try {
    await paso(F, 'inicio-residente', page, async () => {
      await page.goto(BASE + rutaInicio(correo));
      await page.waitForLoadState('networkidle');
      return `${u.codigo} · ${correo}`;
    });
    await paso(F, 'cargos', page, async () => {
      await irACargos(page, rutaCargos(correo));
      await page.getByRole('button', { name: 'Pagar mantenimiento' }).first().waitFor({ timeout: 10000 });
    });
    let monto = '';
    let periodo = '';
    await paso(F, 'pagar-mantenimiento', page, async () => {
      await page.getByRole('button', { name: 'Pagar mantenimiento' }).first().click();
      const d = page.getByRole('dialog');
      await d.getByRole('heading', { name: 'Pagar mantenimiento' }).waitFor();
      await d.getByText('Monto a pagar').waitFor();
      await page.waitForTimeout(600);
      monto = (await d.locator('.num').first().innerText()).replace(/[^\d.,]/g, '');
      periodo = (await d.innerText()).replace(/\s+/g, ' ').match(/Mantenimiento de [a-záéíóúñ]+ de \d{4}/i)?.[0] ?? '';
      estado.periodoPagar = periodo;
      return `monto S/ ${monto} · ${periodo || 'periodo sin leer'}`;
    });
    await paso(F, 'subir-voucher-y-enviar', page, async () => {
      const d = page.getByRole('dialog');
      const archivo = await voucher(browser, { monto, operacion: ref.slice(-12), nombre: 'JAVIER CASTRO' });
      await d.getByLabel('Voucher (foto o PDF)').setInputFiles(archivo);
      await d.getByLabel('¿Cómo pagaste?').selectOption('transferencia');
      await d.getByLabel(/N\.º de operación/).fill(ref);
      await d.getByRole('button', { name: 'Enviar pago' }).click();
      await d.getByText(/quedó registrado/).waitFor({ timeout: 20000 });
      return `referencia ${ref}`;
    });
    await paso(F, 'cargos-en-revision', page, async () => {
      await cerrarDialogo(page);
      await page.goto(BASE + rutaCargos(correo));
      await page.waitForLoadState('networkidle');
      await page.getByText(/revisi[oó]n|por validar/i).first().waitFor({ timeout: 10000 });
      return 'el cargo figura en revisión';
    });
  } catch (e) { interrumpido(F, e); }
  await ctx.close();
};
/** Cierra el diálogo abierto, si lo hay. */
async function cerrarDialogo(page) { await page.keyboard.press('Escape').catch(() => {}); }

FLUJOS.validar = async (browser) => {
  const F = 'validar';
  const ref = estado.refPagar ?? null;
  const [pago] = sql(`select p.id, u.codigo, e.nombre, coalesce(pu.email,''), r.mes, r.anio
    from "Pago" p join "ReciboConceptoUnidad" rcu on rcu.id = p.recibo_concepto_unidad_id
    join "Unidad" u on u.id = rcu.unidad_id join "Estructura" e on e.id = u.estructura_id
    join "ReciboConcepto" rc on rc.id = rcu.recibo_concepto_id join "Recibo" r on r.id = rc.recibo_id
    left join "Usuario" pu on pu.id = p.usuario_id
    where p.estado_validacion = 'por_validar' and p.referencia ${ref ? `= '${ref}'` : "like 'E2E-%-pagar'"}
    order by p.id desc limit 1`);
  if (!pago) throw new Error('No hay voucher E2E por validar: corre antes `pago-voucher`.');
  const [, codigo, bloque, pagador, mes, anio] = pago;
  const tesoreros = sql(`select x.email from "MiembroJunta" m join "JuntaDirectiva" j on j.id = m.junta_id join "Estructura" e on e.id = j.estructura_id join "Usuario" x on x.id = m.usuario_id where e.nombre = '${bloque}' and m.cargo = 'tesorero'`).map((f) => f[0]);
  const nombreMes = MESES[Number(mes) - 1];
  estado.unidadValidar = codigo;

  // 1) La tesorera del block confirma que el dinero llegó (la administradora no valida sin ese check).
  if (tesoreros.length) {
    const correo = tesoreros[0];
    const { ctx, page } = await sesion(browser, { correo, clave: CLAVE_PROPIETARIO, movil: true }).catch((e) => { interrumpido(F, e); return {}; });
    if (page) {
      try {
        await paso(F, 'tesorero-confirma-llegada', page, async () => {
          await page.goto(BASE + '/junta/pagos');
          await (await filaDePago(page, codigo)).getByRole('button', { name: /Revisar/ }).click();
          const d = page.getByRole('dialog');
          await d.waitFor();
          const confirmar = d.getByRole('button', { name: 'Confirmo que llegó a la cuenta' });
          const yaConfirmo = !(await confirmar.count());
          if (!yaConfirmo) await confirmar.click();
          await d.getByRole('button', { name: 'Quitar mi conformidad' }).waitFor({ timeout: 10000 });
          return `${correo} ${yaConfirmo ? 'ya había confirmado' : 'confirma'} el pago de ${codigo}`;
        });
      } catch (e) { interrumpido(F, e); }
      await ctx.close();
    }
  } else {
    console.log(`  (${bloque} no tiene tesorero: no hace falta el check)`);
  }

  // 2) La administradora revisa y valida el voucher.
  {
    const { ctx, page } = await sesion(browser, { correo: CUENTA.admin.correo, clave: CUENTA.admin.clave }).catch((e) => { interrumpido(F, e); return {}; });
    if (page) {
      try {
        await paso(F, 'admin-pagos-por-validar', page, async () => {
          await page.goto(BASE + '/admin/pagos');
          // La lista va por fecha (la más vieja primero) y de a 20: se filtra por el block del pago.
          await page.locator('select', { has: page.locator('option', { hasText: bloque }) }).first().selectOption({ label: bloque });
          const fila = await filaDePago(page, codigo);
          return (await fila.innerText()).replace(/\s+/g, ' ').slice(0, 160);
        });
        await paso(F, 'admin-revisa-voucher', page, async () => {
          await (await filaDePago(page, codigo)).getByRole('button', { name: 'Revisar' }).click();
          const d = page.getByRole('dialog');
          await d.getByRole('button', { name: 'Validar pago' }).waitFor();
          return (await d.innerText()).replace(/\s+/g, ' ').slice(0, 200);
        });
        await paso(F, 'admin-valida-el-pago', page, async () => {
          await page.getByRole('dialog').getByRole('button', { name: 'Validar pago' }).click();
          await toast(page, /validad|pagado/i).waitFor({ timeout: 10000 });
          return await toast(page, /validad|pagado/i).innerText();
        });
      } catch (e) { interrumpido(F, e); }
      await ctx.close();
    }
  }

  // 3) El residente ve el cargo pagado en su celular.
  if (pagador) {
    const { ctx, page } = await sesion(browser, { correo: pagador, clave: claveDe(pagador), movil: true }).catch((e) => { interrumpido(F, e); return {}; });
    if (page) {
      try {
        await paso(F, 'residente-ve-pagado', page, async () => {
          await irACargos(page, rutaCargos(pagador));
          await page.getByRole('tab', { name: 'Pagados' }).click();
          await page.getByText(new RegExp(`${nombreMes} de ${anio}`, 'i')).first().waitFor({ timeout: 10000 });
          return `${codigo} · ${nombreMes} ${anio} en «Pagados»`;
        });
      } catch (e) { interrumpido(F, e); }
      await ctx.close();
    }
  }
};

FLUJOS.rechazo = async (browser) => {
  const F = 'rechazo';
  const u = elegirUnidad('Block 1', { orden: '(i.email is not null) desc' });
  const correo = u.inquilino || u.propietario;
  const tesorera = u.tesoreros[0] ?? CUENTA.tesorera1.correo;
  const ref1 = `E2E-${RUN}-rechazo1`;
  const ref2 = `E2E-${RUN}-rechazo2`;
  const pagaMal = await sesion(browser, { correo, clave: claveDe(correo), movil: true }).catch((e) => { interrumpido(F, e); return {}; });
  if (!pagaMal.page) return;
  try {
    await paso(F, 'residente-paga-con-monto-equivocado', pagaMal.page, async () => {
      await irACargos(pagaMal.page, rutaCargos(correo));
      await pagaMal.page.getByRole('button', { name: 'Pagar mantenimiento' }).first().click();
      const d = pagaMal.page.getByRole('dialog');
      await d.getByText('Monto a pagar').waitFor();
      const archivo = await voucher(browser, { monto: '150.00', operacion: ref1.slice(-12), nombre: 'RESIDENTE DE PRUEBA' });
      await d.getByLabel('Voucher (foto o PDF)').setInputFiles(archivo);
      await d.getByLabel(/N\.º de operación/).fill(ref1);
      await d.getByRole('button', { name: 'Enviar pago' }).click();
      await d.getByText(/quedó registrado/).waitFor({ timeout: 20000 });
      return `${u.codigo} · voucher por S/ 150.00 (no es el monto del mes)`;
    });
  } catch (e) { interrumpido(F, e); }
  await pagaMal.ctx.close();

  const junta = await sesion(browser, { correo: tesorera, clave: CLAVE_PROPIETARIO, movil: true }).catch((e) => { interrumpido(F, e); return {}; });
  if (junta.page) {
    try {
      // Regla vigente (API-CONTRATO: PATCH /api/pagos/:id/validacion es sólo admin/superadmin): la tesorera confirma la llegada del
      // dinero y NO rechaza. Se comprueba que la pantalla no le ofrezca «Rechazar»; el rechazo lo hace la administradora (paso siguiente).
      await paso(F, 'tesorera-confirma-pero-no-rechaza', junta.page, async () => {
        await junta.page.goto(BASE + '/junta/pagos');
        await (await filaDePago(junta.page, u.codigo)).getByRole('button', { name: /Revisar/ }).click();
        const d = junta.page.getByRole('dialog');
        await d.getByRole('button', { name: 'Confirmo que llegó a la cuenta' }).waitFor();
        if (await d.getByRole('button', { name: 'Rechazar' }).count()) throw new Error('la tesorera ve «Rechazar»: según la regla, sólo la administradora puede rechazar un pago');
        await cerrarDialogo(junta.page);
        return `${tesorera} sólo confirma la llegada del dinero`;
      });
    } catch (e) { interrumpido(F, e); }
    await junta.ctx.close();
  }

  const admin = await sesion(browser, { correo: CUENTA.admin.correo, clave: CUENTA.admin.clave }).catch((e) => { interrumpido(F, e); return {}; });
  if (admin.page) {
    try {
      await paso(F, 'admin-rechaza-con-motivo', admin.page, async () => {
        await admin.page.goto(BASE + '/admin/pagos');
        await admin.page.locator('select', { has: admin.page.locator('option', { hasText: u.bloque }) }).first().selectOption({ label: u.bloque });
        await (await filaDePago(admin.page, u.codigo)).getByRole('button', { name: 'Revisar' }).click();
        const d = admin.page.getByRole('dialog');
        await d.getByRole('button', { name: 'Rechazar' }).click();
        const motivo = `El voucher es por S/ 150.00 y el mantenimiento es mayor. Paga la diferencia o sube el voucher correcto (${RUN}).`;
        await d.getByLabel('Motivo del rechazo').fill(motivo);
        await d.getByRole('button', { name: 'Confirmar rechazo' }).click();
        await toast(admin.page, /rechaz/i).waitFor({ timeout: 10000 });
        estado.motivoRechazo = motivo;
        return `la administradora rechaza ${u.codigo} con motivo`;
      });
    } catch (e) { interrumpido(F, e); }
    await admin.ctx.close();
  }

  const reintenta = await sesion(browser, { correo, clave: claveDe(correo), movil: true }).catch((e) => { interrumpido(F, e); return {}; });
  if (reintenta.page) {
    try {
      await paso(F, 'residente-ve-el-rechazo', reintenta.page, async () => {
        await irACargos(reintenta.page, rutaCargos(correo));
        await reintenta.page.getByText(/Pago rechazado:/).first().waitFor({ timeout: 10000 });
        const motivo = estado.motivoRechazo ?? '';
        const visto = await reintenta.page.getByText(/Pago rechazado:/).first().innerText();
        if (motivo && !visto.includes(motivo.slice(0, 30))) throw new Error(`El motivo visible («${visto.slice(0, 120)}») no es el que escribió la tesorera.`);
        return visto.replace(/\s+/g, ' ').slice(0, 200);
      });
      await paso(F, 'residente-paga-de-nuevo', reintenta.page, async () => {
        await reintenta.page.getByRole('button', { name: 'Pagar de nuevo' }).first().click();
        await reintenta.page.getByRole('dialog').getByText('Monto a pagar').waitFor();
        const d = reintenta.page.getByRole('dialog');
        await d.getByText('Monto a pagar').waitFor();
        await reintenta.page.waitForTimeout(600);
        const monto = (await d.locator('.num').first().innerText()).replace(/[^\d.,]/g, '');
        const archivo = await voucher(browser, { monto, operacion: ref2.slice(-12), nombre: 'RESIDENTE DE PRUEBA' });
        await d.getByLabel('Voucher (foto o PDF)').setInputFiles(archivo);
        await d.getByRole('button', { name: 'Enviar pago' }).click();
        await d.getByText(/quedó registrado/).waitFor({ timeout: 20000 });
        return `segundo voucher por S/ ${monto}`;
      });
    } catch (e) { interrumpido(F, e); }
    await reintenta.ctx.close();
  }
};

FLUJOS.efectivo = async (browser) => {
  const F = 'efectivo';
  const u = elegirUnidad('Block 2', { orden: '1' });
  const { ctx, page } = await sesion(browser, { correo: CUENTA.admin.correo, clave: CUENTA.admin.clave }).catch((e) => { interrumpido(F, e); return {}; });
  if (!page) return;
  try {
    await paso(F, 'admin-registra-pago-en-efectivo', page, async () => {
      await page.goto(BASE + '/admin/pagos');
      await page.getByRole('button', { name: 'Registrar pago' }).first().click();
      const d = page.getByRole('dialog');
      await d.getByLabel('Periodo y block').waitFor();
      // El periodo es el recibo donde la unidad tiene su cargo pendiente (elegido en la base).
      await d.getByLabel('Periodo y block').selectOption(String(u.reciboId));
      await d.getByLabel('Código de departamento').fill(u.codigo);
      await d.getByText(u.codigo, { exact: true }).first().click();
      await page.waitForTimeout(600);
      await d.getByLabel('Método de pago').selectOption('efectivo');
      await d.getByLabel('Referencia (opcional)').fill(`E2E-${RUN}-efectivo`);
      await d.getByRole('button', { name: 'Registrar pago del mantenimiento' }).click();
      await toast(page, /registr|pagado/i).waitFor({ timeout: 10000 });
      return `${u.codigo} en efectivo`;
    });
    await paso(F, 'pago-aparece-como-pagado', page, async () => {
      await page.goto(BASE + '/admin/pagos');
      await page.getByRole('tab', { name: 'Validados' }).click(); // un pago en efectivo lo registra la administradora: nace validado
      await page.locator('select', { has: page.locator('option', { hasText: u.bloque }) }).first().selectOption({ label: u.bloque });
      // La fila de ESTA corrida, por su referencia (la unidad puede tener otros pagos validados).
      const ref = `E2E-${RUN}-efectivo`;
      const fila = (await (await filaDePago(page, ref)).innerText()).replace(/\s+/g, ' ');
      if (!/efectivo/i.test(fila) || !/validado/i.test(fila)) throw new Error(`El pago ${ref} no figura como efectivo validado: «${fila.slice(0, 160)}»`);
      return fila.slice(0, 160);
    });
  } catch (e) { interrumpido(F, e); }
  await ctx.close();
};

FLUJOS.comunicado = async (browser) => {
  const F = 'comunicado';
  const titulo = `Corte de agua programado ${RUN}`;
  const { ctx, page } = await sesion(browser, { correo: CUENTA.admin.correo, clave: CUENTA.admin.clave }).catch((e) => { interrumpido(F, e); return {}; });
  if (page) {
    try {
      await paso(F, 'admin-publica-comunicado', page, async () => {
        await page.goto(BASE + '/admin/comunicados');
        await page.getByRole('button', { name: 'Nuevo comunicado' }).first().click();
        const d = page.getByRole('dialog');
        await d.waitFor();
        // Con un solo condominio en su ámbito el selector no aparece: ya viene elegido.
        if (await d.getByLabel('Condominio').count()) await elegirOpcion(d.getByLabel('Condominio'), CONDOMINIO);
        await d.getByLabel('Título').fill(titulo);
        await d.getByLabel('Mensaje').fill('Mañana, de 9 a 12 horas, habrá corte de agua en todo el condominio por mantenimiento de la cisterna.');
        await d.getByRole('button', { name: 'Publicar' }).click();
        await d.waitFor({ state: 'hidden', timeout: 15000 });
        await page.getByText(titulo).first().waitFor({ timeout: 10000 });
        estado.titulo = titulo;
        return titulo;
      });
    } catch (e) { interrumpido(F, e); }
    await ctx.close();
  }
  const vecino = await sesion(browser, { correo: CUENTA.javier.correo, clave: CUENTA.javier.clave, movil: true }).catch((e) => { interrumpido(F, e); return {}; });
  if (vecino.page) {
    try {
      await paso(F, 'propietario-lee-comunicado-en-celular', vecino.page, async () => {
        await vecino.page.goto(BASE + '/propietario/comunicados');
        await vecino.page.getByText(estado.titulo ?? titulo).first().click();
        await vecino.page.getByText(/corte de agua/i).first().waitFor({ timeout: 10000 });
        return estado.titulo ?? titulo;
      });
    } catch (e) { interrumpido(F, e); }
    await vecino.ctx.close();
  }
};

FLUJOS.invitacion = async (browser) => {
  const F = 'invitacion';
  const correo = `vecino.e2e.${RUN}@prueba.house`;
  const nombre = `Vecino E2E ${RUN}`;
  const { ctx, page } = await sesion(browser, { correo: CUENTA.admin.correo, clave: CUENTA.admin.clave }).catch((e) => { interrumpido(F, e); return {}; });
  if (page) {
    try {
      await paso(F, 'admin-crea-residente', page, async () => {
        await page.goto(BASE + '/admin/residentes');
        await page.getByRole('button', { name: 'Nuevo residente' }).first().click();
        const d = page.getByRole('dialog');
        await d.waitFor();
        await d.getByLabel('Nombre completo').fill(nombre);
        await d.getByLabel('Correo electrónico').fill(correo);
        const rol = d.getByLabel('Rol');
        if (await rol.count()) await rol.selectOption('propietario');
        await elegirOpcion(d.getByLabel('Condominio'), CONDOMINIO);
        await d.getByRole('button', { name: 'Crear', exact: true }).click();
        await d.waitFor({ state: 'hidden', timeout: 15000 });
        // Se busca por correo en la lista (es larga y va por páginas).
        await page.getByPlaceholder('Buscar por nombre o correo').fill(correo);
        await page.getByText(correo).first().waitFor({ timeout: 10000 });
        return correo;
      });
    } catch (e) { interrumpido(F, e); }
    await ctx.close();
  }

  // Sin correo configurado: se fabrica el token de la invitación (en la base se guarda sólo su sha256).
  const token = randomBytes(32).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  try {
    sql(`insert into "TokenInvitacion" (usuario_id, token_hash, expira_at)
         select id, '${hash}', now() + interval '7 days' from "Usuario" where email = '${correo}'`);
    if (!sql(`select 1 from "TokenInvitacion" t join "Usuario" u on u.id = t.usuario_id where u.email = '${correo}' and t.token_hash = '${hash}'`).length) throw new Error('No se pudo fabricar el token de invitación.');
  } catch (e) { interrumpido(F, e); return; }

  const nuevo = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'es-PE' });
  nuevo.setDefaultTimeout(15000);
  const pagina = await nuevo.newPage();
  pagina.errores = []; pagina.consola = [];
  pagina.on('pageerror', (e) => pagina.errores.push('error de página: ' + String(e).slice(0, 160)));
  pagina.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) pagina.errores.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
  try {
    await paso(F, 'residente-abre-la-invitacion', pagina, async () => {
      await pagina.goto(`${BASE}/invitacion?token=${token}`);
      await pagina.getByRole('heading', { name: 'Crea tu contraseña' }).waitFor();
      return 'Crea tu contraseña';
    });
    await paso(F, 'residente-crea-su-contraseña', pagina, async () => {
      const clave = 'Cl4ve-segura-2026';
      await pagina.getByLabel('Contraseña', { exact: true }).fill(clave);
      await pagina.getByLabel('Repite la contraseña').fill(clave);
      await pagina.getByRole('button', { name: 'Crear contraseña y entrar' }).click();
      await pagina.waitForURL((u) => u.pathname.startsWith('/propietario') || u.pathname.startsWith('/inquilino'), { timeout: 20000 });
      return `entra en ${new URL(pagina.url()).pathname}`;
    });
    await paso(F, 'residente-ve-su-inicio', pagina, async () => {
      await pagina.waitForLoadState('networkidle');
      await pagina.getByRole('heading').first().waitFor();
      return (await pagina.locator('main').innerText()).replace(/\s+/g, ' ').slice(0, 140);
    });
  } catch (e) { interrumpido(F, e); }
  await nuevo.close();
};

FLUJOS.junta = async (browser) => {
  const F = 'junta';
  const tesorera = await sesion(browser, { correo: CUENTA.tesorera1.correo, clave: CUENTA.tesorera1.clave, movil: true }).catch((e) => { interrumpido(F, e); return {}; });
  if (tesorera.page) {
    try {
      await paso(F, 'tesorera-block-abre-cierre-del-mes', tesorera.page, async () => {
        await tesorera.page.goto(BASE + '/junta/cierre');
        await tesorera.page.getByRole('heading', { name: /Cierre del mes/ }).waitFor();
        return 'solo lectura: no cierra ningún mes';
      });
    } catch (e) { interrumpido(F, e); }
    await tesorera.ctx.close();
  }
  const central = await sesion(browser, { correo: CUENTA.tesorero_central.correo, clave: CUENTA.tesorero_central.clave, movil: true }).catch((e) => { interrumpido(F, e); return {}; });
  if (central.page) {
    try {
      await paso(F, 'tesorero-central-abre-cierre-central', central.page, async () => {
        await central.page.goto(BASE + '/junta/cierre-central');
        await central.page.getByRole('heading', { name: 'Cierre de la Junta central' }).waitFor();
        return 'solo lectura';
      });
      await paso(F, 'tesorero-central-abre-aportes', central.page, async () => {
        await central.page.goto(BASE + '/junta/aportes');
        await central.page.getByRole('heading', { name: 'Aportes de los blocks' }).waitFor();
        return 'solo lectura';
      });
    } catch (e) { interrumpido(F, e); }
    await central.ctx.close();
  }
};

FLUJOS.personal = async (browser) => {
  const F = 'personal';
  const titulo = `Revisar fuga en el baño ${RUN}`;
  // La administración crea y asigna la tarea (la semilla no trae tareas de María pendientes).
  const admin = await sesion(browser, { correo: CUENTA.admin.correo, clave: CUENTA.admin.clave }).catch((e) => { interrumpido(F, e); return {}; });
  if (admin.page) {
    try {
      await paso(F, 'admin-asigna-tarea-a-mantenimiento', admin.page, async () => {
        const [[mariaId]] = sql(`select id from "Usuario" where email = '${CUENTA.mantenimiento.correo}'`);
        await admin.page.goto(BASE + '/admin/mantenimientos');
        await admin.page.getByRole('button', { name: 'Nueva tarea' }).first().click();
        const d = admin.page.getByRole('dialog');
        await d.getByLabel('Título').fill(titulo);
        await d.getByLabel('Asignar a (opcional)').selectOption(String(mariaId));
        await d.getByRole('button', { name: 'Crear tarea' }).click();
        await d.waitFor({ state: 'hidden', timeout: 15000 });
        return `«${titulo}» asignada a mantenimiento`;
      });
    } catch (e) { interrumpido(F, e); }
    await admin.ctx.close();
  }
  const mtto = await sesion(browser, { correo: CUENTA.mantenimiento.correo, clave: CUENTA.mantenimiento.clave, movil: true }).catch((e) => { interrumpido(F, e); return {}; });
  if (mtto.page) {
    try {
      await paso(F, 'mantenimiento-inicia-una-tarea', mtto.page, async () => {
        await mtto.page.goto(BASE + '/mantenimiento/tareas');
        const iniciar = mtto.page.getByRole('button', { name: 'Iniciar' }).first();
        await iniciar.waitFor({ timeout: 10000 });
        await Promise.all([
          mtto.page.waitForResponse((r) => r.url().includes('/api/tareas') && r.request().method() !== 'GET' && r.status() < 300),
          iniciar.click(),
        ]);
        return 'tarea iniciada';
      });
    } catch (e) { interrumpido(F, e); }
    await mtto.ctx.close();
  }
  const seg = await sesion(browser, { correo: CUENTA.seguridad.correo, clave: CUENTA.seguridad.clave, movil: true }).catch((e) => { interrumpido(F, e); return {}; });
  if (seg.page) {
    try {
      await paso(F, 'seguridad-busca-un-departamento', seg.page, async () => {
        await seg.page.goto(BASE + '/seguridad/unidades');
        await seg.page.getByPlaceholder('Buscar por código de unidad').fill('B01-804');
        await seg.page.getByText('B01-804', { exact: true }).first().waitFor({ timeout: 10000 });
        return 'B01-804 encontrado';
      });
    } catch (e) { interrumpido(F, e); }
    await seg.ctx.close();
  }
};

FLUJOS.perfil = async (browser) => {
  const F = 'perfil';
  const telefono = `9${String(Date.now()).slice(-8)}`;
  const { ctx, page } = await sesion(browser, { correo: CUENTA.javier.correo, clave: CUENTA.javier.clave, movil: true }).catch((e) => { interrumpido(F, e); return {}; });
  if (!page) return;
  try {
    await paso(F, 'propietario-cambia-su-telefono', page, async () => {
      await page.goto(BASE + '/perfil');
      // El celular está en «Celular y avisos» (más abajo en la página).
      const campo = page.getByLabel('Tu celular', { exact: true }).first();
      await campo.scrollIntoViewIfNeeded();
      await campo.fill(telefono);
      await page.getByRole('button', { name: 'Guardar', exact: true }).first().click();
      await toast(page, /guard|cambi/i).waitFor({ timeout: 10000 });
      return `nuevo celular ${telefono}`;
    });
    await paso(F, 'telefono-guardado-tras-recargar', page, async () => {
      await page.reload();
      await page.waitForLoadState('networkidle');
      const campo = page.getByLabel('Tu celular', { exact: true }).first();
      await campo.scrollIntoViewIfNeeded();
      const guardado = await campo.inputValue();
      if (!guardado.replace(/\D/g, '').endsWith(telefono)) throw new Error(`Tras recargar el teléfono es «${guardado}», no ${telefono}.`);
      return `guardado: ${guardado}`;
    });
  } catch (e) { interrumpido(F, e); }
  await ctx.close();
};

// ---------------------------------------------------------------- Ejecución
const ORDEN = ['cobro', 'pago-voucher', 'validar', 'rechazo', 'efectivo', 'comunicado', 'invitacion', 'junta', 'personal', 'perfil'];
const pedidos = process.argv[2] ? process.argv[2].split(',').map((s) => s.trim()).filter(Boolean) : ORDEN;
const desconocidos = pedidos.filter((f) => !FLUJOS[f]);
if (desconocidos.length) { console.error(`Flujos desconocidos: ${desconocidos.join(', ')}. Disponibles: ${ORDEN.join(', ')}`); process.exit(2); }

console.log(`E2E de operación · ${BASE} · base ${E2E_DB} · corrida ${RUN}`);
const browser = await chromium.launch();
for (const nombre of pedidos) {
  console.log(`\n# ${nombre}`);
  await FLUJOS[nombre](browser);
}
await browser.close();

const ok = resultados.filter((r) => r.ok).length;
const total = resultados.length;
writeFileSync(join(RESULTADOS, 'operacion.json'), JSON.stringify({ corrida: RUN, base: BASE, db: E2E_DB, fecha: new Date().toISOString(), ok, total, pasos: resultados }, null, 1));
console.log(`\nok ${ok}/${total}`);
const fallas = resultados.filter((r) => !r.ok);
for (const f of fallas) console.log(`  FALLA ${f.flujo} · ${f.paso} — ${f.nota}`);
process.exit(fallas.length ? 1 : 0);
