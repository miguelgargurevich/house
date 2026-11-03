/**
 * Estado de cuenta (EECC) de un departamento. Disponible en todos los planes (es lo básico de cobrar): sin módulo que lo apague.
 * El alcance (empresa, block de la junta, unidades propias) está en `services/estadoCuenta.ts › alcanceEstadoCuenta`; una unidad fuera de él → 404.
 */
import { Router } from 'express';
import { currentUser, requireRole } from '../middleware/auth';
import { idParams, parse, z } from '../validation';
import { alcanceEstadoCuenta, estadoCuentaUnidad, estadoCuentaXlsx, type MesAnio } from '../services/estadoCuenta';

export const estadoCuentaRouter = Router();

/** `AAAA-MM` → {anio, mes}. */
const mesAnio = z
  .string({ error: 'Debe ser un texto AAAA-MM' })
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Debe ser un mes con formato AAAA-MM')
  .refine((v) => Number(v.slice(0, 4)) >= 2000 && Number(v.slice(0, 4)) <= 2100, 'Año fuera de rango')
  .transform((v): MesAnio => ({ anio: Number(v.slice(0, 4)), mes: Number(v.slice(5)) }));

const query = z
  .object({ desde: mesAnio.optional(), hasta: mesAnio.optional() })
  .refine((q) => !q.desde || !q.hasta || q.desde.anio * 12 + q.desde.mes <= q.hasta.anio * 12 + q.hasta.mes, { path: ['desde'], message: '«desde» no puede ser posterior a «hasta»' });

const residentesYAdmin = requireRole('admin', 'propietario', 'inquilino');

/**
 * @openapi
 * /api/estado-cuenta/unidades/{id}:
 *   get:
 *     summary: Estado de cuenta (EECC) de un departamento
 *     description: Cuenta corriente por recibo con cargos, mora, pagos y saldo acumulado. Admin/superadmin de la empresa del condominio, la junta (su block, o todo el condominio si no tiene block) y el propietario o inquilino de la unidad. Otra unidad → 404.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *       - { in: query, name: desde, schema: { type: string, example: "2026-01" }, description: "Primer mes (AAAA-MM). Por defecto, los últimos 12 meses con recibo." }
 *       - { in: query, name: hasta, schema: { type: string, example: "2026-10" }, description: "Último mes (AAAA-MM). Por defecto, hasta el último recibo." }
 *     responses:
 *       200: { description: El estado de cuenta }
 *       404: { description: Unidad inexistente o fuera de tu alcance }
 *       422: { description: Rango inválido }
 */
estadoCuentaRouter.get('/unidades/:id', residentesYAdmin, async (req, res) => {
  const { id } = parse(idParams, req.params);
  const q = parse(query, req.query);
  res.set('Cache-Control', 'private, no-store');
  res.json(await estadoCuentaUnidad(alcanceEstadoCuenta(currentUser(req)), id, { desde: q.desde, hasta: q.hasta }));
});

/** Las mismas filas en un `.xlsx` (hojas «Resumen», «Cuenta corriente» y «Pagos»). */
estadoCuentaRouter.get('/unidades/:id/estado-cuenta.xlsx', residentesYAdmin, async (req, res) => {
  const { id } = parse(idParams, req.params);
  const q = parse(query, req.query);
  const e = await estadoCuentaUnidad(alcanceEstadoCuenta(currentUser(req)), id, { desde: q.desde, hasta: q.hasta });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="estado-cuenta-${e.unidad.codigo.replace(/[^\w.-]+/g, '_')}.xlsx"`,
    'Cache-Control': 'private, no-store',
  });
  res.send(estadoCuentaXlsx(e));
});
