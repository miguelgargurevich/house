// La demo de Torre: una administradora ficticia con dos condominios y seis meses de historia, sembrada con la API REAL (recibos, pagos, validaciones), como
// `prisma/seed-mercado.ts`. Se llama desde `npm run seed:demo` y desde el reinicio nocturno (`reinicio.ts`). Cuatro garantías:
//  1. SÓLO corre contra una base cuyo nombre termina en `_demo` (`exigirBaseDeDemo`); en cualquier otra aborta sin tocar nada.
//  2. Enciende el modo demostración ANTES de facturar: nada sale de la máquina mientras se siembra (ni correo, ni WhatsApp, ni IA).
//  3. Determinista: PRNG con semilla fija y todo el azar se decide ANTES de las llamadas en paralelo → dos corridas el mismo día dan las mismas cuentas
//     y los mismos montos. Es RELATIVO A HOY: el recibo «del mes» es el del mes en curso (Lima), con meses vencidos y recibos por vencer.
//  4. Datos 100 % inventados: nombres generados, correos `.example`, celulares 900 xxx xxx. Nada real.
import { deflateSync } from 'node:zlib';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcrypt';
import { prisma } from '../../db';
import { hoyLima } from '../../lib/fechas';
import { sembrarCatalogoComercial } from '../comercial/catalogo';
import { invalidarComercial } from '../comercial/modulos';
import { esperarEnviosAGrupos } from '../canales/grupos';
import { esperarEvaluaciones, iniciarEvaluacion } from '../evaluacion';
import { migrarPersonas } from '../personas/sincronizar';
import { auditarCoherencia } from './coherencia';
import { CUENTAS_DEMO, DOMINIO_DEMO, type RolDemo } from './cuentas';
import { fijarModoDemo, invalidarDemo } from './estado';
import { INSTANCIA_DEMO } from './evolutionDemo';

// ───────────────────────────── protección ─────────────────────────────
/** El nombre de la base de una URL de Postgres, o null si no es una URL válida. */
export function nombreDeBase(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

/** Sólo una base `*_demo` (la de la instancia de demo, `house_demo` local o `house_test_demo` de las pruebas) puede sembrarse. */
export function exigirBaseDeDemo(url: string | undefined = process.env.DATABASE_URL): string {
  const base = nombreDeBase(url);
  if (!base || !/_demo$/.test(base)) throw new Error(`El seed de la demo sólo corre contra una base cuyo nombre termine en «_demo»; recibí «${base ?? 'ninguna'}». No se tocó nada.`);
  return base;
}

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
const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
const slug = (t: string) => sinTildes(t).toLowerCase().replace(/[^a-z0-9]+/g, '');
const dos = (n: number) => String(n).padStart(2, '0');
const DIA = 24 * 3600 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

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

// Voucher de ejemplo (PNG generado, sin imágenes de nadie): cabecera de color, un círculo «operación exitosa» y renglones de texto. Distinto por semilla.
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
export function pngVoucher(semilla: number): Buffer {
  const w = 240;
  const h = 360;
  const cab = [[116, 50, 168], [0, 120, 110], [30, 90, 160], [200, 70, 40]][semilla % 4]!;
  const filas: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const fila = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      let c = [248, 248, 248];
      if (y < 56) c = cab;
      else if ((x - 120) ** 2 + (y - 104) ** 2 < 26 ** 2) c = [46, 160, 90]; // círculo de «exitosa»
      else if (y > 150 && (y - 150) % 22 < 8 && x > 24 && x < 24 + 120 + ((semilla * 13 + y * 7) % 90)) c = [120 + (y % 40), 120 + (y % 40), 125]; // renglones
      const o = 1 + x * 3;
      fila[o] = c[0]!;
      fila[o + 1] = c[1]!;
      fila[o + 2] = c[2]!;
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

// ───────────────────────────── el escenario ─────────────────────────────
const NOMBRES = ['Luis', 'Carlos', 'Jorge', 'José', 'Juan', 'Miguel', 'Víctor', 'Óscar', 'Manuel', 'César', 'Hugo', 'Fernando', 'Ricardo', 'Alberto', 'Eduardo', 'Rafael', 'Andrés', 'Sergio', 'Walter', 'Julio',
  'Rosa', 'Ana', 'Luz', 'Elena', 'Patricia', 'Silvia', 'Teresa', 'Julia', 'Sandra', 'Liliana', 'Martha', 'Claudia', 'Karina', 'Milagros', 'Rocío', 'Verónica', 'Lucía', 'Paola', 'Cecilia', 'Mónica'] as const;
const APELLIDOS = ['Quispe', 'Huamán', 'Flores', 'Rojas', 'Mendoza', 'Gutiérrez', 'Vásquez', 'Castillo', 'Chávez', 'Ramos', 'Torres', 'Sánchez', 'Díaz', 'Cruz', 'Vargas', 'Salazar', 'Paredes', 'Espinoza', 'Condori', 'Mamani',
  'Palomino', 'Cárdenas', 'Valdivia', 'Zevallos', 'Bustamante', 'Benavides', 'Arce', 'Tello', 'Cáceres', 'Quiroz', 'Lazo', 'Ponce', 'Montoya', 'Alarcón', 'Guerra', 'Ibáñez', 'Carrasco', 'Delgado', 'Pacheco', 'Villanueva'] as const;
const METODOS = ['transferencia', 'yape', 'plin', 'efectivo', 'tarjeta'] as const;
const MOTIVOS = ['El voucher no corresponde al monto del recibo', 'La operación no aparece en el estado de cuenta', 'El comprobante está borroso: súbelo de nuevo'];
const MESES_DE_HISTORIA = 6;
const ACTUAL = MESES_DE_HISTORIA - 1;

interface Tarifa { admin: number; seguridad: number; limpieza: number; aguaLuz: number; fondo: number; central?: number; ascensor?: number }
interface CondoPlan {
  nombre: string; tipo: 'condominio' | 'edificio'; direccion: string; blocks: number; pisos: number; porPiso: number; tipoBlock: 'block' | 'torre';
  tarifa: Tarifa; juntas: 'unica' | 'block+central'; moraMonto: string; prefijo: 'B' | 'T';
}
const CONDOS: CondoPlan[] = [
  { nombre: 'Residencial Las Palmeras', tipo: 'condominio', direccion: 'Av. Las Palmeras 450, Santiago de Surco, Lima', blocks: 6, pisos: 5, porPiso: 4, tipoBlock: 'block', tarifa: { admin: 45, seguridad: 60, limpieza: 30, aguaLuz: 24, fondo: 8, central: 10 }, juntas: 'block+central', moraMonto: '10.00', prefijo: 'B' },
  { nombre: 'Edificio Mirador del Parque', tipo: 'edificio', direccion: 'Jr. del Parque 220, Jesús María, Lima', blocks: 1, pisos: 10, porPiso: 4, tipoBlock: 'torre', tarifa: { admin: 50, seguridad: 55, limpieza: 32, aguaLuz: 26, fondo: 10, ascensor: 28 }, juntas: 'unica', moraMonto: '15.00', prefijo: 'T' },
];
const ESTACION = [1.0, 0.96, 0.94, 0.92, 0.95, 1.02];

type Perfil = 'al_dia' | 'moroso1' | 'moroso_multi' | 'por_validar' | 'rechazado';
interface Dpto { codigo: string; bloque: number; piso: number; blockIdx: number; duenoKey: number; inqKey: number | null; perfil: Perfil; mesesMora: number; rechazoPrevio: number; pagaActual: boolean; id?: number; duenoId?: number; inqId?: number }
interface Persona { nombre: string; email: string; telefono: string; rol: 'propietario' | 'inquilino'; id?: number; whatsapp: boolean }
interface Miembro { key: number; cargo: 'presidente' | 'tesorero' | 'secretario' }
interface CondoVivo { plan: CondoPlan; id?: number; estructuras: { id: number; nombre: string }[]; dptos: Dpto[]; juntas: { estructura: number | null; miembros: Miembro[] }[]; recibos: Map<number, number>[]; conceptoIds: Record<string, number> }

export interface ResumenDemo {
  base: string;
  condominios: { nombre: string; blocks: number; departamentos: number }[];
  usuarios: number; recibos: number; pagos: number; por_validar: number; rechazados: number; comunicados: number; reservas: number;
  /** Auditoría de coherencia (`coherencia.ts`): vacía = en orden. */
  problemas: string[];
  segundos: number;
}

/** Mensajes opcionales (el seed los imprime; el reinicio nocturno los manda al log del servidor). */
export interface OpcionesSembrado { ahora?: Date; log?: (m: string) => void }

/** Siembra la demo completa. Borra y recrea el contenido de la base `*_demo` (conserva la configuración comercial, el llavero y las cuentas de superadmin). */
export async function sembrarDemo(opciones: OpcionesSembrado = {}): Promise<ResumenDemo> {
  const base = exigirBaseDeDemo();
  const log = opciones.log ?? (() => undefined);
  const t0 = Date.now();
  const rnd = mulberry32(20261111);
  const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const elige = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const barajar = <T>(xs: T[]): T[] => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [xs[i], xs[j]] = [xs[j]!, xs[i]!];
    }
    return xs;
  };

  // Hoy en Lima y los 6 meses de historia (el último es el mes en curso).
  const hoy = hoyLima(opciones.ahora);
  const diaHoy = hoy.getUTCDate();
  const MESES = Array.from({ length: MESES_DE_HISTORIA }, (_, i) => {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - (ACTUAL - i), 1));
    return { anio: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
  });
  const vencimientoDe = (m: number) => (m === ACTUAL ? iso(new Date(hoy.getTime() + 5 * DIA)) : `${MESES[m]!.anio}-${dos(MESES[m]!.mes)}-15`);

  // Nombres y celulares inventados, sin repetir.
  const nombresUsados = new Set<string>(Object.values(CUENTAS_DEMO).map((c) => c.nombre));
  const nombreNuevo = () => {
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
  };
  const telUsados = new Set<string>();
  const telefono = () => {
    for (;;) {
      const t = `900${String(entre(0, 999999)).padStart(6, '0')}`;
      if (!telUsados.has(t)) return (telUsados.add(t), t);
    }
  };
  const ALFA = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const claveNueva = (p: string) => `${p}-${Array.from({ length: 14 }, () => ALFA[Math.floor(rnd() * ALFA.length)]).join('')}!`;
  // Contraseñas que nadie conoce (a la demo se entra por rol, sin clave): una para la administración y otra para todos los demás.
  const passAdmin = claveNueva('Adm');
  const passResto = claveNueva('Res');
  const hashes = new Map<string, string>();
  const hash = async (p: string) => hashes.get(p) ?? (hashes.set(p, await bcrypt.hash(p, 12)), hashes.get(p)!);

  // ── construcción en memoria ──
  const personas: Persona[] = [];
  const persona = (rol: 'propietario' | 'inquilino', fija?: { nombre: string; email: string }): number => {
    const { nombre, n, ap } = nombreNuevo();
    const k = personas.length + 1;
    personas.push({ nombre: fija?.nombre ?? nombre, email: fija?.email ?? `${slug(n)}.${slug(ap)}.${k}@${DOMINIO_DEMO}`, telefono: telefono(), rol, whatsapp: rnd() < 0.8 });
    return personas.length - 1;
  };
  const cuentaDeUnidad = new Map<string, RolDemo>(Object.entries(CUENTAS_DEMO).filter(([, c]) => c.unidad).map(([r, c]) => [c.unidad!, r as RolDemo]));
  const codigo = (p: CondoPlan, b: number, pi: number, d: number) => `${p.prefijo}${dos(b)}-${pi}${dos(d)}`;

  const condos: CondoVivo[] = CONDOS.map((plan) => {
    const condo: CondoVivo = { plan, estructuras: [], dptos: [], juntas: [], recibos: MESES.map(() => new Map()), conceptoIds: {} };
    for (let b = 1; b <= plan.blocks; b++)
      for (let p = 1; p <= plan.pisos; p++)
        for (let d = 1; d <= plan.porPiso; d++) {
          const cod = codigo(plan, b, p, d);
          const rol = cuentaDeUnidad.get(cod);
          const fija = rol && plan === CONDOS[0] ? CUENTAS_DEMO[rol] : undefined;
          const dueno = persona('propietario', fija && rol !== 'inquilino' ? fija : undefined);
          const conInq = plan === CONDOS[0] && cod === CUENTAS_DEMO.inquilino.unidad;
          const inq = conInq ? persona('inquilino', CUENTAS_DEMO.inquilino) : rnd() < 0.12 ? persona('inquilino') : null;
          const r = rnd();
          const perfil: Perfil = r < 0.66 ? 'al_dia' : r < 0.8 ? 'moroso1' : r < 0.92 ? 'moroso_multi' : r < 0.97 ? 'por_validar' : 'rechazado';
          condo.dptos.push({ codigo: cod, bloque: b, piso: p, blockIdx: b - 1, duenoKey: dueno, inqKey: inq, perfil, mesesMora: perfil === 'moroso_multi' ? entre(2, 4) : 0, rechazoPrevio: perfil === 'al_dia' && rnd() < 0.02 ? entre(0, ACTUAL - 1) : -1, pagaActual: rnd() < 0.6 });
        }
    return condo;
  });
  const [palmeras, mirador] = condos as [CondoVivo, CondoVivo];
  const dpto = (c: CondoVivo, cod: string) => c.dptos.find((d) => d.codigo === cod)!;

  // Unidades de los roles de la demo, con su situación pensada para que cada rol tenga algo que hacer.
  const fijar = (d: Dpto, perfil: Perfil, extra: Partial<Dpto> = {}) => Object.assign(d, { perfil, mesesMora: 0, rechazoPrevio: -1, pagaActual: true, ...extra });
  fijar(dpto(palmeras, CUENTAS_DEMO.propietario_moroso.unidad!), 'moroso_multi', { mesesMora: 3 }); // debe 3 meses vencidos y el actual
  fijar(dpto(palmeras, CUENTAS_DEMO.propietario_al_dia.unidad!), 'al_dia', { pagaActual: false }); // al día; el recibo del mes está por pagar (no vence aún)
  fijar(dpto(palmeras, CUENTAS_DEMO.inquilino.unidad!), 'al_dia', { pagaActual: false });
  for (const c of ['B01-301', 'B01-302', 'B01-303']) fijar(dpto(palmeras, c), 'por_validar'); // el tesorero y la administración tienen vouchers por revisar
  fijar(dpto(palmeras, 'B01-401'), 'rechazado');
  // Juntas: unidades al día y sin inquilino (el cargo es del propietario).
  const armar = (c: CondoVivo, estructura: number | null, unidades: [string, string, string]) => {
    const cargos = ['presidente', 'tesorero', 'secretario'] as const;
    const miembros: Miembro[] = unidades.map((u, i) => {
      const d = dpto(c, u);
      fijar(d, 'al_dia');
      d.inqKey = null;
      return { key: d.duenoKey, cargo: cargos[i]! };
    });
    c.juntas.push({ estructura, miembros });
  };
  for (let b = 1; b <= palmeras.plan.blocks; b++) armar(palmeras, b - 1, [`B${dos(b)}-201`, `B${dos(b)}-202`, `B${dos(b)}-203`]);
  armar(palmeras, null, ['B02-204', 'B04-204', 'B06-204']); // junta central
  armar(mirador, null, ['T01-501', 'T01-502', 'T01-503']);
  // Un par de pagos por validar y un rechazo en cada block, para que la administración y las juntas siempre tengan trabajo.
  for (let b = 2; b <= palmeras.plan.blocks; b++) {
    fijar(dpto(palmeras, `B${dos(b)}-301`), 'por_validar');
    fijar(dpto(palmeras, `B${dos(b)}-401`), 'rechazado');
  }
  fijar(dpto(mirador, 'T01-601'), 'por_validar');
  fijar(dpto(mirador, 'T01-701'), 'por_validar');
  fijar(dpto(mirador, 'T01-801'), 'rechazado');

  // ── limpieza e interruptor ──
  const superadmins = await prisma.usuario.findMany({ where: { rol: 'superadmin' }, omit: { password_hash: false } }); // se conservan: son de quien administra la instancia
  await fijarModoDemo(true); // ANTES de todo: desde aquí nada sale de la máquina
  await prisma.configuracionDemo.update({ where: { id: 1 }, data: { reiniciando_desde: new Date() } });
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "PagoSuscripcion","SuscripcionCondominio","ConsumoMensual","TokenVerificacionCorreo","Sesion","Auditoria","Notificacion","EnvioGrupoWhatsapp","GrupoWhatsapp","Reserva","AreaComun","Comunicado","Pago","ReciboConceptoUnidad","ReciboConcepto","Recibo","Concepto","MedioPago","MiembroJunta","JuntaDirectiva","PersonaUnidad","Unidad","Piso","Estructura","ContratoAdministracion","TareaMantenimiento","Proveedor","Usuario","ComplejoHabitacional","EmpresaAdministradora" RESTART IDENTITY CASCADE`,
  );
  await sembrarCatalogoComercial(prisma);
  invalidarComercial();

  // ── estructura ──
  const adminCuenta = CUENTAS_DEMO.administradora;
  const empresa = await prisma.empresaAdministradora.create({
    data: { nombre: 'Administradora Demo SAC', ruc: '20999000099', direccion: 'Av. Demostración 100, Santiago de Surco, Lima', telefono: '010000099', email: `contacto@${DOMINIO_DEMO}`, representante_legal: adminCuenta.nombre, estado: 'activa', whatsapp_instance: INSTANCIA_DEMO, nombre_comercial: 'Administradora Demo', color_marca: '#0E7490' },
  });
  const admin = await prisma.usuario.create({ data: { nombre: adminCuenta.nombre, email: adminCuenta.email, telefono: telefono(), rol: 'admin', password_hash: await hash(passAdmin), empresa_id: empresa.id }, select: { id: true } });
  const hVecino = await hash(passResto);

  for (const condo of condos) {
    const cp = condo.plan;
    const t = cp.tarifa;
    const concs = [
      { k: 'admin', nombre: 'Cuota de administración', destino: 'administradora', desc: 'Gestión y mantenimiento general' },
      { k: 'seguridad', nombre: 'Servicio de seguridad', destino: 'servicio', desc: 'Vigilancia del condominio' },
      { k: 'limpieza', nombre: 'Servicio de limpieza', destino: 'servicio', desc: 'Limpieza de áreas comunes' },
      { k: 'aguaLuz', nombre: 'Agua y luz de áreas comunes', destino: 'servicio', desc: 'Consumo de agua y electricidad de áreas comunes' },
      { k: 'fondo', nombre: 'Fondo de reserva', destino: 'ahorro_block', desc: 'Ahorro para imprevistos' },
      ...(t.central ? [{ k: 'central', nombre: 'Aporte a la junta central', destino: 'central', desc: 'Aporte del block a la junta central del condominio' }] : []),
      ...(t.ascensor ? [{ k: 'ascensor', nombre: 'Mantenimiento de ascensores', destino: 'servicio', desc: 'Contrato de mantenimiento de ascensores' }] : []),
    ];
    for (const k of concs) {
      const ya = condos.find((o) => o.conceptoIds[k.k] != null);
      if (ya) { condo.conceptoIds[k.k] = ya.conceptoIds[k.k]!; continue; }
      condo.conceptoIds[k.k] = (await prisma.concepto.create({ data: { nombre: k.nombre, descripcion: k.desc, tipo_monto: 'fijo', empresa_id: empresa.id, destino: k.destino }, select: { id: true } })).id;
    }
    const cx = await prisma.complejoHabitacional.create({
      data: { nombre: cp.nombre, tipo: cp.tipo, direccion: cp.direccion, empresa_id: empresa.id, descripcion: `${cp.blocks} ${cp.tipoBlock === 'torre' ? 'torre' : 'block'}${cp.blocks > 1 ? 's' : ''}, ${cp.pisos} pisos, ${cp.porPiso} departamentos por piso (${condo.dptos.length} unidades). Datos de ejemplo.`, mora_monto: cp.moraMonto },
      select: { id: true },
    });
    condo.id = cx.id;
    await prisma.contratoAdministracion.create({ data: { complejo_id: cx.id, empresa_id: empresa.id, fecha_inicio: new Date(Date.UTC(hoy.getUTCFullYear(), 0, 1)), observaciones: 'Contrato vigente (demo).' } });
    condo.estructuras = (await prisma.estructura.createManyAndReturn({ data: Array.from({ length: cp.blocks }, (_, i) => ({ nombre: cp.tipoBlock === 'torre' ? 'Torre A' : `Block ${i + 1}`, tipo: cp.tipoBlock, complejo_id: cx.id })), select: { id: true, nombre: true } })).map((e) => ({ id: e.id, nombre: e.nombre ?? '' }));
    condo.estructuras.sort((a, b) => a.id - b.id);
    const pisosDb = await prisma.piso.createManyAndReturn({ data: condo.estructuras.flatMap((e) => Array.from({ length: cp.pisos }, (_, p) => ({ numero: p + 1, estructura_id: e.id }))), select: { id: true, numero: true, estructura_id: true } });
    const keys = [...new Set(condo.dptos.flatMap((d) => (d.inqKey != null ? [d.duenoKey, d.inqKey] : [d.duenoKey])))];
    const creados = await prisma.usuario.createManyAndReturn({
      data: keys.map((k) => { const p = personas[k]!; return { nombre: p.nombre, email: p.email, telefono: p.telefono, rol: p.rol, password_hash: hVecino, complejo_id: cx.id, aviso_whatsapp: p.whatsapp }; }),
      select: { id: true, email: true },
    });
    const porEmail = new Map(creados.map((x) => [x.email, x.id]));
    for (const k of keys) personas[k]!.id = porEmail.get(personas[k]!.email)!;
    const unidadesDb = await prisma.unidad.createManyAndReturn({
      data: condo.dptos.map((d) => ({
        codigo: d.codigo, tipo: 'departamento', estructura_id: condo.estructuras[d.blockIdx]!.id, piso_id: pisosDb.find((p) => p.estructura_id === condo.estructuras[d.blockIdx]!.id && p.numero === d.piso)!.id,
        complejo_id: cx.id, empresa_id: empresa.id, descripcion: `Departamento ${d.codigo.split('-')[1]} · ${condo.estructuras[d.blockIdx]!.nombre}, piso ${d.piso}`, propietario_id: personas[d.duenoKey]!.id!, inquilino_id: d.inqKey != null ? personas[d.inqKey]!.id! : null, estado: 'activa',
      })),
      select: { id: true, codigo: true, estructura_id: true },
    });
    for (const d of condo.dptos) {
      d.id = unidadesDb.find((x) => x.codigo === d.codigo && x.estructura_id === condo.estructuras[d.blockIdx]!.id)!.id;
      d.duenoId = personas[d.duenoKey]!.id!;
      d.inqId = d.inqKey != null ? personas[d.inqKey]!.id! : undefined;
    }
    // Juntas (con su cargo reflejado en el usuario) y medios de pago: el Yape del tesorero de cada block y la cuenta del condominio.
    for (const j of condo.juntas) {
      const estId = j.estructura == null ? null : condo.estructuras[j.estructura]!.id;
      const nombreBloque = j.estructura == null ? '' : `.${slug(condo.estructuras[j.estructura]!.nombre)}`;
      const junta = await prisma.juntaDirectiva.create({
        data: { complejo_id: cx.id, estructura_id: estId, desde: new Date(Date.UTC(hoy.getUTCFullYear(), 0, 1)), correo: `junta${nombreBloque}.${slug(cp.nombre)}@${DOMINIO_DEMO}`, creado_por_id: admin.id, miembros: { create: j.miembros.map((m) => ({ usuario_id: personas[m.key]!.id!, cargo: m.cargo })) } },
        select: { id: true },
      });
      for (const m of j.miembros) await prisma.usuario.update({ where: { id: personas[m.key]!.id! }, data: { cargo_junta: m.cargo, estructura_id: estId }, select: { id: true } });
      const tes = j.miembros.find((m) => m.cargo === 'tesorero')!;
      if (estId != null && condo.estructuras.length > 1) {
        const p = personas[tes.key]!;
        await prisma.medioPago.create({ data: { complejo_id: cx.id, estructura_id: estId, tipo: 'yape', celular: p.telefono, titular: p.nombre, orden: 1, creado_por_id: p.id!, junta_id: junta.id } });
      }
    }
    await prisma.medioPago.create({ data: { complejo_id: cx.id, estructura_id: null, tipo: 'banco', banco: 'BCP', tipo_cuenta: 'corriente', numero_cuenta: `19${String(1000000000 + condo.estructuras.length * 7919 + (cx.id % 90) * 104729).padStart(11, '0')}`, cci: `0021${String(10000000000000 + cx.id * 7919).padStart(16, '0')}`, titular: `Asociación de Propietarios ${cp.nombre}`, orden: 0, creado_por_id: admin.id } });
    // Plan Torre Administradora vigente (todos los módulos: IA de vouchers, WhatsApp, asistente y marca propia).
    await prisma.suscripcionCondominio.create({ data: { complejo_id: cx.id, plan_clave: 'administradora', estado: 'activa', vigente_hasta: new Date(hoy.getTime() + 300 * DIA), es_prueba: false, notas: 'Demo' } });
  }
  invalidarComercial();

  // Personal del primer condominio: seguridad, mantenimiento y limpieza.
  const personal: Record<string, number> = {};
  for (const [rol, cuenta] of [['seguridad', CUENTAS_DEMO.seguridad], ['mantenimiento', CUENTAS_DEMO.mantenimiento], ['limpieza', { nombre: 'Rosa Alarcón Neyra', email: `rosa.alarcon@${DOMINIO_DEMO}` }]] as const) {
    personal[rol] = (await prisma.usuario.create({ data: { nombre: cuenta.nombre, email: cuenta.email, telefono: telefono(), rol, password_hash: hVecino, empresa_id: empresa.id, complejo_id: palmeras.id! }, select: { id: true } })).id;
  }
  // Las personas de cada departamento (lo que hace Torre al arrancar con unidades que aún no las tienen).
  await migrarPersonas().catch((e) => log(`  (personas: ${e instanceof Error ? e.message : 'error'})`));
  log(`Estructura creada en ${((Date.now() - t0) / 1000).toFixed(0)} s. Facturando por la API real (recibos y pagos)…`);

  // ── la API real, en proceso ──
  const { createApp } = await import('../../app'); // import dinámico: app.ts monta el router de la demo, que importa este módulo
  const server = createApp({ rateLimits: { api: 1e7, apiUsuario: 1e7, login: 1e7, loginCuenta: 1e7, evaluacion: 1e7 } }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  class Sesion {
    cookie = '';
    csrf = '';
    private readonly email: string;
    private readonly password: string;
    constructor(email: string, password: string) {
      this.email = email;
      this.password = password;
    }
    async entrar(): Promise<this> {
      const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: this.email, password: this.password }) });
      const cuerpo = (await r.json().catch(() => ({}))) as { csrf?: string; error?: string };
      if (r.status !== 200) throw new Error(`login de la demo falló con ${r.status}: ${cuerpo.error ?? ''}`);
      this.cookie = /house_sesion=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';
      this.csrf = cuerpo.csrf ?? '';
      return this;
    }
    private cab(extra: Record<string, string> = {}) { return { cookie: `house_sesion=${this.cookie}`, 'x-csrf-token': this.csrf, ...extra }; }
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

  try {
    const sAdmin = await new Sesion(adminCuenta.email, passAdmin).entrar();
    // Tesoreros que registran parte de los pagos de su block (el del Block 1) y de la junta única del edificio.
    const tesoreros = new Map<string, Sesion>();
    for (const c of condos)
      for (const j of c.juntas) {
        if (j.estructura === 0 || (c === mirador && j.estructura == null)) {
          const tes = j.miembros.find((m) => m.cargo === 'tesorero')!;
          tesoreros.set(`${c.id}:${j.estructura ?? 'u'}`, await new Sesion(personas[tes.key]!.email, passResto).entrar());
        }
      }

    for (let m = 0; m < MESES.length; m++) {
      const { anio, mes } = MESES[m]!;
      // 1. Un recibo por block y mes. Los montos varían un poco por block y por mes (agua y luz).
      const tareas = condos.flatMap((condo) => condo.estructuras.map((_, b) => ({ condo, b })));
      let errores = 0;
      await pool(tareas, 4, async ({ condo, b }) => {
        const t = condo.plan.tarifa;
        const varBlock = 0.9 + ((b * 37) % 21) / 100;
        const dec = (x: number) => (Math.round(x * 10) / 10).toFixed(2);
        const conceptos = [
          { k: 'admin', monto: t.admin }, { k: 'seguridad', monto: t.seguridad }, { k: 'limpieza', monto: t.limpieza }, { k: 'aguaLuz', monto: t.aguaLuz * ESTACION[m]! * varBlock }, { k: 'fondo', monto: t.fondo },
          ...(t.central ? [{ k: 'central', monto: t.central }] : []), ...(t.ascensor ? [{ k: 'ascensor', monto: t.ascensor }] : []),
        ].map((x) => ({ concepto_id: condo.conceptoIds[x.k]!, monto: Number.isInteger(x.monto) ? x.monto.toFixed(2) : dec(x.monto) }));
        const r = await sAdmin.json('POST', '/api/recibos', { complejo_id: condo.id, estructura_id: condo.estructuras[b]!.id, mes, anio, fecha_emision: `${anio}-${dos(mes)}-01`, fecha_vencimiento: vencimientoDe(m), conceptos });
        if (r.status !== 201) { errores++; log(`✖ emitir ${condo.plan.nombre} ${condo.estructuras[b]!.nombre} ${mes}/${anio}: ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`); return; }
        condo.recibos[m]!.set(b, r.body.id as number);
      });
      if (errores) throw new Error(`${errores} recibos no se pudieron emitir`);

      // 2. Los pagos del mes. TODO el azar se decide aquí, en orden, antes de las llamadas en paralelo (así dos corridas dan lo mismo).
      type Modo = 'valido' | 'por_validar' | 'rechazo_y_pago' | 'rechazo_final';
      const lista: { condo: CondoVivo; d: Dpto; modo: Modo; metodo: string; ref: string; dia: number; porTesorero: boolean }[] = [];
      for (const condo of condos)
        for (const d of condo.dptos) {
          let modo: Modo | null = null;
          if (d.perfil === 'moroso1') modo = m < ACTUAL - 1 ? 'valido' : null;
          else if (d.perfil === 'moroso_multi') modo = m <= ACTUAL - d.mesesMora - 1 ? 'valido' : null;
          else if (d.perfil === 'por_validar') modo = m === ACTUAL ? 'por_validar' : 'valido';
          else if (d.perfil === 'rechazado') modo = m === ACTUAL ? 'rechazo_final' : 'valido';
          else modo = m === ACTUAL ? (d.pagaActual ? 'valido' : null) : d.rechazoPrevio === m ? 'rechazo_y_pago' : 'valido';
          const tarde = modo === 'valido' && m < ACTUAL && rnd() < 0.09;
          const dia = m === ACTUAL ? entre(1, Math.max(1, Math.min(14, diaHoy))) : tarde ? entre(17, 28) : entre(2, 14);
          const metodo = elige(METODOS);
          const ref = `OP-${entre(10000000, 99999999)}`;
          const porTesorero = (condo === mirador && d.id! % 2 === 0) || (condo === palmeras && d.blockIdx === 0 && d.id! % 3 === 0);
          if (modo) lista.push({ condo, d, modo, metodo, ref, dia, porTesorero });
        }
      let fallos = 0;
      await pool(lista, 5, async ({ condo, d, modo, metodo, ref, dia, porTesorero }) => {
        const ruta = `/api/recibos/${condo.recibos[m]!.get(d.blockIdx)!}/mantenimientos/${d.id}/pagos`;
        const pagador = d.inqId ?? d.duenoId!;
        const ses = (porTesorero ? tesoreros.get(`${condo.id}:${condo === mirador ? 'u' : d.blockIdx}`) : undefined) ?? sAdmin;
        const fecha = `${anio}-${dos(mes)}-${dos(dia)}`;
        let r: { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (modo === 'valido') r = await ses.json('POST', ruta, { metodo_pago: metodo, referencia: ref, fecha_pago: fecha, usuario_id: pagador });
        else if (modo === 'por_validar') r = await ses.form(ruta, { metodo_pago: ['transferencia', 'yape', 'plin'][d.id! % 3]!, referencia: ref, usuario_id: String(pagador) }, pngVoucher(d.id! * 7 + m));
        else {
          const sub = await sAdmin.form(ruta, { metodo_pago: 'transferencia', referencia: ref, usuario_id: String(pagador) }, pngVoucher(d.id! * 11 + m));
          if (sub.status !== 201) r = sub;
          else {
            const rech = await sAdmin.json('PATCH', `/api/pagos/${sub.body.pago_id}/validacion`, { estado: 'rechazado', motivo: MOTIVOS[(d.id! + m) % MOTIVOS.length] });
            r = rech.status === 200 ? { status: 201, body: null } : rech;
            if (rech.status === 200 && modo === 'rechazo_y_pago') r = await ses.json('POST', ruta, { metodo_pago: metodo, referencia: ref, fecha_pago: `${anio}-${dos(mes)}-${dos(Math.min(dia + 6, 28))}`, usuario_id: pagador });
          }
        }
        if (r.status !== 201) { fallos++; if (fallos <= 5) log(`✖ pago ${condo.plan.nombre} ${d.codigo} ${mes}/${anio} (${modo}): ${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`); }
      });
      log(`  ${mes}/${anio}: ${lista.length - fallos} pagos registrados${fallos ? `, ${fallos} FALLARON` : ''}`);
      if (fallos > 0) throw new Error(`Fallaron ${fallos} de ${lista.length} pagos en ${mes}/${anio}`);
    }
    await esperarEvaluaciones(); // la «lectura de IA» de los vouchers subidos (de ejemplo) termina antes de cerrar
    // Si alguna se cruzó con otra escritura y quedó «evaluando» (se vio una vez en una corrida de pruebas, sin causa a la vista), se repite: la demo no puede dejar un voucher evaluando para siempre.
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const pendientes = await prisma.evaluacionComprobante.findMany({ where: { estado: 'pendiente' }, select: { pago_id: true } });
      if (!pendientes.length) break;
      for (const p of pendientes) await iniciarEvaluacion(p.pago_id, 'subida');
      await esperarEvaluaciones();
    }
    await esperarEnviosAGrupos();
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }

  // ── después de facturar: WhatsApp de ejemplo, comunicados, reservas, proveedores, tareas y agua ──
  let nGrupos = 0;
  for (const condo of condos) {
    const destinos = condo === mirador
      ? [{ est: null as number | null, nombre: `Vecinos ${condo.plan.nombre}`, dest: 'condominio' }]
      : condo.estructuras.map((e) => ({ est: e.id as number | null, nombre: `Vecinos ${e.nombre} · ${condo.plan.nombre}`, dest: 'block' }));
    for (const dd of destinos) {
      nGrupos++;
      const gr = await prisma.grupoWhatsapp.create({ data: { empresa_id: empresa.id, jid: `1203630000000${String(nGrupos).padStart(5, '0')}@g.us`, nombre: dd.nombre, miembros: 14 + ((nGrupos * 7) % 26), en_uso: true, destino: dd.dest, complejo_id: condo.id!, estructura_id: dd.est, sincronizado_at: new Date() } });
      const reciboId = condo.recibos[ACTUAL]!.get(dd.est == null ? 0 : condo.estructuras.findIndex((e) => e.id === dd.est));
      if (reciboId) await prisma.envioGrupoWhatsapp.create({ data: { empresa_id: empresa.id, instancia: INSTANCIA_DEMO, complejo_id: condo.id!, recibo_id: reciboId, grupo_id: gr.id, estado: 'enviado', at: new Date() } });
    }
  }
  for (const nombre of ['Chocolatada de Navidad (vecinos)', 'Padres del nido del barrio']) {
    nGrupos++;
    await prisma.grupoWhatsapp.create({ data: { empresa_id: empresa.id, jid: `1203630000000${String(nGrupos).padStart(5, '0')}@g.us`, nombre, miembros: 18 + nGrupos, en_uso: false, sincronizado_at: new Date() } });
  }

  const hace = (d: number) => new Date(Date.now() - d * DIA);
  let nComunicados = 0;
  for (const condo of condos) {
    const cid = condo.id!;
    await prisma.comunicado.createMany({
      data: [
        { complejo_id: cid, titulo: 'Corte de agua programado', cuerpo: 'Sedapal hará trabajos en la red.\nEl sábado no habrá agua de 9:00 a 14:00.\nGuarden agua desde el viernes.', autor_id: admin.id, fijado: true, created_at: hace(6), updated_at: hace(6) },
        { complejo_id: cid, titulo: 'Asamblea general de propietarios', cuerpo: 'Convocamos a la asamblea general ordinaria el jueves a las 19:30.\nAgenda: presupuesto del próximo año y elección de la junta.', autor_id: admin.id, created_at: hace(12), updated_at: hace(12) },
        ...(condo.estructuras.length > 1 ? [{ complejo_id: cid, estructura_id: condo.estructuras[1]!.id, titulo: `Pintura de pasillos del ${condo.estructuras[1]!.nombre}`, cuerpo: 'Desde el lunes se pintan los pasillos, piso por piso.', autor_id: admin.id, created_at: hace(3), updated_at: hace(3) }] : [{ complejo_id: cid, titulo: 'Mantenimiento de ascensores', cuerpo: 'El martes entre 10:00 y 12:00 revisan los ascensores; uno de los dos seguirá en servicio.', autor_id: admin.id, created_at: hace(3), updated_at: hace(3) }]),
      ],
    });
    nComunicados += 3;
    await prisma.areaComun.create({ data: { complejo_id: cid, nombre: 'Salón de usos múltiples', descripcion: 'Para reuniones y cumpleaños', capacidad: 40, hora_apertura: '09:00', hora_cierre: '22:00', duracion_max_horas: 4, dias_anticipacion_max: 30, requiere_aprobacion: true } });
  }
  let nReservas = 0;
  for (const condo of condos) {
    const area = await prisma.areaComun.findFirstOrThrow({ where: { complejo_id: condo.id! }, select: { id: true } });
    const picks = barajar(condo.dptos.filter((d) => d.perfil === 'al_dia' && d.inqKey == null)).slice(0, 4);
    for (const [k, d] of picks.entries()) {
      const baseT = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate(), 15) + (k + 2) * 3 * DIA;
      await prisma.reserva.create({ data: { area_id: area.id, unidad_id: d.id!, usuario_id: d.duenoId!, inicio: new Date(baseT), fin: new Date(baseT + 3 * 3600000), estado: k % 2 === 0 ? 'pendiente' : 'aprobada', ...(k % 2 === 1 ? { resuelto_por_id: admin.id, resuelto_at: new Date() } : {}) } });
      nReservas++;
    }
  }
  const proveedores = [
    { razon_social: 'Ascensores Andinos SAC', rubro: 'ascensores', contacto_nombre: 'Ing. Walter Palomino', ruc: '20999000101', visible_vecinos: false },
    { razon_social: 'Gasfitería Rápida Lima', rubro: 'gasfiteria', contacto_nombre: 'Sr. Hugo Benavides', ruc: '20999000102', visible_vecinos: true },
    { razon_social: 'Electricidad y Luz EIRL', rubro: 'electricidad', contacto_nombre: 'Sr. Julio Zevallos', ruc: '20999000103', visible_vecinos: true },
    { razon_social: 'Jardines del Sur', rubro: 'jardineria', contacto_nombre: 'Sra. Karina Lazo', ruc: '20999000104', visible_vecinos: false },
    { razon_social: 'Fumigaciones Seguras SAC', rubro: 'fumigacion', contacto_nombre: 'Sr. Óscar Tello', ruc: '20999000105', visible_vecinos: true },
  ];
  for (const [i, p] of proveedores.entries()) {
    const pr = await prisma.proveedor.create({ data: { ...p, empresa_id: empresa.id, telefono: telefono(), email: `${slug(p.razon_social).slice(0, 18)}@${DOMINIO_DEMO}`, notas: 'Proveedor de ejemplo.' }, select: { id: true } });
    for (const c of condos) if (p.rubro !== 'ascensores' || c === mirador || i === 0) await prisma.proveedorComplejo.create({ data: { proveedor_id: pr.id, complejo_id: c.id! } });
  }
  const tareas = [
    { titulo: 'Revisar la bomba de agua de la cisterna', estado: 'en_proceso', quien: 'mantenimiento', unidad: null },
    { titulo: 'Cambiar focos del pasillo del piso 3 (Block 2)', estado: 'pendiente', quien: 'mantenimiento', unidad: null },
    { titulo: 'Gotera en el techo del B01-501', estado: 'pendiente', quien: 'mantenimiento', unidad: 'B01-501' },
    { titulo: 'Pintar la reja de la entrada principal', estado: 'completada', quien: 'mantenimiento', unidad: null },
    { titulo: 'Limpieza profunda del hall y las escaleras', estado: 'pendiente', quien: 'limpieza', unidad: null },
  ];
  for (const t of tareas) {
    const u = t.unidad ? dpto(palmeras, t.unidad).id : null;
    await prisma.tareaMantenimiento.create({ data: { titulo: t.titulo, descripcion: 'Tarea de ejemplo de la demo.', estado: t.estado, unidad_id: u ?? null, asignado_id: personal[t.quien]!, creado_por_id: admin.id, ...(t.estado === 'completada' ? { fecha_cierre: hace(2) } : {}) } });
  }
  // Lecturas de agua del edificio (las dos últimas): consumo de 6 a 22 m³ con el factor del condominio.
  for (const m of [ACTUAL - 1, ACTUAL]) {
    const reciboId = mirador.recibos[m]!.get(0)!;
    const desde = new Date(Date.UTC(MESES[m]!.anio, MESES[m]!.mes - 2, 25));
    const hasta = new Date(Date.UTC(MESES[m]!.anio, MESES[m]!.mes - 1, 25));
    await prisma.lecturaAgua.createMany({
      data: mirador.dptos.map((d, i) => {
        const anterior = 100 + ((d.id! * 31) % 400) + m * 12;
        return { unidad_id: d.id!, recibo_id: reciboId, fecha_anterior: desde, lectura_anterior: anterior.toFixed(3), fecha_actual: hasta, lectura_actual: (anterior + 6 + ((i * 5 + m * 3) % 17)).toFixed(3), factor: '4.5000', registrado_por_id: admin.id };
      }),
    });
  }

  // Sin avisos ni sesiones de la siembra; superadmins de la instancia de vuelta; la demo queda lista.
  await prisma.notificacion.deleteMany({});
  await prisma.sesion.deleteMany({});
  for (const s of superadmins) await prisma.usuario.create({ data: { nombre: s.nombre, email: s.email, telefono: s.telefono, rol: 'superadmin', password_hash: s.password_hash, correo_verificado: true } });
  await prisma.configuracionDemo.update({ where: { id: 1 }, data: { sembrada_at: new Date(), reiniciando_desde: null } });
  invalidarDemo();
  invalidarComercial();

  const [tot] = await prisma.$queryRaw<{ usuarios: bigint; recibos: bigint; pagos: bigint; por_validar: bigint; rechazados: bigint }[]>`SELECT
    (SELECT count(*) FROM "Usuario") AS usuarios, (SELECT count(*) FROM "Recibo") AS recibos, (SELECT count(*) FROM "Pago") AS pagos,
    (SELECT count(*) FROM "Pago" WHERE estado_validacion = 'por_validar' AND (grupo IS NULL OR grupo_principal)) AS por_validar,
    (SELECT count(*) FROM "Pago" WHERE estado_validacion = 'rechazado' AND (grupo IS NULL OR grupo_principal)) AS rechazados`;
  return {
    base,
    condominios: condos.map((c) => ({ nombre: c.plan.nombre, blocks: c.estructuras.length, departamentos: c.dptos.length })),
    usuarios: Number(tot!.usuarios), recibos: Number(tot!.recibos), pagos: Number(tot!.pagos), por_validar: Number(tot!.por_validar), rechazados: Number(tot!.rechazados),
    comunicados: nComunicados, reservas: nReservas, problemas: await auditarCoherencia(), segundos: Math.round((Date.now() - t0) / 1000),
  };
}
