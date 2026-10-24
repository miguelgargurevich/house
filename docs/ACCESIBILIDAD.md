# Accesibilidad del kit de UI

Alcance: `src/ui/*` y los tokens de `src/index.css`. Objetivo: WCAG 2.1 AA donde se puede comprobar sin navegador. Las pantallas (`src/pages/**`) **no** se tocaron: migrarlas al kit nuevo es trabajo aparte.

## Qué se corrigió (todo compatible hacia atrás: props nuevas opcionales)

| Componente | Cambio |
|---|---|
| `IconButton` | Objetivo táctil de 40 px (`h-10 w-10`) con margen negativo `-m-0.5`: ocupa 36 px en el diseño, así las filas de `DataTable` y la paginación no crecen. (No se usó `relative` + `before:` porque `Shell` le pasa `absolute` y `relative` lo pisaba.) |
| `Tabs` | Patrón WAI-ARIA: `role="tablist"`, cada pestaña con `id`, `aria-selected`, `tabIndex` roving (sólo la activa es tabulable), ← → (circulares), Inicio y Fin mueven el foco **y** activan. Props nuevas: `idBase` (enlaza `aria-controls` con el panel) y `label` (nombre del grupo). Helper `TabPanel` (`role="tabpanel"`, `aria-labelledby`). Sin `idBase` no se emite `aria-controls` (apuntaría a un panel que no existe). |
| `DataTable` | Con `onRowClick`, la fila recibe `tabIndex=0`, foco visible, y Enter/Espacio la activan. Un clic o tecla que viene de un botón, enlace o campo **dentro** de la fila ya no dispara `onRowClick` (antes se duplicaban acciones). La fila conserva su rol nativo `row` (poner `role="button"` en un `<tr>` rompe la tabla para el lector de pantalla). |
| `Field` / `Input` / `Select` / `Textarea` | Prop `ocultarEtiqueta`: la etiqueta queda en el DOM con `sr-only`. El mensaje de error/ayuda es una región `aria-live="polite"` siempre montada (un error que aparece después se anuncia; vacía no ocupa espacio). |
| `SearchBox` | Etiqueta real con `<label for>` (antes sólo `aria-label`); props `label` y `ocultarEtiqueta` (por omisión `true`, igual que se veía antes). |
| `ProgressBar` (nuevo) | `role="progressbar"` con `aria-valuenow/min/max`, `aria-label` obligatorio y `valueText` opcional; tonos con tokens. Exportado en `src/ui/index.ts`. `ProgresoCobro` sigue local; migrarlo queda pendiente. |
| `Modal` | `aria-labelledby` al título (y `aria-describedby` a la descripción). Foco inicial en el primer control del contenido o del pie (en `ConfirmDialog`, «Cancelar»), no en «Cerrar», salvo que un campo traiga `autoFocus`. Al cerrar, el foco vuelve al elemento que abrió el diálogo. |
| `Toast` | Dos regiones vivas siempre montadas: avisos en `role="status"` (`polite`), errores en `role="alert"` (`assertive`). Antes todo iba en `status`. Íconos con `aria-hidden`. |

La lógica pura (teclas de `Tabs`, filtro de eventos de la fila, porcentaje, contraste) vive en `src/ui/a11y.ts` y `scripts/contraste.mjs` y está probada en `tests/accesibilidad.test.ts`.

## Contraste

`node scripts/contraste.mjs` convierte los tokens OKLCH de `src/index.css` a sRGB y calcula la razón WCAG. Sale con código 1 si un par de texto baja de 4.5:1 (y `tests/accesibilidad.test.ts` lo exige en `npm test`). **Resultado: los 32 pares texto/fondo pasan en claro y en oscuro; no hizo falta tocar ningún token.**

| Par (texto / fondo) | Uso | Tema | Razón | ≥ 4.5 |
|---|---|---|---|---|
| ink / surface | texto sobre tarjeta | claro | 16.56:1 | ✔ |
| ink / bg | texto sobre la página | claro | 15.57:1 | ✔ |
| muted / surface | texto secundario sobre tarjeta | claro | 5.93:1 | ✔ |
| muted / bg | texto secundario sobre la página | claro | 5.58:1 | ✔ |
| muted / surface-2 | texto secundario sobre filas/pestañas (hover, ghost) | claro | 5.33:1 | ✔ |
| brand / surface | enlace/acento sobre tarjeta | claro | 5.61:1 | ✔ |
| on-brand / brand | botón primario | claro | 5.46:1 | ✔ |
| on-brand / brand-hover | botón primario (hover) | claro | 7.32:1 | ✔ |
| on-brand / bad | botón de peligro | claro | 5.85:1 | ✔ |
| ok / ok-soft | estado pagado / alerta ok | claro | 4.96:1 | ✔ |
| warn / warn-soft | estado por vencer / alerta | claro | 5.38:1 | ✔ |
| bad / bad-soft | estado vencido / alerta de error | claro | 5.17:1 | ✔ |
| info / info-soft | estado informativo | claro | 5.18:1 | ✔ |
| brand / brand-soft | avatar / insignia de marca | claro | 4.95:1 | ✔ |
| bad / surface | mensaje de error de un campo | claro | 6.01:1 | ✔ |
| ok / surface | ícono/estado ok sobre tarjeta | claro | 5.66:1 | ✔ |
| ink / surface | texto sobre tarjeta | oscuro | 15.11:1 | ✔ |
| ink / bg | texto sobre la página | oscuro | 16.39:1 | ✔ |
| muted / surface | texto secundario sobre tarjeta | oscuro | 7.08:1 | ✔ |
| muted / bg | texto secundario sobre la página | oscuro | 7.68:1 | ✔ |
| muted / surface-2 | texto secundario sobre filas/pestañas (hover, ghost) | oscuro | 6.37:1 | ✔ |
| brand / surface | enlace/acento sobre tarjeta | oscuro | 7.95:1 | ✔ |
| on-brand / brand | botón primario | oscuro | 8.68:1 | ✔ |
| on-brand / brand-hover | botón primario (hover) | oscuro | 10.68:1 | ✔ |
| on-brand / bad | botón de peligro | oscuro | 8.41:1 | ✔ |
| ok / ok-soft | estado pagado / alerta ok | oscuro | 7.03:1 | ✔ |
| warn / warn-soft | estado por vencer / alerta | oscuro | 7.26:1 | ✔ |
| bad / bad-soft | estado vencido / alerta de error | oscuro | 5.96:1 | ✔ |
| info / info-soft | estado informativo | oscuro | 6.84:1 | ✔ |
| brand / brand-soft | avatar / insignia de marca | oscuro | 6.08:1 | ✔ |
| bad / surface | mensaje de error de un campo | oscuro | 7.70:1 | ✔ |
| ok / surface | ícono/estado ok sobre tarjeta | oscuro | 9.18:1 | ✔ |

### Componentes no textuales (WCAG 1.4.11, mínimo 3:1; informativo)

| Par | Uso | Tema | Razón | ≥ 3 |
|---|---|---|---|---|
| ok / surface-2 | relleno de la barra de avance (ok) | claro | 5.08:1 | ✔ |
| brand / surface-2 | relleno de la barra de avance (brand) | claro | 5.04:1 | ✔ |
| warn / surface-2 | relleno de la barra de avance (warn) | claro | 5.52:1 | ✔ |
| bad / surface-2 | relleno de la barra de avance (bad) | claro | 5.40:1 | ✔ |
| info / surface-2 | relleno de la barra de avance (info) | claro | 5.38:1 | ✔ |
| brand / surface | anillo de foco sobre tarjeta | claro | 5.61:1 | ✔ |
| line / surface | borde de campos de formulario | claro | 1.32:1 | ✖ |
| ok / surface-2 | relleno de la barra de avance (ok) | oscuro | 8.26:1 | ✔ |
| brand / surface-2 | relleno de la barra de avance (brand) | oscuro | 7.15:1 | ✔ |
| warn / surface-2 | relleno de la barra de avance (warn) | oscuro | 8.93:1 | ✔ |
| bad / surface-2 | relleno de la barra de avance (bad) | oscuro | 6.92:1 | ✔ |
| info / surface-2 | relleno de la barra de avance (info) | oscuro | 7.88:1 | ✔ |
| brand / surface | anillo de foco sobre tarjeta | oscuro | 7.95:1 | ✔ |
| line / surface | borde de campos de formulario | oscuro | 1.38:1 | ✖ |

**Pendiente conocido:** el borde de los campos de formulario (`line` sobre `surface`) sólo llega a ~1.3:1, por debajo de los 3:1 que pide 1.4.11 para delimitar un control. No se cambió: oscurecer `line` altera todo el aspecto del sistema (tarjetas, tablas, divisores) y es decisión de diseño de Miguel. Mitigación actual: el foco (anillo `brand`, 5.6:1) sí cumple, y los campos tienen etiqueta visible. Opción mínima si se decide corregir: un token `line-strong` sólo para bordes de controles.

## Qué NO se verificó

- **Lector de pantalla real** (VoiceOver, NVDA, TalkBack): los roles, nombres y regiones vivas siguen la especificación, pero no se escuchó el resultado. En particular, que el anuncio del error de un campo y del `Toast` sea el esperado.
- **Navegador**: no hubo navegador en esta sesión. Sin comprobar a ojo: altura real de las filas con `IconButton` de 40 px/`-m-0.5`, el foco visible de la fila, el foco inicial y el retorno del foco del `Modal` (probados sólo por lectura del código), y `TabPanel` con `hidden` en un caso real (hoy ninguna pantalla lo usa).
- Componentes con React (no hay jsdom ni Playwright, a propósito): sólo la lógica pura tiene prueba automática.
- Tamaño táctil de `Button size="sm"` (32 px, `h-8`) y de otros controles de las pantallas: fuera de alcance.
- Los toasts desaparecen solos a los 3.5 s (avisos) y 6 s (errores) sin pausa al pasar el cursor ni al enfocar: puede incumplir 2.2.1 para quien lee despacio. No se cambió.
- Zoom/reflujo al 200–400 %, modo de alto contraste de Windows, `prefers-reduced-motion` (existe la regla global, no se probó).
