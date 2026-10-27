export type Esfuerzo = 'low' | 'medium' | 'high';
export type PresetId = 'preciso' | 'equilibrado' | 'creativo' | 'a_medida';
export type Categoria = 'razonamiento' | 'rapido' | 'equilibrado' | 'avanzado';

export interface Parametros { temperature: number; maxTokens: number; topP: number; topK: number }

/** Lo que el usuario eligió en «Ajustes» (se guarda por usuario y viaja con cada mensaje). */
export interface Ajustes { modelo: string; preset: PresetId; parametros: Parametros; esfuerzo: Esfuerzo }

export interface ModeloOpcion { id: string; nombre: string; categoria: Categoria; proveedor: string; gratis: boolean }
export interface PresetOpcion { id: PresetId; nombre: string; detalle: string; parametros: Parametros | null }

/** `GET /api/ai-chat/opciones`: lo que ESTE usuario puede elegir. */
export interface OpcionesChat {
  modelos: ModeloOpcion[];
  categorias: { id: Categoria; nombre: string }[];
  presets: PresetOpcion[];
  esfuerzos: Esfuerzo[];
  puede_elegir_modelo: boolean;
  puede_elegir_esfuerzo: boolean;
  max_tokens: number;
}

export type CausaError = 'no_configurado' | 'saturado' | 'limite_uso' | 'sin_conexion' | 'tiempo' | 'caido' | 'cortada' | 'sesion' | 'modelo' | 'sin_modulo' | 'otro';
export interface ErrorChat { causa: CausaError; mensaje: string }

export interface MensajeChat {
  /** Identificador local (no el de la base). */
  id: string;
  /** Id en la base (sólo si ya se guardó): lo usa «Editar» para borrar desde ese mensaje en el servidor. */
  idServidor?: number;
  rol: 'user' | 'assistant';
  texto: string;
  estado: 'ok' | 'transmitiendo' | 'error';
  error?: ErrorChat;
  modelo?: string | null;
  proveedor?: string | null;
  latencia_ms?: number | null;
  modo?: 'contingencia' | null;
}

export interface ConversacionResumen { id: string; titulo: string; updated_at: string }
