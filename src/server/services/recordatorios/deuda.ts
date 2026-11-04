// Recordatorio de deuda «a mano»: la administración marca unidades en Morosidad y les manda, SÓLO al responsable de pago de cada una, un aviso con lo que
// debe hoy. Es el mismo aviso que el resto (`recordatorio_deuda` en la cola: correo con diseño, WhatsApp con pausas, tope diario y cuota del condominio).
// La vista previa y el envío salen de la MISMA función (`planDeuda`): lo que ves es lo que se encola. Nunca envía en línea.
import type { AuthUser } from '../../middleware/auth';
import { prisma } from '../../db';
import { notFound } from '../../errors';
import { ZONA_POR_DEFECTO } from '../../../lib/paises';
import { filtroEstadoCargo } from '../../lib/cargos';
import { hoyEn } from '../../lib/fechas';
import { scopeCargos, scopeUnidades } from '../../lib/scope';
import { relojDeCondominios } from '../../lib/zonas';
import { obtenerConfiguracion } from '../comercial/configuracion';
import { periodoDe, topeDelMes } from '../comercial/consumo';
import { moduloActivo } from '../comercial/modulos';
import { type Canal } from '../avisos/canales';
import { canalesDe, contarEnviadasHoy, encolarAviso, pagadoresDe, refDeuda } from '../avisos/cola';
import { dineroTexto, plantilla } from '../avisos/plantillas';
import { periodoTexto } from '../../lib/periodo';
import { acumularDeuda, SELECT_DEUDA } from './deudaVencida';

const TIPO = 'recordatorio_deuda' as const;

/** El día de Lima (`AAAA-MM-DD`): una unidad recibe a lo más un recordatorio por día. */
export const diaDeLima = (ahora: Date): string => hoyEn(ZONA_POR_DEFECTO, ahora).toISOString().slice(0, 10);

export interface CuotaWhatsapp {
  complejo_id: number;
  nombre: string;
  /** Mensajes de WhatsApp de ESTE recordatorio en este condominio. */
  por_enviar: number;
  /** Lo que lleva usado el condominio este mes y su tope (null = sin tope). */
  usadas: number;
  tope: number | null;
  restantes: number | null;
  /** ¿Alcanza la cuota del mes para todos los de este recordatorio? Los que no entren quedan omitidos («tope mensual»). */
  alcanza: boolean;
  /** Lo enviado hoy por el número de la administradora y su tope diario (null = sin tope): pasado el tope, salen mañana a las 08:00. */
  hoy: { enviados: number; tope: number | null };
  /** El módulo «Avisos por WhatsApp» y el número conectado: sin alguno de los dos, nada sale por WhatsApp. */
  disponible: boolean;
  motivo_no_disponible: string | null;
}

export interface PlanDeuda {
  /** Departamentos marcados. */
  unidades: number;
  /** Marcados sin deuda vencida: no reciben nada. */
  sin_deuda: number;
  /** Con deuda vencida a quienes ya se les recordó hoy (día de Lima): no se repite. */
  ya_recordadas_hoy: number;
  /** Personas (responsables de pago) a quienes se les podría escribir hoy: las unidades con deuda que aún no se recordaron. */
  responsables: number;
  /** Departamentos que recibirían algo ahora (al menos un canal de los elegidos). */
  por_avisar: number;
  /** De esos, cuántos reciben correo y cuántos WhatsApp (un departamento puede recibir ambos). */
  por_correo: number;
  por_whatsapp: number;
  /** Con deuda y sin recordar hoy, pero sin ningún canal activo entre los elegidos (sin correo real ni celular, avisos apagados, sin WhatsApp). */
  sin_canal: number;
  whatsapp: CuotaWhatsapp[];
  /** El texto tal como saldría (con el monto del primer departamento y «[Nombre]» donde va el nombre de cada persona). `null` si nadie recibiría nada. */
  ejemplo: { asunto: string; cuerpo: string } | null;
  /** Condominios de los departamentos marcados. Interno (no sale en la respuesta). */
  complejos: number[];
  /** Lo que se encolaría: una fila por departamento. Interno (no sale en la respuesta). */
  filas: { unidad_id: number; usuario_id: number; canales: Canal[] }[];
}

/**
 * Lo que se hará si se confirma, sin escribir nada. Las unidades se buscan DENTRO del alcance de quien llama (`scopeUnidades`): una de otra empresa o
 * que no existe es 404 y no se calcula ni se encola nada para ninguna.
 */
export async function planDeuda(u: AuthUser, entrada: { unidades: number[]; canales: readonly Canal[] }, ahora: Date): Promise<PlanDeuda> {
  const ids = [...new Set(entrada.unidades)];
  const unidades = await prisma.unidad.findMany({
    where: { AND: [{ id: { in: ids } }, scopeUnidades(u)] },
    select: { id: true, codigo: true, propietario_id: true, inquilino_id: true, complejo_id: true, estructura: { select: { nombre: true } }, complejo: { select: { id: true, nombre: true, moneda: true, empresa: { select: { whatsapp_instance: true } } } } },
  });
  if (unidades.length !== ids.length) throw notFound('Departamento');
  unidades.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }) || a.id - b.id); // el ejemplo del texto es el del primero por código

  const reloj = await relojDeCondominios(ahora);
  const cargos = await prisma.reciboConceptoUnidad.findMany({ where: { AND: [scopeCargos(u), filtroEstadoCargo('vencido', reloj), { unidad_id: { in: ids } }] }, select: SELECT_DEUDA });
  const deudas = acumularDeuda(cargos, reloj);
  const conDeuda = unidades.filter((x) => deudas.has(x.id));

  const dia = diaDeLima(ahora);
  const yaHoy = new Set(
    (await prisma.notificacion.findMany({ where: { tipo: TIPO, ref_entidad: `deuda:${dia}`, ref_id: { in: conDeuda.map((x) => x.id) } }, select: { ref_id: true } })).map((n) => n.ref_id),
  );
  const porRecordar = conDeuda.filter((x) => !yaHoy.has(x.id));

  const pagadores = await pagadoresDe(porRecordar);
  const personas = await prisma.usuario.findMany({
    where: { id: { in: [...new Set([...pagadores.values()].filter((x): x is number => x != null))] } },
    select: { id: true, email: true, telefono: true, aviso_email: true, aviso_whatsapp: true },
  });
  const personaDe = new Map(personas.map((p) => [p.id, p]));

  // WhatsApp sólo si el condominio tiene el módulo y la administradora tiene su número conectado: si no, la fila se omitiría al enviar.
  const complejoIds = [...new Set(porRecordar.map((x) => x.complejo_id).filter((x): x is number => x != null))];
  const whatsappDe = new Map<number, string | null>(); // complejo → motivo por el que NO hay WhatsApp (null = disponible)
  for (const x of porRecordar) {
    if (x.complejo_id == null || whatsappDe.has(x.complejo_id)) continue;
    whatsappDe.set(x.complejo_id, !(await moduloActivo(x.complejo_id, 'whatsapp_avisos')) ? 'El plan del condominio no incluye avisos por WhatsApp' : !x.complejo?.empresa?.whatsapp_instance ? 'La administradora no tiene su número de WhatsApp conectado' : null);
  }

  const filas: PlanDeuda['filas'] = [];
  const porWhatsapp = new Map<number, number>();
  let sinCanal = 0;
  let porCorreo = 0;
  let whatsapp = 0;
  for (const x of porRecordar) {
    const pagador = pagadores.get(x.id) ?? null;
    const p = pagador != null ? personaDe.get(pagador) : undefined;
    // Las preferencias de la persona mandan (`aviso_email`, `aviso_whatsapp`), como en todos los avisos: lo que no acepta, no se le manda.
    let canales = p ? (await canalesDe(TIPO, p, null)).filter((c) => entrada.canales.includes(c)) : [];
    if (x.complejo_id == null || whatsappDe.get(x.complejo_id) != null) canales = canales.filter((c) => c !== 'whatsapp');
    if (!p || !canales.length) { sinCanal++; continue; }
    filas.push({ unidad_id: x.id, usuario_id: p.id, canales });
    if (canales.includes('email')) porCorreo++;
    if (canales.includes('whatsapp')) { whatsapp++; porWhatsapp.set(x.complejo_id!, (porWhatsapp.get(x.complejo_id!) ?? 0) + 1); }
  }

  const cfg = await obtenerConfiguracion();
  const periodo = periodoDe(ahora);
  const cuotas: CuotaWhatsapp[] = [];
  if (entrada.canales.includes('whatsapp')) {
    for (const cid of complejoIds) {
      const x = porRecordar.find((y) => y.complejo_id === cid)!;
      const [tope, consumo] = await Promise.all([topeDelMes(cid, 'whatsapp'), prisma.consumoMensual.findUnique({ where: { complejo_id_periodo_recurso: { complejo_id: cid, periodo, recurso: 'whatsapp' } }, select: { cantidad: true } })]);
      const usadas = consumo?.cantidad ?? 0;
      const por_enviar = porWhatsapp.get(cid) ?? 0;
      const instancia = x.complejo?.empresa?.whatsapp_instance ?? null;
      const motivo = whatsappDe.get(cid) ?? null;
      cuotas.push({
        complejo_id: cid,
        nombre: x.complejo?.nombre ?? '',
        por_enviar,
        usadas,
        tope,
        restantes: tope == null ? null : Math.max(0, tope - usadas),
        alcanza: tope == null || usadas + por_enviar <= tope,
        hoy: { enviados: instancia ? await contarEnviadasHoy(instancia, ahora) : 0, tope: cfg.whatsapp_tope_diario != null && cfg.whatsapp_tope_diario > 0 ? cfg.whatsapp_tope_diario : null },
        disponible: motivo == null,
        motivo_no_disponible: motivo,
      });
    }
  }

  let ejemplo: PlanDeuda['ejemplo'] = null;
  const primera = filas[0] ? unidades.find((x) => x.id === filas[0]!.unidad_id) : undefined;
  if (primera) {
    const d = deudas.get(primera.id)!;
    const moneda = primera.complejo?.moneda;
    ejemplo = plantilla(TIPO, {
      nombre: '[Nombre]',
      periodo: '',
      monto: dineroTexto(d.deuda, moneda),
      vencimiento: '',
      conceptos: [...d.recibos.values()].sort((a, b) => a.anio - b.anio || a.mes - b.mes).map((r) => ({ nombre: `Mantenimiento de ${periodoTexto(r.mes, r.anio)}`, monto: dineroTexto(r.deuda, moneda) })),
      condominio: primera.complejo?.nombre ?? null,
      departamentos: [{ codigo: primera.codigo, torre: primera.estructura?.nombre ?? null }],
    });
  }

  return {
    unidades: ids.length,
    sin_deuda: unidades.length - conDeuda.length,
    ya_recordadas_hoy: yaHoy.size,
    responsables: new Set(porRecordar.map((x) => pagadores.get(x.id)).filter((x): x is number => x != null)).size,
    por_avisar: filas.length,
    por_correo: porCorreo,
    por_whatsapp: whatsapp,
    sin_canal: sinCanal,
    whatsapp: cuotas,
    ejemplo,
    complejos: [...new Set(unidades.map((x) => x.complejo_id).filter((x): x is number => x != null))],
    filas,
  };
}

/**
 * Encola lo que dice `plan` (el mismo de la vista previa): un aviso por departamento y canal, a SU responsable de pago. Idempotente por departamento y día de Lima
 * (la referencia lleva el día): repetir la llamada, o confirmarla dos veces a la vez, no duplica nada. Devuelve cuántos avisos (filas) quedaron en cola.
 */
export async function encolarDeuda(plan: PlanDeuda, ahora: Date): Promise<number> {
  const dia = diaDeLima(ahora);
  let creados = 0;
  for (const f of plan.filas) creados += await encolarAviso(TIPO, f.usuario_id, refDeuda(dia, f.unidad_id), { ahora, canales: f.canales });
  return creados;
}
