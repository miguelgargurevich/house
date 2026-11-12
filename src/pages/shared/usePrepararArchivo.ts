import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Prepara el archivo elegido (p. ej. lo achica) mientras el formulario muestra «Preparando la foto…» y no deja enviar.
 * `preparar` devuelve el archivo listo, o `null` si el resultado ya no sirve: el componente se cerró, o se eligió otro archivo (o se quitó) mientras tanto.
 */
export function usePrepararArchivo(preparador: (f: File) => Promise<File>) {
  const [preparando, setPreparando] = useState(false);
  const vivo = useRef(true);
  const ultimo = useRef(0);

  useEffect(() => {
    vivo.current = true;
    return () => { vivo.current = false; };
  }, []);

  const preparar = useCallback(async (f: File): Promise<File | null> => {
    const id = ++ultimo.current;
    setPreparando(true);
    let listo: File;
    try {
      listo = await preparador(f);
    } catch {
      listo = f;
    }
    if (!vivo.current || id !== ultimo.current) return null;
    setPreparando(false);
    return listo;
  }, [preparador]);

  /** Descarta la preparación en curso (al quitar el archivo o al cambiar de elección). */
  const cancelar = useCallback(() => {
    ultimo.current++;
    setPreparando(false);
  }, []);

  return { preparando, preparar, cancelar };
}
