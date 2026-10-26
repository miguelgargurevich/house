# Auditoría de seguridad — 2026-10-26

Alcance: repo completo (rama `chore/auditoria-seguridad` sobre `main` 4adab82), sin diff. Método: el de `/security-review` (sólo vulnerabilidades reales y explotables, alta confianza) aplicado al código entero, priorizando aislamiento multi-tenant → roles → sesión → inyección → fuga de datos → frontend → dependencias. Se leyó `docs/SEGURIDAD.md` entero: lo decidido a propósito allí no se reporta (p. ej. `/api/ai-chat/*` fuera de la auditoría, otro tenant → 404).
Línea base: `npm test` 720/720. Final: 726/726.

## Hallazgos confirmados y corregidos (Medios)
No hay Altos. Cada uno se reprodujo con un test en rojo contra `house_test`, se corrigió y se comprobó la mutación (al revertir el arreglo el test vuelve a fallar).

### M-1 · Media · El token de WhatsApp salía por `GET /api/empresas`
- **Dónde:** `src/server/routes/empresas.ts:31` (CRUD genérico sin `omit`).
- **Explotación:** cualquier admin (de su empresa) o superadmin pedía `GET /api/empresas` o `/:id` y recibía `whatsapp_token`, la credencial de su instancia de Evolution. Cualquier XSS, sesión robada o log de respuesta lo amplificaba. `docs/SEGURIDAD.md` afirmaba que «nunca se devuelve».
- **Confirmación:** `tests/seguridad-whatsapp-token.test.ts` (GET lista, GET por id y PUT; admin y superadmin). Rojo: 0/2; verde con el arreglo; rojo otra vez al revertir.
- **Arreglo:** `omit: { whatsapp_token: true }` (commit `7fe0691`). No cambia el contrato: ningún cliente usa ese campo.

### M-2 · Media · La administradora anterior podía subir/reemplazar comprobantes de un condominio que ya no administra
- **Dónde:** `src/server/routes/comprobantes.ts:62` (`cargarPago` usaba el alcance de LECTURA `scopePagos`).
- **Explotación:** tras `cambiarAdministradora`, la empresa A conserva lectura de los recibos que emitió (por diseño). Un admin de A hacía `POST /api/pagos/:id/comprobante` sobre un pago `por_validar` del condominio, ahora de B: reemplazaba la evidencia (201) y disparaba `iniciarEvaluacion`, que con `validacion_automatica_ia` activa podía autovalidar el pago. Viola la regla «la anterior sólo consulta».
- **Confirmación:** `tests/seguridad-comprobante-escritura.test.ts` (A recibe 201 antes; 404 después; B vigente sigue pudiendo; el original queda intacto).
- **Arreglo:** el admin sube con `scopePagosEscritura`; el residente conserva su alcance (commit `508afbd`). Ver el comprobante sigue con lectura.

### M-3 · Media · Editar a un residente soltaba unidades de OTRA administradora
- **Dónde:** `src/server/routes/usuarios.ts:191-212` (`update` del CRUD de usuarios).
- **Explotación:** un propietario con un departamento en A y otro en B es alcanzable por el admin de A. `PUT /api/usuarios/:id {unidad_id}` (o cambiar propietario↔inquilino) ejecutaba `updateMany`/`findMany` por `[campo]: id` sin alcance: el admin de A dejaba sin propietario (o reasignaba) la unidad de B. El residente perdía el acceso a su departamento de B (cargos, pagos).
- **Confirmación:** `tests/seguridad-unidad-residente.test.ts` (2 casos: `unidad_id` y cambio de rol). Rojo antes; verde después; rojo al revertir.
- **Arreglo:** esas consultas llevan `scopeUnidades(user)` (commit `36befae`). Lo que A suelta de SU condominio no cambia.

## Hallazgos Bajos / informativos (sólo reporte)
- **B-1 · Baja · `xlsx@0.18.5` con 2 avisos altos** (`npm audit --omit=dev`: prototype pollution GHSA-4r6h-8v6p-xvw6 y ReDoS GHSA-5pgg-2g8v-p4x9; «no fix available» en npm, el parche sólo está en el CDN de SheetJS). Se usa únicamente en `POST /api/recibos/excel` (admin, 10 MB). **Sin confirmar:** un intento de contaminar `Object.prototype` vía `Custprops` con `__proto__` no funcionó. Requiere decisión de Miguel (migrar a `exceljs`/el paquete del CDN); no se cambió dependencia.
- **B-2 · Baja · Multer corre antes de `requireRole`** en `src/server/routes/recibos.ts:322`: un residente autenticado puede hacer que el servidor bufferice hasta 10 MB antes de recibir el 403. Mitigado por el límite de 300 req/15 min por IP. Arreglo trivial (poner `requireRole('admin')` antes de `upload.single`); no es Alto/Medio, queda reportado.
- **B-3 · Baja · `routes/whatsapp.ts:65,82,…` devuelve al admin el `message` de la Evolution API** (`Error al crear la instancia…: ${mensaje}`). Es texto del proveedor, no del cliente; puede revelar detalles internos al admin. Sin timeout en `fetch` (un Evolution colgado deja la petición abierta). **✅ Resuelto** (rama `fix/seguridad-bajos`): `routes/whatsapp.ts` usa `AbortSignal.timeout(10 s)` y responde 504/502 con mensaje corto; el texto del proveedor sólo va al log. Test: `tests/whatsapp.test.ts` («fallos de la Evolution API»).
- **B-4 · Baja · Fuerza bruta distribuida:** el límite de login es por `IP|correo` (10/15 min). Muchas IPs contra un mismo correo no se frenan por cuenta; sólo por el tope general de 300/15 min por IP. No hay bloqueo por cuenta. **✅ Resuelto**: `BloqueoCuenta` (10 fallos/15 min por correo desde cualquier IP → 429 igual que el límite actual). Test: `tests/seguridad-login.test.ts`.
- **B-5 · Informativa · Política de contraseñas:** sólo longitud 8–72, sin lista de contraseñas comunes ni complejidad. **✅ Resuelto**: `passwordSchema` exige letra+número, rechaza una lista de contraseñas comunes y la igual al correo (sólo al crear/cambiar; el login no cambia). Test: `tests/seguridad-contrasenas.test.ts`.
- **B-6 · Informativa · `login_fallido` guarda el correo escrito** en `Auditoria.detalle` (`routes/auth.ts:58`): si alguien teclea su contraseña en el campo de correo queda en la auditoría (sólo la ve el superadmin). Valorar no guardarlo cuando no coincide con ningún usuario. **✅ Resuelto**: `login_fallido` guarda el `usuario_id` si la cuenta existe y el correo enmascarado (`m***@dominio`) si no. Test: `tests/seguridad-login.test.ts`.
- **B-7 · Informativa · Un residente con unidades en dos administradoras** es editable por ambas (p. ej. su contraseña, vía `PUT /api/usuarios/:id`). Consecuencia del modelo «residente sin empresa»; requiere decisión de producto.

## Revisado SIN hallazgos
- **Multi-tenant:** todas las rutas de `src/server/routes/` y el CRUD genérico (`crud.ts`): `scope` en lectura, `writeScope` en escritura, ids anidados validados con `assertRef` (`unidad_id`, `estructura_id`, `complejo_id`, `piso_id`, `propietario_id`, `inquilino_id`, `usuario_id`, `asignado_id`, `proveedor_id`, `concepto_id`, `recibo_id`…). Estructuras (alta, edición, borrado protegido, `asignar-unidades`), pisos, unidades, complejos (el cambio de administradora es sólo superadmin), proveedores (`complejo_ids` validados), tareas, conceptos, recibos y Excel, cargos, recibo-conceptos, pagos, comprobantes (lectura), validación y evaluación, medios de pago (ámbito de la junta, QR), notificaciones, dashboard, reportes, `me`.
- **Roles / mass assignment:** los esquemas zod descartan campos no declarados (`password_hash`, `rol` en `/api/me`, `empresa_id` forzado para admin y nulo para residentes); un admin no crea superadmins ni cambia su propio rol; cargo de junta sólo por admin/superadmin y revoca sesiones; la junta no escala (`ambitoJunta`, `puedeGestionar`); `requireRole` presente en todas las escrituras.
- **Sesión:** cookie `HttpOnly; SameSite=Lax; Secure` en producción, token opaco con sha256 en base, CSRF en tiempo constante + `Origin`, revocación al cambiar rol/contraseña, login sin enumeración (hash de relleno), límites de tasa.
- **Inyección:** el único SQL crudo es `$queryRaw` con parámetros (`recibos.ts` totales y `contratos.ts` `FOR UPDATE`); ningún `$queryRawUnsafe` ni filtros armados con input; los `fetch` salientes usan URLs constantes (proveedores de IA, Resend) o la variable del operador (`EVOLUTION_URL`); sin lectura de rutas del sistema con input (`path.join` sólo para `dist/` y el prompt fijo).
- **Asistente y MCP:** herramientas de sólo lectura con zod estricto, rol revalidado en cada ejecución, `depurar` de campos prohibidos, todas las consultas con `lib/scope.ts`/`junta.ts` (revisadas una a una en `tools/gestion.ts`); token MCP con hash, huella (rol+contraseña), `Origin` rechazado, Bearer sólo en `/mcp`.
- **Fuga de datos:** `password_hash` omitido globalmente; `api_key_enc` fuera de todo `select`; el error handler devuelve mensajes cortos; la auditoría redacta campos sensibles e ignora cuerpos binarios. (Única excepción: M-1.)
- **Frontend:** sin `dangerouslySetInnerHTML`, `innerHTML`, `eval`; el Markdown del asistente usa `clasificarEnlace` (sólo rutas internas y `https`); CSRF sólo en memoria, sin secretos en el bundle (`VITE_API_URL` es una URL pública).
- **Dependencias:** `npm audit --omit=dev` → sólo `xlsx` (B-1).

## No se pudo revisar
- Producción real, Coolify, cabeceras y TLS del proxy delante de la app (`trust proxy 1` asume un único proxy de confianza).
- Contenido real de `.env` y secretos del despliegue; rotación de `LLAVERO_ENC_KEY`.
- Comportamiento de los modelos de IA reales frente a prompt injection (sólo hay pruebas con `fetch` falso, ver `docs/SEGURIDAD.md`).
- Explotación real de `xlsx` con archivos maliciosos más allá del intento descrito en B-1.
- Revisión línea a línea de `services/asistente/turno.ts`, `motor.ts`, `evaluacion.ts` y `lib/lecturaComprobante.ts` (sólo se leyó su superficie: URLs, validación de salida, alcance del contexto) y de las páginas de React fuera de las búsquedas por patrón.
- Pruebas con navegador (XSS por render real, bloqueo de CSP).
