// Comunicados al grupo de WhatsApp del block. El grupo se ELIGE de la lista que trae Evolution del número de la empresa (nunca se escribe a mano) y,
// justo antes de cada envío, se comprueba que el número siga entre los participantes: si lo sacaron, no se escribe y queda el motivo.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { ENLACE_APP } from '../avisos/plantillas';
import { MOTIVO_SIN_WHATSAPP, pausaMs } from '../avisos/cola';
import { obtenerConfiguracion } from '../comercial/configuracion';
import { MOTIVO_TOPE_WHATSAPP, reservarConsumo } from '../comercial/consumo';
import { moduloActivo } from '../comercial/modulos';
import { canalesDeps } from './deps';
import { enviarAGrupo, listarGrupos, numeroDeInstancia, participantesDeGrupo } from './evolution';

/** Cuánto del mensaje del comunicado va al grupo: lo lee todo el block, así que va corto y el resto se lee en Torre. */
export const MAX_CUERPO_GRUPO = 600;

export type EstadoGrupo = 'pendiente' | 'enviado' | 'fallo';
/** Lo que se guarda en `Comunicado.grupos_resultado`: una fila por block. */
export interface ResultadoGrupo { estructura_id: number; nombre: string; estado: EstadoGrupo; motivo?: string; at?: string }

/** «Block 3» si el block no tiene nombre. */
export const nombreDeBlock = (e: { id: number; nombre: string | null }): string => e.nombre?.trim() || `Block ${e.id}`;

/** «del Block 3», «de la Torre A», «de Los Pinos»: para frases como «el grupo del Block 3». */
function delBlock(nombre: string): string {
  if (/^torre\b/i.test(nombre)) return `de la ${nombre}`;
  if (/^(block|edificio|bloque)\b/i.test(nombre)) return `del ${nombre}`;
  return `de ${nombre}`;
}

/** Texto del grupo: título, cuerpo recortado y enlace. Sin datos personales ni montos propios (el cuerpo es lo que escribió quien publica). */
export function textoParaGrupo(c: { titulo: string; cuerpo: string }, condominio: string): string {
  const titulo = c.titulo.replace(/\*/g, '').trim();
  const cuerpo = c.cuerpo.trim();
  const corto = cuerpo.length > MAX_CUERPO_GRUPO ? `${cuerpo.slice(0, MAX_CUERPO_GRUPO).trimEnd()}…` : cuerpo;
  return `*${titulo}*\n\n${corto}\n\n${cuerpo.length > MAX_CUERPO_GRUPO ? 'Léelo completo' : 'Míralo también'} en Torre: ${ENLACE_APP}\n— Administración de ${condominio}`;
}

/** Blocks del alcance del comunicado que tienen grupo elegido (un block si el comunicado es de un block; todos los que tengan, si es del condominio). */
export async function bloquesConGrupo(a: { complejo_id: number; estructura_id: number | null }): Promise<{ id: number; nombre: string }[]> {
  const bloques = await prisma.estructura.findMany({
    where: { complejo_id: a.complejo_id, whatsapp_grupo_jid: { not: null }, ...(a.estructura_id != null ? { id: a.estructura_id } : {}) },
    orderBy: { id: 'asc' },
    select: { id: true, nombre: true },
  });
  return bloques.map((b) => ({ id: b.id, nombre: nombreDeBlock(b) }));
}

/** La instancia de WhatsApp de la empresa que administra el block (null si no tiene o no hay). */
export async function instanciaDeBlock(estructuraId: number): Promise<{ complejo_id: number; empresa_id: number | null; instancia: string | null } | null> {
  const e = await prisma.estructura.findUnique({ where: { id: estructuraId }, select: { complejo_id: true, complejo: { select: { empresa_id: true, empresa: { select: { whatsapp_instance: true } } } } } });
  if (!e?.complejo || e.complejo_id == null) return null;
  return { complejo_id: e.complejo_id, empresa_id: e.complejo.empresa_id, instancia: e.complejo.empresa?.whatsapp_instance?.trim() || null };
}

const leerFilas = (json: Prisma.JsonValue | null): ResultadoGrupo[] => (Array.isArray(json) ? (json as unknown as ResultadoGrupo[]) : []);

interface Veredicto { estado: 'enviado' | 'fallo'; motivo?: string; /** Qué queda en la ficha del block: `undefined` = no tocar, `null` = limpiar, texto = el aviso. */ aviso?: string | null }

/** Envía el comunicado a los grupos pendientes de su `grupos_resultado`, de a uno y guardando el resultado de cada block. Nunca lanza. */
export async function enviarComunicadoAGrupos(comunicadoId: number): Promise<void> {
  const c = await prisma.comunicado.findUnique({
    where: { id: comunicadoId },
    select: { id: true, complejo_id: true, titulo: true, cuerpo: true, grupos_resultado: true, complejo: { select: { nombre: true, empresa: { select: { whatsapp_instance: true } } } } },
  });
  if (!c) return;
  const filas = leerFilas(c.grupos_resultado);
  const instancia = c.complejo.empresa?.whatsapp_instance?.trim() || null;
  const texto = textoParaGrupo(c, c.complejo.nombre);
  const guardar = () => prisma.comunicado.update({ where: { id: c.id }, data: { grupos_resultado: filas as unknown as Prisma.InputJsonValue } });
  let hubo = false; // ya salió un mensaje a un grupo en esta tanda: el siguiente espera una pausa al azar
  for (const fila of filas) {
    if (fila.estado !== 'pendiente') continue;
    let v: Veredicto;
    try {
      v = await enviarUno(c.complejo_id, instancia, fila, texto, hubo);
    } catch (e) {
      console.error('[comunicados] grupo de WhatsApp:', e instanceof Error ? e.message : 'error');
      v = { estado: 'fallo', motivo: 'Error inesperado al enviar al grupo' };
    }
    if (v.estado === 'enviado') hubo = true;
    fila.estado = v.estado;
    fila.at = canalesDeps.ahora().toISOString();
    if (v.motivo) fila.motivo = v.motivo;
    else delete fila.motivo;
    await guardar();
    if (v.aviso !== undefined) {
      await prisma.estructura.updateMany({ where: { id: fila.estructura_id, complejo_id: c.complejo_id }, data: { whatsapp_grupo_aviso: v.aviso, whatsapp_grupo_aviso_at: v.aviso ? canalesDeps.ahora() : null } });
    }
  }
}

async function enviarUno(complejoId: number, instancia: string | null, fila: ResultadoGrupo, texto: string, hubo: boolean): Promise<Veredicto> {
  const e = await prisma.estructura.findFirst({ where: { id: fila.estructura_id, complejo_id: complejoId }, select: { id: true, nombre: true, whatsapp_grupo_jid: true } });
  const jid = e?.whatsapp_grupo_jid;
  if (!e || !jid) return { estado: 'fallo', motivo: `El ${fila.nombre} ya no tiene grupo de WhatsApp` };
  const nombre = nombreDeBlock(e);
  fila.nombre = nombre;
  if (!(await moduloActivo(complejoId, 'whatsapp_avisos'))) return { estado: 'fallo', motivo: MOTIVO_SIN_WHATSAPP };
  if (!instancia) return { estado: 'fallo', motivo: 'WhatsApp no está conectado: conéctalo en «WhatsApp» y vuelve a intentar' };

  // Validación justo antes de escribir: el número de la instancia tiene que seguir entre los participantes del grupo.
  const yaNoEsta = `El número ya no está en el grupo ${delBlock(nombre)}`;
  const noSePudo = `No se pudo comprobar el grupo ${delBlock(nombre)}`;
  const numero = await numeroDeInstancia(instancia);
  if (!numero) return { estado: 'fallo', motivo: `${noSePudo}: no se pudo confirmar el número de WhatsApp` };
  let participantes: string[];
  try {
    participantes = await participantesDeGrupo(instancia, jid);
  } catch {
    // Evolution no devuelve el grupo cuando el número ya no está: si tampoco aparece en la lista de sus grupos, lo sacaron.
    const lista = await listarGrupos(instancia).catch(() => null);
    return lista && !lista.some((g) => g.jid === jid) ? { estado: 'fallo', motivo: yaNoEsta, aviso: yaNoEsta } : { estado: 'fallo', motivo: noSePudo };
  }
  if (!participantes.includes(numero)) return { estado: 'fallo', motivo: yaNoEsta, aviso: yaNoEsta };

  // Cada mensaje a un grupo cuenta contra el tope mensual de WhatsApp del condominio (se reserva antes, como los avisos).
  if (!(await reservarConsumo(complejoId, 'whatsapp', canalesDeps.ahora())).permitido) return { estado: 'fallo', motivo: MOTIVO_TOPE_WHATSAPP };
  // Pausa al azar entre un grupo y el siguiente (anti-baneo): el primero sale sin esperar.
  if (hubo) await canalesDeps.esperar(pausaMs(await obtenerConfiguracion(), canalesDeps.azar()));
  const r = await enviarAGrupo(instancia, jid, texto);
  if (r.resultado === 'ok') return { estado: 'enviado', aviso: null };
  const motivo = `No se pudo escribir en el grupo ${delBlock(nombre)}: ${r.motivo}`;
  return { estado: 'fallo', motivo, aviso: motivo };
}

const enCurso = new Set<Promise<void>>();

/** Lanza el envío a los grupos sin hacer esperar la respuesta (con varios blocks la pausa entre grupos suma minutos). */
export function lanzarEnvioAGrupos(comunicadoId: number): void {
  const p: Promise<void> = enviarComunicadoAGrupos(comunicadoId).catch((e) => console.error('[comunicados] envío a grupos:', e instanceof Error ? e.message : 'error')).finally(() => { enCurso.delete(p); });
  enCurso.add(p);
}

/** Espera a que terminen los envíos a grupos que están en marcha (las pruebas y el cierre del servidor). */
export async function esperarEnviosAGrupos(): Promise<void> {
  while (enCurso.size) await Promise.allSettled([...enCurso]);
}
