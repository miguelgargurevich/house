// «Tu marca»: lógica pura del formulario (el repo no monta React en Node: se prueba aquí y el cableado se fija leyendo la fuente).
import { VERDE_TORRE_HEX, esHexColor, paletaDeMarca, type PaletaDeMarca } from '../../../../lib/marca';

export const MAX_NOMBRE_COMERCIAL = 60;

export interface FormMarca {
  /** Lo que se escribió; vacío = la razón social. */
  nombre: string;
  /** Lo que se escribió en el campo de color (con o sin «#»); vacío = verde de Torre. */
  color: string;
}

/** `#RRGGBB` en minúsculas a partir de lo escrito (`007565`, `#0A5`, `#007565`); `null` si no es un color. */
export function normalizarHex(entrada: string): string | null {
  const t = entrada.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(t)) return `#${[...t].map(c => c + c).join('')}`.toLowerCase();
  return /^[0-9a-fA-F]{6}$/.test(t) ? `#${t}`.toLowerCase() : null;
}

/** Mensaje para el campo de color; `null` si está bien (vacío es válido: verde de Torre). */
export const errorDeColor = (texto: string): string | null => (texto.trim() === '' || normalizarHex(texto) ? null : 'Escribe un color como #007565 (6 dígitos con letras de la A a la F)');

/** Color que muestra el selector nativo: el escrito si es válido; si no, el verde de Torre. */
export const colorDelSelector = (texto: string): string => normalizarHex(texto) ?? VERDE_TORRE_HEX;

/** Paleta del color escrito; con el campo vacío o inválido, la del verde de Torre. */
export function paletaDeForm(texto: string): PaletaDeMarca {
  const hex = normalizarHex(texto);
  return paletaDeMarca(hex && esHexColor(hex) ? hex : VERDE_TORRE_HEX);
}

/** El verde de Torre se guarda como «sin color» (`null`): así la marca de la empresa cambia sola si Torre cambia su verde. */
export function colorParaGuardar(texto: string): string | null {
  const hex = normalizarHex(texto);
  return hex === null || hex === VERDE_TORRE_HEX ? null : hex;
}

export const formDeEmpresa = (e: { nombre_comercial?: string | null; color_marca?: string | null }): FormMarca => ({ nombre: e.nombre_comercial ?? '', color: e.color_marca ?? '' });

/** Cuerpo del `PUT /api/empresas/:id`. */
export const cuerpoDeMarca = (f: FormMarca) => ({ nombre_comercial: f.nombre.trim() || null, color_marca: colorParaGuardar(f.color) });

export function hayCambios(f: FormMarca, e: { nombre_comercial?: string | null; color_marca?: string | null }): boolean {
  const nuevo = cuerpoDeMarca(f);
  return nuevo.nombre_comercial !== (e.nombre_comercial?.trim() || null) || nuevo.color_marca !== (e.color_marca && e.color_marca !== VERDE_TORRE_HEX ? e.color_marca.toLowerCase() : null);
}

export const AVISO_AJUSTADO = 'Lo oscurecimos un poco para que el texto se lea.';
export const AVISO_SIN_PLAN = 'Disponible desde el plan Torre Pro.';
