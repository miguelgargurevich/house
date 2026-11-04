/**
 * Lógica pura de la carga de contactos en pantalla (sin React ni `import.meta.env`, para probarla en Node): los textos del resumen,
 * si hay algo que guardar y la línea «X invitaciones enviadas, Y en cola». Los números los calcula el servidor; aquí sólo se escriben.
 */

export interface ResumenContactos {
  filas: number;
  filas_con_error: number;
  filas_con_aviso: number;
  correos_nuevos: number;
  correos_cambiados: number;
  celulares_nuevos: number;
  celulares_cambiados: number;
  propietarios_nuevos: number;
  inquilinos_nuevos: number;
  unidades_unidas: number;
  cambian_quien_paga: number;
  invitables: number;
}

export interface ProblemaContacto {
  fila: number;
  unidad: string | null;
  persona: 'propietario' | 'inquilino' | null;
  nivel: 'error' | 'aviso';
  mensaje: string;
}

export interface VistaPrevia {
  error: string;
  resumen: ResumenContactos;
  problemas: ProblemaContacto[];
  problemas_total: number;
  filas_vacias: number;
}

export interface Guardado {
  resumen: ResumenContactos;
  creados: number;
  actualizados: number;
  unidades_asignadas: number;
  invitaciones_encoladas: number;
  problemas: ProblemaContacto[];
  problemas_total: number;
}

export interface EstadoCola {
  enviadas: number;
  en_cola: number;
  por_encolar: number;
  por_dia: number;
  enviadas_hoy: number;
  dias: number;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** Una frase por cosa que cambia; vacía si no cambia nada. */
export function lineasDeResumen(r: ResumenContactos): string[] {
  const l: string[] = [];
  if (r.correos_nuevos) l.push(`Se agregan ${plural(r.correos_nuevos, 'correo', 'correos')}.`);
  if (r.correos_cambiados) l.push(`Se cambian ${plural(r.correos_cambiados, 'correo', 'correos')} que ya estaban cargados.`);
  if (r.celulares_nuevos) l.push(`Se agregan ${plural(r.celulares_nuevos, 'celular', 'celulares')}.`);
  if (r.celulares_cambiados) l.push(`Se cambian ${plural(r.celulares_cambiados, 'celular', 'celulares')} que ya estaban cargados.`);
  if (r.inquilinos_nuevos) l.push(`Se crean ${plural(r.inquilinos_nuevos, 'inquilino', 'inquilinos')}.`);
  if (r.cambian_quien_paga) l.push(`${plural(r.cambian_quien_paga, 'departamento pasa', 'departamentos pasan')} a avisar de los cobros al inquilino.`);
  if (r.propietarios_nuevos) l.push(`Se crean ${plural(r.propietarios_nuevos, 'propietario', 'propietarios')} en departamentos que no tenían.`);
  if (r.unidades_unidas) l.push(`${plural(r.unidades_unidas, 'departamento pasa', 'departamentos pasan')} a la persona que ya tiene ese mismo correo.`);
  return l;
}

/** ¿Hay algo que guardar? Con la casilla de invitar, también cuenta quien quedaría en cola. */
export function hayQueGuardar(r: ResumenContactos, invitar: boolean): boolean {
  const cambia = r.correos_nuevos + r.correos_cambiados + r.celulares_nuevos + r.celulares_cambiados + r.propietarios_nuevos + r.inquilinos_nuevos + r.unidades_unidas;
  return cambia > 0 || (invitar && r.invitables > 0);
}

/** «12 invitaciones enviadas, 436 en cola (salen en 5 días)». */
export function textoCola(e: EstadoCola): string {
  const enviadas = `${e.enviadas} ${e.enviadas === 1 ? 'invitación enviada' : 'invitaciones enviadas'}`;
  const cola = `${e.en_cola} en cola`;
  return e.en_cola > 0 && e.dias > 0 ? `${enviadas}, ${cola} (salen en ${plural(e.dias, 'día', 'días')})` : `${enviadas}, ${cola}`;
}

/** Cómo se llama la persona de una fila en la tabla de problemas. */
export const etiquetaPersona = (p: ProblemaContacto['persona']): string => (p === 'propietario' ? 'Propietario' : p === 'inquilino' ? 'Inquilino' : '');
