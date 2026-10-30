// Qué se dice y cuándo se ofrece cada acción en el cierre del mes: lógica pura (se prueba en tests/cierres-ui.test.ts), sin React.
import { MESES } from '../../../../ui/format';
import type { Tone } from '../../../../ui/Badge';
import type { CuentaDestino, Destino, EstadoCierre, LineaCierre, RegistroLinea } from './tipos';

export const ESTADO_CIERRE: Record<EstadoCierre, { tone: Tone; label: string }> = {
  sin_recibo: { tone: 'neutral', label: 'Sin recibo' },
  pendiente: { tone: 'warn', label: 'Pagos pendientes' },
  por_clasificar: { tone: 'warn', label: 'Conceptos por clasificar' },
  sin_conformidad: { tone: 'info', label: 'Falta conformidad' },
  cerrado: { tone: 'ok', label: 'Cerrado' },
};

export const DESTINOS: { value: Destino; label: string; ayuda: string }[] = [
  { value: 'administradora', label: 'Empresa administradora', ayuda: 'El tesorero paga lo facturado a la cuenta de la empresa administradora. La administración da la conformidad.' },
  { value: 'central', label: 'Junta central', ayuda: 'El tesorero transfiere lo facturado a la cuenta de la Junta central. El tesorero central da la conformidad.' },
  { value: 'servicio', label: 'Pago de servicios (agua, luz)', ayuda: 'El tesorero paga la boleta del servicio, por el monto de la boleta.' },
  { value: 'proveedor', label: 'Proveedor contratado', ayuda: 'El tesorero paga la factura del proveedor (ascensor, cisterna…) a su cuenta.' },
  { value: 'ahorro_block', label: 'Fondo de ahorros del block', ayuda: 'No se paga a nadie: lo cobrado va al Fondo de ahorros del block (multas, fondo de contingencia del block).' },
];

export const etiquetaDestino = (d: string | null | undefined): string => DESTINOS.find(x => x.value === d)?.label ?? 'Sin clasificar';

/** Estado de UNA línea para su insignia: sin pago, pagada y esperando conformidad, o confirmada. */
export function estadoLinea(l: Pick<LineaCierre, 'registro' | 'lleva_conformidad'>): { tone: Tone; label: string } {
  if (!l.registro) return { tone: 'warn', label: 'Por pagar' };
  if (!l.lleva_conformidad) return { tone: 'ok', label: 'Pagado' };
  return l.registro.conformidad ? { tone: 'ok', label: 'Con conformidad' } : { tone: 'info', label: 'Pagado · falta conformidad' };
}

/** Quién da la conformidad de cada destino (para decirlo en la pantalla). */
export const QUIEN_CONFIRMA: Partial<Record<Destino, string>> = { administradora: 'la administración', central: 'el tesorero central' };

/** El monto que se propone al registrar: a la empresa administradora y a la Junta central, lo facturado; en servicios y proveedores, el de la boleta o la factura (lo escribe el tesorero). */
export const montoSugerido = (l: Pick<LineaCierre, 'destino' | 'facturado'>): string => (l.destino === 'administradora' || l.destino === 'central' ? l.facturado : '');

/** Una cuenta en una línea: «BCP · Corriente · 194-… · CCI … · titular». Vacía si no hay nada cargado. */
export function textoCuenta(c: Partial<CuentaDestino> | null | undefined): string {
  if (!c) return '';
  return [c.banco, c.tipo, c.numero, c.cci ? `CCI ${c.cci}` : null, c.titular].filter(Boolean).join(' · ');
}

export const tieneCuenta = (c: Partial<CuentaDestino> | null | undefined): boolean => textoCuenta(c) !== '';

/** El mes que se cierra por defecto: el anterior al actual (el cierre se hace hacia el día 5 del mes siguiente). */
export function periodoPorDefecto(hoy: Date = new Date()): { mes: number; anio: number } {
  const p = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth() - 1, 1));
  return { mes: p.getUTCMonth() + 1, anio: p.getUTCFullYear() };
}

export const opcionesMes = MESES.map((m, i) => ({ value: i + 1, label: m.charAt(0).toUpperCase() + m.slice(1) }));
export const opcionesAnio = (anio: number): number[] => [anio - 2, anio - 1, anio, anio + 1].filter(a => a <= anio + 1);

/** «Registrado el 2 oct. 2026 por Rosa · Op. TRF-77». */
export function detalleRegistro(r: RegistroLinea, fecha: (iso: string) => string): string {
  return [`Pagado el ${fecha(r.fecha_pago)}`, r.registrado_por ? `registrado por ${r.registrado_por.nombre}` : null, r.referencia ? `Op. ${r.referencia}` : null].filter(Boolean).join(' · ');
}

/** ¿Se ofrece «Registrar pago» en esta línea? Sólo quien puede registrar el block, en una línea viva sin pago. */
export const puedeRegistrarLinea = (puede: boolean, l: Pick<LineaCierre, 'registro' | 'obsoleta'>): boolean => puede && !l.registro && !l.obsoleta;

/** ¿Se ofrece «Quitar pago»? Quien puede registrar, mientras no tenga conformidad (con ella ya no se corrige). */
export const puedeQuitarPago = (puede: boolean, l: Pick<LineaCierre, 'registro'>): boolean => puede && !!l.registro && !l.registro.conformidad;
