// Catálogo fijo de proveedores de IA. Las URLs son constantes: el cliente nunca aporta una (sin SSRF).
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
  /** ¿Lee imágenes? Sólo estos proveedores sirven para evaluar comprobantes. */
  vision: boolean;
  /** Modelo con visión por defecto (la clave puede cambiarlo con su campo `modelo`). */
  modeloVision: string;
  /** ¿Acepta PDF además de imágenes? */
  visionPdf: boolean;
}

export const PROVEEDORES_IA: readonly ProveedorIA[] = [
  { id: 'gemini', nombre: 'Google Gemini', descripcion: 'Modelos Gemini de Google. Tiene un plan gratuito generoso.', tipo: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', urlParaConseguirKey: 'https://aistudio.google.com/apikey', modeloPorDefecto: 'gemini-flash-latest', variableDeEntorno: 'GEMINI_API_KEY', prioridad: 1, vision: true, modeloVision: 'gemini-flash-latest', visionPdf: true },
  { id: 'groq', nombre: 'Groq', descripcion: 'Inferencia muy rápida de modelos abiertos.', tipo: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', urlParaConseguirKey: 'https://console.groq.com/keys', modeloPorDefecto: 'openai/gpt-oss-120b', variableDeEntorno: 'GROQ_API_KEY', prioridad: 2, vision: false, modeloVision: '', visionPdf: false },
  { id: 'openrouter', nombre: 'OpenRouter', descripcion: 'Una sola clave para muchos modelos de distintos proveedores.', tipo: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', urlParaConseguirKey: 'https://openrouter.ai/keys', modeloPorDefecto: 'google/gemma-4-31b-it:free', variableDeEntorno: 'OPENROUTER_API_KEY', prioridad: 3, vision: true, modeloVision: 'google/gemma-4-31b-it:free', visionPdf: false },
  { id: 'openai', nombre: 'OpenAI', descripcion: 'Modelos GPT de OpenAI.', tipo: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', urlParaConseguirKey: 'https://platform.openai.com/api-keys', modeloPorDefecto: 'gpt-4o-mini', variableDeEntorno: 'OPENAI_API_KEY', prioridad: 4, vision: true, modeloVision: 'gpt-4o-mini', visionPdf: false },
  { id: 'deepseek', nombre: 'DeepSeek', descripcion: 'Modelos DeepSeek a bajo costo.', tipo: 'openai-compatible', baseUrl: 'https://api.deepseek.com', urlParaConseguirKey: 'https://platform.deepseek.com/api_keys', modeloPorDefecto: 'deepseek-chat', variableDeEntorno: 'DEEPSEEK_API_KEY', prioridad: 5, vision: false, modeloVision: '', visionPdf: false },
  { id: 'mistral', nombre: 'Mistral AI', descripcion: 'Modelos Mistral de la empresa francesa.', tipo: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', urlParaConseguirKey: 'https://console.mistral.ai/api-keys', modeloPorDefecto: 'mistral-small-latest', variableDeEntorno: 'MISTRAL_API_KEY', prioridad: 6, vision: true, modeloVision: 'mistral-small-latest', visionPdf: false },
  { id: 'cerebras', nombre: 'Cerebras', descripcion: 'Inferencia muy rápida con plan gratuito.', tipo: 'openai-compatible', baseUrl: 'https://api.cerebras.ai/v1', urlParaConseguirKey: 'https://cloud.cerebras.ai/', modeloPorDefecto: 'gpt-oss-120b', variableDeEntorno: 'CEREBRAS_API_KEY', prioridad: 7, vision: false, modeloVision: '', visionPdf: false },
  { id: 'sambanova', nombre: 'SambaNova', descripcion: 'Modelos abiertos rápidos con plan gratuito.', tipo: 'openai-compatible', baseUrl: 'https://api.sambanova.ai/v1', urlParaConseguirKey: 'https://cloud.sambanova.ai/apis', modeloPorDefecto: 'Meta-Llama-3.3-70B-Instruct', variableDeEntorno: 'SAMBANOVA_API_KEY', prioridad: 8, vision: false, modeloVision: '', visionPdf: false },
  { id: 'nvidia', nombre: 'NVIDIA', descripcion: 'Catálogo gratuito de build.nvidia.com.', tipo: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', urlParaConseguirKey: 'https://build.nvidia.com/settings/api-keys', modeloPorDefecto: 'meta/llama-3.3-70b-instruct', variableDeEntorno: 'NVIDIA_API_KEY', prioridad: 9, vision: false, modeloVision: '', visionPdf: false },
  { id: 'cohere', nombre: 'Cohere', descripcion: 'Modelos Command de Cohere (capa compatible con OpenAI).', tipo: 'openai-compatible', baseUrl: 'https://api.cohere.ai/compatibility/v1', urlParaConseguirKey: 'https://dashboard.cohere.com/api-keys', modeloPorDefecto: 'command-a-03-2025', variableDeEntorno: 'COHERE_API_KEY', prioridad: 10, vision: false, modeloVision: '', visionPdf: false },
  { id: 'ollama', nombre: 'Ollama Cloud', descripcion: 'Modelos abiertos alojados por Ollama.', tipo: 'openai-compatible', baseUrl: 'https://ollama.com/v1', urlParaConseguirKey: 'https://ollama.com/settings/keys', modeloPorDefecto: 'gpt-oss:120b', variableDeEntorno: 'OLLAMA_API_KEY', prioridad: 11, vision: false, modeloVision: '', visionPdf: false },
  { id: 'llm7', nombre: 'LLM7', descripcion: 'Pasarela gratuita de modelos abiertos.', tipo: 'openai-compatible', baseUrl: 'https://api.llm7.io/v1', urlParaConseguirKey: 'https://token.llm7.io/', modeloPorDefecto: 'gpt-4.1-nano', variableDeEntorno: 'LLM7_API_KEY', prioridad: 12, vision: false, modeloVision: '', visionPdf: false },
  { id: 'kilo', nombre: 'Kilo', descripcion: 'Pasarela de Kilo Code con modelos gratuitos.', tipo: 'openai-compatible', baseUrl: 'https://api.kilo.ai/api/gateway/v1', urlParaConseguirKey: 'https://app.kilo.ai/', modeloPorDefecto: 'kilo-auto/free', variableDeEntorno: 'KILO_API_KEY', prioridad: 13, vision: false, modeloVision: '', visionPdf: false },
];

export const proveedorPorId = (id: string) => PROVEEDORES_IA.find((p) => p.id === id);
