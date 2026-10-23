const pen = new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' });
const fecha = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
const mesAnio = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' });

export function soles(v: number | string | null | undefined): string {
  const n = typeof v === 'string' ? Number(v) : v ?? 0;
  return pen.format(Number.isFinite(n) ? n : 0);
}

export function fechaCorta(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? '—' : fecha.format(d);
}

export function periodo(mes: number, anio: number): string {
  const s = mesAnio.format(new Date(anio, mes - 1, 1));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function iniciales(nombre: string): string {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('');
}
