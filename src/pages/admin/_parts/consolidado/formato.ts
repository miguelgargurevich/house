/** «Block 1» → «B.1», como la primera columna del Excel; un nombre sin número se deja igual. */
export function blockCorto(nombre: string | null): string {
  const n = nombre?.match(/(\d{1,3})\s*$/)?.[1];
  return nombre ? (n ? `B.${Number(n)}` : nombre) : '';
}
