/** Marca de una empresa tal como la ve quien la usa (la app, el recibo). `activa` = la empresa tiene la capacidad `marca_propia` (planes Torre Pro y Torre Administradora). */
export interface MarcaEmpresa {
  /** La empresa de esta marca (`null` = Torre). Sirve para saber si la marca del usuario corresponde a la empresa de un documento (recibo, estado de cuenta). */
  empresa_id: number | null;
  /** Razón social, siempre (el `nombre` puede ser el comercial). */
  razon_social: string | null;
  /** Nombre comercial si la marca está activa y lo tiene; si no, la razón social. */
  nombre: string;
  /** Logo de la empresa (todos los planes): ruta de la API con `?v=` para no mostrar uno viejo. `null` si no subió ninguno. */
  logo_url: string | null;
  /** `#RRGGBB` sólo con la marca activa; `null` = verde de Torre. */
  color: string | null;
  activa: boolean;
}

/** Lo que necesita el marco de un correo con marca (sólo si la marca está activa). Los colores son hex: un correo no entiende oklch. */
export interface MarcaCorreo {
  nombre: string;
  /** URL absoluta y pública del logo (firmada, con versión); `null` si no hay logo. */
  logoUrl: string | null;
  /** Colores de la marca; `null` si la empresa activó la marca pero no eligió color (el correo queda con el verde de Torre y su nombre y logo). */
  claro: ColoresCorreo | null;
  oscuro: ColoresCorreo | null;
}
export interface ColoresCorreo { brand: string; onBrand: string; brandSoft: string }

/** La marca de la plataforma: la ve quien no pertenece a ninguna empresa (superadmin) y sirve de respaldo. */
export const MARCA_TORRE: MarcaEmpresa = { empresa_id: null, razon_social: null, nombre: 'Torre', logo_url: null, color: null, activa: false };
