# Manual de usuario de House

`manual-house.json` es el contenido EXACTO con el que se publica el manual «Cómo usar Torre, según tu rol» (My Workspace, herramienta
`web_crear` con `diseno: "manual"`): título, kicker, subtítulo, meta, descripción y las secciones. Para actualizarlo, se edita este archivo y se
vuelve a publicar pasando su contenido a `web_crear` (crea un recurso NUEVO: anota en `docs/HANDOFF.md` cuál reemplaza).

- Capturas: `node scripts/marketing/capturas-manual.mjs [nombre…]` → `.claude/manual/capturas/` (seed local, nunca datos reales). Desde el
  checkout principal (`cd` a la raíz del repo, no al worktree), porque la base y la app local están ahí. Se suben a
  `https://sitios.gargurevich.dev/manual-torre-capturas/` con `scp … gds-vps:/opt/stack/sitios/manual-torre-capturas/` (sobrescribe; no borrar lo viejo).
- Cuentas de las capturas (seed local): `ana.lopez@…` (administración), `patricia.alarcon.9@…` (junta del Block 1), `javier.castro@…`
  (propietario) y `ana.huaman.38@…` (con un voucher en revisión, para «Ver mi voucher»). La captura de «Ampliar» no se publica: los
  comprobantes del seed son PNG de ~300 bytes, no se lee nada.
- Versiones publicadas:
  - 30-oct-2026, recurso `cmvuwrn5z000yzt7dybudh1r1` (reemplazado y borrado de My Workspace el 30-oct).
  - 30-oct-2026 (2), recurso `cmvv9urmi000bf5xdkb42hpwt` (reemplazado por la versión 3): 36 secciones; agrega «Crea tu cuenta» y «Planes y precios»,
    «Notificaciones», la validación con OCR primero, «Ver mi voucher» y «Ampliar», y el cargo de la junta en el menú.
  - 30-oct-2026 (3), recurso `cmvvqh1kf000xf5xdaahmr6o5` (vigente): marca Torre, `torrecondominios.com`, cuatro planes (Torre Gratis/Básico/Pro/Administradora), solo lectura, Mi plan y privacidad; 38 secciones, capturas en `manual-torre-capturas/`. Actualizado en el mismo enlace el 31-oct-2026 (versiones 4, 5 y 6): precios nuevos (Básico S/ 1,50 · Pro S/ 3,50 · Administradora S/ 3,00) y captura `precios.jpg`; se parchó el HTML publicado (mismo archivo en MinIO) en vez de crear otro recurso.

- Nota: hubo una publicación intermedia el mismo día (`cmvv9nbz10004f5xdk0dejkks`) con «tú misma» y dos textos que nombraban sólo a la IA; la vigente es `cmvv9urmi000bf5xdkb42hpwt`.

- 1-nov-2026 (6), mismo recurso `cmvvqh1kf000xf5xdaahmr6o5` y mismo archivo: 42 secciones; agrega Conciliación bancaria, Áreas comunes y reservas (admin y vecino), «Si tu edificio tiene una sola junta», Lecturas de agua desde su menú y el tema en el menú del usuario. Se generó con `web_crear` (llamada al endpoint MCP con el JSON del repo), se copió encima del archivo publicado y se borró el recurso nuevo.

- 2-nov-2026 (7), mismo recurso `cmvvqh1kf000xf5xdaahmr6o5` y mismo archivo: Torre Básico S/ 2,00 por departamento, desde S/ 40 al mes, sin tope. Se parchó el HTML publicado en MinIO (sin `web_crear`).

- 3-nov-2026 (8), **publicado** por Opus el 3-nov (mismo recurso `cmvvqh1kf000xf5xdaahmr6o5` y mismo archivo: `web_crear` por el endpoint MCP, copia encima del archivo publicado y borrado del recurso nuevo): 54 secciones. Agrega «Ten Torre en tu celular», «Subir el Excel de un block nuevo», «Estado de cuenta de un departamento», «Rendición del mes» (admin y junta), «Comunicados» reescrito (junta, correo, WhatsApp y grupos), «WhatsApp: conecta tu número y mira cuántos mensajes salen», «Mis grupos», «Avisos por WhatsApp del condominio», «Comunicados de la junta» y «Tu estado de cuenta» (vecino); imágenes en «Crear usuarios para tu personal» y «Propietarios e inquilinos». Corrige la tabla inicial (rangos de secciones) y las referencias cruzadas.
- **Manuales por rol (para PDF)**: `manual-administradora.json` (33 secciones; empieza por «Crear usuarios para tu personal»), `manual-junta.json` (15), `manual-vecino.json` (17) y `manual-personal.json` (9). Mismo formato que `manual-house.json`; salen de él (mismas secciones, mismos textos). Se generan con `doc_pdf` (o `web_crear` con `diseno: "manual"`). Capturas nuevas (13) en `.claude/manual/capturas/` del worktree: se suben con `scp … gds-vps:/opt/stack/sitios/manual-torre-capturas/`.

- PDF por rol publicados el 3-nov-2026 con `doc_pdf` (diseño manual): administradora `cmw1joons001f12k1mmt49yup` (32 págs.), junta `cmw1jope9001g12k1apx304s1`, vecino `cmw1joq6b001h12k1bzeavsx8`, personal `cmw1jorsp001i12k1eqvkcghx`. Videos v5/v6 en MinIO `videos-torre/` y en My Workspace (espacio Torre): v5 escritorio `cmw1jq9w3001j12k10864f3mp`, v5 celular `cmw1jqc1t001k12k1d932zgyq`, v6 escritorio `cmw1jqe4r001l12k19rzhrz23`, v6 celular `cmw1jqg2l001m12k1zb5qr5c0`.
- Gotcha: la base local `house` tenía un usuario REAL (admin «Melina …», correo de Gmail) que salió en el v6 y en la captura de Personal; Opus lo cambió temporalmente por «Mónica Paredes» para regrabar y lo dejó como estaba. Antes de grabar, revisa que la lista de Personal/Residentes sólo tenga cuentas `@prueba.house`/del seed.

- 4-nov-2026 (10), mismo recurso `cmvvqh1kf000xf5xdaahmr6o5` y mismo archivo: 56 secciones; agrega «Cargar los contactos de los vecinos con Excel» y «Personas del departamento y acceso a Torre» (sin imagen). PDF de la administradora regenerado con `doc_pdf` (35 secciones, 34 págs.) y copiado encima del archivo de `cmw1joons001f12k1mmt49yup` (mismo enlace); los recursos nuevos se borraron. Los PDF de junta, vecino y personal no cambian.

## Videos del manual (uno por opción del menú de cada rol)

Un video corto (15–40 s, escritorio 16:9, voz «Dora» de My Workspace) por opción del menú, para enlazarlos desde el manual HTML. Se grabaron el 4-nov-2026
sobre la app LOCAL (seed de Los Libertadores; ningún dato real). Los .mp4/.wav/.webm NO se commitean: viven en `.claude/videos/<video>/` (fuera de git).

- **Qué hay**: `docs/marketing/manual-videos.json` (opción del menú → video: `{ id, rol, menu, ruta, video, titulo, descripcion, archivo, duracion_s }`; el
  inquilino y jardinería comparten los videos del propietario y de limpieza, `comparte_con`) y `docs/marketing/guiones-manual.md` (tablas «En pantalla | Voz»).
  Cada video es `.claude/videos/m-<rol>-<seccion>/torre-m-<rol>-<seccion>-escritorio.mp4`.
- **Dónde vive el contenido**: `scripts/marketing/videos-manual.mjs` (título, voz, descripción y acciones de cada escena, más `MENU`). `grabar-video.mjs` lo carga
  para los videos `m-…`; las cuentas de los 8 roles de prueba están en el mismo módulo (las del botón de desarrollo del login; sólo locales).
- **Regenerar la lista y los guiones**: `node scripts/marketing/videos-manual.mjs --lista` (añade ruta y duración de los mp4 que existan) y `--guiones`.
- **Regrabar**: con la app local arriba (Vite 5173 + backend 4000, base `house` con el seed):
  - `scripts/marketing/grabar-manual.sh` — recorre la lista y SALTA los que ya tienen su mp4 (se puede reanudar); `scripts/marketing/grabar-manual.sh m-admin-recibos …`
    regraba sólo esos. Por video: comprueba la voz → `grabar-video.mjs` (un Chromium) → `montar-video.sh` (un ffmpeg) → `hoja-video.sh`.
  - **Revisión**: `scripts/marketing/hoja-video.sh <video>` saca 3 cuadros (final de cada escena) a `.claude/videos/<video>/hoja/` y los une en `hoja.jpg`.
    Se mira que la pantalla sea la correcta, sin errores, sin «Cuentas de prueba», sin datos reales ni pantallas vacías.
  - **Datos de prueba**: `node scripts/marketing/videos-manual.mjs --preparar` (lo corre `grabar-manual.sh`) crea, si faltan, 4 tareas de mantenimiento y limpieza
    asignadas a María Fernández y a Lucía Rojas, para que «Mis tareas» no salga vacía. Es lo único que se escribe en la base local.
- **Voz** (no la genera el script: sale de la herramienta MCP `audio_generar` de My Workspace): `node scripts/marketing/videos-manual.mjs --voz` deja el texto de cada
  escena en `.claude/videos/voz-manual.json`; se genera cada una con `voice: "ef_dora"` y se baja con `scripts/marketing/bajar-voz.sh "<video> <escena> <hash>"`
  (el hash es lo que sigue a `voz-` en la URL devuelta) a `.claude/videos/<video>/voz/e<N>.wav`. La duración de cada escena la manda su voz (+0,7 s). Si cambias el
  texto de una escena en `videos-manual.mjs`, vuelve a generar SU voz y regraba ese video.
- **Datos reales que nunca deben verse**: la base local tiene a Miguel (superadmin y presidente del Block 1) y UNA cuenta real de administradora («Melina Loayza», correo de
  Gmail, en la empresa de Ana López, así que sale en Mi empresa › Personal). `grabar-video.mjs` cambia en pantalla «Miguel Gargurevich», «Miguel F. Gargurevich» y
  cualquier `gargurevich` por «Martín Gallardo Ríos»/«Gallardo», «Melina Loayza» por «Mónica Paredes» y cualquier `@gmail.com` por `monica.paredes@prueba.house`
  (constante `SUSTITUIR`). Revisa Personal, Usuarios y las juntas en cada regrabación.
- **Límite de login**: `/api/auth/login` bloquea (429) tras ~10–15 intentos en 15 min. `grabar-video.mjs` guarda una sesión por rol en `.claude/videos/sesiones/`; no hagas
  exploraciones que inicien sesión una y otra vez.
- **No grabable**: «Rendición del mes» de la junta (`/junta/rendicion`) responde «Tu usuario no tiene una empresa asignada» (problema de la pantalla, anotado en el HANDOFF);
  en `manual-videos.json` esa opción lleva `video: null` y `video_alterno: m-admin-rendicion`. WhatsApp se graba en estado «Número no vinculado» (no hay Evolution en local).

- 4-nov-2026: **«Torre en video: cada opción del menú, según tu rol»** (recurso `cmw289vue004z12k19g1ab7gd`, verde de Torre `#0f766e`): 62 secciones, 60 opciones del menú por rol con su video (43 videos distintos, 12,4 min, en MinIO `videos-torre/manual/`). Se rearma con `python3 scripts/marketing/manual-con-videos.py payload <json>` → `web_crear` → `… videos <html> <html>` (inserta los `<video>`) → se copia encima del archivo publicado. Todos los manuales por rol enlazan esta versión en su primera sección.
