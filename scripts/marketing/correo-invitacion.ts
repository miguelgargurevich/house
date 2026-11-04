// Imprime el HTML del correo de invitación de Torre con la plantilla real (`plantillaCorreo`). Lo usa videos-torre.mjs para el video v8.
// Uso: node_modules/.bin/tsx scripts/marketing/correo-invitacion.ts <token> <nombre>
import { plantillaCorreo } from '../../src/server/services/avisos/correoHtml';

const [token = 'DEMO', nombre = 'Vecino de prueba'] = process.argv.slice(2);
const link = `https://torrecondominios.com/invitacion?token=${encodeURIComponent(token)}`;
const { html } = plantillaCorreo({
  marca: null,
  titulo: 'Te invitaron a Torre',
  parrafos: [
    `Hola ${nombre}:`,
    'Tu administración te dio acceso a Torre como inquilino de Condominio Los Libertadores de Surco. Crea tu contraseña para entrar.',
    'El enlace sirve una sola vez y vence en 7 días.',
  ],
  boton: { texto: 'Crear mi contraseña', url: link },
  pie: 'Si no esperabas este correo, ignóralo: no pasa nada y nadie entra a tu cuenta sin crear una contraseña.',
});
process.stdout.write(html);
