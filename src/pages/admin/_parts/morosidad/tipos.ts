// Lo que la pantalla de Morosidad sabe del recordatorio de deuda (`POST /api/recordatorios/deuda`). Sin React: lo prueban las pruebas de fuente.

/** Lo que devuelve `POST /api/recordatorios/deuda` (la vista previa y, al confirmar, el resultado). */
export interface PlanRecordatorio {
  confirmado: boolean;
  unidades: number;
  sin_deuda: number;
  ya_recordadas_hoy: number;
  responsables: number;
  por_avisar: number;
  por_correo: number;
  por_whatsapp: number;
  sin_canal: number;
  whatsapp: { complejo_id: number; nombre: string; por_enviar: number; usadas: number; tope: number | null; restantes: number | null; alcanza: boolean; hoy: { enviados: number; tope: number | null }; disponible: boolean; motivo_no_disponible: string | null }[];
  ejemplo: { asunto: string; cuerpo: string } | null;
  avisos_encolados?: number;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «3 departamentos» / «1 departamento». */
export const textoDepartamentos = (n: number) => plural(n, 'departamento', 'departamentos');

/** Lo que se dice al terminar el envío: cuántos avisos quedaron en cola, o por qué ninguno. */
export function textoEnviado(p: Pick<PlanRecordatorio, 'avisos_encolados' | 'por_avisar'>): string {
  const n = p.avisos_encolados ?? 0;
  if (n === 0) return 'No se encoló ningún aviso: a esos departamentos ya se les recordó hoy o no tienen un canal activo.';
  return `Recordatorio en camino: ${plural(n, 'aviso encolado', 'avisos encolados')} para ${textoDepartamentos(p.por_avisar)}. Salen de a poco; los ves en Comunicados › Notificaciones.`;
}
