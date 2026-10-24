/**
 * Celulares peruanos: 9 dígitos que empiezan con 9. Se acepta con o sin prefijo de país
 * (`+51`, `51`, `0051`), con espacios, guiones o paréntesis. Los fijos no sirven para WhatsApp.
 */
export function normalizarCelular(entrada: string | null | undefined): string | null {
  if (!entrada) return null;
  let d = entrada.replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(d)) return null;
  d = d.replace(/^\+/, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('51')) d = d.slice(2);
  return /^9\d{8}$/.test(d) ? `51${d}` : null;
}

/** `51987654321` → `+51 987 654 321` (para mostrar y guardar en el perfil). */
export function formatearCelular(normalizado: string): string {
  const n = normalizado.slice(2);
  return `+51 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
}
