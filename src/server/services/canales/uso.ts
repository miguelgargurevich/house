// Cuántos WhatsApp salen del número de la empresa: el tope diario (que también frena los mensajes a grupos) y el contador de la pantalla «WhatsApp».
// Sin datos personales: sólo cantidades, tipos y motivos.
import { prisma } from '../../db';
import { ZONA_POR_DEFECTO } from '../../../lib/paises';
import { hoyEn, inicioMesEn, medianocheEn } from '../../lib/fechas';
import { contarEnviadasHoy } from '../avisos/cola';
import { obtenerConfiguracion } from '../comercial/configuracion';
import { periodoDe, mesSiguienteTexto, topeDelMes } from '../comercial/consumo';

/** Motivo con el que un mensaje a un grupo queda pendiente cuando el número ya mandó todos los de hoy. */
export const MOTIVO_TOPE_DIARIO = 'Tope diario alcanzado';

/**
 * Los desgloses por tipo del contador. `grupo` son los mensajes a grupos de los comunicados; los del recibo a los grupos cuentan como `recibo_emitido`
 * (un mismo recibo, por correo, WhatsApp directo o grupo). Lo demás es la cola 1-a-1; `otros` queda para lo que no tiene nombre propio.
 */
export const TIPOS_CONTADOR = ['recibo_emitido', 'por_vencer', 'vence_hoy', 'vencido', 'comunicado', 'cierre_pendiente', 'recordatorio_deuda', 'grupo', 'otros'] as const;
export type TipoContador = (typeof TIPOS_CONTADOR)[number];
export type PorTipo = Record<TipoContador, number>;

const vacioPorTipo = (): PorTipo => Object.fromEntries(TIPOS_CONTADOR.map((t) => [t, 0])) as PorTipo;
const tipoDe = (t: string): TipoContador => ((TIPOS_CONTADOR as readonly string[]).includes(t) && t !== 'grupo' && t !== 'otros' ? (t as TipoContador) : 'otros');

/** Cuántos le quedan hoy al número: `tope` null = sin tope. Cuenta los avisos 1-a-1 y los mensajes a grupos (`contarEnviadasHoy`). */
export async function cupoDiario(instancia: string, ahora: Date): Promise<{ tope: number | null; enviadas: number; alcanzado: boolean }> {
  const tope = (await obtenerConfiguracion()).whatsapp_tope_diario;
  const enviadas = await contarEnviadasHoy(instancia, ahora);
  return tope != null && tope > 0 ? { tope, enviadas, alcanzado: enviadas >= tope } : { tope: null, enviadas, alcanzado: false };
}

/**
 * Un mensaje a un grupo que terminó (`enviado` o `fallo`): el enviado cuenta para el tope diario y los dos salen en el contador. Lleva el comunicado
 * o el recibo que lo originó (uno de los dos). Un fallo al guardar nunca tumba el envío.
 */
export async function registrarEnvioGrupo(d: { empresa_id: number; instancia: string; complejo_id: number; comunicado_id: number | null; recibo_id?: number | null; grupo_id: number | null; estado: 'enviado' | 'fallo'; motivo?: string; ahora: Date }): Promise<void> {
  try {
    await prisma.envioGrupoWhatsapp.create({ data: { empresa_id: d.empresa_id, instancia: d.instancia, complejo_id: d.complejo_id, comunicado_id: d.comunicado_id, recibo_id: d.recibo_id ?? null, grupo_id: d.grupo_id, estado: d.estado, motivo: d.motivo?.slice(0, 200) ?? null, at: d.ahora } });
  } catch (e) {
    console.error('[whatsapp] no se pudo anotar el envío al grupo:', e instanceof Error ? e.message : 'error');
  }
}

type FilaRef = { ref_entidad: string | null; ref_id: number | null };
const claveDe = (n: FilaRef): string | null => {
  if (!n.ref_entidad || n.ref_id == null) return null;
  const tipo = n.ref_entidad.startsWith('cierre-central:') ? 'cierre-central' : n.ref_entidad.startsWith('cierre:') ? 'cierre' : n.ref_entidad;
  return `${tipo}:${n.ref_id}`;
};

/** A qué condominio se refiere cada aviso (como `complejoDeAviso` de la cola, pero de a muchos: una consulta por tipo de referencia, no una por aviso). */
async function complejosDeAvisos(filas: FilaRef[]): Promise<Map<string, number | null>> {
  const ids: Record<string, Set<number>> = {};
  for (const n of filas) {
    const k = claveDe(n);
    if (k) (ids[k.split(':')[0]!] ??= new Set()).add(n.ref_id!);
  }
  const en = (k: string) => ({ in: [...(ids[k] ?? [])] });
  const out = new Map<string, number | null>();
  for (const id of ids['cierre-central'] ?? []) out.set(`cierre-central:${id}`, id);
  const porCargo = { unidad: { select: { complejo_id: true } }, reciboConcepto: { select: { recibo: { select: { complejo_id: true } } } } } as const;
  const [comunicados, recibos, bloques, cargos, pagos] = await Promise.all([
    ids.comunicado ? prisma.comunicado.findMany({ where: { id: en('comunicado') }, select: { id: true, complejo_id: true } }) : [],
    ids.recibo ? prisma.recibo.findMany({ where: { id: en('recibo') }, select: { id: true, complejo_id: true } }) : [],
    ids.cierre ? prisma.estructura.findMany({ where: { id: en('cierre') }, select: { id: true, complejo_id: true } }) : [],
    ids.cargo ? prisma.reciboConceptoUnidad.findMany({ where: { id: en('cargo') }, select: { id: true, ...porCargo } }) : [],
    ids.pago ? prisma.pago.findMany({ where: { id: en('pago') }, select: { id: true, reciboConceptoUnidad: { select: porCargo } } }) : [],
  ]);
  for (const c of comunicados) out.set(`comunicado:${c.id}`, c.complejo_id);
  for (const r of recibos) out.set(`recibo:${r.id}`, r.complejo_id);
  for (const b of bloques) out.set(`cierre:${b.id}`, b.complejo_id);
  for (const c of cargos) out.set(`cargo:${c.id}`, c.unidad?.complejo_id ?? c.reciboConcepto?.recibo?.complejo_id ?? null);
  for (const p of pagos) out.set(`pago:${p.id}`, p.reciboConceptoUnidad?.unidad?.complejo_id ?? p.reciboConceptoUnidad?.reciboConcepto?.recibo?.complejo_id ?? null);
  return out;
}

export interface UsoWhatsapp {
  conectado: boolean;
  /** Día de Lima del contador de «hoy» (AAAA-MM-DD). */
  fecha: string;
  hoy: { enviados: number; tope: number | null; restantes: number | null };
  mes: { periodo: string; renueva: string; condominios: { complejo_id: number; nombre: string; usados: number; tope: number | null }[] };
  en_cola: { total: number; para_manana: number; por_tipo: PorTipo };
  fallidos_hoy: { total: number; motivos: { motivo: string; cantidad: number }[] };
  por_tipo: { hoy: PorTipo; mes: PorTipo };
}

const MAX_AVISOS_LEIDOS = 20_000;
const DIAS_COMUNICADOS_CON_GRUPOS = 30;

/**
 * El contador de la empresa: lo enviado hoy por su número (todos sus condominios) contra el tope diario, lo del mes por condominio contra su cuota,
 * lo que espera en cola, lo que falló hoy y el desglose por tipo. «Hoy» y «el mes» son de Lima. Nunca llama a Evolution: todo sale de la base.
 *
 * Los que salen de la cola 1-a-1 se ubican por la instancia con la que salieron. Los que esperan o fallaron aún no tienen instancia: se ubican por el
 * condominio al que se refiere el aviso. Un fallo de la cola no guarda la hora: «hoy» es el día en que le tocaba salir (`programada_para`).
 */
export async function usoWhatsapp(empresa: { id: number; whatsapp_instance: string | null }, ahora: Date): Promise<UsoWhatsapp> {
  const h = hoyEn(ZONA_POR_DEFECTO, ahora);
  const [anio, mes, dia] = [h.getUTCFullYear(), h.getUTCMonth() + 1, h.getUTCDate()];
  const desde = medianocheEn(ZONA_POR_DEFECTO, anio, mes, dia);
  const manana = medianocheEn(ZONA_POR_DEFECTO, anio, mes, dia + 1);
  const inicioMes = inicioMesEn(ZONA_POR_DEFECTO, ahora);
  const periodo = periodoDe(ahora);
  const cfg = await obtenerConfiguracion();

  const complejos = await prisma.complejoHabitacional.findMany({ where: { empresa_id: empresa.id }, orderBy: [{ nombre: 'asc' }, { id: 'asc' }], select: { id: true, nombre: true } });
  const complejoIds = complejos.map((c) => c.id);
  const instanciasDeGrupos = await prisma.envioGrupoWhatsapp.findMany({ where: { empresa_id: empresa.id, at: { gte: inicioMes } }, distinct: ['instancia'], select: { instancia: true } });
  const instancias = [...new Set([empresa.whatsapp_instance, ...instanciasDeGrupos.map((g) => g.instancia)].filter((x): x is string => !!x))];

  const enviadosPorTipo = async (desdeFecha: Date) => {
    const por = vacioPorTipo();
    const filas = instancias.length ? await prisma.notificacion.groupBy({ by: ['tipo'], where: { canal: 'whatsapp', estado: 'enviada', whatsapp_instancia: { in: instancias }, enviada_at: { gte: desdeFecha } }, _count: { _all: true } }) : [];
    for (const f of filas) por[tipoDe(f.tipo)] += f._count._all;
    por.grupo = await prisma.envioGrupoWhatsapp.count({ where: { empresa_id: empresa.id, estado: 'enviado', recibo_id: null, at: { gte: desdeFecha } } });
    por.recibo_emitido += await prisma.envioGrupoWhatsapp.count({ where: { empresa_id: empresa.id, estado: 'enviado', recibo_id: { not: null }, at: { gte: desdeFecha } } });
    return por;
  };
  const [porTipoHoy, porTipoMes, consumos, topes, avisos, gruposFallidos, comunicadosConGrupos] = await Promise.all([
    enviadosPorTipo(desde),
    enviadosPorTipo(inicioMes),
    prisma.consumoMensual.findMany({ where: { complejo_id: { in: complejoIds }, periodo, recurso: 'whatsapp' }, select: { complejo_id: true, cantidad: true } }),
    Promise.all(complejoIds.map((id) => topeDelMes(id, 'whatsapp'))),
    prisma.notificacion.findMany({
      where: { canal: 'whatsapp', OR: [{ estado: 'pendiente' }, { estado: { in: ['error', 'omitida'] }, programada_para: { gte: desde, lt: manana } }] },
      orderBy: { id: 'desc' },
      take: MAX_AVISOS_LEIDOS,
      select: { tipo: true, estado: true, error: true, ref_entidad: true, ref_id: true, programada_para: true },
    }),
    prisma.envioGrupoWhatsapp.findMany({ where: { empresa_id: empresa.id, estado: 'fallo', at: { gte: desde } }, select: { motivo: true } }),
    prisma.comunicado.findMany({ where: { complejo_id: { in: complejoIds }, enviar_grupo: true, created_at: { gte: new Date(ahora.getTime() - DIAS_COMUNICADOS_CON_GRUPOS * 86_400_000) } }, select: { grupos_resultado: true } }),
  ]);

  const cuando = await complejosDeAvisos(avisos);
  const mios = new Set(complejoIds);
  const delaEmpresa = avisos.filter((n) => { const k = claveDe(n); const c = k ? cuando.get(k) : null; return c != null && mios.has(c); });

  const enCola = vacioPorTipo();
  let paraManana = 0;
  const motivos = new Map<string, number>();
  let fallidos = 0;
  for (const n of delaEmpresa) {
    if (n.estado === 'pendiente') {
      enCola[tipoDe(n.tipo)]++;
      if (n.programada_para >= manana) paraManana++;
    } else {
      fallidos++;
      const m = n.error?.trim() || 'Sin motivo';
      motivos.set(m, (motivos.get(m) ?? 0) + 1);
    }
  }
  for (const g of gruposFallidos) {
    fallidos++;
    const m = g.motivo?.trim() || 'Sin motivo';
    motivos.set(m, (motivos.get(m) ?? 0) + 1);
  }
  // Mensajes a grupos que esperan (el tope diario los dejó pendientes): salen cuando se reintenta el comunicado.
  let gruposPendientes = 0;
  for (const c of comunicadosConGrupos) if (Array.isArray(c.grupos_resultado)) gruposPendientes += (c.grupos_resultado as { estado?: string }[]).filter((f) => f?.estado === 'pendiente').length;
  enCola.grupo = gruposPendientes;

  const enviadosHoy = TIPOS_CONTADOR.reduce((s, t) => s + porTipoHoy[t], 0);
  const tope = cfg.whatsapp_tope_diario != null && cfg.whatsapp_tope_diario > 0 ? cfg.whatsapp_tope_diario : null;
  return {
    conectado: !!empresa.whatsapp_instance,
    fecha: h.toISOString().slice(0, 10),
    hoy: { enviados: enviadosHoy, tope, restantes: tope == null ? null : Math.max(0, tope - enviadosHoy) },
    mes: { periodo, renueva: mesSiguienteTexto(ahora), condominios: complejos.map((c, i) => ({ complejo_id: c.id, nombre: c.nombre, usados: consumos.find((x) => x.complejo_id === c.id)?.cantidad ?? 0, tope: topes[i] ?? null })) },
    en_cola: { total: delaEmpresa.filter((n) => n.estado === 'pendiente').length + gruposPendientes, para_manana: paraManana + gruposPendientes, por_tipo: enCola },
    fallidos_hoy: { total: fallidos, motivos: [...motivos].map(([motivo, cantidad]) => ({ motivo, cantidad })).sort((a, b) => b.cantidad - a.cantidad || a.motivo.localeCompare(b.motivo, 'es')) },
    por_tipo: { hoy: porTipoHoy, mes: porTipoMes },
  };
}
