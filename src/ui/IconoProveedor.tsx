import type { IconType } from 'react-icons';
import { RiOpenaiFill } from 'react-icons/ri';
import { SiGooglegemini, SiNvidia, SiOllama } from 'react-icons/si';
import { cx } from './cx';
import { datosIconoProveedor, type GlyphProveedor } from './proveedoresIcono';

const GLYPHS: Record<GlyphProveedor, IconType> = {
  googlagemini: SiGooglegemini,
  openai: RiOpenaiFill,
  nvidia: SiNvidia,
  ollama: SiOllama,
};

interface Props {
  slug: string;
  size?: number;
  className?: string;
}

export function IconoProveedor({ slug, size = 18, className }: Props) {
  const datos = datosIconoProveedor(slug);
  if (datos.glyph) {
    const Glyph = GLYPHS[datos.glyph];
    if (datos.adaptive) return <Glyph size={size} className={cx('shrink-0 text-ink', className)} title={slug} aria-hidden="true" />;
    return <Glyph size={size} className={cx('shrink-0', className)} style={{ color: datos.hex }} title={slug} aria-hidden="true" />;
  }
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded font-bold leading-none text-white', className)}
      style={{ backgroundColor: datos.hex, width: size, height: size, fontSize: Math.max(7, Math.round(size * 0.46)) }}
      title={slug}
      aria-hidden="true"
    >
      {datos.mono}
    </span>
  );
}
