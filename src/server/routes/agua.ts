/**
 * Datos del recibo de una torre que se cargan aparte del Excel de cargos: lecturas de agua por departamento (a mano o con un Excel/CSV), la foto
 * del contómetro y la fecha de corte del agua. Los hace la administración o la junta del block (alcance: `recibosDe` / `unidadesDe`).
 * Se monta en `/api/recibos`, antes del router de recibos.
 */
import { Prisma } from '@prisma/client';
import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { prisma } from '../db';
import { invalid, notFound } from '../errors';
import { INVALIDO, errorLectura, leerFactor, leerLectura, plantillaLecturas } from '../lib/agua';
import { currentUser } from '../middleware/auth';
import { aguaDelRecibo, filasDePlantilla, guardarLecturas, importarLecturas, type EntradaLectura } from '../services/agua';
import { enviarImagen, imagenCruda, verificarImagen } from '../services/imagenes';
import { fechaSchema, idSchema, parse, parseBody, parseId, z } from '../validation';
import { adminOJunta, reciboAccesible, recibosDe, unidadesDe } from './recibos';
import { complejoDeRecibo, exigirOperativo } from '../services/comercial/operativo';

export const aguaRouter = Router();

const idsUnidad = z.object({ id: idSchema, unidadId: idSchema });

// ---------- Lecturas ----------
const decimal = (nombre: string, leer: (v: unknown) => ReturnType<typeof leerLectura>) =>
  z.union([z.number(), z.string()], { error: `${nombre}: debe ser un número` }).transform((v, ctx) => {
    const n = leer(v);
    if (n == null || n === INVALIDO) {
      ctx.addIssue({ code: 'custom', message: `${nombre}: debe ser un número (ej. 1430.897)` });
      return z.NEVER;
    }
    return n;
  });

const lecturaSchema = z
  .strictObject({
    unidad_id: idSchema,
    fecha_anterior: fechaSchema,
    lectura_anterior: decimal('Lectura anterior', leerLectura),
    fecha_actual: fechaSchema,
    lectura_actual: decimal('Lectura actual', leerLectura),
    factor: decimal('Factor', leerFactor),
  })
  .superRefine((d, ctx) => {
    // Con un campo que no pasó su propia validación (fecha o número inválidos) las reglas cruzadas no tienen con qué comparar.
    if (!(d.fecha_anterior instanceof Date && d.fecha_actual instanceof Date && Prisma.Decimal.isDecimal(d.lectura_anterior) && Prisma.Decimal.isDecimal(d.lectura_actual) && Prisma.Decimal.isDecimal(d.factor))) return;
    const campos = errorLectura(d);
    if (campos) for (const [campo, message] of Object.entries(campos)) ctx.addIssue({ code: 'custom', path: [campo], message });
  });

const lecturasSchema = z.strictObject({ lecturas: z.array(lecturaSchema).min(1, 'Envía al menos una lectura').max(500, 'Máximo 500 lecturas por vez') });

/** Lecturas del recibo: una fila por departamento con la lectura guardada, la precarga de la anterior y el cruce con el agua del recibo. */
aguaRouter.get('/:id/agua', adminOJunta, async (req, res) => {
  const u = currentUser(req);
  res.json(await aguaDelRecibo(parseId(req), { reciboWhere: recibosDe(u), unidadWhere: unidadesDe(u) }));
});

/** Plantilla Excel con los departamentos del recibo y la lectura y fecha anteriores ya puestas. */
aguaRouter.get('/:id/agua/plantilla', adminOJunta, async (req, res) => {
  const u = currentUser(req);
  const filas = await filasDePlantilla(parseId(req), { reciboWhere: recibosDe(u), unidadWhere: unidadesDe(u) });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="lecturas-de-agua.xlsx"',
    'Cache-Control': 'private, no-store',
  });
  res.send(plantillaLecturas(filas));
});

/** Guarda lecturas (crea o reemplaza una por departamento). Lo que no cuadra se devuelve en `errores`; lo demás se guarda. */
aguaRouter.put('/:id/agua', adminOJunta, async (req, res) => {
  const u = currentUser(req);
  const id = parseId(req);
  const { lecturas } = parseBody(lecturasSchema, req);
  await reciboAccesible(req, id, true);
  await exigirOperativo(await complejoDeRecibo(id), u);
  const r = await guardarLecturas(id, lecturas as EntradaLectura[], { unidadWhere: unidadesDe(u), usuarioId: u.id });
  res.locals.entidad = 'lectura_agua';
  res.locals.entidadId = id;
  res.locals.auditDetalle = { recibo_id: id, guardadas: r.guardadas, rechazadas: r.errores.length };
  res.json(r);
});

const subirArchivo = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 4, fieldSize: 64, parts: 6 } });

/** El rol y el recibo se comprueban ANTES de recibir el archivo. */
const archivoDeLecturas: RequestHandler = async (req, res, next) => {
  await reciboAccesible(req, parseId(req), true);
  await exigirOperativo(await complejoDeRecibo(parseId(req)), currentUser(req));
  subirArchivo.single('archivo')(req, res, (err?: unknown) => {
    if (err instanceof multer.MulterError) {
      const grande = err.code === 'LIMIT_FILE_SIZE';
      return next(invalid(grande ? 'El archivo pesa más de 2 MB' : 'Archivo inválido', { archivo: grande ? 'Demasiado grande' : 'Archivo inválido' }));
    }
    next(err);
  });
};

/** Carga las lecturas desde un Excel o CSV (plantilla de `GET …/agua/plantilla`). `factor` (opcional) completa las filas que no lo traen. */
aguaRouter.post('/:id/agua/excel', adminOJunta, archivoDeLecturas, async (req, res) => {
  const u = currentUser(req);
  const id = parseId(req);
  if (!req.file) throw invalid('Datos inválidos: archivo es obligatorio', { archivo: 'Obligatorio' });
  const crudo = req.body?.factor;
  const factor = crudo === undefined || crudo === '' ? null : leerFactor(crudo);
  if (factor === INVALIDO || (factor != null && !factor.gt(0))) throw invalid('Datos inválidos: factor debe ser un número mayor que cero', { factor: 'Factor inválido' });
  const r = await importarLecturas(id, req.file.buffer, { unidadWhere: unidadesDe(u), usuarioId: u.id, factor });
  res.locals.entidad = 'lectura_agua';
  res.locals.entidadId = id;
  res.locals.accion = 'importar_lecturas';
  res.locals.auditDetalle = { recibo_id: id, filas: r.filas, guardadas: r.guardadas, rechazadas: r.errores.length };
  res.status(201).json(r);
});

/** Quita la lectura de un departamento (y su foto). */
aguaRouter.delete('/:id/agua/:unidadId', adminOJunta, async (req, res) => {
  const u = currentUser(req);
  const { id, unidadId } = parse(idsUnidad, req.params);
  await reciboAccesible(req, id, true);
  await exigirOperativo(await complejoDeRecibo(id), u);
  const unidad = await prisma.unidad.findFirst({ where: { AND: [{ id: unidadId }, unidadesDe(u)] }, select: { id: true } });
  const r = unidad ? await prisma.lecturaAgua.deleteMany({ where: { recibo_id: id, unidad_id: unidadId } }) : { count: 0 };
  if (r.count === 0) throw notFound('Lectura');
  res.locals.entidad = 'lectura_agua';
  res.locals.entidadId = id;
  res.locals.auditDetalle = { recibo_id: id, unidad_id: unidadId };
  res.status(204).end();
});

// ---------- Foto del contómetro ----------
/** Ubica la lectura dentro del alcance de quien llama ANTES de leer el cuerpo (una imagen cruda no se recibe para un ajeno). */
const cargarLectura: RequestHandler = async (req, res, next) => {
  const u = currentUser(req);
  const { id, unidadId } = parse(idsUnidad, req.params);
  await reciboAccesible(req, id, req.method !== 'GET');
  if (req.method !== 'GET') await exigirOperativo(await complejoDeRecibo(id), u);
  const unidad = await prisma.unidad.findFirst({ where: { AND: [{ id: unidadId }, unidadesDe(u)] }, select: { id: true } });
  const lectura = unidad ? await prisma.lecturaAgua.findUnique({ where: { unidad_id_recibo_id: { unidad_id: unidadId, recibo_id: id } }, select: { id: true } }) : null;
  if (!lectura) throw notFound('Lectura de agua: guarda primero la lectura de ese departamento');
  res.locals.lecturaId = lectura.id;
  next();
};

aguaRouter.get('/:id/agua/:unidadId/foto', adminOJunta, cargarLectura, async (_req, res) => {
  const l = await prisma.lecturaAgua.findUnique({ where: { id: res.locals.lecturaId as number }, select: { foto_datos: true, foto_tipo_mime: true, foto_nombre: true } });
  if (!l?.foto_datos || !l.foto_tipo_mime) throw notFound('Foto');
  enviarImagen(res, { datos: l.foto_datos, tipo_mime: l.foto_tipo_mime, nombre: l.foto_nombre });
});

aguaRouter.put('/:id/agua/:unidadId/foto', adminOJunta, cargarLectura, imagenCruda, async (req, res) => {
  const img = verificarImagen(req);
  const l = await prisma.lecturaAgua.update({ where: { id: res.locals.lecturaId as number }, data: { foto_nombre: img.nombre, foto_tipo_mime: img.tipo_mime, foto_datos: img.datos }, select: { id: true, unidad_id: true, recibo_id: true } });
  res.locals.entidad = 'lectura_agua';
  res.locals.entidadId = l.id;
  res.locals.accion = 'subir_foto_contometro';
  res.locals.auditDetalle = { recibo_id: l.recibo_id, unidad_id: l.unidad_id, tipo_mime: img.tipo_mime, tamano: img.tamano }; // nunca el contenido
  res.json({ ok: true });
});

aguaRouter.delete('/:id/agua/:unidadId/foto', adminOJunta, cargarLectura, async (_req, res) => {
  const l = await prisma.lecturaAgua.update({ where: { id: res.locals.lecturaId as number }, data: { foto_nombre: null, foto_tipo_mime: null, foto_datos: null }, select: { id: true, unidad_id: true, recibo_id: true } });
  res.locals.entidad = 'lectura_agua';
  res.locals.entidadId = l.id;
  res.locals.accion = 'quitar_foto_contometro';
  res.locals.auditDetalle = { recibo_id: l.recibo_id, unidad_id: l.unidad_id };
  res.status(204).end();
});

// ---------- Fecha de corte del agua ----------
const datosSchema = z.strictObject({ fecha_corte_agua: z.preprocess((v) => (v === '' ? null : v), fechaSchema.nullable()) });

/** Fecha de corte del agua del recibo (opcional; `null` la quita). La administración y la junta de ese block. */
aguaRouter.put('/:id/datos', adminOJunta, async (req, res) => {
  const id = parseId(req);
  const { fecha_corte_agua } = parseBody(datosSchema, req);
  await reciboAccesible(req, id, true);
  await exigirOperativo(await complejoDeRecibo(id), currentUser(req));
  const r = await prisma.recibo.update({ where: { id }, data: { fecha_corte_agua }, select: { id: true, fecha_corte_agua: true } });
  res.locals.entidad = 'recibo';
  res.locals.entidadId = id;
  res.locals.accion = 'fecha_corte_agua';
  res.locals.auditDetalle = { recibo_id: id, fecha_corte_agua: r.fecha_corte_agua?.toISOString().slice(0, 10) ?? null };
  res.json(r);
});
