/**
 * Crear lo que le falta al condominio para cargar el Excel de recibos (`POST /api/recibos/excel`): blocks, pisos, departamentos y propietarios.
 * Todo corre dentro de la transacción del recibo (recibe el `tx`): si algo falla, no queda ni el block ni las unidades.
 *
 * Nunca toca lo que ya existe: un block o departamento que está no se modifica ni cambia de propietario. Los propietarios que se crean
 * son nuevos SIEMPRE (nunca se reutiliza un usuario por su correo de relleno: puede ser de otro condominio u otra empresa).
 */
import { sincronizarUnidades } from './personas/sincronizar';
import type { Prisma } from '@prisma/client';
import { HttpError, conflict, invalid } from '../errors';
import { correoDeRelleno, nombreDeBlock } from '../lib/excelRecibos';

type Tx = Prisma.TransactionClient;

/** Topes por subida: un Excel no puede pedir miles de departamentos de golpe (el condominio más grande que se carga hoy tiene 448). */
export const MAX_UNIDADES_NUEVAS = 1000;
export const MAX_BLOCKS_NUEVOS = 60;
/** Intentos de sufijo (`-2`, `-3`…) cuando el correo de relleno ya lo tiene otro usuario. */
const MAX_SUFIJOS = 50;

export interface UnidadNueva {
  /** `${numero}|${dpto}`: dos filas del mismo departamento crean una sola unidad. */
  clave: string;
  numero: number;
  /** Número de departamento en su forma canónica (`dptoCreable`). */
  dpto: string;
  codigo: string;
  /** Nombre del Excel recortado; null = la unidad queda sin propietario. */
  nombre: string | null;
  /** El block si YA existe; null = el block también se crea. */
  estructuraId: number | null;
  piso: number | null;
}

export interface BlockFaltante {
  nombre: string;
  /** true = el block no existe y se crea; false = ya existe y sólo se le agregan departamentos. */
  nuevo: boolean;
  /** Pisos que se crean (todos los del block si es nuevo; sólo los que falten si ya existe). */
  pisos: number;
  /** Códigos de las unidades que se crean (nunca nombres de personas). */
  unidades: string[];
  propietarios: number;
}

export interface ResumenFaltantes {
  blocks: BlockFaltante[];
  totales: { blocks: number; pisos: number; unidades: number; propietarios: number };
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Resume lo que se crearía (sólo conteos y códigos). `pisosExistentes`: por block que ya existe, los números de piso que ya tiene. */
export function resumirFaltantes(nuevas: UnidadNueva[], estructuras: { id: number; nombre: string | null }[], pisosExistentes: Map<number, Set<number>>): ResumenFaltantes {
  const grupos = new Map<string, { nombre: string; nuevo: boolean; estructuraId: number | null; unidades: UnidadNueva[] }>();
  for (const u of nuevas) {
    const k = u.estructuraId != null ? `e${u.estructuraId}` : `n${u.numero}`;
    if (!grupos.has(k)) {
      const nombre = u.estructuraId != null ? estructuras.find((e) => e.id === u.estructuraId)?.nombre ?? nombreDeBlock(u.numero) : nombreDeBlock(u.numero);
      grupos.set(k, { nombre, nuevo: u.estructuraId == null, estructuraId: u.estructuraId, unidades: [] });
    }
    grupos.get(k)!.unidades.push(u);
  }
  const blocks: BlockFaltante[] = [...grupos.values()]
    .sort((a, b) => Number(b.nuevo) - Number(a.nuevo) || a.nombre.localeCompare(b.nombre, 'es', { numeric: true }))
    .map((g) => {
      const necesarios = new Set(g.unidades.map((u) => u.piso).filter((p): p is number => p != null));
      const maximo = necesarios.size ? Math.max(...necesarios) : 0;
      // Un block nuevo lleva pisos 1..máximo (como al crearlo a mano con «cantidad de pisos»); en uno que ya existe sólo se agrega el piso que falta.
      const pisos = g.nuevo ? maximo : [...necesarios].filter((p) => !pisosExistentes.get(g.estructuraId!)?.has(p)).length;
      return { nombre: g.nombre, nuevo: g.nuevo, pisos, unidades: g.unidades.map((u) => u.codigo).sort(), propietarios: g.unidades.filter((u) => u.nombre).length };
    });
  return {
    blocks,
    totales: {
      blocks: blocks.filter((b) => b.nuevo).length,
      pisos: blocks.reduce((s, b) => s + b.pisos, 0),
      unidades: blocks.reduce((s, b) => s + b.unidades.length, 0),
      propietarios: blocks.reduce((s, b) => s + b.propietarios, 0),
    },
  };
}

/** Texto para la pantalla: «Se van a crear el Block 5, 8 pisos, 32 departamentos y 32 propietarios.» */
export function mensajeFaltantes(r: ResumenFaltantes): string {
  const nuevos = r.blocks.filter((b) => b.nuevo).map((b) => b.nombre);
  const partes: string[] = [];
  if (nuevos.length === 1) partes.push(`el ${nuevos[0]}`);
  else if (nuevos.length > 1) partes.push(nuevos.length <= 4 ? `los blocks ${nuevos.slice(0, -1).join(', ')} y ${nuevos[nuevos.length - 1]}` : `${nuevos.length} blocks nuevos`);
  if (r.totales.pisos > 0) partes.push(plural(r.totales.pisos, 'piso', 'pisos'));
  partes.push(plural(r.totales.unidades, 'departamento', 'departamentos'));
  partes.push(plural(r.totales.propietarios, 'propietario', 'propietarios'));
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : partes[0]!;
  const enExistentes = r.blocks.filter((b) => !b.nuevo);
  const extra = enExistentes.length
    ? ` Incluye ${plural(enExistentes.reduce((s, b) => s + b.unidades.length, 0), 'departamento', 'departamentos')} en ${enExistentes.length === 1 ? 'un block que ya existe' : 'blocks que ya existen'} (${enExistentes.map((b) => b.nombre).join(', ')}).`
    : '';
  return `El Excel trae lo que el condominio aún no tiene. Se van a crear ${lista}.${extra} Los propietarios se crean sin correo y sin acceso, y no se les avisa.`;
}

/** Topes de una sola subida; se revisan antes de la vista previa para no mostrar algo que luego no se puede confirmar. */
export function exigirTopes(r: ResumenFaltantes): void {
  if (r.totales.unidades > MAX_UNIDADES_NUEVAS) throw invalid(`El Excel pide crear ${r.totales.unidades} departamentos de una vez; el máximo por subida es ${MAX_UNIDADES_NUEVAS}. Sube un block a la vez`, { archivo: 'Demasiados departamentos nuevos' });
  if (r.totales.blocks > MAX_BLOCKS_NUEVOS) throw invalid(`El Excel pide crear ${r.totales.blocks} blocks de una vez; el máximo por subida es ${MAX_BLOCKS_NUEVOS}`, { archivo: 'Demasiados blocks nuevos' });
}

/**
 * Candado por condominio para crear blocks y departamentos: dos subidas distintas (otro mes, doble clic) no pueden crear el mismo block dos veces.
 * Se toma DESPUÉS del candado del periodo y siempre en ese orden. La clave 1 no choca con las del periodo (`anio * 100 + mes` ≥ 200001).
 */
export async function bloquearEstructuras(tx: Tx, complejoId: number): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${complejoId}::int, 1::int)`;
}

/** Primer correo de relleno libre: el base y, si ya lo tiene otro usuario, `…-2`, `…-3`… (se compara en minúsculas, como se guarda). */
async function correosLibres(tx: Tx, bases: string[]): Promise<Map<string, string>> {
  const tomados = new Set((await tx.usuario.findMany({ where: { email: { in: bases } }, select: { email: true } })).map((u) => u.email.toLowerCase()));
  const elegido = new Map<string, string>();
  const pendientes = bases.filter((b) => tomados.has(b));
  for (const b of bases) if (!tomados.has(b)) elegido.set(b, b);
  for (const base of pendientes) {
    const [local, dominio] = base.split('@') as [string, string];
    const candidatos = Array.from({ length: MAX_SUFIJOS }, (_, i) => `${local}-${i + 2}@${dominio}`);
    const ocupados = new Set((await tx.usuario.findMany({ where: { email: { in: candidatos } }, select: { email: true } })).map((u) => u.email.toLowerCase()));
    const libre = candidatos.find((c) => !ocupados.has(c));
    if (!libre) throw conflict('No se pudo crear el propietario: demasiados usuarios con el mismo correo de relleno');
    elegido.set(base, libre);
  }
  return elegido;
}

export interface CreadoDelExcel {
  /** Block ya creado por número (los nuevos). */
  estructuras: Map<number, { id: number; nombre: string }>;
  /** Id de cada unidad creada, por su `clave`. */
  unidades: Map<string, number>;
  resumen: ResumenFaltantes;
}

/**
 * Crea los blocks nuevos con sus pisos, los pisos que falten en blocks que ya existen, los propietarios y las unidades (en este orden).
 * Cada unidad lleva la empresa y el condominio del condominio; cada propietario es `rol: propietario`, sin contraseña, sin empresa y sin invitar.
 */
export async function crearFaltantes(tx: Tx, p: { complejoId: number; empresaId: number | null; nuevas: UnidadNueva[]; resumen: ResumenFaltantes }): Promise<CreadoDelExcel> {
  const { complejoId, empresaId, nuevas, resumen } = p;
  const estructuras = new Map<number, { id: number; nombre: string }>();
  const idsDeBlock = (u: UnidadNueva): number => u.estructuraId ?? estructuras.get(u.numero)!.id;

  for (const numero of [...new Set(nuevas.filter((u) => u.estructuraId == null).map((u) => u.numero))].sort((a, b) => a - b)) {
    const est = await tx.estructura.create({ data: { nombre: nombreDeBlock(numero), tipo: 'block', complejo_id: complejoId }, select: { id: true, nombre: true } });
    estructuras.set(numero, { id: est.id, nombre: est.nombre ?? nombreDeBlock(numero) });
  }

  // Pisos: los que cada block necesita (1..máximo en uno nuevo; sólo los que falten en uno que ya existe).
  const necesarios = new Map<number, Set<number>>();
  for (const u of nuevas) {
    if (u.piso == null) continue;
    const id = idsDeBlock(u);
    const s = necesarios.get(id) ?? new Set<number>();
    if (u.estructuraId == null) for (let i = 1; i <= u.piso; i++) s.add(i);
    else s.add(u.piso);
    necesarios.set(id, s);
  }
  const existentes = await tx.piso.findMany({ where: { estructura_id: { in: [...necesarios.keys()] } }, select: { numero: true, estructura_id: true } });
  const yaTiene = new Set(existentes.map((x) => `${x.estructura_id}|${x.numero}`));
  const pisosNuevos = [...necesarios].flatMap(([estructura_id, nums]) => [...nums].filter((numero) => !yaTiene.has(`${estructura_id}|${numero}`)).sort((a, b) => a - b).map((numero) => ({ numero, estructura_id })));
  if (pisosNuevos.length) await tx.piso.createMany({ data: pisosNuevos });
  const pisos = await tx.piso.findMany({ where: { estructura_id: { in: [...necesarios.keys()] } }, select: { id: true, numero: true, estructura_id: true } });
  const pisoId = (estructuraId: number, numero: number | null) => (numero == null ? null : pisos.find((x) => x.estructura_id === estructuraId && x.numero === numero)?.id ?? null);

  // Propietarios: siempre usuarios nuevos; el correo de relleno que ya tenga alguien se esquiva con un sufijo.
  const conNombre = nuevas.filter((u) => u.nombre);
  const correos = conNombre.length ? await correosLibres(tx, conNombre.map((u) => correoDeRelleno(u.numero, u.dpto))) : new Map<string, string>();
  const correoDe = (u: UnidadNueva) => correos.get(correoDeRelleno(u.numero, u.dpto))!;
  if (conNombre.length) {
    await tx.usuario.createMany({ data: conNombre.map((u) => ({ nombre: u.nombre!, email: correoDe(u), rol: 'propietario', empresa_id: null })) });
  }
  const propietarios = conNombre.length ? await tx.usuario.findMany({ where: { email: { in: conNombre.map(correoDe) } }, select: { id: true, email: true } }) : [];
  const propietarioDe = new Map(propietarios.map((x) => [x.email.toLowerCase(), x.id]));

  await tx.unidad.createMany({
    data: nuevas.map((u) => ({
      codigo: u.codigo,
      tipo: 'departamento',
      estructura_id: idsDeBlock(u),
      piso_id: pisoId(idsDeBlock(u), u.piso),
      complejo_id: complejoId,
      empresa_id: empresaId,
      estado: 'activa',
      propietario_id: u.nombre ? propietarioDe.get(correoDe(u)) ?? null : null,
    })),
  });
  const creadas = await tx.unidad.findMany({ where: { complejo_id: complejoId, codigo: { in: nuevas.map((u) => u.codigo) } }, select: { id: true, codigo: true } });
  const porCodigo = new Map(creadas.map((x) => [x.codigo, x.id]));
  const unidades = new Map<string, number>();
  for (const u of nuevas) {
    const id = porCodigo.get(u.codigo);
    if (id == null) throw new HttpError(500, 'No se pudo crear una unidad del Excel');
    unidades.set(u.clave, id);
  }
  // Cada propietario nuevo queda también como persona de su departamento (titular, con aviso de cobro y comunicados).
  await sincronizarUnidades(tx, unidades.values());
  return { estructuras, unidades, resumen };
}
