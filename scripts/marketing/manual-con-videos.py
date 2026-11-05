#!/usr/bin/env python3
"""Manual HTML de Torre con un video por opción del menú, en el verde de Torre.

Uso:
  python3 scripts/marketing/manual-con-videos.py payload <salida.json>
      Arma el contenido para `web_crear` (diseño manual, acento verde) desde docs/marketing/manual-videos.json y los guiones.
      Cada sección lleva un párrafo marcador «VIDEO::<video>» donde va su video.
  python3 scripts/marketing/manual-con-videos.py videos <entrada.html> <salida.html> [<payload>.grupos.json]
      Modo claro fijo, índice con scroll y separado por rol, y reemplaza cada marcador por un <video> con la URL pública del video (MinIO, videos-torre/manual/).
      Además pone el logo de Torre (favicon, hero y pie): `marca()`, idempotente. Falla con mensaje si no encuentra el <h1> del hero o el pie.

Los videos se graban con scripts/marketing/grabar-manual.sh y se suben a MinIO (ver docs/manual/README.md).
"""
import html
import json
import re
import sys

BASE_VIDEOS = 'https://s3.gargurevich.dev/dashboardia-bucket/documentos/b601f104-f838-49e7-9da5-c49efe9dc723/videos-torre/manual'
ACENTO = '#0f766e'  # verde de Torre (el mismo del cierre de los videos y del ícono)
APP = 'https://torrecondominios.com'
ORDEN_ROLES = ['todos', 'admin', 'junta', 'junta_central', 'propietario', 'inquilino', 'mantenimiento', 'seguridad', 'limpieza', 'jardineria']
QUIEN = {
    'todos': 'Todos los usuarios, en el celular',
    'admin': 'La administradora (la empresa que administra el condominio)',
    'junta': 'La junta directiva de cada block (presidente, tesorero, secretario)',
    'junta_central': 'La Junta central del condominio (además de lo de la junta)',
    'propietario': 'Los propietarios',
    'inquilino': 'Los inquilinos',
    'mantenimiento': 'El personal de mantenimiento',
    'seguridad': 'El personal de seguridad',
    'limpieza': 'El personal de limpieza',
    'jardineria': 'El personal de jardinería',
}

# Logo de Torre: el mismo de src/ui/IconoTorre.tsx (escala 1.2, cuadro verde #0f766e redondeado y torre blanca).
MARCA_TORRE = ('<g transform="translate(16 16) scale(1.2) translate(-16 -16)">'
               '<rect x="10" y="5.5" width="12" height="21" rx="1.6" fill="none" stroke="#fff" stroke-width="2.2"/>'
               '<g fill="#fff">'
               '<rect x="13" y="9.5" width="2.2" height="2.2"/><rect x="16.8" y="9.5" width="2.2" height="2.2"/>'
               '<rect x="13" y="13.8" width="2.2" height="2.2"/><rect x="16.8" y="13.8" width="2.2" height="2.2"/>'
               '<rect x="13" y="18.1" width="2.2" height="2.2"/><rect x="16.8" y="18.1" width="2.2" height="2.2"/>'
               '<rect x="14.6" y="21.6" width="2.8" height="4.9"/></g></g>')
MARCA_FONDO = '<rect width="32" height="32" rx="7.5" fill="#0f766e"/>'
MARCA_GRANDE = f'<svg class="logo-torre" viewBox="0 0 32 32" role="img" aria-label="Torre">{MARCA_FONDO}{MARCA_TORRE}</svg>'
MARCA_PIE = f'<svg class="logo-torre-pie" viewBox="0 0 32 32" aria-hidden="true">{MARCA_FONDO}{MARCA_TORRE}</svg>'
# Favicon como data URI: comillas y numerales escapados a mano (así lo tiene el HTML publicado).
MARCA_FAVICON = ('<link rel="icon" href="data:image/svg+xml,'
                 + f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">{MARCA_FONDO}{MARCA_TORRE}</svg>'.replace('"', '%22').replace('#', '%23')
                 + '">')
MARCA_CSS = ('.logo-torre{display:block;width:4.5rem;height:4.5rem;margin:0 0 1.1rem;filter:drop-shadow(0 6px 16px rgba(15,118,110,.25))}'
             '.logo-torre-pie{width:1.6rem;height:1.6rem;vertical-align:-.4rem;margin-right:.5rem}')


def marca(h):
    """Pone el logo en el HTML: favicon, CSS, el SVG antes del <h1> del hero y el SVG dentro de <p class="nombre"> del pie.
    Idempotente: lo que ya esté no se repite. Si falta un punto de anclaje, termina con error y no escribe nada."""
    if '</head>' not in h:
        sys.exit('marca: no encuentro </head> en el HTML; no escribo nada.')
    if 'rel="icon"' not in h:
        h = h.replace('</head>', MARCA_FAVICON + '</head>', 1)
    if '.logo-torre{' not in h:
        h = h.replace('</head>', '<style>' + MARCA_CSS + '</style></head>', 1)
    if 'class="logo-torre"' not in h:
        h, n = re.subn(r'<h1(?:\s[^>]*)?>', lambda m: MARCA_GRANDE + m.group(0), h, count=1)
        if n == 0:
            sys.exit('marca: no encuentro el <h1> del hero en el HTML; no escribo nada. ¿Cambió la plantilla del manual?')
    if 'class="logo-torre-pie"' not in h:
        h, n = re.subn(r'<p class="nombre"[^>]*>', lambda m: m.group(0) + MARCA_PIE, h, count=1)
        if n == 0:
            sys.exit('marca: no encuentro <p class="nombre"> (el pie del manual) en el HTML; no escribo nada.')
    return h


def voces():
    """Las frases de la voz de cada video, en orden, desde docs/marketing/guiones-manual.md."""
    g = open('docs/marketing/guiones-manual.md', encoding='utf-8').read()
    out = {}
    for b in re.split(r'\n## `', g)[1:]:
        video = b.split('`', 1)[0]
        filas = [l for l in b.splitlines() if re.match(r'^\| \d+ \|', l)]
        out[video] = [l.strip('|').split('|')[-1].strip() for l in filas]
    return out


def payload(salida):
    secciones_videos = json.load(open('docs/marketing/manual-videos.json', encoding='utf-8'))
    voz = voces()
    por_rol = {}
    for e in secciones_videos:
        por_rol.setdefault(e['rol'], []).append(e)
    roles = [r for r in ORDEN_ROLES if r in por_rol] + [r for r in por_rol if r not in ORDEN_ROLES]

    filas_indice = [[por_rol[r][0]['rol_nombre'], QUIEN.get(r, ''), str(len(por_rol[r]))] for r in roles]
    secciones = [
        {
            'titulo': 'Cómo usar este manual',
            'etiqueta': 'Para empezar',
            'parrafos': [
                'Cada sección es una opción del menú de Torre, ordenadas por rol. Cada una dice para qué sirve y trae un **video corto** (de 15 a 40 segundos) con la pantalla real.',
                'Los videos se grabaron con **datos de prueba**: los nombres, departamentos y montos no son de ningún condominio real.',
                f'Entra a Torre en [torrecondominios.com]({APP}) con el correo y la contraseña que te dio tu administración. Si es tu primera vez, abre el enlace de la invitación que te llegó por correo y crea tu contraseña.',
            ],
            'tabla': {'columnas': ['Rol', 'Quién lo usa', 'Opciones'], 'filas': filas_indice},
            'aviso': {'tipo': 'nota', 'texto': 'Solo ves en tu menú las opciones de tu rol. Si eres propietario y además estás en la junta de tu block, ves las dos partes.'},
        },
        # Onboarding (videos 7 y 8 de marketing): el camino completo, en orden, antes del detalle de cada opción.
        {
            'titulo': 'Empieza con Torre (administración)',
            'etiqueta': 'Empieza aquí',
            'parrafos': [
                'ANCLA::empieza-administracion',
                'El primer día de la administradora, en orden: instala Torre en el celular, carga los contactos de los vecinos con la plantilla, conecta el WhatsApp de la administración y asigna el grupo de cada block, pon tu marca, revisa las personas de cada departamento y avisa tu primer recibo.',
                'Lo general (el recibo, los comunicados) va al grupo de WhatsApp de cada block; lo personal (vence, venció, recordatorios) va directo a cada vecino.',
                'VIDEO::v7::escritorio',
            ],
        },
        {
            'titulo': 'Bienvenido a Torre (vecinos)',
            'etiqueta': 'Empieza aquí',
            'parrafos': [
                'ANCLA::empieza-vecinos',
                'Para propietarios e inquilinos: te llega la invitación por correo, creas tu contraseña, instalas Torre en el celular, ves lo que debes, pagas y subes tu voucher, y lees los comunicados de tu edificio.',
                'VIDEO::v8::escritorio',
            ],
        },
    ]
    for r in roles:
        for e in por_rol[r]:
            video = e.get('video') or e.get('video_alterno')
            if not video:
                # Sin video propio: el de la misma pantalla en otro rol (p. ej. la rendición de la junta es la de la administradora).
                video = next((x['video'] for x in secciones_videos if x.get('video') and x['menu'] == e['menu']), None)
            # Anclas estables para los enlaces de la app («Ver video» de cada pantalla y «Manual y videos» del menú): `#<id>` y, en la primera opción
            # de cada rol, `#rol-<rol>`. Los ids `sNN` de la plantilla cambian si se agrega una sección; estos no.
            anclas = [e['id']] + ([f'rol-{r}'] if e is por_rol[r][0] else [])
            parrafos = [f'ANCLA::{"|".join(anclas)}', e['descripcion']]
            frases = voz.get(video or '', [])
            if frases:
                parrafos.append(' '.join(frases))
            if e.get('comparte_con') or e.get('nota'):
                parrafos.append(e.get('nota') or 'Es la misma pantalla que la de otro rol: el video sirve igual.')
            if video:
                formato = e.get('formato') or 'escritorio'
                parrafos.append(f'VIDEO::{video}::{formato}')
            secciones.append({'titulo': e['menu'], 'etiqueta': e['rol_nombre'], 'parrafos': parrafos})

    secciones.append({
        'titulo': 'Si algo no funciona',
        'etiqueta': 'Ayuda',
        'bullets': [
            '¿No puedes entrar? Pide a tu administración que te reenvíe la invitación, o usa «¿Olvidaste tu contraseña?» en la pantalla de inicio.',
            '¿No ves una opción del menú? Tu rol no la tiene: escríbele a tu administración.',
            '¿Un video no carga? Revisa tu conexión: los videos se ven en línea, no se descargan.',
        ],
    })
    datos = {
        'titulo': 'Torre · Administración de condominios',
        'kicker': 'Manual de usuario con videos · versión del 4-nov-2026',
        'subtitulo': 'Cada opción del menú de Torre, según tu rol: para qué sirve y cómo se usa, con un video corto de la pantalla real.',
        'meta': ['torrecondominios.com', f'{len(secciones_videos)} opciones · {len({e.get("video") for e in secciones_videos if e.get("video")})} videos', 'Español · Perú'],
        'diseno': 'manual',
        'tema': 'verde',  # claro (el tema por defecto de la cuenta es oscuro; Miguel pidió el manual en modo claro)
        'acento': ACENTO,
        'descripcion': 'Manual de Torre con un video por cada opción del menú y por rol (administradora, junta, vecinos y personal). Datos de prueba. Corte: 4-nov-2026.',
        'secciones': secciones,
    }
    json.dump(datos, open(salida, 'w', encoding='utf-8'), ensure_ascii=False)
    grupos, previo = [], None
    for i, s in enumerate(secciones, start=1):
        if s.get('etiqueta') != previo and i > 1 and s.get('etiqueta') not in ('Ayuda',):
            grupos.append({'seccion': f's{i:02d}', 'rol': s['etiqueta']})
        previo = s.get('etiqueta')
    json.dump(grupos, open(salida + '.grupos.json', 'w', encoding='utf-8'), ensure_ascii=False)
    print(f'{len(secciones)} secciones → {salida}')


def videos(entrada, salida, grupos_json=None):
    h = open(entrada, encoding='utf-8').read()
    # Modo claro fijo (Miguel, 4-nov): el CSS del diseño manual deja el oscuro sólo sin `data-esquema="claro"`.
    h = re.sub(r'<html([^>]*)>', lambda m: m.group(0) if 'data-esquema' in m.group(1) else f'<html{m.group(1)} data-esquema="claro">', h, count=1)
    # El script de la plantilla quita `data-esquema` si la dirección no trae `#esquema=…` (y manda el sistema): aquí el defecto es claro.
    h = h.replace("else raiz.removeAttribute('data-esquema');", "else raiz.setAttribute('data-esquema', 'claro');", 1)
    # Índice por rol: un rótulo antes de la primera opción de cada rol.
    if grupos_json:
        for g in json.load(open(grupos_json, encoding='utf-8')):
            h = h.replace(f'<li><a href="#{g["seccion"]}">', f'<li class="toc-rol">{html.escape(g["rol"])}</li><li><a href="#{g["seccion"]}">', 1)
    n = 0

    def reemplazo(m):
        nonlocal n
        n += 1
        v = html.unescape(m.group(1))
        formato = m.group(2) or 'escritorio'
        url = f'{BASE_VIDEOS}/torre-{v}-{formato}.mp4'
        clase = 'video-torre video-celular' if formato == 'celular' else 'video-torre'
        return (f'<figure class="{clase}"><video controls preload="none" playsinline '
                f'src="{url}#t=0.5" aria-label="Video de esta opción"></video>'
                f'<figcaption><a href="{url}" target="_blank" rel="noopener">Abrir el video en otra pestaña</a></figcaption></figure>')

    def ancla(m):
        return ''.join(f'<span id="{html.escape(x)}" class="ancla-torre"></span>' for x in html.unescape(m.group(1)).split('|'))

    h = re.sub(r'<p[^>]*>\s*ANCLA::([A-Za-z0-9._|-]+)\s*</p>', ancla, h)
    h = re.sub(r'<p[^>]*>\s*VIDEO::([A-Za-z0-9._-]+?)(?:::(escritorio|celular))?\s*</p>', reemplazo, h)
    estilo = ('<style>.video-torre{margin:1rem 0 0}.video-torre video{display:block;width:100%;max-width:960px;aspect-ratio:16/9;'
              'border-radius:12px;border:1px solid var(--borde,#e2e8f2);background:#0b1f1d}'
              '.video-celular video{max-width:340px;aspect-ratio:9/16}'
              '.video-torre figcaption{margin-top:.4rem;font-size:.85rem}@media print{.video-torre{display:none}}'
              # El índice lateral es «sticky»: con 60 opciones no entraba en la pantalla y no se podía bajar.
              '.toc{max-height:calc(100vh - 3rem);overflow-y:auto;overscroll-behavior:contain;padding-right:.25rem}'
              '.toc .toc-rol{margin:.9rem .7rem .3rem;font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:var(--acento)}'
              '.ancla-torre{display:block;position:relative;top:-6rem;visibility:hidden}'
              ':root{color-scheme:light}</style>')
    # Idempotente: si el HTML ya trae el CSS del video (p. ej. el publicado), no se repite.
    if '.video-torre{margin' not in h:
        h = h.replace('</head>', estilo + '</head>', 1)
    # El logo de Torre queda fijo aquí: si se regenera el manual, no se pierde.
    h = marca(h)
    open(salida, 'w', encoding='utf-8').write(h)
    restantes = len(re.findall('VIDEO::|ANCLA::', h))
    print(f'videos insertados: {n}; marcadores sin reemplazar: {restantes}')
    if restantes:
        sys.exit(1)


if __name__ == '__main__':
    if len(sys.argv) >= 3 and sys.argv[1] == 'payload':
        payload(sys.argv[2])
    elif len(sys.argv) >= 4 and sys.argv[1] == 'videos':
        videos(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) >= 5 else None)
    else:
        print(__doc__)
        sys.exit(2)
