// Lógica pura de «Anular recibo» y «Corregir cargos» (sin React: se prueba en Node, como `cobranza/morosos.ts`).

/** Lo que devuelve `GET /api/recibos/:id/anulacion`: qué haría «Anular recibo» y si se puede. */
export interface ResumenAnulacion {
  recibo_id: number;
  mes: number;
  anio: number;
  periodo: string;
  torre: string | null;
  moneda: string;
  departamentos: number;
  cargos: number;
  total: string;
  cargos_con_pagos: number;
  pagos_rechazados: number;
  lecturas_agua: number;
  puede: boolean;
  bloqueo: string | null;
}

export const MOTIVO_MIN = 5;
/** El motivo de «Anular recibo» admite hasta 200 caracteres; el de corregir o quitar un cargo, hasta 300 (los límites del servidor). */
export const MOTIVO_ANULAR_MAX = 200;
export const MOTIVO_CORREGIR_MAX = 300;

export function errorMotivo(motivo: string, max: number): string | undefined {
  const t = motivo.trim();
  if (t.length < MOTIVO_MIN) return `Escribe un motivo de al menos ${MOTIVO_MIN} caracteres.`;
  if (t.length > max) return `El motivo admite hasta ${max} caracteres.`;
  return undefined;
}

/** «Se quitan los cargos de 32 departamentos y podrás emitir octubre de 2026 de nuevo.» */
export function efectoAnulacion(r: Pick<ResumenAnulacion, 'departamentos' | 'periodo' | 'torre'>): string {
  const deptos = `${r.departamentos} ${r.departamentos === 1 ? 'departamento' : 'departamentos'}`;
  return `Se quitan los cargos de ${deptos} y podrás emitir ${r.periodo}${r.torre ? ` de ${r.torre}` : ''} de nuevo.`;
}

/** Lo que además se lleva la anulación y conviene decir en el modal (rechazados y lecturas de agua); vacío si no se lleva nada más. */
export function tambienSeLleva(r: Pick<ResumenAnulacion, 'pagos_rechazados' | 'lecturas_agua'>): string[] {
  const lineas: string[] = [];
  if (r.pagos_rechazados > 0) lineas.push(`${r.pagos_rechazados} ${r.pagos_rechazados === 1 ? 'pago rechazado' : 'pagos rechazados'} (quedan en la auditoría)`);
  if (r.lecturas_agua > 0) lineas.push(`${r.lecturas_agua} ${r.lecturas_agua === 1 ? 'lectura de agua' : 'lecturas de agua'}, con su foto: tendrás que volver a cargarlas`);
  return lineas;
}

/** Por qué el botón «Anular recibo» está apagado (para decirlo junto al botón); `null` si se puede. */
export function motivoNoSePuedeAnular(r: Pick<ResumenAnulacion, 'puede' | 'bloqueo' | 'cargos_con_pagos'> | null | undefined): string | null {
  if (!r || r.puede) return null;
  return r.bloqueo ?? 'Este recibo tiene pagos: anúlalos o recházalos antes';
}

/** Un cargo de un departamento tal como lo trae el detalle del mantenimiento. */
export interface CargoCorregible { cargo_id: number; concepto: string; monto: string; cobrado: string; en_revision: string }

/** Lo ya pagado que sigue vigente (validado + por validar): por debajo de eso el monto no puede bajar. */
export const pagadoVigente = (c: Pick<CargoCorregible, 'cobrado' | 'en_revision'>): number => Number(c.cobrado) + Number(c.en_revision);

/** Un cargo se puede quitar sólo si nadie lo ha pagado ni tiene un pago en revisión. */
export const sePuedeQuitar = (c: Pick<CargoCorregible, 'cobrado' | 'en_revision'>): boolean => pagadoVigente(c) === 0;

export type Cambio = { cargo_id: number; concepto: string; accion: 'corregir'; monto: string } | { cargo_id: number; concepto: string; accion: 'quitar' };

/** Normaliza lo que se escribe en el campo (admite coma decimal); `null` si no es un monto de hasta 2 decimales. */
export function montoEscrito(texto: string): string | null {
  const t = texto.trim().replace(',', '.');
  return /^\d{1,10}(\.\d{1,2})?$/.test(t) ? t : null;
}

/** Error del campo de monto de un cargo: vacío/inválido, cero (para eso está «Quitar»), o por debajo de lo ya pagado. */
export function errorMonto(texto: string, c: CargoCorregible, formato: (n: number) => string): string | undefined {
  const m = montoEscrito(texto);
  if (m == null) return 'Escribe un monto válido, con hasta 2 decimales.';
  if (Number(m) <= 0) return 'El monto debe ser mayor que cero. Para quitar el cargo usa «Quitar este cargo».';
  const pagado = pagadoVigente(c);
  if (Number(m) < pagado) return `No puede ser menor a lo ya pagado (${formato(pagado)}).`;
  return undefined;
}

/**
 * Los cambios que hay que mandar: un cargo marcado «quitar» va como quitar; uno con monto distinto del actual va como corregir; el resto no se manda.
 * `montos` son los textos de los campos por `cargo_id`; `quitar` el conjunto marcado.
 */
export function cambiosDe(cargos: CargoCorregible[], montos: Record<number, string>, quitar: ReadonlySet<number>): Cambio[] {
  const cambios: Cambio[] = [];
  for (const c of cargos) {
    if (quitar.has(c.cargo_id)) { cambios.push({ cargo_id: c.cargo_id, concepto: c.concepto, accion: 'quitar' }); continue; }
    const m = montoEscrito(montos[c.cargo_id] ?? c.monto);
    if (m != null && Number(m) !== Number(c.monto)) cambios.push({ cargo_id: c.cargo_id, concepto: c.concepto, accion: 'corregir', monto: m });
  }
  return cambios;
}
