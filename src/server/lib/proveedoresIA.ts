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
}

export const PROVEEDORES_IA: readonly ProveedorIA[] = [
  { id: 'gemini', nombre: 'Google Gemini', descripcion: 'Modelos Gemini de Google. Tiene un plan gratuito generoso.', tipo: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', urlParaConseguirKey: 'https://aistudio.google.com/apikey', modeloPorDefecto: 'gemini-flash-latest', variableDeEntorno: 'GEMINI_API_KEY', prioridad: 1 },
  { id: 'groq', nombre: 'Groq', descripcion: 'Inferencia muy rápida de modelos abiertos.', tipo: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', urlParaConseguirKey: 'https://console.groq.com/keys', modeloPorDefecto: 'openai/gpt-oss-120b', variableDeEntorno: 'GROQ_API_KEY', prioridad: 2 },
  { id: 'openrouter', nombre: 'OpenRouter', descripcion: 'Una sola clave para muchos modelos de distintos proveedores.', tipo: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', urlParaConseguirKey: 'https://openrouter.ai/keys', modeloPorDefecto: 'google/gemma-4-31b-it:free', variableDeEntorno: 'OPENROUTER_API_KEY', prioridad: 3 },
  { id: 'openai', nombre: 'OpenAI', descripcion: 'Modelos GPT de OpenAI.', tipo: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', urlParaConseguirKey: 'https://platform.openai.com/api-keys', modeloPorDefecto: 'gpt-4o-mini', variableDeEntorno: 'OPENAI_API_KEY', prioridad: 4 },
  { id: 'deepseek', nombre: 'DeepSeek', descripcion: 'Modelos DeepSeek a bajo costo.', tipo: 'openai-compatible', baseUrl: 'https://api.deepseek.com', urlParaConseguirKey: 'https://platform.deepseek.com/api_keys', modeloPorDefecto: 'deepseek-chat', variableDeEntorno: 'DEEPSEEK_API_KEY', prioridad: 5 },
  { id: 'mistral', nombre: 'Mistral AI', descripcion: 'Modelos Mistral de la empresa francesa.', tipo: 'openai-compatible', baseUrl: 'https://api.mistral.ai/v1', urlParaConseguirKey: 'https://console.mistral.ai/api-keys', modeloPorDefecto: 'mistral-small-latest', variableDeEntorno: 'MISTRAL_API_KEY', prioridad: 6 },
];

export const proveedorPorId = (id: string) => PROVEEDORES_IA.find((p) => p.id === id);
