import { HttpError } from '../errors';

/**
 * Campos que dicen a QUÉ cliente pertenece un recurso. Un cuerpo (POST/PUT/PATCH) nunca debe poder moverlos «en silencio»:
 * si el endpoint no los acepta, se rechazan con 422 en vez de ignorarlos (si algún día un esquema los admitiera sin revisar,
 * sería una fuga entre clientes; así el error salta en la primera prueba).
 */
export const CAMPOS_DE_AMBITO = ['empresa_id', 'complejo_id', 'estructura_id'] as const;
export type CampoDeAmbito = (typeof CAMPOS_DE_AMBITO)[number];

/** Código estable de la respuesta 422 (junto a `error` y `campos`) para que la pantalla o un cliente de la API reaccione. */
export const CODIGO_CAMPO_DE_AMBITO = 'CAMPO_DE_AMBITO';

const QUE: Record<CampoDeAmbito, string> = { empresa_id: 'la empresa', complejo_id: 'el condominio', estructura_id: 'el block' };

/** Mismo valor (un id llega como número o texto) y `null`/ausente cuentan como lo mismo. */
const mismo = (a: unknown, b: unknown): boolean => (a == null || b == null ? a == null && b == null : String(a) === String(b));

function rechazo(campo: CampoDeAmbito, modo: 'crear' | 'cambiar'): HttpError {
  const texto =
    modo === 'cambiar'
      ? `No se puede cambiar ${QUE[campo]} de este recurso`
      : campo === 'empresa_id'
        ? 'empresa_id no se envía: se toma de tu cuenta'
        : `${campo} no se envía en este recurso`;
  return new HttpError(422, `Datos inválidos: ${campo}: ${texto}`, { [campo]: texto }, CODIGO_CAMPO_DE_AMBITO);
}

/**
 * Rechaza (422) los campos de ámbito del cuerpo que el endpoint no acepta.
 * - `permitidos`: los que el esquema SÍ declara (esos los valida la propia ruta).
 * - `actual`: al EDITAR, la fila existente; un campo que llega con el MISMO valor que ya tiene se acepta (no cambia nada: es lo que
 *   hace un formulario que reenvía todo el recurso); con otro valor, 422. Al CREAR no se pasa `actual`: cualquier campo no declarado sobra.
 */
export function rechazarAmbito(body: unknown, o: { permitidos?: Iterable<string>; actual?: Record<string, unknown> } = {}): void {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return; // el esquema se queja del cuerpo
  const permitidos = new Set(o.permitidos ?? []);
  const cuerpo = body as Record<string, unknown>;
  for (const campo of CAMPOS_DE_AMBITO) {
    if (cuerpo[campo] === undefined || permitidos.has(campo)) continue;
    if (o.actual && mismo(cuerpo[campo], o.actual[campo])) continue;
    throw rechazo(campo, o.actual ? 'cambiar' : 'crear');
  }
}

/**
 * Para un campo que el esquema declara pero la ruta fija por su cuenta (la empresa de quien llama, la del recurso): si llega y es
 * distinto de lo que la ruta va a usar, 422 en vez de pisarlo en silencio. `undefined` = no vino.
 */
export function exigirMismoAmbito(campo: CampoDeAmbito, enviado: unknown, real: unknown, modo: 'crear' | 'cambiar'): void {
  if (enviado === undefined || mismo(enviado, real)) return;
  throw rechazo(campo, modo);
}
