import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useResource } from '../api';
import { useAuth } from '../auth/AuthContext';
import { esJunta } from '../auth/junta';
import { useCondominio } from './condominio';
import { SoloLecturaCtx, vistaSoloLectura, type EstadoOperativo } from './soloLectura';

/**
 * Lee UNA vez el estado de solo lectura de los condominios de la administración y la junta (los demás roles no lo necesitan: el vecino recibe el motivo
 * del servidor al intentar subir un voucher) y lo reparte a la banda y a los botones. Va dentro de `CondominioProvider`: usa el condominio elegido.
 */
export function SoloLecturaProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { elegido } = useCondominio();
  const junta = esJunta(user);
  const aplica = user?.rol === 'admin' || junta;
  const { data } = useResource<{ condominios: EstadoOperativo[] }>(aplica ? '/api/comercial/estado-operativo' : null);
  const valor = useMemo(() => vistaSoloLectura(data?.condominios ?? [], junta ? null : elegido, junta), [data, elegido, junta]);
  return <SoloLecturaCtx.Provider value={valor}>{children}</SoloLecturaCtx.Provider>;
}
