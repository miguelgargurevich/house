/**
 * Conformidad del tesorero («el dinero llegó a la cuenta») vista por quien valida: qué se dice y cuándo se bloquea Validar. Lógica pura, sin React.
 * Regla «IA + tesorero»: la administradora valida sólo con el check del tesorero; la IA, si el condominio lo tiene encendido, valida sola con la
 * lectura que coincide MÁS el check. Si nadie puede darlo (el block no tiene tesorero, o el pago es del propio tesorero) no se exige.
 */
import type { Rol } from '../../../../auth/AuthContext';

export interface ConformidadPago { at: string; por: { nombre: string } }

export interface DatosConformidad {
  estado_validacion: 'por_validar' | 'validado' | 'rechazado';
  /** `undefined` = el servidor no la trajo (no se sabe); `null` = el tesorero aún no la da. */
  conformidad?: ConformidadPago | null;
  /** ¿El block del pago tiene un tesorero que pueda darla? */
  tesorero_registrado?: boolean;
  /** Por qué NO se exige el check (nadie puede darlo); `null` = se exige; `undefined` = el servidor no lo trajo. */
  conformidad_exencion?: ExencionConformidad | null;
}

export type ExencionConformidad = 'sin_tesorero' | 'pago_del_tesorero';

export type VistaConformidad = { tipo: 'dada'; nombre: string; at: string } | { tipo: 'falta' } | { tipo: 'sin_tesorero' } | { tipo: 'pago_del_tesorero' };

/** Por qué no se exige el check: lo que dice el servidor o, si no lo trajo, lo que se deduce del block sin tesorero. `undefined` = no se sabe. */
export function exencionDe(p: Pick<DatosConformidad, 'conformidad_exencion' | 'tesorero_registrado'>): ExencionConformidad | null | undefined {
  if (p.conformidad_exencion !== undefined) return p.conformidad_exencion;
  return p.tesorero_registrado === false ? 'sin_tesorero' : undefined;
}

/**
 * ¿Validar está bloqueado por falta del check? Sólo cuando se SABE que se exige y falta (el servidor es quien manda: sin el dato, el botón queda
 * habilitado y el 409 del servidor responde «Falta el check del tesorero del block»).
 */
export const faltaCheckParaValidar = (p: DatosConformidad): boolean => p.estado_validacion === 'por_validar' && p.conformidad === null && exencionDe(p) === null;

/** Sin dato → null (nada que decir). Dada → siempre se muestra como constancia; si falta, sólo mientras el pago sigue por validar. */
export function vistaConformidad(p: DatosConformidad): VistaConformidad | null {
  if (p.conformidad === undefined) return null;
  if (p.conformidad) return { tipo: 'dada', nombre: p.conformidad.por.nombre, at: p.conformidad.at };
  if (p.estado_validacion !== 'por_validar') return null;
  const exencion = exencionDe(p);
  return exencion ? { tipo: exencion } : { tipo: 'falta' };
}

/** `comoTesorero`: el propio tesorero no lee «el tesorero aún no confirma», sino lo que le toca hacer. */
export function textoConformidad(v: VistaConformidad, fecha: (iso: string) => string, comoTesorero = false): string {
  switch (v.tipo) {
    case 'dada': return `Confirmado por el tesorero: ${v.nombre} · ${fecha(v.at)}`;
    case 'sin_tesorero': return 'El block no tiene tesorero registrado: nadie dará el check. Puedes validar tú; quedará anotado.';
    case 'pago_del_tesorero': return 'Este pago lo registró el tesorero del block y nadie puede darle el check. Puedes validarlo tú; quedará anotado.';
    case 'falta': return comoTesorero
      ? 'Aún no confirmaste que el dinero llegó a la cuenta. Revisa la cuenta o el Yape de la junta y confirma abajo: sin tu check el pago no se valida.'
      : 'El tesorero aún no da su check (que el dinero llegó a la cuenta): no se puede validar hasta que lo dé.';
  }
}

/** Antes de validar sin el check (porque nadie puede darlo) se repite el aviso: la validación queda anotada con ese motivo. */
export const TEXTO_VALIDAR_SIN_CHECK = 'Vas a validar sin el check del tesorero porque nadie puede darlo en este pago. Quedará anotado en la auditoría. ¿Validas?';
/** Motivo que acompaña al botón Validar deshabilitado. */
export const MOTIVO_FALTA_CHECK = 'Falta el check del tesorero del block: no se puede validar hasta que lo dé.';

type EvaluacionResumen = { estado: string; veredicto?: string | null } | null | undefined;

/** IA: coincide / duda (no coincide, revisar o ilegible) / no leído (sin IA, con error o sin evaluar) / evaluando. */
export function textoIA(ev: EvaluacionResumen): { tone: 'ok' | 'warn' | 'neutral'; label: string } {
  if (!ev) return { tone: 'neutral', label: 'no leído' };
  if (ev.estado === 'pendiente') return { tone: 'neutral', label: 'evaluando…' };
  if (ev.estado !== 'completada') return { tone: 'neutral', label: 'no leído' };
  return ev.veredicto === 'coincide' ? { tone: 'ok', label: 'coincide' } : { tone: 'warn', label: 'duda' };
}

/** «Voucher ✓ · IA: coincide · Tesorero: pendiente»: lo que falta para que el pago se valide, de un vistazo. */
export function estadoRevision(p: DatosConformidad & { comprobante?: unknown; evaluacion?: EvaluacionResumen }): { voucher: string; ia: ReturnType<typeof textoIA>; tesorero: { tone: 'ok' | 'warn' | 'neutral'; label: string } } {
  const exencion = exencionDe(p);
  const tesorero = p.conformidad ? { tone: 'ok' as const, label: '✓' } : exencion ? { tone: 'neutral' as const, label: 'no aplica' } : { tone: 'warn' as const, label: 'pendiente' };
  return { voucher: p.comprobante ? '✓' : 'falta', ia: textoIA(p.evaluacion), tesorero };
}

export const textoEstadoRevision = (p: Parameters<typeof estadoRevision>[0]): string => {
  const e = estadoRevision(p);
  return `Voucher ${e.voucher} · IA: ${e.ia.label} · Tesorero: ${e.tesorero.label}`;
};

/** Insignia de la lista: sólo en pagos por validar o con conformidad dada. */
export function insigniaConformidad(p: DatosConformidad): { tone: 'ok' | 'warn'; label: string } | null {
  const v = vistaConformidad(p);
  if (!v) return null;
  return v.tipo === 'dada' ? { tone: 'ok', label: 'Con conformidad' } : { tone: 'warn', label: 'Sin conformidad' };
}

type Usuario = { rol?: Rol | null; cargo_junta?: string | null } | null | undefined;
/** Validan y rechazan sólo la administración (admin y superadmin); la junta revisa y el tesorero da la conformidad. */
export const puedeValidar = (u: Usuario) => u?.rol === 'admin' || u?.rol === 'superadmin';
export const esTesorero = (u: Usuario) => u?.rol === 'propietario' && u.cargo_junta === 'tesorero';
