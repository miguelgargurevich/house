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
}

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
}

/** Etiqueta propuesta al agregar: `principal` para la primera, luego `clave-2`, `clave-3`… la primera libre. */
export function etiquetaSugerida(usadas: string[]): string {
  if (usadas.length === 0) return 'principal';
  for (let n = 2; ; n++) if (!usadas.includes(`clave-${n}`)) return `clave-${n}`;
}
