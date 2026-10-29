// El residente paga su mantenimiento como lo hace la pantalla: UN solo pedido `multipart/form-data` con los campos de texto y el voucher en `voucher`.
import { cabecerasDeSesion } from './app';

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
