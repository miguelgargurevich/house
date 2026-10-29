/**
 * Juntas directivas por block, con gestiones (periodos) e historial. La cuenta de la junta ES el medio de pago del block.
 *
 * Los permisos de la junta (`lib/junta.ts`, `middleware/auth.ts`) siguen saliendo de `Usuario.cargo_junta` y `Usuario.estructura_id`; ahora
 * esos dos campos son un REFLEJO de la junta vigente: `sincronizarCargos` los pone a sus miembros y se los quita a quien ya no está.
 * Nadie los edita a mano (Personas y `/api/usuarios` los rechazan).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { forbidden, invalid } from '../errors';
import { CARGOS_JUNTA, type CargoJunta } from '../lib/junta';
import { emailSchema, texto, z } from '../validation';
import { revocarDeUsuario } from './sesiones';
import { columnas, nombreEntidad, MAX_ACTIVOS, type MedioInput } from './mediosPago';

type Tx = Prisma.TransactionClient;

export const MAX_NOTAS = 500;
const DIA_MS = 86_400_000;

// ---------- Entradas ----------
/** «2026-01-01»: una fecha de calendario (se guarda a las 00:00 UTC, como las de los recibos). */
export const diaSchema = z
  .string({ error: 'Fecha inválida (usa AAAA-MM-DD)' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (usa AAAA-MM-DD)')
  .transform((s) => new Date(`${s}T00:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'Fecha inválida');

export const miembroSchema = z.object({
  usuario_id: z.coerce.number({ error: 'Debe ser un número' }).int().positive(),
  cargo: z.enum(CARGOS_JUNTA, { error: `cargo debe ser: ${CARGOS_JUNTA.join(', ')}` }),
});
export type MiembroEntrada = z.infer<typeof miembroSchema>;

export const correoJuntaSchema = z.preprocess((v) => (v === '' ? null : v), emailSchema.nullish());
export const notasSchema = z.preprocess((v) => (v === '' ? null : v), texto(MAX_NOTAS).nullish());
export const miembrosSchema = z.array(miembroSchema, { error: 'miembros debe ser una lista' }).max(20, 'Máximo 20 miembros');

// ---------- Fechas ----------
export const diaTexto = (d: Date) => d.toISOString().slice(0, 10);
export const diaAnterior = (d: Date) => new Date(d.getTime() - DIA_MS);

// ---------- Reglas ----------
/** Un solo presidente, un solo tesorero y un solo secretario (vocales, varios); nadie repetido. */
export function validarCargos(miembros: MiembroEntrada[]) {
  const vistos = new Set<number>();
  for (const m of miembros) {
    if (vistos.has(m.usuario_id)) throw invalid('Datos inválidos: miembros: una persona no puede estar dos veces en la junta', { miembros: 'Persona repetida' });
    vistos.add(m.usuario_id);
  }
  for (const cargo of ['presidente', 'tesorero', 'secretario'] as const) {
    if (miembros.filter((m) => m.cargo === cargo).length > 1) throw invalid(`Datos inválidos: miembros: solo puede haber un ${cargo}`, { miembros: `Solo un ${cargo}` });
  }
}

/**
 * Cada miembro debe ser un propietario con una unidad en el block de la junta (o en el condominio, si la junta es de todo el condominio),
 * con su ficha en ese mismo condominio (o sin condominio) y sin estar en otra junta vigente (sólo hay un reflejo `cargo_junta` por persona).
 * `juntaSaliente` = la gestión que se está cerrando: sus miembros pueden pasar a la nueva.
 */
export async function validarMiembros(tx: Tx, ambito: { complejo_id: number; estructura_id: number | null }, miembros: MiembroEntrada[], juntaSaliente?: number) {
  validarCargos(miembros);
  if (!miembros.length) return;
  const ids = miembros.map((m) => m.usuario_id);
  const usuarios = await tx.usuario.findMany({
    where: { id: { in: ids } },
    select: { id: true, nombre: true, rol: true, complejo_id: true, unidades: { where: { complejo_id: ambito.complejo_id, ...(ambito.estructura_id != null ? { estructura_id: ambito.estructura_id } : {}) }, select: { id: true }, take: 1 } },
  });
  const porId = new Map(usuarios.map((u) => [u.id, u]));
  for (const m of miembros) {
    const u = porId.get(m.usuario_id);
    const dondeEs = ambito.estructura_id != null ? 'del block' : 'del condominio';
    if (!u || u.rol !== 'propietario' || !u.unidades.length) throw invalid(`Datos inválidos: miembros: ${u?.nombre ?? `el usuario ${m.usuario_id}`} debe ser propietario de una unidad ${dondeEs}`, { miembros: `Debe ser propietario de una unidad ${dondeEs}` });
    if (u.complejo_id != null && u.complejo_id !== ambito.complejo_id) throw invalid(`Datos inválidos: miembros: ${u.nombre} pertenece a otro condominio`, { miembros: 'Pertenece a otro condominio' });
  }
  const otras = await tx.miembroJunta.findFirst({
    where: { usuario_id: { in: ids }, junta: { hasta: null, ...(juntaSaliente != null ? { id: { not: juntaSaliente } } : {}) } },
    select: { usuario: { select: { nombre: true } }, junta: { select: { estructura: { select: { nombre: true } } } } },
  });
  if (otras) throw invalid(`Datos inválidos: miembros: ${otras.usuario.nombre} ya es miembro de la junta vigente de ${otras.junta.estructura?.nombre ?? 'otro ámbito'}`, { miembros: 'Ya está en otra junta vigente' });
}

/** Bloquea el condominio dentro de la transacción: dos cambios de junta del mismo condominio no se pisan (no hay índices parciales en Prisma). */
export async function bloquearCondominio(tx: Tx, complejoId: number) {
  await tx.$queryRaw`SELECT id FROM "ComplejoHabitacional" WHERE id = ${complejoId} FOR UPDATE`;
}

export const vigenteDe = (tx: Tx | typeof prisma, complejoId: number, estructuraId: number | null) =>
  tx.juntaDirectiva.findFirst({ where: { complejo_id: complejoId, estructura_id: estructuraId, hasta: null }, orderBy: { id: 'desc' } });

// ---------- El reflejo en el usuario ----------
/**
 * Pone `cargo_junta` y `estructura_id` a los miembros de la junta vigente de (condominio, block) y se los quita a quien ya no está.
 * Dentro de la transacción de quien llama; devuelve los usuarios cuyo cargo cambió para que, ya confirmada, se cierren sus sesiones.
 */
export async function sincronizarCargosTx(tx: Tx, complejoId: number, estructuraId: number | null): Promise<number[]> {
  const vigente = await vigenteDe(tx, complejoId, estructuraId);
  const miembros = vigente ? await tx.miembroJunta.findMany({ where: { junta_id: vigente.id }, select: { usuario_id: true, cargo: true } }) : [];
  const objetivo = new Map(miembros.map((m) => [m.usuario_id, m.cargo]));
  const cambiados: number[] = [];

  const conCargo = await tx.usuario.findMany({ where: { cargo_junta: { not: null }, complejo_id: complejoId, estructura_id: estructuraId }, select: { id: true } });
  for (const u of conCargo) {
    if (objetivo.has(u.id)) continue;
    await tx.usuario.update({ where: { id: u.id }, data: { cargo_junta: null, estructura_id: null } });
    cambiados.push(u.id);
  }
  if (!miembros.length) return cambiados;
  const actuales = await tx.usuario.findMany({ where: { id: { in: [...objetivo.keys()] } }, select: { id: true, cargo_junta: true, estructura_id: true, complejo_id: true } });
  for (const u of actuales) {
    const cargo = objetivo.get(u.id)!;
    if (u.cargo_junta === cargo && u.estructura_id === estructuraId && u.complejo_id === complejoId) continue;
    await tx.usuario.update({ where: { id: u.id }, data: { cargo_junta: cargo, estructura_id: estructuraId, complejo_id: complejoId } });
    if (!cambiados.includes(u.id)) cambiados.push(u.id);
  }
  return cambiados;
}

/** Cierra las sesiones abiertas de quien cambió de cargo (como al cambiar su rol): vuelven a entrar con sus permisos nuevos. */
export async function cerrarSesiones(ids: number[]) {
  for (const id of ids) await revocarDeUsuario(id);
}

/** `sincronizarCargosTx` en su propia transacción, más el cierre de sesiones. Devuelve los usuarios cuyo cargo cambió. */
export async function sincronizarCargos(complejoId: number, estructuraId: number | null): Promise<number[]> {
  const cambiados = await prisma.$transaction((tx) => sincronizarCargosTx(tx, complejoId, estructuraId));
  await cerrarSesiones(cambiados);
  return cambiados;
}

// ---------- Escritura ----------
/** Reemplaza los miembros de la junta por la lista dada (agrega, quita y cambia de cargo). */
export async function reemplazarMiembros(tx: Tx, juntaId: number, miembros: MiembroEntrada[]) {
  const actuales = await tx.miembroJunta.findMany({ where: { junta_id: juntaId }, select: { id: true, usuario_id: true, cargo: true } });
  const nuevos = new Map(miembros.map((m) => [m.usuario_id, m.cargo]));
  const quitar = actuales.filter((a) => !nuevos.has(a.usuario_id)).map((a) => a.id);
  if (quitar.length) await tx.miembroJunta.deleteMany({ where: { id: { in: quitar } } });
  // Un cargo único cambia de manos: el que lo deja libera el cargo antes de que otro lo tome (nada lo exige en la base, pero así el orden no importa).
  for (const a of actuales) {
    const cargo = nuevos.get(a.usuario_id);
    if (cargo != null && cargo !== a.cargo) await tx.miembroJunta.update({ where: { id: a.id }, data: { cargo } });
  }
  const ya = new Set(actuales.map((a) => a.usuario_id));
  const agregar = miembros.filter((m) => !ya.has(m.usuario_id));
  if (agregar.length) await tx.miembroJunta.createMany({ data: agregar.map((m) => ({ junta_id: juntaId, usuario_id: m.usuario_id, cargo: m.cargo })) });
}

/** Cuentas activas de una junta, tal cual (con el QR), para copiarlas a la gestión siguiente. */
export const cuentasActivas = (tx: Tx, juntaId: number) => tx.medioPago.findMany({ where: { junta_id: juntaId, activo: true }, orderBy: [{ orden: 'asc' }, { id: 'asc' }] });

/** Copia cuentas a otra junta (registros nuevos, activos; los viejos quedan en el historial). */
export async function copiarCuentas(tx: Tx, cuentas: Awaited<ReturnType<typeof cuentasActivas>>, aJuntaId: number, creadoPor: number | null): Promise<number> {
  for (const m of cuentas) {
    // Todo lo de la cuenta (con su QR) menos lo que es del registro viejo: su id, sus fechas, su junta y quién la creó.
    const datos: Record<string, unknown> = { ...m };
    for (const k of ['id', 'created_at', 'updated_at', 'junta_id', 'creado_por_id']) delete datos[k];
    await tx.medioPago.create({ data: { ...(datos as Prisma.MedioPagoUncheckedCreateInput), junta_id: aJuntaId, creado_por_id: creadoPor, activo: true } });
  }
  return cuentas.length;
}

/** Crea la cuenta nueva de una junta (el mismo formulario de siempre). */
export async function crearCuenta(tx: Tx, junta: { id: number; complejo_id: number; estructura_id: number | null }, d: MedioInput, creadoPor: number | null) {
  const activos = await tx.medioPago.count({ where: { complejo_id: junta.complejo_id, estructura_id: junta.estructura_id, activo: true } });
  if (d.activo !== false && activos >= MAX_ACTIVOS) throw invalid(`Datos inválidos: activo: máximo ${MAX_ACTIVOS} medios de pago activos por block`, { activo: `Máximo ${MAX_ACTIVOS} activos` });
  return tx.medioPago.create({
    data: { complejo_id: junta.complejo_id, estructura_id: junta.estructura_id, ...columnas(d), activo: d.activo ?? true, orden: d.orden ?? 0, creado_por_id: creadoPor, junta_id: junta.id },
    omit: { qr_datos: true },
  });
}

/** Sólo la junta vigente se edita: una gestión cerrada es historia. */
export function exigirVigente(j: { hasta: Date | null }) {
  if (j.hasta != null) throw invalid('Esa gestión ya terminó: es sólo de lectura. Edita la junta vigente o registra una nueva gestión', { junta: 'Gestión cerrada' });
}

/** La junta no gestiona miembros, notas ni gestiones: sólo el correo y la cuenta de SU junta. */
export const soloAdministracion = () => forbidden('Solo la administración cambia los miembros de la junta y registra gestiones nuevas');

// ---------- Salida ----------
const sinQr = { qr_datos: true } as const;
const incluirJunta = {
  complejo: { select: { id: true, nombre: true } },
  estructura: { select: { id: true, nombre: true, tipo: true } },
  miembros: { orderBy: { id: 'asc' as const }, include: { usuario: { select: { id: true, nombre: true, email: true, telefono: true } } } },
  mediosPago: { orderBy: [{ orden: 'asc' as const }, { id: 'asc' as const }], omit: sinQr },
} satisfies Prisma.JuntaDirectivaInclude;
export const incluirDetalle = incluirJunta;

type JuntaCargada = Prisma.JuntaDirectivaGetPayload<{ include: typeof incluirJunta }>;

const ORDEN_CARGO: Record<string, number> = { presidente: 0, tesorero: 1, secretario: 2, vocal: 3 };

/** Departamentos de cada miembro en el ámbito de la junta (para mostrar «B01-804» junto al nombre). */
async function departamentosDe(juntas: JuntaCargada[]): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  const ids = [...new Set(juntas.flatMap((j) => j.miembros.map((m) => m.usuario_id)))];
  if (!ids.length) return mapa;
  const unidades = await prisma.unidad.findMany({
    where: { propietario_id: { in: ids }, complejo_id: { in: [...new Set(juntas.map((j) => j.complejo_id))] } },
    orderBy: [{ codigo: 'asc' }, { id: 'asc' }],
    select: { codigo: true, propietario_id: true, complejo_id: true, estructura_id: true },
  });
  for (const j of juntas) {
    for (const m of j.miembros) {
      const suyas = unidades.filter((u) => u.propietario_id === m.usuario_id && u.complejo_id === j.complejo_id && (j.estructura_id == null || u.estructura_id === j.estructura_id));
      mapa.set(`${j.id}:${m.usuario_id}`, suyas.map((u) => u.codigo));
    }
  }
  return mapa;
}

export async function formatearJuntas(juntas: JuntaCargada[]) {
  const deptos = await departamentosDe(juntas);
  return juntas.map((j) => ({
    id: j.id,
    complejo_id: j.complejo_id,
    estructura_id: j.estructura_id,
    complejo: j.complejo,
    estructura: j.estructura,
    desde: diaTexto(j.desde),
    hasta: j.hasta ? diaTexto(j.hasta) : null,
    vigente: j.hasta == null,
    correo: j.correo,
    notas: j.notas,
    miembros: [...j.miembros]
      .sort((a, b) => (ORDEN_CARGO[a.cargo] ?? 9) - (ORDEN_CARGO[b.cargo] ?? 9) || a.id - b.id)
      .map((m) => ({ id: m.id, usuario_id: m.usuario_id, cargo: m.cargo as CargoJunta, nombre: m.usuario.nombre, email: m.usuario.email, telefono: m.usuario.telefono, departamentos: deptos.get(`${j.id}:${m.usuario_id}`) ?? [] })),
    medios: j.mediosPago.map((m) => ({ ...m, tiene_qr: m.qr_tipo_mime != null, entidad: nombreEntidad(m) })),
    created_at: j.created_at,
  }));
}

export async function juntaFormateada(id: number) {
  const j = await prisma.juntaDirectiva.findUniqueOrThrow({ where: { id }, include: incluirJunta });
  return (await formatearJuntas([j]))[0]!;
}

// ---------- El correo de la junta ----------
/** Correo al que llegan los vouchers de un block: el de su junta vigente y, si no tiene, el `correo_vouchers` del block (los recibos viejos no se rompen). */
export function correoEfectivo(est: { correo_vouchers: string | null; juntas?: { correo: string | null }[] } | null | undefined): string | null {
  return est?.juntas?.find((j) => j.correo?.trim())?.correo?.trim() || est?.correo_vouchers?.trim() || null;
}

/** Fragmento de `select` para traer la junta vigente de un block junto con su `correo_vouchers`. */
export const selectCorreoBlock = { correo_vouchers: true, juntas: { where: { hasta: null }, select: { correo: true }, take: 1 } } as const;
