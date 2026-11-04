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
