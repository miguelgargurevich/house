#!/usr/bin/env python3
"""Fuentes de ícono y splash de la app (mobile/assets/) a partir de la torre de Torre.

Reutiliza `dibujar()` de scripts/marketing/iconos-torre.py (mismas medidas que `src/ui/IconoTorre.tsx`) a 1024 px, sin pasar por el
PNG de 512 de la web. Después `capacitor-assets generate` saca todos los tamaños de Android e iOS desde estos archivos.
Uso: npm run assets   (corre este script y luego capacitor-assets)
"""
import importlib.util
import sys
from pathlib import Path

from PIL import Image

sys.dont_write_bytecode = True  # no dejar __pycache__ dentro de scripts/marketing
RAIZ = Path(__file__).resolve().parents[2]
SALIDA = Path(__file__).resolve().parents[1] / 'assets'
VERDE = (15, 118, 110, 255)

spec = importlib.util.spec_from_file_location('iconos_torre', RAIZ / 'scripts' / 'marketing' / 'iconos-torre.py')
iconos = importlib.util.module_from_spec(spec)
spec.loader.exec_module(iconos)


def solo_blanco(im):
    """La torre (blanca) sobre transparente: el verde pasa a transparente y el blanco queda, con el borde suavizado."""
    px = im.convert('RGBA')
    datos = []
    for r, g, b, a in px.getdata():
        w = max(0, min(255, round((r - VERDE[0]) * 255 / (255 - VERDE[0]))))
        datos.append((255, 255, 255, w))
    out = Image.new('RGBA', px.size)
    out.putdata(datos)
    return out


def main():
    SALIDA.mkdir(exist_ok=True)
    # iOS y base de los íconos clásicos de Android: cuadrado lleno (cada sistema pone sus esquinas).
    iconos.dibujar(1024, esquinas=False).convert('RGB').save(SALIDA / 'icon-only.png')
    # Ícono adaptable de Android: fondo verde liso + torre en la zona segura (66 % central: escala 0.62 de la base).
    Image.new('RGBA', (1024, 1024), VERDE).save(SALIDA / 'icon-background.png')
    solo_blanco(iconos.dibujar(1024, esquinas=False, escala=0.62)).save(SALIDA / 'icon-foreground.png')
    # Splash: verde de la marca con la torre al centro (la torre ocupa ~ un tercio del lado corto: se ve igual en cualquier pantalla).
    for nombre in ('splash.png', 'splash-dark.png'):
        lienzo = Image.new('RGBA', (2732, 2732), VERDE)
        torre = solo_blanco(iconos.dibujar(900, esquinas=False, escala=1.2))
        lienzo.alpha_composite(torre, ((2732 - 900) // 2, (2732 - 900) // 2))
        lienzo.convert('RGB').save(SALIDA / nombre)
    print('assets/ listo:', ', '.join(sorted(p.name for p in SALIDA.iterdir())))


if __name__ == '__main__':
    main()
