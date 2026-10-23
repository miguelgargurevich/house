const fechaHoraFmt = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Fecha y hora local, p. ej. «23 oct 2026, 09:41 a. m.». */
export function fechaHora(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? '—' : fechaHoraFmt.format(d);
}
