import { useEffect, useRef, useState } from 'react';
import type { ElementType, ReactNode } from 'react';
import { cx } from '../../ui';

/**
 * Entrada al llegar a pantalla: la pieza sube unos píxeles y aparece (sólo opacidad y desplazamiento). Lo que ya está a la vista al
 * cargar no se anima ni se esconde, y sin `IntersectionObserver` (o sin script) todo queda visible. `prefers-reduced-motion` la anula en `index.css`.
 */
export function Aparece({ children, className, retraso = 0, como: Tag = 'div' }: { children: ReactNode; className?: string; retraso?: number; como?: ElementType }) {
  const ref = useRef<HTMLElement>(null);
  const [oculto, setOculto] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    if (el.getBoundingClientRect().top < window.innerHeight) return;
    setOculto(true);
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setOculto(false); io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag ref={ref} style={{ transitionDelay: oculto ? undefined : `${retraso}ms` }}
      className={cx('transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none', oculto && 'translate-y-6 opacity-0', className)}>
      {children}
    </Tag>
  );
}
