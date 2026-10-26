# Reorganización de House: ficha por entidad, torres configurables y menú por objeto de trabajo

Fecha: 2026-10-25 · Repo: `house` · Alcance: frontend + backend en una sola entrega.

## 1. Contexto

El menú de House está ordenado por *tipo de CRUD*, no por *objeto de trabajo*: mezcla la plataforma interna del superadmin con la operación del cliente, y deja las personas (residentes, personal, proveedores) sueltas en un grupo aparte aunque sus alcances ya están en los datos (`Usuario.empresa_id`, `Usuario.complejo_id`, `Unidad.estructura_id`).

Además hay un **hueco funcional**: la torre (block) de una unidad existe en el modelo y en la API, pero la aplicación no la deja ver ni asignar, y **no hay ninguna pantalla para dar de alta las torres**: las Torres 1–8 de producción salieron del seed (`prisma/seed.ts:274`). `/api/estructuras` es CRUD completo pero sólo se lee (`src/pages/admin/Morosidad.tsx:26`, `src/pages/admin/_parts/personas/PersonasLista.tsx:94`).

Hallazgos verificados (con archivo y línea):

| Hecho | Dónde |
|---|---|
| `Estructura` = torre/bloque; `Unidad.estructura_id` y `Unidad.piso_id` | `prisma/schema.prisma:151`, `:176` |
| `POST/PUT /api/unidades` ya validan `estructura_id` y `piso_id` | `src/server/routes/unidades.ts:10-11, 26-27` |
| La lista de unidades **no** trae `estructura` en su `include` → no hay columna ni filtro | `src/server/routes/unidades.ts:43-47` |
| El modal de unidad no tiene campo de torre/piso | `src/pages/admin/Unidades.tsx:151-172` |
| `/api/estructuras` es CRUD (alta/baja/edición) pero no hay pantalla que lo use | `src/server/routes/estructuras.ts` |
| El API de usuarios ya filtra por `empresa_id`, `complejo_id` y `estructura_id` | `src/server/routes/usuarios.ts:142-150` |
| El API de recibos ya filtra por `complejo_id` | `src/server/routes/recibos.ts:85-93` |
| El API de complejos **no** tiene filtros (falta `empresa_id`) | `src/server/routes/complejos.ts:20-67` |
| Ya hay un componente `Tabs` con navegación por teclado (WAI-ARIA) | `src/ui/Misc.tsx:32`, `src/ui/a11y.ts` |
| El vocabulario está mezclado: la UI dice «block», los datos dicen «Torre» | `src/pages/admin/MediosPago.tsx:93`, `prisma/seed.ts:274` |

## 2. Decisiones tomadas con Miguel

1. **Todo en una sola entrega**: torre + menú + drill-down, un solo cambio y un solo deploy.
2. **El drill-down vive en pestañas dentro de la página** de la entidad (no desplegable en el menú lateral ni modal sobre la lista).
3. **Plataforma al final** del menú.

## 3. Diseño

### 3.1 Menú nuevo

Se mantiene la idea de grupos, pero cada grupo es un *objeto de trabajo* y la plataforma baja al final.

**admin**

| Orden | Grupo | Ítems |
|---|---|---|
| 1 | — | Resumen |
| 2 | — | Condominios *(abre la ficha con Torres · Unidades · Residentes · Recibos)* |
| 3 | Cobranza | Recibos · Pagos · Medios de pago · Morosidad |
| 4 | Operación | Unidades · Mantenimiento · Conceptos · Avisos · WhatsApp |
| 5 | Personas | Residentes · Personal · Proveedores |
| 6 | Cuenta | Mi empresa |

**superadmin**

| Orden | Grupo | Ítems |
|---|---|---|
| 1 | — | Resumen |
| 2 | — | Empresas *(abre la ficha con Personal · Condominios)* |
| 3 | — | Condominios *(abre la ficha)* |
| 4 | Cobranza | Recibos · Pagos · Medios de pago · Morosidad |
| 5 | Operación | Unidades · Mantenimiento · Conceptos · Avisos · WhatsApp |
| 6 | Personas | Residentes · Personal · Proveedores |
| 7 | **Plataforma** | Usuarios del sistema · Auditoría · Llavero de IA |

Las pantallas de personas **no desaparecen** del menú: siguen siendo la vista transversal («todos los residentes de todos mis condominios»); el drill-down es el camino principal, no el único.

### 3.2 Ficha de Condominio

Ruta nueva: `/admin/condominios/:id` (superadmin y admin). La lista de Condominios queda y cada fila gana una acción **«Ver ficha»**.

Encabezado: nombre, tipo, dirección, «Administrado por» (empresa), contadores (unidades, torres) y acciones (Editar, Eliminar, Contratos). Detrás: enlace «← Condominios».

Pestañas (la pestaña viva va en `?vista=` para que el enlace se pueda compartir y sobreviva al F5):

| Pestaña | Contenido | Datos |
|---|---|---|
| Datos | ficha del condominio + contrato vigente | `GET /api/complejos/:id`, `GET /api/complejos/:id/contratos` |
| Torres | alta/edición/baja de torres y sus pisos | `GET/POST/PUT/DELETE /api/estructuras?complejo_id=` |
| Unidades | tabla de unidades **de este condominio**, con torre editable | `GET /api/unidades?complejo_id=` |
| Residentes | residentes con unidades en este condominio | `GET /api/usuarios?tipo=residente&complejo_id=` |
| Recibos | recibos de este condominio | `GET /api/recibos?complejo_id=` |

### 3.3 Ficha de Empresa

Ruta nueva: `/superadmin/empresas/:id`. Pestañas: **Datos** (ficha + estado), **Personal** (`GET /api/usuarios?tipo=personal&empresa_id=`), **Condominios** (`GET /api/complejos?empresa_id=`).

El admin (que no ve la pantalla de Empresas) tiene su equivalente en «Mi empresa» (`/admin/configuracion`), que gana la pestaña **Personal** con el mismo componente.

### 3.4 Torres: el hueco que se cierra

Nueva pestaña **Torres** del condominio, con su propia tabla:

- Alta: nombre, tipo (`Torre` / `Block` / `Etapa`) y **cantidad de pisos** (opcional, 0–60). El servidor crea la estructura y sus pisos en una transacción.
- Edición: nombre, tipo y cantidad de pisos (agregar pisos sólo; no se borran los que ya tienen unidades).
- Baja: **bloqueada si la torre tiene unidades o usuarios de junta asignados**; el mensaje dice cuántos hay y que hay que reasignarlos primero. Si no tiene ni unidades ni junta, se borran sus pisos y la torre.
- La tabla muestra nombre, tipo, nº de pisos, nº de unidades y estado.

**Las torres son planas, y queda dicho.** La jerarquía `Estructura.padre_id` (Etapa → Torre) existe en el esquema pero **no se usa en ninguna parte** y `docs/SEGURIDAD.md:118` ya fijó la regla: «block» es `Estructura` por igualdad directa con `Unidad.estructura_id`, no se recorren blocks anidados. Todo el motor depende de esa regla: el ámbito de la junta (`src/server/lib/junta.ts:35-37`), el resumen de recibos por torre (`src/server/lib/mantenimientos.ts:242-252`) y la importación del Excel de mantenimiento (`src/server/routes/recibos.ts:417-425`) agrupan por igualdad directa. Si la UI dejara crear una jerarquía, esas tres piezas mentirían.

Por eso la frontera queda **explícita**, no suelta: la UI no ofrece «torre padre» y `POST/PUT /api/estructuras` **rechaza `padre_id`** con un mensaje claro («House trabaja con torres planas»). Así nadie puede crear por API una torre anidada que la aplicación no sabría representar. La columna se conserva en el esquema para el día que exista un caso real, que vendría con su propio diseño (ámbito, agrupación y Excel).

### 3.5 Unidades: la torre de punta a punta

- **Lista**: columna «Torre» (con `estructura.nombre`), filtro «Filtrar por torre» que depende del condominio elegido, y el filtro «Torre» se manda como `estructura_id`.
- **Modal**: select «Torre» (torres del condominio elegido) y select «Piso» (pisos de la torre elegida). Al cambiar el condominio se limpian torre y piso; al cambiar la torre se limpian los pisos.
- La torre también se puede dejar vacía (una unidad sin torre es válida: `estructura_id` es opcional).
- El API devuelve `estructura: {id, nombre}` y acepta el filtro `estructura_id`.
- **Carga de unidades ya existentes**: acción en la pestaña Torres, «Asignar torre a las unidades sin torre», que asigna a una torre elegida **todas las unidades del condominio con `estructura_id` nulo** y dice cuántas movió. Cierra el hueco de las unidades cargadas antes de que existiera esta pantalla (quedan fuera de las fichas de torre hasta que se asignen). Mover unidades de una torre a otra en lote no se incluye: renombrar una torre ya actualiza todo, y el resto se edita unidad por unidad.

### 3.6 La junta directiva por torre ya existe: no se duplica

El cargo de presidente/tesorero con su torre se asigna hoy en la ficha de personas (`src/pages/admin/_parts/personas/PersonasLista.tsx:315-322`: «Cargo en la junta» + «Block de la junta», alimentado por `/api/estructuras?complejo_id=`). No hace falta una pantalla nueva: se **renombra** el rótulo a «Torre de la junta» y el texto de ayuda, y se deja claro que **sin torre la junta alcanza todo el condominio** (`filtroAmbito`, `src/server/lib/junta.ts:35-37`).

Ahí aparece el único «suelto» real de esta lista, y por eso la guarda de borrado de una torre incluye a los usuarios de junta: si la torre de un presidente se borrara, su `estructura_id` quedaría nulo y su alcance se ampliaría **en silencio** a todo el condominio. Borrar la torre queda bloqueado y hay que reasignar el cargo primero.

### 3.6 Vocabulario

La UI habla de **torre** y no de block: «Filtrar por torre», «Todas las torres», «Torre 1». Se renombra el helper `nombreBlock` → `nombreTorre` (`src/pages/admin/_parts/medios/tipos.ts`). El modelo sigue siendo `Estructura` y la columna `estructura_id`: no se toca el esquema.

## 4. Cambios de API

| Endpoint | Cambio |
|---|---|
| `GET /api/unidades` | `include.estructura = {id, nombre}`; nuevo filtro `estructura_id` |
| `POST/PUT /api/unidades` | sin cambios (ya acepta `estructura_id`/`piso_id`) |
| `POST /api/estructuras` | acepta `cantidad_pisos` (0–60, opcional) y crea la torre con sus pisos en una transacción; rechaza `padre_id` («House trabaja con torres planas») |
| `DELETE /api/estructuras/:id` | 422 si la torre tiene unidades **o** usuarios de junta; si no, borra la torre y sus pisos |
| `POST /api/estructuras/:id/asignar-unidades` | asigna a la torre las unidades del condominio sin torre; devuelve cuántas movió |
| `GET /api/complejos` | nuevo filtro `empresa_id` |

Todo con zod (`parseBody`/`parseQuery`), en español, y respecting el alcance del tenant (`scopeComplejos`, `scopeEstructuras`, `scopeUnidades`): un admin de otra empresa recibe **404**, no 403.

**No hay migración**: el esquema ya tiene `Estructura`, `Piso` y `Unidad.estructura_id`/`piso_id`.

## 5. Archivos

**Backend**
- `src/server/routes/unidades.ts` — include + filtro.
- `src/server/routes/complejos.ts` — filtro `empresa_id`.
- `src/server/routes/estructuras.ts` — `cantidad_pisos`, borrado protegido.

**Frontend**
- `src/app/nav.ts` — menú nuevo.
- `src/App.tsx` — rutas `/admin/condominios/:id` y `/superadmin/empresas/:id`.
- `src/pages/admin/CondominioDetalle.tsx` (nuevo) — ficha con pestañas.
- `src/pages/superadmin/EmpresaDetalle.tsx` (nuevo) — ficha con pestañas.
- `src/pages/admin/_parts/condominio/TorresDelCondominio.tsx` (nuevo) — CRUD de torres.
- `src/pages/admin/_parts/unidades/ListaDeUnidades.tsx` (nuevo) — la tabla de unidades extraída, reutilizable con condominio fijo.
- `src/pages/admin/Unidades.tsx` — pasa a usar `ListaDeUnidades`.
- `src/pages/admin/_parts/personas/PersonasLista.tsx` — props `complejoId` / `empresaId` para fijar el filtro.
- `src/pages/admin/Recibos.tsx` — prop `complejoId` para fijar el filtro (reutilizado en la pestaña).
- `src/pages/superadmin/Empresas.tsx`, `src/pages/admin/Complejos.tsx` — acción «Ver ficha».
- `src/pages/admin/MediosPago.tsx`, `Morosidad.tsx`, `_parts/medios/tipos.ts` — «block» → «torre».

## 6. Pruebas

- **Backend** (`tests/unidades-torres.test.ts`): la lista trae `estructura`; el filtro `estructura_id` acota; crear torre con `cantidad_pisos` crea los pisos; `POST` con `padre_id` lo rechaza; borrar una torre con unidades devuelve 422; borrar una torre con presidente de junta devuelve 422 (y no amplía su ámbito); borrar una torre vacía borra sus pisos; «asignar torre a las unidades sin torre» mueve sólo las que no tienen torre y devuelve el conteo; `GET /api/complejos?empresa_id=` acota; un admin de otra empresa recibe 404.
- **Frontend** (tests de fuente, el repo no tiene testing-library): la ficha tiene pestañas con `aria-selected` y la pestaña viva en `?vista=`; la tabla de unidades tiene columna y filtro de torre; el modal manda `estructura_id`/`piso_id` y limpia la torre al cambiar de condominio; la pestaña Torres ofrece el alta con pisos y la acción de asignar las unidades sin torre; el menú tiene Plataforma al final y los grupos Cobranza/Operación en el orden pactado; el rótulo dice «torre» y no «block» en medios de pago, morosidad y junta.
- **Mutación**: `useState(false)` de la torre, `hidden={!abierto}`, el `include` de `estructura`, el `422` del borrado, el rechazo de `padre_id` y el orden del menú se comprueban rompiendo el código a propósito.

## 7. Riesgos y gotchas

- **El deploy mueve backend y frontend a la vez**: es una app con los dos; el build del VPS tarda 6–10 min y la RAM no da para dos builds (no pushear otra cosa mientras tanto).
- **Torres existentes sin unidades**: el seed las dejó así; la nueva pestaña las lista tal cual, sin migrar nada.
- **Unidades con `estructura_id` NULL**: siguen siendo válidas; el filtro por torre no las esconde y la acción «asignar torre a las unidades sin torre» las recoge.
- **Borrar una torre con junta asignada ampliaría el alcance en silencio** (`filtroAmbito`): por eso el borrado se bloquea también por usuarios de junta.
- **Torres planas**: `padre_id` se rechaza en la API; el motor (ámbito de junta, resumen por torre, Excel) agrupa por igualdad directa y `docs/SEGURIDAD.md:118` ya lo dice. Nadie puede crear datos que la app no represente.
- **`scopeUsuarios`**: el Personal de la ficha de Empresa lo ve el superadmin; el admin ve su propia empresa por el alcance.

## 8. Lo que queda fuera, y por qué no queda suelto

| Fuera | Por qué no deja nada suelto |
|---|---|
| Anidar torres (Etapa → Torre) | Frontera explícita: la UI no lo ofrece y la API rechaza `padre_id`. El motor entero agrupa por torre directa y ya está documentado en `SEGURIDAD.md:118`. |
| Mover unidades de una torre a otra en lote | Renombrar una torre ya actualiza todo; el resto se edita unidad por unidad. Lo que sí faltaba (unidades cargadas sin torre) tiene su acción acotada. |
| Pantalla nueva de junta directiva | Ya existe en la ficha de personas; sólo se unifica el vocabulario con «torre». |
| Rediseño visual del resto de pantallas | Sólo cambia el orden del menú; las pantallas nuevas siguen el kit actual. |
