import { useState } from 'react';
import { cx } from '../../../ui';

/** Imagen del recibo (foto del condominio, logo, contómetro). Si no carga, no deja ningún hueco ni el ícono de imagen rota. */
export function ImagenRecibo({ src, alt, className, onClick }: { src: string; alt: string; className?: string; onClick?: () => void }) {
  const [falla, setFalla] = useState(false);
  if (falla) return null;
  return <img src={src} alt={alt} onError={() => setFalla(true)} onClick={onClick} className={cx('block', className)} />;
}
