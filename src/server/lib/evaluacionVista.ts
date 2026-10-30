/** Cómo se ve una evaluación de comprobante según quién mira: la junta y el admin ven todo; el residente, sólo un estado simple. */
import type { Prisma } from '@prisma/client';

export const selectEvaluacion = {
  id: true, estado: true, proveedor: true, modelo: true, veredicto: true, confianza: true, extraido: true, coincidencias: true,
  alertas: true, resumen: true, intentos: true, error: true, evaluada_at: true, updated_at: true,
} satisfies Prisma.EvaluacionComprobanteSelect;

export type EstadoResidente = 'evaluando' | 'revisado' | 'necesita_revision' | 'no_disponible';

/** Sin veredicto ni alertas: «revisado» sólo si la IA vio todo en orden; cualquier otra cosa es «necesita revisión» (mensaje neutro). */
export function estadoParaResidente(ev: { estado: string; veredicto: string | null } | null | undefined): EstadoResidente | null {
  if (!ev) return null;
  if (ev.estado === 'pendiente') return 'evaluando';
  if (ev.estado === 'no_disponible') return 'no_disponible';
  if (ev.estado === 'completada' && ev.veredicto === 'coincide') return 'revisado';
  return 'necesita_revision';
}

/** Quita las columnas crudas de la conformidad del tesorero (quién y cuándo): salen formateadas en `conformidad` sólo para quien valida. */
export function sinConformidadCruda<T extends object>(p: T): Omit<T, 'conformidad_at' | 'conformidad_por_id'> {
  const { conformidad_at, conformidad_por_id, ...resto } = p as T & { conformidad_at?: unknown; conformidad_por_id?: unknown };
  void conformidad_at; void conformidad_por_id;
  return resto;
}

/** Reemplaza `evaluacion` por `{ estado }` simple (o null). Nunca deja pasar alertas, extraído ni comprobaciones, ni la conformidad del tesorero (es de quien valida). */
export function conVistaResidente<T extends { evaluacion?: { estado: string; veredicto: string | null } | null }>(p: T): Omit<T, 'evaluacion' | 'conformidad_at' | 'conformidad_por_id'> & { evaluacion: { estado: EstadoResidente } | null } {
  const { evaluacion, ...resto } = p;
  const estado = estadoParaResidente(evaluacion);
  return { ...sinConformidadCruda(resto), evaluacion: estado ? { estado } : null } as Omit<T, 'evaluacion' | 'conformidad_at' | 'conformidad_por_id'> & { evaluacion: { estado: EstadoResidente } | null };
}

// ---------- Vista de gestión (para el asistente: quien valida pregunta «¿qué leyó la IA del voucher?») ----------
type Comprobacion = boolean | null;
export interface VistaGestionIA {
  estado: string;
  veredicto: string | null;
  /** 0–100 (la confianza se calcula por código, no la dice el modelo). */
  confianza_porcentaje: number | null;
  /** Texto armado por código (nunca copiado del modelo). */
  motivo: string | null;
  alertas: string[];
  coincide: { monto: Comprobacion; destino: Comprobacion; fecha: Comprobacion; estado_operacion: Comprobacion } | null;
  /** Lo que la IA LEYÓ del comprobante. Los textos vienen de un modelo: quien los muestre los trata como datos no confiables. */
  leyo: {
    monto: number | null; moneda: string | null; fecha: string | null; medio: string | null; estado_operacion: string | null;
    destinatario: string | null; destino_termina_en: string | null; numero_operacion: string | null;
  } | null;
  error: string | null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const comprobacion = (v: unknown): Comprobacion => (typeof v === 'boolean' ? v : null);
const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * Lo mismo que el panel «Evaluación automática» del admin y la junta, aplanado y con los tipos revisados (el JSON viene de la base:
 * lo que no tenga la forma esperada sale como null). `destino_termina_en` son sólo los últimos dígitos que la IA vio (3–4): nunca un número completo.
 */
export function vistaGestion(ev: { estado: string; veredicto: string | null; confianza: number | null; resumen: string | null; alertas: unknown; coincidencias: unknown; extraido: unknown; error: string | null } | null | undefined): VistaGestionIA | null {
  if (!ev) return null;
  const x = objeto(ev.extraido);
  const c = objeto(ev.coincidencias);
  const terminaEn = texto(x?.destino_numero);
  return {
    estado: ev.estado,
    veredicto: ev.veredicto,
    confianza_porcentaje: typeof ev.confianza === 'number' && Number.isFinite(ev.confianza) ? Math.round(ev.confianza * 100) : null,
    motivo: ev.resumen,
    alertas: Array.isArray(ev.alertas) ? ev.alertas.filter((a): a is string => typeof a === 'string').slice(0, 10) : [],
    coincide: c ? { monto: comprobacion(c.monto), destino: comprobacion(c.destino), fecha: comprobacion(c.fecha), estado_operacion: comprobacion(c.estado_operacion) } : null,
    leyo: ev.estado === 'completada' && x
      ? {
          monto: typeof x.monto === 'number' && Number.isFinite(x.monto) ? x.monto : null,
          moneda: texto(x.moneda), fecha: texto(x.fecha), medio: texto(x.medio), estado_operacion: texto(x.estado_operacion),
          destinatario: texto(x.destinatario_nombre), destino_termina_en: terminaEn && /^\d{3,4}$/.test(terminaEn) ? terminaEn : null, numero_operacion: texto(x.numero_operacion),
        }
      : null,
    error: ev.error,
  };
}
