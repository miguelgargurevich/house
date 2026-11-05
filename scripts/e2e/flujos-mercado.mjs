// Recorrido del MERCADO SIMULADO de House (3 empresas con varios condominios + 5 juntas de vecinos de 1 block): separación entre clientes, cada tipo de
// cliente, planes y facturación de Torre, rendimiento con volumen y mensajería inteligente. Informe: docs/pruebas/simulacion-mercado.md.
//
// Preparar (una vez; tarda ~2 min):
//   docker exec house-pg psql -U postgres -c "CREATE DATABASE house_mercado"
//   DATABASE_URL=postgresql://postgres:house@localhost:5433/house_mercado npx prisma db push --skip-generate
//   DATABASE_URL=postgresql://postgres:house@localhost:5433/house_mercado CREDENCIALES_JSON=<archivo fuera del repo> npm run seed:mercado
// Levantar el backend aislado (sin correo ni WhatsApp; NO copia la base):
//   HOUSE_REPO=$PWD bash scripts/e2e/levantar.sh 4110 house_mercado
// Correr (sin argumento = todas las fases; o una lista separada por comas: separacion,herramientas,tipos,planes,rendimiento,mensajeria,navegador):
//   CREDENCIALES_JSON=<archivo> node scripts/e2e/flujos-mercado.mjs [fases]
// Las fases `tipos` ESCRIBEN (emite el recibo de noviembre de una junta, paga, valida): son de una sola vez; para repetirlas, vuelve a sembrar.
// `separacion` no debe cambiar NADA en la base: compara una huella de las tablas de negocio antes y después.
// Salida: resultado en scripts/e2e/resultados/mercado.json (todo, con evidencia) y capturas en scripts/e2e/capturas/mercado-*.png. Código 1 si algo FALLA.
// Nunca imprime contraseñas ni tokens: las cuentas salen del archivo CREDENCIALES_JSON y sólo se muestran correos y roles.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTADOS = join(HERE, 'resultados');
const CAPTURAS = join(HERE, 'capturas');
mkdirSync(RESULTADOS, { recursive: true });
mkdirSync(CAPTURAS, { recursive: true });

const BASE = process.env.BASE_URL || 'http://localhost:4110';
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error('Este script sólo corre contra localhost: crea recibos, pagos y cuentas.');
const DB = 'house_mercado';
if (!process.env.CREDENCIALES_JSON) throw new Error('Falta CREDENCIALES_JSON (el archivo que escribió `npm run seed:mercado`).');
const CRED = JSON.parse(readFileSync(process.env.CREDENCIALES_JSON, 'utf8'));
const FASES = (process.argv[2] ?? 'separacion,herramientas,tipos,planes,rendimiento,mensajeria,navegador').split(',');

// ---------------------------------------------------------------- Base (sólo lectura para ubicar ids y comparar huellas)
function sql(consulta) {
  const salida = execFileSync('docker', ['exec', 'house-pg', 'psql', '-U', 'postgres', '-d', DB, '-At', '-F', '\t', '-c', consulta], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return salida.trim() === '' ? [] : salida.trim().split('\n').map((l) => l.split('\t'));
}
const ids = (consulta) => sql(consulta).map((f) => Number(f[0]));

// ---------------------------------------------------------------- Resultados
const registro = []; // { fase, grupo, prueba, ok, detalle }
let fallas = 0;
const fase0 = { actual: '' };
function anotar(grupo, prueba, ok, detalle = '') {
  registro.push({ fase: fase0.actual, grupo, prueba, ok, detalle });
  if (!ok) {
    fallas++;
    console.log(`  FALLA  [${grupo}] ${prueba}${detalle ? ` — ${detalle}` : ''}`);
  }
}
const medidas = []; // rendimiento
const extra = {}; // datos del informe (facturación, mensajería…)

// ---------------------------------------------------------------- Cliente HTTP con sesión (cookie + CSRF)
class Api {
  constructor(etiqueta, cuenta) {
    this.etiqueta = etiqueta;
    this.correo = cuenta.email;
    this.clave = cuenta.password;
  }
  async entrar() {
    const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: this.correo, password: this.clave }) });
    const j = await r.json().catch(() => ({}));
    if (r.status !== 200) throw new Error(`login de ${this.etiqueta} (${this.correo}) falló con ${r.status}`);
    this.cookie = /house_sesion=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';
    this.csrf = j.csrf;
    this.usuario = j.user;
    delete this.clave; // no se conserva
    return this;
  }
  cab(extra = {}) {
    return { cookie: `house_sesion=${this.cookie}`, 'x-csrf-token': this.csrf, ...extra };
  }
  async pedir(metodo, ruta, { json, form, crudo } = {}) {
    const t0 = performance.now();
    let init = { method: metodo, headers: this.cab(json !== undefined ? { 'content-type': 'application/json' } : {}) };
    if (json !== undefined) init.body = JSON.stringify(json);
    if (form) init = { method: metodo, headers: this.cab(), body: form };
    const r = await fetch(BASE + ruta, init);
    const buf = Buffer.from(await r.arrayBuffer());
    const ms = Math.round(performance.now() - t0);
    let body = null;
    const conTexto = !crudo || r.status >= 400; // un archivo (Excel, imagen) no se decodifica; un error sí
    const texto = conTexto ? buf.toString('utf8') : '';
    if (conTexto) try { body = JSON.parse(texto); } catch { /* no es JSON */ }
    return { status: r.status, body, texto, bytes: buf.length, ms, tipo: r.headers.get('content-type') ?? '' };
  }
  get(ruta, o) { return this.pedir('GET', ruta, o); }
  post(ruta, json) { return this.pedir('POST', ruta, { json }); }
  put(ruta, json) { return this.pedir('PUT', ruta, { json }); }
  patch(ruta, json) { return this.pedir('PATCH', ruta, { json }); }
  del(ruta) { return this.pedir('DELETE', ruta); }
}

// PNG mínimo válido (voucher de prueba).
import { deflateSync } from 'node:zlib';
function pngVoucher(semilla) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const c = Buffer.concat([Buffer.from(t), d]); const k = Buffer.alloc(4); k.writeUInt32BE(crc(c)); return Buffer.concat([l, c, k]); };
  const w = 48, h = 64, filas = [];
  for (let y = 0; y < h; y++) { const f = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { const v = y < 8 || (y % 9 < 2 && (x + semilla) % 11 > 1) ? 70 + ((semilla * 37 + y) % 90) : 245; f[1 + x * 3] = v; f[2 + x * 3] = v; f[3 + x * 3] = v; } filas.push(f); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(filas))), chunk('IEND', Buffer.alloc(0))]);
}
const formularioPago = (campos, semilla) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.append(k, String(v));
  f.append('voucher', new Blob([new Uint8Array(pngVoucher(semilla))], { type: 'image/png' }), 'voucher.png');
  return f;
};

// ---------------------------------------------------------------- Mapa de quién es dueño de qué (desde la base)
const CLIENTES = Object.keys(CRED.clientes); // A B C J1…J5
const dueno = {}; // cliente → { complejos, estructuras, … } (ids)
function mapear() {
  for (const c of CLIENTES) {
    const e = CRED.clientes[c].empresa_id;
    const cx = `(select id from "ComplejoHabitacional" where empresa_id = ${e})`;
    const recibos = `(select id from "Recibo" where empresa_id = ${e})`;
    const cargos = `(select rcu.id from "ReciboConceptoUnidad" rcu join "ReciboConcepto" rc on rc.id = rcu.recibo_concepto_id where rc.recibo_id in ${recibos})`;
    dueno[c] = {
      empresa: e,
      complejos: ids(`select id from "ComplejoHabitacional" where empresa_id = ${e} order by id`),
      estructuras: ids(`select id from "Estructura" where complejo_id in ${cx} order by id`),
      pisos: ids(`select p.id from "Piso" p join "Estructura" s on s.id = p.estructura_id where s.complejo_id in ${cx} order by p.id`),
      unidades: ids(`select id from "Unidad" where complejo_id in ${cx} order by id`),
      usuarios: ids(`select id from "Usuario" where empresa_id = ${e} or complejo_id in ${cx} order by id`),
      recibos: ids(`select id from "Recibo" where empresa_id = ${e} order by id`),
      reciboConceptos: ids(`select id from "ReciboConcepto" where recibo_id in ${recibos} order by id`),
      cargos: ids(`select rcu.id from "ReciboConceptoUnidad" rcu join "ReciboConcepto" rc on rc.id = rcu.recibo_concepto_id where rc.recibo_id in ${recibos} order by rcu.id`),
      pagos: ids(`select p.id from "Pago" p where p.recibo_concepto_unidad_id in ${cargos} order by p.id`),
      comunicados: ids(`select id from "Comunicado" where complejo_id in ${cx} order by id`),
      conceptos: ids(`select id from "Concepto" where empresa_id = ${e} order by id`),
      medios: ids(`select id from "MedioPago" where complejo_id in ${cx} order by id`),
      juntas: ids(`select id from "JuntaDirectiva" where complejo_id in ${cx} order by id`),
      areas: ids(`select id from "AreaComun" where complejo_id in ${cx} order by id`),
      reservas: ids(`select r.id from "Reserva" r join "AreaComun" a on a.id = r.area_id where a.complejo_id in ${cx} order by r.id`),
      grupos: ids(`select id from "GrupoWhatsapp" where empresa_id = ${e} order by id`),
    };
    dueno[c].sets = Object.fromEntries(Object.entries(dueno[c]).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, new Set(v)]));
  }
}
/** Un par (recibo, unidad) del cliente: el último recibo (octubre) de su primer block, y una unidad de ese block. */
function parMantenimiento(c, { bloque = 0 } = {}) {
  const d = dueno[c];
  const [fila] = sql(`select r.id, u.id, r.estructura_id from "Recibo" r join "Unidad" u on u.estructura_id = r.estructura_id where r.empresa_id = ${d.empresa} and r.mes = 10 order by r.estructura_id, r.id, u.id offset ${bloque} limit 1`);
  return { reciboId: Number(fila[0]), unidadId: Number(fila[1]), estructuraId: Number(fila[2]) };
}
const pagoDe = (c, estado) => Number(sql(`select p.id from "Pago" p where p.estado_validacion = '${estado}' and p.recibo_concepto_unidad_id in (select rcu.id from "ReciboConceptoUnidad" rcu join "ReciboConcepto" rc on rc.id = rcu.recibo_concepto_id join "Recibo" r on r.id = rc.recibo_id where r.empresa_id = ${dueno[c].empresa}) order by p.id limit 1`)[0]?.[0] ?? 0) || null;

const TABLAS_HUELLA = ['EmpresaAdministradora', 'ComplejoHabitacional', 'Estructura', 'Piso', 'Unidad', 'Usuario', 'Recibo', 'ReciboConcepto', 'ReciboConceptoUnidad', 'Pago', 'Comunicado', 'Concepto', 'MedioPago', 'JuntaDirectiva', 'MiembroJunta', 'AreaComun', 'Reserva', 'GrupoWhatsapp', 'SuscripcionCondominio', 'PagoSuscripcion', 'ArchivoComprobante', 'PersonaUnidad'];
const huella = (sinFechas = false) => Object.fromEntries(TABLAS_HUELLA.map((t) => [t, sql(`select count(*), md5(coalesce(string_agg(${sinFechas ? "(to_jsonb(x) - 'updated_at')::text" : 'x::text'}, '' order by x.id), '')) from "${t}" x`)[0].join(':')]));

// ================================================================ FASE 1: separación entre clientes
async function faseSeparacion(S) {
  console.log('\n== Separación entre clientes ==');

  const atacantes = [
    ...CLIENTES.map((c) => ({ id: `admin ${c}`, cliente: c, api: S.admin[c], tipo: 'admin' })),
    ...CLIENTES.filter((c) => S.tesorero[c]).map((c) => ({ id: `tesorero ${c}`, cliente: c, api: S.tesorero[c], tipo: 'junta' })),
    ...CLIENTES.filter((c) => S.vecino[c]).map((c) => ({ id: `vecino ${c}`, cliente: c, api: S.vecino[c], tipo: 'vecino' })),
    ...CLIENTES.filter((c) => S.personal[c]).map((c) => ({ id: `personal ${c}`, cliente: c, api: S.personal[c], tipo: 'personal' })),
  ];
  let intentos = 0;

  /**
   * Evalúa un intento sobre un recurso AJENO. Fuerte = 403/404, o 422 que rechaza la REFERENCIA ajena («complejo_id: no existe o no tienes acceso»).
   * Débil = otro 4xx (el cuerpo de la prueba pudo fallar por otra razón: no demuestra que se mire la empresa). 2xx = FALLA, salvo la lista vacía de un GET filtrado.
   */
  const ajeno = (a, v, etiqueta, r, { escritura = false } = {}) => {
    intentos++;
    const dicePorAjeno = /no existe|no tienes acceso|no es (de|del|un)\b|no pertenece|no se cambia de condominio/i;
    const refAjena = r.status === 422 && ((r.body?.campos && Object.entries(r.body.campos).some(([k, t]) => /_id$/.test(k) && dicePorAjeno.test(String(t)))) || /no se cambia de condominio/i.test(String(r.body?.error)));
    const claro = r.status === 403 || r.status === 404 || r.status === 401 || refAjena;
    const debil = !claro && r.status >= 400 && r.status < 500;
    const exito = r.status >= 200 && r.status < 300;
    const nombre = `${a.id} → ${etiqueta} (cliente ${v})`;
    const est = ((extra.estadosPorAtaque ??= {})[etiqueta] ??= {});
    est[r.status] = (est[r.status] ?? 0) + 1;
    if (exito) {
      const vacio = r.body && Array.isArray(r.body.items) && r.body.items.length === 0;
      if (!escritura && vacio) return anotar('ajeno', nombre, true);
      return anotar('ajeno', nombre, false, `${r.status} ${r.texto.slice(0, 140).replace(/\s+/g, ' ')}`);
    }
    anotar('ajeno', nombre, claro || debil, claro ? '' : `${r.status} (rechazo por otra razón: ${r.texto.slice(0, 100)})`);
    if (debil) { (extra.debilesPor ??= {})[etiqueta] = ((extra.debilesPor ??= {})[etiqueta] ?? 0) + 1; extra.debiles = (extra.debiles ?? 0) + 1; }
  };
  const propio = {}; // línea base: lo que cada cuenta ve en su propio dashboard (el del vecino ignora complejo_id)

  const rutasLectura = (v) => {
    const d = dueno[v];
    const m = parMantenimiento(v);
    const rec = d.recibos.at(-1);
    const pago = d.pagos[0];
    const pv = pagoDe(v, 'por_validar') ?? pago;
    const cx = d.complejos[0];
    return [
        ['GET complejo', `/api/complejos/${cx}`], ['GET estructura', `/api/estructuras/${d.estructuras[0]}`], ['GET piso', `/api/pisos/${d.pisos[0]}`],
        ['GET unidad', `/api/unidades/${d.unidades[0]}`], ['GET personas de unidad', `/api/unidades/${d.unidades[0]}/personas`], ['GET usuario', `/api/usuarios/${d.usuarios[0]}`],
        ['GET recibo', `/api/recibos/${rec}`], ['GET recibo/blocks', `/api/recibos/${rec}/blocks`], ['GET recibo/consolidado', `/api/recibos/${rec}/consolidado`],
        ['GET recibo/consolidado/excel', `/api/recibos/${rec}/consolidado/excel`], ['GET recibo/consolidado/impresion', `/api/recibos/${rec}/consolidado/impresion`], ['GET recibo/mantenimientos', `/api/recibos/${m.reciboId}/mantenimientos`],
        ['GET mantenimiento', `/api/recibos/${m.reciboId}/mantenimientos/${m.unidadId}`], ['GET recibo/avisar', `/api/recibos/${rec}/avisar`], ['GET recibo/mensaje-grupo', `/api/recibos/${rec}/mensaje-grupo`],
        ['GET recibo-concepto', `/api/recibo-conceptos/${d.reciboConceptos[0]}`], ['GET cargo', `/api/recibo-concepto-unidades/${d.cargos[0]}`], ['GET pago', `/api/pagos/${pago}`],
        ['GET pago/comprobante', `/api/pagos/${pv}/comprobante`], ['GET pago/evaluacion', `/api/pagos/${pv}/evaluacion`], ['GET comunicado', `/api/comunicados/${d.comunicados[0] ?? 0}`],
        ['GET concepto', `/api/conceptos/${d.conceptos[0]}`], ['GET QR de medio', `/api/medios-pago/${d.medios[0]}/qr`],
        ['GET junta', `/api/juntas/${d.juntas[0]}`], ['GET area', `/api/areas-comunes/${d.areas[0] ?? 0}`], ['GET reserva', `/api/reservas/${d.reservas[0] ?? 0}`],
        ['GET cierre del block', `/api/cierres/block/${d.estructuras[0]}`], ['GET cierre central', `/api/cierres/central?complejo_id=${cx}`], ['GET cierres del condominio', `/api/cierres?complejo_id=${cx}`],
        ['GET morosidad', `/api/reportes/morosidad?complejo_id=${cx}`], ['GET rendición', `/api/reportes/rendicion?complejo_id=${cx}`], ['GET rendición.xlsx', `/api/reportes/rendicion.xlsx?complejo_id=${cx}`],
        ['GET dashboard', `/api/dashboard/resumen?complejo_id=${cx}`], ['GET cobertura WhatsApp', `/api/whatsapp/cobertura/${cx}`], ['GET uso del plan', `/api/comercial/mi-plan/${cx}/uso`],
        ['GET pagos de la suscripción', `/api/comercial/mi-plan/${cx}/pagos`], ['GET lista con complejo_id ajeno: recibos', `/api/recibos?complejo_id=${cx}`], ['GET lista con complejo_id ajeno: unidades', `/api/unidades?complejo_id=${cx}`],
        ['GET lista con complejo_id ajeno: comunicados', `/api/comunicados?complejo_id=${cx}`], ['GET lista con complejo_id ajeno: medios', `/api/medios-pago?complejo_id=${cx}`], ['GET lista con complejo_id ajeno: juntas', `/api/juntas?complejo_id=${cx}`],
        ['GET lista con complejo_id ajeno: áreas', `/api/areas-comunes?complejo_id=${cx}`], ['GET periodos del condominio ajeno', `/api/recibos/periodos?complejo_id=${cx}`],
        ['GET mantenimiento como vecino', `/api/me/mantenimientos/${m.reciboId}/${m.unidadId}`], ['GET cargo propio ajeno', `/api/me/cargos/${d.cargos[0]}`],
      
    ];
  };

  // --- 0. CONTROL POSITIVO: las mismas rutas con recursos PROPIOS deben responder (si una ruta estuviera mal escrita, el 404 «ajeno» no probaría nada)
  const sinRuta = [];
  for (const c of CLIENTES) {
    for (const [etiqueta, ruta] of rutasLectura(c)) {
      if (/\/0(\?|$|\/)/.test(ruta)) continue;
      if (/mantenimiento como vecino|cargo propio ajeno/.test(etiqueta)) continue; // rutas /me: se prueban con el vecino
      const r = await S.admin[c].get(ruta, { crudo: /excel|xlsx|impresion|qr|comprobante/i.test(etiqueta) });
      // 200 = existe y es suyo. 403 sólo por plan (reportes, WhatsApp) o por rol; 404 «no existe en este cliente» (p. ej. sin QR) se acepta sólo si el cliente no tiene ese recurso.
      const bien = r.status === 200 || (r.status === 403 && /plan|disponible|módulo|modulo|solo lectura/i.test(r.texto)) || (r.status === 404 && /qr|cierre central|junta|comprobante|evaluaci|cobertura|mensaje-grupo/i.test(etiqueta));
      if (!bien) sinRuta.push(`${c}: ${etiqueta} → ${r.status}`);
    }
  }
  anotar('control', 'cada ruta probada con recursos PROPIOS responde 200 (o 403 de plan / 404 de recurso inexistente en ese cliente)', sinRuta.length === 0, sinRuta.slice(0, 8).join(' | ') + (sinRuta.length > 8 ? ` … (${sinRuta.length})` : ''));
  // Control de las escrituras: el mismo PUT, con valores IGUALES a los actuales, sobre un recurso PROPIO responde 200 (el cuerpo del ataque es válido: si no se acepta, el rechazo ajeno sería por otra razón).
  const putPropios = [['/api/unidades', 'unidades', 'descripcion'], ['/api/usuarios', 'usuarios', 'nombre'], ['/api/recibos', 'recibos', 'descripcion'], ['/api/comunicados', 'comunicados', 'titulo'], ['/api/conceptos', 'conceptos', 'nombre'], ['/api/estructuras', 'estructuras', 'nombre'], ['/api/complejos', 'complejos', 'nombre']];
  for (const [base, clave, campo] of putPropios) {
    const c = clave === 'comunicados' ? 'A' : 'J4';
    const id = dueno[c][clave][0];
    const g = await S.admin[c].get(`${base}/${id}`);
    const valor = g.body?.[campo];
    const r = valor == null ? { status: 0 } : await S.admin[c].put(`${base}/${id}`, { [campo]: valor });
    anotar('control', `PUT ${base}/:id propio con el mismo valor de «${campo}» responde 200 (el cuerpo del ataque es válido)`, r.status === 200, `${r.status}`);
  }

  // Desde aquí NADA debe cambiar en la base (los controles de arriba escribieron valores iguales, pero movieron `updated_at`).
  const antes = huella();

  // --- 1a. IDs ajenos directos (GET / PUT / PATCH / DELETE / POST) — todos los atacantes contra cada otro cliente
  for (const a of atacantes) {
    const otros = CLIENTES.filter((c) => c !== a.cliente);
    for (const v of otros) {
      const d = dueno[v];
      const m = parMantenimiento(v);
      const rec = d.recibos.at(-1);
      const pago = d.pagos[0];
      const pv = pagoDe(v, 'por_validar') ?? pago;
      const cx = d.complejos[0];
      const lectura = rutasLectura(v);
      for (const [etiqueta, ruta] of lectura) {
        if (/\/0(\?|$|\/)/.test(ruta)) continue; // la víctima no tiene ese recurso (id 0): no se prueba
        const r = await a.api.get(ruta, { crudo: /excel|xlsx|impresion|qr|comprobante/i.test(etiqueta) });
        if (etiqueta === 'GET dashboard' && r.status === 200) {
          // El dashboard del vecino y de la junta es el PROPIO y ignora complejo_id; el de la administración, con un condominio ajeno, sale vacío. Ninguno trae datos del otro cliente.
          propio[a.id] ??= JSON.stringify((await a.api.get('/api/dashboard/resumen')).body);
          const vacioAdmin = a.tipo === 'admin' && (r.body.por_torre ?? []).length === 0 && Number(r.body.recibos_total ?? 0) === 0;
          anotar('ajeno', `${a.id} → ${etiqueta} (cliente ${v})`, vacioAdmin || (a.tipo !== 'admin' && JSON.stringify(r.body) === propio[a.id]), vacioAdmin ? '' : `no es vacío ni es el propio: ${r.texto.slice(0, 120)}`);
          intentos++;
          continue;
        }
        ajeno(a, v, etiqueta, r);
      }

      const escrituras = [
        ['PUT unidad', 'PUT', `/api/unidades/${d.unidades[0]}`, { descripcion: 'HACK' }], ['DELETE unidad', 'DELETE', `/api/unidades/${d.unidades[0]}`],
        ['PUT usuario', 'PUT', `/api/usuarios/${d.usuarios[0]}`, { nombre: 'HACK' }], ['DELETE usuario', 'DELETE', `/api/usuarios/${d.usuarios[0]}`],
        ['PUT recibo', 'PUT', `/api/recibos/${rec}`, { descripcion: 'HACK' }], ['DELETE recibo', 'DELETE', `/api/recibos/${rec}`], ['POST recibo/anular', 'POST', `/api/recibos/${rec}/anular`, { motivo: 'HACK intento' }],
        ['POST recibo/avisar', 'POST', `/api/recibos/${rec}/avisar`, {}],
        ['POST pago del mantenimiento', 'POST', `/api/recibos/${m.reciboId}/mantenimientos/${m.unidadId}/pagos`, { metodo_pago: 'efectivo' }],
        ['POST quitar multa', 'POST', `/api/recibos/${m.reciboId}/mantenimientos/${m.unidadId}/quitar-multa`, { motivo: 'HACK intento' }],
        ['PATCH validar pago', 'PATCH', `/api/pagos/${pv}/validacion`, { estado: 'validado' }], ['PATCH rechazar pago', 'PATCH', `/api/pagos/${pv}/validacion`, { estado: 'rechazado', motivo: 'HACK intento de rechazo' }],
        ['POST anular pago', 'POST', `/api/pagos/${pago}/anular`, { motivo: 'HACK intento' }], ['PUT conformidad', 'PUT', `/api/pagos/${pv}/conformidad`], ['DELETE pago', 'DELETE', `/api/pagos/${pago}`], ['PUT pago', 'PUT', `/api/pagos/${pago}`, { observaciones: 'HACK' }],
        ['PUT cargo', 'PUT', `/api/recibo-concepto-unidades/${d.cargos[0]}`, { monto: 1 }], ['DELETE cargo', 'DELETE', `/api/recibo-concepto-unidades/${d.cargos[0]}`],
        ['PUT recibo-concepto', 'PUT', `/api/recibo-conceptos/${d.reciboConceptos[0]}`, { monto: 1 }], ['DELETE recibo-concepto', 'DELETE', `/api/recibo-conceptos/${d.reciboConceptos[0]}`],
        ['PUT comunicado', 'PUT', `/api/comunicados/${d.comunicados[0] ?? 0}`, { titulo: 'HACK' }], ['POST archivar comunicado', 'POST', `/api/comunicados/${d.comunicados[0] ?? 0}/archivar`, {}],
        ['PUT concepto', 'PUT', `/api/conceptos/${d.conceptos[0]}`, { nombre: 'HACK' }], ['DELETE concepto', 'DELETE', `/api/conceptos/${d.conceptos[0]}`],
        ['PUT medio de pago', 'PUT', `/api/medios-pago/${d.medios[0]}`, { titular: 'HACK' }], ['DELETE medio de pago', 'DELETE', `/api/medios-pago/${d.medios[0]}`],
        ['PUT complejo', 'PUT', `/api/complejos/${cx}`, { nombre: 'HACK' }], ['DELETE complejo', 'DELETE', `/api/complejos/${cx}`],
        ['PUT estructura', 'PUT', `/api/estructuras/${d.estructuras[0]}`, { nombre: 'HACK' }], ['DELETE estructura', 'DELETE', `/api/estructuras/${d.estructuras[0]}`],
        ['PUT empresa', 'PUT', `/api/empresas/${d.empresa}`, { nombre: 'HACK' }], ['DELETE empresa', 'DELETE', `/api/empresas/${d.empresa}`],
        ['PUT junta', 'PUT', `/api/juntas/${d.juntas[0]}`, { notas: 'HACK' }], ['POST nueva gestión de junta', 'POST', `/api/juntas/${d.juntas[0]}/nueva-gestion`, {}],
        ['PUT area común', 'PUT', `/api/areas-comunes/${d.areas[0] ?? 0}`, { nombre: 'HACK' }], ['DELETE area común', 'DELETE', `/api/areas-comunes/${d.areas[0] ?? 0}`],
        ['PATCH reserva', 'PATCH', `/api/reservas/${d.reservas[0] ?? 0}`, { estado: 'aprobada' }],
        ['POST solicitar plan', 'POST', `/api/comercial/mi-plan/${cx}/solicitud`, { plan: 'pro' }], ['PATCH suscripción', 'PATCH', `/api/comercial/suscripciones/${cx}`, { plan_clave: 'cortesia' }],
        ['POST pago de suscripción', 'POST', `/api/comercial/suscripciones/${cx}/pagos`, { monto: '1.00' }], ['PUT grupo WhatsApp', 'PUT', `/api/whatsapp/grupos/${d.grupos[0] ?? 0}`, { en_uso: false }],
        // Crear colgando de recursos ajenos
        ['POST recibo en condominio ajeno', 'POST', '/api/recibos', { complejo_id: cx, mes: 12, anio: 2026, fecha_emision: '2026-12-01', fecha_vencimiento: '2026-12-15', conceptos: [] }],
        ['POST recibo con concepto ajeno', 'POST', '/api/recibos', { complejo_id: cx, estructura_id: d.estructuras[0], mes: 12, anio: 2026, fecha_emision: '2026-12-01', fecha_vencimiento: '2026-12-15', conceptos: [{ concepto_id: d.conceptos[0], monto: '10.00' }] }],
        ['POST unidad en condominio ajeno', 'POST', '/api/unidades', { codigo: 'HACK-1', tipo: 'departamento', complejo_id: cx, estructura_id: d.estructuras[0] }],
        ['POST usuario en condominio ajeno', 'POST', '/api/usuarios', { nombre: 'Hack', email: `hack.${a.cliente}.${v}@simulacion.example`, rol: 'propietario', complejo_id: cx, unidad_id: d.unidades[0] }],
        ['POST estructura en condominio ajeno', 'POST', '/api/estructuras', { nombre: 'HACK', tipo: 'block', complejo_id: cx }], ['POST piso en block ajeno', 'POST', '/api/pisos', { numero: 99, estructura_id: d.estructuras[0] }],
        ['POST comunicado en condominio ajeno', 'POST', '/api/comunicados', { complejo_id: cx, titulo: 'HACK', cuerpo: 'HACK' }], ['POST medio de pago en condominio ajeno', 'POST', '/api/medios-pago', { complejo_id: cx, tipo: 'yape', titular: 'HACK', celular: '900000001' }],
        ['POST concepto en empresa ajena', 'POST', '/api/conceptos', { nombre: 'HACK', empresa_id: d.empresa }], ['POST área común en condominio ajeno', 'POST', '/api/areas-comunes', { complejo_id: cx, nombre: 'HACK', hora_apertura: '09:00', hora_cierre: '20:00' }],
        ['POST cargo sobre unidad ajena', 'POST', '/api/recibo-concepto-unidades', { recibo_concepto_id: d.reciboConceptos[0], unidad_id: d.unidades[0], monto: 1 }], ['POST pago sobre cargo ajeno', 'POST', '/api/pagos', { recibo_concepto_unidad_id: d.cargos[0], monto: 1, metodo_pago: 'efectivo' }],
        ['POST junta en condominio ajeno', 'POST', '/api/juntas', { complejo_id: cx, desde: '2026-01-01', miembros: [] }], ['POST línea de cierre en block ajeno', 'POST', `/api/cierres/block/${d.estructuras[0]}/lineas`, {}],
        ['POST pago del vecino a unidad ajena', 'POST', `/api/me/mantenimientos/${m.reciboId}/${m.unidadId}/pagos`, { metodo_pago: 'efectivo' }],
      ];
      for (const [etiqueta, metodo, ruta, cuerpo] of escrituras) {
        if (/\/0(\?|$|\/)/.test(ruta)) continue; // la víctima no tiene ese recurso
        const r = await a.api.pedir(metodo, ruta, { json: cuerpo });
        // Crear un concepto con `empresa_id` ajeno: el servidor ignora ese campo y lo crea en la empresa de QUIEN llama. No es una brecha; se comprueba abajo y se borra.
        if (etiqueta === 'POST concepto en empresa ajena' && r.status === 201) { intentos++; anotar('ajeno', `${a.id} → ${etiqueta} (cliente ${v}): se crea en SU empresa, no en la ajena`, r.body.empresa_id === dueno[a.cliente].empresa, `empresa_id=${r.body.empresa_id}`); continue; }
        ajeno(a, v, etiqueta, r, { escritura: true });
      }
    }
  }
  anotar('ajeno', `${intentos} intentos con ids ajenos hechos`, intentos > 0);
  // Los conceptos «HACK» que el servidor creó en la empresa de cada atacante (ver arriba): cada empresa debe tener sólo los de SUS intentos (uno por cada otro cliente), y se borran.
  const hack = sql(`select empresa_id, count(*) from "Concepto" where nombre = 'HACK' group by 1`).map(([e, n]) => [Number(e), Number(n)]);
  for (const [e, n] of hack) {
    const cli = CLIENTES.find((c) => dueno[c].empresa === e);
    anotar('ajeno', `conceptos «HACK» creados en ${cli}: sólo por sus propios intentos (≤ ${CLIENTES.length - 1})`, n <= CLIENTES.length - 1, `${n}`);
  }
  sql(`delete from "Concepto" where nombre = 'HACK' returning id`);


  // Integridad estricta de 1a: ningún intento con ids AJENOS cambió nada (ni siquiera `updated_at`).
  {
    const tras = huella();
    const cambiadas1a = TABLAS_HUELLA.filter((t) => antes[t] !== tras[t]);
    anotar('integridad', 'tras los intentos con ids AJENOS (lectura, escritura y creación) la base no cambió (huella por tabla, con fechas)', cambiadas1a.length === 0, cambiadas1a.length ? `cambiaron: ${cambiadas1a.map((t) => `${t} ${antes[t]} → ${tras[t]}`).join('; ')}` : `${TABLAS_HUELLA.length} tablas iguales`);
  }
  const antesMixtas = huella(true);

  // --- 1a-bis. Contenedor PROPIO + referencia AJENA (mover cosas entre clientes, asignar personas ajenas…) y otras vías de entrada
  const muestraPropia = (c) => {
    const d = dueno[c];
    const residente = Number(sql(`select id from "Usuario" where rol = 'propietario' and complejo_id in (select id from "ComplejoHabitacional" where empresa_id = ${d.empresa}) order by id limit 1`)[0][0]);
    return { unidad: d.unidades[0], residente, estructura: d.estructuras[0], comunicado: d.comunicados[0], medio: d.medios[0], concepto: d.conceptos[0], recibo: d.recibos.at(-1), rc: d.reciboConceptos.at(-1), complejo: d.complejos[0], empresa: d.empresa, recibosMant: parMantenimiento(c) };
  };
  const planExcel = readFileSync(join(HERE, 'block-1-noviembre.xlsx'));
  const basePropia = new Map();
  /** El cuerpo válido de un medio de pago propio (para que el PUT con condominio ajeno no falle por faltar `tipo`), leído de la base. */
  const cuerpoMedio = (a) => {
    const [f] = sql(`select tipo, banco, tipo_cuenta, numero_cuenta, cci, moneda, titular, documento_titular, celular from "MedioPago" where id = ${muestraPropia(a.cliente).medio}`);
    const claves = ['tipo', 'banco', 'tipo_cuenta', 'numero_cuenta', 'cci', 'moneda', 'titular', 'documento_titular', 'celular'];
    return Object.fromEntries(claves.map((k, i) => [k, f[i]]).filter(([, v]) => v !== '' && v != null));
  };
  for (const a of atacantes.filter((x) => x.tipo === 'admin')) {
    const o = muestraPropia(a.cliente);
    for (const ruta of [`/api/unidades/${o.unidad}`, `/api/usuarios/${o.residente}`, `/api/estructuras/${o.estructura}`, ...(o.comunicado ? [`/api/comunicados/${o.comunicado}`] : []), `/api/conceptos/${o.concepto}`, `/api/recibos/${o.recibo}`]) {
      const b = (await a.api.get(ruta)).body;
      basePropia.set(`${a.id}|${ruta}`, JSON.stringify(Object.fromEntries(Object.entries(b ?? {}).filter(([k]) => k !== 'updated_at'))));
    }
    for (const v of CLIENTES.filter((c) => c !== a.cliente)) {
      const d = dueno[v];
      const ajenoUsuario = d.usuarios.at(-1);
      const mixtas = [
        ['PUT unidad propia → complejo ajeno', 'PUT', `/api/unidades/${o.unidad}`, { complejo_id: d.complejos[0] }],
        ['PUT unidad propia → block ajeno', 'PUT', `/api/unidades/${o.unidad}`, { estructura_id: d.estructuras[0] }],
        ['PUT unidad propia → propietario ajeno', 'PUT', `/api/unidades/${o.unidad}`, { propietario_id: ajenoUsuario }],
        ['PUT unidad propia → empresa ajena', 'PUT', `/api/unidades/${o.unidad}`, { empresa_id: d.empresa }],
        ['PUT usuario propio → empresa ajena', 'PUT', `/api/usuarios/${o.residente}`, { empresa_id: d.empresa }],
        ['PUT usuario propio → condominio ajeno', 'PUT', `/api/usuarios/${o.residente}`, { complejo_id: d.complejos[0] }],
        ['PUT usuario propio → rol superadmin', 'PUT', `/api/usuarios/${o.residente}`, { rol: 'superadmin' }],
        ['PUT usuario propio → unidad ajena', 'PUT', `/api/usuarios/${o.residente}`, { unidad_id: d.unidades[0] }],
        ['PUT block propio → condominio ajeno', 'PUT', `/api/estructuras/${o.estructura}`, { complejo_id: d.complejos[0] }],
        ...(o.comunicado ? [['PUT comunicado propio → condominio ajeno', 'PUT', `/api/comunicados/${o.comunicado}`, { complejo_id: d.complejos[0] }]] : []),
        ...(o.medio ? [['PUT medio de pago propio → condominio ajeno', 'PUT', `/api/medios-pago/${o.medio}`, { ...cuerpoMedio(a), complejo_id: d.complejos[0] }]] : []),
        ['PUT concepto propio → empresa ajena', 'PUT', `/api/conceptos/${o.concepto}`, { empresa_id: d.empresa }],
        ['PUT recibo propio → condominio ajeno', 'PUT', `/api/recibos/${o.recibo}`, { complejo_id: d.complejos[0], empresa_id: d.empresa }],
        ['POST comunicado propio → departamentos ajenos', 'POST', '/api/comunicados', { complejo_id: o.complejo, titulo: 'HACK', cuerpo: 'HACK', unidades: [d.unidades[0]] }],
        ['POST recibo propio → block ajeno', 'POST', '/api/recibos', { complejo_id: o.complejo, estructura_id: d.estructuras[0], mes: 12, anio: 2026, fecha_emision: '2026-12-01', fecha_vencimiento: '2026-12-15', conceptos: [] }],
        ['POST recibo propio → concepto ajeno', 'POST', '/api/recibos', { complejo_id: o.complejo, estructura_id: o.estructura, mes: 12, anio: 2026, fecha_emision: '2026-12-01', fecha_vencimiento: '2026-12-15', conceptos: [{ concepto_id: d.conceptos[0], monto: '10.00' }] }],
        ['POST cargo en recibo propio → unidad ajena', 'POST', '/api/recibo-concepto-unidades', { recibo_concepto_id: o.rc, unidad_id: d.unidades[0], monto: 1 }],
        ['POST usuario propio-condominio → unidad ajena', 'POST', '/api/usuarios', { nombre: 'Hack', email: `hack2.${a.cliente}.${v}@simulacion.example`, rol: 'propietario', complejo_id: o.complejo, unidad_id: d.unidades[0] }],
        ['POST junta propia → block ajeno', 'POST', '/api/juntas', { complejo_id: o.complejo, estructura_id: d.estructuras[0], desde: '2026-11-01', miembros: [] }],
        ['POST junta propia → miembro ajeno', 'POST', '/api/juntas', { complejo_id: o.complejo, estructura_id: o.estructura, desde: '2026-11-01', miembros: [{ usuario_id: ajenoUsuario, cargo: 'presidente' }] }],
        ['POST pago en recibo propio → unidad ajena', 'POST', `/api/recibos/${o.recibosMant.reciboId}/mantenimientos/${d.unidades[0]}/pagos`, { metodo_pago: 'efectivo' }],
        ['POST impersonar a un usuario ajeno', 'POST', '/api/impersonacion', { usuario_id: CRED.clientes[v].admins ? sql(`select id from "Usuario" where email = '${CRED.clientes[v].admins[0].email}'`)[0][0] * 1 : 0, motivo: 'prueba de separación' }],
      ];
      for (const [etiqueta, metodo, ruta, cuerpo] of mixtas) {
        const r = await a.api.pedir(metodo, ruta, { json: cuerpo });
        // Un PUT sobre un recurso PROPIO que trae un campo ajeno puede responder 200 si el servidor IGNORA ese campo (no está en lo editable). Eso es correcto SI el campo no se aplicó:
        // se vuelve a leer el recurso y debe quedar idéntico (salvo `updated_at`). Si el campo se aplicó, es una brecha.
        if (metodo === 'PUT' && r.status >= 200 && r.status < 300) {
          intentos++;
          const antesObj = basePropia.get(`${a.id}|${ruta}`);
          const despues = await a.api.get(ruta);
          const quitar = (b) => JSON.stringify(Object.fromEntries(Object.entries(b ?? {}).filter(([k]) => k !== 'updated_at')));
          const igual = antesObj !== undefined && quitar(despues.body) === antesObj;
          anotar('ajeno', `${a.id} → ${etiqueta} (cliente ${v}): 200 pero el campo ajeno NO se aplicó (el recurso queda igual)`, igual, igual ? '' : `el recurso cambió: ${quitar(despues.body).slice(0, 160)}`);
          if (igual) { const e = ((extra.ignorados ??= {})[etiqueta] = ((extra.ignorados ??= {})[etiqueta] ?? 0) + 1); void e; }
          continue;
        }
        ajeno(a, v, etiqueta, r, { escritura: true });
      }
      // Importar un Excel de recibos hacia un condominio ajeno.
      const f = new FormData();
      f.append('complejo_id', String(d.complejos[0]));
      f.append('archivo', new Blob([planExcel], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'recibos.xlsx');
      ajeno(a, v, 'POST Excel de recibos a condominio ajeno', await a.api.pedir('POST', '/api/recibos/excel', { form: f }), { escritura: true });
      // El Excel de «crear faltantes» / vista de mora con condominio ajeno
      const f2 = new FormData();
      f2.append('complejo_id', String(d.complejos[0]));
      f2.append('archivo', new Blob([planExcel], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'recibos.xlsx');
      ajeno(a, v, 'POST vista previa de mora (Excel) ajena', await a.api.pedir('POST', '/api/recibos/excel/vista-mora', { form: f2 }), { escritura: true });
    }
  }
  // Los demás atacantes (junta y vecino) también intentan impersonar y usar el Excel: sólo 403.
  for (const a of atacantes.filter((x) => x.tipo !== 'admin')) {
    const r = await a.api.post('/api/impersonacion', { usuario_id: dueno[CLIENTES.find((c) => c !== a.cliente)].usuarios[0], motivo: 'prueba de separación' });
    anotar('privilegios', `${a.id} no puede «Entrar como» otra persona (sólo superadmin)`, r.status === 403, `${r.status}`);
  }
  {
    const r = await S.admin.A.post('/api/impersonacion', { usuario_id: dueno.A.usuarios[0], motivo: 'prueba de separación' });
    anotar('privilegios', 'admin A no puede «Entrar como» ni a alguien de SU empresa (sólo superadmin)', r.status === 403, `${r.status}`);
  }
  // Sesión y CSRF
  {
    const sin = await fetch(`${BASE}/api/unidades`).then((r) => r.status);
    anotar('sesión', 'sin cookie: /api/unidades → 401', sin === 401, `${sin}`);
    const falso = await fetch(`${BASE}/api/unidades`, { headers: { cookie: 'house_sesion=abc.def' } }).then((r) => r.status);
    anotar('sesión', 'cookie inventada → 401', falso === 401, `${falso}`);
    const a = S.admin.A;
    const sinCsrf = await fetch(`${BASE}/api/comunicados`, { method: 'POST', headers: { cookie: `house_sesion=${a.cookie}`, 'content-type': 'application/json' }, body: JSON.stringify({ complejo_id: dueno.A.complejos[0], titulo: 'x', cuerpo: 'x' }) }).then((r) => r.status);
    anotar('sesión', 'escritura con cookie válida pero SIN token CSRF → rechazada', sinCsrf === 403, `${sinCsrf}`);
    const csrfAjeno = await fetch(`${BASE}/api/comunicados`, { method: 'POST', headers: { cookie: `house_sesion=${a.cookie}`, 'x-csrf-token': S.admin.B.csrf, 'content-type': 'application/json' }, body: JSON.stringify({ complejo_id: dueno.A.complejos[0], titulo: 'x', cuerpo: 'x' }) }).then((r) => r.status);
    anotar('sesión', 'escritura con el token CSRF de OTRA sesión → rechazada', csrfAjeno === 403, `${csrfAjeno}`);
    const tokenEnUrl = await fetch(`${BASE}/api/unidades?token=${a.cookie}`).then((r) => r.status);
    anotar('sesión', 'la cookie de sesión en la URL no autentica', tokenEnUrl === 401, `${tokenEnUrl}`);
  }

  // --- 1b. Listados: ninguna fila ajena (todas las páginas para la administración; muestra para junta y vecino)
  const LISTAS = [['recibos', '/api/recibos', 'recibos'], ['pagos', '/api/pagos', 'pagos'], ['unidades', '/api/unidades', 'unidades'], ['usuarios', '/api/usuarios', 'usuarios'], ['comunicados', '/api/comunicados', 'comunicados'], ['conceptos', '/api/conceptos', 'conceptos'],
    ['estructuras', '/api/estructuras', 'estructuras'], ['pisos', '/api/pisos', 'pisos'], ['recibo-conceptos', '/api/recibo-conceptos', 'reciboConceptos'], ['cargos', '/api/recibo-concepto-unidades', 'cargos'], ['complejos', '/api/complejos', 'complejos'], ['reservas', '/api/reservas', 'reservas'], ['empresas', '/api/empresas', null]];
  let filasRevisadas = 0;
  for (const a of atacantes.filter((x) => x.tipo !== 'vecino')) {
    for (const [nombre, ruta, clave] of LISTAS) {
      const maxPag = a.tipo === 'admin' ? 500 : 10;
      let pagina = 1, total = 0, ajenas = [];
      for (; pagina <= maxPag; pagina++) {
        const r = await a.api.get(`${ruta}?pageSize=100&page=${pagina}`);
        if (r.status === 403 || r.status === 404) break; // la junta no ve esa lista: también sirve
        if (r.status !== 200) { anotar('listas', `${a.id} lista ${nombre}`, false, `status ${r.status}`); break; }
        const items = r.body?.items ?? [];
        total += items.length;
        for (const it of items) {
          if (clave === null) { if (a.tipo === 'admin' && it.id !== dueno[a.cliente].empresa) ajenas.push(it.id); continue; } // /api/empresas: sólo la propia
          if (!dueno[a.cliente].sets[clave].has(it.id)) ajenas.push(it.id);
        }
        if (items.length < 100) break;
      }
      filasRevisadas += total;
      anotar('listas', `${a.id} lista ${nombre}: ${total} filas, ninguna ajena`, ajenas.length === 0, ajenas.length ? `ids ajenos: ${ajenas.slice(0, 5).join(',')} (${ajenas.length})` : '');
    }
  }
  // Listas del vecino: sólo lo suyo.
  for (const a of atacantes.filter((x) => x.tipo === 'vecino')) {
    const mis = new Set(sql(`select id from "Unidad" where propietario_id = ${a.api.usuario.id} or inquilino_id = ${a.api.usuario.id}`).map((f) => Number(f[0])));
    const r = await a.api.get('/api/me/unidades');
    anotar('listas', `${a.id} /me/unidades sólo las suyas`, r.status === 200 && (r.body.items ?? []).every((u) => mis.has(u.id)), `${(r.body?.items ?? []).length} filas`);
    const c = await a.api.get('/api/me/cargos?pageSize=100');
    anotar('listas', `${a.id} /me/cargos sólo de sus unidades`, c.status === 200 && (c.body.items ?? []).every((x) => mis.has(x.unidad_id)), `${(c.body?.items ?? []).length} filas`);
    for (const ruta of ['/api/unidades', '/api/usuarios', '/api/recibos', '/api/pagos', '/api/reportes/morosidad', '/api/empresas', '/api/complejos']) {
      const r = await a.api.get(ruta);
      anotar('listas', `${a.id} (vecino) no entra a ${ruta}`, r.status === 403 || r.status === 404, `${r.status}`);
    }
  }

  // --- 1c. Búsqueda: un nombre / correo / código de OTRO cliente no aparece
  for (const a of atacantes.filter((x) => x.tipo === 'admin')) {
    const v = CLIENTES.find((c) => c !== a.cliente);
    const ajeno = sql(`select email, nombre from "Usuario" where id = ${dueno[v].usuarios.at(-1)}`)[0];
    for (const [ruta, termino] of [['/api/usuarios', ajeno[0]], ['/api/usuarios', ajeno[1].split(' ')[0]], ['/api/recibos', 'Mantenimiento'], ['/api/unidades', 'B01'], ['/api/comunicados', 'Corte']]) {
      const r = await a.api.get(`${ruta}?q=${encodeURIComponent(termino)}&pageSize=100`);
      const items = r.body?.items ?? [];
      const clave = ruta.includes('usuarios') ? 'usuarios' : ruta.includes('recibos') ? 'recibos' : ruta.includes('unidades') ? 'unidades' : 'comunicados';
      anotar('búsqueda', `${a.id} busca «${termino.slice(0, 18)}» en ${ruta}: sólo lo suyo`, r.status === 200 && items.every((it) => dueno[a.cliente].sets[clave].has(it.id)), `${items.length} filas`);
    }
  }

  // --- 1d. Reportes y totales: lo que se cuenta es sólo de SU cliente
  for (const a of atacantes.filter((x) => x.tipo === 'admin')) {
    const d = dueno[a.cliente];
    const r = await a.api.get('/api/dashboard/resumen');
    if (r.status !== 200) { anotar('totales', `${a.id} dashboard`, false, `${r.status}`); continue; }
    const bloques = r.body.por_torre ?? [];
    anotar('totales', `${a.id} dashboard: todos sus blocks son suyos`, bloques.every((b) => d.sets.estructuras.has(b.estructura_id)), `${bloques.length} blocks`);
    const m = await a.api.get('/api/reportes/morosidad?pageSize=100');
    if (m.status === 200) {
      const filas = m.body.items ?? [];
      anotar('totales', `${a.id} morosidad: todas las unidades son suyas`, filas.every((f) => d.sets.unidades.has(f.unidad?.id)), `${filas.length} filas (de ${m.body.total ?? '?'})`);
    } else anotar('totales', `${a.id} morosidad (sin acceso por plan)`, m.status === 403, `${m.status}`);
  }
  // Excel / consolidado propio sí funciona (control positivo) y el ajeno no.
  for (const c of ['A', 'J4']) {
    const rec = dueno[c].recibos.at(-1);
    const x = await S.admin[c].get(`/api/recibos/${rec}/consolidado/excel`, { crudo: true });
    anotar('excel', `${c}: consolidado Excel propio se descarga`, x.status === 200 && x.bytes > 2000, `${x.status} ${x.bytes} bytes`);
  }

  // --- 1e. Dentro de un mismo cliente: la junta de un block no toca otro block (empresa A, Los Cedros)
  const tesA = S.tesorero.A;
  if (tesA) {
    const miBloque = sql(`select estructura_id from "Usuario" where id = ${tesA.usuario.id}`)[0][0];
    const [otro] = sql(`select r.id, u.id, e.id from "Recibo" r join "Estructura" e on e.id = r.estructura_id join "Unidad" u on u.estructura_id = e.id where r.empresa_id = ${dueno.A.empresa} and r.mes = 10 and e.complejo_id = (select complejo_id from "Usuario" where id = ${tesA.usuario.id}) and e.id <> ${miBloque} order by r.id, u.id limit 1`);
    for (const [etiqueta, ruta] of [['recibo de otro block', `/api/recibos/${otro[0]}/mantenimientos`], ['mantenimiento de otro block', `/api/recibos/${otro[0]}/mantenimientos/${otro[1]}`], ['cierre de otro block', `/api/cierres/block/${otro[2]}`]]) {
      const r = await tesA.get(ruta);
      anotar('mismo-cliente', `tesorero del block ${miBloque} → ${etiqueta}`, r.status === 403 || r.status === 404, `${r.status}`);
    }
    const w = await tesA.post(`/api/recibos/${otro[0]}/mantenimientos/${otro[1]}/pagos`, { metodo_pago: 'efectivo' });
    anotar('mismo-cliente', 'tesorero de un block NO registra pago en otro block', w.status === 403 || w.status === 404, `${w.status}`);
  }
  // Vecino vs. vecino del MISMO condominio.
  for (const c of ['A', 'J4']) {
    const v = S.vecino[c];
    if (!v) continue;
    const mias = sql(`select id from "Unidad" where propietario_id = ${v.usuario.id} or inquilino_id = ${v.usuario.id}`).map((f) => Number(f[0]));
    const [otra] = sql(`select u.id, r.id from "Unidad" u join "Recibo" r on r.estructura_id = u.estructura_id and r.mes = 10 where u.complejo_id = (select complejo_id from "Usuario" where id = ${v.usuario.id}) and u.id not in (${mias.join(',') || 0}) order by u.id limit 1`);
    const r = await v.get(`/api/me/mantenimientos/${otra[1]}/${otra[0]}`);
    anotar('mismo-cliente', `vecino ${c} → mantenimiento de otro vecino del mismo condominio`, r.status === 403 || r.status === 404, `${r.status}`);
    const w = await v.pedir('POST', `/api/me/mantenimientos/${otra[1]}/${otra[0]}/pagos`, { form: formularioPago({ metodo_pago: 'yape' }, 1) });
    anotar('mismo-cliente', `vecino ${c} NO paga la unidad de otro vecino`, w.status === 403 || w.status === 404, `${w.status}`);
  }

  // --- 1f. Superadmin ve todo
  const su = S.super;
  const cx = await su.get('/api/complejos?pageSize=100');
  anotar('superadmin', 've los 14 condominios de todos los clientes', cx.status === 200 && (cx.body.items ?? []).length === CLIENTES.reduce((n, c) => n + dueno[c].complejos.length, 0), `${(cx.body?.items ?? []).length} condominios`);
  const em = await su.get('/api/empresas?pageSize=100');
  anotar('superadmin', 've las 8 empresas/juntas', em.status === 200 && (em.body.items ?? []).length === CLIENTES.length, `${(em.body?.items ?? []).length}`);
  const su2 = await su.get('/api/comercial/suscripciones?pageSize=100');
  anotar('superadmin', 've las suscripciones de los 14 condominios', su2.status === 200 && (su2.body.items ?? []).length === 14, `${(su2.body?.items ?? []).length}`);
  // La administración común NO entra a lo del superadmin.
  for (const [etiqueta, ruta] of [['suscripciones', '/api/comercial/suscripciones'], ['catálogo comercial', '/api/comercial/catalogo'], ['auditoría', '/api/auditoria'], ['bandeja de contacto', '/api/comercial/contactos']]) {
    const r = await S.admin.A.get(ruta);
    anotar('privilegios', `admin A no entra a ${etiqueta} (sólo superadmin)`, r.status === 403 || r.status === 404, `${r.status}`);
  }

  // --- 1g. La base no cambió (sin contar `updated_at`: un PUT que se ignora puede tocarlo)
  const despues = huella(true);
  const cambiadas = TABLAS_HUELLA.filter((t) => antesMixtas[t] !== despues[t]);
  anotar('integridad', 'tras los intentos «contenedor propio + referencia ajena», los listados, búsquedas y herramientas, ningún dato cambió (huella por tabla, sin `updated_at`)', cambiadas.length === 0, cambiadas.length ? `cambiaron: ${cambiadas.map((t) => `${t} ${antesMixtas[t]} → ${despues[t]}`).join('; ')}` : `${TABLAS_HUELLA.length} tablas iguales`);
  extra.separacion = { intentos, filasRevisadas, debiles: extra.debiles ?? 0, tablasIguales: TABLAS_HUELLA.length - cambiadas.length };
}

// ================================================================ FASE 2: cada tipo de cliente funciona
async function faseTipos(S) {
  console.log('\n== Cada tipo de cliente ==');
  const A = S.admin.A;
  // Empresa grande (A): selector de condominio, dashboard, morosidad, cierre por block, consolidado.
  const cs = await A.get('/api/complejos?pageSize=100');
  anotar('empresa grande A', 'el selector lista sus 4 condominios', cs.status === 200 && cs.body.items.length === 4, `${cs.body?.items?.map((c) => c.nombre).join(' | ')}`);
  for (const cx of dueno.A.complejos) {
    const d = await A.get(`/api/dashboard/resumen?complejo_id=${cx}`);
    anotar('empresa grande A', `dashboard del condominio ${cx}`, d.status === 200 && (d.body.por_torre ?? []).length > 0, `${d.status} ${d.ms} ms`);
  }
  const mo = await A.get(`/api/reportes/morosidad?complejo_id=${dueno.A.complejos[0]}&pageSize=100`);
  const esperados = Number(sql(`select count(distinct rcu.unidad_id) from "ReciboConceptoUnidad" rcu join "ReciboConcepto" rc on rc.id = rcu.recibo_concepto_id join "Recibo" r on r.id = rc.recibo_id where r.complejo_id = ${dueno.A.complejos[0]} and rcu.estado_pago = 'pendiente' and r.fecha_vencimiento < now()`)[0][0]);
  anotar('empresa grande A', 'morosidad de Los Cedros cuadra con la base (unidades con cargos vencidos)', mo.status === 200 && mo.body.total === esperados, `API ${mo.body?.total} vs base ${esperados}`);
  const ci = await A.get(`/api/cierres?complejo_id=${dueno.A.complejos[0]}`);
  anotar('empresa grande A', 'cierre del mes lista los 14 blocks', ci.status === 200 && (ci.body.blocks ?? []).length === 14, `${(ci.body?.blocks ?? []).length} blocks`);
  const cb = await A.get(`/api/cierres/block/${dueno.A.estructuras[0]}`);
  anotar('empresa grande A', 'cierre del mes de un block abre', cb.status === 200, `${cb.status}`);
  const cc = await A.get(`/api/cierres/central?complejo_id=${dueno.A.complejos[0]}`);
  anotar('empresa grande A', 'cierre de la junta central (consolidado de aportes) abre', cc.status === 200, `${cc.status}`);
  const rec = dueno.A.recibos.at(-1);
  const co = await A.get(`/api/recibos/${rec}/consolidado`);
  anotar('empresa grande A', 'consolidado del recibo abre', co.status === 200, `${co.status} ${co.ms} ms`);
  const ap = await A.get(`/api/cierres/aportes?complejo_id=${dueno.A.complejos[0]}`);
  anotar('empresa grande A', 'aportes de los blocks a la central', ap.status === 200, `${ap.status}`);
  // Una cuenta de A puede entrar a TODOS sus condominios (selector), y los tres admins de A ven lo mismo.
  const A2 = S.admin2?.A;
  if (A2) { const c2 = await A2.get('/api/complejos?pageSize=100'); anotar('empresa grande A', 'el segundo admin de A ve los mismos 4 condominios', c2.status === 200 && c2.body.items.length === 4); }
  // Personal: seguridad/mantenimiento de A no ven cobranza.
  if (S.personal.A) {
    const p = await S.personal.A.get('/api/pagos');
    const r = await S.personal.A.get('/api/recibos');
    anotar('personal', 'el personal (seguridad) no ve pagos ni recibos', [p.status, r.status].every((s) => s === 403 || (s === 200 && (p.body?.items ?? []).length === 0)), `pagos ${p.status}, recibos ${r.status}`);
  }

  // Junta de 1 block (J4, Pro): todo desde la junta — emitir, registrar/validar pago, cierre.
  const J = S.admin.J4;
  const jc = dueno.J4.complejos[0];
  const nuevo = await J.post('/api/recibos', { complejo_id: jc, mes: 11, anio: 2026, fecha_emision: '2026-11-01', fecha_vencimiento: '2026-11-15', conceptos: sql(`select id, nombre from "Concepto" where empresa_id = ${dueno.J4.empresa} and nombre not ilike '%multa%' order by id`).map(([id], i) => ({ concepto_id: Number(id), monto: (30 + i * 5).toFixed(2) })) });
  anotar('junta 1 block J4', 'la junta emite el recibo de noviembre', nuevo.status === 201 || nuevo.status === 409, `${nuevo.status}${nuevo.status === 409 ? ' (ya existía: corrida anterior)' : ` · ${nuevo.ms} ms`}`);
  if (nuevo.status === 201) {
    const nCargos = Number(sql(`select count(*) from "ReciboConceptoUnidad" rcu join "ReciboConcepto" rc on rc.id = rcu.recibo_concepto_id where rc.recibo_id = ${nuevo.body.id}`)[0][0]);
    const moras = Number(sql(`select count(*) from "ReciboConcepto" where recibo_id = ${nuevo.body.id} and es_recargo`)[0][0]);
    anotar('junta 1 block J4', 'el recibo de noviembre trae un cargo por departamento y concepto (32 dptos)', nCargos >= 32 * 3, `${nCargos} cargos, ${moras} concepto(s) de mora`);
    extra.noviembreJ4 = { recibo: nuevo.body.id, cargos: nCargos, moraLineas: moras, avisos: nuevo.body.advertencias ?? [] };
  }
  const pv = pagoDe('J4', 'por_validar');
  if (pv) {
    const tes = S.tesorero.J4;
    const conf = await tes.put(`/api/pagos/${pv}/conformidad`);
    anotar('junta 1 block J4', 'el tesorero da la conformidad del pago por validar', conf.status === 200 || (conf.status === 403 && /propio pago/i.test(conf.texto)), `${conf.status} ${conf.status !== 200 ? conf.texto.slice(0, 120) : ''}`);
    const val = await J.patch(`/api/pagos/${pv}/validacion`, { estado: 'validado' });
    anotar('junta 1 block J4', 'la cuenta de la junta valida el pago', val.status === 200 || val.status === 409, `${val.status} ${val.status !== 200 ? val.texto.slice(0, 120) : ''}`);
  } else anotar('junta 1 block J4', 'hay un pago por validar en J4 para probar', false, 'no hay pago por validar en J4: vuelve a sembrar');
  const pr = parMantenimiento('J4');
  const pm = await S.tesorero.J4.get(`/api/recibos/${pr.reciboId}/mantenimientos/${pr.unidadId}`);
  anotar('junta 1 block J4', 'el tesorero ve el mantenimiento de su block', pm.status === 200, `${pm.status}`);
  const cj = await J.get(`/api/cierres?complejo_id=${jc}`);
  anotar('junta 1 block J4', 'cierre del mes de la junta abre', cj.status === 200, `${cj.status}`);
  const jj = await S.tesorero.J4.get('/api/cierres');
  anotar('junta 1 block J4', 'el tesorero abre el cierre de su block', jj.status === 200, `${jj.status}`);
  // Junta única (J1/J3/J5): el menú no trae aportes ni cierre central.
  for (const c of ['J1', 'J3', 'J5']) {
    if (!S.tesorero[c]) { anotar(`junta única ${c}`, 'tiene tesorero para probar', false, 'el seed no dejó tesorero'); continue; }
    const me = await S.tesorero[c].get('/api/auth/me');
    anotar(`junta única ${c}`, 'login/me marca junta_unica = true', me.status === 200 && me.body.junta_unica === true, `junta_unica=${me.body?.junta_unica}`);
  }
  const me4 = await S.tesorero.J4.get('/api/auth/me');
  anotar('junta 1 block J4', 'J4 (junta por block) no es «junta única»', me4.body?.junta_unica === false, `junta_unica=${me4.body?.junta_unica}`);

  // Vecino: ve su deuda y paga con voucher.
  const V = S.vecino.J4;
  const mm = await V.get('/api/me/mantenimientos');
  const deuda = (mm.body?.items ?? []).filter((x) => x.estado !== 'pagado' && Number(x.saldo ?? x.total ?? 0) >= 0);
  anotar('vecino J4', 've sus mantenimientos y su deuda', mm.status === 200 && (mm.body.items ?? []).length > 0, `${(mm.body?.items ?? []).length} mantenimientos, ${deuda.length} abiertos`);
  const abierto = (mm.body?.items ?? []).find((x) => x.estado === 'pendiente' || x.estado === 'vencido' || x.estado === 'parcial');
  if (abierto) {
    const pg = await V.pedir('POST', `/api/me/mantenimientos/${abierto.recibo_id}/${abierto.unidad_id}/pagos`, { form: formularioPago({ metodo_pago: 'yape', referencia: `E2E-${Date.now().toString(36)}` }, 77) });
    anotar('vecino J4', 'paga con voucher: queda por validar', pg.status === 201, `${pg.status} ${pg.status !== 201 ? pg.texto.slice(0, 140) : ''}`);
  } else anotar('vecino J4', 'tiene un mantenimiento abierto para pagar', false, `estados: ${[...new Set((mm.body?.items ?? []).map((x) => x.estado))].join(',')}`);

  // Solo lectura (J2: Gratis vencido): ve todo, no registra nada.
  const J2 = S.admin.J2;
  const j2c = dueno.J2.complejos[0];
  const eo = await J2.get('/api/comercial/estado-operativo');
  anotar('solo lectura J2', 'estado-operativo marca solo_lectura', eo.status === 200 && eo.body.condominios?.[0]?.solo_lectura === true, JSON.stringify(eo.body?.condominios?.[0] ?? {}).slice(0, 160));
  for (const [etiqueta, ruta] of [['dashboard', `/api/dashboard/resumen?complejo_id=${j2c}`], ['recibos', `/api/recibos?complejo_id=${j2c}`], ['pagos', '/api/pagos'], ['unidades', '/api/unidades'], ['cierre', `/api/cierres?complejo_id=${j2c}`]]) {
    const r = await J2.get(ruta);
    anotar('solo lectura J2', `puede VER ${etiqueta}`, r.status === 200, `${r.status}`);
  }
  const e1 = await J2.post('/api/recibos', { complejo_id: j2c, mes: 11, anio: 2026, fecha_emision: '2026-11-01', fecha_vencimiento: '2026-11-15', conceptos: [] });
  const bloqueoSL = (r) => r.status === 409 && r.body?.code === 'SOLO_LECTURA';
  anotar('solo lectura J2', 'NO puede emitir un recibo (409 SOLO_LECTURA con el mensaje de solo lectura)', bloqueoSL(e1) && /solo lectura/i.test(e1.texto), `${e1.status} ${e1.texto.slice(0, 120)}`);
  const m2 = parMantenimiento('J2');
  const e2 = await J2.post(`/api/recibos/${m2.reciboId}/mantenimientos/${m2.unidadId}/pagos`, { metodo_pago: 'efectivo' });
  anotar('solo lectura J2', 'NO puede registrar un pago (409 SOLO_LECTURA)', bloqueoSL(e2), `${e2.status} ${e2.texto.slice(0, 100)}`);
  const e3 = await J2.post('/api/comunicados', { complejo_id: j2c, titulo: 'prueba', cuerpo: 'prueba' });
  anotar('solo lectura J2', 'NO puede publicar un comunicado (409 SOLO_LECTURA)', bloqueoSL(e3), `${e3.status}`);
  const propio2 = (((await S.vecino.J2.get('/api/me/mantenimientos')).body?.items ?? [])[0]) ?? { recibo_id: m2.reciboId, unidad_id: m2.unidadId };
  const e4 = await S.vecino.J2.pedir('POST', `/api/me/mantenimientos/${propio2.recibo_id}/${propio2.unidad_id}/pagos`, { form: formularioPago({ metodo_pago: 'yape' }, 5) });
  anotar('solo lectura J2', 'el vecino de J2 NO paga (409 SOLO_LECTURA, mensaje para el vecino)', bloqueoSL(e4) && /administraci/i.test(e4.texto), `${e4.status} ${e4.texto.slice(0, 100)}`);
  for (const [etiqueta, metodo, ruta, cuerpo] of [['crear una unidad', 'POST', '/api/unidades', { codigo: 'SL-1', tipo: 'departamento', complejo_id: j2c, estructura_id: dueno.J2.estructuras[0] }], ['crear un área común', 'POST', '/api/areas-comunes', { complejo_id: j2c, nombre: 'SL', hora_apertura: '09:00', hora_cierre: '20:00' }], ['validar un pago', 'PATCH', `/api/pagos/${pagoDe('J2', 'por_validar') ?? 0}/validacion`, { estado: 'rechazado', motivo: 'prueba de solo lectura' }]]) {
    if (/\/0\//.test(ruta)) continue;
    const r = await J2.pedir(metodo, ruta, { json: cuerpo });
    anotar('solo lectura J2', `NO puede ${etiqueta} (409 SOLO_LECTURA)`, bloqueoSL(r), `${r.status} ${r.texto.slice(0, 80)}`);
  }
  const v2 = await S.vecino.J2.get('/api/me/mantenimientos');
  anotar('solo lectura J2', 'el vecino de J2 sí ve sus recibos', v2.status === 200, `${v2.status}`);
  const su = await S.super.post('/api/comunicados', { complejo_id: j2c, titulo: 'prueba superadmin', cuerpo: 'prueba' });
  anotar('solo lectura J2', 'el superadmin no queda en solo lectura (puede escribir)', su.status === 201 || su.status === 200, `${su.status}`);
  if (su.body?.id) await S.super.post(`/api/comunicados/${su.body.id}/archivar`, {}); // no hay DELETE de comunicados: se archiva para no dejar una prueba publicada
}

// ================================================================ FASE 3: planes y facturación de Torre
async function fasePlanes(S) {
  console.log('\n== Planes y facturación ==');
  const cfg = sql(`select igv_tasa from "ConfiguracionComercial" where id = 1`)[0];
  const igv = Number(cfg[0]);
  const planes = Object.fromEntries(sql(`select clave, precio_por_unidad, coalesce(unidades_minimas,0), igv_incluido, array_to_string(modulos_incluidos, ',') from "PlanComercial"`).map(([k, p, min, incl, mods]) => [k, { precio: Number(p), min: Number(min), incluido: incl === 't', mods: mods.split(',').filter(Boolean) }]));
  extra.precios = Object.fromEntries(Object.entries(planes).map(([k, p]) => [k, { precio_unidad_base: p.precio, minimo_unidades: p.min }]));
  extra.igv = igv;
  const facturacion = [];
  for (const c of CLIENTES) {
    const api = S.admin[c];
    const mp = await api.get('/api/comercial/mi-plan');
    if (mp.status !== 200) { anotar('planes', `${c} Mi plan abre`, false, `${mp.status}`); continue; }
    let total = 0;
    for (const cd of mp.body.condominios) {
      const plan = cd.plan.clave;
      const p = planes[plan] ?? planes.gratis;
      const unid = cd.unidades_facturables;
      const base = p.precio > 0 ? Math.max(unid, p.min) * p.precio : 0;
      const esperado = Math.round(base * (1 + igv) * 100) / 100;
      const api$ = Number(cd.cotizacion?.total_mes ?? 0);
      // Un plan que no se paga (Gratis, Cortesía) cotiza 0; la prueba de Pro cuenta como Pro para la cotización.
      const cuenta = plan === 'gratis' || plan === 'cortesia' ? 0 : esperado;
      anotar('planes', `${c} · ${cd.complejo}: Mi plan cotiza lo mismo que la fórmula independiente (plan ${plan}, ${unid} dptos)`, Math.abs(api$ - cuenta) < 0.011, `API S/ ${api$.toFixed(2)} vs fórmula S/ ${cuenta.toFixed(2)}`);
      total += api$;
      facturacion.push({ cliente: c, condominio: cd.complejo, plan, estado: cd.estado, en_prueba: cd.en_prueba, solo_lectura: cd.solo_lectura, unidades: unid, cobradas: cd.unidades_cobradas, total_mes: api$ });
    }
    extra[`total_${c}`] = Math.round(total * 100) / 100;
  }
  extra.facturacion = facturacion;
  extra.totalTorreMes = Math.round(facturacion.reduce((s, f) => s + f.total_mes, 0) * 100) / 100;
  // El superadmin ve los mismos totales (control cruzado, sin pasar por cada cliente).
  const sus = await S.super.get('/api/comercial/suscripciones?pageSize=100');
  if (sus.status === 200) {
    const sumaSuper = (sus.body.items ?? []).reduce((s, x) => s + Number(x.cotizacion?.total_mes ?? 0), 0);
    anotar('planes', 'el total que ve el superadmin en Suscripciones coincide con la suma de Mi plan de cada cliente', Math.abs(sumaSuper - extra.totalTorreMes) < 0.05, `superadmin S/ ${sumaSuper.toFixed(2)} vs suma de clientes S/ ${extra.totalTorreMes.toFixed(2)}`);
  }

  // Qué permite y bloquea cada plan. Pro/Administradora: todo. Gratis/Básico: sin WhatsApp, IA, asistente, reportes ni conciliación; con mora sólo desde Pro.
  const caps = (c) => CRED.clientes[c].plan; // sin uso
  void caps;
  const planDe = {};
  for (const c of CLIENTES) { const r = await S.admin[c].get('/api/comercial/mi-plan'); planDe[c] = r.body.condominios[0]; }
  // Cada puerta devuelve { bloqueado, status, nota }. WhatsApp: el módulo se lee de `sin_modulo_whatsapp` (Notificaciones › canales) y de `whatsapp_plan` (ficha del condominio);
  // el chat del asistente: 403 MODULO_NO_ACTIVO. En local no hay IA ni Evolution, así que «puede» se prueba como «no bloqueado por el plan» (ver informe).
  const puertas = [
    ['IA que valida vouchers (POST /pagos/:id/evaluacion)', 'ia_vouchers', async (c) => { const pv = pagoDe(c, 'por_validar') ?? pagoDe(c, 'rechazado'); if (!pv) return null; const r = await S.admin[c].post(`/api/pagos/${pv}/evaluacion`, {}); return { bloqueado: (r.status === 403 && /MODULO_NO_ACTIVO|plan/i.test(r.texto)) || (r.status === 409 && r.body?.code === 'SOLO_LECTURA'), status: r.status, nota: r.texto.slice(0, 70) }; }],
    ['asistente con IA (POST /ai-chat)', 'asistente', async (c) => { const r = await S.admin[c].post('/api/ai-chat', { message: 'hola' }); return { bloqueado: r.status === 403 && r.body?.code === 'MODULO_NO_ACTIVO', status: r.status, nota: r.texto.slice(0, 70) }; }],
    ['avisos por WhatsApp (canales: sin_modulo_whatsapp)', 'whatsapp_avisos', async (c) => { const r = await S.admin[c].get('/api/notificaciones/canales'); return { bloqueado: r.body?.sin_modulo_whatsapp === true, status: r.status, nota: `sin_modulo_whatsapp=${r.body?.sin_modulo_whatsapp}` }; }],
    ['avisos por WhatsApp (ficha del condominio: whatsapp_plan)', 'whatsapp_avisos', async (c) => { const r = await S.admin[c].get(`/api/complejos/${dueno[c].complejos[0]}`); return { bloqueado: r.body?.whatsapp_plan === false, status: r.status, nota: `whatsapp_plan=${r.body?.whatsapp_plan}` }; }],
    ['reporte de morosidad', 'reportes', async (c) => { const r = await S.admin[c].get(`/api/reportes/morosidad?complejo_id=${dueno[c].complejos[0]}`); return { bloqueado: r.status === 403, status: r.status, nota: r.texto.slice(0, 70) }; }],
    ['rendición de cuentas', 'reportes', async (c) => { const r = await S.admin[c].get(`/api/reportes/rendicion?complejo_id=${dueno[c].complejos[0]}`); return { bloqueado: r.status === 403, status: r.status, nota: r.texto.slice(0, 70) }; }],
    ['conciliación bancaria', 'conciliacion', async (c) => { const r = await S.admin[c].get('/api/conciliacion/cuentas'); return { bloqueado: r.status === 403 || (r.status === 200 && (r.body?.items ?? r.body?.cuentas ?? []).length === 0 && r.body?.sin_modulo === true), status: r.status, nota: r.texto.slice(0, 70) }; }],
  ];
  const matriz = [];
  for (const [nombre, cap, llamar] of puertas) {
    for (const c of CLIENTES) {
      const cd = planDe[c];
      const tiene = cd.modulos_activos.includes(cap);
      const res = await llamar(c);
      if (res === null) { matriz.push({ puerta: nombre, cliente: c, plan: cd.plan.clave, tiene, estado: 'sin pago de muestra' }); continue; }
      matriz.push({ puerta: nombre, cliente: c, plan: cd.plan.clave, tiene, bloqueado: res.bloqueado, status: res.status });
      anotar('puertas por plan', `${nombre}: ${c} (plan ${cd.plan.clave}${cd.solo_lectura ? ', solo lectura' : ''}${cd.en_prueba ? ', prueba' : ''}) ${tiene ? 'debe poder' : 'debe estar bloqueado'}`, tiene ? !res.bloqueado : res.bloqueado, `${res.status} ${res.nota}`);
    }
  }
  extra.matrizPuertas = matriz;
  // Mora automática: sólo donde el plan la trae.
  const mora = Object.fromEntries(CLIENTES.map((c) => [c, Number(sql(`select count(*) from "ReciboConcepto" rc join "Recibo" r on r.id = rc.recibo_id where r.empresa_id = ${dueno[c].empresa} and rc.es_recargo`)[0][0])]));
  extra.moraPorCliente = mora;
  for (const c of CLIENTES) anotar('puertas por plan', `mora automática en los recibos de ${c} (${planDe[c].plan.clave}): ${mora[c]} líneas`, planDe[c].modulos_activos.includes('mora_automatica') ? mora[c] > 0 : mora[c] === 0);
  // Administradora: varios condominios en una cuenta; Gratis: uno solo.
  const pa = await S.admin.A.get('/api/comercial/puede-agregar-condominio');
  anotar('planes', 'Administradora (A) puede agregar otro condominio', pa.status === 200 && pa.body.puede === true, JSON.stringify(pa.body));
  const pj = await S.admin.J1.get('/api/comercial/puede-agregar-condominio');
  anotar('planes', 'Gratis (J1) con su condominio ya creado no puede agregar otro', pj.status === 200 && pj.body.puede === false, JSON.stringify(pj.body).slice(0, 160));
  // Vigencia: estados que ve cada cliente
  extra.estadosPlan = Object.fromEntries(CLIENTES.map((c) => [c, planDe[c] ? { plan: planDe[c].plan.clave, estado: planDe[c].estado, prueba: planDe[c].en_prueba, solo_lectura: planDe[c].solo_lectura, vigente_hasta: planDe[c].vigente_hasta?.slice(0, 10) ?? null, gratis_hasta: planDe[c].gratis_hasta?.slice(0, 10) ?? null } : null]));
}

// ================================================================ FASE 4: rendimiento con volumen
async function faseRendimiento(S) {
  console.log('\n== Rendimiento ==');
  const A = S.admin.A;
  const cx = dueno.A.complejos[0]; // Los Cedros: 448 dptos, 14 blocks
  const rOct = dueno.A.recibos.at(-1);
  const mOct = parMantenimiento('A');
  const items = [
    ['Dashboard de la empresa A (todos los condominios)', A, '/api/dashboard/resumen'],
    ['Dashboard de Los Cedros (448 dptos)', A, `/api/dashboard/resumen?complejo_id=${cx}`],
    ['Morosidad de la empresa A (652 dptos)', A, '/api/reportes/morosidad?pageSize=50'],
    ['Morosidad de Los Cedros', A, `/api/reportes/morosidad?complejo_id=${cx}&pageSize=50`],
    ['Listado de pagos (página 1)', A, '/api/pagos?pageSize=50'],
    ['Listado de pagos (página profunda, a 3/4 del total)', A, `/api/pagos?pageSize=50&page=${Math.floor(((await A.get('/api/pagos?pageSize=50')).body?.total ?? 100) / 50 * 0.75) || 2}`],
    ['Cargos (página 1)', A, '/api/recibo-concepto-unidades?pageSize=50'],
    ['Recibos del mes de octubre (Los Cedros)', A, `/api/recibos?complejo_id=${cx}&mes=10&anio=2026&pageSize=50`],
    ['Periodos de recibos de Los Cedros', A, `/api/recibos/periodos?complejo_id=${cx}`],
    ['Mantenimientos de un recibo (32 dptos)', A, `/api/recibos/${mOct.reciboId}/mantenimientos`],
    ['Consolidado del recibo', A, `/api/recibos/${rOct}/consolidado`],
    ['Contador de WhatsApp (con «evitados»)', A, '/api/whatsapp/uso'],
    ['Mis grupos de WhatsApp + cobertura', A, '/api/whatsapp/grupos'],
    ['Reporte de cobranza / rendición de Los Cedros', A, `/api/reportes/rendicion?complejo_id=${cx}`],
    ['Rendición en Excel (Los Cedros)', A, `/api/reportes/rendicion.xlsx?complejo_id=${cx}`, true],
    ['Cierre del mes (14 blocks)', A, `/api/cierres?complejo_id=${cx}`],
    ['Cierre central de Los Cedros', A, `/api/cierres/central?complejo_id=${cx}`],
    ['Unidades (búsqueda «B05»)', A, '/api/unidades?q=B05&pageSize=50'],
    ['Usuarios (página 1)', A, '/api/usuarios?pageSize=50'],
    ['Mi plan (3 condominios+uso del mes)', A, '/api/comercial/mi-plan'],
    ['Vecino: Mis mantenimientos', S.vecino.A, '/api/me/mantenimientos'],
    ['Superadmin: suscripciones (14 condominios)', S.super, '/api/comercial/suscripciones?pageSize=100'],
    ['Superadmin: dashboard global', S.super, '/api/dashboard/resumen'],
  ];
  for (const [nombre, api, ruta, crudo] of items) {
    const ms = [];
    let status = 0, bytes = 0;
    for (let i = 0; i < 4; i++) { const r = await api.get(ruta, { crudo: !!crudo }); status = r.status; bytes = r.bytes; ms.push(r.ms); }
    const frio = ms[0]; const resto = ms.slice(1).sort((a, b) => a - b);
    const m = { nombre, ruta, status, frio, mediana: resto[1], max: Math.max(...ms), kb: Math.round(bytes / 1024) };
    medidas.push(m);
    anotar('rendimiento', `${nombre}: responde 200`, status === 200, `${status}`);
    anotar('rendimiento', `${nombre}: máx ${m.max} ms (límite 1500)`, m.max <= 1500, `frío ${frio} ms · mediana ${m.mediana} ms · ${m.kb} KB`);
  }
  // Concurrencia: 15 administradoras/vecinos a la vez (la Mac aguanta poco: sólo 3 oleadas de 5).
  const t0 = performance.now();
  const lote = [S.admin.A, S.admin.B, S.admin.C, S.admin.J4, S.admin.J5, S.tesorero.J4, S.vecino.A, S.vecino.B, S.vecino.J4, S.admin.J3];
  const resp = await Promise.all(lote.flatMap((a) => [a.get('/api/dashboard/resumen'), a.get('/api/recibos/periodos'), a.get('/api/auth/me')]));
  const dt = Math.round(performance.now() - t0);
  extra.concurrencia = { peticiones: resp.length, ms: dt, errores5xx: resp.filter((r) => r.status >= 500).length, maxMs: Math.max(...resp.map((r) => r.ms)) };
  anotar('rendimiento', `${resp.length} peticiones simultáneas de 10 cuentas distintas sin errores 5xx (${dt} ms en total, la más lenta ${extra.concurrencia.maxMs} ms)`, extra.concurrencia.errores5xx === 0);
}

// ================================================================ FASE 5: mensajería inteligente
async function faseMensajeria(S) {
  console.log('\n== Mensajería inteligente ==');
  const A = await S.admin.A.get('/api/whatsapp/uso');
  anotar('mensajería', 'Empresa A: GET /whatsapp/uso responde', A.status === 200, `${A.status}`);
  if (A.status === 200) {
    const m = A.body.mes;
    extra.mensajeriaA = { enviados: m.enviados, a_grupos: m.a_grupos, evitados: m.evitados, grupos_en_uso: m.grupos_en_uso, conectado: A.body.conectado, tope_dia: A.body.hoy?.tope };
    anotar('mensajería', `Empresa A: ${m.grupos_en_uso} grupos en uso (esperados 11 + 6 + 1 + 1 = 19)`, m.grupos_en_uso === 19, `${m.grupos_en_uso}`);
    // Esperado, calculado con SQL aparte: mensajes a grupos del mes = envíos «enviado» desde el día 1; evitados = Σ por recibo avisado a grupos de max(0, vecinos con WhatsApp directo − mensajes a grupos).
    const envios = sql(`select count(*) from "EnvioGrupoWhatsapp" where empresa_id = ${dueno.A.empresa} and estado = 'enviado' and at >= date_trunc('month', now())`)[0][0];
    const evit = sql(`select coalesce(sum(greatest(0, d.directos - g.grupos)), 0) from (
        select e.recibo_id, count(*) as grupos from "EnvioGrupoWhatsapp" e where e.empresa_id = ${dueno.A.empresa} and e.estado = 'enviado' and e.at >= date_trunc('month', now()) and e.recibo_id is not null group by 1) g
      join lateral (select count(*) as directos from (select distinct u.id from "Unidad" u join "ReciboConceptoUnidad" rcu on rcu.unidad_id = u.id join "ReciboConcepto" rc on rc.id = rcu.recibo_concepto_id where rc.recibo_id = g.recibo_id) x
        join "Unidad" u2 on u2.id = x.id join "Usuario" us on us.id = coalesce((select usuario_id from "PersonaUnidad" p where p.unidad_id = u2.id and p.responsable_pago and p.usuario_id is not null limit 1), u2.inquilino_id, u2.propietario_id)
        where us.aviso_whatsapp and coalesce(trim(us.telefono), '') <> '') d on true`)[0][0];
    extra.mensajeriaAEsperado = { a_grupos: Number(envios), evitados: Number(evit) };
    anotar('mensajería', 'Empresa A: «a grupos» del mes coincide con los envíos sembrados (SQL aparte)', m.a_grupos === Number(envios), `API ${m.a_grupos} vs base ${envios}`);
    anotar('mensajería', 'Empresa A: «evitados» coincide con el cálculo independiente (vecinos con WhatsApp directo − mensajes a grupos, por recibo)', m.evitados === Number(evit) && m.evitados > 0, `API ${m.evitados} vs base ${evit}`);
    anotar('mensajería', 'Empresa A: «enviados» del mes incluye los mensajes a grupos', m.enviados >= m.a_grupos, `enviados=${m.enviados}, a_grupos=${m.a_grupos}`);
  }
  for (const c of ['J4', 'J1']) {
    const r = await S.admin[c].get('/api/whatsapp/uso');
    anotar('mensajería', `${c} (sin grupos): el contador responde y no inventa grupos ni evitados`, (r.status === 200 && r.body.mes.grupos_en_uso === 0 && r.body.mes.evitados === 0) || r.status === 403, `${r.status} ${r.status === 200 ? JSON.stringify({ grupos: r.body.mes.grupos_en_uso, evitados: r.body.mes.evitados, a_grupos: r.body.mes.a_grupos }) : r.texto.slice(0, 80)}`);
    if (r.status === 200) extra[`mensajeria${c}`] = { enviados: r.body.mes.enviados, a_grupos: r.body.mes.a_grupos, evitados: r.body.mes.evitados, grupos_en_uso: r.body.mes.grupos_en_uso };
    else extra[`mensajeria${c}`] = { bloqueado: r.status };
  }
  // Cobertura de grupos por block en Los Cedros: faltan 3 (blocks 12, 13 y 14).
  const cob = await S.admin.A.get(`/api/whatsapp/cobertura/${dueno.A.complejos[0]}`);
  anotar('mensajería', 'Cobertura de Los Cedros: 11 de 14 blocks con grupo, faltan 3', cob.status === 200 && cob.body.bloques?.con_grupo === 11 && cob.body.bloques?.faltan?.length === 3, JSON.stringify(cob.body?.bloques ?? {}).slice(0, 200));
  // Los grupos de A son sólo de A.
  const gA = await S.admin.A.get('/api/whatsapp/grupos');
  anotar('mensajería', 'Mis grupos de A: sólo grupos de A', gA.status === 200 && (gA.body.grupos ?? []).every((g) => dueno.A.sets.grupos.has(g.id)), `${(gA.body?.grupos ?? []).length} grupos`);
  const gB = await S.admin.B.get('/api/whatsapp/grupos');
  anotar('mensajería', 'Empresa B (sin grupos ni número): no ve los grupos de A', gB.status === 200 ? (gB.body.grupos ?? []).length === 0 : gB.status === 403, `${gB.status} ${gB.status === 200 ? (gB.body.grupos ?? []).length : ''}`);
  // «Evitados» a mano: de octubre (se anota en el informe). Los envíos a grupos que sembramos son de octubre: la base los cuenta por mes.
  const evitadosOct = sql(`select count(*) from "EnvioGrupoWhatsapp" where estado = 'enviado' and recibo_id is not null`)[0][0];
  extra.enviosGrupoSembrados = Number(evitadosOct);
}


// ================================================================ FASE 7: herramientas del asistente (las mismas que usa la IA), por MCP, sin modelo
async function faseHerramientas(S) {
  console.log('\n== Herramientas del asistente (vía /mcp con token de API, sin modelo de IA) ==');
  const actores = [['admin A', S.admin.A, 'A'], ['admin B', S.admin.B, 'B'], ['admin J4', S.admin.J4, 'J4'], ['tesorero J4', S.tesorero.J4, 'J4'], ['tesorero A', S.tesorero.A, 'A'], ['vecino A', S.vecino.A, 'A'], ['vecino J4', S.vecino.J4, 'J4']];
  const nombres = Object.fromEntries(CLIENTES.map((c) => [c, {
    condos: sql(`select nombre from "ComplejoHabitacional" where empresa_id = ${dueno[c].empresa}`).map((f) => f[0]),
    empresa: sql(`select nombre from "EmpresaAdministradora" where id = ${dueno[c].empresa}`)[0][0],
  }]));
  let id = 1;
  const mcp = async (token, method, params) => {
    for (let intento = 0; intento < 2; intento++) {
      const r = await fetch(`${BASE}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) });
      if (r.status === 429) { await new Promise((res) => setTimeout(res, 61_000)); continue; }
      return { status: r.status, body: await r.json().catch(() => null) };
    }
    return { status: 429, body: null };
  };
  let llamadas = 0, conDatosPropios = 0, herramientasProbadas = 0;
  for (const [etiqueta, api, c] of actores) {
    if (!api) continue;
    const t = await api.post('/api/me/tokens-api', { nombre: `e2e-mercado-${Date.now().toString(36)}`, dias: 1 });
    if (t.status !== 201 || !t.body?.token) { anotar('herramientas', `${etiqueta}: crea su token de API`, false, `${t.status} ${t.texto.slice(0, 100)}`); continue; }
    const token = t.body.token;
    const lista = await mcp(token, 'tools/list', {});
    const tools = lista.body?.result?.tools ?? [];
    anotar('herramientas', `${etiqueta}: tools/list devuelve herramientas de su rol`, lista.status === 200 && tools.length > 0, `${tools.length} herramientas`);
    const ajenos = CLIENTES.filter((x) => x !== c);
    const sentinelas = ajenos.flatMap((x) => [...nombres[x].condos, nombres[x].empresa]).filter((n) => !nombres[c].condos.includes(n) && n !== nombres[c].empresa);
    const dominios = ajenos.map((x) => CRED.clientes[x].admins[0].email.split('@')[1]).filter((d) => d !== CRED.clientes[c].admins[0].email.split('@')[1]);
    const idAjeno = (nombre) => {
      const d = dueno[ajenos[0]];
      if (/unidad/i.test(nombre)) return d.unidades[0];
      if (/recibo/i.test(nombre)) return d.recibos.at(-1);
      if (/cargo/i.test(nombre)) return d.cargos[0];
      if (/pago/i.test(nombre)) return d.pagos[0];
      if (/complejo|condominio/i.test(nombre)) return d.complejos[0];
      if (/estructura|block/i.test(nombre)) return d.estructuras[0];
      if (/usuario|persona|vecino/i.test(nombre)) return d.usuarios.at(-1);
      return d.unidades[0];
    };
    // Un código de departamento que SÓLO existe en otro cliente (B14-… sólo en Los Cedros de A; B01-806 sólo en Miraflores 48 de J5): si aparece, es una fuga.
    const codigoAjeno = c === 'A' ? 'B01-806' : 'B14-101';
    let filtradas = 0;
    for (const h of tools) {
      const props = h.inputSchema?.properties ?? {};
      const req = new Set(h.inputSchema?.required ?? []);
      const rellenar = (modo) => {
        const args = {};
        for (const [k, def] of Object.entries(props)) {
          const tipo = Array.isArray(def.type) ? def.type[0] : def.type;
          if (def.enum) { if (req.has(k) || modo === 'enum') args[k] = def.enum[0]; continue; }
          if (tipo === 'string') { if (modo === 'texto' || req.has(k)) args[k] = modo === 'texto' ? (/codigo|unidad|departamento/i.test(k) ? codigoAjeno : nombres[ajenos[0]].condos[0]) : (/codigo/i.test(k) ? 'B01-101' : 'a'); }
          else if (tipo === 'integer' || tipo === 'number') { if (modo === 'ids' && /id$|unidad|recibo|cargo|pago|complejo|estructura/i.test(k)) args[k] = idAjeno(k); else if (req.has(k)) args[k] = 1; }
          else if (tipo === 'boolean' && req.has(k)) args[k] = false;
        }
        return args;
      };
      herramientasProbadas++;
      for (const modo of ['vacio', 'texto', 'ids']) {
        if ((modo === 'texto' && !Object.values(props).some((d) => (Array.isArray(d.type) ? d.type[0] : d.type) === 'string')) || (modo === 'ids' && !Object.keys(props).some((k) => /id$|unidad|recibo|cargo|pago|complejo|estructura/i.test(k)))) continue;
        const r = await mcp(token, 'tools/call', { name: h.name, arguments: rellenar(modo) });
        llamadas++;
        const texto = JSON.stringify(r.body?.result?.content ?? r.body?.error ?? '');
        const fuga = [...sentinelas, ...dominios.map((d) => `@${d}`)].find((n) => texto.includes(n));
        if (fuga) { filtradas++; anotar('herramientas', `${etiqueta}: «${h.name}» (${modo}) no trae datos de otro cliente`, false, `aparece «${fuga}»`); }
        if (nombres[c].condos.some((n) => texto.includes(n)) && !r.body?.result?.isError) conDatosPropios++;
      }
    }
    anotar('herramientas', `${etiqueta}: ${tools.length} herramientas probadas con texto y ids ajenos, ninguna trae datos de otro cliente`, filtradas === 0, `${filtradas} fugas`);
    for (const nombreHerr of ['detalle_unidad', 'buscar_unidad']) {
      if (!tools.find((h) => h.name === nombreHerr)) continue;
      const arg = (v) => (nombreHerr === 'buscar_unidad' ? { texto: v } : { codigo: v });
      const propia = await mcp(token, 'tools/call', { name: nombreHerr, arguments: arg('B01-101') });
      const ajena = await mcp(token, 'tools/call', { name: nombreHerr, arguments: arg(codigoAjeno) });
      const txt = JSON.stringify(ajena.body?.result?.content ?? ajena.body?.error ?? '');
      llamadas += 2;
      anotar('herramientas', `${etiqueta}: ${nombreHerr}(${codigoAjeno}) — un código que sólo existe en OTRO cliente — no devuelve esa unidad`, !sentinelas.some((n) => txt.includes(n)), txt.slice(0, 110));
      if (api.usuario?.rol === 'admin') anotar('herramientas', `control: ${etiqueta} sí encuentra B01-101 en lo suyo (${nombreHerr})`, nombres[c].condos.some((n) => JSON.stringify(propia.body?.result?.content ?? '').includes(n)), JSON.stringify(propia.body?.result?.content ?? propia.body?.error ?? '').slice(0, 90));
    }
  }
  anotar('herramientas', `control: las herramientas SÍ devuelven datos propios (${conDatosPropios} respuestas con su condominio)`, conDatosPropios > 0, '');
  extra.herramientas = { actores: actores.filter((a) => a[1]).length, herramientasProbadas, llamadas, conDatosPropios };
}

// ================================================================ FASE 6: navegador (un Chromium a la vez)
async function faseNavegador() {
  console.log('\n== Navegador ==');
  let chromium;
  try {
    const require = createRequire(import.meta.url);
    ({ chromium } = require('/opt/homebrew/lib/node_modules/playwright'));
  } catch { anotar('navegador', 'Playwright disponible', false, 'no se encontró /opt/homebrew/lib/node_modules/playwright'); return; }
  const raiz = await fetch(`${BASE}/`).then((r) => r.status, () => 0);
  if (raiz !== 200) { anotar('navegador', 'el backend sirve el frontend (dist/)', false, `GET / → ${raiz}: corre «npm run build» en el worktree y levanta con HOUSE_REPO=$PWD`); return; }
  const browser = await chromium.launch();
  const entrar = async (cuenta, viewport = { width: 1366, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, locale: 'es-PE' });
    ctx.setDefaultTimeout(15000);
    const page = await ctx.newPage();
    page.errores = [];
    page.on('pageerror', (e) => page.errores.push(`JS: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 500) page.errores.push(`${r.status()} ${r.url().replace(BASE, '')}`); });
    await page.goto(`${BASE}/login`);
    await page.getByLabel(/correo/i).first().fill(cuenta.email);
    await page.getByLabel(/contraseña/i).first().fill(cuenta.password);
    await page.getByRole('button', { name: /iniciar sesión|ingresar|entrar/i }).first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    return { ctx, page };
  };
  const foto = async (page, nombre) => page.screenshot({ path: join(CAPTURAS, `mercado-${nombre}.png`), fullPage: false });
  const cuentas = {
    adminA: CRED.clientes.A.admins[0], adminJ2: CRED.clientes.J2.admins[0], vecinoJ4: CRED.clientes.J4.vecino_moroso, tesoreroJ4: CRED.clientes.J4.tesorero,
  };
  try {
    // 1) Admin de la empresa grande: dashboard con el selector de condominio.
    let { ctx, page } = await entrar(cuentas.adminA);
    const url1 = page.url();
    anotar('navegador', 'admin A entra y no vuelve al login', !/\/login/.test(url1), url1.replace(BASE, ''));
    const cuerpo1 = (await page.locator('body').innerText()).slice(0, 4000);
    anotar('navegador', 'admin A ve sus condominios (Los Cedros) y NO los de otras empresas', /Los Cedros/.test(cuerpo1) && !/Alameda 18|Los Álamos|Santa Rosa de Lima/.test(cuerpo1), cuerpo1.replace(/\s+/g, ' ').slice(0, 120));
    await foto(page, 'admin-a-dashboard');
    await page.goto(`${BASE}/admin/morosidad`).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await foto(page, 'admin-a-morosidad');
    anotar('navegador', 'admin A: la pantalla de morosidad carga sin errores de JS ni 5xx', page.errores.length === 0, page.errores.slice(0, 3).join(' | '));
    await ctx.close();
    // 2) Junta vencida (solo lectura): banda y bloqueo al registrar.
    ({ ctx, page } = await entrar(cuentas.adminJ2));
    const cuerpo2 = (await page.locator('body').innerText()).slice(0, 4000);
    anotar('navegador', 'J2 (Gratis vencido) muestra el aviso de solo lectura', /solo lectura/i.test(cuerpo2), cuerpo2.replace(/\s+/g, ' ').slice(0, 140));
    await foto(page, 'admin-j2-solo-lectura');
    await ctx.close();
    // 3) Vecino con deuda, en celular: ve su deuda.
    ({ ctx, page } = await entrar(cuentas.vecinoJ4, { width: 390, height: 844 }));
    const cuerpo3 = (await page.locator('body').innerText()).slice(0, 4000);
    anotar('navegador', 'vecino de J4 (390 px) ve su deuda en S/', /S\/\s?\d/.test(cuerpo3), cuerpo3.replace(/\s+/g, ' ').slice(0, 140));
    await foto(page, 'vecino-j4-inicio');
    anotar('navegador', 'vecino: sin errores de JS ni 5xx', page.errores.length === 0, page.errores.slice(0, 3).join(' | '));
    await ctx.close();
    // 4) Tesorero de junta: su menú y su cierre.
    ({ ctx, page } = await entrar(cuentas.tesoreroJ4));
    const cuerpo4 = (await page.locator('body').innerText()).slice(0, 4000);
    anotar('navegador', 'tesorero de J4 entra a su panel de junta', !/\/login/.test(page.url()) && /junta|cierre|pagos/i.test(cuerpo4), page.url().replace(BASE, ''));
    await foto(page, 'tesorero-j4-inicio');
    await ctx.close();
  } catch (e) {
    anotar('navegador', 'recorrido sin excepciones', false, String(e.message).slice(0, 200));
  } finally {
    await browser.close();
  }
}

// ================================================================ main
async function main() {
  mapear();
  const S = { admin: {}, admin2: {}, tesorero: {}, vecino: {}, personal: {}, super: null };
  S.super = await new Api('superadmin', CRED.superadmin).entrar();
  for (const c of CLIENTES) {
    const cl = CRED.clientes[c];
    S.admin[c] = await new Api(`admin ${c}`, cl.admins[0]).entrar();
    if (cl.admins[1]) S.admin2[c] = await new Api(`admin2 ${c}`, cl.admins[1]).entrar();
    if (cl.tesorero) S.tesorero[c] = await new Api(`tesorero ${c}`, cl.tesorero).entrar();
    if (cl.vecino_al_dia) S.vecino[c] = await new Api(`vecino ${c}`, cl.vecino_al_dia).entrar();
    if (cl.personal?.[0]) S.personal[c] = await new Api(`personal ${c}`, cl.personal[0]).entrar();
  }
  // Los vecinos de «tipos» deben tener deuda (J4: el moroso); se reemplaza el vecino de J4 y J2 por uno moroso.
  S.vecino.J4 = await new Api('vecino moroso J4', CRED.clientes.J4.vecino_moroso).entrar();
  if (CRED.clientes.J2.vecino_moroso) S.vecino.J2 = await new Api('vecino moroso J2', CRED.clientes.J2.vecino_moroso).entrar();

  const corre = { separacion: faseSeparacion, tipos: faseTipos, planes: fasePlanes, rendimiento: faseRendimiento, mensajeria: faseMensajeria, herramientas: faseHerramientas };
  for (const f of FASES) {
    fase0.actual = f;
    const t0 = Date.now();
    try {
      if (f === 'navegador') await faseNavegador();
      else if (corre[f]) await corre[f](S);
      else console.log(`fase desconocida: ${f}`);
    } catch (e) {
      anotar(f, 'la fase terminó sin excepción', false, String(e.stack ?? e).slice(0, 400));
    }
    const hechas = registro.filter((r) => r.fase === f);
    console.log(`  ${f}: ${hechas.filter((r) => r.ok).length} OK, ${hechas.filter((r) => !r.ok).length} FALLAS (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  const salida = { fecha: new Date().toISOString(), base: DB, fases: FASES, total: registro.length, ok: registro.filter((r) => r.ok).length, fallas, extra, medidas, registro };
  writeFileSync(join(RESULTADOS, 'mercado.json'), JSON.stringify(salida, null, 2));
  console.log(`\n${salida.ok}/${salida.total} OK · ${fallas} FALLAS · resultado: scripts/e2e/resultados/mercado.json`);
  process.exit(fallas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
