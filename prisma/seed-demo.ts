/**
 * La demo de Torre para enviar a clientes. `npm run seed:demo`.
 *
 * - SÓLO contra una base cuyo nombre termine en `_demo` (`house_demo` local; la base de la instancia demo.torrecondominios.com): si no, aborta sin tocar nada.
 * - Borra y recrea todo: 1 administradora («Administradora Demo SAC») con 2 condominios (Residencial Las Palmeras: 6 blocks × 20 departamentos, juntas por
 *   block y junta central; Edificio Mirador del Parque: 1 torre de 40, junta única), 6 meses de historia facturada POR LA API REAL, pagos al día, morosos,
 *   por validar (con voucher de ejemplo) y rechazados, comunicados, reservas, proveedores, tareas, lecturas de agua y grupos de WhatsApp de ejemplo.
 * - Relativo a HOY (Lima): el recibo «del mes» es el del mes en curso. Determinista: PRNG con semilla fija.
 * - Enciende el MODO DEMO en la base (`ConfiguracionDemo`) antes de facturar: nada sale (ni correo, ni WhatsApp, ni IA de pago).
 * - Datos 100 % inventados: correos `.example`, celulares 900 xxx xxx. Las contraseñas de las cuentas son aleatorias y nadie las conoce: se entra por rol.
 *
 * Opciones: `--superadmin=<correo>` crea (si no existe) la cuenta de superadmin de la instancia, con contraseña aleatoria guardada en el archivo
 * `CREDENCIALES_JSON` (por defecto, en el directorio temporal del sistema; permisos 0600). Nunca se imprime la contraseña. Los superadmins que ya existan
 * se conservan en cada reinicio.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

// Protección ANTES de cargar nada que abra la base.
const urlBase = process.env.DATABASE_URL ?? '';
let nombreBase = '';
try {
  nombreBase = new URL(urlBase).pathname.replace(/^\//, '');
} catch {
  /* sin URL válida: abajo se aborta */
}
if (!/_demo$/.test(nombreBase)) {
  console.error(`✖ Este seed sólo corre contra una base cuyo nombre termine en «_demo»; recibí «${nombreBase || 'ninguna'}». Abortado: no se tocó nada.`);
  process.exit(1);
}
// Defensa extra: ni correo, ni WhatsApp, ni IA, ni planificador (dotenv no pisa lo ya definido, ni siquiera vacío).
for (const k of ['RESEND_API_KEY', 'MAIL_FROM', 'EVOLUTION_URL', 'EVOLUTION_APIKEY', 'GEMINI_API_KEY']) process.env[k] = '';
Object.assign(process.env, { AVISOS_PLANIFICADOR: 'off', MODELOS_SYNC: 'off', ASISTENTE_CANARY: 'off', ASISTENTE_LIMPIEZA: 'off', TIPO_CAMBIO_AUTO: 'off' });

const { prisma } = await import('../src/server/db');
const { sembrarDemo } = await import('../src/server/services/demo/sembrar');
const bcrypt = (await import('bcrypt')).default;

const correoSuper = process.argv.find((a) => a.startsWith('--superadmin='))?.slice('--superadmin='.length).trim().toLowerCase();

try {
  const r = await sembrarDemo({ log: (m) => console.log(m) });
  console.log(`\n══ Demo sembrada en «${r.base}» ══`);
  console.table(r.condominios);
  console.log(`Usuarios: ${r.usuarios} · Recibos: ${r.recibos} · Pagos: ${r.pagos} (${r.por_validar} por validar, ${r.rechazados} rechazados) · Comunicados: ${r.comunicados} · Reservas: ${r.reservas}`);
  console.log(`Hecho en ${r.segundos} s. Modo demo: ENCENDIDO en esta base.`);
  if (r.problemas.length) {
    console.error('✖ Auditoría de coherencia con problemas:');
    for (const p of r.problemas) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else console.log('Auditoría de coherencia: 0 problemas.');
  if (correoSuper) {
    const ya = await prisma.usuario.findUnique({ where: { email: correoSuper }, select: { id: true } });
    if (ya) console.log(`Superadmin «${correoSuper}» ya existe: no se toca.`);
    else {
      const clave = `Sup-${randomBytes(12).toString('base64url')}!`;
      await prisma.usuario.create({ data: { nombre: 'Superadmin de la demo', email: correoSuper, rol: 'superadmin', password_hash: await bcrypt.hash(clave, 12), correo_verificado: true } });
      const destino = process.env.CREDENCIALES_JSON ?? join(tmpdir(), 'house-demo-credenciales.json');
      mkdirSync(dirname(destino), { recursive: true });
      writeFileSync(destino, JSON.stringify({ superadmin: { email: correoSuper, password: clave } }, null, 2), { mode: 0o600 });
      console.log(`Superadmin «${correoSuper}» creado. Contraseña en ${destino} (0600; cámbiala al primer ingreso).`);
    }
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
  // Un seed caído no deja el candado de reinicio puesto (la demo respondería 503 «se está preparando» para siempre).
  await prisma.configuracionDemo.updateMany({ data: { reiniciando_desde: null } }).catch(() => undefined);
} finally {
  await prisma.$disconnect().catch(() => undefined);
}
process.exit(process.exitCode ?? 0);
