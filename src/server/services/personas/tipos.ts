/**
 * Personas de un departamento (`PersonaUnidad`): tipos y reglas comunes.
 *
 * Modelo:
 *  - `Unidad.propietario_id` / `inquilino_id` siguen siendo el titular y el inquilino principal. La persona de relación `propietario` es la titular y la de
 *    relación `inquilino` es la principal: como máximo UNA de cada una por departamento (el resto va como copropietario, cónyuge, familiar u otro).
 *  - `usuario_id` es la cuenta de la persona. Con `acceso_activo` puede entrar a Torre; sin él es sólo una ficha (sirve para mandarle avisos).
 *  - `responsable_pago`: a ella le llega el aviso de cobro del departamento (como máximo UNA por departamento).
 *  - `recibe_comunicados`: recibe los comunicados que se envían «a cada vecino».
 */
import { correoSinBuzon } from '../invitaciones';
import { formatearCelular, normalizarCelular } from '../avisos/celular';

export const RELACIONES = ['propietario', 'copropietario', 'conyuge', 'familiar', 'inquilino', 'otro'] as const;
export type Relacion = (typeof RELACIONES)[number];

export const ETIQUETA_RELACION: Record<Relacion, string> = {
  propietario: 'Propietario',
  copropietario: 'Copropietario',
  conyuge: 'Cónyuge',
  familiar: 'Familiar',
  inquilino: 'Inquilino',
  otro: 'Otro',
};

/** Rol de la cuenta de una persona: inquilino si la relación es inquilino; en cualquier otro caso, propietario. */
export const rolDeRelacion = (r: string): 'propietario' | 'inquilino' => (r === 'inquilino' ? 'inquilino' : 'propietario');

/** Las dos relaciones que siguen a `Unidad.propietario_id` / `inquilino_id`. */
export const esPrincipal = (r: string): r is 'propietario' | 'inquilino' => r === 'propietario' || r === 'inquilino';
export const campoDeUnidad = (r: 'propietario' | 'inquilino') => (r === 'propietario' ? 'propietario_id' : 'inquilino_id') as 'propietario_id' | 'inquilino_id';

/** El correo real en minúsculas, o null (un correo de relleno `…@sin-correo.invalid` no es un correo). */
export const correoReal = (email: string | null | undefined): string | null => {
  const e = (email ?? '').trim().toLowerCase();
  return e && !correoSinBuzon(e) ? e : null;
};

/** El celular con formato internacional si es válido; si no, el texto tal cual (nunca se pierde un dato cargado); vacío → null. */
export const celularGuardado = (t: string | null | undefined): string | null => {
  const crudo = (t ?? '').trim();
  if (!crudo) return null;
  const e164 = normalizarCelular(crudo);
  return e164 ? formatearCelular(e164) : crudo;
};

/** Empresa que administra el condominio de la unidad (la del condominio manda sobre la de la unidad). */
export const empresaDeUnidad = (u: { empresa_id: number | null; complejo: { empresa_id: number | null } | null }): number | null => u.complejo?.empresa_id ?? u.empresa_id ?? null;
