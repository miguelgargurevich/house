// «Prueba» de una clave de verdad: lista los modelos (y sincroniza el catálogo) y hace UNA consulta mínima de chat con el modelo
// que se usaría. Sólo se marca `ok` si el modelo respondió texto. La usan el botón «Probar», la recuperación de claves rechazadas y el canary.
import { prisma } from '../../db';
import { notFound } from '../../errors';
import { claveCooldown, limpiar } from '../../lib/cooldown';
import { proveedorPorId } from '../../lib/proveedoresIA';
import { exigirConfigurado } from '../llavero';
import { retirarModelo } from '../modelos/retiro';
import { elegirModeloAuto } from '../modelos/seleccion';
import { sincronizarClave } from '../modelos/sync';
import { ESTADO_RECHAZADA, eslabonDeFila, type Eslabon } from '../rotacion';
import { consultaMinima, type Fallo } from './proveedor';
import { olvidarCausa } from './salud';

export type TipoPrueba = 'ok' | 'rechazada' | 'sin_saldo' | 'limite' | 'modelo' | 'tiempo' | 'red' | 'caido' | 'sin_texto' | 'peticion';
export interface ResultadoPrueba { tipo: TipoPrueba; modelo: string; detalle: string | null; fallo: Fallo | null }

/** Texto accionable (sin jerga) para cada resultado fallido de la consulta mínima. */
export function detalleDePrueba(tipo: Exclude<TipoPrueba, 'ok'>, modelo: string): string {
  switch (tipo) {
    case 'rechazada': return 'La clave fue rechazada';
    case 'sin_saldo': return 'La cuenta no tiene saldo';
    case 'limite': return 'Límite del proveedor';
    case 'modelo': return `La clave sirve pero el modelo ${modelo} no está disponible (se probará otro)`;
    case 'tiempo': return 'El proveedor no respondió a tiempo';
    case 'red': return 'No se pudo conectar con el proveedor';
    case 'caido': return 'El proveedor tuvo un problema, intenta más tarde';
    case 'sin_texto': return `El modelo ${modelo} no devolvió texto`;
    case 'peticion': return `El modelo ${modelo} no aceptó la consulta de prueba`;
  }
}

export function tipoDeFallo(f: Fallo): Exclude<TipoPrueba, 'ok'> {
  if (f.modeloNoDisponible) return 'modelo';
  if (f.status === 401 || f.status === 403 || f.claveInvalida) return 'rechazada';
  if (f.status === 402) return 'sin_saldo';
  if (f.status === 429) return 'limite';
  if (f.status === 0) return f.tiempoAgotado ? 'tiempo' : 'red';
  if (f.sinTexto) return 'sin_texto';
  if (f.status === 400) return 'peticion';
  return 'caido';
}

/** Una consulta mínima de chat con el modelo que el modo Auto elegiría para esa clave. Si el modelo no existe, lo retira (se probará otro la próxima vez). */
export async function pruebaDeChat(e: Eslabon): Promise<ResultadoPrueba> {
  const modelo = await elegirModeloAuto({ claveId: e.claveId, proveedor: e.proveedor, modelo: e.fijado }, { esfuerzo: 'medium' }); // el modelo que el Auto usaría de verdad en una consulta normal
  const r = await consultaMinima(e, modelo);
  if (r.tipo === 'completa') {
    if (r.texto.trim()) return { tipo: 'ok', modelo, detalle: null, fallo: null };
    return { tipo: 'sin_texto', modelo, detalle: detalleDePrueba('sin_texto', modelo), fallo: null };
  }
  const tipo = tipoDeFallo(r);
  if (tipo === 'modelo') await retirarModelo(e, modelo);
  return { tipo, modelo, detalle: detalleDePrueba(tipo, modelo), fallo: r };
}

const PUBLICA_PRUEBA = {
  id: true, proveedor: true, etiqueta: true, ultimos4: true, modelo: true, habilitada: true, reserva: true, aviso_modelo: true,
  estado: true, estado_detalle: true, probada_at: true, ultimo_uso_at: true,
} as const;

/**
 * «Probar»: 1) `GET /models` (sincroniza el catálogo); 2) una consulta mínima de chat. `ok` sólo si respondió texto.
 * Una clave ya rechazada sigue rechazada mientras la prueba no salga bien.
 */
export async function probar(id: number) {
  exigirConfigurado();
  const f = await prisma.claveIntegracion.findUnique({ where: { id } });
  if (!f) throw notFound('Clave');
  if (!proveedorPorId(f.proveedor)) throw notFound('Proveedor');

  let estado: string;
  let detalle: string | null;
  let modeloProbado: string | null = null;
  const sync = await sincronizarClave(id);
  if (!sync?.ok) {
    estado = 'error';
    detalle = sync?.error ?? 'No se pudo conectar con el proveedor';
  } else {
    const fresca = await prisma.claveIntegracion.findUniqueOrThrow({ where: { id } }); // el sync pudo soltar el modelo fijado
    const e = eslabonDeFila(fresca);
    if (!e) { estado = 'error'; detalle = 'No se pudo leer la clave guardada'; }
    else {
      const p = await pruebaDeChat(e);
      modeloProbado = p.modelo;
      if (p.tipo === 'ok') { estado = 'ok'; detalle = null; } else { estado = 'error'; detalle = p.detalle; }
    }
  }
  if (estado === 'ok') { limpiar(claveCooldown(f.proveedor, f.id)); olvidarCausa(claveCooldown(f.proveedor, f.id)); }
  if (estado === 'error' && f.estado === ESTADO_RECHAZADA) estado = ESTADO_RECHAZADA;
  const fila = await prisma.claveIntegracion.update({ where: { id }, data: { estado, estado_detalle: detalle, probada_at: new Date() }, select: PUBLICA_PRUEBA });
  return { ...fila, modelo_probado: modeloProbado, sync: sync ? { ok: sync.ok, nuevos: sync.nuevos, deprecados: sync.deprecados, revividos: sync.revividos, total: sync.total } : null };
}
