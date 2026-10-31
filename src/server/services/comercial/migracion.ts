import type { PrismaClient } from '@prisma/client';
import { CONFIGURACION_ID, MODULOS } from './catalogo';
import { estadoEfectivo, finDePrueba } from './estado';
import { invalidarComercial } from './modulos';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = Pick<PrismaClient<any, any, any>, 'complejoHabitacional' | 'suscripcionCondominio' | 'configuracionComercial' | 'planComercial'>;

/**
 * Los condominios que ya existían al estrenar la capa comercial (GRUPO VRANY, Los Libertadores…) quedan en «cortesía» con todos los módulos
 * y sin vencimiento: producción se comporta igual que antes. Sólo toca a los que NO tienen suscripción (idempotente) y, con `seco`, no escribe.
 */
export async function migrarACortesia(db: Cliente, opts: { seco?: boolean } = {}): Promise<{ sinSuscripcion: number; creadas: number; yaTenian: number }> {
  const [sin, ya] = await Promise.all([
    db.complejoHabitacional.findMany({ where: { suscripcion: null }, select: { id: true } }),
    db.suscripcionCondominio.count(),
  ]);
  if (opts.seco || !sin.length) return { sinSuscripcion: sin.length, creadas: 0, yaTenian: ya };
  const r = await db.suscripcionCondominio.createMany({
    data: sin.map((c) => ({ complejo_id: c.id, plan_clave: 'cortesia', modulos: [...MODULOS], estado: 'activa', notas: 'Condominio existente al estrenar los planes: cortesía de la casa.' })),
    skipDuplicates: true,
  });
  invalidarComercial();
  return { sinSuscripcion: sin.length, creadas: r.count, yaTenian: ya };
}

/**
 * Al arrancar el servidor, UNA sola vez cada paso: deja en cortesía los condominios que ya existen (anota la fecha en la configuración) y después les
 * fija su plazo de Gratis a los que cuentan como Gratis (`migracionGratis`). Los condominios creados después nacen en Gratis (el registro público y el
 * alta de un condominio le crean su suscripción con `gratis_hasta`; los que crea el superadmin sin fila cuentan como Gratis). Lo que devuelve es lo de
 * la cortesía: es lo que `server.ts` informa.
 */
export async function migracionInicial(db: Cliente): Promise<{ aplicada: boolean; creadas: number }> {
  const cfg = await db.configuracionComercial.findUnique({ where: { id: CONFIGURACION_ID }, select: { migracion_cortesia_at: true } });
  if (!cfg) return { aplicada: false, creadas: 0 };
  let resultado = { aplicada: false, creadas: 0 };
  if (!cfg.migracion_cortesia_at) {
    const r = await migrarACortesia(db);
    await db.configuracionComercial.updateMany({ where: { id: CONFIGURACION_ID, migracion_cortesia_at: null }, data: { migracion_cortesia_at: new Date() } });
    resultado = { aplicada: true, creadas: r.creadas };
  }
  const gratis = await migracionGratis(db);
  if (gratis.aplicada && gratis.fijados) console.log(`[comercial] plazo de Gratis fijado a ${gratis.fijados} condominios`);
  return resultado;
}

/**
 * Al arrancar el servidor, UNA sola vez: a los condominios que hoy cuentan como Gratis (sin suscripción, plan Gratis, prueba de Pro vigente o plan de
 * pago apagado) y no son cortesía les fija `gratis_hasta` = hoy (Lima) + `dias_gratis`, y anota la fecha en `migracion_gratis_at`. Los de plan de pago
 * vigente y la cortesía no se tocan. Idempotente: con la marca puesta no hace nada y, aun sin ella, nunca corre un `gratis_hasta` que ya existe.
 * El aviso al administrador («desde hoy Gratis dura 3 meses…») lo manda el ciclo de avisos: la suscripción queda sin la marca de aviso de inicio.
 */
export async function migracionGratis(db: Cliente, opts: { ahora?: Date } = {}): Promise<{ aplicada: boolean; fijados: number }> {
  const cfg = await db.configuracionComercial.findUnique({ where: { id: CONFIGURACION_ID }, select: { migracion_gratis_at: true, dias_gratis: true, dias_gracia: true, dias_aviso_vencimiento: true } });
  if (!cfg || cfg.migracion_gratis_at) return { aplicada: false, fijados: 0 };
  const ahora = opts.ahora ?? new Date();
  let fijados = 0;
  if (cfg.dias_gratis && cfg.dias_gratis > 0) {
    const fin = finDePrueba(cfg.dias_gratis, ahora);
    const [complejos, planes] = await Promise.all([
      db.complejoHabitacional.findMany({ select: { id: true, suscripcion: true } }),
      db.planComercial.findMany({ select: { clave: true, modulos_incluidos: true } }),
    ]);
    const plazos = { dias_gracia: cfg.dias_gracia, dias_aviso_vencimiento: cfg.dias_aviso_vencimiento };
    for (const c of complejos) {
      const sus = c.suscripcion;
      if (sus?.gratis_hasta) continue;
      const ef = estadoEfectivo(sus, planes, plazos, ahora);
      if (ef.plan_clave === 'cortesia') continue;
      if (!(ef.plan_clave === 'gratis' || ef.apagada || ef.en_prueba)) continue;
      if (sus) await db.suscripcionCondominio.update({ where: { id: sus.id }, data: { gratis_hasta: fin } });
      else await db.suscripcionCondominio.create({ data: { complejo_id: c.id, plan_clave: 'gratis', estado: 'gratis', gratis_hasta: fin, notas: 'Gratis con plazo: fijado al estrenar el límite de tiempo.' } });
      fijados++;
    }
    if (fijados) invalidarComercial();
  }
  await db.configuracionComercial.updateMany({ where: { id: CONFIGURACION_ID, migracion_gratis_at: null }, data: { migracion_gratis_at: ahora } });
  return { aplicada: true, fijados };
}
