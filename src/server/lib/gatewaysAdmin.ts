// Escrituras de gateways, dominios permitidos y OCR. Sólo el superadmin llega aquí (la ruta lo exige); la auditoría la pone la ruta y
// NUNCA lleva claves. Toda URL pasa por `validarUrlDestino` al guardar; la barrera de red se aplica además en cada llamada.
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { conflict, invalid, notFound } from '../errors';
import { claveCooldown, limpiar } from './cooldown';
import { aadOcr, dominiosPermitidos } from './gatewaysDatos';
import { GatewayError, PROVEEDOR_GATEWAY, normalizarDominio, validarEntradaOcr, validarUrlDestino } from './gateways';
import { cifrar, llaveroConfigurado } from './secretBox';
import { olvidarUso } from '../services/rotacion';

/** Convierte el rechazo de una barrera en un 422 pegado al campo del formulario. */
function comoCampo<T>(campo: string, fn: () => T): T {
  try { return fn(); } catch (err) {
    if (err instanceof GatewayError) throw invalid(err.message, { [campo]: err.message });
    throw err;
  }
}

// ---------- Dominios permitidos ----------
export const listarDominios = () => prisma.dominioGatewayPermitido.findMany({ orderBy: { dominio: 'asc' } });

export async function agregarDominio(dominio: string, usuarioId: number) {
  const d = comoCampo('dominio', () => normalizarDominio(dominio));
  try {
    return await prisma.dominioGatewayPermitido.create({ data: { dominio: d, creado_por_id: usuarioId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw conflict('Ese dominio ya está en la lista');
    throw err;
  }
}

export async function quitarDominio(id: number) {
  const f = await prisma.dominioGatewayPermitido.findUnique({ where: { id } });
  if (!f) throw notFound('Dominio');
  await prisma.dominioGatewayPermitido.delete({ where: { id } });
  return f;
}

// ---------- Gateways ----------
export interface EntradaGateway {
  nombre: string;
  base_url: string;
  modelo_por_defecto?: string | null;
  modelo_vision?: string | null;
  vision?: boolean;
  prioridad?: number;
  prioridad_vision?: number | null;
}

async function exigirNombreLibre(nombre: string, exceptoId?: number) {
  const otro = await prisma.gatewayIA.findFirst({ where: { nombre: { equals: nombre, mode: 'insensitive' }, ...(exceptoId ? { id: { not: exceptoId } } : {}) }, select: { id: true } });
  if (otro) throw invalid('Ya hay un gateway con ese nombre', { nombre: 'Ya hay un gateway con ese nombre' });
}

export async function crearGateway(e: EntradaGateway, usuarioId: number) {
  const dominios = await dominiosPermitidos();
  const { url } = comoCampo('base_url', () => validarUrlDestino(e.base_url, dominios));
  await exigirNombreLibre(e.nombre);
  return prisma.gatewayIA.create({
    data: { nombre: e.nombre, base_url: url, modelo_por_defecto: e.modelo_por_defecto || null, modelo_vision: e.modelo_vision || null, vision: e.vision ?? false, prioridad: e.prioridad ?? 20, prioridad_vision: e.prioridad_vision ?? null, creado_por_id: usuarioId },
  });
}

export type AjusteGateway = Partial<EntradaGateway> & { habilitado?: boolean };

/** Si cambia el servidor al que apuntan las claves, éstas vuelven a «sin probar» y se descarta su catálogo de modelos (era de otro servidor). */
export async function ajustarGateway(id: number, a: AjusteGateway) {
  const previo = await prisma.gatewayIA.findUnique({ where: { id } });
  if (!previo) throw notFound('Gateway');
  const data: Prisma.GatewayIAUpdateInput = {};
  let urlCambia = false;
  if (a.base_url !== undefined) {
    const dominios = await dominiosPermitidos();
    const { url } = comoCampo('base_url', () => validarUrlDestino(a.base_url!, dominios));
    if (url !== previo.base_url) { data.base_url = url; urlCambia = true; }
  }
  if (a.nombre !== undefined && a.nombre !== previo.nombre) { await exigirNombreLibre(a.nombre, id); data.nombre = a.nombre; }
  if (a.modelo_por_defecto !== undefined) data.modelo_por_defecto = a.modelo_por_defecto || null;
  if (a.modelo_vision !== undefined) data.modelo_vision = a.modelo_vision || null;
  if (a.vision !== undefined) data.vision = a.vision;
  if (a.prioridad !== undefined) data.prioridad = a.prioridad;
  if (a.prioridad_vision !== undefined) data.prioridad_vision = a.prioridad_vision;
  if (a.habilitado !== undefined) data.habilitado = a.habilitado;
  const fila = await prisma.gatewayIA.update({ where: { id }, data });
  if (urlCambia) {
    const claves = await prisma.claveIntegracion.findMany({ where: { gateway_id: id }, select: { id: true } });
    await prisma.claveIntegracion.updateMany({ where: { gateway_id: id }, data: { estado: 'sin_probar', estado_detalle: null, probada_at: null, aviso_modelo: null } });
    await prisma.modeloIA.deleteMany({ where: { clave_id: { in: claves.map((c) => c.id) } } });
    for (const c of claves) { limpiar(claveCooldown(PROVEEDOR_GATEWAY, c.id)); olvidarUso(c.id); }
  }
  return { fila, urlCambia };
}

/** Borra el gateway y, en cascada, sus claves (y sus modelos). */
export async function borrarGateway(id: number) {
  const g = await prisma.gatewayIA.findUnique({ where: { id }, include: { claves: { select: { id: true } } } });
  if (!g) throw notFound('Gateway');
  await prisma.gatewayIA.delete({ where: { id } });
  for (const c of g.claves) { limpiar(claveCooldown(PROVEEDOR_GATEWAY, c.id)); olvidarUso(c.id); }
  return { fila: g, clavesBorradas: g.claves.length };
}

// ---------- OCR ----------
export interface EntradaOcr { modo: 'interno' | 'publico'; base_url?: string | null; clave?: string | null; habilitado?: boolean }

/** Guarda el destino del OCR (interno de la lista fija del código, o https público con las barreras) y su clave cifrada. Sin `clave` conserva la anterior. */
export async function guardarOcr(e: EntradaOcr, usuarioId: number) {
  const dominios = await dominiosPermitidos();
  const destino = comoCampo('base_url', () => validarEntradaOcr({ modo: e.modo, base_url: e.base_url }, dominios));
  const datos: Prisma.ConfiguracionOcrUncheckedUpdateInput = { ...destino, habilitado: e.habilitado ?? true, actualizado_por_id: usuarioId };
  if (e.clave) {
    if (!llaveroConfigurado()) throw invalid('El llavero no está configurado en el servidor', { clave: 'El llavero no está configurado en el servidor' });
    if (e.clave.length < 8 || e.clave.length > 400 || /\s/.test(e.clave)) throw invalid('La clave debe tener entre 8 y 400 caracteres, sin espacios', { clave: 'La clave debe tener entre 8 y 400 caracteres, sin espacios' });
    datos.api_key_enc = cifrar(e.clave, aadOcr());
    datos.ultimos4 = e.clave.slice(-4);
  }
  return prisma.configuracionOcr.upsert({ where: { id: 1 }, create: { id: 1, ...destino, habilitado: e.habilitado ?? true, actualizado_por_id: usuarioId, api_key_enc: datos.api_key_enc as string | undefined, ultimos4: datos.ultimos4 as string | undefined }, update: datos });
}

export async function ajustarOcr(habilitado: boolean, usuarioId: number) {
  const previo = await prisma.configuracionOcr.findUnique({ where: { id: 1 } });
  if (!previo) throw notFound('Configuración del OCR');
  return prisma.configuracionOcr.update({ where: { id: 1 }, data: { habilitado, actualizado_por_id: usuarioId } });
}

/**
 * «Quitar» deja la fila vacía y pausada (sin destino ni clave) en vez de borrarla: así la migración desde `OCR_BASE_URL` no vuelve a
 * resucitar lo que el superadmin quitó a propósito (la fila existente es la marca de «ya migrado»).
 */
export async function quitarOcr(usuarioId: number) {
  const previo = await prisma.configuracionOcr.findUnique({ where: { id: 1 } });
  if (!previo || (!previo.destino_interno && !previo.base_url)) throw notFound('Configuración del OCR');
  await prisma.configuracionOcr.update({ where: { id: 1 }, data: { modo: 'interno', destino_interno: null, base_url: null, api_key_enc: null, ultimos4: null, habilitado: false, actualizado_por_id: usuarioId } });
  return previo;
}
