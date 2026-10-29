/**
 * Pasa los teléfonos guardados al formato internacional (`+51 987 654 321`). Sin prefijo se asume Perú. Lo que no es un número válido no se
 * toca: se cuenta y se lista por id (nunca el número). Sin `--aplicar` sólo muestra cuántos cambiaría. Idempotente: una segunda corrida no cambia nada.
 *
 * Uso (sin DATABASE_URL usa la del .env; se niega si la base no es local):
 *   npx tsx scripts/normalizar-telefonos.ts                 # simula: no escribe nada
 *   npx tsx scripts/normalizar-telefonos.ts --aplicar       # escribe
 *   npx tsx scripts/normalizar-telefonos.ts --aplicar --produccion   # base NO local: sólo con el OK de Miguel
 */
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { formatearTelefono } from '../src/lib/telefono';

interface Fila { id: number; valor: string }
interface Fuente { nombre: string; leer: () => Promise<Fila[]>; escribir: (id: number, valor: string | null) => Promise<unknown> }
export interface Resumen { revisados: number; cambios: number; sinInterpretar: number[]; escritos: number }

/** Los cinco campos de teléfono del esquema. Sólo se leen y escriben `id` y el campo. */
export const fuentes = (prisma: PrismaClient): Fuente[] => [
  {
    nombre: 'Usuario.telefono',
    leer: async () => (await prisma.usuario.findMany({ where: { telefono: { not: null } }, select: { id: true, telefono: true } })).map((r) => ({ id: r.id, valor: r.telefono! })),
    escribir: (id, valor) => prisma.usuario.update({ where: { id }, data: { telefono: valor } }),
  },
  {
    nombre: 'EmpresaAdministradora.telefono',
    leer: async () => (await prisma.empresaAdministradora.findMany({ where: { telefono: { not: null } }, select: { id: true, telefono: true } })).map((r) => ({ id: r.id, valor: r.telefono! })),
    escribir: (id, valor) => prisma.empresaAdministradora.update({ where: { id }, data: { telefono: valor } }),
  },
  {
    nombre: 'ComplejoHabitacional.admin_celular',
    leer: async () => (await prisma.complejoHabitacional.findMany({ where: { admin_celular: { not: null } }, select: { id: true, admin_celular: true } })).map((r) => ({ id: r.id, valor: r.admin_celular! })),
    escribir: (id, valor) => prisma.complejoHabitacional.update({ where: { id }, data: { admin_celular: valor } }),
  },
  {
    nombre: 'Proveedor.telefono',
    leer: async () => (await prisma.proveedor.findMany({ where: { telefono: { not: null } }, select: { id: true, telefono: true } })).map((r) => ({ id: r.id, valor: r.telefono! })),
    escribir: (id, valor) => prisma.proveedor.update({ where: { id }, data: { telefono: valor } }),
  },
  {
    nombre: 'MedioPago.celular',
    leer: async () => (await prisma.medioPago.findMany({ where: { celular: { not: null } }, select: { id: true, celular: true } })).map((r) => ({ id: r.id, valor: r.celular! })),
    escribir: (id, valor) => prisma.medioPago.update({ where: { id }, data: { celular: valor } }),
  },
];

/** `localhost`, `127.0.0.1` o `::1`: la única base en la que el script corre sin `--produccion`. */
export const esLocal = (url: string | undefined): boolean => {
  if (!url) return false;
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
};

/**
 * Recorre todos los campos. Un valor vacío pasa a `null` (como hace el esquema); un número válido, al formato internacional; el resto se
 * cuenta en `sinInterpretar`. Con `aplicar = false` no escribe nada.
 */
export async function normalizarTelefonos(prisma: PrismaClient, aplicar: boolean, registrar: (linea: string) => void = () => undefined): Promise<Resumen> {
  const total: Resumen = { revisados: 0, cambios: 0, sinInterpretar: [], escritos: 0 };
  for (const f of fuentes(prisma)) {
    const filas = await f.leer();
    const sin: number[] = [];
    let cambian = 0;
    for (const { id, valor } of filas) {
      total.revisados++;
      const nuevo = valor.trim() === '' ? null : formatearTelefono(valor);
      if (nuevo === null && valor.trim() !== '') { sin.push(id); continue; }
      if (nuevo === valor) continue;
      cambian++;
      total.cambios++;
      if (aplicar) { await f.escribir(id, nuevo); total.escritos++; }
    }
    total.sinInterpretar.push(...sin);
    registrar(`${f.nombre}: ${cambian} ${aplicar ? 'actualizados' : 'cambiarían'}${sin.length ? `, ${sin.length} sin interpretar (ids ${sin.join(', ')})` : ''}`);
  }
  return total;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { PrismaClient } = await import('@prisma/client');
  const url = process.env.DATABASE_URL;
  const aplicar = process.argv.includes('--aplicar');
  if (!esLocal(url) && !process.argv.includes('--produccion')) {
    console.error('Me niego a correr: DATABASE_URL no es una base local. Para una base remota hace falta --produccion (y el OK de Miguel).');
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const r = await normalizarTelefonos(prisma, aplicar, (l) => console.log(l));
    console.log(aplicar
      ? `Listo: ${r.escritos} teléfono(s) pasados a formato internacional de ${r.revisados} revisados.`
      : `Simulación (no se escribió nada): ${r.cambios} de ${r.revisados} cambiarían. Para escribir: --aplicar.`);
  } finally {
    await prisma.$disconnect();
  }
}
