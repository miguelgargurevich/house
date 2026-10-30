# Sistema de diseño de House

Superficie: **Operate** (aplicación). Familiaridad antes que sorpresa; la marca vive en los detalles.

## Principios
- Un solo vocabulario para los 8 roles: mismos componentes (`src/ui`), mismo shell (`src/app/Shell.tsx`).
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
- Lista: `PageHeader` (acción primaria a la derecha) → `Card` con `Toolbar` + `DataTable`. Crear/editar en `Modal`; borrar con `ConfirmDialog`. Ver `src/pages/admin/_parts/personas/PersonasLista.tsx` (residentes, personal y superadmin) y `src/pages/admin/Proveedores.tsx`.
- Resumen: `PageHeader` → `StatStrip` → `Card`s con gráfico/estados. Ver `src/pages/admin/Dashboard.tsx`.
- Datos: `useList` (listas paginadas) y `useResource` (uno) de `src/api.ts`; mutaciones con `api()` + `toast`.
- Estados obligatorios en cada pantalla: cargando (skeleton), vacío (`EmptyState` que enseña qué hacer), error (`ErrorState` con reintentar).
- Copy en español de Perú, tuteo, botones con verbo ("Emitir recibo", no "Aceptar").
- Panel lateral inline (asistente, `src/app/Assistant.tsx`): en >= lg es una COLUMNA del layout a la derecha (el contenido se reduce; sin sombra ni velo; `border-l border-line`), 24 rem por defecto, redimensionable por el borde (20–40 rem, teclado ← →), abre/cierra animando el ancho (200 ms; se anula con `prefers-reduced-motion`), `role="complementary"` e `inert` cerrado. En < lg es una vista a pantalla completa con «Volver». Cabecera de 44 px esmerilada (`bg-surface/70 backdrop-blur-md`), hilo que sube por detrás con `mask-image` (desvanece 1 rem), pie SÓLIDO sin blur. Objetivos táctiles de 44 px. Úsalo como molde si otra pantalla necesita un panel acoplado; no uses overlay para algo que convive con la página.
- Barra lateral compacta (`src/app/Shell.tsx`, lógica en `src/app/barra.ts` y `useBarra.ts`): en >= lg la marca «House» de la cabecera ES el botón que alterna entre barra de 256 px y riel de iconos de 64 px (`aria-expanded`, `aria-label` «Colapsar menú» / «Expandir menú»; atajo `[` o Ctrl/Cmd+B, nunca dentro de campos de texto). En el riel: sólo iconos centrados, secciones separadas por una línea fina, pie con sólo avatar y «Cerrar sesión» como icono; el nombre sale en un tooltip (`src/app/Pista.tsx`, `fixed`, con mouse y con foco de teclado) y en `aria-label`. El ancho vive en la variable CSS `--barra` (la fuente única es `anchoBarra()`): el contenido (`lg:pl-[var(--barra)]`), el aside y el asistente acoplado (`acotarAncho(px, viewport, barra)`) la leen, así no hay saltos. La transición de 180 ms se enciende tras el primer render (`animar`) y se anula con `prefers-reduced-motion`. Estado global en `localStorage` (`house:menu:colapsado`, con try/catch). En < lg el cajón siempre lleva textos. Úsalo como molde para otras barras colapsables.

## Patrón: selector de condominio (barra superior)
- **Un solo selector arriba** (`src/app/SelectorCondominio.tsx`, estado en `src/app/condominio.ts` y `CondominioProvider.tsx`, montado por `Shell.tsx`) para TODAS las pantallas de administración. Ninguna pantalla trae su propio filtro de condominio: leen `useCondominio().complejo` (id como texto, `''` = «Todos los condominios») y lo mandan como `complejo_id`.
- **Quién y dónde:** sólo admin y superadmin. Aparece en las pantallas que se filtran por condominio (`rutaUsaCondominio`: Resumen, Recibos, Pagos, Medios de pago, Morosidad, Unidades, Mantenimiento, Comunicados y Envíos, Juntas, Residentes, Personal, Proveedores). No en Conceptos (son de toda la empresa, no tienen condominio), ni en las fichas, «Mi empresa», «Mi plan», un recibo abierto, la junta, los residentes ni el personal; fuera de esas rutas el filtro vale «Todos».
- **Opciones:** «Todos los condominios» y cada condominio de su alcance. Con UN condominio no hay desplegable: su nombre queda fijo (`<p>` con el nombre y «Condominio:» para el lector de pantalla). El superadmin ve los condominios agrupados por empresa (`<optgroup>`). El alcance lo da `GET /api/complejos/selector` (siempre acotado por `scopeComplejos`).
- **Se recuerda** por usuario en `localStorage` (`house.condominio.<id>`, siempre en `try/catch`); si lo guardado ya no está en su alcance vuelve a «Todos» (o al único). El estado vive con la sesión (`key` = usuario): no hereda lo de otro.
- **Posición:** en escritorio (>= lg) a la izquierda de la barra; en el celular no cabe junto a menú, tema, asistente y cuenta, así que baja a su propia fila bajo la barra (todo dentro del mismo contenedor `sticky`). Alto 36 px, texto truncado, `label` propio (`sr-only`) y teclado nativo (`<select>`).
- **Blocks:** dependen del condominio. El filtro de block (`SelectoresUbicacion` y los de Unidades, Personas, Medios, Comunicados) sólo lista los del condominio elegido; con «Todos» (y más de un condominio) se OCULTA: «Block 1» de un condominio y de otro nunca se mezclan. Cambiar de condominio descarta el block en el mismo render (`useTorreElegida`).
- **Crear** (recibo, Excel, unidad, residente, personal, proveedor, comunicado, medio de pago, tarea) toma por defecto el condominio elegido. Lo que es de UN condominio (emitir recibo, subir Excel) y no tiene uno elegido pide elegirlo con un aviso («Un recibo es de un solo condominio: elige para cuál lo emites») en vez de fallar.
- Un condominio creado, editado o borrado llama a `recargar()` para que el selector lo muestre sin recargar la página.

## Patrones del mantenimiento (recibo por departamento)
- **Nombres:** el vecino ve «Mantenimiento de octubre de 2026 · B01-804»; los conceptos son sólo el desglose; los pagos son del mantenimiento («Pagar mantenimiento», «Ver / imprimir recibo»). El estado `parcial` se muestra como «Pago parcial».
- **Periodo agrupado por block** (`PeriodoRecibo`, `BloquesPeriodo`): una fila por block con avance (`ProgresoCobro`) y chip de morosos; se expande (`aria-expanded`) a la lista paginada de departamentos. Con filtros (búsqueda/estado/block) o con un solo block la lista es plana.
- **Dos diálogos seguidos** (detalle → recibo imprimible/pago): se muestra uno a la vez y el `onClose` del primero se ignora mientras se cambia (el `<dialog>` nativo dispara `close` al ocultarse).
- **Botones de pie que cambian de función** (`Ya pagué` → `Confirmar pago`) llevan `key` distinta: si React reutiliza el nodo y le cambia el `type` a `submit` durante el clic, el formulario se envía solo.
- **Tablas de pagos** a 1280 px sin scroll: una fila por pago del mantenimiento; lo secundario se oculta con `hideBelow`.
- **Impresión:** `#recibo-imprimible` con `@media print` que oculta el resto de la página; sin dependencias.

## Patrones de Personas (residente / personal / proveedores)
- Tres pantallas bajo `/admin/residentes`, `/admin/personal`, `/admin/proveedores`, todas reusando `PersonasLista` con un `tipo` distinto; no se mezclan: cada pantalla pide su `tipo` y la API filtra en el servidor (404 a otro tenant).
- **Residentes**: columnas nombre+correo, rol, condominio · block · departamento(s) (varias unidades → «B01-804 +1»), cargo de junta, teléfono; filtros por condominio, block y estado (moroso/al día); sin columna de empresa. Crear exige condominio y unidad (propietario o inquilino de esa unidad, libre).
- **Personal**: columnas nombre, rol, condominio(s) donde trabaja, teléfono; empresa no se muestra al admin (es la suya); el superadmin la ve y la elige. Roles: admin, seguridad, mantenimiento, limpieza, jardinería.
- **Proveedores**: directorio con rubro, contacto, condominios que atiende, activo; crear/editar/desactivar; el superadmin elige la empresa. En Mantenimiento, asignar a «Personal» o «Proveedor» (no ambos).
- **Condominios**: «Administrado por …» con el contrato vigente (desde), botón «Cambiar de administradora» (solo superadmin) y el historial de contratos (`ContratosModal`).
