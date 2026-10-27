/**
 * Manda UN correo de prueba con la configuración real de avisos (`RESEND_API_KEY` y `MAIL_FROM` del entorno), por la misma función que usan
 * los avisos (`enviarCorreo`). Sirve para comprobar que la clave de Resend y el remitente funcionan sin esperar un aviso real.
 * Imprime lo que respondió el canal (`ok`, `omitida` con el motivo, o `fallo`); nunca imprime la clave.
 *
 * Uso (en producción, dentro del contenedor de la app; la clave no sale del servidor):
 *   npx tsx scripts/probar-correo.ts destinatario@ejemplo.com
 */
import { depsReales, enviarCorreo } from '../src/server/services/avisos/canales';

const destino = process.argv[2]?.trim();
if (!destino || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(destino)) {
  console.error('Uso: npx tsx scripts/probar-correo.ts destinatario@ejemplo.com');
  process.exit(2);
}

void (async () => {
  const r = await enviarCorreo(
    depsReales(),
    destino,
    'Prueba de correo de House',
    'Hola:\n\nEste es un correo de prueba de House enviado con la configuración real de Resend.\n\nSi lo recibes, los avisos por correo funcionan.\n\nHouse',
  );
  console.log(JSON.stringify(r));
  process.exit(r.resultado === 'ok' ? 0 : 1);
})();
