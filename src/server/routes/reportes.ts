import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { MONEDA_POR_DEFECTO } from '../../lib/paises';
import { prisma } from '../db';
import { decimalAString, filtroEstadoCargo } from '../lib/cargos';
import { diasEntre, hoyLima } from '../lib/fechas';
import { scopeCargos } from '../lib/scope';
import { currentUser, requireRole } from '../middleware/auth';
import { complejosConModulo, complejosDe, moduloNoActivo } from '../services/comercial/modulos';
import { idSchema, listQuerySchema, parse, parseOrden } from '../validation';

export const reportesRouter = Router();

const ORDENABLES = ['deuda_total', 'cargos_vencidos', 'dias_max_atraso', 'codigo'];

reportesRouter.get('/morosidad', requireRole('admin'), async (req, res) => {
  const u = currentUser(req);
  const q = parse(listQuerySchema.extend({ estructura_id: idSchema.optional(), complejo_id: idSchema.optional() }), req.query);
  const [campo, dir] = Object.entries(parseOrden(q.orden, ORDENABLES, { dias_max_atraso: 'desc' }))[0];
  const hoy = hoyLima();
  // Los reportes son del plan Pro: sólo cuentan los condominios que lo tienen. Si ninguno de los tuyos lo tiene (o el que pides es tuyo y no lo tiene),
  // 403 «Disponible en el plan Pro». Un condominio que no es tuyo sigue dando una lista vacía (no revela que existe), como siempre.
  const [alcance, conReportes] = await Promise.all([complejosDe(u), complejosConModulo(u, 'reportes')]);
  if (alcance !== null && conReportes !== null && alcance.length > 0) {
    const pedidoEsMio = q.complejo_id !== undefined && alcance.includes(q.complejo_id);
    if (conReportes.length === 0 || (pedidoEsMio && !conReportes.includes(q.complejo_id!))) throw moduloNoActivo('reportes');
  }

  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: {
      AND: [scopeCargos(u), filtroEstadoCargo('vencido', hoy), { unidad_id: { not: null } }, ...(conReportes !== null ? [{ unidad: { complejo_id: { in: conReportes } } }] : []), q.q ? { unidad: { codigo: { contains: q.q, mode: 'insensitive' } } } : {}, q.estructura_id !== undefined ? { unidad: { estructura_id: q.estructura_id } } : {}, q.complejo_id !== undefined ? { unidad: { complejo_id: q.complejo_id } } : {}],
    },
    select: { unidad_id: true, monto: true, reciboConcepto: { select: { recibo: { select: { fecha_vencimiento: true } } } } },
  });

  const porUnidad = new Map<number, { deuda: Prisma.Decimal; cargos: number; maxDias: number }>();
  for (const c of cargos) {
    const venc = c.reciboConcepto?.recibo?.fecha_vencimiento;
    const acc = porUnidad.get(c.unidad_id!) ?? { deuda: new Prisma.Decimal(0), cargos: 0, maxDias: 0 };
    acc.deuda = acc.deuda.plus(c.monto);
    acc.cargos += 1;
    if (venc) acc.maxDias = Math.max(acc.maxDias, diasEntre(venc, hoy));
    porUnidad.set(c.unidad_id!, acc);
  }

  const unidades = await prisma.unidad.findMany({
    where: { id: { in: [...porUnidad.keys()] } },
    select: { id: true, codigo: true, complejo: { select: { id: true, nombre: true, moneda: true } }, estructura: { select: { id: true, nombre: true } }, propietario: { select: { id: true, nombre: true } } },
  });
  const filas = unidades.map((un) => {
    const a = porUnidad.get(un.id)!;
    return { unidad: { id: un.id, codigo: un.codigo }, complejo: un.complejo, moneda: un.complejo?.moneda ?? MONEDA_POR_DEFECTO, estructura: un.estructura, propietario: un.propietario, deuda_total: decimalAString(a.deuda), cargos_vencidos: a.cargos, dias_max_atraso: a.maxDias };
  });

  const signo = dir === 'asc' ? 1 : -1;
  const valor = (f: (typeof filas)[number]) =>
    campo === 'deuda_total' ? Number(f.deuda_total) : campo === 'cargos_vencidos' ? f.cargos_vencidos : campo === 'codigo' ? f.unidad.codigo : f.dias_max_atraso;
  filas.sort((a, b) => {
    // La deuda de monedas distintas no se compara: se ordena dentro de cada moneda.
    if (campo === 'deuda_total' && a.moneda !== b.moneda) return a.moneda.localeCompare(b.moneda);
    const [x, y] = [valor(a), valor(b)];
    const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
    return c * signo || a.unidad.id - b.unidad.id;
  });

  // Las cifras de arriba son de TODO el filtro (no sólo de la página cargada). Con condominios de monedas distintas la deuda nunca se suma:
  // `deuda_total` queda en null y las cifras van por moneda en `por_moneda`.
  const cifras = (fs: typeof filas) => ({ unidades: fs.length, deuda_total: decimalAString(fs.reduce((s, f) => s.plus(f.deuda_total), new Prisma.Decimal(0))), cargos_vencidos: fs.reduce((s, f) => s + f.cargos_vencidos, 0) });
  const monedas = [...new Set(filas.map((f) => f.moneda))].sort();
  const resumen = monedas.length > 1
    ? { ...cifras(filas), deuda_total: null, moneda: null, por_moneda: Object.fromEntries(monedas.map((m) => [m, cifras(filas.filter((f) => f.moneda === m))])) }
    : { ...cifras(filas), moneda: monedas[0] ?? MONEDA_POR_DEFECTO };
  const inicio = (q.page - 1) * q.pageSize;
  res.json({ items: filas.slice(inicio, inicio + q.pageSize), total: filas.length, page: q.page, pageSize: q.pageSize, resumen });
});
