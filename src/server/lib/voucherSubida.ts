// Recepción del voucher al registrar el pago de un mantenimiento (`multipart/form-data`: los campos de texto y el archivo en `voucher`).
// La usan la administradora (`routes/recibos.ts`, voucher opcional) y el residente (`routes/me.ts`, voucher obligatorio).
import { createHash } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { HttpError, invalid } from '../errors';
import { detectarTipo, MAX_COMPROBANTE, sanearNombre, TIPOS_COMPROBANTE, type TipoComprobante } from '../services/comprobantes';
import type { ComprobanteAdjunto } from '../services/mantenimiento';

const subirVoucher = multer({ storage: multer.memoryStorage(), defParamCharset: 'utf8', limits: { fileSize: MAX_COMPROBANTE, files: 1, fields: 8, fieldSize: 1024, parts: 9 } });

/**
 * Con `multipart/form-data` recibe el voucher (campo `voucher`, un solo archivo). Antes de leer el cuerpo corre `ubicar`: quien no alcanza ese
 * mantenimiento recibe 404 sin que se reciba el archivo (lo que `ubicar` devuelva queda en `res.locals[clave]`). Con JSON no hace nada.
 */
export function recibirVoucher<T>(clave: string, ubicar: (req: Request) => Promise<T>): RequestHandler {
  return async (req, res, next) => {
    if (!req.is('multipart/form-data')) return next();
    try {
      res.locals[clave] = await ubicar(req);
    } catch (err) {
      return next(err);
    }
    subirVoucher.single('voucher')(req, res, (err?: unknown) => {
      if (err instanceof multer.MulterError) {
        const grande = err.code === 'LIMIT_FILE_SIZE';
        return next(invalid(grande ? 'El archivo pesa más de 2 MB' : 'Datos inválidos: voucher: adjunta un solo archivo en el campo voucher', { voucher: grande ? 'Demasiado grande' : 'Archivo inválido' }));
      }
      next(err);
    });
  };
}

/** Lo que `ubicar` dejó para esta petición (si el cuerpo era JSON no hubo `ubicar` y vale `undefined`). */
export const ubicado = <T>(res: Response, clave: string): T | undefined => res.locals[clave] as T | undefined;

/** Los campos de texto del formulario llegan como cadenas: los vacíos (un campo sin llenar) se descartan; el resto lo valida zod igual que en JSON (`usuario_id` se convierte a número ahí). */
export function camposDeFormulario(body: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries((body ?? {}) as Record<string, unknown>).filter(([, v]) => v !== ''));
}

/** Verifica el voucher igual que `POST /api/pagos/:id/comprobante`: tipo declarado permitido (415), no vacío y bytes que correspondan al tipo (422). */
export function voucherVerificado(file: Express.Multer.File, subidoPorId: number): ComprobanteAdjunto {
  const declarado = file.mimetype as TipoComprobante;
  if (!(TIPOS_COMPROBANTE as readonly string[]).includes(declarado)) throw new HttpError(415, 'Tipo de archivo no permitido: sube una imagen JPG, PNG o WebP, o un PDF');
  if (file.size === 0) throw invalid('El archivo está vacío', { voucher: 'Vacío' });
  if (detectarTipo(file.buffer) !== declarado) throw invalid('El contenido del archivo no corresponde a su tipo', { voucher: 'No corresponde a su tipo' });
  return { nombre: sanearNombre(file.originalname, declarado), tipo_mime: declarado, tamano: file.size, sha256: createHash('sha256').update(file.buffer).digest('hex'), datos: file.buffer, subidoPorId };
}
