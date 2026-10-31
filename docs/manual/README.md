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
  - 30-oct-2026 (3), **pendiente de publicar** (id: por poner): 38 secciones; agrega «Mi plan: lo que pagas y lo que usas» y «Mi condominio está en solo lectura», los cuatro planes (tabla de precios), la casilla de Términos en el registro y los 30 días de Pro de prueba. Las capturas `precios` y `registro` se tomaron de nuevo.
  - 30-oct-2026 (3), recurso `cmvvqh1kf000xf5xdaahmr6o5` (vigente): marca Torre, `torrecondominios.com`, cuatro planes (Torre Gratis/Básico/Pro/Administradora), solo lectura, Mi plan y privacidad; 38 secciones, capturas en `manual-torre-capturas/`.

- Nota: hubo una publicación intermedia el mismo día (`cmvv9nbz10004f5xdk0dejkks`) con «tú misma» y dos textos que nombraban sólo a la IA; la vigente es `cmvv9urmi000bf5xdkb42hpwt`.
