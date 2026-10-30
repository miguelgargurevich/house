// Qué se dice y cuándo se ofrece cada acción en el cierre del mes: lógica pura (se prueba en tests/cierres-ui.test.ts), sin React.
import { MESES } from '../../../../ui/format';
import type { Tone } from '../../../../ui/Badge';
import type { CategoriaCentral, CuentaDestino, Destino, EstadoCentral, EstadoCierre, LineaCierre, MovimientoCentral, RegistroLinea } from './tipos';

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

// ---------- Cierre de la Junta central ----------
export const ESTADO_CENTRAL: Record<EstadoCentral, { tone: Tone; label: string }> = {
  sin_blocks: { tone: 'neutral', label: 'Sin aportes este mes' },
  faltan_aportes: { tone: 'warn', label: 'Faltan aportes de blocks' },
  falta_conformidad: { tone: 'info', label: 'Falta conformidad' },
  al_dia: { tone: 'ok', label: 'Al día' },
};

export const ESTADO_APORTE = {
  sin_registrar: { tone: 'warn', label: 'Aún no aporta' },
  sin_conformidad: { tone: 'info', label: 'Por confirmar' },
  conforme: { tone: 'ok', label: 'Confirmado' },
} as const;

/** Qué se pide al registrar cada categoría (los mismos que exige el servidor): quién paga y el estacionamiento en el alquiler; el detalle en todo lo demás; el proveedor y el n.º de documento en egresos. */
export const CATEGORIAS_CENTRAL: { value: CategoriaCentral; tipo: 'ingreso' | 'egreso'; label: string; ayuda: string }[] = [
  { value: 'alquiler_estacionamiento', tipo: 'ingreso', label: 'Alquiler de estacionamiento', ayuda: 'Se paga aparte, a la cuenta de la Junta central (no va en el recibo del vecino). Anota quién paga, qué estacionamiento y el periodo.' },
  { value: 'otro_ingreso', tipo: 'ingreso', label: 'Otro ingreso', ayuda: 'Cualquier otro ingreso de la Junta central: describe de qué es.' },
  { value: 'servicio', tipo: 'egreso', label: 'Pago de servicios (agua, luz)', ayuda: 'Pago de la boleta de un servicio del condominio: adjunta el voucher y anota el n.º de la boleta.' },
  { value: 'proveedor', tipo: 'egreso', label: 'Proveedor de áreas comunes', ayuda: 'Pago de la factura de un proveedor (jardinería, ascensor, cisterna…): adjunta el voucher y anota el n.º de la factura.' },
  { value: 'otro_egreso', tipo: 'egreso', label: 'Otro egreso', ayuda: 'Cualquier otro pago de la Junta central: describe de qué es.' },
];

export interface CamposCategoria { pagador: boolean; estacionamiento: boolean; proveedor: boolean; documento: boolean; descripcion: boolean }

export function camposDeCategoria(c: CategoriaCentral): CamposCategoria {
  return {
    pagador: c === 'alquiler_estacionamiento' || c === 'otro_ingreso',
    estacionamiento: c === 'alquiler_estacionamiento',
    proveedor: c === 'proveedor',
    documento: c === 'servicio' || c === 'proveedor',
    descripcion: c !== 'alquiler_estacionamiento',
  };
}

/** Lo que falta para poder registrar, antes de enviar (el servidor lo vuelve a exigir): el mensaje por campo. */
export function erroresDeMovimiento(f: { categoria: CategoriaCentral; monto: string; fecha: string; descripcion: string; pagador: string; estacionamiento: string; tieneVoucher: boolean }): Record<string, string> {
  const e: Record<string, string> = {};
  const campos = camposDeCategoria(f.categoria);
  if (!/^\d+(\.\d{1,2})?$/.test(f.monto.trim()) || Number(f.monto) <= 0) e.monto = 'Escribe un monto mayor que cero, con hasta 2 decimales.';
  if (!f.fecha) e.fecha = 'Elige la fecha.';
  if (campos.descripcion && !f.descripcion.trim()) e.descripcion = 'Escribe el detalle.';
  if (f.categoria === 'alquiler_estacionamiento' && !f.pagador.trim()) e.pagador = 'Escribe quién paga (vecino o externo).';
  if (campos.estacionamiento && !f.estacionamiento.trim()) e.estacionamiento = 'Escribe qué estacionamiento se alquila.';
  if (!f.tieneVoucher) e.voucher = 'Adjunta el voucher.';
  return e;
}

/** Título de un movimiento en la lista: el alquiler dice qué estacionamiento y quién; lo demás, su detalle (y el proveedor). */
export function tituloMovimiento(m: Pick<MovimientoCentral, 'categoria' | 'estacionamiento' | 'pagador' | 'descripcion' | 'proveedor'>): string {
  if (m.categoria === 'alquiler_estacionamiento') return [m.estacionamiento, m.pagador].filter(Boolean).join(' · ') || 'Alquiler de estacionamiento';
  return [m.descripcion, m.proveedor?.razon_social].filter(Boolean).join(' · ') || 'Movimiento';
}

/** «Fecha 2 oct. 2026 · Doc. F001-9 · Op. TRF-1 · registrado por Rosa». */
export function detalleMovimiento(m: Pick<MovimientoCentral, 'documento' | 'referencia' | 'registrado_por' | 'tipo'>, fecha: string): string {
  return [`${m.tipo === 'ingreso' ? 'Cobrado' : 'Pagado'} el ${fecha}`, m.documento ? `Doc. ${m.documento}` : null, m.referencia ? `Op. ${m.referencia}` : null, m.registrado_por ? `registrado por ${m.registrado_por.nombre}` : null].filter(Boolean).join(' · ');
}
