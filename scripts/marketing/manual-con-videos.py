#!/usr/bin/env python3
"""Manual HTML de Torre con un video por opción del menú, en el verde de Torre.

Uso:
  python3 scripts/marketing/manual-con-videos.py payload <salida.json>
      Arma el contenido para `web_crear` (diseño manual, acento verde) desde docs/marketing/manual-videos.json y los guiones.
      Cada sección lleva un párrafo marcador «VIDEO::<video>» donde va su video.
  python3 scripts/marketing/manual-con-videos.py videos <entrada.html> <salida.html> [<payload>.grupos.json]
      Modo claro fijo, índice con scroll y separado por rol, y reemplaza cada marcador por un <video> con la URL pública del video (MinIO, videos-torre/manual/).

Los videos se graban con scripts/marketing/grabar-manual.sh y se suben a MinIO (ver docs/manual/README.md).
"""
import html
import json
import re
import sys

BASE_VIDEOS = 'https://s3.gargurevich.dev/dashboardia-bucket/documentos/b601f104-f838-49e7-9da5-c49efe9dc723/videos-torre/manual'
ACENTO = '#0f766e'  # verde de Torre (el mismo del cierre de los videos y del ícono)
APP = 'https://torrecondominios.com'
ORDEN_ROLES = ['admin', 'junta', 'junta_central', 'propietario', 'inquilino', 'mantenimiento', 'seguridad', 'limpieza', 'jardineria']
QUIEN = {
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
        }
    ]
    for r in roles:
        for e in por_rol[r]:
            video = e.get('video') or e.get('video_alterno')
            if not video:
                # Sin video propio: el de la misma pantalla en otro rol (p. ej. la rendición de la junta es la de la administradora).
                video = next((x['video'] for x in secciones_videos if x.get('video') and x['menu'] == e['menu']), None)
            parrafos = [e['descripcion']]
            frases = voz.get(video or '', [])
            if frases:
                parrafos.append(' '.join(frases))
            if e.get('comparte_con') or e.get('nota'):
                parrafos.append(e.get('nota') or 'Es la misma pantalla que la de otro rol: el video sirve igual.')
            if video:
                parrafos.append(f'VIDEO::{video}')
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
        url = f'{BASE_VIDEOS}/torre-{v}-escritorio.mp4'
        return (f'<figure class="video-torre"><video controls preload="none" playsinline '
                f'src="{url}#t=0.5" aria-label="Video de esta opción"></video>'
                f'<figcaption><a href="{url}" target="_blank" rel="noopener">Abrir el video en otra pestaña</a></figcaption></figure>')

    h = re.sub(r'<p[^>]*>\s*VIDEO::([A-Za-z0-9._-]+)\s*</p>', reemplazo, h)
    estilo = ('<style>.video-torre{margin:1rem 0 0}.video-torre video{display:block;width:100%;max-width:960px;aspect-ratio:16/9;'
              'border-radius:12px;border:1px solid var(--borde,#e2e8f2);background:#0b1f1d}'
              '.video-torre figcaption{margin-top:.4rem;font-size:.85rem}@media print{.video-torre{display:none}}'
              # El índice lateral es «sticky»: con 60 opciones no entraba en la pantalla y no se podía bajar.
              '.toc{max-height:calc(100vh - 3rem);overflow-y:auto;overscroll-behavior:contain;padding-right:.25rem}'
              '.toc .toc-rol{margin:.9rem .7rem .3rem;font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;font-weight:600;color:var(--acento)}'
              ':root{color-scheme:light}</style>')
    h = h.replace('</head>', estilo + '</head>', 1)
    open(salida, 'w', encoding='utf-8').write(h)
    restantes = len(re.findall('VIDEO::', h))
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
