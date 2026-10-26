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
- Baja: **bloqueada si la torre tiene unidades**; el mensaje dice cuántas hay y que hay que reasignarlas primero. Si no tiene unidades, se borran sus pisos y la torre.
- La tabla muestra nombre, tipo, nº de pisos, nº de unidades y estado.

Las torres son el nivel superior de la jerarquía (`Estructura.padre_id` permite anidar: Etapa → Torre). **Fuera de alcance**: la UI de anidamiento; la tabla muestra la torre y su padre como texto si lo tuviera.

### 3.5 Unidades: la torre de punta a punta

- **Lista**: columna «Torre» (con `estructura.nombre`), filtro «Filtrar por torre» que depende del condominio elegido, y el filtro «Torre» se manda como `estructura_id`.
- **Modal**: select «Torre» (torres del condominio elegido) y select «Piso» (pisos de la torre elegida). Al cambiar el condominio se limpian torre y piso; al cambiar la torre se limpian los pisos.
- La torre también se puede dejar vacía (una unidad sin torre es válida: `estructura_id` es opcional).
- El API devuelve `estructura: {id, nombre}` y acepta el filtro `estructura_id`.

### 3.6 Vocabulario

La UI habla de **torre** y no de block: «Filtrar por torre», «Todas las torres», «Torre 1». Se renombra el helper `nombreBlock` → `nombreTorre` (`src/pages/admin/_parts/medios/tipos.ts`). El modelo sigue siendo `Estructura` y la columna `estructura_id`: no se toca el esquema.

## 4. Cambios de API

| Endpoint | Cambio |
|---|---|
| `GET /api/unidades` | `include.estructura = {id, nombre}`; nuevo filtro `estructura_id` |
| `POST/PUT /api/unidades` | sin cambios (ya acepta `estructura_id`/`piso_id`) |
| `POST /api/estructuras` | acepta `cantidad_pisos` (0–60, opcional) y crea la torre con sus pisos en una transacción |
| `DELETE /api/estructuras/:id` | 422 si la torre tiene unidades; si no, borra la torre y sus pisos |
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

- **Backend** (`tests/unidades-torres.test.ts`): la lista trae `estructura`; el filtro `estructura_id` acota; crear torre con `cantidad_pisos` crea los pisos; borrar una torre con unidades devuelve 422; borrar una torre vacía borra sus pisos; `GET /api/complejos?empresa_id=` acota; un admin de otra empresa recibe 404.
- **Frontend** (tests de fuente, el repo no tiene testing-library): la ficha tiene pestañas con `aria-selected` y la pestaña viva en `?vista=`; la tabla de unidades tiene columna y filtro de torre; el modal manda `estructura_id`/`piso_id` y limpia la torre al cambiar de condominio; el menú tiene Plataforma al final y los grupos Cobranza/Operación en el orden pactado; el rótulo dice «torre» y no «block».
- **Mutación**: `useState(false)` de la torre, `hidden={!abierto}`, el `include` de `estructura`, el `422` del borrado y el orden del menú se comprueban rompiendo el código a propósito.

## 7. Riesgos y gotchas

- **El deploy mueve backend y frontend a la vez**: es una app con los dos; el build del VPS tarda 6–10 min y la RAM no da para dos builds (no pushear otra cosa mientras tanto).
- **Torres existentes sin unidades**: el seed las dejó así; la nueva pestaña las lista tal cual, sin migrar nada.
- **Unidades con `estructura_id` NULL**: siguen siendo válidas; el filtro por torre no las esconde.
- **`Estructura.padre_id`**: el modelo admite anidamiento; esta entrega no lo gestiona (queda fuera de alcance) y no se rompe.
- **`scopeUsuarios`**: el Personal de la ficha de Empresa lo ve el superadmin; el admin ve su propia empresa por el alcance.

## 8. Fuera de alcance (YAGNI)

- Anidamiento de torres (Etapa → Torre) en la UI.
- Mover unidades entre torres en lote.
- Configuración de la junta directiva por torre (ya existe `Usuario.estructura_id` para eso, pero no se toca).
- Rediseño visual del resto de pantallas: sólo cambia el orden del menú.
