// El residente paga su mantenimiento como lo hace la pantalla: UN solo pedido `multipart/form-data` con los campos de texto y el voucher en `voucher`.
import { cabecerasDeSesion, llamar, prisma } from './app';

export interface ArchivoVoucher { bytes: Buffer; tipo: string; nombre: string }

let n = 0;
/** Un PNG mínimo y distinto en cada llamada (el sha256 no se repite entre pagos: el repetido no valida solo). */
export const pngUnico = (): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`voucher-residente-${Date.now()}-${++n}`)]);
export const voucherPng = (extra: Partial<ArchivoVoucher> = {}): ArchivoVoucher => ({ bytes: pngUnico(), tipo: 'image/png', nombre: 'voucher.png', ...extra });

export interface RespuestaPago {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  texto: string;
}

/** `archivo`: por defecto un PNG válido; `null` manda el formulario sin archivo. */
export async function pagarComoResidente(
  base: string,
  token: string,
  reciboId: number,
  unidadId: number,
  campos: Record<string, string> = { metodo_pago: 'yape', referencia: 'OP123456' },
  archivo: ArchivoVoucher | null = voucherPng(),
): Promise<RespuestaPago> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  if (archivo) fd.append('voucher', new Blob([new Uint8Array(archivo.bytes)], { type: archivo.tipo }), archivo.nombre);
  const r = await fetch(`${base}/api/me/mantenimientos/${reciboId}/${unidadId}/pagos`, { method: 'POST', headers: cabecerasDeSesion(token), body: fd });
  const texto = await r.text();
  let body: unknown = null;
  try { body = JSON.parse(texto); } catch { /* sin JSON */ }
  return { status: r.status, body, texto };
}

/**
 * El pago suelto de UN cargo (`POST /api/me/cargos/:id/pagos`): igual que el del mantenimiento, multipart con el voucher obligatorio.
 * Es el atajo de las pruebas para tener un pago `por_validar` con su voucher; `archivo: null` lo manda sin archivo.
 */
export async function pagarCargo(
  base: string,
  token: string | null,
  cargoId: number,
  campos: Record<string, string | number> = { metodo_pago: 'yape', referencia: 'OP123456' },
  archivo: ArchivoVoucher | null = voucherPng(),
): Promise<RespuestaPago & { headers: Headers }> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, String(v));
  if (archivo) fd.append('voucher', new Blob([new Uint8Array(archivo.bytes)], { type: archivo.tipo }), archivo.nombre);
  const r = await fetch(`${base}/api/me/cargos/${cargoId}/pagos`, { method: 'POST', headers: cabecerasDeSesion(token), body: fd });
  const texto = await r.text();
  let body: unknown = null;
  try { body = JSON.parse(texto); } catch { /* sin JSON */ }
  return { status: r.status, body, texto, headers: r.headers };
}

/**
 * Un pago suelto `por_validar` SIN voucher, como el que dejó el endpoint antiguo (hoy el voucher es obligatorio y ese pago ya no se puede crear por la API,
 * pero siguen existiendo pagos así en la base). Lo crean las pruebas que parten de «pago sin comprobante» (subirlo después, validarlo → 409, la IA al subir).
 * `token` es el del residente que paga: de ahí sale su id. Devuelve la misma forma que la API (`status` y `body.id`).
 */
export async function pagoSinVoucher(
  base: string,
  token: string,
  cargoId: number,
  campos: { metodo_pago: string; referencia?: string; observaciones?: string } = { metodo_pago: 'yape' },
): Promise<{ status: number; body: { id: number }; texto: string }> {
  const yo = await llamar(base, 'GET', '/api/auth/me', token);
  const usuarioId = yo.body.id as number;
  const pago = await prisma.$transaction(async (tx) => {
    const cargo = await tx.reciboConceptoUnidad.findUniqueOrThrow({ where: { id: cargoId } });
    await tx.reciboConceptoUnidad.update({ where: { id: cargoId }, data: { estado_pago: 'en_revision', fecha_pago: null } });
    return tx.pago.create({ data: { recibo_concepto_unidad_id: cargoId, monto: cargo.monto, usuario_id: usuarioId, estado_validacion: 'por_validar', ...campos } });
  });
  return { status: 201, body: { id: pago.id }, texto: '' };
}
