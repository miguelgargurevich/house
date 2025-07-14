export function formatDate(date: string | Date, options?: Intl.DateTimeFormatOptions, locale: string = 'es-ES'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(locale, options || { year: 'numeric', month: 'short', day: 'numeric' });
}
