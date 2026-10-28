/**
 * Imágenes del recibo impreso: foto de cabecera del condominio, logo de la empresa y foto del contómetro de cada departamento.
 * Mismas reglas que el QR de los medios de pago (cuerpo crudo, tipo declarado + bytes reales, nombre saneado), con tope de 2 MB.
 */
import express, { type Request, type Response } from 'express';
import { prisma } from '../db';
import { HttpError, invalid } from '../errors';
import { detectarTipo, dispositionInline, sanearNombre, type TipoComprobante } from './comprobantes';

export const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TipoImagen = (typeof TIPOS_IMAGEN)[number];
export const MAX_IMAGEN = 2 * 1024 * 1024;

/** Lee el cuerpo crudo de una imagen (> 2 MB → 413 del propio parser). Se pone DESPUÉS de comprobar el alcance de quien sube. */
export const imagenCruda = express.raw({ type: [...TIPOS_IMAGEN], limit: MAX_IMAGEN });

export interface ImagenVerificada { nombre: string; tipo_mime: TipoImagen; tamano: number; datos: Buffer }

/** Tipo declarado permitido (415), no vacía y con bytes que correspondan al tipo (422). El nombre sale de `X-Nombre-Archivo`. */
export function verificarImagen(req: Request): ImagenVerificada {
  const cuerpo: unknown = req.body;
  const declarado = req.is([...TIPOS_IMAGEN]) as TipoImagen | false | null;
  if (!declarado || !Buffer.isBuffer(cuerpo)) throw new HttpError(415, 'Tipo de archivo no permitido: sube una imagen JPG, PNG o WebP');
  if (cuerpo.length === 0) throw invalid('El archivo está vacío');
  if (cuerpo.length > MAX_IMAGEN) throw new HttpError(413, 'La imagen pesa más de 2 MB');
  if (detectarTipo(cuerpo) !== declarado) throw invalid('El contenido del archivo no corresponde a su tipo');
  return { nombre: sanearNombre(req.header('x-nombre-archivo'), declarado as TipoComprobante), tipo_mime: declarado, tamano: cuerpo.length, datos: cuerpo };
}

/** Responde la imagen en línea, sin que el navegador la interprete como otra cosa ni la guarde en cachés compartidas. */
export function enviarImagen(res: Response, img: { datos: Uint8Array; tipo_mime: string; nombre: string | null }) {
  res.set({
    'Content-Type': img.tipo_mime,
    'Content-Length': String(img.datos.length),
    'Content-Disposition': dispositionInline(img.nombre ?? 'imagen'),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Cache-Control': 'private, no-cache',
  });
  res.status(200).end(Buffer.from(img.datos));
}

/** Parámetro de versión de la URL de una imagen: cambia al reemplazarla, así el navegador no muestra la anterior. */
export const versionImagen = (d: Date | null | undefined) => (d ? String(d.getTime()) : '0');

/** Guarda (crea o reemplaza) la imagen de un condominio (cabecera) o de una empresa (logo). Devuelve la fila sin los bytes. */
export async function guardarImagenRecibo(dueno: { complejo_id: number } | { empresa_id: number }, img: ImagenVerificada, usuarioId: number) {
  const datos = { nombre: img.nombre, tipo_mime: img.tipo_mime, tamano: img.tamano, datos: img.datos, subido_por_id: usuarioId };
  return prisma.imagenRecibo.upsert({ where: dueno, create: { ...dueno, ...datos }, update: datos, select: { id: true, updated_at: true } });
}
