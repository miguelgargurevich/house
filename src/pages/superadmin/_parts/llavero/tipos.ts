export interface UsoClave {
  ok: number;
  limite: number;
  error: number;
}

export interface Clave {
  id: number;
  proveedor: string;
  /** Sólo en las claves de un gateway propio. */
  gateway_id: number | null;
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
  /** Sólo en los gateways propios: id de su `GatewayIA` (las claves se agregan con `gateway_id`, no con el id del proveedor). */
  gatewayId?: number;
}

export type EstadoGateway = 'ok' | 'pausado' | 'dominio_no_permitido';
export interface Gateway {
  id: number;
  nombre: string;
  base_url: string;
  dominio: string;
  modelo_por_defecto: string | null;
  modelo_vision: string | null;
  vision: boolean;
  prioridad: number;
  /** Sólo para leer comprobantes; null = usa `prioridad`. */
  prioridad_vision: number | null;
  habilitado: boolean;
  estado: EstadoGateway;
  claves: number;
}
export interface DominioPermitido { id: number; dominio: string; creado: string }

export interface DestinoInterno { id: string; url: string }
export type OcrVista =
  | { configurado: false; destinos_internos: DestinoInterno[] }
  | { configurado: true; destinos_internos: DestinoInterno[]; modo: 'interno' | 'publico'; destino_interno: string | null; base_url: string | null; url: string | null; ultimos4: string | null; tiene_clave: boolean; habilitado: boolean; estado: 'ok' | 'pausado' | 'invalido' };

/** Un gateway visto como proveedor, para reusar la lista de claves, «Probar», «Cambiar modelo»… Su id (`gw-<id>`) coincide con el del orden de rotación. */
export function proveedorDeGateway(g: Gateway): Proveedor {
  return {
    id: `gw-${g.id}`,
    gatewayId: g.id,
    nombre: g.nombre,
    descripcion: `${g.dominio} · ${g.vision ? 'lee imágenes (visión)' : 'sin visión'}`,
    urlParaConseguirKey: '',
    modeloPorDefecto: g.modelo_por_defecto ?? '',
  };
}

/** Las claves de un proveedor del catálogo o de un gateway concreto. */
export const clavesDeProveedor = (claves: Clave[], p: Proveedor) =>
  claves.filter(c => (p.gatewayId !== undefined ? c.gateway_id === p.gatewayId : c.proveedor === p.id && c.gateway_id === null));

/** Texto de lo que le pasa a un gateway que no está en servicio (null = en servicio). */
export function avisoDeGateway(g: Gateway): string | null {
  if (g.estado === 'dominio_no_permitido') return `El dominio ${g.dominio} ya no está en la lista de dominios permitidos: sus claves NO se usan. Vuelve a agregarlo en «Dominios permitidos» para reactivarlo.`;
  if (g.estado === 'pausado') return 'Pausado: sus claves no se usan hasta que lo reanudes.';
  return null;
}

/** Bot de Telegram global (el token nunca sale del servidor: sólo sus 4 últimos caracteres). */
export interface TelegramVista {
  configurado: boolean;
  habilitado: boolean;
  bot_usuario: string | null;
  bot_nombre: string | null;
  ultimos4: string | null;
  enlace: string | null;
  webhook_url: string;
  webhook_registrado_at: string | null;
  llavero_configurado: boolean;
}

export interface DatosLlavero {
  configurado: boolean;
  claves: Clave[];
  proveedores: Proveedor[];
  orden: string[];
  max_claves_por_proveedor: number;
  gateways: Gateway[];
  dominios_permitidos: DominioPermitido[];
  ocr: OcrVista;
  telegram: TelegramVista;
  salud: Salud;
  cambios_recientes: CambioModelo[];
  consultas_recientes: ConsultaReciente[];
}

/** Resumen de las claves de un proveedor, visible aunque el grupo esté plegado. */
export function resumenClaves(claves: Clave[]): string {
  if (claves.length === 0) return 'Sin clave guardada.';
  const n = claves.length;
  const base = `${n} ${n === 1 ? 'clave' : 'claves'}`;
  const pausadas = claves.filter(c => !c.habilitada).length;
  const reservas = claves.filter(c => c.reserva).length;
  const extras: string[] = [];
  if (pausadas > 0) extras.push(`${pausadas} pausada${pausadas === 1 ? '' : 's'}`);
  if (reservas > 0) extras.push(`${reservas} de reserva`);
  return extras.length > 0 ? `${base} · ${extras.join(' · ')}` : base;
}

/** Etiqueta propuesta al agregar: `principal` para la primera, luego `clave-2`, `clave-3`… la primera libre. */
export function etiquetaSugerida(usadas: string[]): string {
  if (usadas.length === 0) return 'principal';
  for (let n = 2; ; n++) if (!usadas.includes(`clave-${n}`)) return `clave-${n}`;
}
