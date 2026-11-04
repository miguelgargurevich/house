import { useEffect, useState } from 'react';

/** ¿La app está en modo oscuro ahora? Sigue el cambio (el interruptor del menú pone o quita la clase `dark` de `<html>`). */
export function useModoOscuro(): boolean {
  const [oscuro, setOscuro] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const raiz = document.documentElement;
    const obs = new MutationObserver(() => setOscuro(raiz.classList.contains('dark')));
    obs.observe(raiz, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return oscuro;
}
