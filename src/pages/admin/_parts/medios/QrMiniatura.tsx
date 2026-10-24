import { useState } from 'react';
import { QrCodeIcon } from '@heroicons/react/24/outline';
import { cx } from '../../../../ui';
import { urlQr } from './tipos';

/** Imagen del QR con el fondo claro que necesita para escanearse (también en modo oscuro). Si no carga, muestra un icono. */
export function QrImagen({ id, version, alt, className }: { id: number; version?: string; alt: string; className?: string }) {
  const [falla, setFalla] = useState(false);
  if (falla) {
    return <span className={cx('flex items-center justify-center rounded border border-line bg-surface2 text-muted', className)} role="img" aria-label={`${alt} (no se pudo cargar)`}><QrCodeIcon className="h-1/2 w-1/2" /></span>;
  }
  // `bg-white`: un QR oscuro sobre fondo oscuro no se puede escanear; es la única superficie fija en blanco de la app.
  return <img src={urlQr(id, version)} alt={alt} onError={() => setFalla(true)} className={cx('rounded border border-line bg-white object-contain', className)} />;
}
