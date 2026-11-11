// «Qué probar»: los pasos de cada rol de la demo. Cada paso lleva a su pantalla (`ruta`, que existe en `App.tsx`) y, si el manual tiene el video corto de esa
// pantalla, lo enlaza (`manual`: la ancla estable del manual con videos, `docs/marketing/manual-videos.json`). Las casillas se guardan en este navegador.
import type { RolDemo } from './roles';

export interface PasoGuia {
  id: string;
  /** Lo que el visitante hace, en una frase corta. */
  texto: string;
  /** Una línea de ayuda: dónde tocar o qué esperar. */
  ayuda?: string;
  ruta: string;
  /** Ancla del video de esa pantalla en el manual (`url_manual#<ancla>`). */
  manual?: string;
}

export const GUIA: Record<RolDemo, readonly PasoGuia[]> = {
  administradora: [
    { id: 'morosidad', texto: 'Mira la morosidad', ayuda: 'Quién debe, cuánto y desde cuándo. Abre el detalle de un departamento.', ruta: '/admin/morosidad', manual: 'admin.morosidad' },
    { id: 'validar', texto: 'Valida un pago con su voucher', ayuda: 'En «Por validar», abre un pago: el voucher y la lectura de la IA. Después, «Validar pago».', ruta: '/admin/pagos', manual: 'admin.pagos' },
    { id: 'recibo', texto: 'Emite el recibo de un block', ayuda: 'Cada block tiene su recibo del mes, con el avance del cobro.', ruta: '/admin/recibos', manual: 'admin.recibos' },
    { id: 'avisar', texto: 'Avisa a los vecinos (se simula)', ayuda: 'Abre un recibo y toca «Avisar a los vecinos»: en la demo no sale nada real.', ruta: '/admin/recibos', manual: 'admin.whatsapp' },
    { id: 'cerrar', texto: 'Cierra el mes', ayuda: 'El estado del cierre de cada block y de la Junta central.', ruta: '/admin/cierres', manual: 'admin.cierres-del-mes' },
    { id: 'rendicion', texto: 'Mira la rendición del mes', ayuda: 'Lo cobrado, lo pagado, el saldo y la morosidad, listo para la junta.', ruta: '/admin/rendicion', manual: 'admin.rendicion-del-mes' },
  ],
  tesorero_block: [
    { id: 'pagos', texto: 'Mira los pagos de tus vecinos', ayuda: 'Cada pago de tu block llega con su voucher.', ruta: '/junta/pagos', manual: 'junta.pagos-por-validar' },
    { id: 'conformidad', texto: 'Confirma que el dinero llegó', ayuda: 'En un pago por validar, da tu conformidad: el dinero llegó a la cuenta.', ruta: '/junta/pagos', manual: 'junta.pagos-por-validar' },
    { id: 'cuenta', texto: 'Revisa la cuenta donde pagan tus vecinos', ayuda: 'El Yape de la junta y la cuenta del condominio.', ruta: '/junta/medios-pago', manual: 'junta.medios-de-pago' },
    { id: 'cierre', texto: 'Cierra el mes de tu block', ayuda: 'Lo que va a la administración, a los servicios y a la Junta central.', ruta: '/junta/cierre', manual: 'junta.cierre-del-mes' },
    { id: 'comunicado', texto: 'Avisa a tus vecinos con un comunicado', ayuda: 'Escribe un título y un texto corto; en la demo no sale nada real.', ruta: '/junta/comunicados', manual: 'junta.comunicados' },
    { id: 'rendicion', texto: 'Mira la rendición del mes', ayuda: 'El informe del mes de tu block.', ruta: '/junta/rendicion', manual: 'junta.rendicion-del-mes' },
  ],
  presidente_central: [
    { id: 'junta', texto: 'Conoce tu junta', ayuda: 'Tus compañeros de la Junta central y su correo.', ruta: '/junta/mi-junta', manual: 'junta.mi-junta' },
    { id: 'aportes', texto: 'Mira los aportes de los blocks', ayuda: 'Cuánto aportó cada block a la Junta central.', ruta: '/junta/aportes', manual: 'junta_central.aportes-de-los-blocks' },
    { id: 'cierre', texto: 'Cierra el mes de la Junta central', ayuda: 'Los movimientos de la central en el mes.', ruta: '/junta/cierre-central', manual: 'junta_central.cierre-de-la-junta-central' },
    { id: 'rendicion', texto: 'Revisa la rendición del mes', ayuda: 'El informe para presentar a los propietarios.', ruta: '/junta/rendicion', manual: 'junta.rendicion-del-mes' },
    { id: 'comunicado', texto: 'Escribe un comunicado al condominio', ayuda: 'Llega a todos los vecinos; en la demo no sale nada real.', ruta: '/junta/comunicados', manual: 'junta.comunicados' },
    { id: 'proveedores', texto: 'Mira los proveedores de confianza', ayuda: 'Ascensores, gasfitería, electricidad…', ruta: '/junta/proveedores', manual: 'junta.proveedores' },
  ],
  propietario_al_dia: [
    { id: 'inicio', texto: 'Mira cuánto debes', ayuda: 'Tu deuda total y el próximo vencimiento.', ruta: '/propietario/inicio', manual: 'propietario.inicio' },
    { id: 'recibo', texto: 'Revisa tu recibo del mes', ayuda: 'El mantenimiento, concepto por concepto.', ruta: '/propietario/cargos', manual: 'propietario.mis-recibos' },
    { id: 'pagar', texto: 'Paga con el voucher de ejemplo', ayuda: 'Toca «Pagar mantenimiento» y sube cualquier imagen de ejemplo de menos de 2 MB.', ruta: '/propietario/cargos', manual: 'propietario.mis-recibos' },
    { id: 'historial', texto: 'Mira tu historial de pagos', ayuda: 'Cómo evolucionan tus pagos mes a mes.', ruta: '/propietario/pagos', manual: 'propietario.mi-historial' },
    { id: 'junta', texto: 'Conoce a la junta de tu block', ayuda: 'Presidente, tesorero y secretario, y a dónde pagar.', ruta: '/propietario/junta', manual: 'propietario.mi-junta' },
    { id: 'reservas', texto: 'Reserva el salón de usos múltiples', ayuda: 'Elige un día y una hora libres.', ruta: '/propietario/reservas', manual: 'propietario.reservas' },
  ],
  propietario_moroso: [
    { id: 'inicio', texto: 'Mira cuánto debes', ayuda: 'Tu deuda total, con los meses vencidos.', ruta: '/propietario/inicio', manual: 'propietario.inicio' },
    { id: 'detalle', texto: 'Revisa tus meses vencidos', ayuda: 'El recargo por mora de cada recibo vencido.', ruta: '/propietario/cargos', manual: 'propietario.mis-recibos' },
    { id: 'pagar', texto: 'Paga un mes con el voucher de ejemplo', ayuda: 'Toca «Pagar mantenimiento» y sube cualquier imagen de ejemplo de menos de 2 MB.', ruta: '/propietario/cargos', manual: 'propietario.mis-recibos' },
    { id: 'estado', texto: 'Mira tus pagos', ayuda: 'Cuáles están en revisión y cuáles validados.', ruta: '/propietario/pagos', manual: 'propietario.mi-historial' },
    { id: 'comunicados', texto: 'Lee los comunicados', ayuda: 'Lo que anuncian la administración y la junta.', ruta: '/propietario/comunicados', manual: 'propietario.comunicados' },
    { id: 'junta', texto: 'Conoce a tu junta', ayuda: 'A quién escribir si tienes dudas con tu cuenta.', ruta: '/propietario/junta', manual: 'propietario.mi-junta' },
  ],
  inquilino: [
    { id: 'inicio', texto: 'Mira cuánto se debe', ayuda: 'La deuda del departamento y el próximo vencimiento.', ruta: '/inquilino/inicio', manual: 'inquilino.inicio' },
    { id: 'recibo', texto: 'Revisa el recibo del mes', ayuda: 'El mantenimiento, concepto por concepto.', ruta: '/inquilino/cargos', manual: 'inquilino.mis-recibos' },
    { id: 'pagar', texto: 'Paga con el voucher de ejemplo', ayuda: 'Toca «Pagar mantenimiento» y sube cualquier imagen de ejemplo de menos de 2 MB.', ruta: '/inquilino/cargos', manual: 'inquilino.mis-recibos' },
    { id: 'historial', texto: 'Mira tus pagos', ayuda: 'Cómo van los pagos del departamento.', ruta: '/inquilino/pagos', manual: 'inquilino.mi-historial' },
    { id: 'comunicados', texto: 'Lee los comunicados', ayuda: 'Cortes de agua, asambleas, mantenimiento.', ruta: '/inquilino/comunicados', manual: 'inquilino.comunicados' },
    { id: 'reservas', texto: 'Reserva el salón de usos múltiples', ayuda: 'Elige un día y una hora libres.', ruta: '/inquilino/reservas', manual: 'inquilino.reservas' },
  ],
  seguridad: [
    { id: 'inicio', texto: 'Mira tu resumen', ayuda: 'Lo que ve el personal de seguridad al entrar.', ruta: '/seguridad/inicio', manual: 'seguridad.inicio' },
    { id: 'unidades', texto: 'Busca un departamento', ayuda: 'Las unidades del condominio, con su block y su piso.', ruta: '/seguridad/unidades', manual: 'seguridad.unidades' },
    { id: 'perfil', texto: 'Abre tu perfil', ayuda: 'Tu cuenta; en la demo no se puede cambiar la contraseña.', ruta: '/perfil', manual: 'seguridad.mi-perfil' },
  ],
  mantenimiento: [
    { id: 'inicio', texto: 'Mira tu resumen', ayuda: 'Tus tareas pendientes de un vistazo.', ruta: '/mantenimiento/inicio', manual: 'mantenimiento.inicio' },
    { id: 'tareas', texto: 'Abre tus tareas', ayuda: 'Cambiar focos, revisar la bomba de agua, una gotera…', ruta: '/mantenimiento/tareas', manual: 'mantenimiento.mis-tareas' },
    { id: 'cerrar', texto: 'Marca una tarea como completada', ayuda: 'Abre una tarea en proceso y ciérrala.', ruta: '/mantenimiento/tareas', manual: 'mantenimiento.mis-tareas' },
    { id: 'perfil', texto: 'Abre tu perfil', ayuda: 'Tu cuenta; en la demo no se puede cambiar la contraseña.', ruta: '/perfil', manual: 'mantenimiento.mi-perfil' },
  ],
};

/** El video corto de esa pantalla en el manual (`url_manual#ancla`); sin manual configurado o sin ancla, ninguno. */
export function enlaceDeVideo(urlManual: string | null | undefined, paso: Pick<PasoGuia, 'manual'>): string | null {
  if (!urlManual || !paso.manual) return null;
  return `${urlManual.split('#')[0]}#${paso.manual}`;
}

export const claveDeCasillas = (rol: RolDemo) => `house-demo-guia-${rol}`;

/** Las casillas marcadas de un rol, leídas de un texto guardado; ignora lo que ya no es un paso de la guía (la guía puede cambiar entre versiones). */
export function casillasDe(rol: RolDemo, crudo: string | null): ReadonlySet<string> {
  if (!crudo) return new Set();
  try {
    const v: unknown = JSON.parse(crudo);
    const validos = new Set(GUIA[rol].map((p) => p.id));
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && validos.has(x)) : []);
  } catch {
    return new Set();
  }
}
