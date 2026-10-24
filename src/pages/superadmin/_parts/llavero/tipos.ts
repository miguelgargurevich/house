export interface UsoClave {
  ok: number;
  limite: number;
  error: number;
}

export interface Clave {
  id: number;
  proveedor: string;
  etiqueta: string;
  ultimos4: string;
  modelo: string | null;
  habilitada: boolean;
  estado: 'sin_probar' | 'ok' | 'error' | 'rechazada';
  estado_detalle: string | null;
  probada_at: string | null;
  ultimo_uso_at: string | null;
  enfriando_hasta: string | null;
  uso: UsoClave;
  /** Proveedor «de reserva»: sólo se usa cuando todo lo demás falla. */
  reserva: boolean;
  /** «El modelo X ya no existe; ahora usa Y»: la clave volvió a elección automática. */
  aviso_modelo: string | null;
  /** Modelo que el modo Auto usaría con esta clave (o el fijado). */
  modelo_en_uso: string | null;
  modelos_activos: number;
  modelos_deprecados: number;
  ultima_sync: { at: string; ok: boolean; nuevos: number; deprecados: number; revividos: number; error: string | null } | null;
}

export type EstadoRuta = 'ok' | 'enfriando' | 'modelo_no_disponible' | 'rechazada' | 'sin_saldo';
export interface Salud {
  configurada: boolean;
  ok: boolean;
  desde: string | null;
  motivo: string | null;
  rutas: { proveedor: string; modelo: string | null; estado: EstadoRuta; hasta: string | null; reserva: boolean }[];
}

export interface CambioModelo { fecha: string; proveedor: string; etiqueta: string; tipo: 'nuevo' | 'retirado' | 'reactivado'; modelo: string; origen: string }
export interface ConsultaReciente { id: number; proveedor: string | null; modelo: string | null; estado: 'ok' | 'error'; modo: 'contingencia' | null; error_codigo: string | null; latencia_ms: number | null; at: string }
export interface ModeloDeClave { id: string; nombre: string; categoria: string; categoria_nombre: string; gratis: boolean }

export interface Proveedor {
  id: string;
  nombre: string;
  descripcion: string;
  urlParaConseguirKey: string;
  modeloPorDefecto: string;
}

export interface DatosLlavero {
  configurado: boolean;
  claves: Clave[];
  proveedores: Proveedor[];
  orden: string[];
  max_claves_por_proveedor: number;
  salud: Salud;
  cambios_recientes: CambioModelo[];
  consultas_recientes: ConsultaReciente[];
}

/** Etiqueta propuesta al agregar: `principal` para la primera, luego `clave-2`, `clave-3`… la primera libre. */
export function etiquetaSugerida(usadas: string[]): string {
  if (usadas.length === 0) return 'principal';
  for (let n = 2; ; n++) if (!usadas.includes(`clave-${n}`)) return `clave-${n}`;
}
