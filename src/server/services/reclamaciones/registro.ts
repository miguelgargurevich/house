// Libro de Reclamaciones virtual (Ley 29571, Código de Protección y Defensa del Consumidor, y DS 011-2011-PCM): registra la hoja, le da un número
// correlativo único por año (2026-000001), calcula el plazo de respuesta (15 días hábiles), manda copia al consumidor y avisa a Torre.
// El registro es lo que importa: si un correo falla, la hoja ya quedó guardada (y se ve en Superadmin › Contactos) y la constancia sale igual en pantalla.
import { Prisma, type Reclamacion } from '@prisma/client';
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import { hoyEn } from '../../lib/fechas';
import { esc } from '../../seo/escapar';
import { correoA, obtenerConfiguracion } from '../comercial/configuracion';
import type { OrigenPeticion } from '../contacto/solicitud';
import type { DatosReclamacion } from './esquema';
import { PLAZO_DIAS_HABILES, fechaLimite, formatoCorrelativo } from './plazo';

/** El proveedor es de Lima: el «día» de la hoja y su correlativo anual son los de la hora de Lima (no los de UTC). */
export const ZONA_LIBRO = 'America/Lima';

export const MENSAJE_LIBRO_NO_DISPONIBLE = 'El Libro de Reclamaciones virtual no está disponible por ahora. Escríbenos por correo y registraremos tu reclamo.';
export const NOTA_VIA_INDECOPI = 'La formulación del reclamo no impide acudir a otras vías de solución de controversias ni es requisito previo para interponer una denuncia ante el INDECOPI.';
export const DEFINICION_RECLAMO = 'Disconformidad relacionada con los productos o servicios.';
export const DEFINICION_QUEJA = 'Disconformidad no relacionada con los productos o servicios, o malestar o descontento respecto a la atención al público.';
const ETIQUETA_DOC: Record<string, string> = { dni: 'DNI', ce: 'Carné de extranjería', pasaporte: 'Pasaporte', ruc: 'RUC' };
const ETIQUETA_TIPO: Record<string, string> = { reclamo: 'Reclamo', queja: 'Queja' };

const dia = (d: Date) => d.toISOString().slice(0, 10);
/** `2026-11-04` → `04/11/2026`. */
export const fechaLarga = (d: Date): string => { const [a, m, x] = dia(d).split('-'); return `${x}/${m}/${a}`; };

/** Lo que se le muestra al consumidor al registrar (la constancia) y lo que lleva su copia por correo. */
export interface Constancia {
  correlativo: string;
  fecha: string;
  fecha_limite: string;
  plazo_dias_habiles: number;
  tipo: string;
  proveedor: { razon_social: string; ruc: string; domicilio: string };
  consumidor: { nombre: string; tipo_documento: string; numero_documento: string; domicilio: string; correo: string; telefono: string | null; menor_de_edad: boolean; apoderado_nombre: string | null; apoderado_tipo_documento: string | null; apoderado_numero_documento: string | null };
  bien: { tipo: string; descripcion: string; monto_reclamado: string | null };
  detalle: string;
  pedido: string;
  mensaje: string;
}

export function constanciaDe(r: Reclamacion): Constancia {
  return {
    correlativo: r.correlativo,
    fecha: dia(hoyEn(ZONA_LIBRO, r.created_at)),
    fecha_limite: dia(r.fecha_limite),
    plazo_dias_habiles: PLAZO_DIAS_HABILES,
    tipo: r.tipo,
    proveedor: { razon_social: r.proveedor_razon_social, ruc: r.proveedor_ruc, domicilio: r.proveedor_domicilio },
    consumidor: { nombre: r.consumidor_nombre, tipo_documento: r.consumidor_doc_tipo, numero_documento: r.consumidor_doc_numero, domicilio: r.consumidor_domicilio, correo: r.consumidor_correo, telefono: r.consumidor_telefono, menor_de_edad: r.menor_de_edad, apoderado_nombre: r.apoderado_nombre, apoderado_tipo_documento: r.apoderado_doc_tipo, apoderado_numero_documento: r.apoderado_doc_numero },
    bien: { tipo: r.bien_tipo, descripcion: r.bien_descripcion, monto_reclamado: r.monto_reclamado?.toFixed(2) ?? null },
    detalle: r.detalle,
    pedido: r.pedido,
    mensaje: `Registramos tu ${r.tipo} con el número ${r.correlativo}. Te responderemos a ${r.consumidor_correo} a más tardar el ${fechaLarga(r.fecha_limite)}.`,
  };
}

const articulo = (tipo: string) => (tipo === 'queja' ? 'una' : 'un');

/** Las líneas de la hoja, en el mismo orden que la hoja de reclamación oficial. */
function lineasHoja(c: Constancia): [string, string][] {
  const cons = c.consumidor;
  return [
    ['Hoja de reclamación N.º', c.correlativo],
    ['Fecha', fechaLarga(new Date(`${c.fecha}T00:00:00Z`))],
    ['Proveedor', c.proveedor.razon_social],
    ['RUC del proveedor', c.proveedor.ruc],
    ['Domicilio del proveedor', c.proveedor.domicilio],
    ['Consumidor', cons.nombre],
    ['Documento', `${ETIQUETA_DOC[cons.tipo_documento] ?? cons.tipo_documento} ${cons.numero_documento}`],
    ['Domicilio', cons.domicilio],
    ['Correo', cons.correo],
    ['Teléfono', cons.telefono ?? 'no indicó'],
    ...(cons.menor_de_edad ? ([['Padre, madre o apoderado', `${cons.apoderado_nombre} (${ETIQUETA_DOC[cons.apoderado_tipo_documento ?? ''] ?? ''} ${cons.apoderado_numero_documento})`]] as [string, string][]) : []),
    ['Bien contratado', `${c.bien.tipo === 'producto' ? 'Producto' : 'Servicio'}: ${c.bien.descripcion}`],
    ['Monto reclamado', c.bien.monto_reclamado ? `S/ ${c.bien.monto_reclamado}` : 'no indicó'],
    ['Tipo', `${ETIQUETA_TIPO[c.tipo] ?? c.tipo}`],
    ['Detalle', c.detalle],
    ['Pedido del consumidor', c.pedido],
  ];
}

export function textoCopia(c: Constancia): string {
  return [
    `Hola ${c.consumidor.nombre},`,
    '',
    `Registraste en el Libro de Reclamaciones de Torre ${articulo(c.tipo)} ${c.tipo} con el número ${c.correlativo}. Esta es tu constancia:`,
    '',
    ...lineasHoja(c).map(([k, v]) => `${k}: ${v}`),
    '',
    `Te responderemos a este correo (${c.consumidor.correo}) a más tardar el ${fechaLarga(new Date(`${c.fecha_limite}T00:00:00Z`))}: ${PLAZO_DIAS_HABILES} días hábiles desde el registro.`,
    '',
    NOTA_VIA_INDECOPI,
  ].join('\n');
}

export function htmlCopia(c: Constancia): string {
  const filas = lineasHoja(c).map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:#555;vertical-align:top">${esc(k)}</td><td style="padding:3px 0;white-space:pre-wrap">${esc(v)}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">
<p>Hola ${esc(c.consumidor.nombre)},</p>
<p>Registraste en el Libro de Reclamaciones de Torre ${articulo(c.tipo)} ${esc(c.tipo)} con el número <strong>${esc(c.correlativo)}</strong>. Esta es tu constancia:</p>
<table role="presentation" style="border-collapse:collapse">${filas}</table>
<p>Te responderemos a este correo (${esc(c.consumidor.correo)}) a más tardar el <strong>${esc(fechaLarga(new Date(`${c.fecha_limite}T00:00:00Z`)))}</strong>: ${PLAZO_DIAS_HABILES} días hábiles desde el registro.</p>
<p style="color:#555">${esc(NOTA_VIA_INDECOPI)}</p>
</div>`;
}

/** Número que sigue en el año. El candado por año (de la transacción) hace que dos hojas simultáneas no tomen el mismo; el índice único `(anio, numero)` es la segunda barrera. */
async function siguienteNumero(tx: Prisma.TransactionClient, anio: number): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${5_100_000 + anio})`;
  const { _max } = await tx.reclamacion.aggregate({ where: { anio }, _max: { numero: true } });
  return (_max.numero ?? 0) + 1;
}

/** Registra la hoja. `ahora` sólo se cambia en las pruebas (fines de semana, cambio de año). */
export async function registrarReclamacion(d: DatosReclamacion, origen: OrigenPeticion, ahora: Date = new Date()): Promise<Constancia> {
  const cfg = await obtenerConfiguracion();
  const razon = cfg.legal_razon_social?.trim(); const ruc = cfg.legal_ruc?.trim(); const domicilio = cfg.legal_domicilio?.trim();
  // Sin los datos del proveedor la hoja no sería válida: no se registra nada a medias.
  if (!razon || !ruc || !domicilio) throw new HttpError(503, MENSAJE_LIBRO_NO_DISPONIBLE);

  const hoy = hoyEn(ZONA_LIBRO, ahora);
  const anio = hoy.getUTCFullYear();
  const fila = await prisma.$transaction(async (tx) => {
    const numero = await siguienteNumero(tx, anio);
    return tx.reclamacion.create({
      data: {
        anio, numero, correlativo: formatoCorrelativo(anio, numero),
        proveedor_razon_social: razon, proveedor_ruc: ruc, proveedor_domicilio: domicilio,
        consumidor_nombre: d.nombre, consumidor_doc_tipo: d.tipo_documento, consumidor_doc_numero: d.numero_documento, consumidor_domicilio: d.domicilio,
        consumidor_correo: d.correo, consumidor_telefono: d.telefono ?? null,
        menor_de_edad: d.menor_de_edad,
        apoderado_nombre: d.menor_de_edad ? d.apoderado_nombre ?? null : null,
        apoderado_doc_tipo: d.menor_de_edad ? d.apoderado_tipo_documento ?? null : null,
        apoderado_doc_numero: d.menor_de_edad ? d.apoderado_numero_documento ?? null : null,
        bien_tipo: d.bien_tipo, bien_descripcion: d.bien_descripcion, monto_reclamado: d.monto_reclamado ?? null,
        tipo: d.tipo, detalle: d.detalle, pedido: d.pedido, acepta_respuesta_correo: d.acepta_respuesta_correo,
        ip: origen.ip?.slice(0, 64) ?? null, user_agent: origen.user_agent?.slice(0, 300) ?? null,
        fecha_limite: fechaLimite(hoy), created_at: ahora,
      },
    });
  });

  const constancia = constanciaDe(fila);
  let copia = false; let aviso = false;
  try { copia = (await correoA(d.correo, `Constancia de tu ${d.tipo} ${fila.correlativo}: Libro de Reclamaciones de Torre`, textoCopia(constancia), undefined, htmlCopia(constancia))).resultado === 'ok'; } catch { /* la hoja ya quedó guardada */ }
  const destino = cfg.legal_correo?.trim() || cfg.correo_superadmin?.trim() || null;
  try {
    const cuerpo = `Nuevo registro en el Libro de Reclamaciones (${d.tipo}): ${fila.correlativo}.\nResponder antes del ${fechaLarga(fila.fecha_limite)} (${PLAZO_DIAS_HABILES} días hábiles).\n\n${textoCopia(constancia)}`;
    aviso = (await correoA(destino, `${ETIQUETA_TIPO[d.tipo]} ${fila.correlativo} en el Libro de Reclamaciones de Torre`, cuerpo, undefined, `<p><strong>Nuevo registro (${esc(d.tipo)}) ${esc(fila.correlativo)}.</strong> Responder antes del ${esc(fechaLarga(fila.fecha_limite))} (${PLAZO_DIAS_HABILES} días hábiles).</p>${htmlCopia(constancia)}`)).resultado === 'ok';
  } catch { /* idem */ }
  if (copia || aviso) await prisma.reclamacion.update({ where: { id: fila.id }, data: { copia_consumidor_enviada: copia, aviso_enviado: aviso }, select: { id: true } });
  return constancia;
}
