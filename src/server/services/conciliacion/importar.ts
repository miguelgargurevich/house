// Importar un extracto: lee los abonos, no duplica los que ya estaban (huella por cuenta + fecha + monto + operación + descripción), guarda sólo los abonos
// (nunca el archivo) y cruza la cuenta, todo en una transacción con la cuenta bloqueada.
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { invalid } from '../../errors';
import { bloquearCuenta, cruzarEn, type CuentaDeConciliacion, type ResultadoCruce } from './cruce';
import { leerExtracto, normalizar, normalizarOperacion, type Descartes, type Mapeo } from './lectura';

const dia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Una huella por abono. Dos abonos idénticos el mismo día (dos vecinos que transfirieron lo mismo, sin número de operación) se distinguen por el orden en que
 * aparecen entre los idénticos: re-subir el mismo extracto produce las mismas huellas, así que no se duplica nada, y los dos abonos reales se conservan.
 */
export function huellasDe(medioId: number, abonos: { fecha: Date; monto: Prisma.Decimal; descripcion: string; operacion: string | null }[]): string[] {
  const vistos = new Map<string, number>();
  return abonos.map((a) => {
    const clave = [medioId, dia(a.fecha), a.monto.toFixed(2), normalizarOperacion(a.operacion) ?? '', normalizar(a.descripcion)].join('|');
    const n = (vistos.get(clave) ?? 0) + 1;
    vistos.set(clave, n);
    return createHash('sha256').update(`${clave}|${n}`).digest('hex');
  });
}

export interface ExtractoGuardado {
  id: number;
  archivo_nombre: string;
  fecha_desde: string | null;
  fecha_hasta: string | null;
  filas_leidas: number;
  filas_nuevas: number;
  filas_repetidas: number;
  total_abonos: string;
  created_at: Date;
}
export type SalidaImportar =
  | { requiere_mapeo: true; vista: string[][]; mapeo_guardado: Mapeo | null }
  | { requiere_mapeo: false; extracto: ExtractoGuardado; cruce: ResultadoCruce; descartes: Descartes; mapeo: Mapeo };

export const formatearExtracto = (e: { id: number; archivo_nombre: string; fecha_desde: Date | null; fecha_hasta: Date | null; filas_leidas: number; filas_nuevas: number; filas_repetidas: number; total_abonos: Prisma.Decimal; created_at: Date }): ExtractoGuardado => ({
  id: e.id,
  archivo_nombre: e.archivo_nombre,
  fecha_desde: e.fecha_desde ? dia(e.fecha_desde) : null,
  fecha_hasta: e.fecha_hasta ? dia(e.fecha_hasta) : null,
  filas_leidas: e.filas_leidas,
  filas_nuevas: e.filas_nuevas,
  filas_repetidas: e.filas_repetidas,
  total_abonos: new Prisma.Decimal(e.total_abonos).toFixed(2),
  created_at: e.created_at,
});

const mapeoGuardado = (v: Prisma.JsonValue | null | undefined): Mapeo | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : null);
  const fecha = n(m.fecha);
  const abono = n(m.abono);
  const inicio = n(m.fila_inicio);
  return fecha == null || abono == null || inicio == null ? null : { fecha, abono, fila_inicio: inicio, descripcion: n(m.descripcion), cargo: n(m.cargo), operacion: n(m.operacion) };
};

export async function importarExtracto(entrada: { cuenta: CuentaDeConciliacion; buffer: Buffer; nombre: string; usuarioId: number; mapeo?: Mapeo | null }): Promise<SalidaImportar> {
  const { cuenta } = entrada;
  const cfg = await prisma.configuracionConciliacion.findUnique({ where: { medio_pago_id: cuenta.id }, select: { columnas: true } });
  const guardado = mapeoGuardado(cfg?.columnas);
  const lectura = leerExtracto(entrada.buffer, entrada.nombre, { mapeo: entrada.mapeo ?? null, guardado });
  if (!lectura.reconocido || !lectura.mapeo) {
    // Si el administrador mandó columnas y no sirven (fuera de rango), se vuelve a pedir; si no se reconoce nada, se muestran las primeras filas para que elija.
    return { requiere_mapeo: true, vista: lectura.vista, mapeo_guardado: guardado };
  }
  if (lectura.abonos.length === 0) throw invalid('No se encontró ningún abono en el extracto (sólo cargos, o las columnas elegidas no son las correctas)', { archivo: 'Sin abonos' });
  const { abonos, mapeo } = lectura;
  const huellas = huellasDe(cuenta.id, abonos);

  return prisma.$transaction(async (tx) => {
    await bloquearCuenta(tx, cuenta.id);
    const existentes = new Set<string>();
    for (let i = 0; i < huellas.length; i += 2000) {
      for (const f of await tx.movimientoBancario.findMany({ where: { medio_pago_id: cuenta.id, huella: { in: huellas.slice(i, i + 2000) } }, select: { huella: true } })) existentes.add(f.huella);
    }
    const nuevos = abonos.map((a, i) => ({ a, huella: huellas[i]! })).filter((x) => !existentes.has(x.huella));
    const fechas = abonos.map((a) => a.fecha.getTime());
    const extracto = await tx.extractoBancario.create({
      data: {
        complejo_id: cuenta.complejo_id,
        medio_pago_id: cuenta.id,
        archivo_nombre: entrada.nombre.slice(0, 200),
        fecha_desde: new Date(Math.min(...fechas)),
        fecha_hasta: new Date(Math.max(...fechas)),
        filas_leidas: abonos.length,
        subido_por_id: entrada.usuarioId,
      },
    });
    const { count } = await tx.movimientoBancario.createMany({
      data: nuevos.map(({ a, huella }) => ({
        extracto_id: extracto.id,
        complejo_id: cuenta.complejo_id,
        medio_pago_id: cuenta.id,
        fecha: a.fecha,
        descripcion: a.descripcion,
        monto: a.monto,
        numero_operacion: a.operacion,
        huella,
      })),
      skipDuplicates: true,
    });
    const total = nuevos.reduce((s, x) => s.plus(x.a.monto), new Prisma.Decimal(0));
    const guardadoExtracto = await tx.extractoBancario.update({ where: { id: extracto.id }, data: { filas_nuevas: count, filas_repetidas: abonos.length - count, total_abonos: total } });
    // Sólo se recuerda el mapeo que el administrador eligió a mano (el detectado solo se vuelve a detectar).
    if (entrada.mapeo) {
      await tx.configuracionConciliacion.upsert({ where: { medio_pago_id: cuenta.id }, create: { medio_pago_id: cuenta.id, columnas: { ...mapeo } }, update: { columnas: { ...mapeo } } });
    }
    const cruce = await cruzarEn(tx, cuenta);
    return { requiere_mapeo: false as const, extracto: formatearExtracto(guardadoExtracto), cruce, descartes: lectura.descartes, mapeo };
  }, { timeout: 60_000, maxWait: 15_000 });
}
