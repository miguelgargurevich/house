# AGENTS.md — house

SaaS multi-tenant de administración de condominios. Backend Express 5 + Prisma 6 + PostgreSQL (`src/server.ts` → `src/server/`), frontend React/Vite (`src/`).
Antes de trabajar: lee `docs/HANDOFF.md` (última entrada) y `docs/API-CONTRATO.md` (contrato autoritativo de la API).

## Comandos
- `npm run dev:all` — backend (puerto 4000) + Vite (5173; proxy `/api` → 4000).
- `npm run backend` / `npm start` — sólo el backend (`tsx src/server.ts`; `PORT` configurable).
- `npx prisma db push` — aplica el esquema (no hay migraciones versionadas). `npx prisma db seed` — siembra datos de prueba (`prisma/seed.ts`; contraseñas de desarrollo en ese archivo).
- `npm run seed:libertadores` — SOLO base local `house` (aborta si no): borra y recrea todo con el Condominio Los Libertadores de Surco (448 unidades, 12 recibos nov-2025→oct-2026, ~37 000 pagos; ~45 s). Cuentas: `miguel@prueba.house` / `prop1234` (B01-804, presidente del Block 1), las del Login. No toca `seed.ts` ni el llavero de IA.
- `npm test` — pruebas del backend (`node:test` + `tsx`, `tests/*.test.ts`, contra la base `house_test`; ver abajo).
- `npx tsc -b` y `npm run build` — tipos y build del frontend; `npx tsc -p tests/tsconfig.json --noEmit` — tipos del backend + tests.

## Entorno
- Asistente de IA: `MODELOS_SYNC`, `ASISTENTE_CANARY`, `ASISTENTE_LIMPIEZA` (`on|off`; por defecto sólo producción; las pruebas las apagan). Las pruebas del asistente usan `fetch` inyectado (`tests/helpers/ia.ts`): nunca red real.
- `.env` (no se commitea; plantilla en `.env.example`): `DATABASE_URL`, `JWT_SECRET` (≥ 32 caracteres; **obligatorio** con `NODE_ENV=production`, si no el proceso no arranca), `CORS_ORIGIN` (opcional, lista separada por comas; por defecto CORS desactivado = mismo origen), `GEMINI_API_KEY` (chat de IA).
- Postgres local: contenedor `house-pg`, puerto 5433. Bases: `house` (desarrollo), `house_test` (pruebas; créala con `docker exec house-pg psql -U postgres -c "CREATE DATABASE house_test"` y aplica el esquema con `DATABASE_URL=postgresql://postgres:house@localhost:5433/house_test npx prisma db push`).
- Las pruebas **vacían** `house_test` en cada archivo y se niegan a correr si `DATABASE_URL` no contiene `house_test`. Corren de a un archivo (`--test-concurrency=1`) porque comparten esa base.

## Reglas del backend
- Estructura: `src/server/app.ts` (`createApp()`, sin `listen`), `db.ts` (un solo `PrismaClient`; `password_hash` se omite en TODA consulta, el login y el cambio de contraseña lo piden con `omit: { password_hash: false }`), `middleware/`, `routes/` (uno por recurso), `lib/scope.ts` (alcance por empresa), `crud.ts` (CRUD genérico con paginación), `validation.ts` (zod).
- Todo `/api/*` exige JWT salvo `POST /api/auth/login`. El rol y la empresa se releen de la base en cada petición.
- Multi-tenant: todo recurso se filtra con las funciones de `lib/scope.ts`; otro tenant → **404**, no 403. Un recurso nuevo debe tener su `scopeX`.
- Roles: `superadmin`, `admin`, `propietario`, `inquilino`, `mantenimiento`, `seguridad`, `limpieza`, `jardineria`. Personal (admin, seguridad, mantenimiento, limpieza, jardinería) pertenece a una empresa (`Usuario.empresa_id`) y opcionalmente a un condominio; los residentes (propietario, inquilino) no tienen empresa y se alcanzan por condominio/unidades.
- Toda entrada (body, query, params) pasa por zod (`parseBody`/`parseQuery`/`parseId`) → 422 con `{error, campos}`. Errores inesperados: sólo `{error:'mensaje corto'}`; el detalle va al log.
- Mutaciones y logins quedan en `Auditoria` (middleware `audit.ts`); nunca guardes contraseñas en el detalle.
- Montos son `Decimal` y salen como string. Mensajes de error en español (Perú), montos en S/.
- No cambies el frontend desde una tarea de backend ni viceversa sin avisar en el handoff.

## Git
- Commit sí, push sólo con OK de Miguel. `git add` archivo por archivo. Cada commit termina con la línea `Co-Authored-By` del agente que lo hizo.
- Al terminar trabajo significativo, añade una entrada a `docs/HANDOFF.md`.
