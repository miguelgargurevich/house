/**
 * Nombres de mes del servidor: UNA sola lista para todo lo que sale en texto (descripción del recibo, título del mantenimiento, avisos,
 * herramientas del asistente). En el Perú se dice «setiembre». El lector del Excel (`excelRecibos.ts`) acepta además «septiembre».
 * El frontend tiene su par en `src/ui/format.ts` (`periodo()`): si cambias una lista, cambia la otra.
 */
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'] as const;

/** «octubre» (minúsculas); un mes fuera de 1–12 sale como número. */
export const nombreMes = (mes: number): string => MESES[mes - 1] ?? String(mes);

/** «octubre de 2026». */
export const periodoTexto = (mes: number, anio: number): string => `${nombreMes(mes)} de ${anio}`;

/** «Mantenimiento de octubre de 2026» o, con torre, «Mantenimiento de octubre de 2026 · Block 1». */
export const descripcionRecibo = (mes: number, anio: number, torre?: string | null): string => `Mantenimiento de ${periodoTexto(mes, anio)}${torre ? ` · ${torre}` : ''}`;
