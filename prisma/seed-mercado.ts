/**
 * Mercado simulado: 3 empresas administradoras con varios condominios y 5 juntas de vecinos independientes (edificios de 1 block). `npm run seed:mercado`.
 *
 * - SOLO contra la base local `house_mercado` (localhost/127.0.0.1); si no, aborta sin tocar nada. Nunca `house` ni producción.
 * - Borra y recrea todo en `house_mercado` (TRUNCATE de las tablas de negocio). Determinista (PRNG con semilla fija).
 * - Datos 100 % inventados: nombres generados, correos SIEMPRE `.example`, celulares de prueba (900 + 6 dígitos), RUC ficticios.
 * - La estructura (empresas, condominios, blocks, unidades, usuarios, juntas, medios de pago, conceptos) se inserta con Prisma. Los RECIBOS y los PAGOS
 *   salen de la API real, en proceso (`createApp()`): emisión por block con su mora automática, pago del mantenimiento por la administración o la junta,
 *   pagos con voucher (por validar) y rechazos. Así los datos son los que produce Torre, no filas inventadas. Sin correo ni WhatsApp (se apagan por entorno).
 * - Las suscripciones (planes) se crean AL FINAL: durante la facturación todos operan como Gratis sin plazo, y la junta «vencida» queda en solo lectura sólo al terminar.
 * - Las contraseñas de prueba NO se imprimen: van al archivo `CREDENCIALES_JSON` (por defecto, en el directorio temporal del sistema), fuera del repo.
 *
 * Perfil de pago por departamento: ≈70 % al día (algunos meses pagan tarde → mora al mes siguiente), 15 % moroso de 1 mes (octubre), 10 % moroso de 2 a 5
 * meses, ≈3 % con pago por validar (con voucher) y ≈2 % con pago rechazado en octubre; ≈1 % tuvo un rechazo antes de pagar bien.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcrypt';

// ───────────────────────────── protección y entorno ─────────────────────────────
function exigirBaseMercado(): void {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está definida.');
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('DATABASE_URL no es una URL válida.');
  }
  const base = u.pathname.replace(/^\//, '');
  if (!['localhost', '127.0.0.1'].includes(u.hostname) || base !== 'house_mercado') {
    console.error(`✖ Este seed sólo corre contra la base local «house_mercado» (localhost); recibí «${u.hostname}/${base}». Abortado: no se tocó nada.`);
    process.exit(1);
  }
}
exigirBaseMercado();
// Sin correo, sin WhatsApp, sin IA, sin planificador: nada sale de esta máquina. (dotenv no pisa lo ya definido, ni siquiera vacío.)
for (const k of ['RESEND_API_KEY', 'MAIL_FROM', 'EVOLUTION_URL', 'EVOLUTION_APIKEY', 'GEMINI_API_KEY']) process.env[k] = '';
Object.assign(process.env, { AVISOS_PLANIFICADOR: 'off', MODELOS_SYNC: 'off', ASISTENTE_CANARY: 'off', ASISTENTE_LIMPIEZA: 'off' });

// Import dinámico: el entorno de arriba debe estar fijado antes de que se carguen la configuración y la app.
const { prisma } = await import('../src/server/db');
const { createApp } = await import('../src/server/app');
const { sembrarCatalogoComercial } = await import('../src/server/services/comercial/catalogo');

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
const rnd = mulberry32(20261104);
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const elige = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
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
const dos = (n: number) => String(n).padStart(2, '0');
const DIA = 24 * 3600 * 1000;

async function pool<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    for (;;) {
      const k = i++;
      if (k >= items.length) return;
      await fn(items[k]!, k);
    }
  }));
}

const hashes = new Map<string, string>();
async function hash(password: string) {
  let h = hashes.get(password);
  if (!h) hashes.set(password, (h = await bcrypt.hash(password, 12)));
  return h;
}
const ALFA = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const claveNueva = (prefijo: string) => `${prefijo}-${Array.from({ length: 9 }, () => ALFA[Math.floor(rnd() * ALFA.length)]).join('')}!`;

// PNG pequeño generado (voucher de ejemplo), distinto por semilla para que cada sha256 sea único.
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
function pngVoucher(semilla: number): Buffer {
  const w = 48;
  const h = 64;
  const filas: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const fila = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const v = y < 8 || (y % 9 < 2 && x > 6 && x < w - 6 && (x + semilla) % 11 > 1) ? 70 + ((semilla * 37 + y) % 90) : 245;
      const o = 1 + x * 3;
      fila[o] = v;
      fila[o + 1] = y < 8 ? 40 + (semilla % 120) : v;
      fila[o + 2] = v;
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunkPng('IHDR', ihdr), chunkPng('IDAT', deflateSync(Buffer.concat(filas))), chunkPng('IEND', Buffer.alloc(0))]);
}

// ───────────────────────────── nombres ─────────────────────────────
const NOMBRES = ['Luis', 'Carlos', 'Jorge', 'José', 'Juan', 'Miguel', 'Pedro', 'Víctor', 'Raúl', 'Óscar', 'Manuel', 'César', 'Hugo', 'Fernando', 'Ricardo', 'Alberto', 'Eduardo', 'Rafael', 'Andrés', 'Diego', 'Sergio', 'Walter', 'Julio', 'Marco', 'Percy', 'Enrique', 'Gustavo', 'Alejandro', 'Daniel', 'Roberto',
  'María', 'Rosa', 'Carmen', 'Ana', 'Luz', 'Elena', 'Patricia', 'Silvia', 'Gladys', 'Teresa', 'Julia', 'Sandra', 'Liliana', 'Martha', 'Giovanna', 'Claudia', 'Karina', 'Milagros', 'Yolanda', 'Jessica', 'Rocío', 'Verónica', 'Lucía', 'Paola', 'Cecilia', 'Mónica', 'Beatriz', 'Doris', 'Norma', 'Flor'] as const;
const APELLIDOS = ['Quispe', 'Huamán', 'Flores', 'Rojas', 'Mendoza', 'Gutiérrez', 'Vásquez', 'Castillo', 'Chávez', 'Ramos', 'Torres', 'Sánchez', 'Díaz', 'Cruz', 'Vargas', 'Salazar', 'Paredes', 'Espinoza', 'Ccori', 'Condori', 'Mamani', 'Palomino', 'Cárdenas', 'Valdivia', 'Zevallos', 'Bustamante', 'Benavides', 'Arce', 'Tello', 'Cáceres',
  'Quiroz', 'Lazo', 'Ponce', 'Montoya', 'Ávalos', 'Alarcón', 'Guerra', 'Ibáñez', 'Carrasco', 'Delgado', 'Pacheco', 'Villanueva', 'Ugarte', 'Samaniego', 'Calderón', 'Oré', 'Yupanqui', 'Aguilar', 'Neyra', 'Barrios', 'Tapia', 'Collazos', 'Farfán', 'Becerra', 'Llanos', 'Rivera', 'Bernales', 'Zegarra', 'Olivera', 'Santillán'] as const;
const nombresUsados = new Set<string>();
function nombreNuevo(): { nombre: string; n: string; ap: string } {
  for (;;) {
    const n = elige(NOMBRES);
    const a1 = elige(APELLIDOS);
    const a2 = elige(APELLIDOS);
    if (a1 === a2) continue;
    const completo = `${n} ${a1} ${a2}`;
    if (nombresUsados.has(completo)) continue;
    nombresUsados.add(completo);
    return { nombre: completo, n, ap: a1 };
  }
}
const telUsados = new Set<string>();
function telefono() {
  for (;;) {
    const t = `900${String(entre(0, 999999)).padStart(6, '0')}`; // 900 000 000 – 900 999 999: rango de prueba
    if (!telUsados.has(t)) return (telUsados.add(t), t);
  }
}

// ───────────────────────────── el mercado ─────────────────────────────
/** Montos mensuales por departamento (S/) de un condominio. `central` y `ascensor` sólo donde aplican. */
interface Tarifa { admin: number; seguridad: number; limpieza: number; aguaLuz: number; fondo: number; central?: number; ascensor?: number }
interface Staff { rol: 'seguridad' | 'mantenimiento' | 'limpieza' | 'jardineria'; n: number }
interface CondoPlan {
  nombre: string; tipo: 'condominio' | 'edificio'; direccion: string;
  blocks: number; pisos: number; porPiso: number; tipoBlock: 'block' | 'torre';
  tarifa: Tarifa; staff: Staff[];
  /** `block` = una junta por block; `unica` = una sola junta del condominio; `block+central` = por block más la junta central. */
  juntas: 'block' | 'unica' | 'block+central';
  moraMonto?: string;
  /** Blocks (1-based) con grupo de WhatsApp asignado (sólo Empresa A). `condominio` = un grupo del condominio entero. */
  grupos?: number[] | 'condominio';
  areas?: boolean;
}
interface PlanSuscripcion { plan: 'administradora' | 'pro' | 'basico' | 'gratis'; estado?: 'activa' | 'por_vencer' | 'gratis'; vigenteDias?: number; prueba?: boolean; gratisDias?: number }
interface ClientePlan {
  clave: string; tipo: 'empresa' | 'junta'; nombre: string; ruc: string; dominio: string; direccion: string;
  admins: number; sus: PlanSuscripcion; condos: CondoPlan[]; whatsapp?: boolean;
}

const T = (admin: number, seguridad: number, limpieza: number, aguaLuz: number, fondo: number, extra: Pick<Tarifa, 'central' | 'ascensor'> = {}): Tarifa => ({ admin, seguridad, limpieza, aguaLuz, fondo, ...extra });

const MERCADO: ClientePlan[] = [
  {
    clave: 'A', tipo: 'empresa', nombre: 'Administradora Andina Predial SAC', ruc: '20999000001', dominio: 'andinapredial.example', direccion: 'Av. Primavera 1200, Santiago de Surco, Lima', admins: 3,
    sus: { plan: 'administradora', estado: 'activa', vigenteDias: 150 }, whatsapp: true,
    condos: [
      { nombre: 'Residencial Los Cedros', tipo: 'condominio', direccion: 'Av. Los Cedros 450, San Borja, Lima', blocks: 14, pisos: 8, porPiso: 4, tipoBlock: 'block', tarifa: T(45, 70, 35, 28, 10, { central: 15, ascensor: 22 }), staff: [{ rol: 'seguridad', n: 3 }, { rol: 'mantenimiento', n: 2 }, { rol: 'limpieza', n: 1 }, { rol: 'jardineria', n: 1 }], juntas: 'block+central', grupos: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], areas: true },
      { nombre: 'Condominio Parque Jazmines', tipo: 'condominio', direccion: 'Jr. Los Jazmines 220, Jesús María, Lima', blocks: 6, pisos: 5, porPiso: 4, tipoBlock: 'block', tarifa: T(40, 55, 30, 22, 8, { central: 10 }), staff: [{ rol: 'seguridad', n: 1 }, { rol: 'mantenimiento', n: 1 }], juntas: 'block', grupos: [1, 2, 3, 4, 5, 6], areas: true },
      { nombre: 'Conjunto Las Orquídeas', tipo: 'condominio', direccion: 'Calle Las Orquídeas 88, Pueblo Libre, Lima', blocks: 2, pisos: 4, porPiso: 3, tipoBlock: 'block', tarifa: T(35, 40, 25, 18, 8, { central: 8 }), staff: [], juntas: 'block', grupos: [1] },
      { nombre: 'Torre Mirador del Sur', tipo: 'edificio', direccion: 'Av. del Mirador 1010, Chorrillos, Lima', blocks: 1, pisos: 12, porPiso: 5, tipoBlock: 'torre', tarifa: T(50, 65, 38, 30, 12, { ascensor: 30 }), staff: [{ rol: 'seguridad', n: 1 }], juntas: 'unica', grupos: 'condominio' },
    ],
  },
  {
    clave: 'B', tipo: 'empresa', nombre: 'Gestión Inmobiliaria Pacífico EIRL', ruc: '20999000002', dominio: 'gestionpacifico.example', direccion: 'Calle Las Gaviotas 310, Miraflores, Lima', admins: 2,
    sus: { plan: 'administradora', estado: 'activa', vigenteDias: 200 },
    condos: [
      { nombre: 'Residencial Santa Rosa de Lima', tipo: 'condominio', direccion: 'Av. Santa Rosa 700, Surquillo, Lima', blocks: 8, pisos: 6, porPiso: 4, tipoBlock: 'block', tarifa: T(42, 60, 32, 24, 9, { central: 12, ascensor: 20 }), staff: [{ rol: 'seguridad', n: 1 }, { rol: 'mantenimiento', n: 1 }], juntas: 'block+central', areas: true },
      { nombre: 'Condominio Los Pinos', tipo: 'condominio', direccion: 'Av. Los Pinos 150, La Molina, Lima', blocks: 3, pisos: 4, porPiso: 4, tipoBlock: 'block', tarifa: T(38, 48, 28, 20, 8, { central: 8 }), staff: [], juntas: 'block', areas: true },
      { nombre: 'Edificio Plaza Norte', tipo: 'edificio', direccion: 'Av. Túpac Amaru 2500, Independencia, Lima', blocks: 1, pisos: 8, porPiso: 5, tipoBlock: 'block', tarifa: T(40, 58, 30, 26, 10, { ascensor: 24 }), staff: [], juntas: 'block', moraMonto: '15.00' },
    ],
  },
  {
    clave: 'C', tipo: 'empresa', nombre: 'Servicios Vecinales Cumbre SAC', ruc: '20999000003', dominio: 'vecinalescumbre.example', direccion: 'Jr. Cumbre 55, Barranco, Lima', admins: 1,
    sus: { plan: 'pro', estado: 'activa', vigenteDias: 90 },
    condos: [
      { nombre: 'Condominio Villa Hermosa', tipo: 'condominio', direccion: 'Calle Villa Hermosa 20, Surco, Lima', blocks: 5, pisos: 5, porPiso: 2, tipoBlock: 'block', tarifa: T(30, 35, 22, 16, 6, { central: 6 }), staff: [], juntas: 'block' },
      { nombre: 'Edificio Alameda 18', tipo: 'edificio', direccion: 'Av. Alameda 18, Magdalena, Lima', blocks: 1, pisos: 6, porPiso: 3, tipoBlock: 'block', tarifa: T(32, 38, 24, 18, 6), staff: [], juntas: 'unica', moraMonto: '10.00' },
    ],
  },
  // Juntas de vecinos independientes: una sola persona jurídica (la junta) administra su edificio de 1 block, sin empresa administradora aparte.
  { clave: 'J1', tipo: 'junta', nombre: 'Junta de Propietarios Edificio Los Álamos', ruc: '20999000011', dominio: 'losalamos.example', direccion: 'Av. Los Álamos 123, Lince, Lima', admins: 1, sus: { plan: 'gratis', estado: 'gratis', gratisDias: 45 },
    condos: [{ nombre: 'Edificio Los Álamos', tipo: 'edificio', direccion: 'Av. Los Álamos 123, Lince, Lima', blocks: 1, pisos: 4, porPiso: 2, tipoBlock: 'block', tarifa: T(30, 0, 20, 12, 5), staff: [], juntas: 'unica' }] },
  { clave: 'J2', tipo: 'junta', nombre: 'Junta Vecinal Residencial San Felipe', ruc: '20999000012', dominio: 'sanfelipe.example', direccion: 'Calle San Felipe 456, Jesús María, Lima', admins: 1, sus: { plan: 'gratis', estado: 'gratis', gratisDias: -25 },
    condos: [{ nombre: 'Edificio San Felipe', tipo: 'edificio', direccion: 'Calle San Felipe 456, Jesús María, Lima', blocks: 1, pisos: 4, porPiso: 3, tipoBlock: 'block', tarifa: T(32, 0, 20, 14, 5), staff: [], juntas: 'block' }] },
  { clave: 'J3', tipo: 'junta', nombre: 'Junta de Propietarios Torre Colonial', ruc: '20999000013', dominio: 'torrecolonial.example', direccion: 'Jr. Colonial 789, Cercado de Lima', admins: 1, sus: { plan: 'basico', estado: 'activa', vigenteDias: 60 },
    condos: [{ nombre: 'Torre Colonial', tipo: 'edificio', direccion: 'Jr. Colonial 789, Cercado de Lima', blocks: 1, pisos: 5, porPiso: 4, tipoBlock: 'torre', tarifa: T(36, 30, 24, 15, 6), staff: [], juntas: 'unica' }] },
  { clave: 'J4', tipo: 'junta', nombre: 'Junta Directiva Edificio Las Gaviotas', ruc: '20999000014', dominio: 'lasgaviotas.example', direccion: 'Av. Las Gaviotas 900, Chorrillos, Lima', admins: 1, sus: { plan: 'pro', estado: 'activa', vigenteDias: 120 },
    condos: [{ nombre: 'Edificio Las Gaviotas', tipo: 'edificio', direccion: 'Av. Las Gaviotas 900, Chorrillos, Lima', blocks: 1, pisos: 8, porPiso: 4, tipoBlock: 'block', tarifa: T(40, 45, 28, 20, 8, { ascensor: 18 }), staff: [], juntas: 'block', areas: true }] },
  { clave: 'J5', tipo: 'junta', nombre: 'Asociación de Propietarios Edificio Miraflores 48', ruc: '20999000015', dominio: 'miraflores48.example', direccion: 'Av. Larco 480, Miraflores, Lima', admins: 1, sus: { plan: 'pro', estado: 'activa', vigenteDias: 18, prueba: true, gratisDias: 60 },
    condos: [{ nombre: 'Edificio Miraflores 48', tipo: 'edificio', direccion: 'Av. Larco 480, Miraflores, Lima', blocks: 1, pisos: 8, porPiso: 6, tipoBlock: 'torre', tarifa: T(48, 55, 32, 24, 10, { ascensor: 26 }), staff: [{ rol: 'seguridad', n: 1 }], juntas: 'unica' }] },
];

const MESES = [5, 6, 7, 8, 9, 10].map((mes) => ({ anio: 2026, mes })); // mayo–octubre de 2026
const ACTUAL = MESES.length - 1;
const ESTACION = [1.0, 0.96, 0.94, 0.92, 0.95, 1.02];
const METODOS = ['transferencia', 'yape', 'plin', 'efectivo', 'tarjeta'] as const;
const MOTIVOS = ['El voucher no corresponde al monto del recibo', 'La operación no aparece en el estado de cuenta', 'El comprobante está borroso: súbelo de nuevo'];

type Perfil = 'al_dia' | 'moroso1' | 'moroso_multi' | 'por_validar' | 'rechazado';
interface Dpto {
  codigo: string; bloque: number; piso: number; blockIdx: number; // bloque: 1-based; blockIdx: índice en el condominio
  duenoKey: number; inqKey: number | null; perfil: Perfil;
  mesesMora: number; // moroso_multi: cuántos meses seguidos sin pagar hasta octubre
  rechazoPrevio: number; // mes (índice) en que tuvo un rechazo antes de pagar bien, o -1
  id?: number; duenoId?: number; inqId?: number;
}
interface Persona { nombre: string; email: string; telefono: string; rol: 'propietario' | 'inquilino'; password: string; id?: number; whatsapp: boolean }
interface CondoVivo {
  plan: CondoPlan; id?: number; estructuras: { id: number; nombre: string }[]; dptos: Dpto[]; clave: string;
  juntaMiembros: { estructura: number | null; usuarios: { key: number; cargo: 'presidente' | 'tesorero' | 'secretario' }[] }[];
  recibos: Map<string, number>[]; // por mes: `${blockIdx}` → id de recibo
  conceptoIds: Record<string, number>;
}
interface ClienteVivo {
  plan: ClientePlan; empresaId?: number; condos: CondoVivo[]; personas: Persona[]; dominio: string; passAdmin: string; passVecino: string;
  admins: { nombre: string; email: string; password: string; id?: number }[];
  staff: { nombre: string; email: string; rol: string; password: string; condo: number }[];
  superadmin?: boolean;
}

const personasDe = (c: ClienteVivo, rol: 'propietario' | 'inquilino'): number => {
  const { nombre, n, ap } = nombreNuevo();
  const k = c.personas.length + 1;
  c.personas.push({ nombre, email: `${slug(n)}.${slug(ap)}.${k}@${c.dominio}`, telefono: telefono(), rol, password: c.passVecino, whatsapp: rnd() < 0.78 });
  return c.personas.length - 1;
};

// ───────────────────────────── construcción en memoria ─────────────────────────────
const vivos: ClienteVivo[] = MERCADO.map((plan) => ({ plan, condos: [], personas: [], dominio: plan.dominio, passAdmin: claveNueva('Adm'), passVecino: claveNueva('Vec'), admins: [], staff: [] }));

for (const c of vivos) {
  for (let i = 0; i < c.plan.admins; i++) {
    const { nombre, n, ap } = nombreNuevo();
    c.admins.push({ nombre, email: `${slug(n)}.${slug(ap)}@${c.dominio}`, password: i === 0 ? c.passAdmin : claveNueva('Adm') });
  }
  c.plan.condos.forEach((cp, ci) => {
    const condo: CondoVivo = { plan: cp, clave: c.plan.clave, estructuras: [], dptos: [], juntaMiembros: [], recibos: MESES.map(() => new Map()), conceptoIds: {} };
    c.condos.push(condo);
    for (let b = 1; b <= cp.blocks; b++)
      for (let p = 1; p <= cp.pisos; p++)
        for (let d = 1; d <= cp.porPiso; d++) {
          const dueno = personasDe(c, 'propietario');
          const inq = rnd() < 0.12 ? personasDe(c, 'inquilino') : null;
          const r = rnd();
          const perfil: Perfil = r < 0.7 ? 'al_dia' : r < 0.85 ? 'moroso1' : r < 0.95 ? 'moroso_multi' : r < 0.98 ? 'por_validar' : 'rechazado';
          condo.dptos.push({ codigo: `B${dos(b)}-${p}${dos(d)}`, bloque: b, piso: p, blockIdx: b - 1, duenoKey: dueno, inqKey: inq, perfil, mesesMora: perfil === 'moroso_multi' ? entre(2, 5) : 0, rechazoPrevio: perfil === 'al_dia' && rnd() < 0.015 ? entre(0, ACTUAL - 1) : -1 });
        }
    // Cada cliente tiene al menos 2 pagos por validar y 1 rechazado en octubre (en los edificios chicos el azar puede no dar ninguno).
    if (ci === c.plan.condos.length - 1) {
      const todos = c.condos.flatMap((o) => o.dptos);
      const faltaPV = Math.max(0, 2 - todos.filter((d) => d.perfil === 'por_validar').length);
      const faltaRe = Math.max(0, 1 - todos.filter((d) => d.perfil === 'rechazado').length);
      const enJunta = new Set(c.condos.flatMap((o) => o.juntaMiembros.flatMap((j) => j.usuarios.map((u) => u.key))));
      const libres = barajar(todos.filter((d) => d.perfil === 'al_dia' && d.inqKey == null && !enJunta.has(d.duenoKey)));
      libres.slice(0, faltaPV).forEach((d) => { d.perfil = 'por_validar'; d.rechazoPrevio = -1; });
      libres.slice(faltaPV, faltaPV + faltaRe).forEach((d) => { d.perfil = 'rechazado'; d.rechazoPrevio = -1; });
    }
    // Personal de los condominios grandes.
    for (const s of cp.staff)
      for (let k = 0; k < s.n; k++) {
        const { nombre, n, ap } = nombreNuevo();
        c.staff.push({ nombre, email: `${slug(n)}.${slug(ap)}.${s.rol}@${c.dominio}`, rol: s.rol, password: claveNueva('Per'), condo: ci });
      }
    // Juntas: presidente, tesorero y secretario de unidades al día (un dueño no repetido en dos juntas).
    const usados = new Set<number>();
    const elegir = (de: Dpto[]): number | null => {
      // Prefiere dueños al día; en los edificios chicos, si no alcanzan, cualquiera con un solo mes de atraso (nunca los de pago por validar o rechazado).
      const libres = de.filter((d) => !usados.has(d.duenoKey));
      const cand = barajar(libres.filter((d) => d.perfil === 'al_dia' && d.inqKey == null));
      if (!cand.length) cand.push(...barajar(libres.filter((d) => d.perfil === 'al_dia')), ...barajar(libres.filter((d) => d.perfil === 'moroso1')));
      const d = cand[0];
      if (!d) return null;
      usados.add(d.duenoKey);
      return d.duenoKey;
    };
    const armar = (estructura: number | null, de: Dpto[]) => {
      const us: { key: number; cargo: 'presidente' | 'tesorero' | 'secretario' }[] = [];
      for (const cargo of ['presidente', 'tesorero', 'secretario'] as const) {
        const k = elegir(de);
        if (k != null) us.push({ key: k, cargo });
      }
      condo.juntaMiembros.push({ estructura, usuarios: us });
    };
    if (cp.juntas === 'unica') armar(null, condo.dptos);
    else {
      for (let b = 0; b < cp.blocks; b++) armar(b, condo.dptos.filter((d) => d.blockIdx === b));
      if (cp.juntas === 'block+central') armar(null, condo.dptos);
    }
  });
}

// ───────────────────────────── cliente HTTP (la API real, en proceso) ─────────────────────────────
let BASE = '';
class Sesion {
  cookie = '';
  csrf = '';
  constructor(readonly email: string, private readonly password: string) {}
  async entrar(): Promise<this> {
    const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: this.email, password: this.password }) });
    const cuerpo = (await r.json().catch(() => ({}))) as { csrf?: string; error?: string };
    if (r.status !== 200) throw new Error(`login de ${this.email} falló con ${r.status}: ${cuerpo.error ?? ''}`);
    this.cookie = /house_sesion=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';
    this.csrf = cuerpo.csrf ?? '';
    return this;
  }
  private cab(extra: Record<string, string> = {}) {
    return { cookie: `house_sesion=${this.cookie}`, 'x-csrf-token': this.csrf, ...extra };
  }
  async json(metodo: string, ruta: string, cuerpo?: unknown): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(BASE + ruta, { method: metodo, headers: this.cab(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}), body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }
  async form(ruta: string, campos: Record<string, string>, voucher: Buffer): Promise<{ status: number; body: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const f = new FormData();
    for (const [k, v] of Object.entries(campos)) f.append(k, v);
    f.append('voucher', new Blob([new Uint8Array(voucher)], { type: 'image/png' }), 'voucher.png');
    const r = await fetch(BASE + ruta, { method: 'POST', headers: this.cab(), body: f });
    return { status: r.status, body: await r.json().catch(() => null) };
  }
}

// ───────────────────────────── siembra ─────────────────────────────
async function limpiar() {
  // Sólo `house_mercado` (lo garantiza `exigirBaseMercado`). Se conservan ModuloComercial, PlanComercial, ConfiguracionComercial e ImpuestoPais (`sembrarCatalogoComercial` los repone).
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "PagoSuscripcion","SuscripcionCondominio","ConsumoMensual","TokenVerificacionCorreo","Sesion","Auditoria","Notificacion","EnvioGrupoWhatsapp","GrupoWhatsapp","Reserva","AreaComun","Comunicado","Pago","ReciboConceptoUnidad","ReciboConcepto","Recibo","Concepto","MedioPago","MiembroJunta","JuntaDirectiva","PersonaUnidad","Unidad","Piso","Estructura","ContratoAdministracion","Usuario","ComplejoHabitacional","EmpresaAdministradora" RESTART IDENTITY CASCADE`,
  );
}

async function estructura() {
  await sembrarCatalogoComercial(prisma);
  // Superadmin de prueba (sin empresa).
  const passSuper = claveNueva('Sup');
  const superadmin = await prisma.usuario.create({ data: { nombre: 'Soporte Torre Simulación', email: 'superadmin@simulacion.example', telefono: telefono(), rol: 'superadmin', password_hash: await hash(passSuper) }, select: { id: true } });

  for (const c of vivos) {
    const emp = await prisma.empresaAdministradora.create({
      data: { nombre: c.plan.nombre, ruc: c.plan.ruc, direccion: c.plan.direccion, telefono: telefono(), email: `contacto@${c.dominio}`, representante_legal: nombreNuevo().nombre, estado: 'activa' },
    });
    c.empresaId = emp.id;
    // Administradores / cuenta de la junta (rol admin con empresa).
    for (const a of c.admins) {
      const u = await prisma.usuario.create({ data: { nombre: a.nombre, email: a.email, telefono: telefono(), rol: 'admin', password_hash: await hash(a.password), empresa_id: emp.id }, select: { id: true } });
      a.id = u.id;
    }
    // Conceptos de la empresa.
    for (const condo of c.condos) {
      const cp = condo.plan;
      const concs: { k: string; nombre: string; destino: string; desc: string }[] = [
        { k: 'admin', nombre: c.plan.tipo === 'junta' ? 'Cuota de mantenimiento' : 'Cuota de administración', destino: c.plan.tipo === 'junta' ? 'servicio' : 'administradora', desc: 'Gestión y mantenimiento general del edificio' },
        ...(cp.tarifa.seguridad > 0 ? [{ k: 'seguridad', nombre: 'Servicio de seguridad', destino: 'servicio', desc: 'Vigilancia del condominio' }] : []),
        { k: 'limpieza', nombre: 'Servicio de limpieza', destino: 'servicio', desc: 'Limpieza de áreas comunes' },
        { k: 'aguaLuz', nombre: 'Agua y luz de áreas comunes', destino: 'servicio', desc: 'Consumo de agua y electricidad de áreas comunes' },
        { k: 'fondo', nombre: 'Fondo de reserva', destino: 'ahorro_block', desc: 'Ahorro para imprevistos' },
        ...(cp.tarifa.central ? [{ k: 'central', nombre: 'Aporte a la junta central', destino: 'central', desc: 'Aporte del block a la junta central del condominio' }] : []),
        ...(cp.tarifa.ascensor ? [{ k: 'ascensor', nombre: 'Mantenimiento de ascensores', destino: 'servicio', desc: 'Contrato de mantenimiento de ascensores' }] : []),
      ];
      // Los conceptos son por empresa: un solo juego de nombres por empresa (se reutilizan entre sus condominios).
      for (const k of concs) {
        const ya = c.condos.find((o) => o.conceptoIds[k.k] != null);
        if (ya) {
          condo.conceptoIds[k.k] = ya.conceptoIds[k.k]!;
          continue;
        }
        const cr = await prisma.concepto.create({ data: { nombre: k.nombre, descripcion: k.desc, tipo_monto: 'fijo', empresa_id: emp.id, destino: k.destino }, select: { id: true } });
        condo.conceptoIds[k.k] = cr.id;
      }
      // Si un condominio de la empresa usa un concepto que otro no (central, ascensor, seguridad), se crea al primero que lo pide (arriba): los demás lo toman.
    }
    // Condominios, blocks, pisos y unidades.
    for (const condo of c.condos) {
      const cp = condo.plan;
      const cx = await prisma.complejoHabitacional.create({
        data: { nombre: cp.nombre, tipo: cp.tipo, direccion: cp.direccion, empresa_id: emp.id, descripcion: `${cp.blocks} ${cp.tipoBlock === 'torre' ? 'torre' : 'block'}${cp.blocks > 1 ? 's' : ''}, ${cp.pisos} pisos, ${cp.porPiso} departamentos por piso (${condo.dptos.length} unidades). Dato de simulación.`, ...(cp.moraMonto ? { mora_monto: cp.moraMonto } : {}) },
        select: { id: true },
      });
      condo.id = cx.id;
      await prisma.contratoAdministracion.create({ data: { complejo_id: cx.id, empresa_id: emp.id, fecha_inicio: new Date(Date.UTC(2026, 0, 1)), observaciones: c.plan.tipo === 'junta' ? 'La junta administra su edificio.' : 'Contrato vigente (simulación).' } });
      condo.estructuras = (await prisma.estructura.createManyAndReturn({
        data: Array.from({ length: cp.blocks }, (_, i) => ({ nombre: cp.tipoBlock === 'torre' ? (cp.blocks === 1 ? 'Torre A' : `Torre ${i + 1}`) : `Block ${i + 1}`, tipo: cp.tipoBlock, complejo_id: cx.id })),
        select: { id: true, nombre: true },
      })).map((e) => ({ id: e.id, nombre: e.nombre ?? '' }));
      condo.estructuras.sort((a, b) => a.id - b.id);
      const pisosDb = await prisma.piso.createManyAndReturn({ data: condo.estructuras.flatMap((e) => Array.from({ length: cp.pisos }, (_, p) => ({ numero: p + 1, estructura_id: e.id }))), select: { id: true, numero: true, estructura_id: true } });
      // Residentes de ESTE condominio (sin empresa: la derivan de sus unidades).
      const duenos = new Set(condo.dptos.map((d) => d.duenoKey));
      const inqs = new Set(condo.dptos.map((d) => d.inqKey).filter((k): k is number => k != null));
      const keys = [...duenos, ...inqs];
      const hs = await hash(c.passVecino);
      for (const lote of trozos(keys, 500)) {
        const creados = await prisma.usuario.createManyAndReturn({
          data: lote.map((k) => {
            const p = c.personas[k]!;
            return { nombre: p.nombre, email: p.email, telefono: p.telefono, rol: p.rol, password_hash: hs, complejo_id: cx.id, aviso_whatsapp: p.whatsapp && !!c.plan.whatsapp };
          }),
          select: { id: true, email: true },
        });
        const porEmail = new Map(creados.map((x) => [x.email, x.id]));
        for (const k of lote) c.personas[k]!.id = porEmail.get(c.personas[k]!.email)!;
      }
      const unidadesDb = await prisma.unidad.createManyAndReturn({
        data: condo.dptos.map((d) => ({
          codigo: d.codigo, tipo: 'departamento', estructura_id: condo.estructuras[d.blockIdx]!.id, piso_id: pisosDb.find((p) => p.estructura_id === condo.estructuras[d.blockIdx]!.id && p.numero === d.piso)!.id,
          complejo_id: cx.id, empresa_id: emp.id, descripcion: `Departamento ${d.codigo.split('-')[1]} · ${condo.estructuras[d.blockIdx]!.nombre}, piso ${d.piso}`, propietario_id: c.personas[d.duenoKey]!.id!, inquilino_id: d.inqKey != null ? c.personas[d.inqKey]!.id! : null, estado: 'activa',
        })),
        select: { id: true, codigo: true, estructura_id: true },
      });
      for (const d of condo.dptos) {
        const u = unidadesDb.find((x) => x.codigo === d.codigo && x.estructura_id === condo.estructuras[d.blockIdx]!.id)!;
        d.id = u.id;
        d.duenoId = c.personas[d.duenoKey]!.id!;
        d.inqId = d.inqKey != null ? c.personas[d.inqKey]!.id! : undefined;
      }
      // Personal del condominio.
      for (const s of c.staff.filter((x) => c.condos[x.condo] === condo)) {
        await prisma.usuario.create({ data: { nombre: s.nombre, email: s.email, telefono: telefono(), rol: s.rol, password_hash: await hash(s.password), empresa_id: emp.id, complejo_id: cx.id } });
      }
      // Juntas directivas (con su cargo reflejado en el usuario) y medios de pago.
      const adminId = c.admins[0]!.id!;
      for (const j of condo.juntaMiembros) {
        if (!j.usuarios.length) continue;
        const estId = j.estructura == null ? null : condo.estructuras[j.estructura]!.id;
        const junta = await prisma.juntaDirectiva.create({
          data: { complejo_id: cx.id, estructura_id: estId, desde: new Date(Date.UTC(2026, 0, 1)), correo: `junta${estId ? `.${slug(condo.estructuras[j.estructura!]!.nombre)}` : ''}@${c.dominio}`, creado_por_id: adminId, miembros: { create: j.usuarios.map((m) => ({ usuario_id: c.personas[m.key]!.id!, cargo: m.cargo })) } },
          select: { id: true },
        });
        for (const m of j.usuarios) await prisma.usuario.update({ where: { id: c.personas[m.key]!.id! }, data: { cargo_junta: m.cargo, estructura_id: estId }, select: { id: true } });
        const tes = j.usuarios.find((m) => m.cargo === 'tesorero');
        if (tes && estId != null && condo.estructuras.length > 1 && rnd() < 0.5) {
          const p = c.personas[tes.key]!;
          await prisma.medioPago.create({ data: { complejo_id: cx.id, estructura_id: estId, tipo: rnd() < 0.5 ? 'yape' : 'plin', celular: p.telefono, titular: p.nombre, orden: 1, creado_por_id: p.id!, junta_id: junta.id } });
        }
      }
      await prisma.medioPago.create({ data: { complejo_id: cx.id, estructura_id: null, tipo: 'banco', banco: elige(['BCP', 'BBVA', 'Interbank', 'Scotiabank']), tipo_cuenta: 'corriente', numero_cuenta: String(entre(10 ** 13, 10 ** 14 - 1)), cci: String(entre(10 ** 19, 10 ** 20 - 1)), titular: c.plan.tipo === 'junta' ? c.plan.nombre : `Asociación de Propietarios ${cp.nombre}`, orden: 0, creado_por_id: adminId } });
    }
  }
  return { superadminId: superadmin.id, passSuper };
}

/** Un recibo por block y mes, con la API real. Los montos varían un poco por block y por mes (agua y luz). */
async function emitirMes(m: number) {
  const { anio, mes } = MESES[m]!;
  const tareas: { c: ClienteVivo; condo: CondoVivo; b: number }[] = [];
  for (const c of vivos) for (const condo of c.condos) for (let b = 0; b < condo.estructuras.length; b++) tareas.push({ c, condo, b });
  const sesiones = new Map<ClienteVivo, Sesion>();
  for (const c of vivos) sesiones.set(c, await new Sesion(c.admins[0]!.email, c.admins[0]!.password).entrar());
  let errores = 0;
  await pool(tareas, 4, async ({ c, condo, b }) => {
    const t = condo.plan.tarifa;
    const varBlock = 0.9 + ((b * 37) % 21) / 100; // ±10 % por block, fijo
    const al10 = (x: number) => (Math.round(x * 10) / 10).toFixed(2);
    const conceptos = [
      { k: 'admin', monto: t.admin },
      ...(t.seguridad > 0 ? [{ k: 'seguridad', monto: t.seguridad }] : []),
      { k: 'limpieza', monto: t.limpieza },
      { k: 'aguaLuz', monto: t.aguaLuz * ESTACION[m]! * varBlock },
      { k: 'fondo', monto: t.fondo },
      ...(t.central ? [{ k: 'central', monto: t.central }] : []),
      ...(t.ascensor ? [{ k: 'ascensor', monto: t.ascensor }] : []),
    ].map((x) => ({ concepto_id: condo.conceptoIds[x.k]!, monto: Number.isInteger(x.monto) ? x.monto.toFixed(2) : al10(x.monto) }));
    const r = await sesiones.get(c)!.json('POST', '/api/recibos', { complejo_id: condo.id, estructura_id: condo.estructuras[b]!.id, mes, anio, fecha_emision: `${anio}-${dos(mes)}-01`, fecha_vencimiento: `${anio}-${dos(mes)}-15`, conceptos });
    if (r.status !== 201) {
      errores++;
      console.error(`✖ emitir ${condo.plan.nombre} ${condo.estructuras[b]!.nombre} ${mes}/${anio}: ${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`);
      return;
    }
    condo.recibos[m]!.set(String(b), r.body.id as number);
  });
  if (errores) throw new Error(`${errores} recibos no se pudieron emitir`);
  return sesiones;
}

interface Pagar { c: ClienteVivo; condo: CondoVivo; d: Dpto; modo: 'valido' | 'tarde' | 'por_validar' | 'rechazo_y_pago' | 'rechazo_final' }
async function pagarMes(m: number, sesiones: Map<ClienteVivo, Sesion>, tesoreros: Map<string, Sesion>) {
  const { anio, mes } = MESES[m]!;
  const lista: Pagar[] = [];
  for (const c of vivos)
    for (const condo of c.condos)
      for (const d of condo.dptos) {
        let modo: Pagar['modo'] | null = null;
        if (d.perfil === 'moroso1') modo = m < ACTUAL ? 'valido' : null;
        else if (d.perfil === 'moroso_multi') modo = m < ACTUAL - d.mesesMora + 1 ? 'valido' : null;
        else if (d.perfil === 'por_validar') modo = m === ACTUAL ? 'por_validar' : 'valido';
        else if (d.perfil === 'rechazado') modo = m === ACTUAL ? 'rechazo_final' : 'valido';
        else modo = d.rechazoPrevio === m ? 'rechazo_y_pago' : 'valido'; // al_dia
        if (modo === 'valido' && rnd() < 0.09) modo = 'tarde';
        if (modo) lista.push({ c, condo, d, modo });
      }
  let fallos = 0;
  let hechos = 0;
  await pool(lista, 5, async ({ c, condo, d, modo }, i) => {
    const bi = d.blockIdx;
    const reciboId = condo.recibos[m]!.get(String(bi))!;
    const ruta = `/api/recibos/${reciboId}/mantenimientos/${d.id}/pagos`;
    const pagador = d.inqId ?? d.duenoId!;
    const campos = { metodo_pago: elige(METODOS), referencia: `OP-${entre(10000000, 99999999)}`, usuario_id: String(pagador) };
    // En las juntas independientes, la mitad de los pagos los registra el TESORERO de la junta (no sólo la cuenta admin): así se prueba el camino de la junta.
    const tes = c.plan.tipo === 'junta' && i % 2 === 0 ? tesoreros.get(`${condo.id}:${bi}`) ?? tesoreros.get(`${condo.id}:u`) : undefined;
    const ses = tes ?? sesiones.get(c)!;
    const fecha = (dia: number) => `${anio}-${dos(mes)}-${dos(dia)}`;
    let r: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (modo === 'valido' || modo === 'tarde') {
      const dia = modo === 'tarde' ? entre(17, 28) : entre(2, 14);
      r = await ses.json('POST', ruta, { metodo_pago: campos.metodo_pago, referencia: campos.referencia, fecha_pago: fecha(dia), usuario_id: pagador });
    } else if (modo === 'por_validar') {
      r = await ses.form(ruta, { ...campos, metodo_pago: elige(['transferencia', 'yape', 'plin']) }, pngVoucher(d.id! * 7 + m));
    } else {
      // Rechazo: sube el voucher (queda por validar) y la administración lo rechaza con un motivo. `rechazo_y_pago` luego paga bien; `rechazo_final` deja el cargo pendiente.
      const adm = sesiones.get(c)!;
      const sub = await adm.form(ruta, { ...campos, metodo_pago: 'transferencia' }, pngVoucher(d.id! * 11 + m));
      if (sub.status !== 201) r = sub;
      else {
        const rech = await adm.json('PATCH', `/api/pagos/${sub.body.pago_id}/validacion`, { estado: 'rechazado', motivo: MOTIVOS[(d.id! + m) % MOTIVOS.length] });
        r = rech.status === 200 ? { status: 201, body: null } : rech;
        if (rech.status === 200 && modo === 'rechazo_y_pago') r = await ses.json('POST', ruta, { metodo_pago: campos.metodo_pago, referencia: campos.referencia, fecha_pago: fecha(entre(8, 14)), usuario_id: pagador });
      }
    }
    if (r.status !== 201) {
      fallos++;
      if (fallos <= 5) console.error(`✖ pago ${condo.plan.nombre} ${d.codigo} ${mes}/${anio} (${modo}): ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);
    } else hechos++;
  });
  console.log(`  ${mes}/${anio}: ${hechos} pagos registrados${fallos ? `, ${fallos} FALLARON` : ''}`);
  if (fallos > lista.length * 0.02) throw new Error(`Demasiados pagos fallidos en ${mes}/${anio}: ${fallos}/${lista.length}`);
}

/** Suscripciones (planes). Van ANTES de facturar: la mora automática y el resto de lo que trae el plan dependen de ellas. La junta «vencida» recibe su plazo vencido al final. */
async function suscripciones() {
  const hoy = new Date();
  const medianoche = (d: number) => new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()) + d * DIA);
  for (const c of vivos) {
    const sp = c.plan.sus;
    for (const [i, condo] of c.condos.entries()) {
      let datos: Record<string, unknown>;
      if (sp.plan === 'gratis') datos = { plan_clave: 'gratis', estado: 'gratis', gratis_hasta: (sp.gratisDias ?? 90) > 0 ? medianoche(sp.gratisDias ?? 90) : null, notas: 'Simulación: Gratis' };
      else {
        // Variantes para probar estados: el 3.º condominio de la Empresa B está por vencer.
        const porVencer = c.plan.clave === 'B' && i === 2;
        datos = { plan_clave: sp.plan, estado: porVencer ? 'por_vencer' : 'activa', vigente_hasta: medianoche(porVencer ? 3 : sp.vigenteDias ?? 90), es_prueba: sp.prueba ?? false, ...(sp.gratisDias ? { gratis_hasta: medianoche(sp.gratisDias) } : {}), notas: 'Simulación' };
      }
      await prisma.suscripcionCondominio.create({ data: { complejo_id: condo.id!, ...datos } as never });
    }
  }
}

/** La junta de Gratis «vencida» pasa a solo lectura sólo cuando ya se facturó todo (con el plazo vencido no se podría emitir). */
async function vencerGratis() {
  const hoy = new Date();
  for (const c of vivos) {
    const sp = c.plan.sus;
    if (sp.plan !== 'gratis' || (sp.gratisDias ?? 90) > 0) continue;
    const hasta = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate()) + (sp.gratisDias ?? 0) * DIA);
    for (const condo of c.condos) await prisma.suscripcionCondominio.update({ where: { complejo_id: condo.id! }, data: { gratis_hasta: hasta }, select: { id: true } });
  }
}

async function postFacturacion() {
  for (const c of vivos) {
    // WhatsApp (sólo la Empresa A): instancia FICTICIA (nunca se conecta nada real), grupos asignados y los envíos de octubre ya hechos.
    if (c.plan.whatsapp) {
      await prisma.empresaAdministradora.update({ where: { id: c.empresaId! }, data: { whatsapp_instance: 'simulacion-andina' }, select: { id: true } });
      let n = 0;
      for (const condo of c.condos) {
        const g = condo.plan.grupos;
        if (!g) continue;
        const destinos = g === 'condominio' ? [{ est: null as number | null, nombre: `Vecinos ${condo.plan.nombre}`, dest: 'condominio' }] : g.map((b) => ({ est: condo.estructuras[b - 1]!.id as number | null, nombre: `Vecinos ${condo.estructuras[b - 1]!.nombre} · ${condo.plan.nombre}`, dest: 'block' }));
        for (const dd of destinos) {
          n++;
          const gr = await prisma.grupoWhatsapp.create({ data: { empresa_id: c.empresaId!, jid: `1203630000000${String(n).padStart(5, '0')}@g.us`, nombre: dd.nombre, miembros: entre(14, 40), en_uso: true, destino: dd.dest, complejo_id: condo.id!, estructura_id: dd.est, sincronizado_at: new Date() } });
          // El aviso del recibo de octubre salió a este grupo (anotado con la hora de la siembra, para que cuente en el contador del MES en curso; no sale nada real).
          const reciboId = dd.est == null ? condo.recibos[ACTUAL]!.get('0') : condo.recibos[ACTUAL]!.get(String(condo.estructuras.findIndex((e) => e.id === dd.est)));
          if (reciboId) await prisma.envioGrupoWhatsapp.create({ data: { empresa_id: c.empresaId!, instancia: 'simulacion-andina', complejo_id: condo.id!, recibo_id: reciboId, grupo_id: gr.id, estado: 'enviado', at: new Date() } });
        }
      }
    }
  }
}

async function extras() {
  // Comunicados (de la administración y de alguna junta) y reservas, directo en base: sin envío de nada.
  const hoy = new Date();
  const hace = (d: number) => new Date(hoy.getTime() - d * DIA);
  let nComunicados = 0;
  let nReservas = 0;
  for (const c of vivos) {
    const admin = c.admins[0]!.id!;
    for (const [i, condo] of c.condos.entries()) {
      const cid = condo.id!;
      if (c.plan.clave === 'A' || i === 0) {
        await prisma.comunicado.createMany({
          data: [
            { complejo_id: cid, titulo: 'Corte de agua programado', cuerpo: 'Sedapal hará trabajos en la red.\nEl sábado no habrá agua de 9:00 a 14:00.\nGuarden agua desde el viernes.', autor_id: admin, fijado: true, created_at: hace(6), updated_at: hace(6) },
            { complejo_id: cid, titulo: 'Asamblea general de propietarios', cuerpo: 'Convocamos a la asamblea general ordinaria el jueves a las 19:30.\nAgenda: presupuesto 2027 y elección de la junta.', autor_id: admin, created_at: hace(12), updated_at: hace(12) },
            ...(condo.estructuras.length > 1 ? [{ complejo_id: cid, estructura_id: condo.estructuras[1]!.id, titulo: `Pintura de pasillos del ${condo.estructuras[1]!.nombre}`, cuerpo: 'Desde el lunes se pintan los pasillos, piso por piso.', autor_id: admin, created_at: hace(3), updated_at: hace(3) }] : []),
          ],
        });
        nComunicados += 2 + (condo.estructuras.length > 1 ? 1 : 0);
      }
      if (condo.plan.areas) {
        const area = await prisma.areaComun.create({ data: { complejo_id: cid, nombre: 'Salón de usos múltiples', descripcion: 'Para reuniones y cumpleaños', capacidad: 40, hora_apertura: '09:00', hora_cierre: '22:00', duracion_max_horas: 4, dias_anticipacion_max: 30, requiere_aprobacion: true } });
        const picks = barajar(condo.dptos.filter((d) => d.perfil === 'al_dia')).slice(0, 4);
        for (const [k, d] of picks.entries()) {
          const base = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 15) + (k + 2) * 3 * DIA;
          await prisma.reserva.create({ data: { area_id: area.id, unidad_id: d.id!, usuario_id: d.duenoId!, inicio: new Date(base), fin: new Date(base + 3 * 3600000), estado: k % 2 === 0 ? 'pendiente' : 'aprobada', ...(k % 2 === 1 ? { resuelto_por_id: admin, resuelto_at: new Date() } : {}) } });
          nReservas++;
        }
      }
    }
  }
  return { nComunicados, nReservas };
}

async function main() {
  const t0 = Date.now();
  await limpiar();
  const { passSuper } = await estructura();
  await suscripciones();
  console.log(`Estructura creada en ${((Date.now() - t0) / 1000).toFixed(0)} s. Facturando por la API real (recibos y pagos)…`);

  const server = createApp({ rateLimits: { api: 1e7, apiUsuario: 1e7, login: 1e7, loginCuenta: 1e7, evaluacion: 1e7 } }).listen(0);
  await new Promise((r) => server.once('listening', r));
  BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Tesoreros de las juntas independientes (registran parte de los pagos). Clave: `${condo}:${blockIdx}` o `${condo}:u` (junta única).
  const tesoreros = new Map<string, Sesion>();
  for (const c of vivos.filter((x) => x.plan.tipo === 'junta')) {
    for (const condo of c.condos) {
      for (const j of condo.juntaMiembros) {
        const tes = j.usuarios.find((u) => u.cargo === 'tesorero');
        if (!tes) continue;
        tesoreros.set(`${condo.id}:${j.estructura == null ? 'u' : j.estructura}`, await new Sesion(c.personas[tes.key]!.email, c.personas[tes.key]!.password).entrar());
      }
    }
  }
  for (let m = 0; m < MESES.length; m++) {
    const sesiones = await emitirMes(m);
    await pagarMes(m, sesiones, tesoreros);
  }
  await new Promise<void>((r) => server.close(() => r()));

  await postFacturacion();
  await vencerGratis();
  // Los avisos que la emisión dejó en cola (correo y WhatsApp) nunca deben salir: se borran. No se envía nada real.
  await prisma.notificacion.deleteMany({ where: { estado: 'pendiente' } });
  const ex = await extras();
  await resumen(t0, passSuper, ex);
  await prisma.$disconnect();
}

async function resumen(t0: number, passSuper: string, ex: { nComunicados: number; nReservas: number }) {
  const rows: Record<string, string | number>[] = [];
  const cred: Record<string, unknown> = { superadmin: { email: 'superadmin@simulacion.example', password: passSuper }, clientes: {} as Record<string, unknown> };
  for (const c of vivos) {
    const por = await prisma.$queryRaw<{ rol: string; n: bigint }[]>`SELECT u.rol, count(*) AS n FROM "Usuario" u WHERE u.empresa_id = ${c.empresaId} OR u.complejo_id IN (SELECT id FROM "ComplejoHabitacional" WHERE empresa_id = ${c.empresaId}) GROUP BY u.rol`;
    for (const condo of c.condos)
      rows.push({ cliente: `${c.plan.clave} · ${c.plan.nombre}`, tipo: c.plan.tipo === 'junta' ? 'junta' : 'empresa', condominio: condo.plan.nombre, blocks: condo.estructuras.length, departamentos: condo.dptos.length, plan: c.plan.sus.plan });
    const unCond = c.condos[0]!;
    const enJunta = new Set(c.condos.flatMap((o) => o.juntaMiembros.flatMap((j) => j.usuarios.map((u) => u.key))));
    const resid = (pred: (d: Dpto) => boolean, inq = false) => {
      const d = unCond.dptos.find((x) => pred(x) && !enJunta.has(x.duenoKey));
      if (!d) return null;
      const p = c.personas[inq ? d.inqKey! : d.duenoKey]!;
      return { email: p.email, password: c.passVecino, departamento: d.codigo };
    };
    const miembro = (cargo: string) => {
      for (const condo of c.condos) for (const j of condo.juntaMiembros) { const m = j.usuarios.find((u) => u.cargo === cargo); if (m) return { email: c.personas[m.key]!.email, password: c.passVecino, condominio: condo.plan.nombre, bloque: j.estructura == null ? 'todo el condominio' : condo.estructuras[j.estructura]!.nombre }; }
      return null;
    };
    (cred.clientes as Record<string, unknown>)[c.plan.clave] = {
      nombre: c.plan.nombre, tipo: c.plan.tipo, empresa_id: c.empresaId,
      admins: c.admins.map((a) => ({ email: a.email, password: a.password })),
      presidente: miembro('presidente'), tesorero: miembro('tesorero'), secretario: miembro('secretario'),
      vecino_al_dia: resid((d) => d.perfil === 'al_dia'), vecino_moroso: resid((d) => d.perfil === 'moroso_multi'), vecino_por_validar: resid((d) => d.perfil === 'por_validar'), inquilino: resid((d) => d.inqKey != null, true),
      personal: c.staff.map((s) => ({ email: s.email, rol: s.rol, password: s.password })),
      condominios: c.condos.map((o) => ({ id: o.id, nombre: o.plan.nombre })),
      usuarios_por_rol: Object.fromEntries(por.map((p) => [p.rol, Number(p.n)])),
    };
  }
  const destino = process.env.CREDENCIALES_JSON ?? join(tmpdir(), 'house-mercado-credenciales.json');
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, JSON.stringify(cred, null, 2), { mode: 0o600 });

  const [tot] = await prisma.$queryRaw<{ recibos: bigint; cargos: bigint; pagos: bigint; por_validar: bigint; rechazados: bigint; emitido: string; cobrado: string }[]>`SELECT
    (SELECT count(*) FROM "Recibo") AS recibos, (SELECT count(*) FROM "ReciboConceptoUnidad") AS cargos, (SELECT count(*) FROM "Pago") AS pagos,
    (SELECT count(*) FROM "Pago" WHERE estado_validacion = 'por_validar' AND (grupo IS NULL OR grupo_principal)) AS por_validar,
    (SELECT count(*) FROM "Pago" WHERE estado_validacion = 'rechazado' AND (grupo IS NULL OR grupo_principal)) AS rechazados,
    (SELECT COALESCE(sum(monto), 0)::text FROM "ReciboConceptoUnidad") AS emitido, (SELECT COALESCE(sum(monto), 0)::text FROM "Pago" WHERE estado_validacion = 'validado') AS cobrado`;
  console.log('\n══ Mercado simulado (house_mercado) ══');
  console.table(rows);
  const roles = await prisma.$queryRaw<{ rol: string; n: bigint }[]>`SELECT rol, count(*) AS n FROM "Usuario" GROUP BY rol ORDER BY rol`;
  console.log('Usuarios por rol:', Object.fromEntries(roles.map((r) => [r.rol, Number(r.n)])));
  console.log(`Recibos: ${tot!.recibos} · Cargos: ${tot!.cargos} · Pagos: ${tot!.pagos} (${tot!.por_validar} por validar, ${tot!.rechazados} rechazados) · Emitido S/ ${Number(tot!.emitido).toFixed(2)} · Cobrado (validado) S/ ${Number(tot!.cobrado).toFixed(2)} · Comunicados: ${ex.nComunicados} · Reservas: ${ex.nReservas}`);
  console.log('\nUna cuenta de cada rol por cliente (sólo correos; las contraseñas de prueba están en el archivo de credenciales, fuera del repo):');
  const acc: Record<string, string | number>[] = [];
  for (const c of vivos) {
    const cl = (cred.clientes as Record<string, any>)[c.plan.clave]; // eslint-disable-line @typescript-eslint/no-explicit-any
    acc.push({ cliente: c.plan.clave, admin: cl.admins[0].email, presidente: cl.presidente?.email ?? '-', tesorero: cl.tesorero?.email ?? '-', vecino: cl.vecino_al_dia?.email ?? '-', inquilino: cl.inquilino?.email ?? '-', personal: cl.personal[0]?.email ?? '-' });
  }
  console.table(acc);
  console.log(`Superadmin: superadmin@simulacion.example · Credenciales (0600): ${destino}`);
  console.log(`Hecho en ${((Date.now() - t0) / 1000).toFixed(0)} s.\n`);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
