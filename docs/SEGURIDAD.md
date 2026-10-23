# Auditoría de seguridad de House

Fecha: 2026-10-23 · Alcance: frontend React + backend Express/Prisma + Docker. Método: revisión de código (rutas, middleware, esquema), `npm audit`, pruebas automáticas (69) y prueba del contenedor de producción.

## Resultado
Sin hallazgos críticos abiertos. Quedan 2 riesgos aceptados y 3 recomendaciones.

## Hallazgos cerrados
| # | Categoría | Hallazgo original | Corrección |
|---|---|---|---|
| 1 | access-control | Todos los GET `/api/*` públicos (listas completas) | Todo `/api` exige JWT salvo login y `/api/health`; permisos por rol y por empresa; recurso ajeno → 404 |
| 2 | data | `password_hash` salía en las respuestas de usuarios | `omit` global en Prisma; test de que nunca aparece |
| 3 | authn | Secreto JWT `devsecret` por defecto; dos logins con vigencias distintas | Producción exige `JWT_SECRET` ≥ 32; un solo login; 8 h; el usuario se relee en cada petición (borrado = acceso cortado) |
| 4 | authn | Sin límite de intentos | Rate-limit de login (IP+correo), API y asistente IA |
| 5 | access-control | Un admin podía crear superadmins y tocar otras empresas | Alta/cambio de rol acotado; scoping por `empresa_id` |
| 6 | validation | Sin validación de entrada | zod en body y query; paginación acotada |
| 7 | data | Logs con headers y body (incluían Authorization); errores con detalle de Prisma | Se eliminaron; error handler genérico |
| 8 | transport | Sin helmet, CORS abierto, Swagger público | helmet (CSP, HSTS, nosniff), CORS por lista (`CORS_ORIGIN`), Swagger solo fuera de producción |
| 9 | injection | `new PrismaClient()` por request; sin SQL crudo revisado | Un cliente; el único `$queryRaw` está parametrizado |
| 10 | deps | 3 vulnerabilidades altas (`deepmerge-ts` vía Prisma CLI) | `overrides` a `deepmerge-ts@^8`; Prisma fijado en 6.19.3; `npm audit` en 0 |
| 11 | deploy | Contenedor como root; healthcheck apuntaba a una ruta que no existe en producción; sin `package-lock.json` en el repo (`npm ci` fallaba) | `USER node`, `/api/health`, lockfile versionado |
| 12 | xss | Script inline bloqueado por la CSP | `theme-init.js` externo; sin `dangerouslySetInnerHTML` en el código |
| 13 | validation | Auditoría pedía orden `fecha`, el backend solo `created_at` | Corregido en la pantalla |

## Llavero de IA (claves de proveedores)
Pantalla `/superadmin/llavero` y API `/api/llavero` para guardar las API keys de Gemini, Groq, OpenRouter, OpenAI, DeepSeek y Mistral que usa el asistente.
- **Cifrado en reposo**: AES-256-GCM, IV aleatorio de 12 bytes, formato `v2:<base64(iv|tag|ciphertext)>`. Clave derivada con scrypt (sal fija de la app) desde `LLAVERO_ENC_KEY` (≥ 32 caracteres). Sin esa variable (o si es corta) el llavero responde 503 «El llavero no está configurado en el servidor», no guarda nada en claro y la aplicación arranca igual.
- **AAD obligatoria** `clave:<proveedor>:<etiqueta>`: un valor copiado a otro proveedor o etiqueta no se descifra. Cambiar `LLAVERO_ENC_KEY` invalida lo guardado (hay que volver a cargar las claves).
- **Acceso**: solo rol `superadmin` exacto (un `admin` recibe 403 en todas las rutas). Escrituras y pruebas con límite de 20 por 15 min por usuario.
- **Nunca se devuelve la clave**: las respuestas llevan solo `ultimos4` y el estado; el `select` de Prisma excluye `api_key_enc`. El detalle de «Probar» es un texto fijo en español (no el cuerpo del proveedor).
- **Sin SSRF**: las URLs de los proveedores son constantes del servidor (`lib/proveedoresIA.ts`); el cliente no aporta ninguna. «Probar» hace `GET /models` con timeout de 10 s y sin seguir redirecciones.
- **Auditoría**: crear/editar/eliminar (y probar, como `editar`) quedan en `Auditoria` con entidad `clave-ia`, proveedor, etiqueta y últimos 4, sin la clave. El auditor genérico ahora también redacta cualquier campo cuyo nombre contenga `clave`, `key`, `authorization` o `credencial` (además de `pass`, `token`, `secret`, `hash`…).
- **Asistente**: resuelve el proveedor desde el llavero (habilitadas, por prioridad: gemini, groq, openrouter, openai, deepseek, mistral) y, de respaldo, `GEMINI_API_KEY`. Si el elegido falla no se prueba otro en silencio.
- **Pendiente**: rotación de `LLAVERO_ENC_KEY` con re-cifrado (hoy hay que recargar las claves a mano); la clave descifrada vive en memoria del proceso solo durante la llamada.

## Riesgos aceptados
- **Token en `localStorage`** (autenticación por Bearer): un XSS podría leerlo. Mitigado con CSP estricta (`script-src 'self'`), sin HTML inyectado y token de 8 h. Pasar a cookie `httpOnly` + CSRF es la mejora siguiente.
- **Sin revocación explícita de tokens** antes de su vencimiento (salvo borrar al usuario).

## Recomendaciones
1. **Datos de prueba**: `prisma db seed` crea cuentas con contraseñas conocidas (`admin1234`…). No ejecutarlo en producción; al crear el primer superadmin real usar una contraseña propia.
2. Definir en Coolify `JWT_SECRET` (≥ 32 caracteres aleatorios), `DATABASE_URL`, `LLAVERO_ENC_KEY` (≥ 32 caracteres aleatorios, distinta de `JWT_SECRET`; sin ella el llavero no funciona), `GEMINI_API_KEY` (respaldo del asistente) y, si hace falta, `CORS_ORIGIN`.
3. Respaldos de PostgreSQL y rotación de `JWT_SECRET` (invalida las sesiones).

## No verificado
Chat de IA y «Probar» contra proveedores reales (sin claves locales; solo con `fetch` falso), despliegue real en Coolify, rendimiento con volumen alto.
