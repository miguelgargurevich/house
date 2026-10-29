import { celularE164, parsearTelefono } from '../../../lib/telefono';

/**
 * Celulares de cualquier país (WhatsApp). Devuelve E.164 sin «+» (`51987654321`), que es como se guardan los vínculos y como el bot
 * responde. Sin prefijo se asume Perú (`987 654 321`); con 10 dígitos o más, sin «+», es un número que ya trae su código de país
 * (`56961234567`). Los fijos no sirven para WhatsApp. `null` si no es válido.
 */
export function normalizarCelular(entrada: string | null | undefined): string | null {
  let d = (entrada ?? '').replace(/[\s\-().]/g, '');
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  if (/^\d{10,}$/.test(d)) d = `+${d}`;
  return celularE164(d);
}

/** `51987654321` → `+51 987 654 321` (para mostrar y guardar en el perfil); cualquier país con su formato. */
export function formatearCelular(normalizado: string): string {
  return parsearTelefono(`+${normalizado}`)?.formatInternational() ?? `+${normalizado}`;
}
