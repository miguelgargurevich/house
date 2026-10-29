/**
 * Crea la junta directiva VIGENTE de cada block (y de cada condominio) que ya tiene a alguien con `cargo_junta`, un `correo_vouchers` o medios de pago,
 * para pasar a las juntas con gestiones sin perder nada: sus miembros son los usuarios con cargo (con el mismo cargo), el correo de la junta es el
 * `correo_vouchers` del block y los medios de pago ACTIVOS del block pasan a ser la cuenta de la junta. La gestión empieza el 1 de enero del año
 * actual (en la zona del condominio) o, si es posterior, el día en que se creó el medio de pago más antiguo del block.
 *
 * No toca lo ambiguo: un block con dos presidentes o dos tesoreros se informa y queda como está (se registra a mano en «Juntas directivas»).
 * Idempotente: un block o condominio que ya tiene una junta (vigente o pasada) no se toca. No cambia `cargo_junta`, `estructura_id` ni `correo_vouchers`.
 *
 * Por seguridad corre EN SECO: no escribe nada hasta que le pases `--aplicar`. Se niega a correr contra una base que no sea local (localhost / 127.0.0.1)
 * salvo con `--produccion`.
 *
 * Uso (sin DATABASE_URL usa la del .env):
 *   npx tsx scripts/migrar-juntas.ts                        # en seco: informa lo que haría
 *   npx tsx scripts/migrar-juntas.ts --aplicar              # aplica (base local)
 *   npx tsx scripts/migrar-juntas.ts --aplicar --produccion # aplica en una base no local
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import type { Prisma, PrismaClient } from '@prisma/client';
import { diaEn, hoyEn } from '../src/server/lib/fechas';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = PrismaClient<any, any, any>;

export interface FichaJunta {
  complejo_id: number;
  condominio: string;
  estructura_id: number | null;
  /** Nombre del block, o null si es la junta de todo el condominio. */
  block: string | null;
  desde: string;
  correo: string | null;
  miembros: { usuario_id: number; nombre: string; cargo: string }[];
  medios: number;
}

export interface InformeJuntas {
  /** Juntas creadas (o, en seco, que se crearían). */
  creadas: FichaJunta[];
  /** Block o condominio que ya tenía una junta (vigente o pasada): no se toca. */
  ya_tenian: number;
  /** Con dos presidentes o dos tesoreros (u otro dato ambiguo): NO se toca. Hay que registrarlos a mano. */
  ambiguos: { complejo_id: number; estructura_id: number | null; motivo: string }[];
  /** Usuarios con cargo que no son propietarios: su cargo ya no valía y no pasan a la junta. */
  ignorados: { usuario_id: number; motivo: string }[];
  /** Miembros que no son propietarios de una unidad del ámbito: pasan igual (conservan sus permisos), pero conviene revisarlos. */
  sin_unidad: { usuario_id: number; nombre: string; complejo_id: number; estructura_id: number | null }[];
}

/** Base local = host `localhost` o `127.0.0.1` (o `::1`). */
export function esBaseLocal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** 1 de enero del año de `ahora` en la zona (fecha de calendario a las 00:00 UTC). */
const primeroDeEnero = (zona: string, ahora: Date) => new Date(Date.UTC(hoyEn(zona, ahora).getUTCFullYear(), 0, 1));

export async function migrarJuntas(prisma: Cliente, opts: { aplicar?: boolean; ahora?: Date } = {}): Promise<InformeJuntas> {
  const ahora = opts.ahora ?? new Date();
  const informe: InformeJuntas = { creadas: [], ya_tenian: 0, ambiguos: [], ignorados: [], sin_unidad: [] };
  const complejos = await prisma.complejoHabitacional.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, nombre: true, zona_horaria: true, estructuras: { orderBy: { id: 'asc' }, select: { id: true, nombre: true, correo_vouchers: true } } },
  });
  for (const c of complejos) {
    const ambitos: { id: number | null; nombre: string | null; correo: string | null }[] = [
      ...c.estructuras.map((e) => ({ id: e.id, nombre: e.nombre, correo: e.correo_vouchers?.trim() || null })),
      { id: null, nombre: null, correo: null },
    ];
    for (const a of ambitos) {
      const ambito = { complejo_id: c.id, estructura_id: a.id };
      if (await prisma.juntaDirectiva.count({ where: ambito })) { informe.ya_tenian++; continue; }
      const [conCargo, medios] = await Promise.all([
        prisma.usuario.findMany({ where: { ...ambito, cargo_junta: { not: null } }, orderBy: { id: 'asc' }, select: { id: true, nombre: true, rol: true, cargo_junta: true } }),
        prisma.medioPago.findMany({ where: { ...ambito, junta_id: null }, orderBy: { created_at: 'asc' }, select: { id: true, activo: true, created_at: true } }),
      ]);
      if (!conCargo.length && !a.correo && !medios.length) continue;

      const miembros: FichaJunta['miembros'] = [];
      for (const u of conCargo) {
        if (u.rol !== 'propietario') { informe.ignorados.push({ usuario_id: u.id, motivo: `su rol es ${u.rol ?? 'ninguno'}: sólo un propietario tiene cargo en la junta` }); continue; }
        miembros.push({ usuario_id: u.id, nombre: u.nombre, cargo: u.cargo_junta! });
      }
      const repetido = (['presidente', 'tesorero'] as const).find((cargo) => miembros.filter((m) => m.cargo === cargo).length > 1);
      if (repetido) { informe.ambiguos.push({ ...ambito, motivo: `más de un ${repetido}` }); continue; }

      const zona = c.zona_horaria;
      const enero = primeroDeEnero(zona, ahora);
      const primerMedio = medios[0] ? new Date(`${diaEn(medios[0].created_at, zona)}T00:00:00.000Z`) : null;
      const desde = primerMedio && primerMedio.getTime() > enero.getTime() ? primerMedio : enero;
      const activos = medios.filter((m) => m.activo);
      for (const m of miembros) {
        const unidad = await prisma.unidad.count({ where: { propietario_id: m.usuario_id, complejo_id: c.id, ...(a.id != null ? { estructura_id: a.id } : {}) } });
        if (!unidad) informe.sin_unidad.push({ usuario_id: m.usuario_id, nombre: m.nombre, ...ambito });
      }
      informe.creadas.push({ complejo_id: c.id, condominio: c.nombre, estructura_id: a.id, block: a.nombre, desde: desde.toISOString().slice(0, 10), correo: a.correo, miembros, medios: activos.length });
      if (!opts.aplicar) continue;
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const junta = await tx.juntaDirectiva.create({ data: { ...ambito, desde, correo: a.correo, notas: 'Creada al pasar a las juntas directivas' } });
        if (miembros.length) await tx.miembroJunta.createMany({ data: miembros.map((m) => ({ junta_id: junta.id, usuario_id: m.usuario_id, cargo: m.cargo })) });
        if (activos.length) await tx.medioPago.updateMany({ where: { id: { in: activos.map((m) => m.id) } }, data: { junta_id: junta.id } });
      });
    }
  }
  return informe;
}

export function imprimirInforme(i: InformeJuntas, aplicado: boolean) {
  console.log(aplicado ? 'APLICADO' : 'EN SECO (no se escribió nada; usa --aplicar)');
  console.log(`Juntas ${aplicado ? 'creadas' : 'que se crearían'}: ${i.creadas.length}`);
  for (const j of i.creadas) {
    console.log(`  ${j.condominio} · ${j.block ?? 'todo el condominio'} · desde ${j.desde} · correo ${j.correo ?? '—'} · ${j.miembros.length} miembro(s) · ${j.medios} medio(s)`);
    for (const m of j.miembros) console.log(`      ${m.cargo}: ${m.nombre}`);
  }
  console.log(`Ya tenían junta (no se tocan): ${i.ya_tenian}`);
  console.log(`Ambiguos (NO se tocan; regístralos a mano): ${i.ambiguos.length}`);
  for (const x of i.ambiguos) console.log(`  condominio ${x.complejo_id} · block ${x.estructura_id ?? 'todo el condominio'}: ${x.motivo}`);
  console.log(`Cargos ignorados (no son propietarios): ${i.ignorados.length}`);
  for (const x of i.ignorados) console.log(`  usuario ${x.usuario_id}: ${x.motivo}`);
  console.log(`Miembros sin unidad en su ámbito (pasan igual; conviene revisarlos): ${i.sin_unidad.length}`);
  for (const x of i.sin_unidad) console.log(`  usuario ${x.usuario_id} (${x.nombre}) · condominio ${x.complejo_id} · block ${x.estructura_id ?? 'todo el condominio'}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const aplicar = process.argv.includes('--aplicar');
  if (!esBaseLocal(process.env.DATABASE_URL) && !process.argv.includes('--produccion')) {
    console.error('La base no es local (localhost / 127.0.0.1): no se corre. Si de verdad es la de producción, agrega --produccion.');
    process.exit(1);
  }
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    imprimirInforme(await migrarJuntas(prisma, { aplicar }), aplicar);
  } finally {
    await prisma.$disconnect();
  }
}
