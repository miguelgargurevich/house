type Rol = 'superadmin' | 'admin' | 'propietario' | 'inquilino' | 'mantenimiento' | 'seguridad';

/** Chips del panel vacío, por rol. */
export const SUGERENCIAS: Record<Rol, string[]> = {
  propietario: ['¿Cuánto debo?', '¿Cómo pago?', '¿Cómo subo mi comprobante?'],
  inquilino: ['¿Cuánto debo?', '¿Cómo pago?', '¿Cómo subo mi comprobante?'],
  admin: ['¿Qué pagos debo validar?', '¿Quién está en mora?', '¿Cómo emito un recibo?'],
  superadmin: ['¿Cómo agrego una clave de IA?', '¿Qué pagos hay por validar?', '¿Cómo sé si la IA está funcionando?'],
  mantenimiento: ['¿Cuántas tareas tengo abiertas?', '¿Cómo actualizo una tarea?'],
  seguridad: ['¿Qué puedo ver en la app?', '¿Cómo cambio mi contraseña?'],
};

/** Para el cargo de junta (presidente/tesorero) se suma lo suyo. */
export const SUGERENCIA_JUNTA = '¿Qué pagos debo validar?';
