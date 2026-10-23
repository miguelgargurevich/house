import { PrismaClient } from '@prisma/client';

// Un único cliente para todo el proceso. El hash de contraseña se omite en TODA consulta
// (también en includes); sólo el login y el cambio de contraseña lo piden con `omit: { password_hash: false }`.
export const prisma = new PrismaClient({
  omit: { usuario: { password_hash: true } },
});
