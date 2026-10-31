import { useAuth } from '../auth/AuthContext';
import { esJunta } from '../auth/junta';
import { ContenidoBanda } from './ContenidoBanda';
import { useSoloLectura } from './soloLectura';

/**
 * Banda fija de la administración y la junta cuando el condominio terminó su periodo gratis: dice desde cuándo, que los datos siguen y cómo seguir
 * registrando. Va dentro de la barra fija del Shell, en todas las pantallas.
 */
export function BandaSoloLectura() {
  const { user } = useAuth();
  const v = useSoloLectura();
  if (!v.soloLectura) return null;
  return <ContenidoBanda v={v} junta={esJunta(user)} />;
}
