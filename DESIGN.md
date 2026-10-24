# Sistema de diseño de House

Superficie: **Operate** (aplicación). Familiaridad antes que sorpresa; la marca vive en los detalles.

## Principios
- Un solo vocabulario para los 6 roles: mismos componentes (`src/ui`), mismo shell (`src/app/Shell.tsx`).
- El dinero manda: montos con `soles()` y cifras tabulares (`.num`), estados siempre con `StatusBadge` (color + palabra).
- Móvil real para residentes: tablas con `hideBelow`, formularios en una columna bajo `sm`, objetivos táctiles ≥ 40 px.
- Sin decoración sin función: nada de gradientes, brillos ni tarjetas anidadas. Un solo momento de movimiento por pantalla (150–250 ms).

## Tokens (`src/index.css`, OKLCH, claro y oscuro)
Neutros verde-pizarra: `bg`, `surface`, `surface2`, `line`, `ink`, `muted`. Acento verde azulado: `brand`, `brand-hover`, `brand-soft`, `on-brand`. Semánticos con par suave: `ok`, `warn`, `bad`, `info` (+ `-soft`). Solo estos nombres en clases Tailwind (`bg-surface`, `text-muted`, `border-line`…). **Prohibido** `gray-*`, `slate-*`, `blue-*`, hex o `dark:` suelto: el modo oscuro sale de los tokens.

## Tipografía
Figtree Variable, una sola familia. Escala fija: xs 12 / sm 14 (UI y tablas) / base 16 / lg 18 / xl 20 / 2xl 24 (título de página) / 3xl 30. Pesos 400, 500, 600.

## Componentes (`import { … } from '../../ui'`)
`Button` (primary | secondary | ghost | danger, `loading`, `icon`), `IconButton` (siempre con `label`), `Card/CardHeader/CardBody`, `PageHeader`, `StatStrip`, `DataTable` (paginación servidor, skeleton, vacío, error), `Toolbar`, `SearchBox`, `Input/Select/Textarea` (etiqueta + error + hint integrados), `Modal`, `ConfirmDialog`, `Badge/StatusBadge`, `Avatar`, `Tabs`, `DefinitionList`, `EmptyState`, `ErrorState`, `Alert`, `Skeleton`, `BarChart`, `ProgressBar`, `useToast`, `soles`, `fechaCorta`, `periodo`.
Iconos: solo `@heroicons/react/24/outline` (trazo 1.5), `h-4 w-4` en botones/tablas, `h-5 w-5` en navegación.

Accesibilidad del kit (detalle y pendientes en `docs/ACCESIBILIDAD.md`): para etiquetas de toolbars y filtros usa `ocultarEtiqueta` (nunca `[&_label]:sr-only`); `Tabs` con `idBase` + `TabPanel` cuando haya paneles; `DataTable` con `onRowClick` ya es operable por teclado.

## Patrones de pantalla
- Lista: `PageHeader` (acción primaria a la derecha) → `Card` con `Toolbar` + `DataTable`. Crear/editar en `Modal`; borrar con `ConfirmDialog`. Ver `src/pages/admin/Usuarios.tsx`.
- Resumen: `PageHeader` → `StatStrip` → `Card`s con gráfico/estados. Ver `src/pages/admin/Dashboard.tsx`.
- Datos: `useList` (listas paginadas) y `useResource` (uno) de `src/api.ts`; mutaciones con `api()` + `toast`.
- Estados obligatorios en cada pantalla: cargando (skeleton), vacío (`EmptyState` que enseña qué hacer), error (`ErrorState` con reintentar).
- Copy en español de Perú, tuteo, botones con verbo ("Emitir recibo", no "Aceptar").
- Panel lateral inline (asistente, `src/app/Assistant.tsx`): en >= lg es una COLUMNA del layout a la derecha (el contenido se reduce; sin sombra ni velo; `border-l border-line`), 24 rem por defecto, redimensionable por el borde (20–40 rem, teclado ← →), abre/cierra animando el ancho (200 ms; se anula con `prefers-reduced-motion`), `role="complementary"` e `inert` cerrado. En < lg es una vista a pantalla completa con «Volver». Cabecera de 44 px esmerilada (`bg-surface/70 backdrop-blur-md`), hilo que sube por detrás con `mask-image` (desvanece 1 rem), pie SÓLIDO sin blur. Objetivos táctiles de 44 px. Úsalo como molde si otra pantalla necesita un panel acoplado; no uses overlay para algo que convive con la página.
- Barra lateral compacta (`src/app/Shell.tsx`, lógica en `src/app/barra.ts` y `useBarra.ts`): en >= lg la marca «House» de la cabecera ES el botón que alterna entre barra de 256 px y riel de iconos de 64 px (`aria-expanded`, `aria-label` «Colapsar menú» / «Expandir menú»; atajo `[` o Ctrl/Cmd+B, nunca dentro de campos de texto). En el riel: sólo iconos centrados, secciones separadas por una línea fina, pie con sólo avatar y «Cerrar sesión» como icono; el nombre sale en un tooltip (`src/app/Pista.tsx`, `fixed`, con mouse y con foco de teclado) y en `aria-label`. El ancho vive en la variable CSS `--barra` (la fuente única es `anchoBarra()`): el contenido (`lg:pl-[var(--barra)]`), el aside y el asistente acoplado (`acotarAncho(px, viewport, barra)`) la leen, así no hay saltos. La transición de 180 ms se enciende tras el primer render (`animar`) y se anula con `prefers-reduced-motion`. Estado global en `localStorage` (`house:menu:colapsado`, con try/catch). En < lg el cajón siempre lleva textos. Úsalo como molde para otras barras colapsables.
