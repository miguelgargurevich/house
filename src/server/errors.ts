export class HttpError extends Error {
  status: number;
  campos?: Record<string, string>;
  constructor(status: number, message: string, campos?: Record<string, string>) {
    super(message);
    this.status = status;
    this.campos = campos;
  }
}

export const notFound = (what = 'Recurso') => new HttpError(404, `${what} no encontrado`);
export const forbidden = (msg = 'No tienes permisos para esta acción') => new HttpError(403, msg);
export const conflict = (msg: string) => new HttpError(409, msg);
export const invalid = (msg: string, campos?: Record<string, string>) => new HttpError(422, msg, campos);
