# HANDOFF — house

Registro entre agentes de código (Claude Code, OpenCode, Cline…). Una entrada por sesión significativa, la más reciente arriba. Actualiza secciones; no reescribas la historia ajena.

---

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/sesion-cookie`

**Qué se hizo:** sesiones de servidor con cookie httpOnly + CSRF + revocación (cierra el riesgo aceptado del token en `localStorage`).
- Esquema: modelo `Sesion` al final de `prisma/schema.prisma` (+ relación `sesiones` en `Usuario`). Aditivo.
- Backend: `services/sesiones.ts` (crear/buscar/revocar/limpiar, cookie, CSRF, reloj inyectable `sesionDeps.ahora`), `middleware/auth.ts` (`authenticate` solo cookie; CSRF + Origin en mutaciones), `routes/auth.ts` (login → `{user, csrf}`; `/me` con `csrf`; `logout`, `sesiones`, `sesiones/:id`, `sesiones/cerrar-otras`), `me.ts` (cambiar contraseña revoca las demás), `usuarios.ts` + nuevo hook `afterUpdate` en `crud.ts` (cambio de rol/contraseña revoca). Se quitó JWT de login/auth y `JWT_EXPIRES_IN`; `JWT_SECRET` sigue exigido en producción pero ya no firma nada. `server.ts` arranca la limpieza horaria (`SESIONES_LIMPIEZA=off` la apaga; `tests/helpers/env.ts` la apaga).
- Frontend: `api.ts` (sin `tokenStore`; `csrfStore` en memoria; `credentials: 'same-origin'`; `X-CSRF-Token` en mutaciones), `AuthContext` (pregunta a `/api/auth/me` al arrancar; logout llama al endpoint), `pages/shared/SesionesActivas.tsx` en «Mi perfil».
- Pruebas: `tests/helpers/app.ts` — `login()` sigue devolviendo un string (`<cookie>.<csrf>`) que `llamar()` convierte en cookie + `X-CSRF-Token`, así las pruebas existentes no cambian. Nuevo `tests/sesiones.test.ts`; en `tests/seguridad.test.ts` se reescribieron los casos de JWT manipulado.
- Docs: `SEGURIDAD.md` (sección «Sesiones», riesgo cerrado) y `API-CONTRATO.md`.

**Cómo verificar:** `npm test` · `npx tsc -b` · `npx tsc -p tests/tsconfig.json --noEmit` · `npm run build`.

**Gotchas**
- `node_modules` es compartido entre worktrees: `prisma generate` de una sesión pisa el cliente de las otras (le pasó a esta rama: el cliente se quedó sin `Sesion` al generar la rama `avisos`). Antes de verificar, regenera con el esquema de la rama integrada.
- Tras desplegar, todos los usuarios deben volver a iniciar sesión (los JWT viejos ya no valen).
- Editar tu propia contraseña/rol desde «Usuarios» también cierra tu sesión.
- Con otro origen en `CORS_ORIGIN` la cookie `SameSite=Lax` no viaja en peticiones cross-site; el modo soportado es mismo origen (el proxy de Vite en desarrollo).

**Próximos pasos:** retirar `JWT_SECRET` (config, `.env.example`, tests) en un cambio aparte; opcional: tope de sesiones por usuario.

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/comprobantes`

**Qué se hizo:** comprobantes de pago (voucher) y validación del administrador.
- **Estados**: `estado_pago` admite `en_revision`. Un pago del residente (`POST /api/me/cargos/:id/pagos`) deja el cargo `en_revision` y el `Pago` `por_validar`; el del admin (`POST /api/pagos`) sigue dejándolo `pagado`/`validado`. `en_revision` cuenta en «por cobrar», no en cobrado (sólo pagos `validado`) ni en morosidad. Tocados: `lib/cargos.ts` (`estadoCargo`, `filtroEstadoCargo('en_revision')`, `noPagado` exportado), `dashboard.ts`, `recibos.ts` (`totales.en_revision`, `estado_cobranza`), `cargos.ts`, `me.ts`, `pagos.ts` (`sincronizarCargo` sólo suma pagos validados; el saldo ignora rechazados).
- **Esquema (aditivo)**: `Pago.estado_validacion` (default `validado`), `validado_por_id`, `validado_at`, `motivo_rechazo`; modelo `ArchivoComprobante` (1 por pago, cascada). Al darle nombre a la relación existente Pago↔Usuario (`PagoUsuario`) hubo que tocar dos líneas ya existentes (sólo etiqueta; no cambia la base).
- **API**: `routes/comprobantes.ts` (montado ANTES del CRUD de pagos en `app.ts`): `POST|GET /api/pagos/:id/comprobante`, `PATCH /api/pagos/:id/validacion`; reglas en `services/comprobantes.ts` (bytes mágicos, nombre saneado, `Content-Disposition`). Detalle en `docs/API-CONTRATO.md` y `docs/SEGURIDAD.md`.
- **Frontend**: `PagarModal` (adjuntar comprobante), «En revisión» y «Pago rechazado: motivo» + «Pagar de nuevo» en los recibos, estado e impresión del comprobante en «Mis pagos» (con adjuntar/reemplazar), `admin/Pagos.tsx` con pestañas Por validar | Validados | Rechazados y `ValidarPagoModal`. Helper de archivos propio en `src/pages/shared/comprobantes.ts` (+ `ComprobanteVista.tsx`): sube con `fetch` crudo y baja el archivo como blob con la sesión.
- **Pruebas**: `tests/comprobantes.test.ts` (29). `tests/negocio.test.ts` cambió a propósito: pagar como residente deja `en_revision`/`por_validar`, `pagado_ano`/`cobrado` ya no cuentan hasta validar, y el dashboard suma `en_revision`/`pagos_por_validar`.

**Cómo verificar:** `npm test` · `npx tsc -b` · `npx tsc -p tests/tsconfig.json --noEmit` · `npm run build`.

**Próximos pasos**
- Al fusionar con la rama de cookies: `src/pages/shared/comprobantes.ts` lee el token con `tokenStore.get()` y lo manda en `Authorization`; si la autenticación pasa a cookie `httpOnly`, cambiar `autorizacion()` por `credentials: 'include'` (un solo archivo). Las pruebas siguen usando el helper `login` del Bearer.
- «Te avisaremos cuando se valide» (texto del modal) depende de la sesión de avisos: hoy el residente lo ve al entrar a Mis recibos / Mis pagos; no hay notificación.
- Probar en navegador: PDF con `Content-Security-Policy: sandbox` (Chrome puede negarse a mostrar un PDF con ese header si se abre directo desde la URL de la API). La app lo evita bajando el archivo como blob y abriéndolo desde una URL local, pero conviene verlo.
- Un pago rechazado queda en el historial (no se borra); si hace falta limpiar, es decisión de producto.

**Decisiones**
- Un rechazo no borra el pago: queda `rechazado` con su motivo y el residente paga de nuevo (pago nuevo). El monto del pago del residente sigue saliendo del cargo, no del cliente.
- Ver el comprobante: admin de la empresa, superadmin y CUALQUIER residente de la unidad (propietario e inquilino); subirlo/reemplazarlo: sólo quien registró el pago (mientras `por_validar`) o un admin.
- application/json con cuerpo no JSON responde 400 (el parser global lo rechaza antes); con JSON válido, 415.

**Gotchas**
- `node_modules` es un enlace al checkout principal y `prisma generate` lo reescribe para TODAS las sesiones: dos ramas con esquemas distintos se pisan el cliente (tsc/pruebas fallan con «no existe estado_validacion» hasta regenerar). Regenera justo antes de cada corrida: `npx prisma generate && npm test`.
- Lo mismo con `house_test`: otra sesión le aplicó su esquema y borró mis columnas. Esta rama probó con su propia base: `TEST_DATABASE_URL=postgresql://postgres:house@localhost:5433/house_test_comprobantes` (el nombre debe contener `house_test`).
- Los binarios no pasan por `llamar()` (serializa a JSON): las pruebas usan `fetch` directo con el cuerpo crudo.

---

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/llavero-rotacion`

**Qué se hizo:** varias claves por proveedor + rotación de claves y de proveedores en el asistente (versión ligera de `providerCooldown`/cascada de My Workspace).
- Backend: `lib/cooldown.ts` (en memoria, reloj inyectable `cooldownDeps.ahora`; 429 enfría esa clave con `Retry-After` en 3 formas, cotas 1 s–5 min, 60 s por defecto; 5xx/red 30 s), `services/rotacion.ts` (`construirCadena`, `rechazarClave`, contadores de uso), `routes/aiChat.ts` recorre hasta `MAX_INTENTOS` (4, `LLAVERO_MAX_INTENTOS` 1–8). Tope de 5 claves por proveedor (422). Estado nuevo `rechazada` (401/402/403): persistido, fuera de la rotación hasta probar ok o reemplazar. `GET /api/llavero` suma `enfriando_hasta`, `uso`, `orden`, `max_claves_por_proveedor`. Se quitó `resolverParaUso` (ya no hay «una sola clave»).
- Frontend: grupos por proveedor con claves como filas, bloque «Cómo se usan» con el orden real, cuenta atrás «Enfriando 45 s» (`Enfriando.tsx`, solo ese componente re-renderiza cada segundo), «Agregar otra clave» (etiqueta `clave-2`…), refresco cada 20 s con la página visible. `FilaProveedor.tsx` se reemplazó por `GrupoProveedor.tsx` + `FilaClave.tsx`.
- Pruebas: `tests/rotacion.test.ts` (20, reloj y `fetch` inyectados); en `tests/llavero.test.ts` cambió a propósito «si el primero falla rota al siguiente» (antes no se probaba otro).
- `docs/SEGURIDAD.md` documenta rotación, claves rechazadas y qué es memoria y qué es base. Sin cambios de esquema Prisma.

**Cómo verificar:** `npm test` (105) · `npx tsc -b` · `npx tsc -p tests/tsconfig.json --noEmit` · `npm run build`.

**Próximos pasos**
- Revisar la pantalla en navegador (claro/oscuro, < 640 px) y probar con claves reales: ninguna llamada a un proveedor real se ha hecho.
- Si se despliegan varias réplicas, el enfriamiento (memoria) no se comparte entre ellas; evaluar Redis o una columna solo si llega a molestar.
- Un modelo por clave ya existe; falta elegir modelo por proveedor en la cadena si se quiere variar entre eslabones del mismo proveedor.

**Decisiones**
- Enfriamientos y contadores son memoria a propósito (se pierden al reiniciar); lo que se persiste es `rechazada`, porque una clave sin saldo o revocada no mejora sola.
- Un 400 no rota (es la petición); una 2xx sin texto se trata como fallo transitorio (30 s).
- El respaldo `GEMINI_API_KEY` entra solo si el llavero no tiene ninguna clave usable; si recibe 401 se enfría 30 s pero no se persiste.
- Una prueba fallida de una clave `rechazada` la deja `rechazada`; solo una prueba ok o reemplazarla la rehabilita.

**Gotchas**
- Las pruebas deben llamar `limpiarTodo()` y `olvidarTodoUso()` (estado global del proceso) en `beforeEach`.
- La cuenta atrás usa el reloj del navegador contra `enfriando_hasta` del servidor; un reloj muy desfasado la muestra mal hasta el siguiente refresco.

---

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/llavero`

**Qué se hizo:** llavero de integraciones («Mis claves de IA» de My Workspace adaptado a House), solo superadmin.
- Backend: modelo `ClaveIntegracion` (`prisma/schema.prisma`), `lib/secretBox.ts` (AES-256-GCM, `v2:` con AAD `clave:<proveedor>:<etiqueta>`, scrypt desde `LLAVERO_ENC_KEY`), `lib/proveedoresIA.ts` (catálogo con URLs fijas), `services/llavero.ts` (guardar/listar/probar/pausar/borrar/`obtenerClaveParaUso`/`resolverParaUso`; `llaveroDeps.fetch` es el punto de inyección para pruebas), `routes/llavero.ts` en `/api/llavero`.
- Auditoría: `middleware/audit.ts` acepta `res.locals.accion` y redacta también `clave|key|authorization|credencial`. Rate-limit nuevo `llavero` (20/15 min por usuario, solo escrituras y pruebas).
- Asistente (`routes/aiChat.ts`): llavero por prioridad → `GEMINI_API_KEY`. Gemini por `generateContent` (URL ahora `v1beta` + modelo de la fila o `gemini-2.0-flash`) y OpenAI-compatibles por `/chat/completions`. Mismo formato de respuesta/errores.
- Frontend: `/superadmin/llavero` (`pages/superadmin/Llavero.tsx` + `_parts/llavero/`), entrada «Llavero de IA» en la navegación del superadmin. Reusa `Interruptor` de `pages/admin/_parts/catalogo`.
- `tests/llavero.test.ts` (16 pruebas, sin red real). `docs/SEGURIDAD.md` y `.env.example` documentan `LLAVERO_ENC_KEY`.

**Cómo verificar:** `npm test` (85) · `npx tsc -b` · `npx tsc -p tests/tsconfig.json --noEmit` · `npm run build`.

**Próximos pasos**
- Definir `LLAVERO_ENC_KEY` (≥ 32 caracteres, distinta de `JWT_SECRET`) en Coolify y correr `npx prisma db push` en `house` (tabla nueva `ClaveIntegracion`; no destructivo). Sin la variable el llavero responde 503 y el asistente sigue con `GEMINI_API_KEY`.
- Revisar la pantalla en navegador (claro/oscuro, < 640 px) y probar con claves reales: nada se ha llamado a un proveedor real.
- Decidir si se quiere re-cifrado al rotar `LLAVERO_ENC_KEY` y si «Probar» debe listarse en la auditoría con acción propia (hoy va como `editar`).

**Decisiones**
- Las pruebas del proveedor (`GET /models`) y el asistente comparten `llaveroDeps.fetch`; el cliente nunca aporta URL.
- Si una clave no se puede descifrar (otra `LLAVERO_ENC_KEY`), `obtenerClaveParaUso` devuelve null y el asistente pasa al siguiente proveedor/entorno; es la única «caída» silenciosa, y solo ocurre antes de llamar al proveedor.
- Una clave con estado `error` sigue usándose mientras esté habilitada; solo «pausar» la excluye.

**Gotchas**
- `node_modules` de este worktree es un enlace al checkout principal: `npx prisma generate` regeneró ahí el cliente (incluye `ClaveIntegracion`); es un superconjunto, no rompe otras ramas, pero la base `house` de desarrollo necesita `db push` para usar el modelo.
- `tests/helpers/app.ts` (`vaciarBase`) ahora incluye `ClaveIntegracion` en el TRUNCATE.

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/backend-seguro`

**Qué se hizo** (sólo backend; el frontend lo rediseña otra sesión):
- `src/server.ts` (770 líneas) pasó a ser 5 líneas: importa la app y hace `listen`. El código vive en `src/server/`: `app.ts` (`createApp()`), `config.ts`, `db.ts`, `crud.ts` (CRUD genérico con paginación/búsqueda/orden), `validation.ts` (zod), `middleware/` (auth, audit, rateLimit, error), `routes/` (uno por recurso) y `lib/` (scope por empresa, cargos, fechas).
- Seguridad: un solo login `POST /api/auth/login` (JWT HS256 8 h, payload `{id,email,rol,empresa_id,complejo_id}`) + `GET /api/auth/me`; se eliminaron `/auth/login` y `/api/login`. `JWT_SECRET` obligatorio (≥ 32) en producción —el proceso no arranca sin él—; en desarrollo se usa un secreto aleatorio por proceso. helmet, `express.json({limit:'100kb'})`, `trust proxy 1`, CORS apagado salvo `CORS_ORIGIN`, rate-limit (login 10/15 min por IP+email, API 300/15 min por IP, ai-chat 20/15 min por usuario, cambio de clave 10/15 min por usuario), tiempo constante en login fallido, swagger sólo fuera de producción, un `PrismaClient` único, error handler central (`{error}` corto; detalle sólo en el log), zod en todo POST/PUT/PATCH y query/params (422 con `{error, campos}`), bcrypt cost 12, `password_hash` omitido globalmente en el cliente Prisma (`omit` en `db.ts`).
- Permisos: `requireRole(...)` + alcance por empresa en `lib/scope.ts`. Otro tenant → 404. Matriz según el pedido (superadmin todo; admin su empresa, sin crear superadmins; residentes sólo `/api/me/*`; mantenimiento sólo sus tareas y las unidades de esas tareas; seguridad sólo unidades de su complejo y dashboard).
- Auditoría: modelo `Auditoria` + middleware (toda mutación 2xx y logins ok/fallidos) + `GET /api/auditoria` (superadmin, filtros `entidad`, `accion`, `usuario_id`).
- Contrato completo de `docs/API-CONTRATO.md` (incl. adiciones): listas `{items,total,page,pageSize}`, `/api/tareas` (+ `PATCH /:id/estado`), `/api/me`, `/api/me/password`, `/api/me/unidades|cargos|pagos`, `POST /api/me/cargos/:id/pagos`, `/api/dashboard/resumen` por rol, `/api/reportes/morosidad`, `POST /api/recibos` que genera conceptos + un cargo por unidad activa, `GET /api/recibos/:id` con `conceptos` y `cargos`.
- Esquema: `Unidad.inquilino_id` (relación `InquilinoUnidad`) y modelo `Auditoria`. Seed rehecho: propietarios/inquilinos con `empresa_id` y complejo coherentes, cada inquilino en una unidad distinta de su complejo, 3 recibos por complejo con cargos pagados/pendientes/vencidos y sus pagos, tareas con estado `en_progreso` (antes `en_proceso`), emails sin tildes, bcrypt cost 12 con caché.
- Pruebas: `tests/*.test.ts` (`node:test` + `tsx`, base `house_test`).

**Cómo verificar:** `npm test` · `npx tsc -b` · `npx tsc -p tests/tsconfig.json --noEmit` · `npm run build`.

**Próximos pasos**
- Tras mergear: `npm install` (nuevas dependencias `zod`, `helmet`, `express-rate-limit`), `npx prisma db push` (columna `Unidad.inquilino_id` y tabla `Auditoria`) y, si se quiere, `npx prisma db seed` — **el seed borra todo**, no correrlo en producción.
- Producción (Coolify): definir `JWT_SECRET` (≥ 32 caracteres) y, si el frontend se sirve desde otro origen, `CORS_ORIGIN`. Sin `JWT_SECRET` el contenedor se cae al arrancar (es a propósito).
- Las sesiones anteriores (JWT de 12 h/7 d firmados con `devsecret`) dejan de valer; hay que volver a iniciar sesión.
- El README sigue describiendo `/auth/login` y la ruta vieja de login; actualizarlo.
- Pendiente de decisión: unicidad de `Unidad.codigo` por complejo y de (`complejo`, `mes`, `anio`) por recibo (hoy no hay restricción); paginación de `cargos` en `GET /api/recibos/:id` (tope 2000).

**Decisiones**
- Errores de validación: 422 `{error:'Datos inválidos: campo: mensaje', campos:{campo:mensaje}}`. Referencias a recursos inexistentes **o de otra empresa** en el cuerpo → 422 con el mismo mensaje (no filtra existencia). Recurso por id de otro tenant → 404.
- `authenticate` relee al usuario de la base en cada petición: el rol/empresa vigentes mandan sobre los del token y un usuario borrado queda fuera al instante (1 consulta extra por request).
- `vencido` = no pagado y `fecha_vencimiento` anterior a hoy (día calendario en Lima, UTC-5): un cargo que vence hoy sigue pendiente hasta mañana.
- Montos: `Decimal` serializado como string (`"150"` en filas crudas de Prisma; `"150.00"` en totales/dashboard calculados). No se pasó a número.
- El login cuenta TODOS los intentos (no sólo los fallidos) hacia el tope de 10.
- `PUT` y `PATCH` comparten handler y aceptan actualización parcial. `/api/recibo-conceptos` es CRUD crudo (no genera cargos); para emitir recibos usa `POST /api/recibos`.
- Un pago registrado por admin (`POST /api/pagos`) marca el cargo como pagado cuando lo abonado cubre el monto, y rechaza montos que excedan el saldo; borrar el pago reabre el cargo.
- La clave de Gemini viaja en la cabecera `x-goog-api-key` (antes en la URL).

**Gotchas**
- Las pruebas **vacían** `house_test` en cada archivo (y se niegan a correr sin `house_test` en la URL). Por compartir esa base corren de a un archivo: `--test-concurrency=1` en el script `npm test`.
- `.gitignore` ignora `.env*`: `.env.example` está commiteado con `git add -f`.
- `npm test` usa `node --import tsx --test … "tests/*.test.ts"` con comillas (Node 26 falla a veces con `node --test tests/`, nodejs/node#64555).
- Con `omit` global, cualquier consulta nueva que necesite `password_hash` debe pedirlo con `omit: { password_hash: false }`.
- El esquema se aplica con `db push` (sin migraciones versionadas).
- Este worktree usa su propio `node_modules` (enlaces al del checkout principal salvo `@prisma/client` y `.prisma`, copiados) para que `prisma generate` no pise el cliente de la sesión principal; `zod`, `helmet`, `express-rate-limit` e `ip-address` se copiaron aparte. En un checkout normal basta `npm install`.
- Nunca matar procesos con `pkill -f "tsx src/server.ts"`: coincide con el backend de otras sesiones. Usa el PID.

## 2026-10-23 · Claude Code (Sonnet 5.5) · rama `feat/admin-catalogo`

**Hecho:** pantallas de catálogo del administrador, sobre el kit `src/ui` y escritas contra `docs/API-CONTRATO.md`.
- `src/pages/admin/Complejos.tsx` — «Condominios»: lista, búsqueda, paginación, CRUD en `Modal`, empresa (select) sólo para superadmin.
- `src/pages/admin/Unidades.tsx` — filtros por condominio y estado (servidor), propietario/inquilino, CRUD.
- `src/pages/admin/Conceptos.tsx` — CRUD, interruptor de «activo» directo en la tabla (PUT `{activo}`).
- `src/pages/admin/Configuracion.tsx` — «Mi empresa»: `DefinitionList` + edición (RUC de 11 dígitos), vacío si no hay `empresa_id`.
- Piezas compartidas en `src/pages/admin/_parts/catalogo/`: `opciones.ts` (`useOpciones`, listas de tipos), `Interruptor.tsx`, `FiltroSelect.tsx`.

**Verificado:** `npx tsc -b` sin errores; `npm run build` correcto. **No verificado:** nada en navegador ni contra backend real.

**Próximos pasos**
- Integrar con el backend nuevo y revisar en navegador (claro/oscuro, < 640 px).
- Confirmar que `/api/complejos` devuelve el conteo de unidades (`_count.unidades` o `unidades_count`); si no, la columna muestra «—».
- Confirmar que `PUT /api/conceptos/:id` acepta un cuerpo parcial `{activo}` (si exige el objeto completo, `alternar` en Conceptos debe enviar todos los campos).

**Gotchas**
- El contrato no define `_count` en complejos; se asumió el nombre de Prisma.
- Los selects de propietario/inquilino/condominio cargan hasta 100 registros (`pageSize=100`); con más, haría falta un buscador.
- El kit no trae select compacto ni interruptor: viven en `_parts/catalogo/` (candidatos a subir a `src/ui`).

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama feat/admin-cobranza

**Qué se hizo:** pantallas de cobranza del administrador, escritas contra `docs/API-CONTRATO.md` (sin backend nuevo para probarlas):
- `Recibos` (lista + filtro por condominio + modal «Emitir recibo» + detalle con cargos por unidad).
- `Pagos` (lista, filtro por método, `StatStrip`, modal «Registrar pago»).
- `Morosidad` (`StatStrip`, tabla con `Badge` ámbar/rojo, exportar CSV con BOM UTF-8).
- `Mantenimientos` (`Tabs` por estado, crear/editar, botones Iniciar/Completar).
- Piezas compartidas en `src/pages/admin/_parts/cobranza/`.

**Próximos pasos:** integrar con el backend nuevo y revisar en el navegador (430 px y escritorio, claro/oscuro).

**Decisiones / gotchas:**
- Los modales se montan sólo cuando están abiertos (`{abierto && <Modal open …/>}`), así cada apertura empieza con formulario y fetch limpios.
- «Registrar pago» pide aparte `estado=pendiente` y `estado=vencido`: el contrato calcula `estado` por fecha, y un cargo vencido ya no es «pendiente».
- Morosidad: el contrato no dice si `unidad`/`propietario` llegan como objeto o texto; se aceptan ambos. Pide `pageSize=100` y los totales del `StatStrip` salen de las filas cargadas (`unidades morosas` usa `total`).
- Selects de unidades y personal en el modal de tareas cargan `pageSize=100` (máximo del contrato): con más de 100 unidades faltarán opciones.
- La edición de tarea usa `PUT /api/tareas/:id` (el contrato sólo nombra POST y el PATCH de estado).

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama feat/residentes
**Hecho:** pantallas de residentes y perfil, contra `docs/API-CONTRATO.md` (sin backend nuevo, no se vieron datos reales).
- Código compartido en `src/pages/residente/_parts/` (Inicio, Unidades, Cargos, Pagos, `PagarModal`, `CargoItem`, `Pager`, `tipos.ts`); los archivos de propietario/inquilino sólo lo componen.
- `src/pages/shared/Perfil.tsx`: datos (`PUT /api/me` + `refresh()`) y contraseña (`PUT /api/me/password`).
- Móvil < `md`: tarjetas/filas; desde `md`: `DataTable`. Estados de carga, vacío y error en todas.

**Próximos pasos:** integrar con el backend y revisar en navegador (móvil 360 px, claro y oscuro); probar la impresión del comprobante.

**Gotchas:**
- Forma supuesta de `/api/me/pagos`: `{id, monto, fecha_pago, metodo_pago, referencia, unidad:{codigo}, concepto:{nombre}}` (igual que `/api/pagos`). Si difiere, ajustar `PagoResidente` en `tipos.ts`.
- `/api/me/unidades` se acepta como arreglo o como `{items}`.
- `api()` cierra la sesión ante cualquier 401: si el backend responde 401 por contraseña actual errónea en `/api/me/password`, el usuario saldría de la sesión; conviene que devuelva 400/403.
- «Pendientes» en `/api/me/cargos` se asume sin vencidos (estado calculado exclusivo). «Próximos recibos» ordena en cliente los primeros 20 pendientes por vencimiento.
- La impresión del comprobante usa un `<style>` con `@media print` dentro del modal (oculta `body *` salvo `#comprobante`).

Entradas por fecha (la más reciente arriba).

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/plataforma-staff`

**Qué se hizo**
- Superadmin: `Dashboard` (resumen global), `Empresas` (CRUD, RUC de 11 dígitos), `Auditoria` (sólo lectura + modal con `detalle`), `Usuarios` re-exporta `admin/Usuarios`.
- `admin/Usuarios`: filtro por rol, filtro por empresa y selector de empresa en el formulario (sólo superadmin).
- Mantenimiento: `Inicio` (StatStrip + 3 tareas abiertas) y `Tareas` (Tabs por estado, tarjeta con un botón de acción). Piezas en `mantenimiento/_parts/TareaCard.tsx`.
- Seguridad: `Inicio` y `Unidades` (lectura, búsqueda).
- Piezas de superadmin en `superadmin/_parts/` (`EstadoCargos`, `fechas`).

**Próximos pasos**
- Integrar con el backend nuevo y revisar visualmente (nada se ha visto con datos reales).
- Confirmar con el backend los nombres de campos/filtros de `/api/auditoria` (ver gotchas).

**Gotchas**
- `/api/auditoria` no está en el contrato ni en `schema.prisma`: se asumió `{id, fecha|created_at, usuario:{nombre}|usuario_nombre, accion, entidad, entidad_id, ip, detalle}` y filtros `?entidad=&accion=&orden=fecha:desc`. Acciones esperadas: crear, editar, eliminar, login; entidades en singular minúscula (usuario, empresa, unidad…). Si el backend usa otros valores, ajustar `ACCIONES`/`ENTIDADES` en `superadmin/Auditoria.tsx`.
- `/api/tareas` se asume con `unidad:{id,codigo}` incluido y `orden=fecha_creacion:desc`. El backend debería filtrar por el usuario asignado cuando el rol es mantenimiento.
- Usuarios: se envía `empresa_id` sólo si el usuario actual es superadmin (`null` para rol superadmin). Empresa obligatoria en el formulario para admin, mantenimiento y seguridad.
- `IconButton` del kit mide 36 px (h-9), por debajo del objetivo táctil de 40 px.
