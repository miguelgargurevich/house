// Registro en dos pasos para las pruebas que sólo necesitan «una administradora con su condominio recién creado»: paso 1 (cuenta), correo marcado como
// verificado (se salta el enlace; ese camino lo prueban `comercial-registro` y `registro-dos-pasos`), ingreso y paso 2 (condominio).
import { prisma, llamar, login } from './app';

export const CLAVE_REGISTRO = 'Cl4ve-segura-2026';

/** El cuerpo del paso 1 (la cuenta). */
export const cuenta = (over: Record<string, unknown> = {}) => ({
  nombre: 'Rosa Quispe', email: 'rosa@casa.pe', celular: '987 654 321', password: CLAVE_REGISTRO, acepta_terminos: true, ...over,
});

/** El cuerpo del paso 2 (el condominio). */
export const condominio = (over: Record<string, unknown> = {}) => ({ empresa: 'Junta Los Pinos', condominio: 'Condominio Los Pinos', unidades: 48, ...over });

/** Paso 1 + verificar + ingresar. Devuelve la sesión de la nueva administradora (todavía sin condominio). */
export async function registrarYEntrar(base: string, email: string, over: Record<string, unknown> = {}): Promise<string> {
  const r = await llamar(base, 'POST', '/api/publico/registro', null, cuenta({ email, ...over }));
  if (r.status !== 202) throw new Error(`registro de ${email} falló con ${r.status}: ${r.texto}`);
  await prisma.usuario.update({ where: { email }, data: { correo_verificado: true } });
  return login(base, email, CLAVE_REGISTRO);
}

/** Los dos pasos completos. Devuelve la sesión y los ids del condominio. */
export async function registrarConCondominio(base: string, email: string, datos: Record<string, unknown> = {}) {
  const sesion = await registrarYEntrar(base, email);
  const r = await llamar(base, 'POST', '/api/comercial/primer-condominio', sesion, condominio({ empresa: `Junta ${email}`, condominio: `Condominio ${email}`, unidades: 12, ...datos }));
  if (r.status !== 201) throw new Error(`primer condominio de ${email} falló con ${r.status}: ${r.texto}`);
  return { sesion, complejoId: r.body.complejo_id as number, empresaId: r.body.empresa_id as number };
}
