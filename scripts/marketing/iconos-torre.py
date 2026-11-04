#!/usr/bin/env python3
"""Genera los íconos de Torre (la torre con ventanas, opción A de Miguel, 4-nov-2026) en `public/`.

Uso: python3 scripts/marketing/iconos-torre.py

Mismas medidas que `src/ui/IconoTorre.tsx` (cuadro de 32 × 32). Se dibuja 8 veces más grande y se reduce (bordes suaves sin depender de un
rasterizador de SVG). Salen:
  favicon.svg, favicon-16.png, favicon-32.png        pestaña del navegador
  icon-192.png, icon-512.png                         app instalada (esquinas redondeadas, fondo transparente)
  apple-touch-icon.png (180)                         iPhone (cuadrado lleno: iOS redondea solo)
  icon-maskable-192.png, icon-maskable-512.png       Android (fondo a sangre y la torre dentro de la zona segura)
"""
from PIL import Image, ImageDraw

VERDE = (15, 118, 110, 255)
BLANCO = (255, 255, 255, 255)
TORRE = (10, 5.5, 12, 21, 1.6)  # x, y, ancho, alto, radio
VENTANAS = [(13, 9.5), (16.8, 9.5), (13, 13.8), (16.8, 13.8), (13, 18.1), (16.8, 18.1)]
VENTANA = 2.2
PUERTA = (14.6, 21.6, 2.8, 4.9)
SS = 8  # supermuestreo
# La torre se dibuja un 20 % más grande que las medidas base (Miguel, 4-nov: en el Dock se veía chica al lado de los demás íconos).
ESCALA = 1.2


def dibujar(lado, *, esquinas=True, escala=ESCALA, trazo=2.0):
    """Ícono de `lado` px. `escala` < 1 achica la torre dentro del cuadro (maskable). `trazo` en unidades de 32."""
    n = lado * SS
    im = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    u = n / 32
    if esquinas:
        d.rounded_rectangle((0, 0, n - 1, n - 1), radius=8 * u, fill=VERDE)
    else:
        d.rectangle((0, 0, n, n), fill=VERDE)
    c = 16  # centro: la torre se escala alrededor del centro del cuadro

    def p(x, y):
        return ((c + (x - c) * escala) * u, (c + (y - c) * escala) * u)

    x, y, w, h, r = TORRE
    t = trazo * escala * u
    a, b = p(x, y), p(x + w, y + h)
    d.rounded_rectangle((a[0] - t / 2, a[1] - t / 2, b[0] + t / 2, b[1] + t / 2), radius=(r + trazo / 2) * escala * u, fill=BLANCO)
    d.rounded_rectangle((a[0] + t / 2, a[1] + t / 2, b[0] - t / 2, b[1] - t / 2), radius=max(0, (r - trazo / 2)) * escala * u, fill=VERDE)
    for vx, vy in VENTANAS:
        a, b = p(vx, vy), p(vx + VENTANA, vy + VENTANA)
        d.rounded_rectangle((*a, *b), radius=0.4 * escala * u, fill=BLANCO)
    x, y, w, h = PUERTA
    a, b = p(x, y), p(x + w, y + h)
    d.rectangle((*a, *b), fill=BLANCO)
    return im.resize((lado, lado), Image.LANCZOS)


def svg():
    x, y, w, h, r = TORRE
    ventanas = ''.join(f'<rect x="{vx}" y="{vy}" width="{VENTANA}" height="{VENTANA}" rx="0.4" fill="#fff"/>' for vx, vy in VENTANAS)
    px, py, pw, ph = PUERTA
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0f766e"/>'
            f'<g transform="translate(16 16) scale({ESCALA}) translate(-16 -16)">'
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="none" stroke="#fff" stroke-width="2"/>{ventanas}'
            f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" fill="#fff"/></g></svg>\n')


if __name__ == '__main__':
    open('public/favicon.svg', 'w').write(svg())
    dibujar(16, trazo=2.6).save('public/favicon-16.png')
    dibujar(32, trazo=2.2).save('public/favicon-32.png')
    dibujar(192).save('public/icon-192.png')
    dibujar(512).save('public/icon-512.png')
    dibujar(180, esquinas=False).convert('RGB').save('public/apple-touch-icon.png')
    # Maskable: la zona segura es un círculo de radio 40 % (12,8 de 32); la media diagonal de la torre es ~12,1 × escala: hasta 1,05 entra entera.
    dibujar(192, esquinas=False, escala=1.02).convert('RGB').save('public/icon-maskable-192.png')
    dibujar(512, esquinas=False, escala=1.02).convert('RGB').save('public/icon-maskable-512.png')
    print('íconos de Torre generados en public/')
