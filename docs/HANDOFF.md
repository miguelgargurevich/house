# HANDOFF — house

Registro entre agentes de código (Claude Code, OpenCode, Cline…). Una entrada por sesión significativa, la más reciente arriba. Actualiza secciones; no reescribas la historia ajena.

---

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
