import { prisma } from '../db';
import { HttpError, invalid, notFound } from '../errors';
import { aadClave, cifrar, descifrar, llaveroConfigurado } from '../lib/secretBox';
import { claveCooldown, enfriandoHasta, limpiar } from '../lib/cooldown';
import { PROVEEDORES_IA, proveedorPorId, type ProveedorIA } from '../lib/proveedoresIA';
import { olvidarUso, ordenProveedores, usoDe } from './rotacion';

/** Punto de inyección de `fetch` (las pruebas lo reemplazan; nunca hay red real en ellas). */
export const llaveroDeps = {
  fetch: (url: string, init?: RequestInit): Promise<Response> => globalThis.fetch(url, init),
};

export const ETIQUETA_POR_DEFECTO = 'principal';
export const MAX_CLAVES_POR_PROVEEDOR = 5;

// Único `select` de la tabla hacia afuera: api_key_enc no sale nunca.
export const PUBLICA = {
  id: true, proveedor: true, etiqueta: true, ultimos4: true, modelo: true, habilitada: true, reserva: true, aviso_modelo: true,
  estado: true, estado_detalle: true, probada_at: true, ultimo_uso_at: true,
} as const;

export function exigirConfigurado() {
  if (!llaveroConfigurado()) throw new HttpError(503, 'El llavero no está configurado en el servidor');
}

export function catalogoPublico() {
  return PROVEEDORES_IA.map(({ id, nombre, descripcion, urlParaConseguirKey, modeloPorDefecto }) => ({ id, nombre, descripcion, urlParaConseguirKey, modeloPorDefecto }));
}

export function listar() {
  return prisma.claveIntegracion.findMany({ select: PUBLICA, orderBy: [{ proveedor: 'asc' }, { etiqueta: 'asc' }] });
}

/** Lista para la pantalla: suma el enfriamiento y los contadores (memoria del proceso) y el orden real de proveedores. */
export async function listarConRotacion() {
  const claves = (await listar()).map((c) => {
    const h = enfriandoHasta(claveCooldown(c.proveedor, c.id));
    return { ...c, enfriando_hasta: h === null ? null : new Date(h).toISOString(), uso: usoDe(c.id) };
  });
  return { claves, orden: ordenProveedores(), max_claves_por_proveedor: MAX_CLAVES_POR_PROVEEDOR };
}

export function validarClave(clave: string): string {
  if (clave.length < 8 || clave.length > 400) throw invalid('Datos inválidos: clave: Debe tener entre 8 y 400 caracteres', { clave: 'Debe tener entre 8 y 400 caracteres' });
  if (/\s/.test(clave)) throw invalid('Datos inválidos: clave: No puede contener espacios', { clave: 'No puede contener espacios' });
  return clave;
}

export async function guardar(input: { proveedor: string; etiqueta?: string; clave: string; modelo?: string | null; usuarioId: number }) {
  exigirConfigurado();
  if (!proveedorPorId(input.proveedor)) throw notFound('Proveedor');
  const etiqueta = input.etiqueta ?? ETIQUETA_POR_DEFECTO;
  const clave = validarClave(input.clave);
  const datos = {
    api_key_enc: cifrar(clave, aadClave(input.proveedor, etiqueta)),
    ultimos4: clave.slice(-4),
    modelo: input.modelo || null,
    aviso_modelo: null,
    estado: 'sin_probar',
    estado_detalle: null,
    probada_at: null,
    actualizado_por_id: input.usuarioId,
  };
  const previa = await prisma.claveIntegracion.findUnique({ where: { proveedor_etiqueta: { proveedor: input.proveedor, etiqueta } }, select: { id: true } });
  if (!previa && (await prisma.claveIntegracion.count({ where: { proveedor: input.proveedor } })) >= MAX_CLAVES_POR_PROVEEDOR) {
    throw invalid(`Cada proveedor admite hasta ${MAX_CLAVES_POR_PROVEEDOR} claves. Quita una para agregar otra.`, { etiqueta: `Ya hay ${MAX_CLAVES_POR_PROVEEDOR} claves de este proveedor` });
  }
  const fila = await prisma.claveIntegracion.upsert({
    where: { proveedor_etiqueta: { proveedor: input.proveedor, etiqueta } },
    create: { proveedor: input.proveedor, etiqueta, ...datos },
    update: datos,
    select: PUBLICA,
  });
  // Clave reemplazada: puede ser de otra cuenta, así que su catálogo de modelos se descarta (el sync lo vuelve a armar).
  if (previa) await prisma.modeloIA.deleteMany({ where: { clave_id: fila.id } });
  // Clave nueva o reemplazada: parte de cero (sin enfriamiento ni contadores; el estado ya vuelve a sin_probar).
  limpiar(claveCooldown(fila.proveedor, fila.id));
  olvidarUso(fila.id);
  return { fila, creada: !previa };
}

export async function obtenerPublica(id: number) {
  const f = await prisma.claveIntegracion.findUnique({ where: { id }, select: PUBLICA });
  if (!f) throw notFound('Clave');
  return f;
}

export interface Ajuste { habilitada?: boolean; reserva?: boolean; /** `null` = elección automática. */ modelo?: string | null }

/** Pausa/habilita, marca como reserva o fija el modelo de la clave. Un modelo fijado debe estar activo en el catálogo de ESA clave (si ya hay catálogo). */
export async function ajustar(id: number, a: Ajuste, usuarioId: number) {
  await obtenerPublica(id);
  const data: { habilitada?: boolean; reserva?: boolean; modelo?: string | null; aviso_modelo?: null; actualizado_por_id: number } = { actualizado_por_id: usuarioId };
  if (a.habilitada !== undefined) data.habilitada = a.habilitada;
  if (a.reserva !== undefined) data.reserva = a.reserva;
  if (a.modelo !== undefined) {
    if (a.modelo !== null) {
      const hayCatalogo = (await prisma.modeloIA.count({ where: { clave_id: id } })) > 0;
      const vigente = await prisma.modeloIA.findFirst({ where: { clave_id: id, modelo_id: a.modelo, estado: { not: 'deprecado' }, categoria: { not: 'otro' } }, select: { id: true } });
      if (hayCatalogo && !vigente) throw invalid('Datos inválidos: modelo: Ese modelo no está disponible para esta clave', { modelo: 'Ese modelo no está disponible para esta clave' });
    }
    data.modelo = a.modelo;
    data.aviso_modelo = null; // la persona ya eligió: el aviso de «ya no existe» deja de aplicar
  }
  return prisma.claveIntegracion.update({ where: { id }, data, select: PUBLICA });
}

export async function borrar(id: number) {
  const f = await obtenerPublica(id);
  await prisma.claveIntegracion.delete({ where: { id } });
  limpiar(claveCooldown(f.proveedor, f.id));
  olvidarUso(f.id);
  return f;
}

/** Cabeceras de autenticación según el tipo de proveedor. */
export function cabecerasDe(p: ProveedorIA, clave: string): Record<string, string> {
  return p.tipo === 'gemini' ? { 'x-goog-api-key': clave } : { Authorization: `Bearer ${clave}` };
}

export function detalleDeEstadoHttp(status: number): string {
  if (status === 400 || status === 401 || status === 403) return 'La clave fue rechazada o no es válida'; // Gemini responde 400 ante una clave inválida
  if (status === 429) return 'Límite del proveedor';
  if (status === 402) return 'La cuenta del proveedor no tiene saldo';
  if (status >= 300 && status < 400) return 'El proveedor respondió con una redirección';
  if (status >= 500) return 'El proveedor tuvo un problema, intenta más tarde';
  return `El proveedor respondió HTTP ${status}`;
}

export interface ClaveParaUso { proveedor: ProveedorIA; clave: string; modelo: string }

/** Clave descifrada de un proveedor para usarla; null si no hay o está pausada. Marca `ultimo_uso_at`. */
export async function obtenerClaveParaUso(proveedor: string): Promise<ClaveParaUso | null> {
  const p = proveedorPorId(proveedor);
  if (!p || !llaveroConfigurado()) return null;
  const f = await prisma.claveIntegracion.findFirst({ where: { proveedor, habilitada: true }, orderBy: { updated_at: 'desc' } });
  if (!f) return null;
  let clave: string;
  try {
    clave = descifrar(f.api_key_enc, aadClave(f.proveedor, f.etiqueta));
  } catch {
    console.error(`[llavero] no se pudo descifrar la clave de ${proveedor}`);
    return null;
  }
  await prisma.claveIntegracion.update({ where: { id: f.id }, data: { ultimo_uso_at: new Date() }, select: { id: true } });
  return { proveedor: p, clave, modelo: f.modelo || p.modeloPorDefecto };
}
