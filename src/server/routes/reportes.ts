import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../db';
import { decimalAString, filtroEstadoCargo } from '../lib/cargos';
import { diasEntre, hoyLima } from '../lib/fechas';
import { scopeCargos } from '../lib/scope';
import { currentUser, requireRole } from '../middleware/auth';
import { idSchema, listQuerySchema, parse, parseOrden } from '../validation';

export const reportesRouter = Router();

const ORDENABLES = ['deuda_total', 'cargos_vencidos', 'dias_max_atraso', 'codigo'];

reportesRouter.get('/morosidad', requireRole('admin'), async (req, res) => {
  const u = currentUser(req);
  const q = parse(listQuerySchema.extend({ estructura_id: idSchema.optional() }), req.query);
  const [campo, dir] = Object.entries(parseOrden(q.orden, ORDENABLES, { dias_max_atraso: 'desc' }))[0];
  const hoy = hoyLima();

  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: {
      AND: [scopeCargos(u), filtroEstadoCargo('vencido', hoy), { unidad_id: { not: null } }, q.q ? { unidad: { codigo: { contains: q.q, mode: 'insensitive' } } } : {}, q.estructura_id !== undefined ? { unidad: { estructura_id: q.estructura_id } } : {}],
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
    select: { id: true, codigo: true, estructura: { select: { id: true, nombre: true } }, propietario: { select: { id: true, nombre: true } } },
  });
  const filas = unidades.map((un) => {
    const a = porUnidad.get(un.id)!;
    return { unidad: { id: un.id, codigo: un.codigo }, estructura: un.estructura, propietario: un.propietario, deuda_total: decimalAString(a.deuda), cargos_vencidos: a.cargos, dias_max_atraso: a.maxDias };
  });

  const signo = dir === 'asc' ? 1 : -1;
  const valor = (f: (typeof filas)[number]) =>
    campo === 'deuda_total' ? Number(f.deuda_total) : campo === 'cargos_vencidos' ? f.cargos_vencidos : campo === 'codigo' ? f.unidad.codigo : f.dias_max_atraso;
  filas.sort((a, b) => {
    const [x, y] = [valor(a), valor(b)];
    const c = typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number);
    return c * signo || a.unidad.id - b.unidad.id;
  });

  const inicio = (q.page - 1) * q.pageSize;
  res.json({ items: filas.slice(inicio, inicio + q.pageSize), total: filas.length, page: q.page, pageSize: q.pageSize });
});
