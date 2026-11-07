#!/usr/bin/env python3
"""Pone el sello de Torre (logo) en un PDF de manual.

Uso:
  python3 -P scripts/marketing/sello-pdf.py <entrada.pdf> <salida.pdf>

Portada: logo grande (52 pt) en (49, 600). Demás páginas: logo chico (14 pt) en (49, 22) y el texto
«Torre · Administración de condominios» a su derecha. La entrada no se toca: la salida es un PDF nuevo.

Se aplica como último paso, sobre el PDF recién generado por `doc_pdf` (diseño manual), porque ese PDF no trae
el logo. NO es idempotente: aplicarlo dos veces pone el sello dos veces. Si hay que rehacerlo, parte siempre del
PDF sin sello (el de `doc_pdf`), no de uno ya sellado.

Requiere pypdf y reportlab en el Python del usuario; por eso `-P` (no `-I`), que no quita el site del usuario.
"""
import io
import sys

import pypdf
from reportlab.lib.colors import HexColor, white
from reportlab.pdfgen import canvas

VERDE = HexColor('#0f766e')  # el verde de Torre (el mismo del ícono y del manual)
GRIS = HexColor('#4b5563')


def torre(c, x, y, s, fondo, trazo):
    """Dibuja el logo (cuadro redondeado + torre) en un cuadro de s puntos en (x, y). Coordenadas del SVG 32x32, y hacia abajo."""
    k = s / 32.0
    c.setFillColor(fondo)
    c.roundRect(x, y, s, s, 7.5 * k, stroke=0, fill=1)

    def X(v):
        return x + (16 + (v - 16) * 1.2) * k

    def Y(v):
        return y + s - (16 + (v - 16) * 1.2) * k

    c.setStrokeColor(trazo)
    c.setLineWidth(2.2 * 1.2 * k)
    c.roundRect(X(10), Y(26.5), (12 * 1.2) * k, (21 * 1.2) * k, 1.6 * 1.2 * k, stroke=1, fill=0)
    c.setFillColor(trazo)
    for (a, b, w, h) in [(13, 9.5, 2.2, 2.2), (16.8, 9.5, 2.2, 2.2), (13, 13.8, 2.2, 2.2), (16.8, 13.8, 2.2, 2.2),
                         (13, 18.1, 2.2, 2.2), (16.8, 18.1, 2.2, 2.2), (14.6, 21.6, 2.8, 4.9)]:
        c.rect(X(a), Y(b + h), w * 1.2 * k, h * 1.2 * k, stroke=0, fill=1)


def capa(ancho, alto, portada):
    """Una página en blanco del tamaño de la original, con el sello: grande en la portada, chico en las demás."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(ancho, alto))
    if portada:
        torre(c, 49, 600, 52, VERDE, white)
    else:
        torre(c, 49, 22, 14, VERDE, white)
        c.setFillColor(GRIS)
        c.setFont('Helvetica', 8)
        c.drawString(67, 26, 'Torre · Administración de condominios')
    c.save()
    buf.seek(0)
    return pypdf.PdfReader(buf).pages[0]


def sellar(entrada, salida):
    lector = pypdf.PdfReader(entrada)
    escritor = pypdf.PdfWriter()
    for i, pagina in enumerate(lector.pages):
        ancho = float(pagina.mediabox.width)
        alto = float(pagina.mediabox.height)
        pagina.merge_page(capa(ancho, alto, i == 0))
        escritor.add_page(pagina)
    escritor.add_metadata(lector.metadata or {})
    with open(salida, 'wb') as f:
        escritor.write(f)
    return len(lector.pages)


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    n = sellar(sys.argv[1], sys.argv[2])
    print(f'{n} páginas selladas → {sys.argv[2]}')
