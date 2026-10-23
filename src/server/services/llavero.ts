import { prisma } from '../db';
import { HttpError, invalid, notFound } from '../errors';
import { aadClave, cifrar, descifrar, llaveroConfigurado } from '../lib/secretBox';
import { PROVEEDORES_IA, proveedorPorId, type ProveedorIA } from '../lib/proveedoresIA';

/** Punto de inyección de `fetch` (las pruebas lo reemplazan; nunca hay red real en ellas). */
export const llaveroDeps = {
  fetch: (url: string, init?: RequestInit): Promise<Response> => globalThis.fetch(url, init),
};

export const TOPE_PRUEBA_MS = 10_000;
export const ETIQUETA_POR_DEFECTO = 'principal';

// Único `select` de la tabla hacia afuera: api_key_enc no sale nunca.
const PUBLICA = {
  id: true, proveedor: true, etiqueta: true, ultimos4: true, modelo: true, habilitada: true,
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
    estado: 'sin_probar',
    estado_detalle: null,
    probada_at: null,
    actualizado_por_id: input.usuarioId,
  };
  const previa = await prisma.claveIntegracion.findUnique({ where: { proveedor_etiqueta: { proveedor: input.proveedor, etiqueta } }, select: { id: true } });
  const fila = await prisma.claveIntegracion.upsert({
    where: { proveedor_etiqueta: { proveedor: input.proveedor, etiqueta } },
    create: { proveedor: input.proveedor, etiqueta, ...datos },
    update: datos,
    select: PUBLICA,
  });
  return { fila, creada: !previa };
}

export async function obtenerPublica(id: number) {
  const f = await prisma.claveIntegracion.findUnique({ where: { id }, select: PUBLICA });
  if (!f) throw notFound('Clave');
  return f;
}

export async function pausar(id: number, habilitada: boolean, usuarioId: number) {
  await obtenerPublica(id);
  return prisma.claveIntegracion.update({ where: { id }, data: { habilitada, actualizado_por_id: usuarioId }, select: PUBLICA });
}

export async function borrar(id: number) {
  const f = await obtenerPublica(id);
  await prisma.claveIntegracion.delete({ where: { id } });
  return f;
}

/** Cabeceras de autenticación según el tipo de proveedor. */
export function cabecerasDe(p: ProveedorIA, clave: string): Record<string, string> {
  return p.tipo === 'gemini' ? { 'x-goog-api-key': clave } : { Authorization: `Bearer ${clave}` };
}

export function detalleDeEstadoHttp(status: number): string {
  if (status === 401 || status === 403) return 'La clave fue rechazada';
  if (status === 429) return 'Límite del proveedor';
  if (status === 402) return 'La cuenta del proveedor no tiene saldo';
  if (status >= 300 && status < 400) return 'El proveedor respondió con una redirección';
  if (status >= 500) return 'El proveedor tuvo un problema, intenta más tarde';
  return `El proveedor respondió HTTP ${status}`;
}

/** Llama a `GET /models` del proveedor (URL fija, sin seguir redirecciones) y guarda el resultado. */
export async function probar(id: number) {
  exigirConfigurado();
  const f = await prisma.claveIntegracion.findUnique({ where: { id } });
  if (!f) throw notFound('Clave');
  const p = proveedorPorId(f.proveedor);
  if (!p) throw notFound('Proveedor');

  let estado: 'ok' | 'error';
  let detalle: string | null;
  try {
    const clave = descifrar(f.api_key_enc, aadClave(f.proveedor, f.etiqueta));
    const r = await llaveroDeps.fetch(`${p.baseUrl}/models`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...cabecerasDe(p, clave) },
      redirect: 'manual',
      signal: AbortSignal.timeout(TOPE_PRUEBA_MS),
    });
    // Se descarta el cuerpo: nunca se guarda ni se devuelve lo que diga el proveedor.
    await r.body?.cancel().catch(() => undefined);
    if (r.ok) { estado = 'ok'; detalle = null; } else { estado = 'error'; detalle = detalleDeEstadoHttp(r.status); }
  } catch (err) {
    estado = 'error';
    const nombre = err instanceof Error ? err.name : '';
    detalle = nombre === 'TimeoutError' || nombre === 'AbortError' ? 'El proveedor no respondió a tiempo' : 'No se pudo conectar con el proveedor';
    console.error(`[llavero] la prueba de ${f.proveedor} falló (${nombre || 'error'})`);
  }
  return prisma.claveIntegracion.update({ where: { id }, data: { estado, estado_detalle: detalle, probada_at: new Date() }, select: PUBLICA });
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

/** Primer proveedor con clave habilitada, por prioridad del catálogo. */
export async function resolverParaUso(): Promise<ClaveParaUso | null> {
  const orden = [...PROVEEDORES_IA].sort((a, b) => a.prioridad - b.prioridad);
  for (const p of orden) {
    const r = await obtenerClaveParaUso(p.id);
    if (r) return r;
  }
  return null;
}
