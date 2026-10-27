export class HttpError extends Error {
  status: number;
  campos?: Record<string, string>;
  /** Código estable para que la pantalla reaccione (p. ej. `MODULO_NO_ACTIVO`); va junto a `extra` en la respuesta. */
  code?: string;
  extra?: Record<string, string | number | boolean | null>;
  constructor(status: number, message: string, campos?: Record<string, string>, code?: string, extra?: Record<string, string | number | boolean | null>) {
    super(message);
    this.status = status;
    this.campos = campos;
    this.code = code;
    this.extra = extra;
  }
}

export const notFound = (what = 'Recurso') => new HttpError(404, `${what} no encontrado`);
export const forbidden = (msg = 'No tienes permisos para esta acción') => new HttpError(403, msg);
export const conflict = (msg: string) => new HttpError(409, msg);
export const invalid = (msg: string, campos?: Record<string, string>) => new HttpError(422, msg, campos);
