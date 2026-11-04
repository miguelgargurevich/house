import { Router } from 'express';
import { currentUser, requireRole } from '../middleware/auth';
import { procesarPronto } from '../services/avisos';
import { CANALES } from '../services/avisos/canales';
import { exigirOperativo } from '../services/comercial/operativo';
import { encolarDeuda, planDeuda, type PlanDeuda } from '../services/recordatorios/deuda';
import { idSchema, parseBody, z } from '../validation';

const MAX_UNIDADES = 500;

const deudaSchema = z.object({
  unidades: z.array(idSchema, { error: 'Debe ser una lista de departamentos' }).min(1, 'Elige al menos un departamento').max(MAX_UNIDADES, `Máximo ${MAX_UNIDADES} departamentos`),
  canales: z.array(z.enum(CANALES, { error: 'Canal inválido' }), { error: 'Debe ser una lista de canales' }).min(1, 'Elige al menos un canal').max(CANALES.length),
  /** Sin `confirmar` (o en `false`) sólo se calcula la vista previa: no se encola nada. */
  confirmar: z.boolean({ error: 'Debe ser verdadero o falso' }).default(false),
});

/** Lo que sale a la pantalla: el plan sin lo interno (qué fila va a qué persona). */
const publico = ({ filas: _filas, complejos: _complejos, ...plan }: PlanDeuda) => plan;

export const recordatoriosRouter = Router();
recordatoriosRouter.use((_req, res, next) => {
  res.locals.entidad = 'recordatorio';
  next();
});
// Sólo la administración (como «Morosidad», de donde se manda). La junta no lo ve hoy.
recordatoriosRouter.use(requireRole('admin'));

/**
 * @openapi
 * /api/recordatorios/deuda:
 *   post:
 *     summary: Recordatorio de deuda a los departamentos marcados en Morosidad (sólo al responsable de pago de cada uno)
 *     tags: [Recordatorios]
 *     description: >
 *       Sin `confirmar` devuelve la vista previa y NO encola nada. Con `confirmar: true` encola un aviso `recordatorio_deuda` por departamento y canal, al
 *       responsable de pago, con lo que debe hoy (vencido, sin abonos validados). Respeta las preferencias de cada persona. A un departamento se le recuerda una sola vez por día de Lima.
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { type: object, required: [unidades, canales], properties: { unidades: { type: array, items: { type: integer } }, canales: { type: array, items: { type: string, enum: [email, whatsapp] } }, confirmar: { type: boolean } } } } }
 *     responses:
 *       200: { description: "`{ confirmado, unidades, sin_deuda, ya_recordadas_hoy, responsables, por_avisar, por_correo, por_whatsapp, sin_canal, whatsapp: [cuota por condominio], ejemplo: { asunto, cuerpo }|null, avisos_encolados? }`" }
 *       403: { description: "No es administración" }
 *       404: { description: "Algún departamento no existe o es de otra empresa (no se encola nada)" }
 *       422: { description: "Datos inválidos" }
 */
recordatoriosRouter.post('/deuda', async (req, res) => {
  const u = currentUser(req);
  const d = parseBody(deudaSchema, req);
  const ahora = new Date();
  const plan = await planDeuda(u, d, ahora);
  res.locals.accion = d.confirmar ? 'recordar_deuda' : 'vista_previa_recordar_deuda';
  // Sólo cantidades e ids de departamento: nunca nombres, correos ni celulares.
  const resumen = { unidades_ids: [...new Set(d.unidades)], canales: d.canales, sin_deuda: plan.sin_deuda, ya_recordadas_hoy: plan.ya_recordadas_hoy, por_avisar: plan.por_avisar, por_correo: plan.por_correo, por_whatsapp: plan.por_whatsapp, sin_canal: plan.sin_canal };
  if (!d.confirmar) {
    res.locals.auditDetalle = resumen;
    res.json({ confirmado: false, ...publico(plan) });
    return;
  }
  for (const complejo of plan.complejos) await exigirOperativo(complejo, u);
  const avisos = await encolarDeuda(plan, ahora);
  if (avisos > 0) procesarPronto();
  res.locals.auditDetalle = { ...resumen, avisos_encolados: avisos };
  res.json({ confirmado: true, ...publico(plan), avisos_encolados: avisos });
});
