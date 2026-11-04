// Ayudas de los videos de onboarding de Torre (v7 «Empieza con Torre» y v8 «Bienvenido a Torre»): base LOCAL, nunca producción.
//  · crearInvitacion()        → un vecino de prueba SIN contraseña (usuario + invitación con token, como si se le hubiera enviado el correo).
//  · correoInvitacionHtml()   → el correo de invitación renderizado con la plantilla real (`plantillaCorreo`) y datos de prueba.
//  · limpiarInvitacion()      → borra ese vecino de prueba (la invitación se borra en cascada).
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';

const RAIZ = process.cwd();
const NOMBRE_PRUEBA = 'Lucía Vargas Prado';
const COMPLEJO_ID = 4; // Condominio Los Libertadores de Surco (seed local)

const psql = (sql) => execFileSync('docker', ['exec', '-i', 'house-pg', 'psql', '-U', 'postgres', '-d', 'house', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', sql], { encoding: 'utf8' }).trim();
const sha256 = (t) => createHash('sha256').update(t).digest('hex');

/** Vecino de prueba (inquilino, sin contraseña) con una invitación vigente. Devuelve el token en claro (sólo vive en esta grabación). */
export function crearInvitacion() {
  const email = `video.${randomUUID().slice(0, 8)}@prueba.house`;
  const token = randomBytes(32).toString('base64url');
  const id = psql(`with u as (insert into "Usuario" (nombre, email, rol, complejo_id, updated_at, created_at) values ('${NOMBRE_PRUEBA}', '${email}', 'inquilino', ${COMPLEJO_ID}, now(), now()) returning id)
    insert into "TokenInvitacion" (usuario_id, token_hash, expira_at, created_at) select id, '${sha256(token)}', now() + interval '7 days', now() from u returning usuario_id;`);
  if (!id) throw new Error('No se creó la invitación de prueba');
  globalThis.__invitacionVideo = { email, token };
  return { email, token, nombre: NOMBRE_PRUEBA };
}

/** HTML del correo de invitación con la plantilla real de Torre (`src/server/services/avisos/correoHtml.ts`). */
export function correoInvitacionHtml(token) {
  return execFileSync(join(RAIZ, 'node_modules/.bin/tsx'), [join(RAIZ, 'scripts/marketing/correo-invitacion.ts'), token, NOMBRE_PRUEBA], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

/** Borra el vecino de prueba creado por `crearInvitacion` (sólo su correo exacto; nunca otros `video.%`). */
export function limpiarInvitacion(email = globalThis.__invitacionVideo?.email) {
  if (!email || !/^video\.[a-z0-9-]+@prueba\.house$/.test(email)) return 0;
  return psql(`with d as (delete from "Usuario" where email = '${email}' returning id) select count(*) from d;`);
}
