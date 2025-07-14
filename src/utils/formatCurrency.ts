export function formatCurrency(value: number, currency: string = 'EUR', locale: string = 'es-ES'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
}
