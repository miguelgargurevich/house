// Recepción del voucher de un movimiento de la Junta central (`multipart/form-data`). Igual que `lib/voucherSubida.ts#recibirVoucher`, pero con más campos de texto
// (el formulario del ingreso o el egreso lleva hasta 12). El resto (verificación del archivo, campos vacíos) lo reusa de ahí.
import type { Request, RequestHandler } from 'express';
import multer from 'multer';
import { invalid } from '../../errors';
import { MAX_COMPROBANTE } from '../comprobantes';

const CAMPOS = 16;
const subir = multer({ storage: multer.memoryStorage(), defParamCharset: 'utf8', limits: { fileSize: MAX_COMPROBANTE, files: 1, fields: CAMPOS, fieldSize: 1024, parts: CAMPOS + 1 } });

/** Con `multipart/form-data` recibe el voucher (campo `voucher`, un solo archivo) tras correr `ubicar` (404/403 sin recibir el archivo; lo que devuelva queda en `res.locals[clave]`). Con JSON no hace nada. */
export function recibirVoucherCentral<T>(clave: string, ubicar: (req: Request) => Promise<T>): RequestHandler {
  return async (req, res, next) => {
    if (!req.is('multipart/form-data')) return next();
    try {
      res.locals[clave] = await ubicar(req);
    } catch (err) {
      return next(err);
    }
    subir.single('voucher')(req, res, (err?: unknown) => {
      if (err instanceof multer.MulterError) {
        const grande = err.code === 'LIMIT_FILE_SIZE';
        return next(invalid(grande ? 'El archivo pesa más de 2 MB' : 'Datos inválidos: voucher: adjunta un solo archivo en el campo voucher', { voucher: grande ? 'Demasiado grande' : 'Archivo inválido' }));
      }
      next(err);
    });
  };
}
