/**
 * Contraste (por código, nunca por el texto del modelo) entre lo que leyó la IA y lo que debía pagarse.
 * Funciones puras: sin base de datos ni red, para poder probarlas en matriz.
 */
import { MONEDA_POR_DEFECTO, monedaDe } from '../../lib/paises';
import type { Lectura } from '../lib/lecturaComprobante';

export type Comprobacion = boolean | null;
export type Veredicto = 'coincide' | 'revisar' | 'no_coincide' | 'ilegible';

export interface Coincidencias {
  monto: Comprobacion;
  destino: Comprobacion;
  fecha: Comprobacion;
  estado_operacion: Comprobacion;
}

export interface MedioParaContraste {
  tipo: string; // banco | yape | plin | recaudacion
  titular: string;
  celular: string | null;
  numero_cuenta: string | null;
  cci: string | null;
  /** Recaudación: nombre del servicio tal como aparece en «Pago de servicios» (no tiene número de cuenta). */
  servicio?: string | null;
}

export interface Esperado {
  monto: string; // decimal como texto
  /** Moneda del condominio (ISO 4217); sin ella, soles. Un comprobante en otra moneda no puede coincidir. */
  moneda?: string;
  /** Mes y año del recibo: si el mensaje del comprobante nombra otro mes, se alerta y el veredicto no puede ser «coincide». */
  periodo?: { mes: number; anio: number } | null;
  /** Fecha de emisión del recibo (el día en Lima, 00:00 UTC). */
  emision: Date;
  /** Hoy en Lima (00:00 UTC). */
  hoy: Date;
}

export interface Duplicados {
  /** Id de otro pago que ya usó el MISMO archivo. */
  archivoEnPago: number | null;
  /** Id de otro pago de la empresa con el mismo número de operación. */
  operacionEnPago: number | null;
}

export interface Contraste {
  coincidencias: Coincidencias;
  alertas: string[];
  veredicto: Veredicto;
  confianza: number;
  resumen: string;
}

const DIA = 86_400_000;
export const TOLERANCIA_MONTO = 0.01;
export const DIAS_ANTES_EMISION = 3;
export const MIN_OPERACION = 5;

const PESOS = { monto: 40, destino: 30, fecha: 10, operacion: 10, estado: 10 } as const;

/** Sin tildes, mayúsculas y sólo letras/números separados por un espacio. */
export function normalizarNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9Ñ]+/g, ' ')
    .trim();
}

const palabras = (s: string) => new Set(normalizarNombre(s).split(' ').filter((p) => p.length >= 2));

/** ≥ 2 palabras en común con el titular (o todas las del titular si éste tiene menos de 2). */
export function nombreCoincide(leido: string | null, titular: string): boolean {
  if (!leido) return false;
  const a = palabras(leido);
  const t = palabras(titular);
  if (t.size === 0) return false;
  let comunes = 0;
  for (const p of t) if (a.has(p)) comunes++;
  return comunes >= Math.min(2, t.size);
}

const soloDigitos = (s: string | null) => (s ?? '').replace(/\D/g, '');
const terminaEn = (completo: string | null, cola: string) => {
  const d = soloDigitos(completo);
  return d.length > 0 && cola.length >= 3 && d.endsWith(cola);
};

const esRecaudacion = (m: MedioParaContraste) => m.tipo === 'recaudacion';
const hayDatosDeDestino = (l: Pick<Lectura, 'destino_numero' | 'destinatario_nombre'>) => !!(l.destino_numero || l.destinatario_nombre);

/**
 * `null` si no hay medios activos, la IA no extrajo ni número ni nombre de destino, o NO es comparable: con una cuenta recaudadora activa el
 * comprobante de «Pago de servicios» puede no traer ni cuenta ni el nombre del servicio, así que lo que no coincide no se da por distinto.
 * Una recaudación sólo se compara por el nombre del servicio (o el titular); nunca por la entidad sola (cualquier pago al mismo banco coincidiría).
 */
export function contrastarDestino(l: Pick<Lectura, 'medio' | 'destino_numero' | 'destinatario_nombre'>, medios: MedioParaContraste[]): Comprobacion {
  if (medios.length === 0) return null;
  if (!hayDatosDeDestino(l)) return null;
  const cola = l.destino_numero ?? '';
  const billetera = l.medio === 'yape' || l.medio === 'plin';
  const bancario = l.medio === 'transferencia' || l.medio === 'deposito';
  const coincide = medios.some((m) => {
    if (nombreCoincide(l.destinatario_nombre, m.titular)) return true;
    if (esRecaudacion(m)) return !!m.servicio && nombreCoincide(l.destinatario_nombre, m.servicio);
    if (!cola) return false;
    if (m.tipo === 'banco') return !billetera && (terminaEn(m.numero_cuenta, cola) || terminaEn(m.cci, cola));
    return !bancario && terminaEn(m.celular, cola);
  });
  if (coincide) return true;
  return medios.some(esRecaudacion) ? null : false;
}

export function contrastarMonto(l: Pick<Lectura, 'monto' | 'moneda'>, esperado: string, moneda: string = MONEDA_POR_DEFECTO): Comprobacion {
  if (l.moneda != null && l.moneda !== moneda) return false;
  if (l.monto == null || l.moneda == null) return null;
  return Math.abs(l.monto - Number(esperado)) <= TOLERANCIA_MONTO + 1e-9;
}

/** Entre 3 días antes de la emisión y mañana (hora de Lima). */
export function contrastarFecha(fecha: string | null, e: Pick<Esperado, 'emision' | 'hoy'>): Comprobacion {
  if (!fecha) return null;
  const t = Date.parse(`${fecha}T00:00:00Z`);
  return t >= e.emision.getTime() - DIAS_ANTES_EMISION * DIA && t <= e.hoy.getTime() + DIA;
}

// ---------- Periodo que nombra el mensaje del comprobante ----------
export const MESES: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5, may: 5, junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8,
  setiembre: 9, septiembre: 9, sept: 9, set: 9, sep: 9, octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};
export const NOMBRE_MES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MES_RE = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|');

/** Minúsculas y sin tildes: el OCR, la IA y las apps no son consistentes con ellas. */
export const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const MES_NUM = String.raw`(0?[1-9]|1[0-2])`;
// «2026-09» / «2026/9» y «09/2026» / «9-2026»; no cuentan como mes las fechas completas («22/10/2026», «2026-10-22»).
const AAAA_MM = new RegExp(String.raw`(?<![\d/.-])20\d{2}[-/]${MES_NUM}(?![\d]|[-/]\d)`);
const MM_AAAA = new RegExp(String.raw`(?<![\d/.-])${MES_NUM}[-/]20\d{2}(?!\d)`);

/**
 * Mes (1–12) que nombra el mensaje del comprobante (nombre, abreviatura común, «AAAA-MM» o «MM/AAAA») y la palabra para mostrar. Sólo sale de nuestra tabla
 * de meses y de los números reconocidos: nunca se copia texto libre del comprobante. Es la única detección de mes: la usan el OCR y la IA.
 */
export function mesDelMensaje(mensaje: string | null | undefined): { mes: number; palabra: string } | null {
  if (!mensaje) return null;
  const t = norm(mensaje);
  const m = new RegExp(String.raw`\b(${MES_RE})\b`).exec(t);
  if (m) return { mes: MESES[m[1]!]!, palabra: m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1) };
  const n = AAAA_MM.exec(t) ?? MM_AAAA.exec(t);
  if (!n) return null;
  const mes = Number(n[1]);
  return { mes, palabra: NOMBRE_MES[mes]!.charAt(0).toUpperCase() + NOMBRE_MES[mes]!.slice(1) };
}

/** ¿El mensaje nombra un mes distinto del recibo? Devuelve la alerta (armada por código) o `null`. `sujeto`: cómo lo llama la pantalla («voucher» el OCR, «comprobante» la IA). */
export function alertaDePeriodo(mensaje: string | null | undefined, recibo: { mes: number; anio: number } | null | undefined, sujeto: 'voucher' | 'comprobante'): string | null {
  const en = mesDelMensaje(mensaje);
  if (!en || !recibo || en.mes === recibo.mes) return null;
  return `El mensaje del ${sujeto} dice «${en.palabra}», pero el recibo es de ${NOMBRE_MES[recibo.mes] ?? 'otro mes'} de ${recibo.anio}`;
}

const NO_ES = 'La imagen no parece un comprobante de pago';
const SIN_LEER = 'No se pudo leer el comprobante con claridad';

/** «dólares», «soles», «pesos chilenos»: para la alerta. */
const nombreDeMoneda = (codigo: string): string =>
  codigo === 'USD' ? 'dólares' : codigo === 'PEN' ? 'soles' : codigo === 'EUR' ? 'euros' : (monedaDe(codigo)?.nombre.toLowerCase() ?? codigo);

export function contrastar(l: Lectura, esperado: Esperado, medios: MedioParaContraste[], dup: Duplicados): Contraste {
  const coincidencias: Coincidencias = {
    monto: contrastarMonto(l, esperado.monto, esperado.moneda),
    destino: contrastarDestino(l, medios),
    fecha: contrastarFecha(l.fecha, esperado),
    estado_operacion: l.estado_operacion === 'exitosa' ? true : l.estado_operacion === 'desconocido' ? null : false,
  };
  const tieneOperacion = !!l.numero_operacion && l.numero_operacion.length >= MIN_OPERACION;
  const alertas: string[] = [];
  if (!l.es_comprobante_de_pago) alertas.push(NO_ES);
  else if (!l.legible) alertas.push(SIN_LEER);
  if (dup.archivoEnPago != null) alertas.push(`Este archivo ya se usó en el pago #${dup.archivoEnPago}`);
  if (dup.operacionEnPago != null) alertas.push(`El número de operación ya se usó en el pago #${dup.operacionEnPago}`);
  if (l.estado_operacion === 'fallida') alertas.push('La operación figura como fallida');
  if (l.estado_operacion === 'pendiente') alertas.push('La operación figura como pendiente');
  const otraMoneda = l.moneda != null && l.moneda !== (esperado.moneda ?? MONEDA_POR_DEFECTO);
  if (otraMoneda) alertas.push(`El comprobante está en ${nombreDeMoneda(l.moneda!)}${esperado.moneda && esperado.moneda !== MONEDA_POR_DEFECTO ? `, no en ${nombreDeMoneda(esperado.moneda)}` : ''}`);
  if (coincidencias.monto === false && !otraMoneda) alertas.push('El monto del comprobante no coincide con lo que se debe');
  if (coincidencias.destino === false) alertas.push('El destino no coincide con los medios de pago activos');
  if (coincidencias.destino === null && hayDatosDeDestino(l) && medios.some(esRecaudacion)) alertas.push('El destino no se pudo comparar con la cuenta recaudadora: revísalo a mano');
  if (coincidencias.fecha === false) alertas.push('La fecha del comprobante está fuera del rango esperado');
  const alertaPeriodo = alertaDePeriodo(l.mensaje, esperado.periodo, 'comprobante');
  if (alertaPeriodo) alertas.push(alertaPeriodo);

  const duplicado = dup.archivoEnPago != null || dup.operacionEnPago != null;
  let veredicto: Veredicto;
  if (!l.legible || !l.es_comprobante_de_pago) veredicto = 'ilegible';
  else if (coincidencias.monto === false || coincidencias.destino === false || duplicado || l.estado_operacion === 'fallida') veredicto = 'no_coincide';
  else if (coincidencias.monto === true && coincidencias.destino === true && coincidencias.fecha === true && l.estado_operacion === 'exitosa' && !alertaPeriodo) veredicto = 'coincide';
  else veredicto = 'revisar';

  const puntos =
    (coincidencias.monto === true ? PESOS.monto : 0) + (coincidencias.destino === true ? PESOS.destino : 0) + (coincidencias.fecha === true ? PESOS.fecha : 0) +
    (tieneOperacion ? PESOS.operacion : 0) + (coincidencias.estado_operacion === true ? PESOS.estado : 0);
  const confianza = puntos / 100;

  return { coincidencias, alertas, veredicto, confianza, resumen: resumenDe(veredicto, coincidencias, alertas.length > 0, alertaPeriodo != null) };
}

/** Texto corto armado por código (nunca copiado de la respuesta del modelo). */
function resumenDe(v: Veredicto, c: Coincidencias, hayAlertas: boolean, periodo: boolean): string {
  switch (v) {
    case 'coincide': return 'El monto, el destino y la fecha del comprobante coinciden con lo esperado.';
    case 'ilegible': return 'No se pudo leer el comprobante o no parece un pago: revísalo a mano.';
    case 'no_coincide': return 'Hay datos del comprobante que no coinciden con lo esperado o que ya se usaron: revísalo antes de validar.';
    default: {
      const faltan = [c.monto !== true && 'el monto', c.destino !== true && 'el destino', c.fecha !== true && 'la fecha', c.estado_operacion !== true && 'el estado de la operación', periodo && 'el periodo'].filter(Boolean);
      return `No se pudo confirmar ${faltan.join(', ') || 'algún dato'}${hayAlertas ? ' (hay alertas)' : ''}: revísalo a mano.`;
    }
  }
}
