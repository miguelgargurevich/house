import type { PrismaClient } from '@prisma/client';
import { CONFIGURACION_ID, MODULOS } from './catalogo';
import { invalidarComercial } from './modulos';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = Pick<PrismaClient<any, any, any>, 'complejoHabitacional' | 'suscripcionCondominio' | 'configuracionComercial'>;

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
 * Al arrancar el servidor, UNA sola vez: deja en cortesía los condominios que ya existen y anota la fecha en la configuración. Los condominios
 * creados después nacen en Gratis (el registro público les crea su suscripción; los que crea el superadmin sin fila cuentan como Gratis).
 */
export async function migracionInicial(db: Cliente): Promise<{ aplicada: boolean; creadas: number }> {
  const cfg = await db.configuracionComercial.findUnique({ where: { id: CONFIGURACION_ID }, select: { migracion_cortesia_at: true } });
  if (!cfg || cfg.migracion_cortesia_at) return { aplicada: false, creadas: 0 };
  const r = await migrarACortesia(db);
  await db.configuracionComercial.updateMany({ where: { id: CONFIGURACION_ID, migracion_cortesia_at: null }, data: { migracion_cortesia_at: new Date() } });
  return { aplicada: true, creadas: r.creadas };
}
