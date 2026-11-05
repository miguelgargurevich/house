# Videos regrabados el 4-nov-2026

**Motivo**: los videos mostraban «Gestión Urbana SAC» y correos @gestionurbana.com, un dominio real de terceros. La empresa de prueba ahora es «Administradora Demo SAC» con correos `.example` (commit 9293fbf). Se regraban con el mismo guion y la **misma voz** que ya existía (no se generó ninguna voz nueva).

**Cómo se verificó**: OCR con `tesseract -l spa` a 1 cuadro por segundo (`ffmpeg -vf fps=1`), buscando `gesti.n urbana|gestionurbana|melina|loayza|gmail|gargurevich|\.com\b` y `@`. Los cuadros a ojo son de la hoja de revisión (`.claude/videos/<v>/hoja/hoja.jpg`) y de tiras de cuadros sacadas a mano.

## Regrabados (mp4 en `.claude/videos/<video>/`, mismo nombre de archivo)

### Primera tanda (Haiku, commit add77c4)

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
| `m-admin-unidades/torre-m-admin-unidades-escritorio.mp4` | 15,9 s → 15,9 s | 16 cuadros, sin hallazgos | Sí |

### Segunda tanda (Claude Code, Haiku 5.5, con OK de Opus del 4-nov 19:00)

| Archivo | Duración vieja → nueva | OCR | Revisión a ojo |
|---|---|---|---|
| `v5/torre-v5-escritorio.mp4` | 61,3 s → 61,3 s | 61 cuadros. Sólo `torrecondominios.com` (cierre) | Sí: hoja (recibos con «Administradora Demo SAC», morosidad, rendición) y cuadros de WhatsApp: grupos de prueba, «Falta: Block 14», aviso de recibo |
| `v5/torre-v5-celular.mp4` | 61,3 s → 61,3 s | 61 cuadros. Sólo `torrecondominios.com` (cierre) | Sí: hoja. El modal «Subir Excel» desborda por la derecha en celular: es el problema ya anotado de la pantalla, no del video |
| `v7/torre-v7-escritorio.mp4` | 63,0 s → 63,0 s (según el guion; el mp4 anterior se sobrescribió y no se volvió a medir) | 63 cuadros. Sólo `torrecondominios.com` (cierre) | Sí: hoja (login, resumen, vista previa de contactos sin guardar) |
| `v7/torre-v7-celular.mp4` | 63,0 s → 63,0 s (igual) | 63 cuadros. Sólo `torrecondominios.com` (cierre) | Sí: escena 5 (WhatsApp) con «Block 14» asignado en la base (ver abajo); escena 4 con «Listo: 53 grupos» |
| `m-admin-recibos/torre-m-admin-recibos-escritorio.mp4` | 28,4 s → 28,4 s | 28 cuadros. Sólo `torrecondominios.com` (texto del aviso). El aviso dice «el aviso va al grupo de WhatsApp de Block 1»; ya no aparece «no tiene grupo» | Sí: hoja. Coincide con la voz |

## Notas de la segunda tanda

- **v5 y m-admin-recibos** necesitaban WhatsApp con grupos: se preparó en LOCAL con el Evolution falso (puerto 18089), `whatsapp_instance='local_6'` en la empresa 6 y `--preparar` (13 de 14 blocks con grupo; el Block 14 queda sin grupo a propósito).
- **v7 escritorio y celular** asignan el grupo del Block 14 en la escena 5 (y el escritorio también en la 4, que los cuadros de la app muestran). Cada grabación parte de «sin asignar», así que antes de regrabar celular se devolvió ese grupo a «sin asignar» en la base y después la escena lo asignó de nuevo. Lo de la base se borra al cerrar (ver HANDOFF).
- **v7, escena 2, escritorio**: la acción «Instalar Torre» expiró (8 s) porque ese aviso sólo sale en pantallas chicas. La escena se grabó igual, sin el aviso (límite ya documentado).
- **v7, escena 5, celular**: la primera pasada expiró al buscar el selector del Block 14 porque ya estaba asignado (ver arriba). La pasada buena asigna el Block 14 (verificado en la base: el grupo «Vecinos Block 14 · Libertadores» queda con `estructura_id` de «Block 14»).
- **Botón «Guardar» de la asignación de grupos** (v7, escena 5): el guion lo pulsa en la base LOCAL para asignar el grupo. No sale nada hacia afuera (los envíos siguen apagados y el Evolution es el falso).
- La lista de grupos de prueba (53) y la empresa 6 se restauran al cerrar la sesión.

## Cómo se verificó

Los OCR se hicieron con el comando de arriba. Los datos reales que buscamos (Melina, Loayza, gmail, Gargurevich, correos de dominios reales) no aparecen en ninguno de los 5 mp4.
