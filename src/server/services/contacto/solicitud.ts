// Formulario /contacto (sin sesión): se guarda SIEMPRE en `SolicitudContacto` y se avisa a Torre por correo. Si el correo falla (Resend caído,
// sin llave en local), el mensaje igual queda guardado y el superadmin lo ve en su bandeja.
import type { SolicitudContacto } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db';
import { esc } from '../../seo/escapar';
import { emailSchema, telefonoSchema } from '../../validation';
import { textoLargo, textoLinea, textoLineaOpcional } from '../../lib/textoPublico';
import { correoA, obtenerConfiguracion } from '../comercial/configuracion';

export const MENSAJE_CONTACTO = 'Recibimos tu mensaje. Te escribimos en menos de 1 día hábil.';
export const TEMAS_CONTACTO = ['consulta', 'demo'] as const;

export const contactoSchema = z.object({
  nombre: textoLinea(120),
  correo: emailSchema,
  celular: telefonoSchema,
  condominio: textoLineaOpcional(120),
  unidades: z.preprocess((v) => (v === '' ? null : v), z.number({ error: 'Debe ser un número' }).int('Debe ser un entero').min(1, 'Mínimo 1').max(100_000, 'Máximo 100 000').nullish()),
  varios_condominios: z.boolean({ error: 'Responde sí o no' }).default(false),
  tema: z.enum(TEMAS_CONTACTO, { error: 'Tema inválido' }).default('consulta'),
  mensaje: textoLargo(2000, 5),
  /** Señuelo antiabuso (ver `llenoElSenuelo`). */
  sitio_web: z.string().max(200).optional(),
});
export type DatosContacto = z.output<typeof contactoSchema>;

export interface OrigenPeticion { ip: string | null; user_agent: string | null }

const unaLinea = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Cuerpo del aviso a Torre, en texto plano. */
export function textoAviso(s: Pick<SolicitudContacto, 'nombre' | 'correo' | 'celular' | 'condominio' | 'unidades' | 'varios_condominios' | 'tema' | 'mensaje'>): string {
  return [
    s.tema === 'demo' ? 'Pidió una demo de Torre.' : 'Escribió desde /contacto.',
    '',
    `Nombre: ${s.nombre}`,
    `Correo: ${s.correo}`,
    `Celular: ${s.celular ?? 'no indicó'}`,
    `Condominio: ${s.condominio ?? 'no indicó'}`,
    `Departamentos: ${s.unidades ?? 'no indicó'}`,
    `¿Administra varios condominios?: ${s.varios_condominios ? 'sí' : 'no'}`,
    '',
    'Mensaje:',
    s.mensaje,
    '',
    'Respóndele directo a su correo o celular. También lo ves en Superadmin › Contactos.',
  ].join('\n');
}

/** El mismo aviso con HTML simple: todo dato del visitante va escapado. */
export function htmlAviso(s: Parameters<typeof textoAviso>[0]): string {
  const fila = (k: string, v: string) => `<tr><td style="padding:2px 12px 2px 0;color:#555">${esc(k)}</td><td style="padding:2px 0"><strong>${esc(v)}</strong></td></tr>`;
  return `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">
<p>${s.tema === 'demo' ? 'Pidió una demo de Torre.' : 'Escribió desde /contacto.'}</p>
<table role="presentation" style="border-collapse:collapse">${[
    fila('Nombre', s.nombre), fila('Correo', s.correo), fila('Celular', s.celular ?? 'no indicó'), fila('Condominio', s.condominio ?? 'no indicó'),
    fila('Departamentos', s.unidades == null ? 'no indicó' : String(s.unidades)), fila('¿Administra varios condominios?', s.varios_condominios ? 'sí' : 'no'),
  ].join('')}</table>
<p style="margin-top:12px;color:#555">Mensaje:</p>
<p style="white-space:pre-wrap;margin:0">${esc(s.mensaje)}</p>
<p style="margin-top:16px;color:#555">Respóndele directo a su correo o celular. También lo ves en Superadmin › Contactos.</p>
</div>`;
}

/** Guarda el mensaje y avisa a Torre. Devuelve la fila guardada. */
export async function registrarContacto(d: DatosContacto, origen: OrigenPeticion): Promise<SolicitudContacto> {
  const fila = await prisma.solicitudContacto.create({
    data: {
      nombre: d.nombre, correo: d.correo, celular: d.celular ?? null, condominio: d.condominio ?? null, unidades: d.unidades ?? null,
      varios_condominios: d.varios_condominios, tema: d.tema, mensaje: d.mensaje,
      ip: origen.ip?.slice(0, 64) ?? null, user_agent: origen.user_agent?.slice(0, 300) ?? null,
    },
  });
  const cfg = await obtenerConfiguracion();
  const destino = cfg.legal_correo?.trim() || cfg.correo_superadmin?.trim() || null;
  const asunto = unaLinea(`${d.tema === 'demo' ? 'Solicitud de demo' : 'Mensaje de contacto'} en Torre: ${d.nombre}`);
  let enviado = false;
  try {
    const r = await correoA(destino, asunto, textoAviso(fila), undefined, htmlAviso(fila));
    enviado = r.resultado === 'ok';
  } catch { /* el mensaje ya está guardado */ }
  if (enviado) await prisma.solicitudContacto.update({ where: { id: fila.id }, data: { aviso_enviado: true }, select: { id: true } });
  return { ...fila, aviso_enviado: enviado };
}
