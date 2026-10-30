# Manual de usuario de House

`manual-house.json` es el contenido EXACTO con el que se publica el manual «Cómo usar House, según tu rol» (My Workspace, herramienta
`web_crear` con `diseno: "manual"`): título, kicker, subtítulo, meta, descripción y las secciones. Para actualizarlo, se edita este archivo y se
vuelve a publicar pasando su contenido a `web_crear` (crea un recurso NUEVO: anota en `docs/HANDOFF.md` cuál reemplaza).

- Capturas: `node scripts/marketing/capturas-manual.mjs [nombre…]` → `.claude/manual/capturas/` (seed local, nunca datos reales). Desde el
  checkout principal (`cd` a la raíz del repo, no al worktree), porque la base y la app local están ahí. Se suben a
  `https://sitios.gargurevich.dev/manual-house-capturas/` con `scp … gds-vps:/opt/stack/sitios/manual-house-capturas/` (sobrescribe; no borrar lo viejo).
- Cuentas de las capturas (seed local): `ana.lopez@…` (administración), `patricia.alarcon.9@…` (junta del Block 1), `javier.castro@…`
  (propietario) y `ana.huaman.38@…` (con un voucher en revisión, para «Ver mi voucher»). La captura de «Ampliar» no se publica: los
  comprobantes del seed son PNG de ~300 bytes, no se lee nada.
- Versiones publicadas:
  - 30-oct-2026, recurso `cmvuwrn5z000yzt7dybudh1r1` (reemplazado).
  - 30-oct-2026 (2), recurso `cmvv9urmi000bf5xdkb42hpwt` (vigente): 36 secciones; agrega «Crea tu cuenta» y «Planes y precios»,
    «Notificaciones», la validación con OCR primero, «Ver mi voucher» y «Ampliar», y el cargo de la junta en el menú.
- Nota: hubo una publicación intermedia el mismo día (`cmvv9nbz10004f5xdk0dejkks`) con «tú misma» y dos textos que nombraban sólo a la IA; la vigente es `cmvv9urmi000bf5xdkb42hpwt`.
