// Tramo PÚBLICO (sin sesión): el logo de una empresa para los correos. Sólo sirve `ImagenRecibo.empresa_id` (el logo de la empresa): nunca la cabecera de un
// condominio ni la foto del contómetro, que viven en la misma tabla pero con `complejo_id`/otro dueño. Hace falta la firma de la URL (`firma.ts`): sin ella,
// con otra empresa o con un id inexistente la respuesta es la misma 404 (no revela qué empresas tienen logo).
import { Router } from 'express';
import { prisma } from '../../db';
import { notFound } from '../../errors';
import { enviarImagen } from '../imagenes';
import { firmaDeLogoValida } from './firma';

export function marcaPublicaRouter() {
  const r = Router();
  r.get('/:id/logo', async (req, res) => {
    const id = /^\d{1,9}$/.test(req.params.id ?? '') ? Number(req.params.id) : 0;
    if (id < 1 || !firmaDeLogoValida(id, req.query.f)) throw notFound('Imagen');
    const img = await prisma.imagenRecibo.findUnique({ where: { empresa_id: id }, select: { datos: true, tipo_mime: true, nombre: true } });
    if (!img) throw notFound('Imagen');
    // El logo no es secreto: el cliente de correo (y su proxy de imágenes) puede guardarlo una hora. La `v` de la URL cambia al reemplazarlo.
    enviarImagen(res, img, 'public, max-age=3600');
  });
  return r;
}
