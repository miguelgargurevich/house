// La oferta «Gratis con límite o Pro con todo»: pone en una base YA existente los valores que una base nueva recibe de `PLANES_SEED`
// (tope de Gratis, mínimo de Torre Pro y Torre Administradora, capacidades de cada plan y textos). Idempotente: correrlo dos veces deja lo mismo.
// Precios y estado de las suscripciones no se tocan (Los Libertadores sigue en cortesía).
import type { PrismaClient } from '@prisma/client';
import { CAPACIDADES, CARACTERISTICAS_GRATIS_ANTERIORES, PLANES_SEED, sembrarCatalogoComercial } from './catalogo';
import { invalidarComercial } from './modulos';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = Pick<PrismaClient<any, any, any>, 'moduloComercial' | 'planComercial' | 'configuracionComercial' | 'impuestoPais'>;

export interface CambioDePlan { clave: string; cambios: string[] }

const igual = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Nombres de la oferta anterior: el script sólo cambia el nombre si sigue así (lo que el superadmin escribió a mano se respeta). */
const NOMBRES_DE_FABRICA: Record<string, string> = { gratis: 'Gratis', basico: 'Básico', pro: 'Pro', administradora: 'Administradora' };

/** Lo que hay que cambiar en cada plan para que quede como la oferta nueva. Con `seco` no escribe nada. */
export async function ajustarOfertaGratisPro(db: Cliente, opts: { seco?: boolean } = {}): Promise<CambioDePlan[]> {
  if (!opts.seco) await sembrarCatalogoComercial(db);
  const filas = await db.planComercial.findMany();
  const informe: CambioDePlan[] = [];
  for (const seed of PLANES_SEED) {
    const fila = filas.find((p) => p.clave === seed.clave);
    if (!fila) { informe.push({ clave: seed.clave, cambios: ['plan nuevo'] }); continue; }
    const cambios: string[] = [];
    const data: Record<string, unknown> = {};
    if (fila.unidades_maximas !== seed.unidades_maximas) { cambios.push(`unidades_maximas ${fila.unidades_maximas ?? '—'} → ${seed.unidades_maximas ?? '—'}`); data.unidades_maximas = seed.unidades_maximas; }
    if (fila.unidades_minimas !== seed.unidades_minimas) { cambios.push(`unidades_minimas ${fila.unidades_minimas ?? '—'} → ${seed.unidades_minimas ?? '—'}`); data.unidades_minimas = seed.unidades_minimas; }
    if (fila.asistente_por_unidad_mes !== seed.asistente_por_unidad_mes) { cambios.push(`asistente_por_unidad_mes ${fila.asistente_por_unidad_mes ?? '—'} → ${seed.asistente_por_unidad_mes ?? '—'}`); data.asistente_por_unidad_mes = seed.asistente_por_unidad_mes; }
    if (fila.whatsapp_por_unidad_mes !== seed.whatsapp_por_unidad_mes) { cambios.push(`whatsapp_por_unidad_mes ${fila.whatsapp_por_unidad_mes ?? '—'} → ${seed.whatsapp_por_unidad_mes ?? '—'}`); data.whatsapp_por_unidad_mes = seed.whatsapp_por_unidad_mes; }
    // Gratis no trae nada; el resto trae todas las capacidades (se conserva el orden de las que ya tenía y se agregan las que faltan).
    const quiere = seed.modulos_incluidos.length ? [...fila.modulos_incluidos.filter((m) => (CAPACIDADES as readonly string[]).includes(m)), ...CAPACIDADES.filter((c) => !fila.modulos_incluidos.includes(c))] : [];
    if (!igual(fila.modulos_incluidos, quiere)) { cambios.push(`modulos_incluidos → ${quiere.join(', ') || '(ninguno)'}`); data.modulos_incluidos = quiere; }
    if (fila.nombre !== seed.nombre && fila.nombre === NOMBRES_DE_FABRICA[seed.clave]) { cambios.push(`nombre ${fila.nombre} → ${seed.nombre}`); data.nombre = seed.nombre; }
    if (fila.descripcion !== seed.descripcion) { cambios.push('descripcion'); data.descripcion = seed.descripcion; }
    // Las viñetas de Gratis sólo se cambian si siguen como salieron con la oferta anterior (con o sin «1 condominio», que el seed le antepone): lo que el superadmin escribió a mano se respeta.
    const caracteristicasDeFabrica = seed.clave !== 'gratis' || [CARACTERISTICAS_GRATIS_ANTERIORES, ['1 condominio', ...CARACTERISTICAS_GRATIS_ANTERIORES]].some((de) => igual(fila.caracteristicas, de));
    if (!igual(fila.caracteristicas, seed.caracteristicas) && caracteristicasDeFabrica) { cambios.push('caracteristicas'); data.caracteristicas = [...seed.caracteristicas]; }
    if (cambios.length) {
      informe.push({ clave: seed.clave, cambios });
      if (!opts.seco) await db.planComercial.update({ where: { clave: seed.clave }, data });
    }
  }
  if (!opts.seco) invalidarComercial();
  return informe;
}
