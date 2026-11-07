// Campos de los formularios públicos (sin sesión): contacto y Libro de Reclamaciones. Lo que llega de un anónimo es texto plano:
// sin etiquetas HTML, sin caracteres de control y con tope de tamaño. Todo lo demás (escapado al armar un correo) es una segunda barrera.
import { z } from 'zod';

/** Una etiqueta o comentario HTML: `<` seguido de letra, `/`, `!` o `?`. Un «<» suelto (p. ej. «menos de 5 < 10») no cuenta. */
const ETIQUETA = /<\s*[/a-z!?]/i;
// Caracteres de control salvo salto de línea y tabulación.
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]');

export const MENSAJE_HTML = 'No uses etiquetas HTML ni código en este campo';

const base = (max: number, min: number) =>
  z.string({ error: 'Debe ser un texto' }).trim()
    .min(min, 'Es obligatorio').max(max, `Máximo ${max} caracteres`)
    .refine((v) => !ETIQUETA.test(v), MENSAJE_HTML)
    .refine((v) => !CONTROL.test(v), 'Hay caracteres no permitidos');

/** Texto de una sola línea (nombre, domicilio…). */
export const textoLinea = (max = 120, min = 1) => base(max, min).refine((v) => !/[\r\n]/.test(v), 'Escríbelo en una sola línea');
/** Texto de varias líneas (mensaje, detalle). Los saltos de línea se normalizan a `\n`. */
export const textoLargo = (max = 2000, min = 1) => z.preprocess((v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n') : v), base(max, min));
/** Una línea opcional: vacío o sólo espacios = null. */
export const textoLineaOpcional = (max = 120) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), textoLinea(max).nullish());

/** Señuelo antiabuso: un campo que ninguna persona ve ni llena. Si llega con algo, es un robot. */
export const llenoElSenuelo = (body: unknown): boolean => {
  const v = (body as { sitio_web?: unknown } | null | undefined)?.sitio_web;
  return typeof v === 'string' && v.trim() !== '';
};
