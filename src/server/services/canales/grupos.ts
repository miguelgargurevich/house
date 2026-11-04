// Comunicados a los grupos de WhatsApp. Los grupos se ELIGEN entre los «Mis grupos» en uso de la empresa (guardados en Torre: nunca se escribe un JID a
// mano) y, justo antes de cada envío, se comprueba que el número siga entre los participantes. Cada mensaje cuenta para la cuota mensual del condominio
// y para el tope diario del número; con el tope alcanzado el grupo queda `pendiente`, sin enviar.
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { ENLACE_APP } from '../avisos/plantillas';
import { MOTIVO_SIN_WHATSAPP, pausaMs } from '../avisos/cola';
import { obtenerConfiguracion } from '../comercial/configuracion';
import { MOTIVO_TOPE_WHATSAPP, reservarConsumo } from '../comercial/consumo';
import { moduloActivo } from '../comercial/modulos';
import { canalesDeps } from './deps';
import { enviarAGrupo, listarGrupos, numeroDeInstancia, participantesDeGrupo, type GrupoWhatsapp } from './evolution';
import { aplicarListaDeEvolution, migrarGruposDeEstructuras } from './misGrupos';
import { cupoDiario, MOTIVO_TOPE_DIARIO, registrarEnvioGrupo } from './uso';
import { gruposDelRecibo } from './cobertura';

/** Cuánto del mensaje del comunicado va al grupo: lo lee todo el block, así que va corto y el resto se lee en Torre. */
export const MAX_CUERPO_GRUPO = 600;

export type EstadoGrupo = 'pendiente' | 'enviado' | 'fallo';
/**
 * Lo que se guarda en `Comunicado.grupos_resultado`: una fila por grupo elegido. Nunca lleva el JID (la junta también ve este resultado).
 * `estructura_id` sólo viene en los comunicados anteriores a «Mis grupos», que guardaban una fila por block.
 */
export interface ResultadoGrupo { grupo_id?: number; estructura_id?: number; nombre: string; estado: EstadoGrupo; motivo?: string; at?: string }

/** Texto del grupo: título, cuerpo recortado y enlace. Sin datos personales ni montos propios (el cuerpo es lo que escribió quien publica). */
export function textoParaGrupo(c: { titulo: string; cuerpo: string }, condominio: string): string {
  const titulo = c.titulo.replace(/\*/g, '').trim();
  const cuerpo = c.cuerpo.trim();
  const corto = cuerpo.length > MAX_CUERPO_GRUPO ? `${cuerpo.slice(0, MAX_CUERPO_GRUPO).trimEnd()}…` : cuerpo;
  return `*${titulo}*\n\n${corto}\n\n${cuerpo.length > MAX_CUERPO_GRUPO ? 'Léelo completo' : 'Míralo también'} en Torre: ${ENLACE_APP}\n— Administración de ${condominio}`;
}

const leerFilas = (json: Prisma.JsonValue | null): ResultadoGrupo[] => (Array.isArray(json) ? (json as unknown as ResultadoGrupo[]) : []);

interface Veredicto {
  estado: EstadoGrupo;
  motivo?: string;
  /** Qué queda en el grupo guardado: `undefined` = no tocar, `null` = limpiar, texto = el aviso («El número ya no está en el grupo…»). */
  aviso?: string | null;
}

/** Datos de una tanda de envíos: lo que no cambia de un grupo al siguiente. */
interface Tanda {
  /** El comunicado del envío; `null` cuando el envío es el aviso de un recibo. */
  comunicadoId: number | null;
  complejoId: number;
  empresaId: number | null;
  instancia: string | null;
  /** Ya salió un mensaje a un grupo en esta tanda: el siguiente espera una pausa al azar. */
  hubo: boolean;
  /** La lista de grupos del número, traída UNA vez y sólo si hace falta (Evolution tarda): con participantes `…@lid` es la única forma de confirmar que el número sigue. */
  lista?: Promise<GrupoWhatsapp[] | null>;
}

/** El grupo guardado al que apunta la fila. Las filas viejas (por block) se resuelven por el grupo en uso de ese block. */
async function grupoDeLaFila(empresaId: number | null, fila: ResultadoGrupo) {
  if (empresaId == null) return null;
  const base = { empresa_id: empresaId, en_uso: true };
  if (fila.grupo_id != null) return prisma.grupoWhatsapp.findFirst({ where: { ...base, id: fila.grupo_id } });
  if (fila.estructura_id != null) return prisma.grupoWhatsapp.findFirst({ where: { ...base, destino: 'block', estructura_id: fila.estructura_id }, orderBy: { id: 'asc' } });
  return null;
}

/** Envía el comunicado a los grupos pendientes de su `grupos_resultado`, de a uno y guardando el resultado de cada grupo. Nunca lanza. */
export async function enviarComunicadoAGrupos(comunicadoId: number): Promise<void> {
  const c = await prisma.comunicado.findUnique({
    where: { id: comunicadoId },
    select: { id: true, complejo_id: true, titulo: true, cuerpo: true, grupos_resultado: true, complejo: { select: { nombre: true, empresa_id: true, empresa: { select: { whatsapp_instance: true } } } } },
  });
  if (!c) return;
  const filas = leerFilas(c.grupos_resultado);
  const empresaId = c.complejo.empresa_id;
  if (empresaId != null) await migrarGruposDeEstructuras(empresaId).catch(() => 0); // un comunicado viejo (por block) puede apuntar a un grupo que aún no se pasó
  const tanda: Tanda = { comunicadoId: c.id, complejoId: c.complejo_id, empresaId, instancia: c.complejo.empresa?.whatsapp_instance?.trim() || null, hubo: false };
  const texto = textoParaGrupo(c, c.complejo.nombre);
  const guardar = () => prisma.comunicado.update({ where: { id: c.id }, data: { grupos_resultado: filas as unknown as Prisma.InputJsonValue } });
  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i]!;
    if (fila.estado !== 'pendiente') continue;
    const grupo = await grupoDeLaFila(empresaId, fila);
    let v: Veredicto;
    try {
      v = await enviarUno(tanda, grupo, fila, texto);
    } catch (e) {
      console.error('[comunicados] grupo de WhatsApp:', e instanceof Error ? e.message : 'error');
      v = { estado: 'fallo', motivo: 'Error inesperado al enviar al grupo' };
    }
    if (v.estado === 'enviado') tanda.hubo = true;
    if (grupo) fila.nombre = grupo.nombre;
    fila.estado = v.estado;
    fila.at = canalesDeps.ahora().toISOString();
    if (v.motivo) fila.motivo = v.motivo;
    else delete fila.motivo;
    if (v.estado !== 'pendiente' && empresaId != null && tanda.instancia) {
      await registrarEnvioGrupo({ empresa_id: empresaId, instancia: tanda.instancia, complejo_id: c.complejo_id, comunicado_id: c.id, grupo_id: grupo?.id ?? fila.grupo_id ?? null, estado: v.estado, motivo: v.motivo, ahora: canalesDeps.ahora() });
    }
    if (v.estado === 'pendiente') {
      // Tope diario: ningún otro grupo sale hoy. Todos los que faltan quedan pendientes con el mismo motivo.
      for (const resto of filas.slice(i + 1)) if (resto.estado === 'pendiente') resto.motivo = v.motivo;
      await guardar();
      return;
    }
    await guardar();
    if (grupo && v.aviso !== undefined) {
      await prisma.grupoWhatsapp.update({ where: { id: grupo.id }, data: { aviso: v.aviso, aviso_at: v.aviso ? canalesDeps.ahora() : null } });
    }
  }
}

async function enviarUno(t: Tanda, grupo: Awaited<ReturnType<typeof grupoDeLaFila>>, fila: ResultadoGrupo, texto: string): Promise<Veredicto> {
  if (!grupo) return { estado: 'fallo', motivo: `El grupo «${fila.nombre}» ya no está en uso en Torre` };
  const { instancia } = t;
  const nombre = grupo.nombre;
  // Un grupo en uso representa a un condominio: si ahora es de otro (o de ninguno), este comunicado no puede escribirle.
  if (grupo.complejo_id !== t.complejoId) return { estado: 'fallo', motivo: `El grupo «${nombre}» ya no está asignado a este condominio` };
  if (!(await moduloActivo(t.complejoId, 'whatsapp_avisos'))) return { estado: 'fallo', motivo: MOTIVO_SIN_WHATSAPP };
  if (!instancia) return { estado: 'fallo', motivo: 'WhatsApp no está conectado: conéctalo en «WhatsApp» y vuelve a intentar' };
  // Tope diario del número: pasado el tope no sale ni un mensaje más hoy (ni siquiera se le pregunta nada a Evolution).
  if ((await cupoDiario(instancia, canalesDeps.ahora())).alcanzado) return { estado: 'pendiente', motivo: MOTIVO_TOPE_DIARIO };

  // Validación justo antes de escribir: el número de la instancia tiene que seguir entre los participantes del grupo.
  const yaNoEsta = `El número ya no está en el grupo «${nombre}»`;
  const noSePudo = `No se pudo comprobar el grupo «${nombre}»`;
  const numero = await numeroDeInstancia(instancia);
  if (!numero) return { estado: 'fallo', motivo: `${noSePudo}: no se pudo confirmar el número de WhatsApp` };
  const lista = () => (t.lista ??= listarGrupos(instancia)
    .then(async (l) => { if (t.empresaId != null) await aplicarListaDeEvolution(t.empresaId, l).catch(() => null); return l; })
    .catch(() => null));
  let participantes: string[];
  try {
    participantes = await participantesDeGrupo(instancia, grupo.jid);
  } catch {
    // Evolution no devuelve el grupo cuando el número ya no está: si tampoco aparece en la lista de sus grupos, lo sacaron.
    const l = await lista();
    return l && !l.some((g) => g.jid === grupo.jid) ? { estado: 'fallo', motivo: yaNoEsta, aviso: yaNoEsta } : { estado: 'fallo', motivo: noSePudo };
  }
  if (!participantes.includes(numero)) {
    // WhatsApp ya no siempre da el número de cada participante: muchas veces trae un identificador interno (`…@lid`), también para el propio
    // número. La lista de grupos del número (`fetchAllGroups`) sólo trae aquellos donde sigue siendo participante: si el grupo está ahí, sigue.
    // Es lenta, así que se pide UNA vez por tanda y sólo si hace falta (y de paso deja al día «Mis grupos»).
    const l = await lista();
    if (!l) return { estado: 'fallo', motivo: noSePudo };
    if (!l.some((g) => g.jid === grupo.jid)) return { estado: 'fallo', motivo: yaNoEsta, aviso: yaNoEsta };
  }

  // Cada mensaje a un grupo cuenta contra el tope mensual de WhatsApp del condominio (se reserva antes, como los avisos).
  if (!(await reservarConsumo(t.complejoId, 'whatsapp', canalesDeps.ahora())).permitido) return { estado: 'fallo', motivo: MOTIVO_TOPE_WHATSAPP };
  // Pausa al azar entre un grupo y el siguiente (anti-baneo): el primero sale sin esperar.
  if (t.hubo) await canalesDeps.esperar(pausaMs(await obtenerConfiguracion(), canalesDeps.azar()));
  const r = await enviarAGrupo(instancia, grupo.jid, texto);
  if (r.resultado === 'ok') return { estado: 'enviado', aviso: null };
  const motivo = `No se pudo escribir en el grupo «${nombre}»: ${r.motivo}`;
  return { estado: 'fallo', motivo, aviso: motivo };
}

const enCurso = new Set<Promise<void>>();
const enMarcha = new Set<number>();

/** Lanza el envío a los grupos sin hacer esperar la respuesta (con varios grupos la pausa entre ellos suma minutos). Dos a la vez del mismo comunicado no se pisan. */
export function lanzarEnvioAGrupos(comunicadoId: number): void {
  if (enMarcha.has(comunicadoId)) return;
  enMarcha.add(comunicadoId);
  const p: Promise<void> = enviarComunicadoAGrupos(comunicadoId).catch((e) => console.error('[comunicados] envío a grupos:', e instanceof Error ? e.message : 'error')).finally(() => { enCurso.delete(p); enMarcha.delete(comunicadoId); });
  enCurso.add(p);
}

const enMarchaRecibo = new Set<number>();

/**
 * Manda el aviso de un recibo a los grupos que le tocan (el de su block, o el del condominio) y que aún no lo tienen: UN mensaje por grupo y recibo,
 * así que repetir no lo duplica. Con el tope diario alcanzado el grupo queda `pendiente` y no se anota: otro «Avisar» lo intenta de nuevo. Cada envío
 * cuenta para la cuota y el tope, como los de los comunicados. Devuelve lo que pasó con cada grupo (sin JID). Nunca lanza.
 */
export async function enviarAvisoReciboAGrupos(reciboId: number): Promise<ResultadoGrupo[]> {
  const g = await gruposDelRecibo(reciboId).catch(() => null);
  if (!g || !g.listos.length || g.empresa_id == null || g.complejo_id == null) return [];
  const tanda: Tanda = { comunicadoId: null, complejoId: g.complejo_id, empresaId: g.empresa_id, instancia: g.instancia, hubo: false };
  const resultado: ResultadoGrupo[] = [];
  for (const destino of g.listos) {
    const fila: ResultadoGrupo = { grupo_id: destino.id, nombre: destino.nombre, estado: 'pendiente' };
    const grupo = await grupoDeLaFila(g.empresa_id, fila);
    let v: Veredicto;
    try {
      v = await enviarUno(tanda, grupo, fila, g.texto);
    } catch (e) {
      console.error('[avisos] grupo del recibo:', e instanceof Error ? e.message : 'error');
      v = { estado: 'fallo', motivo: 'Error inesperado al enviar al grupo' };
    }
    if (v.estado === 'pendiente') {
      resultado.push({ ...fila, motivo: v.motivo });
      break; // tope diario: ningún otro grupo sale hoy
    }
    if (v.estado === 'enviado') tanda.hubo = true;
    if (tanda.instancia) await registrarEnvioGrupo({ empresa_id: g.empresa_id, instancia: tanda.instancia, complejo_id: g.complejo_id, comunicado_id: null, recibo_id: reciboId, grupo_id: destino.id, estado: v.estado, motivo: v.motivo, ahora: canalesDeps.ahora() });
    if (grupo && v.aviso !== undefined) await prisma.grupoWhatsapp.update({ where: { id: grupo.id }, data: { aviso: v.aviso, aviso_at: v.aviso ? canalesDeps.ahora() : null } });
    resultado.push({ ...fila, estado: v.estado, ...(v.motivo ? { motivo: v.motivo } : {}) });
  }
  return resultado;
}

/** Lanza el aviso de un recibo a sus grupos sin hacer esperar la respuesta (la pausa entre grupos suma minutos). Dos a la vez del mismo recibo no se pisan. */
export function lanzarAvisoReciboAGrupos(reciboId: number): void {
  if (enMarchaRecibo.has(reciboId)) return;
  enMarchaRecibo.add(reciboId);
  const p: Promise<void> = enviarAvisoReciboAGrupos(reciboId).then(() => undefined).catch((e) => console.error('[avisos] grupos del recibo:', e instanceof Error ? e.message : 'error')).finally(() => { enCurso.delete(p); enMarchaRecibo.delete(reciboId); });
  enCurso.add(p);
}

/** Espera a que terminen los envíos a grupos que están en marcha (las pruebas y el cierre del servidor). */
export async function esperarEnviosAGrupos(): Promise<void> {
  while (enCurso.size) await Promise.allSettled([...enCurso]);
}
