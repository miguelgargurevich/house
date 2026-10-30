# Manual de usuario de House

`manual-house.json` es el contenido EXACTO con el que se publica el manual «Cómo usar House, según tu rol» (My Workspace, herramienta
`web_crear` con `diseno: "manual"`): título, kicker, subtítulo, meta y las secciones. Para actualizarlo, se edita este archivo y se vuelve a
publicar pasando su contenido a `web_crear` (crea un recurso NUEVO: anota en `docs/HANDOFF.md` cuál reemplaza).

- Capturas: `node scripts/marketing/capturas-manual.mjs [nombre…]` → `.claude/manual/capturas/` (seed local, nunca datos reales), y se
  suben a `https://sitios.gargurevich.dev/manual-house-capturas/` con `scp … gds-vps:/opt/stack/sitios/manual-house-capturas/`.
- Versiones publicadas: 30-oct-2026, recurso `cmvuwrn5z000yzt7dybudh1r1`.
