import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { diasEntre, hoyLima } from '../../lib/fechas';
import { enviarTelegram } from '../canales/telegram';
import { enviarCorreo, enviarWhatsapp, depsReales, type Canal, type DepsAvisos, type ResultadoEnvio } from './canales';
import { montoMoraTexto } from '../mora';
import { fechaTexto, periodoTexto, plantilla, solesTexto, type TipoAviso } from './plantillas';

/** Tras este número de fallos seguidos la notificación pasa a `error`. */
export const MAX_INTENTOS = 3;
/** Espera tras el 1.er y el 2.º fallo (minutos). */
export const ESPERA_MIN = [2, 10] as const;
const ARRENDAMIENTO_MIN = 5;
const MIN = 60_000;

/** Pendiente = sin pagar y sin comprobante en revisión (`en_revision`) ni `pagado`. */
const cargoPendiente: Prisma.ReciboConceptoUnidadWhereInput = { OR: [{ estado_pago: null }, { estado_pago: 'pendiente' }] };

export type RefAviso = { entidad: 'recibo'; id: number } | { entidad: 'cargo'; id: number } | { entidad: 'pago'; id: number } | { entidad: 'ia'; id: number };

interface Cargado {
  datos: Parameters<typeof plantilla>[1];
}

/** Reúne lo que lleva el mensaje. `null` si no hay nada que avisar a ese usuario (cargos ya pagados, recibo borrado…). */
async function cargarDatos(tipo: TipoAviso, usuario: { id: number; nombre: string }, ref: RefAviso, ahora: Date): Promise<Cargado | null> {
  // Avisos de la plataforma (estado de la IA): no hablan de cargos; el detalle viaja en `opts.motivo`.
  if (ref.entidad === 'ia') return { datos: { nombre: usuario.nombre, periodo: '', monto: '', vencimiento: '' } };
  if (ref.entidad === 'cargo' || ref.entidad === 'pago') {
    const cargoId = ref.entidad === 'cargo' ? ref.id : (await prisma.pago.findUnique({ where: { id: ref.id }, select: { recibo_concepto_unidad_id: true } }))?.recibo_concepto_unidad_id;
    if (cargoId == null) return null;
    const c = await prisma.reciboConceptoUnidad.findUnique({
      where: { id: cargoId },
      select: { monto: true, unidad: { select: { codigo: true, estructura: { select: { nombre: true } }, complejo: { select: { nombre: true } } } }, reciboConcepto: { select: { concepto: { select: { nombre: true } }, recibo: { select: { mes: true, anio: true, fecha_vencimiento: true } } } } },
    });
    const recibo = c?.reciboConcepto?.recibo;
    if (!c || !recibo) return null;
    return {
      datos: {
        nombre: usuario.nombre,
        periodo: periodoTexto(recibo.mes, recibo.anio),
        concepto: c.reciboConcepto?.concepto?.nombre,
        monto: solesTexto(c.monto),
        vencimiento: fechaTexto(recibo.fecha_vencimiento),
        condominio: c.unidad?.complejo?.nombre ?? null,
        departamentos: c.unidad ? [{ codigo: c.unidad.codigo, torre: c.unidad.estructura?.nombre ?? null }] : [],
      },
    };
  }
  const recibo = await prisma.recibo.findUnique({ where: { id: ref.id }, select: { mes: true, anio: true, fecha_vencimiento: true, complejo: { select: { nombre: true, mora_monto: true } } } });
  if (!recibo) return null;
  const soloPendientes = tipo === 'por_vencer' || tipo === 'vence_hoy' || tipo === 'vencido';
  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: {
      AND: [
        { reciboConcepto: { recibo_id: ref.id } },
        { unidad: { OR: [{ propietario_id: usuario.id }, { inquilino_id: usuario.id }] } },
        soloPendientes ? cargoPendiente : {},
      ],
    },
    select: { monto: true, unidad: { select: { id: true, codigo: true, estructura: { select: { nombre: true } } } }, reciboConcepto: { select: { concepto: { select: { nombre: true } } } } },
  });
  if (!cargos.length) return null;
  const total = cargos.reduce((s, c) => s.plus(c.monto), new Prisma.Decimal(0));
  // Total por departamento: cada torre tiene su recibo, pero un recibo viejo (o un vecino con dos departamentos) puede juntar varios; se dicen uno por uno.
  const porUnidad = new Map<number, { codigo: string; torre: string | null; monto: Prisma.Decimal }>();
  for (const c of cargos) {
    if (!c.unidad) continue;
    const x = porUnidad.get(c.unidad.id) ?? { codigo: c.unidad.codigo, torre: c.unidad.estructura?.nombre ?? null, monto: new Prisma.Decimal(0) };
    porUnidad.set(c.unidad.id, { ...x, monto: x.monto.plus(c.monto) });
  }
  const conceptos = [...new Set(cargos.map((c) => c.reciboConcepto?.concepto?.nombre).filter((n): n is string => !!n))];
  return {
    datos: {
      nombre: usuario.nombre,
      periodo: periodoTexto(recibo.mes, recibo.anio),
      concepto: conceptos.slice(0, 3).join(', ') + (conceptos.length > 3 ? '…' : ''),
      monto: solesTexto(total),
      vencimiento: fechaTexto(recibo.fecha_vencimiento),
      dias: diasEntre(hoyLima(ahora), recibo.fecha_vencimiento),
      // Los recordatorios avisan de la mora (si el condominio la cobra) para que el vecino suba su voucher a tiempo.
      ...((tipo === 'por_vencer' || tipo === 'vence_hoy') && recibo.complejo && new Prisma.Decimal(recibo.complejo.mora_monto).gt(0) ? { mora: montoMoraTexto(new Prisma.Decimal(recibo.complejo.mora_monto)) } : {}),
      condominio: recibo.complejo?.nombre ?? null,
      departamentos: [...porUnidad.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true })).map((x) => ({ codigo: x.codigo, torre: x.torre, monto: solesTexto(x.monto) })),
    },
  };
}

/** Celular del WhatsApp VERIFICADO de la persona (vínculo del bot vigente) o null. Tiene prioridad sobre `Usuario.telefono`, que nadie verificó. */
async function numeroVinculado(usuarioId: number): Promise<string | null> {
  const v = await prisma.canalVinculado.findFirst({ where: { usuario_id: usuarioId, canal: 'whatsapp', revocado_at: null }, select: { identificador: true } });
  return v?.identificador ?? null;
}

/** Chat de Telegram VERIFICADO de la persona (vínculo del bot vigente) o null. */
async function chatVinculado(usuarioId: number): Promise<string | null> {
  const v = await prisma.canalVinculado.findFirst({ where: { usuario_id: usuarioId, canal: 'telegram', revocado_at: null }, select: { identificador: true } });
  return v?.identificador ?? null;
}

/**
 * Encola un aviso para un usuario, respetando sus preferencias (`aviso_email`, `aviso_whatsapp`) y que tenga
 * correo / celular. Es idempotente: el mismo (usuario, canal, tipo, referencia) nunca se crea dos veces.
 *
 * `ref` dice de qué trata el aviso y de ahí salen los datos del mensaje:
 *  - `{ entidad: 'recibo', id }` → recibo emitido / por vencer / vencido (suma los cargos del usuario en ese recibo);
 *  - `{ entidad: 'cargo', id }`  → un cargo (`ReciboConceptoUnidad.id`);
 *  - `{ entidad: 'ia', id }`     → `ia_caida` / `ia_restablecida` (sólo superadmin; `id` distingue cada episodio; el detalle va en `opts.motivo`);
 *  - `{ entidad: 'pago', id }`   → `pago_validado` / `pago_rechazado` de ESE pago (los datos salen de su cargo; cada pago avisa una vez,
 *    aunque el mismo cargo se rechace, se vuelva a pagar y se rechace de nuevo).
 * `opts.motivo` es el motivo de un rechazo y va en el mensaje.
 *
 * Nunca envía en línea: la notificación queda `pendiente` y la procesa `procesarCola`. Devuelve cuántas creó.
 */
export async function encolarAviso(tipo: TipoAviso, usuarioId: number, ref: RefAviso, opts: { ahora?: Date; motivo?: string } = {}): Promise<number> {
  const ahora = opts.ahora ?? new Date();
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, nombre: true, email: true, telefono: true, aviso_email: true, aviso_whatsapp: true } });
  if (!u) return 0;
  const canales: (Canal | 'telegram')[] = [];
  if (u.aviso_email && u.email) canales.push('email');
  // Quien vinculó su WhatsApp (verificado) llega a ese número: ahí recibe el resultado del voucher que mandó por el bot aunque no haya activado
  // los avisos por WhatsApp; el resto de avisos sigue respetando su preferencia.
  const vinculado = await numeroVinculado(u.id);
  const resultadoDePago = tipo === 'pago_validado' || tipo === 'pago_rechazado';
  if ((u.aviso_whatsapp && (u.telefono?.trim() || vinculado)) || (vinculado && resultadoDePago)) canales.push('whatsapp');
  // Telegram: sólo el resultado del voucher, y sólo a quien vinculó su chat (no hay «preferencia» de Telegram: vincular es aceptarlo).
  if (resultadoDePago && (await chatVinculado(u.id))) canales.push('telegram');
  if (!canales.length) return 0;
  const cargado = await cargarDatos(tipo, u, ref, ahora);
  if (!cargado) return 0;
  const { asunto, cuerpo } = plantilla(tipo, opts.motivo ? { ...cargado.datos, motivo: opts.motivo.slice(0, 300) } : cargado.datos);
  const r = await prisma.notificacion.createMany({
    data: canales.map((canal) => ({ usuario_id: u.id, canal, tipo, asunto, cuerpo, estado: 'pendiente', programada_para: ahora, ref_entidad: ref.entidad, ref_id: ref.id })),
    skipDuplicates: true,
  });
  return r.count;
}

/** Al emitir un recibo: un aviso por usuario (propietario o inquilino de una unidad con cargo en ese recibo). */
export async function encolarReciboEmitido(reciboId: number, opts: { ahora?: Date } = {}): Promise<number> {
  const unidades = await prisma.unidad.findMany({
    where: { reciboConceptoUnidades: { some: { reciboConcepto: { recibo_id: reciboId } } } },
    select: { propietario_id: true, inquilino_id: true },
  });
  const usuarios = new Set<number>();
  for (const u of unidades) for (const id of [u.propietario_id, u.inquilino_id]) if (id != null) usuarios.add(id);
  let creadas = 0;
  for (const id of usuarios) creadas += await encolarAviso('recibo_emitido', id, { entidad: 'recibo', id: reciboId }, opts);
  return creadas;
}

/** Días antes del vencimiento en que sale el recordatorio `por_vencer` (el otro es `vence_hoy`, el día mismo). */
export const DIAS_ANTES = 2;
/** Cuántos días atrás se sigue avisando un vencido (por si el planificador estuvo caído). */
const DIAS_GRACIA_VENCIDO = 3;

/**
 * Los recordatorios de pago de cada recibo y unidad SIN voucher son exactamente dos: `por_vencer` (faltan 2 días) y `vence_hoy` (el día del
 * vencimiento), cada uno por correo y WhatsApp. Si el vecino ya subió su voucher (el cargo está `en_revision` o `pagado`) no se manda ninguno.
 * Además `vencido` (venció ayer o hasta 3 días atrás). «Hoy» y «faltan 2 días» son del calendario de Lima (`America/Lima`, sin horario de verano).
 * Repetir la llamada no duplica nada (una fila por usuario, canal, tipo y recibo). Un recibo emitido hoy no recibe recordatorios hoy: ya se avisó al emitirlo.
 */
export async function encolarRecordatorios(ahora: Date): Promise<number> {
  const hoy = hoyLima(ahora);
  const dia = 86_400_000;
  let creadas = 0;
  const delDia = (dias: number): Prisma.ReciboWhereInput => ({ fecha_vencimiento: { gte: new Date(hoy.getTime() + dias * dia), lt: new Date(hoy.getTime() + (dias + 1) * dia) }, fecha_emision: { lt: hoy } });
  const tandas: { tipo: TipoAviso; where: Prisma.ReciboWhereInput }[] = [
    { tipo: 'por_vencer', where: delDia(DIAS_ANTES) },
    { tipo: 'vence_hoy', where: delDia(0) },
    { tipo: 'vencido', where: { fecha_vencimiento: { gte: new Date(hoy.getTime() - DIAS_GRACIA_VENCIDO * dia), lt: hoy } } },
  ];
  for (const { tipo, where } of tandas) {
    const cargos = await prisma.reciboConceptoUnidad.findMany({
      where: { AND: [cargoPendiente, { reciboConcepto: { recibo: where } }] },
      select: { reciboConcepto: { select: { recibo_id: true } }, unidad: { select: { propietario_id: true, inquilino_id: true } } },
    });
    const pares = new Map<string, { usuario: number; recibo: number }>();
    for (const c of cargos) {
      const recibo = c.reciboConcepto?.recibo_id;
      if (recibo == null) continue;
      for (const usuario of [c.unidad?.propietario_id, c.unidad?.inquilino_id]) if (usuario != null) pares.set(`${usuario}:${recibo}`, { usuario, recibo });
    }
    if (!pares.size) continue;
    // Quien ya tiene este aviso para ese recibo se salta sin volver a armar el mensaje.
    const yaAvisados = await prisma.notificacion.findMany({
      where: { tipo, ref_entidad: 'recibo', ref_id: { in: [...new Set([...pares.values()].map((p) => p.recibo))] } },
      select: { usuario_id: true, ref_id: true },
    });
    const hechos = new Set(yaAvisados.map((n) => `${n.usuario_id}:${n.ref_id}`));
    for (const [clave, p] of pares) {
      if (hechos.has(clave)) continue;
      creadas += await encolarAviso(tipo, p.usuario, { entidad: 'recibo', id: p.recibo }, { ahora });
    }
  }
  return creadas;
}

function resultadoSinCanal(canal: string): ResultadoEnvio {
  return { resultado: 'omitida', motivo: `Canal desconocido: ${canal}`.slice(0, 80) };
}

/**
 * Resuelve la instancia de WhatsApp de la administradora responsable de la notificación.
 */
async function resolveInstance(n: { ref_entidad: string | null; ref_id: number | null }): Promise<string | null> {
  if (!n.ref_entidad || n.ref_id == null) return null;
  if (n.ref_entidad === 'recibo') {
    const r = await prisma.recibo.findUnique({ where: { id: n.ref_id }, select: { empresa: { select: { whatsapp_instance: true } } } });
    return r?.empresa?.whatsapp_instance ?? null;
  }
  if (n.ref_entidad === 'cargo') {
    const c = await prisma.reciboConceptoUnidad.findUnique({
      where: { id: n.ref_id },
      select: { reciboConcepto: { select: { recibo: { select: { empresa: { select: { whatsapp_instance: true } } } } } } }
    });
    return c?.reciboConcepto?.recibo?.empresa?.whatsapp_instance ?? null;
  }
  if (n.ref_entidad === 'pago') {
    const p = await prisma.pago.findUnique({
      where: { id: n.ref_id },
      select: { reciboConceptoUnidad: { select: { reciboConcepto: { select: { recibo: { select: { empresa: { select: { whatsapp_instance: true } } } } } } } } }
    });
    return p?.reciboConceptoUnidad?.reciboConcepto?.recibo?.empresa?.whatsapp_instance ?? null;
  }
  return null;
}

/**
 * Envía las `pendiente` con `programada_para <= ahora`. Cada una se «arrienda» antes de enviar (se corre su
 * `programada_para` unos minutos), así dos procesos no mandan el mismo aviso. Los fallos se reintentan con espera
 * creciente (`ESPERA_MIN`) hasta `MAX_INTENTOS`; después quedan en `error` con un motivo corto.
 */
export async function procesarCola(deps: DepsAvisos = depsReales(), limite = 50): Promise<{ enviadas: number; omitidas: number; fallos: number; errores: number }> {
  const ahora = deps.ahora();
  const resumen = { enviadas: 0, omitidas: 0, fallos: 0, errores: 0 };
  const pendientes = await prisma.notificacion.findMany({
    where: { estado: 'pendiente', programada_para: { lte: ahora } },
    orderBy: [{ programada_para: 'asc' }, { id: 'asc' }],
    take: limite,
    include: { usuario: { select: { email: true, telefono: true } } },
  });
  for (const n of pendientes) {
    const tomada = await prisma.notificacion.updateMany({
      where: { id: n.id, estado: 'pendiente', programada_para: n.programada_para },
      data: { programada_para: new Date(ahora.getTime() + ARRENDAMIENTO_MIN * MIN) },
    });
    if (tomada.count === 0) continue;

    let r: ResultadoEnvio;
    if (n.canal === 'email') {
      r = await enviarCorreo(deps, n.usuario.email, n.asunto, n.cuerpo);
    } else if (n.canal === 'whatsapp') {
      // La instancia es la de la administradora que emitió el recibo (no una global).
      r = await enviarWhatsapp(deps, await resolveInstance(n), (await numeroVinculado(n.usuario_id)) ?? n.usuario.telefono, n.cuerpo);
    } else if (n.canal === 'telegram') {
      r = await enviarTelegram(deps, await chatVinculado(n.usuario_id), n.cuerpo);
    } else {
      r = resultadoSinCanal(n.canal);
    }

    if (r.resultado === 'ok') {
      await prisma.notificacion.update({ where: { id: n.id }, data: { estado: 'enviada', enviada_at: deps.ahora(), intentos: n.intentos + 1, error: null } });
      resumen.enviadas++;
    } else if (r.resultado === 'omitida') {
      await prisma.notificacion.update({ where: { id: n.id }, data: { estado: 'omitida', error: r.motivo, programada_para: n.programada_para } });
      resumen.omitidas++;
    } else {
      const intentos = n.intentos + 1;
      if (intentos >= MAX_INTENTOS) {
        await prisma.notificacion.update({ where: { id: n.id }, data: { estado: 'error', intentos, error: r.motivo } });
        resumen.errores++;
      } else {
        const espera = ESPERA_MIN[intentos - 1] ?? ESPERA_MIN[ESPERA_MIN.length - 1];
        await prisma.notificacion.update({ where: { id: n.id }, data: { intentos, error: r.motivo, programada_para: new Date(deps.ahora().getTime() + espera * MIN) } });
        resumen.fallos++;
      }
    }
  }
  return resumen;
}
