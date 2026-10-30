// Junta central de prueba en la base local «house» (Condominio Los Libertadores de Surco): un presidente y un tesorero
// centrales para probar los flujos de la Junta central (aportes de los blocks y cierre central). `npm run junta-central:local`.
//
// - SOLO contra la base de desarrollo local («house» en localhost); si no, aborta antes de tocar nada.
// - Idempotente: si ya hay una junta central vigente la reutiliza y sólo le agrega miembros si está vacía; si tiene
//   miembros que no son el presidente y el tesorero de prueba, se detiene para no pisarlos. Correrlo dos veces no duplica nada.
// - No cambia contraseñas: las cuentas del seed usan prop1234; sólo informa si la del tesorero central coincide.

import { fileURLToPath } from 'node:url';
import bcrypt from 'bcrypt';
import type { prisma as Db } from '../src/server/db';
import { sincronizarCargosTx, validarMiembros, vigenteDe } from '../src/server/services/juntas';

export const COMPLEJO = 'Condominio Los Libertadores de Surco';
/** Propietarios del seed que no están en ninguna junta (B01-101 y B01-102; el Block 1 ya tiene presidente y tesorera). */
export const PRESIDENTE = 'teresa.neyra.3@prueba.house';
export const TESORERO = 'gustavo.cruz.4@prueba.house';
const ANA = 'ana.lopez@gestionurbana.com';
export const CLAVE_SEED = 'prop1234';

/** Motivo por el que esta URL no es la base local «house»; `null` si lo es. */
export function motivoSinBaseLocal(url: string | undefined): string | null {
  if (!url) return 'DATABASE_URL no está definida.';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'DATABASE_URL no es una URL válida.';
  }
  const base = u.pathname.replace(/^\//, '');
  if (!['localhost', '127.0.0.1'].includes(u.hostname) || base !== 'house') {
    return `Sólo corre contra la base local «house» (localhost); recibí «${u.hostname}/${base}». Abortado: no se tocó nada.`;
  }
  return null;
}

export interface Resultado {
  junta_id: number;
  creada: boolean;
  miembros: { cargo: string; email: string; nombre: string }[];
  cambiados: number[];
  claveDelSeed: boolean;
}

/** Deja una junta central vigente con presidente y tesorero. Recibe el cliente para poder probarla contra otra base. */
export async function prepararJuntaCentral(db: typeof Db): Promise<Resultado> {
  const complejo = await db.complejoHabitacional.findFirst({ where: { nombre: COMPLEJO }, select: { id: true } });
  if (!complejo) throw new Error(`No existe «${COMPLEJO}» en esta base. Antes corre npm run seed:libertadores.`);

  const emails = [PRESIDENTE, TESORERO];
  const personas = await db.usuario.findMany({ where: { email: { in: emails } }, select: { id: true, email: true, nombre: true } });
  const porEmail = new Map(personas.map((p) => [p.email, p]));
  const presidente = porEmail.get(PRESIDENTE);
  const tesorero = porEmail.get(TESORERO);
  if (!presidente || !tesorero) throw new Error(`Faltan cuentas del seed: ${emails.filter((e) => !porEmail.has(e)).join(', ')}.`);
  const lista: { usuario_id: number; cargo: 'presidente' | 'tesorero' }[] = [
    { usuario_id: presidente.id, cargo: 'presidente' },
    { usuario_id: tesorero.id, cargo: 'tesorero' },
  ];

  const ana = await db.usuario.findUnique({ where: { email: ANA }, select: { id: true } });

  const { junta_id, creada, cambiados } = await db.$transaction(async (tx) => {
    const vigente = await vigenteDe(tx, complejo.id, null);
    const actuales = vigente ? await tx.miembroJunta.findMany({ where: { junta_id: vigente.id }, select: { usuario_id: true, cargo: true, usuario: { select: { nombre: true } } } }) : [];
    if (vigente && actuales.length && !actuales.every((m) => lista.some((l) => l.usuario_id === m.usuario_id && l.cargo === m.cargo))) {
      const quienes = actuales.map((m) => `${m.cargo} ${m.usuario.nombre}`).join(', ');
      throw new Error(`La junta central vigente (id ${vigente.id}) ya tiene miembros distintos: ${quienes}. No se cambia nada; corrígela desde la app.`);
    }

    await validarMiembros(tx, { complejo_id: complejo.id, estructura_id: null }, lista, vigente?.id);

    if (vigente) {
      if (!actuales.length) await tx.miembroJunta.createMany({ data: lista.map((m) => ({ junta_id: vigente.id, ...m })) });
      return { junta_id: vigente.id, creada: false, cambiados: await sincronizarCargosTx(tx, complejo.id, null) };
    }
    const nueva = await tx.juntaDirectiva.create({
      data: {
        complejo_id: complejo.id, estructura_id: null, desde: new Date(Date.UTC(2026, 0, 1)), correo: 'junta.central@loslibertadores.example',
        creado_por_id: ana?.id ?? null, miembros: { create: lista },
      },
    });
    return { junta_id: nueva.id, creada: true, cambiados: await sincronizarCargosTx(tx, complejo.id, null) };
  });

  // Sólo se mira el hash para informar; nunca se imprime ni se cambia.
  const cuenta = await db.usuario.findUnique({ where: { id: tesorero.id }, omit: { password_hash: false } });
  const claveDelSeed = cuenta?.password_hash ? await bcrypt.compare(CLAVE_SEED, cuenta.password_hash) : false;

  return {
    junta_id,
    creada,
    miembros: [
      { cargo: 'presidente', email: presidente.email, nombre: presidente.nombre },
      { cargo: 'tesorero', email: tesorero.email, nombre: tesorero.nombre },
    ],
    cambiados,
    claveDelSeed,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const error = motivoSinBaseLocal(process.env.DATABASE_URL);
  if (error) {
    console.error(`✖ ${error}`);
    process.exit(1);
  }
  const { prisma } = await import('../src/server/db');
  try {
    const r = await prepararJuntaCentral(prisma);
    console.log(`Junta central vigente: id ${r.junta_id} (${r.creada ? 'creada ahora' : 'ya existía'}).`);
    for (const m of r.miembros) console.log(`  ${m.cargo}: ${m.nombre} — ${m.email}`);
    console.log(`  Cargos sincronizados en ${r.cambiados.length} cuenta(s).`);
    console.log(r.claveDelSeed
      ? `  Contraseña del tesorero central: la del seed (${CLAVE_SEED}).`
      : `  Contraseña del tesorero central: NO es la del seed; no se cambió.`);
  } catch (e) {
    console.error(`✖ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
