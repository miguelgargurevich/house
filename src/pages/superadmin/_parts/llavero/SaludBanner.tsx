import { Alert } from '../../../../ui';
import type { Salud } from './tipos';

const hora = new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Lima' });

/** Banner rojo cuando NO queda ninguna ruta de IA sana. Mientras tanto el asistente contesta con los datos de cada cuenta, sin IA. */
export function SaludBanner({ salud }: { salud: Salud }) {
  if (!salud.configurada || salud.ok) return null;
  return (
    <div className="mb-4">
      <Alert tone="bad">
        <p className="font-medium">
          Sin IA disponible{salud.desde ? ` desde las ${hora.format(new Date(salud.desde))}` : ''}{salud.motivo ? `: ${salud.motivo}` : ''}.
        </p>
        <p className="mt-1 text-sm">Mientras tanto el asistente responde a los vecinos con los datos de su cuenta, sin IA. Prueba cada clave y revisa los modelos más abajo; se recupera sola cuando alguna vuelve a responder.</p>
      </Alert>
    </div>
  );
}
