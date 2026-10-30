import { useCallback, useEffect, useState } from 'react';

/**
 * Imprime algo que NO está en un modal: `imprimir()` monta la zona imprimible (`imprimiendo` = true), espera a que se pinte, abre el diálogo
 * de impresión y la desmonta al terminar (`afterprint`). Así nunca hay dos `#zona-imprimible` a la vez (el recibo y los comprobantes también la usan).
 */
export function useImprimir(): { imprimiendo: boolean; imprimir: () => void } {
  const [imprimiendo, setImprimiendo] = useState(false);
  useEffect(() => {
    if (!imprimiendo) return;
    const fin = () => setImprimiendo(false);
    window.addEventListener('afterprint', fin);
    const respaldo = window.setTimeout(fin, 120_000); // si el navegador no avisa que terminó
    const marco = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    return () => { cancelAnimationFrame(marco); window.clearTimeout(respaldo); window.removeEventListener('afterprint', fin); };
  }, [imprimiendo]);
  const imprimir = useCallback(() => setImprimiendo(true), []);
  return { imprimiendo, imprimir };
}
