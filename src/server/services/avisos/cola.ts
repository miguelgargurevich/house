import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { ZONA_POR_DEFECTO } from '../../../lib/paises';
import { diasEntre, hoyEn, medianocheEn } from '../../lib/fechas';
import { MAX_MENSAJE } from '../canales/evolution';
import { obtenerConfiguracion } from '../comercial/configuracion';
import { reciboSegunZona, relojDeCondominios } from '../../lib/zonas';
import { enviarTelegram } from '../canales/telegram';
import { MOTIVO_TOPE_WHATSAPP, reservarConsumo } from '../comercial/consumo';
import { enviarCorreo, enviarWhatsapp, depsReales, type Canal, type DepsAvisos, type ResultadoEnvio } from './canales';
import { montoDeMoraAplicable, montoMoraTexto } from '../mora';
import { moduloActivo } from '../comercial/modulos';
import { dineroTexto, enlaceDeAviso, fechaTexto, periodoTexto, plantilla, type TipoAviso } from './plantillas';
import { correoDeAviso } from './correoAviso';
import { empresaDeAviso as empresaDeAvisoBase } from '../marca/avisos';
import { marcaParaCorreo } from '../marca/servicio';
import { correoSinBuzon } from '../invitaciones';
import { aportesPendientes, cierrePendiente } from '../cierres/pendientes';
import { esTipoWhatsappConfigurable } from './whatsappTipos';
import { filtroEstadoCargo } from '../../lib/cargos';
import { acumularDeuda, SELECT_DEUDA } from '../recordatorios/deudaVencida';

/** Tras este número de fallos seguidos la notificación pasa a `error`. */
export const MAX_INTENTOS = 3;
/** Espera tras el 1.er y el 2.º fallo (minutos). */
export const ESPERA_MIN = [2, 10] as const;
const ARRENDAMIENTO_MIN = 5;
const MIN = 60_000;

/** Pendiente = sin pagar y sin comprobante en revisión (`en_revision`) ni `pagado`. */
const cargoPendiente: Prisma.ReciboConceptoUnidadWhereInput = { OR: [{ estado_pago: null }, { estado_pago: 'pendiente' }] };

/**
 * Quien paga una unidad SIN personas cargadas: el inquilino si lo tiene; si no, el propietario. Es el respaldo de `pagadoresDe` (unidades que todavía no
 * tienen un responsable de pago con cuenta en «Personas del departamento»).
 */
export function quienPaga(u: { propietario_id: number | null; inquilino_id: number | null }): number | null {
  return u.inquilino_id ?? u.propietario_id ?? null;
}

/**
 * A quién le llega el aviso de cobro de cada unidad: SÓLO a la persona marcada `responsable_pago` (con su cuenta, que es donde viven el correo, el celular y las
 * preferencias de aviso). Si la unidad no tiene un responsable con cuenta (aún no se cargaron personas, o el responsable no tiene correo ni celular), se cae a `quienPaga`.
 */
export async function pagadoresDe(unidades: { id: number; propietario_id: number | null; inquilino_id: number | null }[]): Promise<Map<number, number | null>> {
  const ids = [...new Set(unidades.map((u) => u.id))];
  const responsables = ids.length ? await prisma.personaUnidad.findMany({ where: { unidad_id: { in: ids }, responsable_pago: true, usuario_id: { not: null } }, select: { unidad_id: true, usuario_id: true } }) : [];
  const deLaPersona = new Map(responsables.map((r) => [r.unidad_id, r.usuario_id]));
  return new Map(unidades.map((u) => [u.id, deLaPersona.get(u.id) ?? quienPaga(u)]));
}

/**
 * Las unidades que paga una persona: aquellas donde es el responsable de pago y, en las que no tienen un responsable con cuenta, las de siempre
 * (inquilino; o propietario si no hay inquilino). Es el mismo criterio que `pagadoresDe`.
 */
const laPaga = (usuarioId: number): Prisma.UnidadWhereInput => ({
  OR: [
    { personas: { some: { usuario_id: usuarioId, responsable_pago: true } } },
    { AND: [{ personas: { none: { responsable_pago: true, usuario_id: { not: null } } } }, { OR: [{ inquilino_id: usuarioId }, { inquilino_id: null, propietario_id: usuarioId }] }] },
  ],
});

/** Resultado de un voucher. Nunca salen por WhatsApp; el validado no se encola (el vecino lo ve en «Mis recibos») y el rechazado sólo sale por correo. */
export const RESULTADOS_PAGO: readonly string[] = ['pago_validado', 'pago_rechazado'];

export type RefAviso = { entidad: 'recibo'; id: number } | { entidad: 'cargo'; id: number } | { entidad: 'pago'; id: number } | { entidad: 'ia'; id: number } | { entidad: 'comunicado'; id: number } | { entidad: `deuda:${string}`; id: number } | { entidad: `cierre:${string}`; id: number } | { entidad: `cierre-central:${string}`; id: number };

/**
 * Recordatorio de deuda a mano (`deuda:<AAAA-MM-DD>`, id = la unidad): el día de Lima va en la referencia, de modo que a una unidad se le recuerda una sola vez por día
 * (la fila es única por persona, canal, tipo y referencia). La empresa, el condominio y la instancia de WhatsApp salen de la unidad.
 */
export const refDeuda = (dia: string, unidadId: number): RefAviso => ({ entidad: `deuda:${dia}`, id: unidadId });
const esDeuda = (entidad: string) => entidad.startsWith('deuda:');

/** La empresa de la que habla el aviso (para la marca): igual que `empresaDeAviso` de la marca, más el recordatorio de deuda (por su unidad). */
async function empresaDeAviso(ref: { entidad: string; id: number }): Promise<number | null> {
  if (esDeuda(ref.entidad)) {
    const un = await prisma.unidad.findUnique({ where: { id: ref.id }, select: { empresa_id: true, complejo: { select: { empresa_id: true } } } });
    return un?.complejo?.empresa_id ?? un?.empresa_id ?? null;
  }
  return empresaDeAvisoBase(ref);
}

interface Cargado {
  datos: Parameters<typeof plantilla>[1];
}

/** Reúne lo que lleva el mensaje. `null` si no hay nada que avisar a ese usuario (cargos ya pagados, recibo borrado…). Agrega el enlace a la pantalla que corresponde al rol de quien lo recibe. */
async function cargarDatos(tipo: TipoAviso, usuario: { id: number; nombre: string; rol?: string | null }, ref: RefAviso, ahora: Date): Promise<Cargado | null> {
  const c = await cargarDatosBase(tipo, usuario, ref, ahora);
  if (!c) return null;
  // Con la marca propia activa, la firma del texto (WhatsApp y correo en texto) suma el nombre comercial de la empresa que escribe.
  const marca = ref.entidad === 'ia' ? null : await empresaDeAviso(ref).then(marcaParaCorreo).catch(() => null);
  return { datos: { ...c.datos, enlace: enlaceDeAviso(tipo, usuario.rol, c.datos.central), ...(marca ? { empresa: marca.nombre } : {}) } };
}

async function cargarDatosBase(tipo: TipoAviso, usuario: { id: number; nombre: string }, ref: RefAviso, ahora: Date): Promise<Cargado | null> {
  // Avisos de la plataforma (estado de la IA): no hablan de cargos; el detalle viaja en `opts.motivo`.
  if (ref.entidad === 'ia') return { datos: { nombre: usuario.nombre, periodo: '', monto: '', vencimiento: '' } };
  // Comunicado: el título es el asunto y el texto va tal cual; lo firma el condominio.
  if (ref.entidad === 'comunicado') {
    const c = await prisma.comunicado.findUnique({ where: { id: ref.id }, select: { titulo: true, cuerpo: true, archivado_at: true, complejo: { select: { nombre: true } } } });
    if (!c || c.archivado_at) return null;
    return { datos: { nombre: usuario.nombre, periodo: '', monto: '', vencimiento: '', titulo: c.titulo, texto: c.cuerpo, condominio: c.complejo?.nombre ?? null } };
  }
  // Recordatorio de deuda (`deuda:<día>`, id = unidad): lo que la unidad debe HOY, vencido y sin abonos validados, por recibo (la misma cifra de «Morosidad»).
  if (esDeuda(ref.entidad)) {
    const reloj = await relojDeCondominios(ahora);
    const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { AND: [filtroEstadoCargo('vencido', reloj), { unidad_id: ref.id }] }, select: SELECT_DEUDA });
    const deuda = acumularDeuda(cargos, reloj).get(ref.id);
    const un = await prisma.unidad.findUnique({ where: { id: ref.id }, select: { codigo: true, estructura: { select: { nombre: true } }, complejo: { select: { nombre: true, moneda: true } } } });
    if (!deuda || !un) return null;
    const moneda = un.complejo?.moneda;
    const recibos = [...deuda.recibos.values()].sort((a, b) => a.anio - b.anio || a.mes - b.mes);
    return {
      datos: {
        nombre: usuario.nombre,
        periodo: '',
        monto: dineroTexto(deuda.deuda, moneda),
        vencimiento: '',
        conceptos: recibos.map((r) => ({ nombre: `Mantenimiento de ${periodoTexto(r.mes, r.anio)}`, monto: dineroTexto(r.deuda, moneda) })),
        condominio: un.complejo?.nombre ?? null,
        departamentos: [{ codigo: un.codigo, torre: un.estructura?.nombre ?? null }],
      },
    };
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
        conceptos: c.reciboConcepto?.concepto?.nombre ? [{ nombre: c.reciboConcepto.concepto.nombre, monto: dineroTexto(c.monto, c.unidad?.complejo?.moneda) }] : [],
        monto: dineroTexto(c.monto, c.unidad?.complejo?.moneda),
        vencimiento: fechaTexto(recibo.fecha_vencimiento),
        vence: recibo.fecha_vencimiento,
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
        { unidad: laPaga(usuario.id) },
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
  // Cada concepto completo (sin cortar) con lo que suma para esta persona: un concepto cobrado en dos de sus departamentos sale una vez, con el total.
  const porConcepto = new Map<string, Prisma.Decimal>();
  for (const c of cargos) {
    const nombre = c.reciboConcepto?.concepto?.nombre;
    if (nombre) porConcepto.set(nombre, (porConcepto.get(nombre) ?? new Prisma.Decimal(0)).plus(c.monto));
  }
  return {
    datos: {
      nombre: usuario.nombre,
      periodo: periodoTexto(recibo.mes, recibo.anio),
      concepto: [...porConcepto.keys()].join(', '),
      conceptos: [...porConcepto].map(([nombre, monto]) => ({ nombre, monto: dineroTexto(monto, recibo.complejo?.moneda) })),
      monto: dineroTexto(total, recibo.complejo?.moneda),
      vencimiento: fechaTexto(recibo.fecha_vencimiento),
      vence: recibo.fecha_vencimiento,
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
 * Lo que la lista de WhatsApp del condominio (`whatsapp_avisos`) deja salir para el aviso: `null` si no se rige por ella (el tipo es de IA o de
 * comunicado, o el aviso no tiene condominio). Lo usan el envío, la vista previa y `canalesDe`: así las tres cosas miran la misma lista.
 */
async function listaWhatsappDe(tipo: string, n: { ref_entidad: string | null; ref_id: number | null }): Promise<readonly string[] | null> {
  if (!esTipoWhatsappConfigurable(tipo)) return null;
  const complejoId = await complejoDeAviso(n);
  if (complejoId == null) return null;
  const c = await prisma.complejoHabitacional.findUnique({ where: { id: complejoId }, select: { whatsapp_avisos: true } });
  return c ? c.whatsapp_avisos : null;
}

/**
 * Por qué canales le llega un aviso a la persona: correo si lo acepta y tiene uno real (un `.invalid` no tiene buzón; no es canal) y WhatsApp si lo
 * acepta y tiene celular o un número vinculado. Lo usan el envío y la vista previa.
 * `lista` es la de `whatsapp_avisos` del condominio (`null` = no se rige): si el tipo no está en ella, no hay WhatsApp, tampoco al número vinculado.
 * Los resultados de pago nunca salen por WhatsApp ni por Telegram: el validado no sale por ningún canal y el rechazado sólo por correo.
 */
export async function canalesDe(tipo: TipoAviso, u: { id: number; email: string | null; telefono: string | null; aviso_email: boolean; aviso_whatsapp: boolean }, lista: readonly string[] | null): Promise<Canal[]> {
  if (tipo === 'pago_validado') return [];
  const canales: Canal[] = [];
  if (u.aviso_email && u.email && !correoSinBuzon(u.email)) canales.push('email');
  if (tipo === 'pago_rechazado') return canales;
  const whatsappPermitido = lista == null || lista.includes(tipo);
  if (whatsappPermitido && u.aviso_whatsapp && (u.telefono?.trim() || (await numeroVinculado(u.id)))) canales.push('whatsapp');
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
 *  - `{ entidad: 'pago', id }`   → `pago_rechazado` de ESE pago, sólo por correo (los datos salen de su cargo; cada pago avisa una vez,
 *    aunque el mismo cargo se rechace, se vuelva a pagar y se rechace de nuevo). `pago_validado` no se encola: no sale por ningún canal.
 * `opts.motivo` es el motivo de un rechazo y va en el mensaje. `opts.canales` limita los canales (por defecto, los que la persona aceptó).
 *
 * Nunca envía en línea: la notificación queda `pendiente` y la procesa `procesarCola`. Devuelve cuántas creó.
 */
export async function encolarAviso(tipo: TipoAviso, usuarioId: number, ref: RefAviso, opts: { ahora?: Date; motivo?: string; canales?: readonly Canal[] } = {}): Promise<number> {
  const ahora = opts.ahora ?? new Date();
  const u = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { id: true, nombre: true, rol: true, email: true, telefono: true, aviso_email: true, aviso_whatsapp: true } });
  if (!u) return 0;
  const canales = await canalesDe(tipo, u, await listaWhatsappDe(tipo, { ref_entidad: ref.entidad, ref_id: ref.id }));
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

/** A quién le llega el aviso de cobro de un recibo: quien paga cada unidad con cargo en él (el inquilino si lo hay; si no, el propietario). */
async function usuariosDelRecibo(reciboId: number): Promise<number[]> {
  const unidades = await prisma.unidad.findMany({
    where: { reciboConceptoUnidades: { some: { reciboConcepto: { recibo_id: reciboId } } } },
    select: { id: true, propietario_id: true, inquilino_id: true },
  });
  const usuarios = new Set<number>();
  for (const pagador of (await pagadoresDe(unidades)).values()) if (pagador != null) usuarios.add(pagador);
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
  const lista = await listaWhatsappDe('recibo_emitido', { ref_entidad: 'recibo', ref_id: reciboId });
  for (const u of usuarios) {
    const canales = await canalesDe('recibo_emitido', u, lista);
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
      select: { reciboConcepto: { select: { recibo_id: true } }, unidad: { select: { id: true, propietario_id: true, inquilino_id: true } } },
    });
    const pagadores = await pagadoresDe(cargos.flatMap((c) => (c.unidad ? [c.unidad] : [])));
    const pares = new Map<string, { usuario: number; recibo: number }>();
    for (const c of cargos) {
      const recibo = c.reciboConcepto?.recibo_id;
      if (recibo == null) continue;
      // Sólo quien paga la unidad (su responsable de pago): el propietario de una unidad con inquilino no recibe recordatorios de ella.
      const pagador = c.unidad ? pagadores.get(c.unidad.id) ?? null : null;
      if (pagador != null) pares.set(`${pagador}:${recibo}`, { usuario: pagador, recibo });
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
  if (esDeuda(n.ref_entidad)) {
    const un = await prisma.unidad.findUnique({ where: { id: n.ref_id }, select: { complejo: { select: { empresa: { select: { whatsapp_instance: true } } } } } });
    return un?.complejo?.empresa?.whatsapp_instance ?? null;
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
  if (esDeuda(n.ref_entidad)) return (await prisma.unidad.findUnique({ where: { id: n.ref_id }, select: { complejo_id: true } }))?.complejo_id ?? null;
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
const TIPO_RECORDATORIO_DEUDA = 'recordatorio_deuda';
/** El departamento pagó (o se saldó) antes de que saliera el recordatorio de deuda. */
export const MOTIVO_YA_AL_DIA = 'Ya no tiene deuda vencida';
/** El condominio apagó este tipo para WhatsApp después de encolarlo. */
export const MOTIVO_APAGADO_WHATSAPP = 'Apagado en el condominio';
/** Un resultado de pago sólo sale por correo (queda así también un pendiente que se encoló antes de este cambio). */
export const MOTIVO_SOLO_CORREO = 'Los resultados de pago sólo van por correo';

/** Pasada de WhatsApp: si ya lleva más de esto, los WhatsApp que faltan no se toman (quedan pendientes para la siguiente pasada, sin intento). */
export const TOPE_PASADA_MS = 10 * MIN;
/** Va al final de cada WhatsApp de aviso (no del correo ni de las respuestas del bot) para que quien no quiera recibirlos lo diga con una palabra. */
export const PIE_WHATSAPP = '\n\nSi no quieres recibir estos avisos por WhatsApp, responde SALIR.';

/** El cuerpo con el pie. Si es muy largo se recorta para que el pie quepa siempre dentro del límite de un mensaje. */
export function conPie(cuerpo: string): string {
  const espacio = MAX_MENSAJE - PIE_WHATSAPP.length;
  return (cuerpo.length > espacio ? cuerpo.slice(0, espacio) : cuerpo) + PIE_WHATSAPP;
}

/** Milisegundos de pausa: el azar (de 0 a 1) cae dentro de [min, max] segundos de la configuración. */
export function pausaMs(cfg: { whatsapp_pausa_min_seg: number; whatsapp_pausa_max_seg: number }, azar: number): number {
  const min = Math.max(0, cfg.whatsapp_pausa_min_seg);
  const max = Math.max(min, cfg.whatsapp_pausa_max_seg);
  return Math.round((min + azar * (max - min)) * 1000);
}

/** Las 08:00 de mañana en Lima, cuando vuelven a salir los WhatsApp que el tope del día aplazó. Lima no tiene horario de verano: UTC−5 todo el año. */
export function manana0800Lima(ahora: Date): Date {
  const h = hoyEn(ZONA_POR_DEFECTO, ahora); // 00:00 UTC del día calendario de Lima
  return new Date(Date.UTC(h.getUTCFullYear(), h.getUTCMonth(), h.getUTCDate() + 1, 13));
}

/**
 * WhatsApp ENVIADOS hoy (día calendario de Lima) por esa instancia: los avisos (1-a-1) y los mensajes a grupos de los comunicados, porque para
 * WhatsApp un mensaje es un mensaje. Las respuestas del bot no pasan por aquí: no cuentan.
 */
export async function contarEnviadasHoy(instancia: string, ahora: Date): Promise<number> {
  const h = hoyEn(ZONA_POR_DEFECTO, ahora);
  const desde = medianocheEn(ZONA_POR_DEFECTO, h.getUTCFullYear(), h.getUTCMonth() + 1, h.getUTCDate());
  const [avisos, grupos] = await Promise.all([
    prisma.notificacion.count({ where: { canal: 'whatsapp', estado: 'enviada', whatsapp_instancia: instancia, enviada_at: { gte: desde } } }),
    prisma.envioGrupoWhatsapp.count({ where: { instancia, estado: 'enviado', at: { gte: desde } } }),
  ]);
  return avisos + grupos;
}

/**
 * Un WhatsApp de aviso cuenta contra el tope mensual de su condominio. Pasado el tope no sale (su fila queda omitida con el motivo y el correo
 * sigue por la suya). Sin condominio (avisos de la plataforma) no hay tope.
 */
async function enviarWhatsappDeAviso(deps: DepsAvisos, complejoId: number | null, instancia: string | null, celular: string | null, cuerpo: string, antesDeEnviar?: () => Promise<void>): Promise<ResultadoEnvio> {
  if (complejoId != null && !(await reservarConsumo(complejoId, 'whatsapp', deps.ahora())).permitido) return { resultado: 'omitida', motivo: MOTIVO_TOPE_WHATSAPP };
  return enviarWhatsapp(deps, instancia, celular, cuerpo, antesDeEnviar);
}

/**
 * El correo de un aviso, con diseño. El texto plano y el asunto son los que se guardaron al encolar; el HTML se arma al enviar con los datos de
 * ese momento (recibo, cargos, condominio). Si ya no se pueden rehacer (recibo borrado, comunicado archivado, avisos de la IA) el HTML se arma con el texto guardado:
 * nunca se deja de enviar por esto.
 */
async function enviarCorreoDeAviso(deps: DepsAvisos, n: { tipo: string; asunto: string; cuerpo: string; usuario_id: number; ref_entidad: string | null; ref_id: number | null; usuario: { email: string | null; nombre: string; rol: string | null } }, remitente: string | null): Promise<ResultadoEnvio> {
  const tipo = n.tipo as TipoAviso;
  let html: string | undefined;
  let condominio: string | null = null;
  try {
    const ref = n.ref_entidad != null && n.ref_id != null ? ({ entidad: n.ref_entidad, id: n.ref_id } as RefAviso) : null;
    const cargado = ref ? await cargarDatos(tipo, { id: n.usuario_id, nombre: n.usuario.nombre, rol: n.usuario.rol }, ref, deps.ahora()) : null;
    // El motivo del rechazo sólo vive en el texto guardado: se toma de ahí para que el correo y el texto digan lo mismo.
    const motivo = tipo === 'pago_rechazado' ? /Motivo: ([\s\S]*?)\n\nRevisa el detalle/.exec(n.cuerpo)?.[1] : undefined;
    const datos = cargado ? { ...cargado.datos, ...(motivo ? { motivo } : {}) } : null;
    // Marca de la empresa que escribe (sólo con `marca_propia` activa): cabecera con su logo, nombre y color. Si no se puede leer, el correo sale con la cara de Torre.
    const marca = ref ? await empresaDeAviso(ref).then(marcaParaCorreo).catch(() => null) : null;
    html = correoDeAviso(tipo, datos, { asunto: n.asunto, cuerpo: n.cuerpo, rol: n.usuario.rol }, marca).html;
    // El nombre visible del remitente dice quién escribe: «<Nombre comercial> vía Torre» con marca, «<Condominio> vía Torre» sin ella (la dirección no cambia).
    condominio = marca?.nombre ?? datos?.condominio ?? null;
  } catch {
    // Sin HTML el correo sale igual, en texto: lo importante es que el vecino se entere.
    html = undefined;
  }
  return enviarCorreo(deps, n.usuario.email, n.asunto, n.cuerpo, undefined, html, { remitente, condominio });
}

/**
 * Envía las `pendiente` con `programada_para <= ahora`. Cada una se «arrienda» antes de enviar (se corre su
 * `programada_para` unos minutos), así dos procesos no mandan el mismo aviso. Los fallos se reintentan con espera
 * creciente (`ESPERA_MIN`) hasta `MAX_INTENTOS`; después quedan en `error` con un motivo corto.
 */
export async function procesarCola(deps: DepsAvisos = depsReales(), limite = 50, inicio = deps.ahora().getTime()): Promise<{ enviadas: number; omitidas: number; fallos: number; errores: number }> {
  const ahora = deps.ahora();
  const cfg = await obtenerConfiguracion();
  const tope = cfg.whatsapp_tope_diario;
  const resumen = { enviadas: 0, omitidas: 0, fallos: 0, errores: 0 };
  const pendientes = await prisma.notificacion.findMany({
    where: { estado: 'pendiente', programada_para: { lte: ahora } },
    orderBy: [{ programada_para: 'asc' }, { id: 'asc' }],
    take: limite,
    include: { usuario: { select: { email: true, telefono: true, nombre: true, rol: true } } },
  });
  // Por instancia, en esta pasada: las que ya tuvieron un WhatsApp (la pausa va entre ellos) y cuántos salieron hoy (para el tope).
  const instanciasUsadas = new Set<string>();
  const enviadasHoy = new Map<string, number>();
  const llevaHoy = async (instancia: string) => {
    let c = enviadasHoy.get(instancia);
    if (c == null) {
      c = await contarEnviadasHoy(instancia, deps.ahora());
      enviadasHoy.set(instancia, c);
    }
    return c;
  };
  for (const n of pendientes) {
    // Pasada demasiado larga: los WhatsApp que faltan no se toman (siguen pendientes, sin intento). El correo de esta pasada sí sale.
    if (n.canal === 'whatsapp' && deps.ahora().getTime() - inicio > TOPE_PASADA_MS) continue;
    const tomada = await prisma.notificacion.updateMany({
      where: { id: n.id, estado: 'pendiente', programada_para: n.programada_para },
      data: { programada_para: new Date(ahora.getTime() + ARRENDAMIENTO_MIN * MIN) },
    });
    if (tomada.count === 0) continue;

    // Un recordatorio de deuda ya no corresponde si el departamento se puso al día entre que se encoló y ahora (un WhatsApp puede esperar su turno un rato).
    if (n.tipo === TIPO_RECORDATORIO_DEUDA && n.ref_entidad && n.ref_id != null && !(await cargarDatos(n.tipo, { id: n.usuario_id, nombre: n.usuario.nombre, rol: n.usuario.rol }, { entidad: n.ref_entidad, id: n.ref_id } as RefAviso, ahora))) {
      await prisma.notificacion.update({ where: { id: n.id }, data: { estado: 'omitida', error: MOTIVO_YA_AL_DIA, programada_para: n.programada_para } });
      resumen.omitidas++;
      continue;
    }

    let r: ResultadoEnvio;
    let instanciaWa: string | null = null;
    if (n.canal === 'email') {
      r = await enviarCorreoDeAviso(deps, n, cfg.correo_remitente);
    } else if (n.canal === 'whatsapp' && RESULTADOS_PAGO.includes(n.tipo)) {
      r = { resultado: 'omitida', motivo: MOTIVO_SOLO_CORREO };
    } else if (n.canal === 'whatsapp') {
      // Sin el módulo «Avisos por WhatsApp» el aviso se omite (el correo sigue). Los avisos de la plataforma (sin condominio) no dependen de un plan.
      const complejoId = await complejoDeAviso(n);
      const permitido = (complejoId == null && n.ref_entidad === 'ia')
        || (await moduloActivo(complejoId, 'whatsapp_avisos'));
      const lista = await listaWhatsappDe(n.tipo, n);
      if (!permitido) {
        r = { resultado: 'omitida', motivo: MOTIVO_SIN_WHATSAPP };
      } else if (lista && !lista.includes(n.tipo)) {
        // La administración apagó este tipo después de encolarlo: no sale ni por WhatsApp ni al número vinculado del bot.
        r = { resultado: 'omitida', motivo: MOTIVO_APAGADO_WHATSAPP };
      } else {
        // La instancia es la de la administradora que emitió el recibo (no una global).
        const instancia = await resolveInstance(n);
        // Tope diario por número: si ya salieron todos los de hoy, este aviso queda para mañana a las 08:00 (Lima), sin intento ni omisión.
        if (instancia && tope != null && tope > 0 && (await llevaHoy(instancia)) >= tope) {
          await prisma.notificacion.update({ where: { id: n.id }, data: { programada_para: manana0800Lima(deps.ahora()) } });
          continue;
        }
        instanciaWa = instancia;
        r = await enviarWhatsappDeAviso(deps, complejoId, instancia, (await numeroVinculado(n.usuario_id)) ?? n.usuario.telefono, conPie(n.cuerpo), async () => {
          // Pausa al azar entre dos WhatsApp seguidos de la MISMA instancia; el primero de cada instancia sale sin esperar.
          if (instancia && instanciasUsadas.has(instancia)) await deps.esperar(pausaMs(cfg, deps.azar()));
          if (instancia) instanciasUsadas.add(instancia);
        });
      }
    } else if (n.canal === 'telegram') {
      // El bot de Telegram es parte del módulo «Asistente con IA». Un resultado de pago no sale por Telegram (sólo correo).
      r = RESULTADOS_PAGO.includes(n.tipo)
        ? { resultado: 'omitida', motivo: MOTIVO_SOLO_CORREO }
        : (await moduloActivo(await complejoDeAviso(n), 'asistente'))
        ? await enviarTelegram(deps, await chatVinculado(n.usuario_id), n.cuerpo)
        : { resultado: 'omitida', motivo: 'Plan sin asistente' };
    } else {
      r = resultadoSinCanal(n.canal);
    }

    if (r.resultado === 'ok') {
      await prisma.notificacion.update({ where: { id: n.id }, data: { estado: 'enviada', enviada_at: deps.ahora(), intentos: n.intentos + 1, error: null, ...(instanciaWa ? { whatsapp_instancia: instanciaWa } : {}) } });
      if (instanciaWa) enviadasHoy.set(instanciaWa, (enviadasHoy.get(instanciaWa) ?? 0) + 1);
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
