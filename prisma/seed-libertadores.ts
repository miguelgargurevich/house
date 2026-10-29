/**
 * Datos de prueba realistas: Condominio Los Libertadores de Surco (14 blocks × 8 pisos × 4 dptos = 448 unidades) con un
 * año de recibos (nov-2025 → oct-2026). `npm run seed:libertadores`.
 *
 * - SOLO contra la base de desarrollo local (`localhost`/`127.0.0.1` y base llamada `house`); si no, aborta.
 * - Borra y recrea todo (misma lista que `seed.ts` + tablas nuevas). Conserva `ClaveIntegracion`, `ModeloIA`, `SyncModelosIA` y `EstadoIA`.
 * - Determinista (PRNG con semilla fija) e idempotente.
 *
 * Reglas de los montos (por unidad y mes, en S/):
 *   agua del departamento 25–70 (por depa y mes, típico 48–68; se acota para que el total ordinario quede entre 201 y 259), agua de áreas comunes 8–12,
 *   luz de áreas comunes 15–22, limpieza 35–36, seguridad 70–72, contingencia del block 10, contingencia del condominio 15.
 *   MORA (recargo): 10 % del total ordinario (sin mora ni extraordinarios) del mes anterior de esa unidad, sólo a quien pagó ese mes
 *   después del vencimiento o aún lo debe. Se carga en el recibo del mes siguiente.
 *   Extraordinarios (raros, no entran en el rango 200–260): ascensor del Block 7 (mar-2026, S/ 60 sólo a ese block) y cambio de bomba de agua (ago-2026, S/ 40 a todos).
 * Pagos: el vecino paga el MANTENIMIENTO del mes (todos los conceptos de su departamento) con una sola operación y un solo comprobante:
 * un `Pago` por cargo, todos con el mismo `grupo` (el primero es `grupo_principal` y lleva el comprobante). Unas cuantas unidades
 * (`idx % 29 === 0`) conservan pagos SUELTOS antiguos por cargo en los meses pasados, para probar la compatibilidad.
 * Los residentes no llevan `empresa_id` (la derivan de sus unidades); sólo el personal.
 */
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { fechaTexto, periodoTexto, plantilla, dineroTexto, type TipoAviso } from '../src/server/services/avisos/plantillas';

// ───────────────────────────── protección ─────────────────────────────
function exigirBaseLocal() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está definida.');
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('DATABASE_URL no es una URL válida.');
  }
  const base = u.pathname.replace(/^\//, '');
  if (!['localhost', '127.0.0.1'].includes(u.hostname) || base !== 'house') {
    console.error(`✖ Este seed sólo corre contra la base de desarrollo local («house» en localhost); recibí «${u.hostname}/${base}». Abortado: no se tocó nada.`);
    process.exit(1);
  }
}
exigirBaseLocal();
const prisma = new PrismaClient();

// ───────────────────────────── utilidades ─────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261024);
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1)); // entero inclusivo
const elige = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
function pesos<T>(xs: readonly (readonly [T, number])[]): T {
  const total = xs.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [x, w] of xs) if ((r -= w) < 0) return x;
  return xs[xs.length - 1]![0];
}
function barajar<T>(xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
  return xs;
}
const trozos = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));
const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
const slug = (t: string) => sinTildes(t).toLowerCase().replace(/[^a-z0-9]+/g, '');
const dec = (centimos: number) => (centimos / 100).toFixed(2);
const utc = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi));
const DIA = 24 * 3600 * 1000;

const hashes = new Map<string, string>();
async function hash(password: string) {
  let h = hashes.get(password);
  if (!h) hashes.set(password, (h = await bcrypt.hash(password, 12)));
  return h;
}

// PNG pequeño generado (comprobantes y QR de ejemplo); distinto por semilla para que cada sha256 sea único.
const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = TABLA_CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunkPng(tipo: string, datos: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(datos.length);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo));
  return Buffer.concat([len, cuerpo, crc]);
}
function png(w: number, h: number, semilla: number, modo: 'voucher' | 'qr'): Buffer {
  const filas: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const fila = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      let v: number;
      if (modo === 'qr') v = ((x * 7 + y * 13 + semilla) ^ (x * y + semilla)) % 5 < 2 ? 20 : 245;
      else v = y < 8 || (y % 9 < 2 && x > 6 && x < w - 6 && (x + semilla) % 11 > 1) ? 70 + ((semilla * 37 + y) % 90) : 245;
      const o = 1 + x * 3;
      fila[o] = v;
      fila[o + 1] = modo === 'voucher' && y < 8 ? 40 + (semilla % 120) : v;
      fila[o + 2] = v;
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunkPng('IHDR', ihdr), chunkPng('IDAT', deflateSync(Buffer.concat(filas))), chunkPng('IEND', Buffer.alloc(0))]);
}

// ───────────────────────────── nombres ─────────────────────────────
const NOMBRES = ['Luis', 'Carlos', 'Jorge', 'José', 'Juan', 'Miguel', 'Pedro', 'Víctor', 'Raúl', 'Óscar', 'Manuel', 'César', 'Hugo', 'Fernando', 'Ricardo', 'Alberto', 'Eduardo', 'Rafael', 'Andrés', 'Diego', 'Sergio', 'Walter', 'Julio', 'Marco', 'Percy', 'Enrique', 'Gustavo', 'Alejandro', 'Daniel', 'Roberto',
  'María', 'Rosa', 'Carmen', 'Ana', 'Luz', 'Elena', 'Patricia', 'Silvia', 'Gladys', 'Teresa', 'Julia', 'Sandra', 'Liliana', 'Martha', 'Giovanna', 'Claudia', 'Karina', 'Milagros', 'Yolanda', 'Jessica', 'Rocío', 'Verónica', 'Lucía', 'Paola', 'Cecilia', 'Mónica', 'Beatriz', 'Doris', 'Norma', 'Flor'] as const;
const APELLIDOS = ['Quispe', 'Huamán', 'Flores', 'Rojas', 'Mendoza', 'Gutiérrez', 'Vásquez', 'Castillo', 'Chávez', 'Ramos', 'Torres', 'Sánchez', 'Díaz', 'Cruz', 'Vargas', 'Salazar', 'Paredes', 'Espinoza', 'Ccori', 'Condori', 'Mamani', 'Palomino', 'Cárdenas', 'Valdivia', 'Zevallos', 'Bustamante', 'Benavides', 'Arce', 'Tello', 'Cáceres',
  'Quiroz', 'Lazo', 'Ponce', 'Montoya', 'Ávalos', 'Alarcón', 'Guerra', 'Ibáñez', 'Carrasco', 'Delgado', 'Pacheco', 'Villanueva', 'Ugarte', 'Samaniego', 'Calderón', 'Oré', 'Yupanqui', 'Aguilar', 'Neyra', 'Barrios', 'Tapia', 'Collazos', 'Farfán', 'Becerra', 'Llanos', 'Rivera', 'Bernales', 'Zegarra', 'Olivera', 'Santillán'] as const;

const usados = new Set<string>();
function nombreNuevo(): { nombre: string; ap: string } {
  for (;;) {
    const n = elige(NOMBRES);
    const a1 = elige(APELLIDOS);
    const a2 = elige(APELLIDOS);
    if (a1 === a2) continue;
    const completo = `${n} ${a1} ${a2}`;
    if (usados.has(completo)) continue;
    usados.add(completo);
    return { nombre: completo, ap: a1 };
  }
}
const telUsados = new Set<string>();
function telefono() {
  for (;;) {
    const t = `9${entre(10000000, 99999999)}`;
    if (!telUsados.has(t)) return (telUsados.add(t), t);
  }
}

// ───────────────────────────── plan ─────────────────────────────
const BLOCKS = 14;
const PISOS = 8;
const DPTOS = 4;
const MESES = Array.from({ length: 12 }, (_, i) => ({ anio: i < 2 ? 2025 : 2026, mes: i < 2 ? 11 + i : i - 1 })); // nov-2025 … oct-2026
const ACTUAL = MESES.length - 1;
const HOY = utc(2026, 10, 24, 17); // «hoy» del brief; fijo para que la siembra sea determinista
const ESTACION = [1.0, 1.06, 1.1, 1.1, 1.06, 0.98, 0.94, 0.9, 0.9, 0.92, 0.96, 1.0];

interface Plan {
  idx: number;
  block: number;
  piso: number;
  num: number; // 101…804
  codigo: string;
  duenoKey: number;
  inquilinoKey: number | null;
  moroso: number; // meses de deuda seguidos hasta octubre (0 = no)
  aguaBase: number; // centavos
}
const unidades: Plan[] = [];
for (let b = 1; b <= BLOCKS; b++)
  for (let p = 1; p <= PISOS; p++)
    for (let d = 1; d <= DPTOS; d++) {
      const num = p * 100 + d;
      unidades.push({ idx: unidades.length, block: b, piso: p, num, codigo: `B${String(b).padStart(2, '0')}-${num}`, duenoKey: -1, inquilinoKey: null, moroso: 0, aguaBase: entre(4800, 6800) });
    }
const porCodigo = new Map(unidades.map((u) => [u.codigo, u]));
const U_MIGUEL = porCodigo.get('B01-804')!;
const U_JAVIER = porCodigo.get('B03-502')!;
const U_VALENTINA = porCodigo.get('B05-301')!;
const especiales = new Set([U_MIGUEL, U_JAVIER, U_VALENTINA]);

interface Persona {
  nombre: string;
  email: string;
  telefono: string;
  rol: 'propietario' | 'inquilino';
  password: string;
  id?: number;
  cargo_junta?: 'presidente' | 'tesorero';
  estructura_id?: number;
}
const personas: Persona[] = [];
function crearPersona(rol: Persona['rol'], fijo?: Partial<Persona>): number {
  const { nombre, ap } = nombreNuevo();
  const n = personas.length + 1;
  const primer = nombre.split(' ')[0]!;
  personas.push({ nombre, email: `${slug(primer)}.${slug(ap)}.${n}@prueba.house`, telefono: telefono(), rol, password: rol === 'propietario' ? 'prop1234' : 'inq1234', ...fijo });
  return personas.length - 1;
}

// Dueños: Miguel y Javier con sus datos; el resto, uno por unidad (12 con dos unidades).
U_MIGUEL.duenoKey = crearPersona('propietario', { nombre: 'Miguel Gargurevich', email: 'miguel@prueba.house', cargo_junta: 'presidente' });
U_JAVIER.duenoKey = crearPersona('propietario', { nombre: 'Javier Castro', email: 'javier.castro@prop.com' });
for (const u of unidades) if (u.duenoKey < 0) u.duenoKey = crearPersona('propietario');
{
  const candidatas = barajar(unidades.filter((u) => !especiales.has(u)));
  for (let k = 0; k < 12; k++) {
    const segunda = candidatas[2 * k + 1]!;
    const primera = candidatas[2 * k]!;
    if (segunda.block === primera.block) continue; // el segundo depa, en otro block
    personas[segunda.duenoKey] = { ...personas[segunda.duenoKey]!, nombre: '' }; // marca: ya no se crea
    segunda.duenoKey = primera.duenoKey;
  }
}
// Inquilinos: ~15 % de las unidades (Valentina Ruiz en B05-301; Miguel vive en su depa).
U_VALENTINA.inquilinoKey = crearPersona('inquilino', { nombre: 'Valentina Ruiz', email: 'valentina.ruiz@inq.com' });
for (const u of barajar(unidades.filter((x) => !especiales.has(x))).slice(0, 66)) u.inquilinoKey = crearPersona('inquilino');

// Morosos: 70 unidades con 1 a 11 meses de deuda seguidos hasta octubre (reparto parejo). Deja ~7 % de los meses pasados sin pagar
// (24-oct, Miguel: «sube la morosidad de los meses pasados a ~7 %»; con 27 unidades quedaba en ~2,4 %).
{
  const rachas = Array.from({ length: 70 }, (_, i) => 1 + (i % 11));
  const candidatas = barajar(unidades.filter((u) => !especiales.has(u) && u.block !== 1));
  rachas.forEach((r, i) => (candidatas[i]!.moroso = r));
}

// Estado de cada unidad en cada mes.
type Estado = 'pagado' | 'en_revision' | 'pendiente';
interface UM {
  estado: Estado;
  tarde: boolean; // pagó después del vencimiento (o aún debe)
  fecha: Date | null;
  rechazos: number; // pagos rechazados: en pasado, antes de pagar bien; en el actual, el cargo sigue pendiente
  metodo: string;
  ref: string;
  total: number; // total ordinario (sin mora ni extraordinarios), centavos
}
const MESES_MIGUEL_TARDE = 3; // feb-2026
const estados: UM[][] = unidades.map(() => []);
const METODOS = [['transferencia', 35], ['yape', 30], ['plin', 15], ['efectivo', 12], ['tarjeta', 8]] as const;
for (const u of unidades) {
  for (let m = 0; m <= ACTUAL; m++) {
    const { anio, mes } = MESES[m]!;
    const venc = utc(anio, mes, 15);
    let estado: Estado = 'pagado';
    let tarde = false;
    let rechazos = 0;
    if (u.moroso && m >= MESES.length - u.moroso) {
      estado = 'pendiente';
      tarde = true;
    } else if (u === U_MIGUEL) {
      if (m === ACTUAL) estado = 'pendiente';
      else tarde = m === MESES_MIGUEL_TARDE;
    } else if (u === U_JAVIER) {
      if (m === ACTUAL) estado = 'pendiente';
      else tarde = rnd() < 0.05;
    } else if (u === U_VALENTINA && m === ACTUAL) {
      estado = 'en_revision';
    } else if (m < ACTUAL) {
      tarde = rnd() < 0.09;
      rechazos = rnd() < 0.015 ? 1 : 0;
    } else {
      estado = pesos<Estado>([['pagado', 64], ['en_revision', 8.5], ['pendiente', 27.5]]);
      if (estado === 'pendiente' && rnd() < 0.07) rechazos = 1;
    }
    let fecha: Date | null = null;
    if (estado === 'pagado') {
      if (m < ACTUAL) fecha = tarde ? new Date(venc.getTime() + entre(2, 20) * DIA + entre(14, 23) * 3600000) : utc(anio, mes, entre(2, 15), entre(14, 23), entre(0, 59));
      else {
        fecha = utc(anio, mes, entre(2, 23), entre(14, 23), entre(0, 59));
        tarde = fecha > venc;
      }
    } else if (estado === 'en_revision') {
      fecha = utc(anio, mes, entre(19, 23), entre(14, 23), entre(0, 59));
    } else if (rechazos) {
      fecha = utc(anio, mes, entre(17, 22), entre(14, 23), entre(0, 59));
    }
    const metodo = pesos(METODOS);
    const ref = metodo === 'efectivo' ? `REC-${entre(1000, 9999)}` : metodo === 'tarjeta' ? `POS-${entre(100000, 999999)}` : `OP-${entre(10000000, 99999999)}`;
    estados[u.idx]!.push({ estado, tarde, fecha, rechazos, metodo, ref, total: 0 });
  }
}

// ───────────────────────────── siembra ─────────────────────────────
async function limpiar() {
  // Mismo orden que seed.ts + tablas nuevas. NO se tocan ClaveIntegracion, ModeloIA, SyncModelosIA ni EstadoIA (llavero local).
  await prisma.auditoria.deleteMany({});
  await prisma.comunicado.deleteMany({});
  await prisma.notificacion.deleteMany({});
  await prisma.evaluacionComprobante.deleteMany({});
  await prisma.archivoComprobante.deleteMany({});
  await prisma.pago.deleteMany({});
  await prisma.reciboConceptoUnidad.deleteMany({});
  await prisma.reciboConcepto.deleteMany({});
  await prisma.recibo.deleteMany({});
  await prisma.concepto.deleteMany({});
  await prisma.tareaMantenimiento.deleteMany({});
  await prisma.proveedorComplejo.deleteMany({});
  await prisma.proveedor.deleteMany({});
  await prisma.contratoAdministracion.deleteMany({});
  await prisma.medioPago.deleteMany({});
  await prisma.juntaDirectiva.deleteMany({}); // sus miembros se van por cascada
  await prisma.mensajeIA.deleteMany({});
  await prisma.conversacionIA.deleteMany({});
  await prisma.tokenApi.deleteMany({});
  await prisma.sesion.deleteMany({});
  await prisma.unidad.deleteMany({});
  await prisma.piso.deleteMany({});
  await prisma.estructura.deleteMany({});
  await prisma.complejoHabitacional.deleteMany({});
  await prisma.empresaAdministradora.deleteMany({});
  await prisma.usuario.deleteMany({});
}

async function main() {
  const t0 = Date.now();
  await limpiar();

  const empresa = await prisma.empresaAdministradora.create({
    data: { nombre: 'Gestión Urbana SAC', ruc: '20123456789', direccion: 'Av. Javier Prado 1234, Lima', telefono: '012345678', email: 'contacto@gestionurbana.com', representante_legal: 'Rosa Benavides', estado: 'activa' },
  });
  const empresaAnterior = await prisma.empresaAdministradora.create({
    data: { nombre: 'Servicios del Edificio SAC', ruc: '20987654321', direccion: 'Av. Arequipa 800, Lince, Lima', telefono: '013456789', email: 'admin@serviciosededificio.com', representante_legal: 'Carlos Mendoza', estado: 'activa' },
  });
  const complejo = await prisma.complejoHabitacional.create({
    data: { nombre: 'Condominio Los Libertadores de Surco', tipo: 'condominio', direccion: 'Av. Libertadores 1500, Santiago de Surco, Lima', empresa_id: empresa.id, descripcion: '14 blocks de 8 pisos con 4 departamentos por piso (448 unidades), áreas verdes y zona de juegos.' },
  });
  // Contrato de administración: Gestión Urbana SAC es la vigente desde 2024; Servicios del Edificio SAC fue la anterior (cerrada).
  await prisma.contratoAdministracion.create({
    data: { complejo_id: complejo.id, empresa_id: empresaAnterior.id, fecha_inicio: new Date('2022-01-01'), fecha_fin: new Date('2024-02-29'), observaciones: 'Contrato anterior, cerrado al cambiar de administradora.' },
  });
  await prisma.contratoAdministracion.create({
    data: { complejo_id: complejo.id, empresa_id: empresa.id, fecha_inicio: new Date('2024-03-01'), observaciones: 'Contrato vigente desde marzo de 2024.' },
  });

  // Personal (cuentas de prueba del Login, mismas contraseñas).
  const personal = [
    { nombre: 'Miguel Gargurevich', email: 'miguel.gargurevich@admin.com', telefono: '987654321', rol: 'superadmin', password: 'admin1234', conEmpresa: false },
    { nombre: 'Ana López', email: 'ana.lopez@gestionurbana.com', telefono: '987654324', rol: 'admin', password: 'admin1234', conEmpresa: true },
    { nombre: 'Pedro Sánchez', email: 'pedro.sanchez@gestionurbana.com', telefono: '987654325', rol: 'seguridad', password: 'seg1234', conEmpresa: true },
    { nombre: 'María Fernández', email: 'maria.fernandez@gestionurbana.com', telefono: '987654326', rol: 'mantenimiento', password: 'mtto1234', conEmpresa: true },
    { nombre: 'Lucía Rojas', email: 'limpieza@prueba.house', telefono: '987654327', rol: 'limpieza', password: 'pers1234', conEmpresa: true },
    { nombre: 'Carlos Quispe', email: 'jardineria@prueba.house', telefono: '987654328', rol: 'jardineria', password: 'pers1234', conEmpresa: true },
  ];
  const staff = await prisma.usuario.createManyAndReturn({
    data: await Promise.all(
      personal.map(async (p) => ({
        nombre: p.nombre, email: p.email, telefono: p.telefono, rol: p.rol, password_hash: await hash(p.password),
        ...(p.conEmpresa ? { empresa_id: empresa.id, complejo_id: complejo.id } : {}),
      })),
    ),
    select: { id: true, email: true },
  });
  const idStaff = (email: string) => staff.find((s) => s.email === email)!.id;
  const ana = idStaff('ana.lopez@gestionurbana.com');
  const mtto = idStaff('maria.fernandez@gestionurbana.com');

  // Estructuras (blocks), pisos y unidades.
  const blocks = await prisma.estructura.createManyAndReturn({
    data: Array.from({ length: BLOCKS }, (_, i) => ({ nombre: `Block ${i + 1}`, tipo: 'block', complejo_id: complejo.id })),
    select: { id: true, nombre: true },
  });
  const blockId = (b: number) => blocks.find((x) => x.nombre === `Block ${b}`)!.id;
  const pisosDb = await prisma.piso.createManyAndReturn({
    data: blocks.flatMap((b) => Array.from({ length: PISOS }, (_, p) => ({ numero: p + 1, estructura_id: b.id }))),
    select: { id: true, numero: true, estructura_id: true },
  });
  const pisoId = (b: number, p: number) => pisosDb.find((x) => x.estructura_id === blockId(b) && x.numero === p)!.id;

  // Junta: presidente (Miguel en el Block 1) y tesorero por block, entre dueños de una sola unidad, sin deuda.
  const conteoDueno = new Map<number, number>();
  for (const u of unidades) conteoDueno.set(u.duenoKey, (conteoDueno.get(u.duenoKey) ?? 0) + 1);
  for (let b = 1; b <= BLOCKS; b++) {
    const elegibles = barajar(unidades.filter((u) => u.block === b && !u.moroso && !especiales.has(u) && conteoDueno.get(u.duenoKey) === 1));
    const [pres, tes] = b === 1 ? [U_MIGUEL, elegibles[0]!] : [elegibles[0]!, elegibles[1]!];
    const asigna = (u: Plan, cargo: 'presidente' | 'tesorero') => Object.assign(personas[u.duenoKey]!, { cargo_junta: cargo, estructura_id: blockId(b) });
    asigna(pres, 'presidente');
    asigna(tes, 'tesorero');
  }

  // Residentes (propietarios e inquilinos).
  const aCrear = personas.filter((p) => p.nombre !== '');
  const conCredenciales = await Promise.all(aCrear.map(async (p) => ({ p, h: await hash(p.password) })));
  for (const lote of trozos(conCredenciales, 500)) {
    const creados = await prisma.usuario.createManyAndReturn({
      data: lote.map(({ p, h }) => ({
        nombre: p.nombre, email: p.email, telefono: p.telefono, rol: p.rol, password_hash: h,
        complejo_id: complejo.id, // el residente no lleva empresa: es la del condominio de sus unidades
        ...(p.cargo_junta ? { cargo_junta: p.cargo_junta, estructura_id: p.estructura_id } : {}),
      })),
      select: { id: true, email: true },
    });
    const porEmail = new Map(creados.map((c) => [c.email, c.id]));
    for (const { p } of lote) p.id = porEmail.get(p.email)!;
  }
  const idPersona = (k: number) => personas[k]!.id!;

  const unidadesDb = await prisma.unidad.createManyAndReturn({
    data: unidades.map((u) => ({
      codigo: u.codigo, tipo: 'departamento', estructura_id: blockId(u.block), piso_id: pisoId(u.block, u.piso), complejo_id: complejo.id, empresa_id: empresa.id,
      descripcion: `Departamento ${u.num} · Block ${u.block}, piso ${u.piso}`, propietario_id: idPersona(u.duenoKey), inquilino_id: u.inquilinoKey != null ? idPersona(u.inquilinoKey) : null, estado: 'activa',
    })),
    select: { id: true, codigo: true },
  });
  const unidadId = new Map(unidadesDb.map((u) => [u.codigo, u.id]));
  const idU = (u: Plan) => unidadId.get(u.codigo)!;
  const pagadorDe = (u: Plan) => idPersona(u.inquilinoKey ?? u.duenoKey);

  // Proveedores del directorio de Gestión Urbana SAC, asignados al condominio.
  const proveedores = await prisma.proveedor.createManyAndReturn({
    data: [
      { razon_social: 'Ascensores del Sur SAC', ruc: '20111111111', rubro: 'ascensores', contacto_nombre: 'Renato Huamaní', telefono: '991112233', email: 'servicio@ascensoresdelsur.com.pe', notas: 'Mantenimiento mensual de ascensores Blocks 1-7.', activo: true, empresa_id: empresa.id },
      { razon_social: 'Tuberías Lima EIRL', ruc: '20222222222', rubro: 'gasfiteria', contacto_nombre: 'Sandra Cáceres', telefono: '992223344', email: 'contacto@tuberiaslima.com.pe', notas: 'Reparación de filtraciones y cambio de grifería.', activo: true, empresa_id: empresa.id },
      { razon_social: 'Pinturas Andina SAC', ruc: '20333333333', rubro: 'pintura', contacto_nombre: 'Miguel Quispe', telefono: '993334455', email: 'ventas@pinturasandina.com.pe', notas: 'Pintura de áreas comunes y pasillos.', activo: true, empresa_id: empresa.id },
      { razon_social: 'Eléctrica Central SAC', ruc: '20444444444', rubro: 'electricidad', contacto_nombre: 'Luis Torres', telefono: '994445566', email: 'luis@electricacentral.com.pe', notas: 'Mantenimiento de luminarias y tableros eléctricos.', activo: true, empresa_id: empresa.id },
      { razon_social: 'Jardines del Sur', ruc: '20555555555', rubro: 'jardineria', contacto_nombre: 'Rosa Condori', telefono: '995556677', email: 'rosa@jardinesdelsur.com.pe', notas: 'Jardinería y limpieza de áreas verdes.', activo: true, empresa_id: empresa.id },
      { razon_social: 'Fumigación Rápida EIRL', ruc: '20666666666', rubro: 'fumigacion', contacto_nombre: 'Jorge Valdivia', telefono: '996667788', email: 'jvaldivia@fumigacionrapida.com.pe', notas: 'Control de plagas cada trimestre.', activo: true, empresa_id: empresa.id },
      { razon_social: 'Cerraduras Lima', ruc: '20777777777', rubro: 'cerrajeria', contacto_nombre: 'Patricia Salas', telefono: '997778899', email: 'patricia@cerraduraslima.com.pe', notas: 'Cambio de cerraduras y cerrajería de emergencia.', activo: true, empresa_id: empresa.id },
      { razon_social: 'Servicios Generales del Centro SAC', ruc: '20888888888', rubro: 'limpieza', contacto_nombre: 'Martha Paredes', telefono: '998889900', email: 'martha@serviciosgenerales.com.pe', notas: 'Limpieza profunda de áreas comunes.', activo: true, empresa_id: empresa.id },
      { razon_social: 'Carpintería San Borja', ruc: '20999999999', rubro: 'carpinteria', contacto_nombre: 'Fernando Espinoza', telefono: '999990011', email: 'fespinoza@carpenteria.com.pe', notas: 'Reparación de puertas y muebles de áreas comunes.', activo: true, empresa_id: empresa.id },
      { razon_social: 'Multiservicios Norte', ruc: '20000000001', rubro: 'otros', contacto_nombre: 'Doris Flores', telefono: '990001122', email: 'dflores@multiserviciosnorte.com.pe', notas: 'Otros servicios varios.', activo: false, empresa_id: empresa.id },
    ],
    select: { id: true, razon_social: true },
  });
  // `createManyAndReturn` no admite relaciones anidadas: el vínculo con el condominio va aparte.
  await prisma.proveedorComplejo.createMany({ data: proveedores.map((p) => ({ proveedor_id: p.id, complejo_id: complejo.id })) });
  const idProveedor = (razon: string) => proveedores.find((p) => p.razon_social === razon)!.id;
  const juntaDe = (b: number) => personas.filter((p) => p.cargo_junta && p.estructura_id === blockId(b)).map((p) => p.id!);

  // Juntas directivas: una gestión vigente por block (desde el 1 de enero de 2026, con el presidente y el tesorero que llevan el cargo) y, en el
  // Block 1, la gestión anterior ya cerrada (2024-2025, otros cuatro vecinos y su cuenta) para ver el historial. El correo es de ejemplo: nunca sale un correo real.
  const juntaVigente = new Map<number, number>();
  for (let b = 1; b <= BLOCKS; b++) {
    const miembros = personas.filter((p) => p.cargo_junta && p.estructura_id === blockId(b));
    const j = await prisma.juntaDirectiva.create({
      data: {
        complejo_id: complejo.id, estructura_id: blockId(b), desde: new Date(Date.UTC(2026, 0, 1)), correo: `junta.block${b}@loslibertadores.example`, creado_por_id: ana,
        miembros: { create: miembros.map((p) => ({ usuario_id: p.id!, cargo: p.cargo_junta! })) },
      },
      select: { id: true },
    });
    juntaVigente.set(b, j.id);
  }
  const anterioresB1 = barajar(unidades.filter((u) => u.block === 1 && !u.moroso && !especiales.has(u) && conteoDueno.get(u.duenoKey) === 1 && !personas[u.duenoKey]!.cargo_junta)).slice(0, 4);
  const cargosAnteriores = ['presidente', 'tesorero', 'secretario', 'vocal'] as const;
  const juntaB1Anterior = await prisma.juntaDirectiva.create({
    data: {
      complejo_id: complejo.id, estructura_id: blockId(1), desde: new Date(Date.UTC(2024, 0, 1)), hasta: new Date(Date.UTC(2025, 11, 31)), correo: 'junta.block1.2024@loslibertadores.example',
      notas: 'Gestión 2024-2025', creado_por_id: ana,
      miembros: { create: anterioresB1.map((u, i) => ({ usuario_id: idPersona(u.duenoKey), cargo: cargosAnteriores[i]! })) },
    },
    select: { id: true },
  });

  // Medios de pago: cuenta del condominio + Yape/Plin del tesorero en varios blocks (cada una, en la junta vigente de su block).
  const medios: Prisma.MedioPagoCreateManyInput[] = [
    { complejo_id: complejo.id, estructura_id: null, tipo: 'banco', banco: 'BCP', tipo_cuenta: 'corriente', numero_cuenta: '19427318492051', cci: '00219412731849205169', titular: 'Asociación de Propietarios Los Libertadores de Surco', documento_titular: '20512345678', orden: 0, creado_por_id: ana },
  ];
  for (let b = 1; b <= BLOCKS; b++) {
    if (b !== 1 && b % 3 !== 0 && b !== 7 && b !== 12) continue;
    const tes = personas.find((p) => p.cargo_junta === 'tesorero' && p.estructura_id === blockId(b))!;
    const conQr = b % 2 === 1;
    const qr = conQr ? png(64, 64, b, 'qr') : null;
    medios.push({
      complejo_id: complejo.id, estructura_id: blockId(b), tipo: b % 2 === 1 ? 'yape' : 'plin', celular: tes.telefono, titular: tes.nombre, orden: 1, creado_por_id: tes.id!, junta_id: juntaVigente.get(b)!,
      ...(qr ? { qr_nombre: `qr-block-${b}.png`, qr_tipo_mime: 'image/png', qr_datos: new Uint8Array(qr) } : {}),
    });
  }
  // La cuenta de la gestión anterior del Block 1: inactiva (los vecinos ya no la ven) y sólo en el historial.
  medios.push({
    complejo_id: complejo.id, estructura_id: blockId(1), tipo: 'banco', banco: 'Interbank', tipo_cuenta: 'ahorros', numero_cuenta: '8983012345678', cci: '00389800123456789012',
    titular: personas[anterioresB1[0]!.duenoKey]!.nombre, orden: 0, activo: false, creado_por_id: ana, junta_id: juntaB1Anterior.id,
  });
  await prisma.medioPago.createMany({ data: medios });

  // Conceptos.
  const defConceptos = [
    { k: 'agua', nombre: 'Agua del departamento', descripcion: 'Consumo propio de agua de cada departamento (según su medidor)', tipo_monto: 'variable' },
    { k: 'aguaCom', nombre: 'Agua de áreas comunes', descripcion: 'Consumo de agua de jardines, cisterna y áreas comunes', tipo_monto: 'variable' },
    { k: 'luzCom', nombre: 'Luz de áreas comunes', descripcion: 'Consumo eléctrico de pasillos, ascensores y áreas comunes', tipo_monto: 'variable' },
    { k: 'limpieza', nombre: 'Servicio de limpieza', descripcion: 'Limpieza de áreas comunes de los blocks', tipo_monto: 'fijo' },
    { k: 'seguridad', nombre: 'Servicio de seguridad', descripcion: 'Vigilancia 24 horas del condominio', tipo_monto: 'fijo' },
    { k: 'contBlock', nombre: 'Contingencia del block', descripcion: 'Fondo para imprevistos del block', tipo_monto: 'fijo' },
    { k: 'contCond', nombre: 'Contingencia del condominio', descripcion: 'Fondo para imprevistos del condominio', tipo_monto: 'fijo' },
    { k: 'mora', nombre: 'Mora', descripcion: 'Recargo del 10 % del recibo del mes anterior no pagado a tiempo', tipo_monto: 'variable' },
    { k: 'extraAscensor', nombre: 'Reparación del ascensor — Block 7', descripcion: 'Gasto extraordinario aprobado por la junta del Block 7', tipo_monto: 'fijo' },
    { k: 'extraBomba', nombre: 'Cambio de bomba de agua', descripcion: 'Gasto extraordinario aprobado por la junta del condominio', tipo_monto: 'fijo' },
  ] as const;
  const conceptosDb = await prisma.concepto.createManyAndReturn({ data: defConceptos.map(({ k: _k, ...c }) => ({ ...c, empresa_id: empresa.id, activo: !_k.startsWith('extra') })), select: { id: true, nombre: true } });
  const conceptoId = (k: string) => conceptosDb.find((c) => c.nombre === defConceptos.find((d) => d.k === k)!.nombre)!.id;

  // Recibos: uno por mes; cargos por unidad en memoria y luego en lotes.
  interface Cargo { rcKey: string; unidad: Plan; m: number; k: string; monto: number }
  const cargos: Cargo[] = [];
  const refPorMes: { k: string; ref: number; orden: number }[][] = [];
  const recibosDb: { id: number; m: number }[] = [];
  const rcId = new Map<string, number>(); // `${m}:${k}` → id de ReciboConcepto
  for (let m = 0; m <= ACTUAL; m++) {
    const { anio, mes } = MESES[m]!;
    const aguaCom = Math.round((800 + rnd() * 400) / 10) * 10;
    const luzCom = Math.round((1500 + rnd() * 700) / 10) * 10;
    const limpieza = pesos([[3500, 5], [3550, 2], [3600, 1]] as const);
    const seguridad = pesos([[7000, 7], [7200, 1]] as const);
    const fila: Record<string, number> = { aguaCom, luzCom, limpieza, seguridad, contBlock: 1000, contCond: 1500 };
    const otros = aguaCom + luzCom + limpieza + seguridad + 1000 + 1500;
    const porUnidad = new Map<number, number>();
    let sumaAgua = 0;
    for (const u of unidades) {
      const raw = Math.round(u.aguaBase * ESTACION[m]! * (0.93 + rnd() * 0.14));
      const agua = Math.max(2500, 20100 - otros, Math.min(7000, 25900 - otros, raw));
      porUnidad.set(u.idx, agua);
      sumaAgua += agua;
      estados[u.idx]![m]!.total = agua + otros;
      cargos.push({ rcKey: `${m}:agua`, unidad: u, m, k: 'agua', monto: agua });
    }
    const orden: { k: string; ref: number }[] = [{ k: 'agua', ref: Math.round(sumaAgua / unidades.length) }];
    for (const k of ['aguaCom', 'luzCom', 'limpieza', 'seguridad', 'contBlock', 'contCond']) {
      orden.push({ k, ref: fila[k]! });
      for (const u of unidades) cargos.push({ rcKey: `${m}:${k}`, unidad: u, m, k, monto: fila[k]! });
    }
    // Mora: 10 % del total ordinario del mes anterior, a quien pagó tarde o aún debe.
    if (m > 0) {
      const moras = unidades.filter((u) => estados[u.idx]![m - 1]!.tarde).map((u) => ({ u, monto: Math.round(estados[u.idx]![m - 1]!.total * 0.1) }));
      if (moras.length) {
        orden.push({ k: 'mora', ref: Math.round(moras.reduce((s, x) => s + x.monto, 0) / moras.length) });
        for (const x of moras) cargos.push({ rcKey: `${m}:mora`, unidad: x.u, m, k: 'mora', monto: x.monto });
      }
    }
    if (m === 4) {
      orden.push({ k: 'extraAscensor', ref: 6000 });
      for (const u of unidades.filter((x) => x.block === 7)) cargos.push({ rcKey: `${m}:extraAscensor`, unidad: u, m, k: 'extraAscensor', monto: 6000 });
    }
    if (m === 9) {
      orden.push({ k: 'extraBomba', ref: 4000 });
      for (const u of unidades) cargos.push({ rcKey: `${m}:extraBomba`, unidad: u, m, k: 'extraBomba', monto: 4000 });
    }
    refPorMes.push(orden.map((o, i) => ({ ...o, orden: i + 1 })));
    const recibo = await prisma.recibo.create({
      data: {
        descripcion: `Mantenimiento de ${periodoTexto(mes, anio)} — Condominio Los Libertadores de Surco`,
        fecha_emision: utc(anio, mes, 1), fecha_vencimiento: utc(anio, mes, 15), mes, anio, estado: 'emitido', empresa_id: empresa.id, complejo_id: complejo.id, creado_por_id: ana,
        created_at: utc(anio, mes, 1, 14), updated_at: utc(anio, mes, 1, 14),
      },
    });
    recibosDb.push({ id: recibo.id, m });
    const rcs = await prisma.reciboConcepto.createManyAndReturn({
      data: refPorMes[m]!.map((o) => ({ recibo_id: recibo.id, concepto_id: conceptoId(o.k), monto: dec(o.ref), es_recargo: o.k === 'mora', orden: o.orden })),
      select: { id: true, concepto_id: true },
    });
    for (const o of refPorMes[m]!) rcId.set(`${m}:${o.k}`, rcs.find((r) => r.concepto_id === conceptoId(o.k))!.id);
  }

  // Cargos por unidad.
  const nombreMes = (m: number) => periodoTexto(MESES[m]!.mes, MESES[m]!.anio);
  const cargoId = new Map<string, number>(); // `${rcId}:${unidadId}`
  for (const lote of trozos(cargos, 5000)) {
    const creados = await prisma.reciboConceptoUnidad.createManyAndReturn({
      data: lote.map((c) => {
        const e = estados[c.unidad.idx]![c.m]!;
        const pagado = e.estado === 'pagado';
        return {
          recibo_concepto_id: rcId.get(c.rcKey)!, unidad_id: idU(c.unidad), monto: dec(c.monto),
          estado_pago: e.estado === 'en_revision' ? 'en_revision' : pagado ? 'pagado' : 'pendiente', fecha_pago: pagado ? e.fecha : null,
          observaciones: c.k === 'mora' ? `Recargo por no pagar a tiempo el recibo de ${nombreMes(c.m - 1)}` : null,
          created_at: utc(MESES[c.m]!.anio, MESES[c.m]!.mes, 1, 14),
        };
      }),
      select: { id: true, recibo_concepto_id: true, unidad_id: true },
    });
    for (const c of creados) cargoId.set(`${c.recibo_concepto_id}:${c.unidad_id}`, c.id);
  }

  // Pagos del mantenimiento: un pago por departamento y mes, repartido en un `Pago` por cargo con el mismo `grupo`.
  const pagos: Prisma.PagoCreateManyInput[] = [];
  const MOTIVOS = ['El voucher no corresponde al monto del recibo', 'La operación no aparece en el estado de cuenta', 'El comprobante está borroso: súbelo de nuevo'];
  const valida = (u: Plan, metodo: string) => (metodo === 'efectivo' ? ana : elige([...juntaDe(u.block), ana]));
  const porMantenimiento = new Map<string, Cargo[]>(); // `${unidad.idx}:${m}` (en el orden de los conceptos)
  for (const c of cargos) {
    const k = `${c.unidad.idx}:${c.m}`;
    porMantenimiento.set(k, [...(porMantenimiento.get(k) ?? []), c]);
  }
  let grupos = 0;
  let sueltos = 0;
  for (const delMes of porMantenimiento.values()) {
    const { unidad: u, m } = delMes[0]!;
    const e = estados[u.idx]![m]!;
    const suelto = u.idx % 29 === 0 && m <= ACTUAL - 2; // pagos antiguos por cargo, sin grupo
    const emitir = (campos: Partial<Prisma.PagoCreateManyInput>, fecha: Date) => {
      const grupo = suelto ? null : randomUUID();
      if (suelto) sueltos += delMes.length;
      else grupos++;
      delMes.forEach((c, i) => {
        const idCargo = cargoId.get(`${rcId.get(c.rcKey)!}:${idU(u)}`)!;
        pagos.push({
          recibo_concepto_unidad_id: idCargo, monto: dec(c.monto), usuario_id: pagadorDe(u), metodo_pago: e.metodo, referencia: e.ref,
          fecha_pago: fecha, created_at: fecha, ...(grupo ? { grupo, grupo_principal: i === 0 } : {}), ...campos,
        });
      });
    };
    if (e.rechazos && e.fecha) {
      const antes = e.estado === 'pagado' ? new Date(e.fecha.getTime() - DIA) : e.fecha;
      emitir({ referencia: `OP-${entre(10000000, 99999999)}`, estado_validacion: 'rechazado', validado_por_id: valida(u, e.metodo), validado_at: new Date(antes.getTime() + 6 * 3600000), motivo_rechazo: MOTIVOS[(u.idx + m) % MOTIVOS.length]! }, antes);
    }
    if (e.estado === 'pagado' && e.fecha) {
      emitir({ estado_validacion: 'validado', validado_por_id: valida(u, e.metodo), validado_at: new Date(Math.min(e.fecha.getTime() + DIA, HOY.getTime())) }, e.fecha);
    } else if (e.estado === 'en_revision' && e.fecha) {
      emitir({ estado_validacion: 'por_validar' }, e.fecha);
    }
  }
  const pagosDb: { id: number; recibo_concepto_unidad_id: number | null; estado_validacion: string; metodo_pago: string | null; fecha_pago: Date; grupo: string | null; grupo_principal: boolean }[] = [];
  for (const lote of trozos(pagos, 5000)) {
    pagosDb.push(...(await prisma.pago.createManyAndReturn({ data: lote, select: { id: true, recibo_concepto_unidad_id: true, estado_validacion: true, metodo_pago: true, fecha_pago: true, grupo: true, grupo_principal: true } })));
  }

  // Comprobantes de los pagos por validar: UNO por pago del mantenimiento (en su pago principal) o por pago suelto (PNG pequeño generado, distinto por pago).
  const porValidar = pagosDb.filter((p) => p.estado_validacion === 'por_validar' && (p.grupo == null || p.grupo_principal));
  const comprobantes = porValidar.map((p) => {
    const bytes = png(48, 64, p.id, 'voucher');
    return { pago_id: p.id, nombre: `voucher-${p.id}.png`, tipo_mime: 'image/png', tamano: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), datos: new Uint8Array(bytes), created_at: p.fecha_pago };
  });
  for (const lote of trozos(comprobantes, 200)) await prisma.archivoComprobante.createMany({ data: lote });
  console.log(`Pagos del mantenimiento (grupos): ${grupos} · pagos sueltos por cargo (antiguos): ${sueltos}`);

  // Tareas de mantenimiento.
  const tarea = (titulo: string, descripcion: string, estado: string, u: Plan, creada: Date, cierre?: Date, proveedorId?: number): Prisma.TareaMantenimientoCreateManyInput => ({
    titulo, descripcion, estado, unidad_id: idU(u), asignado_id: proveedorId ? null : mtto, proveedor_id: proveedorId ?? null, creado_por_id: ana, fecha_creacion: creada, fecha_cierre: cierre ?? null,
  });
  await prisma.tareaMantenimiento.createMany({
    data: [
      tarea('Reparación del ascensor — Block 7', 'El ascensor principal del Block 7 se detiene entre pisos; se cambia el tablero de control.', 'completada', porCodigo.get('B07-101')!, utc(2026, 2, 20), utc(2026, 3, 18), idProveedor('Ascensores del Sur SAC')),
      tarea('Cambio de bomba de agua', 'La bomba de la cisterna central falló; se reemplaza por una de 5 HP.', 'completada', porCodigo.get('B04-101')!, utc(2026, 7, 28), utc(2026, 8, 14)),
      tarea('Cambio de luminarias LED', 'Reemplazo de luminarias de los pasillos del Block 1 y Block 2.', 'completada', porCodigo.get('B01-101')!, utc(2026, 5, 6), utc(2026, 5, 12), idProveedor('Eléctrica Central SAC')),
      tarea('Ascensor del Block 3 con ruido al subir', 'Vecinos reportan ruido metálico entre los pisos 4 y 5. Pendiente de la visita técnica.', 'en_progreso', porCodigo.get('B03-401')!, utc(2026, 10, 12), undefined, idProveedor('Ascensores del Sur SAC')),
      tarea('Luminaria del pasillo del piso 6 apagada', 'Block 9, piso 6: dos luminarias no encienden.', 'pendiente', porCodigo.get('B09-601')!, utc(2026, 10, 19), undefined, idProveedor('Eléctrica Central SAC')),
      tarea('Limpieza de la cisterna', 'Limpieza y desinfección anual de la cisterna del condominio.', 'pendiente', porCodigo.get('B14-101')!, utc(2026, 10, 21), undefined, idProveedor('Servicios Generales del Centro SAC')),
      tarea('Portón vehicular no cierra del todo', 'El sensor del portón de la entrada principal se descalibra con lluvia.', 'en_progreso', porCodigo.get('B02-101')!, utc(2026, 10, 8), undefined, idProveedor('Cerraduras Lima')),
      tarea('Reparación de filtración en la azotea', 'Filtración en la azotea del Block 11; se llega a los departamentos del piso 8.', 'pendiente', porCodigo.get('B11-801')!, utc(2026, 10, 22), undefined, idProveedor('Tuberías Lima EIRL')),
      tarea('Pintura de pasillos del Block 1', 'Repintado de los pasillos y zonas de paso del primer block.', 'pendiente', porCodigo.get('B01-101')!, utc(2026, 10, 23), undefined, idProveedor('Pinturas Andina SAC')),
      tarea('Fumigación trimestral', 'Control de plagas en áreas verdes y cuartos de basura.', 'pendiente', porCodigo.get('B14-101')!, utc(2026, 10, 24), undefined, idProveedor('Fumigación Rápida EIRL')),
    ],
  });

  // Comunicados: de la administración (todo el condominio) y de la junta de algunos blocks; uno fijado y uno archivado. Sin avisos encolados.
  const miguel = idPersona(U_MIGUEL.duenoKey);
  const comunicado = (titulo: string, cuerpo: string, creado: Date, autor: number, estructura: number | null, extra: Partial<Prisma.ComunicadoCreateManyInput> = {}): Prisma.ComunicadoCreateManyInput => ({
    complejo_id: complejo.id, estructura_id: estructura, titulo, cuerpo, autor_id: autor, created_at: creado, updated_at: creado, ...extra,
  });
  await prisma.comunicado.createMany({
    data: [
      comunicado('Corte de agua el sábado 31 de octubre', 'Sedapal hará trabajos en la red de la avenida.\nEl sábado 31 no habrá agua de 9:00 a 14:00 en todo el condominio.\nGuarden agua desde el viernes.', utc(2026, 10, 26, 15), ana, null, { fijado: true, enviar_correo: true }),
      comunicado('Asamblea general de propietarios', 'Convocamos a la asamblea general ordinaria el jueves 12 de noviembre a las 19:30 en el salón de usos múltiples.\nAgenda: presupuesto 2027, cambio de la bomba de agua y elección de la junta.', utc(2026, 10, 20, 16), ana, null),
      comunicado('Fumigación trimestral', 'El sábado 24 se fumigan las áreas verdes y los cuartos de basura.\nMantengan a sus mascotas dentro de casa entre las 8:00 y las 12:00.', utc(2026, 10, 18, 14), ana, null),
      comunicado('Pintura de los pasillos del Block 1', 'Desde el lunes 2 de noviembre se pintan los pasillos del Block 1, de piso en piso.\nEviten apoyarse en las paredes mientras se secan.', utc(2026, 10, 24, 13), miguel, blockId(1)),
      comunicado('Ascensor del Block 3 en revisión', 'El técnico viene el miércoles 28 por el ruido entre los pisos 4 y 5.\nEl ascensor estará detenido de 10:00 a 12:00.', utc(2026, 10, 25, 12), juntaDe(3)[0] ?? ana, blockId(3)),
      comunicado('Horario de la piscina en invierno', 'La piscina estuvo cerrada de junio a setiembre.', utc(2026, 6, 1, 14), ana, null, { archivado_at: utc(2026, 10, 1, 12) }),
    ],
  });

  // Avisos: recibo de octubre a todos los dueños, recordatorio de vencido a los morosos y avisos de pagos rechazados.
  const reciboOct = recibosDb[ACTUAL]!;
  const ocupantes = new Map<number, Plan>();
  for (const u of unidades) if (!ocupantes.has(u.duenoKey)) ocupantes.set(u.duenoKey, u);
  const avisos: Prisma.NotificacionCreateManyInput[] = [];
  const venc = utc(2026, 10, 15);
  const aviso = (usuario: number, tipo: TipoAviso, ref: { entidad: string; id: number }, datos: { nombre: string; total: number; motivo?: string }, estado: string, cuando: Date, error?: string) => {
    const { asunto, cuerpo } = plantilla(tipo, { nombre: datos.nombre, periodo: periodoTexto(10, 2026), monto: dineroTexto(datos.total / 100, 'PEN'), vencimiento: fechaTexto(venc), motivo: datos.motivo });
    avisos.push({ usuario_id: usuario, canal: 'email', tipo, asunto, cuerpo, estado, intentos: estado === 'pendiente' ? 0 : 1, error: error ?? null, programada_para: cuando, enviada_at: estado === 'enviada' ? new Date(cuando.getTime() + 60000) : null, ref_entidad: ref.entidad, ref_id: ref.id, created_at: cuando });
  };
  for (const [key, u] of ocupantes) {
    const datos = { nombre: personas[key]!.nombre, total: estados[u.idx]![ACTUAL]!.total };
    aviso(idPersona(key), 'recibo_emitido', { entidad: 'recibo', id: reciboOct.id }, datos, u.idx % 41 === 0 ? 'error' : 'enviada', utc(2026, 10, 1, 14), u.idx % 41 === 0 ? 'Correo rechazado por el servidor de destino' : undefined);
    const e = estados[u.idx]![ACTUAL]!;
    if (e.estado === 'pendiente') aviso(idPersona(key), 'vencido', { entidad: 'recibo', id: reciboOct.id }, datos, 'enviada', utc(2026, 10, 16, 14));
    else if (e.estado === 'pagado' && e.fecha && u.idx % 3 === 0) {
      const pagoRef = pagosDb.find((p) => p.estado_validacion === 'validado' && p.recibo_concepto_unidad_id === cargoId.get(`${rcId.get(`${ACTUAL}:agua`)!}:${idU(u)}`));
      if (pagoRef) aviso(idPersona(key), 'pago_validado', { entidad: 'pago', id: pagoRef.id }, datos, 'enviada', new Date(e.fecha.getTime() + DIA));
    }
  }
  for (const u of unidades) {
    const e = estados[u.idx]![ACTUAL]!;
    if (e.estado !== 'pendiente' || !e.rechazos) continue;
    const rech = pagosDb.find((p) => p.estado_validacion === 'rechazado' && p.recibo_concepto_unidad_id === cargoId.get(`${rcId.get(`${ACTUAL}:agua`)!}:${idU(u)}`));
    if (rech) aviso(pagadorDe(u), 'pago_rechazado', { entidad: 'pago', id: rech.id }, { nombre: personas.find((p) => p.id === pagadorDe(u))!.nombre, total: e.total, motivo: MOTIVOS[(u.idx + ACTUAL) % MOTIVOS.length]! }, 'pendiente', utc(2026, 10, 23, 15));
  }
  for (const lote of trozos(avisos, 500)) await prisma.notificacion.createMany({ data: lote, skipDuplicates: true });

  await resumen(t0, { cargos: cargos.length, pagos: pagos.length, comprobantes: comprobantes.length, avisos: avisos.length, tareas: 10, medios: medios.length, proveedores: proveedores.length, contratos: 2 });
}

async function resumen(t0: number, extra: Record<string, number>) {
  const [r] = await prisma.$queryRaw<
    { unidades: bigint; recibos: bigint; emitido: Prisma.Decimal; cobrado: Prisma.Decimal; por_cobrar: Prisma.Decimal; vencido: Prisma.Decimal; por_validar: bigint; morosos: bigint; propietarios: bigint; inquilinos: bigint }[]
  >`SELECT
      (SELECT count(*) FROM "Unidad") AS unidades,
      (SELECT count(*) FROM "Recibo") AS recibos,
      (SELECT COALESCE(sum(monto), 0) FROM "ReciboConceptoUnidad") AS emitido,
      (SELECT COALESCE(sum(monto), 0) FROM "Pago" WHERE estado_validacion = 'validado') AS cobrado,
      (SELECT COALESCE(sum(monto), 0) FROM "ReciboConceptoUnidad" WHERE estado_pago <> 'pagado') AS por_cobrar,
      (SELECT COALESCE(sum(c.monto), 0) FROM "ReciboConceptoUnidad" c JOIN "ReciboConcepto" rc ON rc.id = c.recibo_concepto_id JOIN "Recibo" r ON r.id = rc.recibo_id
         WHERE c.estado_pago = 'pendiente' AND r.fecha_vencimiento < ${HOY}) AS vencido,
      (SELECT count(*) FROM "Pago" WHERE estado_validacion = 'por_validar' AND (grupo IS NULL OR grupo_principal)) AS por_validar,
      (SELECT count(DISTINCT c.unidad_id) FROM "ReciboConceptoUnidad" c JOIN "ReciboConcepto" rc ON rc.id = c.recibo_concepto_id JOIN "Recibo" r ON r.id = rc.recibo_id
         WHERE c.estado_pago = 'pendiente' AND r.fecha_vencimiento < ${HOY}) AS morosos,
      (SELECT count(*) FROM "Usuario" WHERE rol = 'propietario') AS propietarios,
      (SELECT count(*) FROM "Usuario" WHERE rol = 'inquilino') AS inquilinos`;
  const soles = (v: Prisma.Decimal) => dineroTexto(v, 'PEN');
  console.log('\n══ Seed Los Libertadores de Surco ══');
  console.log(`Unidades: ${r!.unidades} (14 blocks × 8 pisos × 4) · Recibos: ${r!.recibos} · Cargos: ${extra.cargos} · Pagos: ${extra.pagos} (${r!.por_validar} mantenimientos/pagos por validar, con comprobante)`);
  console.log(`Propietarios: ${r!.propietarios} · Inquilinos: ${r!.inquilinos} · Medios de pago: ${extra.medios} · Tareas: ${extra.tareas} · Avisos: ${extra.avisos} · Proveedores: ${extra.proveedores} · Contratos: ${extra.contratos}`);
  console.log(`Emitido: ${soles(r!.emitido)} · Cobrado (validado): ${soles(r!.cobrado)} · Por cobrar (incluye en revisión): ${soles(r!.por_cobrar)} · Vencido impago: ${soles(r!.vencido)}`);
  console.log(`Unidades morosas (con cargos vencidos): ${r!.morosos}`);
  console.log(`Hecho en ${((Date.now() - t0) / 1000).toFixed(1)} s. Cuentas: miguel@prueba.house / prop1234 (presidente del Block 1, B01-804); ana.lopez@gestionurbana.com / admin1234; limpieza@prueba.house / pers1234; jardineria@prueba.house / pers1234.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
