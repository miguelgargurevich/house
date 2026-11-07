// Lo que devuelve la bandeja del superadmin (`/api/comercial/contactos` y `/api/comercial/reclamaciones`) y los textos que la pintan.

export interface Contacto {
  id: number; nombre: string; correo: string; celular: string | null; condominio: string | null; unidades: number | null; varios_condominios: boolean;
  tema: string; mensaje: string; estado: 'nueva' | 'atendida'; atendida_at: string | null; nota: string | null; aviso_enviado: boolean; created_at: string;
}

export interface Reclamacion {
  id: number; correlativo: string; created_at: string; fecha_limite: string; estado: 'pendiente' | 'respondida'; respondida_at: string | null; respuesta_nota: string | null;
  proveedor_razon_social: string; proveedor_ruc: string; proveedor_domicilio: string;
  consumidor_nombre: string; consumidor_doc_tipo: string; consumidor_doc_numero: string; consumidor_domicilio: string; consumidor_correo: string; consumidor_telefono: string | null;
  menor_de_edad: boolean; apoderado_nombre: string | null; apoderado_doc_tipo: string | null; apoderado_doc_numero: string | null;
  bien_tipo: string; bien_descripcion: string; monto_reclamado: string | null; tipo: 'reclamo' | 'queja'; detalle: string; pedido: string;
  copia_consumidor_enviada: boolean; aviso_enviado: boolean;
  /** Días hábiles que faltan para el plazo; negativo = vencida; null = ya respondida. */
  dias_habiles_restantes: number | null; vencida: boolean;
}

export const DOCUMENTO: Record<string, string> = { dni: 'DNI', ce: 'Carné de extranjería', pasaporte: 'Pasaporte', ruc: 'RUC' };

/** «Vence hoy», «Faltan 3 días hábiles», «Venció hace 2 días hábiles» (pendiente) o «Respondida». */
export function textoPlazo(r: Pick<Reclamacion, 'estado' | 'dias_habiles_restantes'>): string {
  const n = r.dias_habiles_restantes;
  if (r.estado === 'respondida' || n === null) return 'Respondida';
  if (n === 0) return 'Vence hoy';
  if (n > 0) return `Faltan ${n} ${n === 1 ? 'día hábil' : 'días hábiles'}`;
  return `Venció hace ${-n} ${n === -1 ? 'día hábil' : 'días hábiles'}`;
}

/** Rojo si venció; ámbar si faltan 3 días hábiles o menos; neutro el resto. */
export function tonoPlazo(r: Pick<Reclamacion, 'estado' | 'dias_habiles_restantes' | 'vencida'>): 'bad' | 'warn' | 'ok' | 'neutral' {
  if (r.estado === 'respondida') return 'ok';
  if (r.vencida) return 'bad';
  return r.dias_habiles_restantes !== null && r.dias_habiles_restantes <= 3 ? 'warn' : 'neutral';
}
