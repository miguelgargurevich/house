// Catálogo fijo de proveedores de IA. Las URLs son constantes: el cliente nunca aporta una (sin SSRF).
// Los gateways propios NO viven aquí: son filas de `GatewayIA` y se convierten en un `ProveedorIA` en `lib/gateways.ts` (`proveedorDeFila`).
// Retirados (ya no se ofrecen): cerebras, sambanova, ollama, llm7, kilo. Sus filas viejas en ClaveIntegracion se ignoran: no se usan en la cadena ni al llamar (ver eslabonDeFila y obtenerClaveParaUso).
export type TipoProveedor = 'gemini' | 'openai-compatible';

export interface ProveedorIA {
  id: string;
  nombre: string;
  descripcion: string;
  tipo: TipoProveedor;
  baseUrl: string;
  urlParaConseguirKey: string;
  modeloPorDefecto: string;
  variableDeEntorno: string;
  prioridad: number;
  /** Sólo en los gateways propios: prioridad para leer comprobantes (null/ausente = usa `prioridad`). */
  prioridadVision?: number | null;
  /** ¿Lee imágenes? Sólo estos proveedores sirven para evaluar comprobantes. */
  vision: boolean;
  /** Modelo con visión por defecto (la clave puede cambiarlo con su campo `modelo`). */
  modeloVision: string;
  /** ¿Acepta PDF además de imágenes? */
  visionPdf: boolean;
  /** Sólo en los gateways propios: id de su fila `GatewayIA`. Es lo que obliga a pasar por las barreras anti-SSRF al llamar. */
  gatewayId?: number;
}

export const PROVEEDORES_IA: readonly ProveedorIA[] = [
  { id: 'gemini', nombre: 'Google Gemini', descripcion: 'Modelos Gemini de Google. Tiene un plan gratuito generoso.', tipo: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', urlParaConseguirKey: 'https://aistudio.google.com/apikey', modeloPorDefecto: 'gemini-flash-latest', variableDeEntorno: 'GEMINI_API_KEY', prioridad: 1, vision: true, modeloVision: 'gemini-flash-latest', visionPdf: true },
  { id: 'groq', nombre: 'Groq', descripcion: 'Inferencia muy rápida de modelos abiertos.', tipo: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', urlParaConseguirKey: 'https://console.groq.com/keys', modeloPorDefecto: 'openai/gpt-oss-120b', variableDeEntorno: 'GROQ_API_KEY', prioridad: 3, vision: false, modeloVision: '', visionPdf: false },
  { id: 'openrouter', nombre: 'OpenRouter', descripcion: 'Una sola clave para muchos modelos de distintos proveedores.', tipo: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', urlParaConseguirKey: 'https://openrouter.ai/keys', modeloPorDefecto: 'google/gemma-4-31b-it:free', variableDeEntorno: 'OPENROUTER_API_KEY', prioridad: 4, vision: true, modeloVision: 'google/gemma-4-31b-it:free', visionPdf: false },
  { id: 'openai', nombre: 'OpenAI', descripcion: 'Modelos GPT de OpenAI.', tipo: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', urlParaConseguirKey: 'https://platform.openai.com/api-keys', modeloPorDefecto: 'gpt-4o-mini', variableDeEntorno: 'OPENAI_API_KEY', prioridad: 5, vision: true, modeloVision: 'gpt-4o-mini', visionPdf: false },
  { id: 'deepseek', nombre: 'DeepSeek', descripcion: 'Modelos DeepSeek a bajo costo.', tipo: 'openai-compatible', baseUrl: 'https://api.deepseek.com', urlParaConseguirKey: 'https://platform.deepseek.com/api_keys', modeloPorDefecto: 'deepseek-chat', variableDeEntorno: 'DEEPSEEK_API_KEY', prioridad: 6, vision: false, modeloVision: '', visionPdf: false },
  { id: 'mistral', nombre: 'Mistral AI', descripcion: 'Modelos Mistral de la empresa francesa.', tipo: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', urlParaConseguirKey: 'https://console.mistral.ai/api-keys', modeloPorDefecto: 'mistral-small-latest', variableDeEntorno: 'MISTRAL_API_KEY', prioridad: 7, vision: true, modeloVision: 'mistral-small-latest', visionPdf: false },
  { id: 'nvidia', nombre: 'NVIDIA', descripcion: 'Catálogo gratuito de build.nvidia.com.', tipo: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', urlParaConseguirKey: 'https://build.nvidia.com/settings/api-keys', modeloPorDefecto: 'meta/llama-3.3-70b-instruct', variableDeEntorno: 'NVIDIA_API_KEY', prioridad: 10, vision: false, modeloVision: '', visionPdf: false },
  { id: 'cohere', nombre: 'Cohere', descripcion: 'Modelos Command de Cohere (capa compatible con OpenAI).', tipo: 'openai-compatible', baseUrl: 'https://api.cohere.ai/compatibility/v1', urlParaConseguirKey: 'https://dashboard.cohere.com/api-keys', modeloPorDefecto: 'command-a-03-2025', variableDeEntorno: 'COHERE_API_KEY', prioridad: 11, vision: false, modeloVision: '', visionPdf: false },
];

export const proveedorPorId = (id: string) => PROVEEDORES_IA.find((p) => p.id === id);
