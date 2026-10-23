const LIMA_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Fecha (00:00 UTC) del día de hoy en Lima. Un cargo está vencido si su vencimiento es anterior a esta fecha. */
export function hoyLima(ahora: Date = new Date()): Date {
  const lima = new Date(ahora.getTime() - LIMA_OFFSET_MS);
  return new Date(Date.UTC(lima.getUTCFullYear(), lima.getUTCMonth(), lima.getUTCDate()));
}

export function inicioMesLima(ahora: Date = new Date()): Date {
  const h = hoyLima(ahora);
  return new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), 1) + LIMA_OFFSET_MS);
}

export function inicioAnioLima(ahora: Date = new Date()): Date {
  const h = hoyLima(ahora);
  return new Date(Date.UTC(h.getUTCFullYear(), 0, 1) + LIMA_OFFSET_MS);
}

export function mesesAtras(n: number, ahora: Date = new Date()): { clave: string; anio: number; mes: number; desde: Date; hasta: Date }[] {
  const h = hoyLima(ahora);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth() - i, 1));
    const anio = d.getUTCFullYear();
    const mes = d.getUTCMonth() + 1;
    out.push({
      clave: `${anio}-${String(mes).padStart(2, '0')}`,
      anio,
      mes,
      desde: new Date(d.getTime() + LIMA_OFFSET_MS),
      hasta: new Date(Date.UTC(anio, mes, 1) + LIMA_OFFSET_MS),
    });
  }
  return out;
}

export function diasEntre(desde: Date, hasta: Date): number {
  return Math.floor((hasta.getTime() - desde.getTime()) / 86_400_000);
}
