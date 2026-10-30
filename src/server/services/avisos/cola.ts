import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { ZONA_POR_DEFECTO } from '../../../lib/paises';
import { diasEntre, hoyEn } from '../../lib/fechas';
import { reciboSegunZona, relojDeCondominios } from '../../lib/zonas';
import { enviarTelegram } from '../canales/telegram';
import { MOTIVO_TOPE_WHATSAPP, reservarConsumo } from '../comercial/consumo';
import { enviarCorreo, enviarWhatsapp, depsReales, type Canal, type DepsAvisos, type ResultadoEnvio } from './canales';
import { montoDeMoraAplicable, montoMoraTexto } from '../mora';
import { moduloActivo } from '../comercial/modulos';
import { dineroTexto, fechaTexto, periodoTexto, plantilla, type TipoAviso } from './plantillas';
import { correoSinBuzon } from '../invitaciones';
import { aportesPendientes, cierrePendiente } from '../cierres/pendientes';

/** Tras este número de fallos seguidos la notificación pasa a `error`. */
export const MAX_INTENTOS = 3;
/** Espera tras el 1.er y el 2.º fallo (minutos). */
export const ESPERA_MIN = [2, 10] as const;
const ARRENDAMIENTO_MIN = 5;
const MIN = 60_000;

/** Pendiente = sin pagar y sin comprobante en revisión (`en_revision`) ni `pagado`. */
const cargoPendiente: Prisma.ReciboConceptoUnidadWhereInput = { OR: [{ estado_pago: null }, { estado_pago: 'pendiente' }] };

export type RefAviso = { entidad: 'recibo'; id: number } | { entidad: 'cargo'; id: number } | { entidad: 'pago'; id: number } | { entidad: 'ia'; id: number } | { entidad: 'comunicado'; id: number } | { entidad: `cierre:${string}`; id: number } | { entidad: `cierre-central:${string}`; id: number };

interface Cargado {
  datos: Parameters<typeof plantilla>[1];
}

/** Reúne lo que lleva el mensaje. `null` si no hay nada que avisar a ese usuario (cargos ya pagados, recibo borrado…). */
async function cargarDatos(tipo: TipoAviso, usuario: { id: number; nombre: string }, ref: RefAviso, ahora: Date): Promise<Cargado | null> {
  // Avisos de la plataforma (estado de la IA): no hablan de cargos; el detalle viaja en `opts.motivo`.
  if (ref.entidad === 'ia') return { datos: { nombre: usuario.nombre, periodo: '', monto: '', vencimiento: '' } };
  // Comunicado: el título es el asunto y el texto va tal cual; lo firma el condominio.
  if (ref.entidad === 'comunicado') {
    const c = await prisma.comunicado.findUnique({ where: { id: ref.id }, select: { titulo: true, cuerpo: true, archivado_at: true, complejo: { select: { nombre: true } } } });
    if (!c || c.archivado_at) return null;
    return { datos: { nombre: usuario.nombre, periodo: '', monto: '', vencimiento: '', titulo: c.titulo, texto: c.cuerpo, condominio: c.complejo?.nombre ?? null } };
  }
  // Cierre de la Junta central (`cierre-central:<año>-<mes>`, id = condominio): los blocks que aún no aportan.
  if (ref.entidad.startsWith('cierre-central:')) {
    const [anio, mes] = ref.entidad.slice('cierre-central:'.length).split('-').map(Number);
    const p = anio && mes ? await aportesPendientes(ref.id, anio, mes) : null;
    if (!p) return null;
    return { datos: { nombre: usuario.nombre, periodo: p.periodo, monto: '', vencimiento: '', concepto: p.blocks.join(', '), central: true, condominio: p.condominio } };
  }
  // Cierre del mes de un block (`cierre:<año>-<mes>`, id = block): lo que le falta registrar a su junta.
  if (ref.entidad.startsWith('cierre:')) {
    const [anio, mes] = ref.entidad.slice('cierre:'.length).split('-').map(Number);
    const p = anio && mes ? await cierrePendiente(ref.id, anio, mes) : null;
    if (!p) return null;
    return { datos: { nombre: usuario.nombre, periodo: p.periodo, monto: '', vencimiento: '', concepto: p.lineas.join(', '), bloque: p.bloque, condominio: p.condominio } };
  }
  if (ref.entidad === 'cargo' || ref.entidad === 'pago') {
    const cargoId = ref.entidad === 'cargo' ? ref.id : (await prisma.pago.findUnique({ where: { id: ref.id }, select: { recibo_concepto_unidad_id: true } }))?.recibo_concepto_unidad_id;
    if (cargoId == null) return null;
    const c = await prisma.reciboConceptoUnidad.findUnique({
      where: { id: cargoId },
      select: { monto: true, unidad: { select: { codigo: true, estructura: { select: { nombre: true } }, complejo: { select: { nombre: true, moneda: true } } } }, reciboConcepto: { select: { concepto: { select: { nombre: true } }, recibo: { select: { mes: true, anio: true, fecha_vencimiento: true } } } } },
    });
    const recibo = c?.reciboConcepto?.recibo;
    if (!c || !recibo) return null;
    return {
      datos: {
        nombre: usuario.nombre,
        periodo: periodoTexto(recibo.mes, recibo.anio),
        concepto: c.reciboConcepto?.concepto?.nombre,
        monto: dineroTexto(c.monto, c.unidad?.complejo?.moneda),
        vencimiento: fechaTexto(recibo.fecha_vencimiento),
        condominio: c.unidad?.complejo?.nombre ?? null,
        departamentos: c.unidad ? [{ codigo: c.unidad.codigo, torre: c.unidad.estructura?.nombre ?? null }] : [],
      },
    };
  }
  const recibo = await prisma.recibo.findUnique({ where: { id: ref.id }, select: { mes: true, anio: true, fecha_vencimiento: true, complejo: { select: { id: true, nombre: true, moneda: true, mora_monto: true, zona_horaria: true } } } });
  if (!recibo) return null;
  // Sin mora automática (plan Gratis) el recordatorio no la promete.
  const moraMonto = recibo.complejo ? await montoDeMoraAplicable(recibo.complejo.id, recibo.complejo.mora_monto) : new Prisma.Decimal(0);
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
      monto: dineroTexto(total, recibo.complejo?.moneda),
      vencimiento: fechaTexto(recibo.fecha_vencimiento),
      dias: diasEntre(hoyEn(recibo.complejo?.zona_horaria ?? ZONA_POR_DEFECTO, ahora), recibo.fecha_vencimiento), // los días que faltan, contados en el condominio
      // Los recordatorios avisan de la mora (si el condominio la cobra) para que el vecino suba su voucher a tiempo.
      ...((tipo === 'por_vencer' || tipo === 'vence_hoy') && moraMonto.gt(0) ? { mora: montoMoraTexto(moraMonto, recibo.complejo?.moneda) } : {}),
      condominio: recibo.complejo?.nombre ?? null,
      departamentos: [...porUnidad.values()].sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true })).map((x) => ({ codigo: x.codigo, torre: x.torre, monto: dineroTexto(x.monto, recibo.complejo?.moneda) })),
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
 * Por qué canales le llega un aviso a la persona: correo si lo acepta y tiene uno real (un `.invalid` no tiene buzón; no es canal),
 * WhatsApp si lo acepta y tiene celular o un número vinculado, y Telegram sólo para el resultado de un voucher. Lo usan el envío y la vista previa.
 */
async function canalesDe(tipo: TipoAviso, u: { id: number; email: string | null; telefono: string | null; aviso_email: boolean; aviso_whatsapp: boolean }): Promise<(Canal | 'telegram')[]> {
  const canales: (Canal | 'telegram')[] = [];
  if (u.aviso_email && u.email && !correoSinBuzon(u.email)) canales.push('email');
  // Quien vinculó su WhatsApp (verificado) llega a ese número: ahí recibe el resultado del voucher que mandó por el bot aunque no haya activado
  // los avisos por WhatsApp; el resto de avisos sigue respetando su preferencia.
  const vinculado = await numeroVinculado(u.id);
  const resultadoDePago = tipo === 'pago_validado' || tipo === 'pago_rechazado';
  if ((u.aviso_whatsapp && (u.telefono?.trim() || vinculado)) || (vinculado && resultadoDePago)) canales.push('whatsapp');
  // Telegram: sólo el resultado del voucher, y sólo a quien vinculó su chat (no hay «preferencia» de Telegram: vincular es aceptarlo).
  if (resultadoDePago && (await chatVinculado(u.id))) canales.push('telegram');
  return canales;
}

/**
 * Encola un aviso para un usuario, respetando sus preferencias (`aviso_email`, `aviso_whatsapp`) y que tenga
 * correo / celular. Es idempotente: el mismo (usuario, canal, tipo, referencia) nunca se crea dos veces.
 *
 * `ref` dice de qué trata el aviso y de ahí salen los datos del mensaje:
 *  - `{ entidad: 'recibo', id }` → recibo emitido / por vencer / vencido (suma los cargos del usuario en ese recibo);
 *  - `{ entidad: 'cargo', id }`  → un cargo (`ReciboConceptoUnidad.id`);
 *  - `{ entidad: 'ia', id }`     → `ia_caida` / `ia_restablecida` (sólo superadmin; `id` distingue cada episodio; el detalle va en `opts.motivo`);
 *  - `{ entidad: 'comunicado', id }` → `comunicado` (el título y el texto del comunicado; se avisa una vez por persona y canal aunque se edite);
 *  - `{ entidad: 'pago', id }`   → `pago_validado` / `pago_rechazado` de ESE pago (los datos salen de su cargo; cada pago avisa una vez,
 *    aunque el mismo cargo se rechace, se vuelva a pagar y se rechace de nuevo).
 * `opts.motivo` es el motivo de un rechazo y va en el mensaje. `opts.canales` limita los canales (por defecto, los que la persona aceptó).
 *
 * Nunca envía en línea: la notificación queda `pendiente` y la procesa `procesarCola`. Devuelve cuántas creó.
 */
export async function encolarAviso(tipo: TipoAviso, usuarioId: number, ref: RefAviso, opts: { ahora?: Date; motivo?: string; canales?: readonly Canal[] } = {}): Promise<number> {
  const ahora = opts.ahora ?? new Date();
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, nombre: true, email: true, telefono: true, aviso_email: true, aviso_whatsapp: true } });
  if (!u) return 0;
  const canales = await canalesDe(tipo, u);
  // `opts.canales` acota (un comunicado puede ir sólo por correo o sólo por WhatsApp); nunca agrega un canal que la persona no aceptó.
  if (opts.canales) for (let i = canales.length - 1; i >= 0; i--) if (!(opts.canales as readonly string[]).includes(canales[i]!)) canales.splice(i, 1);
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

/** Vecinos de un recibo: propietario o inquilino de cada unidad con cargo en él. */
async function usuariosDelRecibo(reciboId: number): Promise<number[]> {
  const unidades = await prisma.unidad.findMany({
    where: { reciboConceptoUnidades: { some: { reciboConcepto: { recibo_id: reciboId } } } },
    select: { propietario_id: true, inquilino_id: true },
  });
  const usuarios = new Set<number>();
  for (const u of unidades) for (const id of [u.propietario_id, u.inquilino_id]) if (id != null) usuarios.add(id);
  return [...usuarios];
}

/** Al emitir un recibo: un aviso por usuario (propietario o inquilino de una unidad con cargo en ese recibo). */
export async function encolarReciboEmitido(reciboId: number, opts: { ahora?: Date } = {}): Promise<number> {
  let creadas = 0;
  for (const id of await usuariosDelRecibo(reciboId)) creadas += await encolarAviso('recibo_emitido', id, { entidad: 'recibo', id: reciboId }, opts);
  return creadas;
}

/**
 * Lo que el aviso «ya está tu recibo» le toca a cada vecino AHORA. `crear`: canales que aún no tiene; `reintentar`: los que fallaron u se
 * omitieron (esos sí se pueden volver a mandar). Lo que ya está `pendiente` o `enviada` no se toca: así nunca hay dos avisos iguales.
 */
export interface PlanAvisoRecibo {
  vecinos: number;
  /** Vecinos a quienes llegaría por correo en este envío (nuevo o reintento). */
  por_correo: number;
  /** Vecinos a quienes llegaría por WhatsApp en este envío (nuevo o reintento). */
  por_whatsapp: number;
  /** Vecinos a quienes se les encolaría algo en este envío. */
  por_avisar: number;
  /** Vecinos con algún canal activo cuyo aviso ya está enviado o en cola: no se les vuelve a mandar. */
  ya_avisados: number;
  /** Vecinos sin ningún canal activo: sin correo real ni WhatsApp, o con los avisos desactivados. */
  sin_canal: number;
  personas: { usuario_id: number; crear: Canal[]; reintentar: Canal[] }[];
}

/** Calcula el plan de `avisarReciboEmitido` sin escribir nada: la vista previa usa lo mismo que el envío. */
export async function planAvisoRecibo(reciboId: number): Promise<PlanAvisoRecibo> {
  const ids = await usuariosDelRecibo(reciboId);
  const usuarios = await prisma.usuario.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, telefono: true, aviso_email: true, aviso_whatsapp: true } });
  const filas = await prisma.notificacion.findMany({ where: { tipo: 'recibo_emitido', ref_entidad: 'recibo', ref_id: reciboId }, select: { usuario_id: true, canal: true, estado: true } });
  const estadoDe = new Map(filas.map((f) => [`${f.usuario_id}:${f.canal}`, f.estado]));
  const plan: PlanAvisoRecibo = { vecinos: usuarios.length, por_correo: 0, por_whatsapp: 0, por_avisar: 0, ya_avisados: 0, sin_canal: 0, personas: [] };
  for (const u of usuarios) {
    // `telegram` nunca sale para un recibo emitido (sólo para resultados de voucher), así que se descarta aquí.
    const canales = (await canalesDe('recibo_emitido', u)).filter((c): c is Canal => c !== 'telegram');
    if (!canales.length) { plan.sin_canal++; continue; }
    const crear = canales.filter((c) => !estadoDe.has(`${u.id}:${c}`));
    const reintentar = canales.filter((c) => estadoDe.get(`${u.id}:${c}`) === 'error' || estadoDe.get(`${u.id}:${c}`) === 'omitida');
    const envio = [...crear, ...reintentar];
    if (!envio.length) { plan.ya_avisados++; continue; }
    plan.personas.push({ usuario_id: u.id, crear, reintentar });
    plan.por_avisar++;
    if (envio.includes('email')) plan.por_correo++;
    if (envio.includes('whatsapp')) plan.por_whatsapp++;
  }
  return plan;
}

/**
 * Avisa a los vecinos que el recibo ya está: encola lo que a cada uno le falta (sin duplicar) y vuelve a poner en cola los que fallaron u
 * se omitieron. Nunca envía en línea: lo hace `procesarCola`. Devuelve cuántos vecinos quedaron encolados, cuántos ya lo tenían y cuántos no tienen canal.
 */
export async function avisarReciboEmitido(reciboId: number, opts: { ahora?: Date } = {}): Promise<{ encolados: number; ya_avisados: number; sin_canal: number }> {
  const ahora = opts.ahora ?? new Date();
  const plan = await planAvisoRecibo(reciboId);
  for (const p of plan.personas) {
    if (p.reintentar.length) {
      await prisma.notificacion.updateMany({
        where: { usuario_id: p.usuario_id, tipo: 'recibo_emitido', ref_entidad: 'recibo', ref_id: reciboId, canal: { in: p.reintentar }, estado: { in: ['error', 'omitida'] } },
        data: { estado: 'pendiente', intentos: 0, error: null, programada_para: ahora },
      });
    }
    if (p.crear.length) await encolarAviso('recibo_emitido', p.usuario_id, { entidad: 'recibo', id: reciboId }, { ahora, canales: p.crear });
  }
  return { encolados: plan.por_avisar, ya_avisados: plan.ya_avisados, sin_canal: plan.sin_canal };
}

/** Días antes del vencimiento en que sale el recordatorio `por_vencer` (el otro es `vence_hoy`, el día mismo). */
export const DIAS_ANTES = 2;
/** Cuántos días atrás se sigue avisando un vencido (por si el planificador estuvo caído). */
const DIAS_GRACIA_VENCIDO = 3;

/**
 * Los recordatorios de pago de cada recibo y unidad SIN voucher son exactamente dos: `por_vencer` (faltan 2 días) y `vence_hoy` (el día del
 * vencimiento), cada uno por correo y WhatsApp. Si el vecino ya subió su voucher (el cargo está `en_revision` o `pagado`) no se manda ninguno.
 * Además `vencido` (venció ayer o hasta 3 días atrás). «Hoy» y «faltan 2 días» son del calendario de cada condominio, en SU zona (`ComplejoHabitacional.zona_horaria`, con horario de verano donde lo hay):
 * un recibo que vence mañana en Santiago puede vencer hoy en Lima.
 * Repetir la llamada no duplica nada (una fila por usuario, canal, tipo y recibo). Un recibo emitido hoy no recibe recordatorios hoy: ya se avisó al emitirlo.
 */
export async function encolarRecordatorios(ahora: Date): Promise<number> {
  const reloj = await relojDeCondominios(ahora);
  const dia = 86_400_000;
  let creadas = 0;
  // Cada condominio con su «hoy»: un tramo por grupo de zonas que comparten día (con una sola zona, el filtro de siempre).
  const delDia = (dias: number): Prisma.ReciboWhereInput => reciboSegunZona(reloj, ({ hoy }) => ({ fecha_vencimiento: { gte: new Date(hoy.getTime() + dias * dia), lt: new Date(hoy.getTime() + (dias + 1) * dia) }, fecha_emision: { lt: hoy } }));
  const tandas: { tipo: TipoAviso; where: Prisma.ReciboWhereInput }[] = [
    { tipo: 'por_vencer', where: delDia(DIAS_ANTES) },
    { tipo: 'vence_hoy', where: delDia(0) },
    { tipo: 'vencido', where: reciboSegunZona(reloj, ({ hoy }) => ({ fecha_vencimiento: { gte: new Date(hoy.getTime() - DIAS_GRACIA_VENCIDO * dia), lt: hoy } })) },
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
  if (n.ref_entidad === 'comunicado') {
    const c = await prisma.comunicado.findUnique({ where: { id: n.ref_id }, select: { complejo: { select: { empresa: { select: { whatsapp_instance: true } } } } } });
    return c?.complejo?.empresa?.whatsapp_instance ?? null;
  }
  if (n.ref_entidad.startsWith('cierre-central:')) {
    const c = await prisma.complejoHabitacional.findUnique({ where: { id: n.ref_id }, select: { empresa: { select: { whatsapp_instance: true } } } });
    return c?.empresa?.whatsapp_instance ?? null;
  }
  if (n.ref_entidad.startsWith('cierre:')) {
    const e = await prisma.estructura.findUnique({ where: { id: n.ref_id }, select: { complejo: { select: { empresa: { select: { whatsapp_instance: true } } } } } });
    return e?.complejo?.empresa?.whatsapp_instance ?? null;
  }
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

/** Condominio al que se refiere un aviso (por su recibo): de él depende el módulo de WhatsApp. null = aviso de la plataforma (sin condominio). */
async function complejoDeAviso(n: { ref_entidad: string | null; ref_id: number | null }): Promise<number | null> {
  if (!n.ref_entidad || n.ref_id == null) return null;
  if (n.ref_entidad === 'comunicado') return (await prisma.comunicado.findUnique({ where: { id: n.ref_id }, select: { complejo_id: true } }))?.complejo_id ?? null;
  if (n.ref_entidad.startsWith('cierre-central:')) return n.ref_id;
  if (n.ref_entidad.startsWith('cierre:')) return (await prisma.estructura.findUnique({ where: { id: n.ref_id }, select: { complejo_id: true } }))?.complejo_id ?? null;
  if (n.ref_entidad === 'recibo') return (await prisma.recibo.findUnique({ where: { id: n.ref_id }, select: { complejo_id: true } }))?.complejo_id ?? null;
  const porCargo = { unidad: { select: { complejo_id: true } }, reciboConcepto: { select: { recibo: { select: { complejo_id: true } } } } } as const;
  const cargo = n.ref_entidad === 'cargo'
    ? await prisma.reciboConceptoUnidad.findUnique({ where: { id: n.ref_id }, select: porCargo })
    : n.ref_entidad === 'pago'
      ? (await prisma.pago.findUnique({ where: { id: n.ref_id }, select: { reciboConceptoUnidad: { select: porCargo } } }))?.reciboConceptoUnidad
      : null;
  return cargo?.unidad?.complejo_id ?? cargo?.reciboConcepto?.recibo?.complejo_id ?? null;
}

export const MOTIVO_SIN_WHATSAPP = 'Plan sin WhatsApp';

/**
 * Un WhatsApp de aviso cuenta contra el tope mensual de su condominio. Pasado el tope no sale (su fila queda omitida con el motivo y el correo
 * sigue por la suya). Sin condominio (avisos de la plataforma) no hay tope.
 */
async function enviarWhatsappDeAviso(deps: DepsAvisos, complejoId: number | null, instancia: string | null, celular: string | null, cuerpo: string): Promise<ResultadoEnvio> {
  if (complejoId != null && !(await reservarConsumo(complejoId, 'whatsapp', deps.ahora())).permitido) return { resultado: 'omitida', motivo: MOTIVO_TOPE_WHATSAPP };
  return enviarWhatsapp(deps, instancia, celular, cuerpo);
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
      // Sin el módulo «Avisos por WhatsApp» el aviso se omite (el correo sigue). Los avisos de la plataforma (sin condominio) no dependen de un plan.
      // El resultado de un voucher mandado por el bot (pago validado/rechazado) también sale si el condominio tiene el asistente, que es quien lo trae.
      const complejoId = await complejoDeAviso(n);
      const permitido = (complejoId == null && n.ref_entidad === 'ia')
        || (await moduloActivo(complejoId, 'whatsapp_avisos'))
        || ((n.tipo === 'pago_validado' || n.tipo === 'pago_rechazado') && (await moduloActivo(complejoId, 'asistente')));
      // La instancia es la de la administradora que emitió el recibo (no una global).
      r = permitido
        ? await enviarWhatsappDeAviso(deps, complejoId, await resolveInstance(n), (await numeroVinculado(n.usuario_id)) ?? n.usuario.telefono, n.cuerpo)
        : { resultado: 'omitida', motivo: MOTIVO_SIN_WHATSAPP };
    } else if (n.canal === 'telegram') {
      // El bot de Telegram es parte del módulo «Asistente con IA».
      r = (await moduloActivo(await complejoDeAviso(n), 'asistente'))
        ? await enviarTelegram(deps, await chatVinculado(n.usuario_id), n.cuerpo)
        : { resultado: 'omitida', motivo: 'Plan sin asistente' };
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
