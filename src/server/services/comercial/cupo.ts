// Gratis incluye UN condominio por administradora. Un condominio «cuenta como Gratis» si no tiene suscripción, su plan es Gratis, está en la
// prueba de Pro o está apagado (vencido pasada la gracia). Los que ya existen no se tocan: sólo se frena crear otro mientras la empresa tenga uno en Gratis.
// Se lee en fresco (sin la caché de `modulos.ts`): es una puerta de escritura y no debe decidir con un dato de hace 30 s.
import { prisma } from '../../db';
import { conflict } from '../../errors';
import { obtenerConfiguracion } from './configuracion';
import { estadoEfectivo } from './estado';
import { comercialDeps } from './modulos';

export const MENSAJE_GRATIS_UN_CONDOMINIO = 'Gratis incluye un condominio. Para agregar otro, pasa a Pro o Administradora el que ya tienes.';

export interface PuedeAgregarCondominio { puede: boolean; motivo: string | null; gratis: { id: number; nombre: string } | null }

/** Los condominios de la empresa que hoy cuentan como Gratis, el más antiguo primero. */
export async function condominiosEnGratis(empresaId: number, ahora: Date = comercialDeps.ahora()): Promise<{ id: number; nombre: string }[]> {
  const [complejos, planes, cfg] = await Promise.all([
    prisma.complejoHabitacional.findMany({ where: { empresa_id: empresaId }, orderBy: { id: 'asc' }, select: { id: true, nombre: true, suscripcion: true } }),
    prisma.planComercial.findMany({ select: { clave: true, modulos_incluidos: true, unidades_maximas: true } }),
    obtenerConfiguracion(),
  ]);
  const plazos = { dias_gracia: cfg.dias_gracia, dias_aviso_vencimiento: cfg.dias_aviso_vencimiento };
  return complejos
    .filter((c) => {
      const ef = estadoEfectivo(c.suscripcion, planes, plazos, ahora);
      // La prueba de Pro también cuenta: al vencer vuelve a Gratis, y si no, en esos días se podía crear otro y quedarse con dos gratis.
      return ef.plan_clave === 'gratis' || ef.apagada || ef.en_prueba;
    })
    .map(({ id, nombre }) => ({ id, nombre }));
}

/** ¿Puede la empresa crear otro condominio? Si ya tiene uno en Gratis, no; si todos están en un plan de pago vigente (o cortesía), sí. */
export async function puedeAgregarCondominio(empresaId: number): Promise<PuedeAgregarCondominio> {
  const [enGratis] = await condominiosEnGratis(empresaId);
  if (!enGratis) return { puede: true, motivo: null, gratis: null };
  return { puede: false, motivo: MENSAJE_GRATIS_UN_CONDOMINIO, gratis: enGratis };
}

/** 409 con el motivo si la empresa ya tiene un condominio en Gratis. No crea nada: lo llama antes de escribir el condominio nuevo. */
export async function exigirPuedeAgregarCondominio(empresaId: number): Promise<void> {
  if (!(await puedeAgregarCondominio(empresaId)).puede) throw conflict(MENSAJE_GRATIS_UN_CONDOMINIO);
}
