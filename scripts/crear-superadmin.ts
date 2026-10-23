// Crea (o restablece) un superadmin con contraseña aleatoria. Uso:
//   npx tsx scripts/crear-superadmin.ts correo@dominio.com "Nombre Apellido"
// Imprime la contraseña UNA sola vez; no queda guardada en ningún archivo.
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const [email, nombre = 'Superadmin'] = process.argv.slice(2);
if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Uso: npx tsx scripts/crear-superadmin.ts correo@dominio.com "Nombre Apellido"');
  process.exit(1);
}

const prisma = new PrismaClient();
const password = randomBytes(15).toString('base64url');
const password_hash = await bcrypt.hash(password, 12);
const existe = await prisma.usuario.findUnique({ where: { email } });
if (existe) {
  await prisma.usuario.update({ where: { email }, data: { password_hash, rol: 'superadmin', nombre } });
} else {
  await prisma.usuario.create({ data: { email, nombre, rol: 'superadmin', password_hash } });
}
console.log(`${existe ? 'Superadmin restablecido' : 'Superadmin creado'}: ${email}`);
console.log(`Contraseña (guárdala ahora, no se vuelve a mostrar): ${password}`);
await prisma.$disconnect();
