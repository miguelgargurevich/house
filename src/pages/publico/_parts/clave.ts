/** Las reglas que el servidor exige al CREAR una contraseña (`passwordSchema`), para mostrarlas mientras se escribe. El servidor sigue siendo quien decide. */
export const CLAVE_MIN = 8;
export const CLAVE_MAX = 72;

export interface ReglaClave { texto: string; ok: boolean }

export function reglasClave(clave: string, repetida: string): ReglaClave[] {
  return [
    { texto: `Al menos ${CLAVE_MIN} caracteres`, ok: clave.length >= CLAVE_MIN },
    { texto: 'Una letra y un número', ok: /\p{L}/u.test(clave) && /\d/.test(clave) },
    { texto: 'Las dos contraseñas coinciden', ok: clave.length > 0 && clave === repetida },
  ];
}

export const claveLista = (clave: string, repetida: string): boolean => clave.length <= CLAVE_MAX && reglasClave(clave, repetida).every((r) => r.ok);
