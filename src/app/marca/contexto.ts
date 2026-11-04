import { createContext, useContext } from 'react';
import { MARCA_TORRE, type MarcaUsuario } from '../../lib/marca';

/** La marca del usuario en sesión. Fuera del `Shell` (login, páginas públicas) o sin sesión, la de Torre. */
export const MarcaContext = createContext<MarcaUsuario>(MARCA_TORRE);
export const useMarca = (): MarcaUsuario => useContext(MarcaContext);
