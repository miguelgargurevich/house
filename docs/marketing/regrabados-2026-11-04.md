# Videos regrabados el 4-nov-2026

**Motivo**: los videos mostraban «Gestión Urbana SAC» y correos @gestionurbana.com, un dominio real de terceros. La empresa de prueba ahora es «Administradora Demo SAC» con correos `.example` (commit 9293fbf). Se regraban con el mismo guion y la **misma voz** que ya existía (no se generó ninguna voz nueva).

**Cómo se verificó**: OCR con `tesseract -l spa` a 1 cuadro por segundo (`ffmpeg -vf fps=1`), buscando `gesti.n urbana|gestionurbana|melina|loayza|gmail|gargurevich|\.com\b`, más una búsqueda de correos (`@dominio`).

## Regrabados (mp4 en `.claude/videos/<video>/`, mismo nombre de archivo)

| Archivo | Duración vieja → nueva | OCR | Revisión a ojo |
|---|---|---|---|
| `v2/torre-v2-escritorio.mp4` | 67,1 s → 67,1 s | 67 cuadros. Sin nombre viejo ni datos reales. Sólo `torrecondominios.com` (cierre de marca, permitido) | Sí: resumen, recibos, pagos con el modal de revisión |
| `v2/torre-v2-celular.mp4` | 67,2 s → 67,1 s | 67 cuadros. Igual que el escritorio | No (sólo OCR) |
| `v6/torre-v6-escritorio.mp4` | 35,3 s → 35,2 s | 35 cuadros. Sólo `torrecondominios.com` (cierre) | Sí: un cuadro, Mi empresa › Personal |
| `v6/torre-v6-celular.mp4` | 35,3 s → 35,3 s | 35 cuadros. Sólo `torrecondominios.com` (cierre) | No (sólo OCR) |
| `m-admin-cierres/torre-m-admin-cierres-escritorio.mp4` | 21,7 s → 21,8 s | 22 cuadros, sin hallazgos | Sí |
| `m-admin-condominios/torre-m-admin-condominios-escritorio.mp4` | 17,2 s → 17,2 s | 17 cuadros, sin hallazgos | Sí |
| `m-admin-marca/torre-m-admin-marca-escritorio.mp4` | 38,3 s → 38,3 s | 38 cuadros, sin hallazgos | Sí. Al final la marca de la empresa de prueba queda en `null` (verificado en la base) |
| `m-admin-mi-empresa/torre-m-admin-mi-empresa-escritorio.mp4` | 16,2 s → 16,3 s | 16 cuadros, sin hallazgos | Sí |
| `m-admin-recibos/torre-m-admin-recibos-escritorio.mp4` | 28,4 s → 28,4 s | 28 cuadros. Sólo `https://torrecondominios.com` (texto del aviso, permitido) | Sí, **con un problema de contenido (ver abajo)** |
| `m-admin-unidades/torre-m-admin-unidades-escritorio.mp4` | 15,9 s → 15,9 s | 16 cuadros, sin hallazgos | Sí |

Los mp4 viejos de `m-admin-*` y los de v2/v6 están respaldados en `/private/tmp/claude-501/-Users-miguelfernandezgargurevich-Projectos-house--claude-worktrees-manual-videos/5ea1d827-21ab-4d56-8d64-7b0cd2444066/scratchpad/viejos/`.

Ningún correo apareció en ningún OCR. No se detectó «Melina», «Loayza», «gmail» ni «Gargurevich».

## Pendientes (NO regrabados)

| Archivo | Estado | Motivo |
|---|---|---|
| `v5/torre-v5-escritorio.mp4` (61,3 s) | Sin regrabar. El mp4 viejo está en el checkout principal y sigue mostrando «Gestión Urbana» | Las escenas 4 a 6 usan «Mis grupos» y «Traer mis grupos», que necesitan WhatsApp: el Evolution falso (puerto 18089) está apagado, `whatsapp_instance` de la empresa está vacío y `GrupoWhatsapp` tiene 0 filas. Preparar eso cambia datos de la base y reinicia el backend, y el encargo no lo permite sin OK. El xlsx `block-15-noviembre.xlsx` ya se copió al worktree |
| `v5/torre-v5-celular.mp4` (61,3 s) | Sin regrabar | Mismo motivo que el escritorio |
| `m-admin-recibos` (aviso al grupo) | Regrabado, pero **no coincide con la voz** | La escena del aviso muestra «El Block 1 no tiene grupo de WhatsApp» (0 grupos en la base). La voz dice que el aviso va al grupo del block. Hay que regrabarlo cuando haya grupos (mismo motivo que v5) |

## Acción para Opus

- Decidir si se preparan WhatsApp y grupos para regrabar v5 y m-admin-recibos (el método está en `docs/manual/README.md`, sección de WhatsApp).
- Subir a MinIO/My Workspace sólo los mp4 regrabados (no los pendientes).
