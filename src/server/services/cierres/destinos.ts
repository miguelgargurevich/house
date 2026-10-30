// Destino de cada concepto del recibo al cerrar el mes: adónde va lo que se cobra con él. Sin destino (null) el concepto no entra al cierre.

export const DESTINOS = ['administradora', 'central', 'servicio', 'proveedor', 'ahorro_block'] as const;
export type Destino = (typeof DESTINOS)[number];

export const DESTINO_ETIQUETA: Record<Destino, string> = {
  administradora: 'Empresa administradora',
  central: 'Junta central',
  servicio: 'Pago de servicios (agua, luz)',
  proveedor: 'Proveedor contratado',
  ahorro_block: 'Fondo de ahorros del block',
};

export const DESTINO_AYUDA: Record<Destino, string> = {
  administradora: 'El tesorero paga lo facturado, de la cuenta del block a la cuenta de la empresa administradora. La administración da la conformidad.',
  central: 'El tesorero transfiere lo facturado a la cuenta de la Junta central. El tesorero central da la conformidad.',
  servicio: 'El tesorero paga la boleta del servicio (por el monto de la boleta, con su voucher).',
  proveedor: 'El tesorero paga la factura del proveedor (ascensor, cisterna…) a su cuenta, con su voucher.',
  ahorro_block: 'No se paga a nadie: lo cobrado va al Fondo de ahorros del block (multas, fondo de contingencia del block).',
};

export const esDestino = (v: unknown): v is Destino => typeof v === 'string' && (DESTINOS as readonly string[]).includes(v);

/** Destinos que son un aporte a la Junta central (llevan la conformidad del tesorero central). */
export const esCentral = (d: string | null | undefined): boolean => d === 'central';
/** Destinos que llevan «conformidad» (la confirmación de que el pago llegó a la cuenta). */
export const llevaConformidad = (d: string | null | undefined): boolean => d === 'central' || d === 'administradora';

const plano = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Sugerencia por el NOMBRE del concepto, para que la administración clasifique rápido la primera vez. Sólo sugiere: nunca se guarda sola
 * y siempre se puede cambiar. `null` = no hay una regla clara (se clasifica a mano).
 */
export function sugerirDestino(nombre: string): Destino | null {
  const n = plano(nombre);
  if (/^administracion\b/.test(n)) return 'administradora';
  if (/\b(multa|mora)\b|fuera de fecha/.test(n)) return 'ahorro_block';
  if (/\b(fondo|contingencia)\b/.test(n) && /\bblock\b/.test(n)) return 'ahorro_block';
  if (/\bcondominio\b/.test(n)) return 'central';
  if (/\bareas? comunes?\b/.test(n) && !/\bblock\b/.test(n)) return 'central';
  if (/\b(agua|luz)\b/.test(n)) return 'servicio';
  if (/^mantenimiento de\b/.test(n)) return 'proveedor';
  return null;
}

// ---------- Líneas del cierre ----------
export const LINEA_ADMINISTRADORA = 'administradora';
export const LINEA_CENTRAL = 'central';
export const LINEA_NOMBRE: Record<string, string> = {
  [LINEA_ADMINISTRADORA]: 'Pago a la empresa administradora',
  [LINEA_CENTRAL]: 'Aporte a la Junta central',
};

/** Clave de la línea de un concepto: administración y Junta central juntan sus conceptos en una línea; servicios y proveedores van uno por concepto. */
export function lineaDe(destino: Destino, conceptoId: number): string | null {
  if (destino === 'administradora') return LINEA_ADMINISTRADORA;
  if (destino === 'central') return LINEA_CENTRAL;
  if (destino === 'servicio' || destino === 'proveedor') return `concepto:${conceptoId}`;
  return null; // ahorro_block: no se paga
}

export const lineaSchemaRegex = /^(administradora|central|concepto:[1-9]\d{0,9})$/;
