// Hoja de reclamación del Libro de Reclamaciones virtual: lo que se valida al recibirla (Ley 29571 y DS 011-2011-PCM).
import { z } from 'zod';
import { emailSchema, telefonoSchema } from '../../validation';
import { textoLargo, textoLinea } from '../../lib/textoPublico';

export const TIPOS_DOCUMENTO = ['dni', 'ce', 'pasaporte', 'ruc'] as const;
export const TIPOS_RECLAMACION = ['reclamo', 'queja'] as const;
export const TIPOS_BIEN = ['producto', 'servicio'] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

/** Formato de cada documento: DNI 8 dígitos, RUC 11 dígitos, carné de extranjería y pasaporte alfanuméricos. */
const FORMATO_DOCUMENTO: Record<TipoDocumento, { re: RegExp; mensaje: string }> = {
  dni: { re: /^\d{8}$/, mensaje: 'El DNI tiene 8 dígitos' },
  ruc: { re: /^\d{11}$/, mensaje: 'El RUC tiene 11 dígitos' },
  ce: { re: /^[A-Za-z0-9]{6,12}$/, mensaje: 'El carné de extranjería tiene entre 6 y 12 letras o números' },
  pasaporte: { re: /^[A-Za-z0-9]{6,12}$/, mensaje: 'El pasaporte tiene entre 6 y 12 letras o números' },
};

const tipoDocumento = z.enum(TIPOS_DOCUMENTO, { error: 'Elige el tipo de documento' });
const numeroDocumento = z.string({ error: 'Debe ser un texto' }).trim().toUpperCase().max(20, 'Documento inválido');
const montoReclamado = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.union([z.number(), z.string()], { error: 'Monto inválido' }).transform((v) => String(v).trim()).pipe(z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Monto inválido (máx. 2 decimales)')).nullish(),
);

export const reclamacionSchema = z.object({
  // Consumidor
  nombre: textoLinea(160),
  tipo_documento: tipoDocumento,
  numero_documento: numeroDocumento,
  domicilio: textoLinea(255),
  correo: emailSchema,
  telefono: telefonoSchema,
  /** Si el consumidor es menor de edad, la hoja la presenta su padre, madre o apoderado y se piden sus datos. */
  menor_de_edad: z.boolean({ error: 'Responde sí o no' }).default(false),
  apoderado_nombre: z.preprocess((v) => (v === '' ? null : v), textoLinea(160).nullish()),
  apoderado_tipo_documento: z.preprocess((v) => (v === '' ? null : v), tipoDocumento.nullish()),
  apoderado_numero_documento: z.preprocess((v) => (v === '' ? null : v), numeroDocumento.nullish()),
  // Bien contratado
  bien_tipo: z.enum(TIPOS_BIEN, { error: 'Indica si es un producto o un servicio' }),
  bien_descripcion: textoLinea(300),
  monto_reclamado: montoReclamado,
  // Reclamación
  tipo: z.enum(TIPOS_RECLAMACION, { error: 'Elige reclamo o queja' }),
  detalle: textoLargo(3000, 10),
  pedido: textoLargo(2000, 5),
  acepta_respuesta_correo: z.literal(true, { error: 'Debes aceptar que la respuesta llegará a tu correo' }),
  /** Señuelo antiabuso (ver `llenoElSenuelo`). */
  sitio_web: z.string().max(200).optional(),
}).superRefine((d, ctx) => {
  const falla = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  const f = FORMATO_DOCUMENTO[d.tipo_documento];
  if (!f.re.test(d.numero_documento)) falla('numero_documento', f.mensaje);
  if (d.menor_de_edad) {
    if (!d.apoderado_nombre) falla('apoderado_nombre', 'Escribe el nombre de tu padre, madre o apoderado');
    if (!d.apoderado_tipo_documento) falla('apoderado_tipo_documento', 'Elige el tipo de documento');
    if (!d.apoderado_numero_documento) falla('apoderado_numero_documento', 'Escribe el número de documento');
    else if (d.apoderado_tipo_documento && !FORMATO_DOCUMENTO[d.apoderado_tipo_documento].re.test(d.apoderado_numero_documento)) falla('apoderado_numero_documento', FORMATO_DOCUMENTO[d.apoderado_tipo_documento].mensaje);
  }
});
export type DatosReclamacion = z.output<typeof reclamacionSchema>;
