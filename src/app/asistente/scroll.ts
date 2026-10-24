/** ¿El usuario está al final de la conversación (a `margen` px)? Sólo entonces el texto nuevo lo arrastra: no se pelea con quien subió a leer. */
export function estaAlFinal(el: { scrollTop: number; clientHeight: number; scrollHeight: number }, margen = 48): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= margen;
}
