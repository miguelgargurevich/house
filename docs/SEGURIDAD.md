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
- **Varias claves por proveedor**: hasta 5 (`@@unique([proveedor, etiqueta])`; la 6.ª → 422). Etiquetas `[a-z0-9-]`. Guardar con una etiqueta nueva agrega una clave; con una existente la reemplaza (vuelve a `sin_probar` y parte con enfriamiento y contadores en cero).
- **Rotación del asistente** (`services/rotacion.ts`, `lib/cooldown.ts`): la cadena junta TODAS las claves habilitadas y no rechazadas, por prioridad del proveedor (gemini, groq, openrouter, openai, deepseek, mistral) y, dentro de un proveedor, la menos usada primero (`ultimo_uso_at` ascendente, nulos primero). El asistente prueba hasta `MAX_INTENTOS` eslabones (4; `LLAVERO_MAX_INTENTOS` de 1 a 8):
  - **429**: enfría solo ESA clave según `Retry-After` (segundos, fecha HTTP o `"retryDelay":"50s"` del cuerpo; mínimo 1 s, máximo 5 min, 60 s si no dice nada) y pasa a la siguiente.
  - **5xx, timeout o error de red**: enfriamiento fijo de 30 s y siguiente.
  - **401/402/403**: la clave queda `estado = 'rechazada'` («La clave fue rechazada» / «La cuenta no tiene saldo») **en la base** y sale de la rotación hasta que se pruebe bien o se reemplace (una prueba fallida no la rehabilita). Se registra `console.warn('[llavero] clave <proveedor>#<id> rechazada')`; la rotación automática no se audita.
  - **400**: es culpa de la petición; no rota, error genérico.
  - Las enfriadas van al final de la cadena pero nunca se descartan (mejor un 429 que «no hay proveedores»). Si el llavero no tiene ninguna clave usable, el último recurso es `GEMINI_API_KEY` del entorno. Un éxito limpia el enfriamiento de esa clave.
  - Al agotarse los intentos: 503 «El servicio de IA no pudo responder…» o 429 si todos los fallos fueron 429. Los logs llevan proveedor y estado, jamás la clave ni el cuerpo del proveedor.
- **Qué es memoria y qué es base**: enfriamientos y contadores de uso (`ok`/`limite`/`error`) viven **en memoria del proceso** y se pierden al reiniciar (a propósito; con varias réplicas cada una tiene los suyos). En la base quedan las claves cifradas, `estado`/`estado_detalle` (incl. `rechazada`), `habilitada` y `ultimo_uso_at`. `GET /api/llavero` suma `enfriando_hasta`, `uso`, `orden` y `max_claves_por_proveedor`; la clave y `api_key_enc` siguen sin salir.
- **Pendiente**: rotación de `LLAVERO_ENC_KEY` con re-cifrado (hoy hay que recargar las claves a mano); las claves descifradas viven en memoria solo mientras dura cada consulta del asistente (la cadena se arma por petición y no se cachea).

## Comprobantes de pago (archivos)
- Se guardan en PostgreSQL (`ArchivoComprobante`, 1 por pago, máx. 2 MB; sin infraestructura nueva). La respuesta de cualquier lista incluye sólo metadatos: `datos` jamás sale salvo en `GET /api/pagos/:id/comprobante`.
- Subida: cuerpo crudo con `express.raw` sólo en ese endpoint (tope 2 MB → 413); el pago se localiza y se autoriza ANTES de leer el cuerpo. Tipos permitidos JPG/PNG/WebP/PDF; el header lo manda el cliente, así que se comprueban los bytes mágicos y deben coincidir con el tipo declarado (SVG/HTML nunca entran). Se calcula sha256; el nombre se sanea (sin rutas, controles ni inversión de texto, máx. 100).
- Entrega: `Content-Type` guardado, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cache-Control: private, no-store`, nombre en `filename*` (RFC 5987). Acceso por empresa del pago (404 entre tenants) y, para residentes, sólo las unidades que tienen.
- La validación (`PATCH /api/pagos/:id/validacion`) es sólo admin/superadmin y atómica (`updateMany … WHERE estado_validacion='por_validar'`): dos revisiones simultáneas → una gana, la otra 409.
- Auditoría: `subir_comprobante` (nombre, tipo, tamaño, sha256), `ver_comprobante`, `validar` y `rechazar` (con motivo); nunca el contenido (el middleware además ignora cuerpos `Buffer`).
- Riesgo aceptado: un residente ve el comprobante del otro residente de SU misma unidad (propietario ↔ inquilino), porque ya ve ese pago en su lista.

## Riesgos aceptados
- **Token en `localStorage`** (autenticación por Bearer): un XSS podría leerlo. Mitigado con CSP estricta (`script-src 'self'`), sin HTML inyectado y token de 8 h. Pasar a cookie `httpOnly` + CSRF es la mejora siguiente.
- **Sin revocación explícita de tokens** antes de su vencimiento (salvo borrar al usuario).

## Recomendaciones
1. **Datos de prueba**: `prisma db seed` crea cuentas con contraseñas conocidas (`admin1234`…). No ejecutarlo en producción; al crear el primer superadmin real usar una contraseña propia.
2. Definir en Coolify `JWT_SECRET` (≥ 32 caracteres aleatorios), `DATABASE_URL`, `LLAVERO_ENC_KEY` (≥ 32 caracteres aleatorios, distinta de `JWT_SECRET`; sin ella el llavero no funciona), `GEMINI_API_KEY` (respaldo del asistente) y, si hace falta, `CORS_ORIGIN`.
3. Respaldos de PostgreSQL y rotación de `JWT_SECRET` (invalida las sesiones). Los comprobantes de pago viven en la base: el respaldo los incluye y la base crece hasta 2 MB por pago con archivo.

## No verificado
Chat de IA y «Probar» contra proveedores reales (sin claves locales; solo con `fetch` falso), despliegue real en Coolify, rendimiento con volumen alto.
