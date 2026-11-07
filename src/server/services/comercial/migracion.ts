import type { PrismaClient } from '@prisma/client';
import { CAPACIDAD_MARCA, CARACTERISTICA_MENSAJERIA, CONFIGURACION_ID, MODULOS, PLANES_CON_MARCA, PLANES_CON_WHATSAPP } from './catalogo';
import { estadoEfectivo, finDePrueba } from './estado';
import { invalidarComercial } from './modulos';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = Pick<PrismaClient<any, any, any>, 'complejoHabitacional' | 'suscripcionCondominio' | 'configuracionComercial' | 'planComercial' | 'grupoWhatsapp'>;

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
  const marca = await migracionMarca(db);
  if (marca.planes) console.log(`[comercial] marca propia sumada a ${marca.planes} planes`);
  const gratis = await migracionGratis(db);
  if (gratis.aplicada && gratis.fijados) console.log(`[comercial] plazo de Torre Gratis fijado a ${gratis.fijados} condominios`);
  const auto = await migracionReciboAutomatico(db);
  if (auto.condominios) console.log(`[whatsapp] recibo directo ahora automático por block en ${auto.condominios} condominios`);
  const grupos = await migracionRecordatorioGrupos(db);
  if (grupos.condominios) console.log(`[whatsapp] recibo quitado del WhatsApp directo en ${grupos.condominios} condominios con grupos (lo lleva el grupo de cada block)`);
  const mensajeria = await migracionMensajeria(db);
  if (mensajeria.planes) console.log(`[comercial] «${CARACTERISTICA_MENSAJERIA}» sumada a ${mensajeria.planes} planes con WhatsApp`);
  return resultado;
}

/**
 * UNA sola vez (marca `migracion_mensajeria_at`): suma «Mensajería inteligente (grupos por block)» a las características de los planes con WhatsApp
 * (Pro y Administradora) que ya existían; va justo después de «Avisos por WhatsApp» (o al final si no está). Después el superadmin puede quitarla de
 * un plan y no vuelve. Idempotente: con la marca puesta no hace nada, y un plan que ya la trae no se toca.
 */
export async function migracionMensajeria(db: Cliente): Promise<{ aplicada: boolean; planes: number }> {
  const cfg = await db.configuracionComercial.findUnique({ where: { id: CONFIGURACION_ID }, select: { migracion_mensajeria_at: true } });
  if (!cfg || cfg.migracion_mensajeria_at) return { aplicada: false, planes: 0 };
  const planes = await db.planComercial.findMany({ where: { clave: { in: [...PLANES_CON_WHATSAPP] } }, select: { clave: true, caracteristicas: true } });
  let n = 0;
  for (const p of planes) {
    if (p.caracteristicas.includes(CARACTERISTICA_MENSAJERIA)) continue;
    const nuevas = [...p.caracteristicas];
    const i = nuevas.indexOf('Avisos por WhatsApp');
    if (i >= 0) nuevas.splice(i + 1, 0, CARACTERISTICA_MENSAJERIA);
    else nuevas.push(CARACTERISTICA_MENSAJERIA);
    await db.planComercial.update({ where: { clave: p.clave }, data: { caracteristicas: nuevas } });
    n++;
  }
  await db.configuracionComercial.updateMany({ where: { id: CONFIGURACION_ID, migracion_mensajeria_at: null }, data: { migracion_mensajeria_at: new Date() } });
  invalidarComercial();
  return { aplicada: true, planes: n };
}

/**
 * UNA sola vez (marca `migracion_grupos_recibo_at`): a los condominios que ya tienen algún grupo de WhatsApp en uso (de un block o de todo el
 * condominio) les quita el recibo del WhatsApp DIRECTO a cada departamento: ese aviso ya va al grupo. Los que no tienen grupos no se tocan
 * (si no, se quedarían sin aviso por WhatsApp). La administradora puede volver a prenderlo en «Avisos del condominio».
 */
export async function migracionRecordatorioGrupos(db: Cliente): Promise<{ aplicada: boolean; condominios: number }> {
  const cfg = await db.configuracionComercial.findUnique({ where: { id: CONFIGURACION_ID }, select: { migracion_grupos_recibo_at: true } });
  if (!cfg || cfg.migracion_grupos_recibo_at) return { aplicada: false, condominios: 0 };
  const conGrupo = await db.grupoWhatsapp.findMany({ where: { en_uso: true, destino: { in: ['block', 'condominio'] }, complejo_id: { not: null } }, distinct: ['complejo_id'], select: { complejo_id: true } });
  const ids = conGrupo.flatMap((g: { complejo_id: number | null }) => (g.complejo_id != null ? [g.complejo_id] : []));
  const complejos: { id: number; whatsapp_avisos: string[] }[] = ids.length ? await db.complejoHabitacional.findMany({ where: { id: { in: ids } }, select: { id: true, whatsapp_avisos: true } }) : [];
  let condominios = 0;
  for (const c of complejos) {
    if (!c.whatsapp_avisos.includes('recibo_emitido')) continue;
    await db.complejoHabitacional.update({ where: { id: c.id }, data: { whatsapp_avisos: c.whatsapp_avisos.filter((t) => t !== 'recibo_emitido') } });
    condominios++;
  }
  await db.configuracionComercial.updateMany({ where: { id: CONFIGURACION_ID, migracion_grupos_recibo_at: null }, data: { migracion_grupos_recibo_at: new Date() } });
  return { aplicada: true, condominios };
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
      else await db.suscripcionCondominio.create({ data: { complejo_id: c.id, plan_clave: 'gratis', estado: 'gratis', gratis_hasta: fin, notas: 'Torre Gratis con plazo: fijado al estrenar el límite de tiempo.' } });
      fijados++;
    }
    if (fijados) invalidarComercial();
  }
  await db.configuracionComercial.updateMany({ where: { id: CONFIGURACION_ID, migracion_gratis_at: null }, data: { migracion_gratis_at: ahora } });
  return { aplicada: true, fijados };
}

/**
 * UNA sola vez (marca `migracion_marca_at`): suma la capacidad `marca_propia` a los planes Pro, Administradora y Cortesía que ya existían (el catálogo
 * sembrado no toca planes existentes). Después el superadmin puede quitarla de un plan y no vuelve.
 */
export async function migracionMarca(db: Cliente): Promise<{ aplicada: boolean; planes: number }> {
  const cfg = await db.configuracionComercial.findUnique({ where: { id: CONFIGURACION_ID }, select: { migracion_marca_at: true } });
  if (!cfg || cfg.migracion_marca_at) return { aplicada: false, planes: 0 };
  const planes = await db.planComercial.findMany({ where: { clave: { in: [...PLANES_CON_MARCA] } }, select: { clave: true, modulos_incluidos: true } });
  let n = 0;
  for (const p of planes) {
    if (p.modulos_incluidos.includes(CAPACIDAD_MARCA)) continue;
    await db.planComercial.update({ where: { clave: p.clave }, data: { modulos_incluidos: [...p.modulos_incluidos, CAPACIDAD_MARCA] } });
    n++;
  }
  await db.configuracionComercial.updateMany({ where: { id: CONFIGURACION_ID, migracion_marca_at: null }, data: { migracion_marca_at: new Date() } });
  return { aplicada: true, planes: n };
}

/**
 * UNA sola vez (marca `migracion_recibo_auto_at`): quita `recibo_emitido` de la lista de WhatsApp directo de TODOS los condominios. Desde el 4-nov el
 * directo del recibo lo decide Torre por block (sólo a los blocks sin grupo, `listaWhatsappDe` en avisos/cola.ts) y tenerlo marcado significa «también
 * directo en los blocks con grupo». Sin esto, los condominios que lo tenían por el valor por defecto de antes recibirían el recibo dos veces (grupo y directo)
 * apenas asignaran sus grupos. Va ANTES de `migracionRecordatorioGrupos` en `migracionInicial`.
 */
export async function migracionReciboAutomatico(db: Cliente): Promise<{ aplicada: boolean; condominios: number }> {
  const cfg = await db.configuracionComercial.findUnique({ where: { id: CONFIGURACION_ID }, select: { migracion_recibo_auto_at: true } });
  if (!cfg || cfg.migracion_recibo_auto_at) return { aplicada: false, condominios: 0 };
  const complejos: { id: number; whatsapp_avisos: string[] }[] = await db.complejoHabitacional.findMany({ where: { whatsapp_avisos: { has: 'recibo_emitido' } }, select: { id: true, whatsapp_avisos: true } });
  for (const c of complejos) await db.complejoHabitacional.update({ where: { id: c.id }, data: { whatsapp_avisos: c.whatsapp_avisos.filter((t) => t !== 'recibo_emitido') } });
  await db.configuracionComercial.updateMany({ where: { id: CONFIGURACION_ID, migracion_recibo_auto_at: null }, data: { migracion_recibo_auto_at: new Date() } });
  return { aplicada: true, condominios: complejos.length };
}
