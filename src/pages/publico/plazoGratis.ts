// Cuánto dura Gratis, dicho en la página pública. Sin React ni API (no importa `catalogo.ts`, que carga el cliente de la API): lo prueban las pruebas de Node.
import type { Catalogo } from './catalogo';

/** «3 meses» para 90 días, «1 mes» para 30, «45 días» para lo que no es múltiplo de 30 (el mismo criterio de los correos del servidor). */
export function duracionGratis(dias: number): string {
  if (dias > 0 && dias % 30 === 0) return dias === 30 ? '1 mes' : `${dias / 30} meses`;
  return `${dias} ${dias === 1 ? 'día' : 'días'}`;
}

/** Lo que dura Gratis, «por 3 meses»; sin plazo, «sin plazo». */
export const plazoGratisTexto = (cat: Pick<Catalogo, 'dias_gratis'>): string => (cat.dias_gratis ? `por ${duracionGratis(cat.dias_gratis)}` : 'sin plazo');
