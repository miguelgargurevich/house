import { celularE164, parsearTelefono } from '../../../../lib/telefono';

/** Un proveedor como lo ve el vecino (`GET /api/me/proveedores`): sólo la ficha de contacto, sin notas, RUC ni ids. */
export interface ProveedorVecino { razon_social: string; contacto_nombre: string | null; telefono: string | null; email: string | null }
export interface GrupoProveedores { rubro: string; proveedores: ProveedorVecino[] }

/** `tel:+51987654321` para llamar; `null` si el teléfono no es un número válido (no se arma un enlace con basura). */
export function enlaceLlamar(telefono: string | null | undefined): string | null {
  const p = parsearTelefono(telefono);
  return p ? `tel:${p.number}` : null;
}

/** `https://wa.me/51987654321`: sólo con un celular válido (peruano o de otro país, con su código); un fijo no tiene WhatsApp. */
export function enlaceWhatsApp(telefono: string | null | undefined): string | null {
  const n = celularE164(telefono);
  return n ? `https://wa.me/${n}` : null;
}

/** El correo lo cargó la administración o la junta, pero igual se codifica: nada se pega crudo en el `href`. */
export const enlaceEscribir = (email: string | null | undefined): string | null => (email ? `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}` : null);
