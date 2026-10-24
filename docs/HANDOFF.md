# HANDOFF — house

Registro entre agentes de código (Claude Code, OpenCode, Cline…). Una entrada por sesión significativa, la más reciente arriba. Actualiza secciones; no reescribas la historia ajena.

---

## 2026-10-24 — Claude Code (Sonnet 5.5) — `feat/personas`: separar Residentes, Personal y Proveedores; contrato de administración del condominio

**Pedido de Miguel:** los usuarios no tienen empresa; es el condominio el que tiene una empresa de mantenimiento. Hay personal asociado a la empresa (seguridad, limpieza, jardines), una zona de proveedores (ascensores, gasfitería, pintura…), y residentes asociados a condominios/edificios. Todo estaba mezclado en la misma pantalla: separar y corregir. **Contrato: `docs/API-CONTRATO.md`, `docs/SEGURIDAD.md`, `DESIGN.md`, `AGENTS.md`.**

**Qué se hizo (commits pequeños, SIN push)**
- **Esquema ADITIVO:** `ContratoAdministracion` (un solo vigente por condominio, `fecha_fin` null), `Proveedor` (sólo ficha, no inicia sesión), `ProveedorComplejo`, `TareaMantenimiento.proveedor_id` (nullable, SetNull, no ambos con `asignado_id`). Roles nuevos `limpieza` y `jardineria` en `ROLES`, `ROLES_PERSONAL`, `ROLES_OPERATIVOS` y `ROL_LABEL`.
- **Contratos:** `cambiarAdministradora` cierra el vigente, abre el nuevo, mueve `complejo.empresa_id` + `unidad.empresa_id`, libera personal de la empresa anterior (complejo_id=null) y revoca sus sesiones, todo en transacción con `FOR UPDATE`. `crearContratosIniciales` (idempotente, `--simular`; script `scripts/contratos-iniciales.ts` para producción, no ejecutado). Recibos guardan su `empresa_id` (la anterior los consulta; la nueva cobra la deuda pendiente).
- **Alcance (`lib/scope.ts`):** `scopeUsuarios` separa personal (por empresa) y residentes (por condominio/unidades, sin empresa); `scopeTareas` para mantenimiento/limpieza/jardineria = solo sus tareas; `scopeProveedores` = solo de su empresa. Limpieza/jardineria: sin cobranza (403), solo sus tareas y unidades.
- **Rutas:** `/api/usuarios` con `?tipo=residente|personal|superadmin`, `?estado=moroso|al_dia`, `?complejo_id=`, `?estructura_id=`; `/api/complejos/:id/contratos` (historial), `POST /api/complejos/:id/administradora` (solo superadmin); `/api/proveedores` CRUD con zod, filtros `rubro|activo|complejo_id`, 404 ajenos; `/api/tareas` con `proveedor_id`, exclusividad con `asignado_id`.
- **Tests:** `tests/personas.test.ts` (32 pruebas: contratos vigente/único/cambio atómico/historial/qué ve cada empresa, roles limpieza/jardineria sin cobranza, proveedores CRUD/404/asignar a tarea, residentes y personal listados separados). Suite completa: 635/635 verde.
- **Frontend:** menú «Personas» con Residentes/Personal/Proveedores; rutas nuevas; Condominios con contrato vigente + historial + «Cambiar de administradora» (superadmin); Superadmin Usuarios con pestañas; Login con cuenta Limpieza; nav y roles nuevos (limpieza, jardinería con menú «Mis tareas`).

**Verificación (números reales)**
- `npm test` **635/635** (base `house_test_personas`); `npx tsc -b` y `npm run build` limpios; `npx tsc --noEmit` limpio.
- Prueba del prompt del asistente: se corrigió `/admin/usuarios` → `/admin/residentes` en `src/config/ai-system-prompt.txt`.

**NO verificado (honesto)**
- Navegador real (Playwright): no se probó en este worktree. Falta verificar como `ana.lopez@gestionurbana.com` (Personas, Condominios, Mantenimiento con proveedor), como superadmin (cambiar de administradora) y como `limpieza@prueba.house`.
- Seed `prisma/seed-libertadores.ts` actualizado (contratos vigente+anterior, limpieza@prueba.house / jardineria@prueba.house / pers1234, 10 proveedores, tareas a proveedores) pero **no se ejecutó contra la base `house`** (solo cambios de código).
- Producción (Coolify): `scripts/contratos-iniciales.ts` no se ejecutó; `prisma db push` con las tablas nuevas no se aplicó allí.
- El cliente de Prisma generado vive en el `node_modules` compartido del repo principal (symlink): se regeneró con las tablas nuevas (aditivo; otras sesiones siguen funcionando).

**Próximos pasos**
1. Ejecutar el seed actualizado contra `house` para verificar que no rompe nada.
2. Verificación en navegador (Playwright) con las cuentas de prueba.
3. Commits pendientes: los archivos de frontend están sin commitear (ver `git status`).
4. Push sólo con OK de Miguel.

---

**Pedido de Miguel:** un solo recibo por departamento con todos los conceptos, agrupado por block (salvo condominios sin blocks o con uno), pagos «a los recibos, no por conceptos»; la empresa no es dato del residente. **Contrato: `docs/API-CONTRATO.md` (sección «Mantenimiento…»), `SEGURIDAD.md`, `DESIGN.md`.**

**Qué se hizo (commits pequeños, SIN push)**
- **Esquema ADITIVO:** `Pago.grupo String?` (índice) y `Pago.grupo_principal Boolean @default(false)`. Sin migraciones; `prisma db push` sin pérdida.
- **Mantenimiento = (recibo, unidad)**, derivado (`lib/mantenimientos.ts`: cuentas puras, estado, número `2026-10-B01-804`, consultas agregadas en SQL, resumen por block). Pagar = un `Pago` por cargo con el saldo (calculado por el servidor), mismo `grupo`; el principal lleva el comprobante y la evaluación IA (compara contra el TOTAL del grupo). Validar/rechazar/IA actúan sobre el grupo en una transacción. Pagos sueltos antiguos siguen igual.
- **Backend:** `me.ts` (`/me/mantenimientos…`), `recibos.ts` (`/:id/blocks`, `/:id/mantenimientos…`, registrar pago), `pagos.ts` (una fila por mantenimiento, editar/borrar por grupo), `comprobantes.ts` (redirige al principal), `validacionPago.ts`, `evaluacion.ts`, dashboard residente, morosidad por block, `complejos` con `unidades_count`/`blocks_count`.
- **Empresa:** residentes siempre `empresa_id = null` (crear/cambiar rol/editar); `scopeUsuarios` alcanza por unidad y por condominio; lista de usuarios muestra la(s) empresa(s) derivada(s); un admin que crea un residente debe indicar condominio (si no quedaría inalcanzable). **Script para producción (NO ejecutado; lo corre el orquestador):** `npx tsx scripts/limpiar-empresa-residentes.ts --simular` y luego sin `--simular` (idempotente, imprime cuántos).
- **Frontend:** residente (Mis recibos por mantenimiento, detalle por concepto, Pagar mantenimiento, Ver/Imprimir «Recibo de mantenimiento», Inicio coherente, Mis pagos); admin (`/admin/recibos/:id` agrupado por block con lista paginada y detalle, registrar pago del mantenimiento, parcial por concepto como «opciones avanzadas», Pagos con una fila por mantenimiento sin scroll a 1280, Usuarios con empresa sólo para personal + condominio para residentes, Morosidad con filtro de block). Asistente: `mis_recibos` y `recibos` hablan del mantenimiento, prompt actualizado.
- **Seed Libertadores:** pagos agrupados (4 772 grupos) + 1 135 pagos sueltos antiguos (unidades `idx % 29 === 0`, meses pasados), un comprobante por grupo en octubre (29 por validar); residentes sin empresa. Totales y morosidad idénticos al seed anterior (verificado corriendo ambos: emitido S/ 1 200 468.79, cobrado S/ 1 073 340.98, 179 unidades con cargos vencidos).

**Bugs reales hallados en el navegador (corregidos)**
1. **CSP bloqueaba los comprobantes/QR** en la app servida por Express (`img-src 'self' data:` sin `blob:`): ahora `img-src 'self' data: blob:` (test en `seguridad.test.ts`). Afectaba también a producción antes de esta rama.
2. **`PagarModal`: «Ya pagué: registrar comprobante» enviaba el pago solo** (React reutilizaba el botón y su `type` pasaba a `submit` durante el clic → pago sin comprobante). Ahora los botones llevan `key` distinta. (Existía antes de esta rama.)
3. Dos diálogos seguidos: el `close` del `<dialog>` del primero cerraba todo; se ignora mientras se cambia.

**Verificación (números reales)**
- `npm test` **601/601** (base `house_test_recibos`; eran 555 al empezar: `mantenimientos.test.ts` 36, `empresa-personal.test.ts` 8, herramientas +2, negocio/seguridad ampliados). `tsc -b`, `tsc -p tests/tsconfig.json --noEmit` y `npm run build` limpios.
- **Mutaciones en rojo (16):** cada cambio clave revertido hace fallar su prueba (cierre por grupo, IA contra el total, comprobante al principal, reparto por saldo, fila por mantenimiento, empresa null, alcance por condominio/unidad, conteo de unidades, orden natural de blocks, CSP, dashboard, herramienta, ruta del asistente, filtro de block en morosidad, editar por grupo).
- **Navegador (Playwright, mi propio backend en :4100 con un Postgres aparte en :5434; no toqué el de otra sesión):** `miguel@prueba.house` (Inicio, Mis recibos con 4 pestañas, detalle, Ver/Imprimir con PDF de impresión, pagar con comprobante → «En revisión», Mis pagos, Pagos por validar de la junta con el pago nuevo, 375 px sin scroll horizontal) y `ana.lopez@gestionurbana.com` (Recibos → periodo → 14 blocks → Block 1 → departamento → detalle; registrar pago de un vencido → pagado; Pagos sin scroll a 1280 y modal de revisión con la imagen; Registrar pago; Usuarios: el formulario de seguridad pide empresa/no condominio, el de propietario pide condominio y no empresa; Condominios muestra 448; Morosidad por block). Sin errores de consola.

**NO verificado (honesto)**
- Lectura real de la IA sobre un comprobante de grupo (sólo `fetch` falso; con proveedor real no se probó). Evaluación en el navegador quedó en «No disponible» (sin claves).
- Producción (Coolify): `prisma db push` con las 2 columnas nuevas y el script de limpieza no se ejecutaron allí. Rendimiento con volumen mayor al de 448 unidades.
- Modo oscuro y lectores de pantalla de las pantallas nuevas; la hoja de impresión sólo se revisó generando el PDF, no en una impresora.
- Junta que NO es admin registrando pagos a mano: no se añadió (sigue siendo del admin; la junta valida/rechaza).

**Decisiones / gotchas**
- `estado` de listas admite varios valores (`?estado=pendiente,parcial,vencido`). «Por pagar» del residente incluye vencidos.
- Un admin ve a un residente sólo por `complejo_id` o por sus unidades; por eso crear un residente exige condominio.
- El cliente de Prisma generado vive en el `node_modules` compartido del repo principal: se regeneró con las 2 columnas nuevas (aditivo; otras sesiones siguen funcionando).
- Para ver la app compilada desde un worktree hay que servir una copia de `dist/` con otro cwd (dotfiles en `.claude/…`).
- Quedan corriendo/creados por esta sesión: contenedor `house-pg-recibos` (puerto 5434, base `house` sembrada) y la base `house_test_recibos`; se pueden borrar (`docker rm -f house-pg-recibos`).

**Próximos pasos:** revisar el diff, correr el script de limpieza en prod tras el deploy, probar la IA real con un comprobante de grupo y decidir si la junta debe poder registrar pagos manuales de mantenimiento.

---

## 2026-10-24 — Claude Code (Sonnet 5.5) — `feat/seed-libertadores`: datos de prueba del Condominio Los Libertadores de Surco

**Qué se hizo:** `prisma/seed-libertadores.ts` + `npm run seed:libertadores` (el `seed.ts` original no se tocó). Sólo corre contra `localhost` y la base `house`; borra y recrea todo (incluye medios de pago, avisos, comprobantes, evaluaciones, IA, tokens y sesiones; conserva `ClaveIntegracion`, `ModeloIA`, `SyncModelosIA`, `EstadoIA`). Determinista (PRNG con semilla), ~45 s.
- Empresa «Gestión Urbana SAC»; complejo tipo `condominio`; 14 `Estructura` tipo `block` («Block N»), 8 pisos, 4 dptos: 448 unidades con código `B01-804` (block, piso+dpto 101…804). 438 propietarios (10 con 2 unidades), 67 inquilinos (~15 %), presidente y tesorero por block (28), 7 medios de pago (BCP del condominio + Yape/Plin del tesorero en algunos blocks, algunos con QR PNG generado), 8 tareas, 684 avisos.
- Miguel: `miguel@prueba.house` / `prop1234`, dueño de `B01-804`, presidente del Block 1. Cuentas del Login intactas (Javier Castro → `B03-502`, Valentina Ruiz inquilina de `B05-301` con su mes en revisión).
- 12 recibos (emisión día 1, vence el 15) con 7 conceptos ordinarios por unidad, Mora y 2 extraordinarios (ascensor Block 7 en mar-2026, S/ 60 sólo a ese block; bomba de agua en ago-2026, S/ 40 a todos). Total ordinario por unidad y mes: S/ 201–231 (media ≈ 215; sin mora ni extraordinarios, verificado por SQL). Con el extraordinario del Block 7 llega a S/ 288.
- **Mora:** 10 % del total ordinario del mes anterior de esa unidad, sólo a quien pagó ese mes pasado el vencimiento o aún lo debe; va en el recibo del mes siguiente (`es_recargo`).
- Un `Pago` por cargo (así lo espera `sincronizarCargo`); todos los cargos de una unidad-mes comparten método y referencia. Métodos del enum real (`transferencia`, `yape`, `plin`, `efectivo`, `tarjeta`; no existe «depósito»). 276 pagos `por_validar` con comprobante PNG (octubre), rechazados con motivo y validados por la junta del block o por Ana.
- Resultado: emitido S/ 1 189 814, cobrado (validado) S/ 1 118 456, por cobrar S/ 71 358, 156 unidades con cargos vencidos (24 con deuda de meses anteriores, 1–12 meses).

**Para tener en cuenta (gotchas):**
- Hoy es 24-oct y el recibo de octubre vence el 15: según `cargos.ts` los impagos de octubre salen **vencidos**, no «pendientes» (el dashboard muestra `pendiente: 0`). Miguel debe 7 cargos (S/ 213.78) vencidos.
- Meses pasados: ~89 % a tiempo, ~8 % tarde, sólo ~2.4 % sin pagar (el brief pedía ~7 %: con ~25 morosos y deudas de 1–6 meses no sale más). La morosidad lista 156 unidades porque octubre cuenta.
- El seed destruye lo que haya en `house` (otras sesiones que usen esa base verán los datos nuevos; sus sesiones/JWT dejan de valer).
- Prueba rápida: `DATABASE_URL=…/house npm run seed:libertadores` (o con `.env`; `dotenv` se carga solo).

**Verificado:** conteos y rangos por SQL; API local (puerto 4100) como Miguel (dashboard, `/me/unidades`, `/me/cargos` 86 cargos, `/me/pagos` 79, `/pagos?estado_validacion=por_validar` 7, medios de pago del block) y como Ana (dashboard, morosidad 156, recibos, unidades, avisos 684, tareas 8; respuestas de paginación < 40 ms); `tsc -b`, `tsc -p tests` y `npm test` (0 fallos, base `house_test_seed`).
**NO verificado:** nada en el navegador (no hay automatización de navegador en la sesión): Inicio, Mis recibos, Mis pagos, Pagos por validar, Morosidad y dashboard sólo se comprobaron por la API; la lectura de comprobantes por IA y los avisos reales (el seed deja los avisos ya «enviada»/«error»/«pendiente» sin enviar nada).

---

## 2026-10-24 — Claude Code (Opus 5.5) — `main`: el asistente ya no se queda sin IA por una ruta colgada

**Qué se hizo:** en producción el asistente respondía en contingencia con 4 claves sanas. Causa medida en el contenedor: `gemini-flash-latest` no responde (> 40 s, simple, stream y con herramientas) mientras `gemini-flash-lite-latest` contesta en ~3 s y Groq en < 0,4 s; con una espera de 30 s por intento dentro de un tope de 25 s por turno, el primer intento se comía todo el turno. Cambios (`motor.ts`, `lib/modelosMalos.ts`, `modelos/seleccion.ts`, `lib/modelosIA.ts`):
- espera por intento 12 s (`LLAVERO_ESPERA_MS`, 2 000–60 000) y tope por turno 45 s;
- modelo que agota la espera → «lento» 15 min en todo su proveedor: pasa al FINAL de la fila (no se veta), se prueba el otro modelo de la misma clave y la clave sólo se enfría si no le queda otro;
- Auto nunca pone primero modelos débiles (`esDebil`: allam, <= 4B; Groq elegía `allam-2-7b`); `gemini-flash-lite-latest` es el segundo preferido de Gemini;
- `probada_at` usa el reloj inyectado (el test de recuperación fallaba el día en que la fecha real coincidía con la del test).
- Verificado en producción con las claves reales: 1ª consulta 14 s (flash-latest colgado → flash-lite), 2ª 2,9 s usando la herramienta `empresas`. Suite 553/553; mutaciones en rojo (marca de lento, filtro de débiles).

**Pendiente:** cada 15 min la primera consulta vuelve a probar `gemini-flash-latest` y paga 12 s si sigue colgado; si Google no lo arregla, conviene bajarlo en la preferencia o que el canary marque lentos.

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/herramientas`: herramientas de solo lectura (asistente + MCP)

**Pedido de Miguel:** «Quiero que el asistente de IA pueda responder sobre toda la BD. Son tools, y después las puedo usar con mi MCP.» Se retomó trabajo parcial de una sesión interrumpida (catálogo en `src/server/tools/` sin tests): se revisó, se probó y se completó. **Doc completa: `docs/HERRAMIENTAS.md`.**

**Qué se hizo**
- **Catálogo de 22 herramientas** (`src/server/tools/`: `base.ts`, `gestion.ts` ×14, `residente.ts` ×5, `superadmin.ts` ×3, `index.ts`). `ejecutarHerramienta` es el ÚNICO camino de ejecución (asistente y MCP): revalida el rol en cada llamada, zod estricto, `depurar` (campos/correos prohibidos), `acotar` (tamaño, con cursor coherente) y auditoría (`entidad: herramienta`, origen `asistente`|`mcp`).
- **Asistente** (`services/asistente/herramientas.ts`, `respaldo.ts`, `lib/modelosSinHerramientas.ts`; cambios mínimos en `proveedor.ts`, `motor.ts`, `turno.ts`, `conversaciones.ts` y UNA línea en `routes/aiChat.ts`): bucle de ≤ 4 rondas / 6 consultas / 20 s, Gemini y OpenAI-compatible, respaldo determinista (DATOS VERIFICADOS) y memoria negativa por ruta, contingencia con datos. Evento SSE nuevo **`herramienta`** `{nombre, estado}` (solo se emite; `src/app/asistente/*` no se tocó). Prompt actualizado.
- **MCP**: `POST /mcp` (`routes/mcp.ts`, JSON-RPC propio, sin dependencias nuevas), tokens de API personales (`services/tokensApi.ts`, `routes/tokensApi.ts` en `/api/me/tokens-api`), pantalla «Tokens de API» en Mi perfil (`pages/shared/_parts/TokensApi.tsx`).
- **Esquema ADITIVO**: modelo `TokenApi` (+ relación en `Usuario`) y `MensajeIA.herramientas Json?`. `prisma db push` sin pérdida.
- Docs: `HERRAMIENTAS.md` (nuevo), `SEGURIDAD.md`, `API-CONTRATO.md`, `.env.example` (`ASISTENTE_HERRAMIENTAS`, `ASISTENTE_HERRAMIENTAS_MS`).

**Verificación (números reales)**: `npm test` **522/522** (base `house_test_herramientas`; eran 421 antes de la rama), `tsc -b`, `tsc -p tests/tsconfig.json`, `npm run build` limpios. Pruebas nuevas: `herramientas.test.ts` (43: matriz de alcance por herramienta y rol con dos empresas, junta por block, residentes, campos prohibidos, límites/cursor, zod estricto, texto hostil, auditoría), `asistente-herramientas.test.ts` (24: Gemini y compatible simulados, 1 y varias rondas, tope de rondas/consultas/tiempo, herramienta inventada o de otro rol, rutas sin herramientas, streaming, contingencia, enrutador), `mcp.test.ts` (21: protocolo, tokens, 401 por vencido/revocado/desactivado/contraseña/rol, Bearer fuera de `/mcp`, cookie en `/mcp`, Origin, tasa, auditoría). **Mutaciones** (copia en scratchpad + `cp`): sin filtro de alcance en `morosos`, sin filtro de junta, sin filtro de residente, sin validación de rol en `ejecutarHerramienta`, sin tope de 50 (zod y `pagina()`), sin comparación del hash, sin huella, sin filtro Origin, respaldo sin filtrar por rol, sin `depurar`, sin tope de 6 consultas → **todas ponen tests en rojo**.
- **Navegador local** (Playwright sobre la app compilada + un Gemini FALSO inyectado con `llaveroDeps.fetch`, BD `house_dev_herramientas` con el seed): crear token (error sin nombre, token mostrado una vez, Copiar → portapapeles == token, no queda en el DOM ni tras recargar), revocar (`/mcp` pasa de 200 a 401), Enter/Esc/foco, 375 px sin scroll horizontal; mantenimiento NO ve la sección; el panel del asistente muestra la respuesta tras la herramienta (ignora el evento). `curl` real a `/mcp`: `tools/list` (admin 14, residente 5, tesorero 17 tras recibir el cargo con el MISMO token), `tools/call morosos` (admin Ana: solo su empresa; tesorero: solo su block), Bearer en `/api/*` → 401, cookie en `/mcp` → 401, `Origin` → 403, herramienta de otro rol → `-32602`, `limite: 500` → `isError`, 50 filas + cursor.
- **Bug hallado con datos reales (y corregido, con test):** `mi_deuda` de alguien con 700+ cargos devolvía un resultado enorme y `acotar` lo reemplazaba por «demasiado grande» perdiendo el total; ahora topa `por_unidad` a 50 (`unidades_con_deuda` da el conteo) y `acotar` recorta cualquier lista conservando los totales y deja el cursor en lo entregado.

**NO verificado (honesto)**
- **Modelos reales** que soporten herramientas (Gemini, Groq, OpenRouter…): solo `fetch` falso con los formatos documentados; el comportamiento real (qué tan bien eligen la herramienta, si respetan «no muestres lo que no devolvió», 400 reales de «tools no soportadas», `thoughtSignature` de Gemini 3) queda por probar con claves reales. El regex de rutas sin herramientas (`modelosSinHerramientas.ts`) y el de errores («tool», «function calling») son heurísticos.
- **Clientes MCP reales** (Claude Desktop/Code, MCP de My Workspace): solo `curl` y el protocolo probado a mano; las claves exactas de configuración de cada cliente en `HERRAMIENTAS.md` son orientativas. No hay SSE/sesiones (spec 2025-06-18 lo permite).
- Producción (Coolify, `https://house.gargurevich.dev/mcp` detrás de Traefik: confirmar que no pise la cabecera `Authorization` ni añada `Origin`), rendimiento con volumen muy alto, varias réplicas (memoria negativa y límite por token son por proceso).

**Decisiones**
- `huella` del token = sha256(rol + hash de contraseña): rol/contraseña/desactivación invalidan; el ALCANCE (empresa, cargo de junta, block) se relee en cada llamada y el token lo hereda tal cual (la lista de herramientas cambia en vivo).
- Un 400 «tools no soportadas» marca la ruta y esa MISMA consulta se contesta con el respaldo (la persona siempre recibe respuesta); la ruta pasa al final del orden dentro de su clave. NO se rota a otra clave/proveedor «que sí» antes de responder (habría que reordenar la cadena del motor; queda como mejora). Un 400 genérico (sin hablar de herramientas) sigue la rotación de siempre.
- Con herramientas, el texto final llega por el mismo SSE (token a token si el modelo ya empezó a escribir; de golpe tras rondas con `functionCall` sin texto).
- Gestión: la junta NO tiene `tareas_de_mantenimiento` ni `avisos_recientes`; secretario y vocal solo las de residente; mantenimiento y seguridad ninguna.

**Gotchas**
- `GET /` de la app compilada falla («Petición inválida») si el repo vive bajo una carpeta con punto (`.claude/worktrees/…`): `res.sendFile` rechaza rutas con dotfiles. Para verificar en navegador se sirvió una copia de `dist/` fuera de ese árbol (cwd distinto). No pasa en producción.
- El esquema JSON de las herramientas sale de `z.toJSONSchema` (zod 4); para Gemini se pasa por `esquemaParaGemini` (sin `additionalProperties`, `pattern`, uniones).
- `tests/helpers/ia.ts` ganó `pideHerramientas`, `resultadosDe`, `fuerzaTexto`, `flujoSoloLlamada`, `flujoTextoYLlamada`.
- Pendiente de MERGE: la otra sesión (`feat/asistente-mensajes`) toca `routes/aiChat.ts` y `src/app/asistente/*`; aquí hay UNA línea en `aiChat.ts` (evento `herramienta` en el SSE) y `conversaciones.ts` (+2 líneas para `herramientas`).

**Próximos pasos:** probar con claves reales (Gemini y un compatible) y ajustar descripciones/prompt según cómo elijan herramientas; mostrar «Consultando…» en el panel con el evento `herramienta` (la otra sesión); registrar el servidor en el MCP de My Workspace; valorar reordenar la cadena del motor para preferir rutas con herramientas.

---

## 2026-10-23 — Claude Code (Sonnet 5.5) — orquestación en `main`: integración de asistente, inline y proveedores

**Qué se hizo:** integré `feat/evaluacion-ia`, `feat/asistente` y `feat/asistente-inline`; agregué siete proveedores al catálogo del llavero (Cerebras, SambaNova, NVIDIA, Cohere, Ollama Cloud, LLM7, Kilo; los modelos por defecto de Ollama, LLM7 y Kilo son estimados y el catálogo vivo debe corregirlos al sincronizar); las tarjetas de cifras (`StatStrip`) y los dashboards se adaptan al ancho real con rejillas `auto-fit`.
- **Fix:** `src/server/lib/modelosIA.ts` — los clasificadores de seguridad (`safeguard`, `guardrail`) ya no cuentan como modelos de chat (caso real: `openai/gpt-oss-safeguard-20b` elegible y fallando). Test nuevo: `tests/modelos-chat.test.ts` (mutación verificada: falla sin el cambio). El sync reclasifica en cada pasada, así que desaparece de las listas al sincronizar.
- Suite completa: 421/421 con base de pruebas propia.

**Próximos pasos:** integrar `feat/menu-compacto` y `feat/asistente-mensajes` (en curso), revisar otras pantallas apretadas entre 1024 y 1279 px con el asistente abierto, probar con keys reales en el Llavero.

**Gotchas:** el ancho del asistente no se reajusta al agrandar la ventana hasta recargar; en dev, reiniciar el backend tras un merge (tsx no recarga solo).

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/menu-compacto`

**Qué se hizo:** menú lateral con modo compacto (riel de iconos de 64 px), como el Portal de Dealers. Pedido de Miguel: «que el menú tenga su modo compacto». **Sólo frontend.**
- `src/app/barra.ts` (lógica pura: `anchoBarra`, lectura/escritura segura del estado, `esAtajoMenu`), `useBarra.ts` (hook), `Pista.tsx` (tooltip con mouse y foco), `Shell.tsx` (la marca de la cabecera alterna; riel con iconos, separadores finos, pie con avatar; `--barra` mueve aside y contenido).
- Atajo `[` o Ctrl/Cmd+B (no en inputs/textarea/select/contenteditable). Estado global `house:menu:colapsado`. Móvil: cajón con textos siempre.
- El asistente acoplado lee el ancho real de la barra: `acotarAncho(px, viewport, barra)` y `useAnchoPanel(usuarioId, barra)` (guarda el ancho pedido y lo acota al mostrarlo: al expandir el menú el panel se achica sin perder el elegido).
- Pruebas: `tests/barra-menu.test.ts`. Suite completa 432/432 contra `house_test_menu`; `tsc -b`, `tsc -p tests` y `npm run build` limpios.
- Verificado en Chrome (Playwright, vite propio en :5199): 1440 y 1024, claro y oscuro, riel/expandida, asistente abierto/cerrado (sin solapes; a 1024 con menú expandido el panel baja a 320 px), recarga mantiene riel, Tab muestra tooltip, `[` y Ctrl+B alternan, `[` en el textarea del asistente no, móvil 390 con cajón con textos.
- **No verificado:** `prefers-reduced-motion` (sólo la regla global existente), lector de pantalla real, Safari/Firefox, rol distinto de superadmin (propietario/junta), arrastre del asistente con el riel, ausencia total de localStorage en navegador (cubierta sólo por prueba unitaria), parpadeo de carga medido a ojo, 390 px sólo comprobado por texto (hay captura sin revisar).

**Decisiones / gotchas:** los ítems llevan `aria-label` + tooltip propio en vez de `title` nativo (el `title` no sale con foco de teclado y duplicaría el tooltip). El botón de la marca expandido conserva `title` con el atajo. Estado global, no por usuario. El :5173 de `dev:all` corre desde el checkout principal, no desde este worktree.
**Próximos pasos:** revisar el diff, integrar con cherry-pick; push sólo con OK de Miguel.

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/asistente-mensajes`

**Qué se hizo:** acciones sobre los mensajes del asistente (paridad con el chat de My Workspace). Pedido de Miguel: «No tengo cómo copiar contenido ni regresar a un mensaje, así como lo hago en MW. Revisa qué más falta.» Referencia (sólo lectura): `MessageActions.tsx`, `reescribirMensaje.ts`, `useSeleccionDeMensajes.ts` de dashboardia-llm. No se tocaron `Shell.tsx`, `nav.ts`, `panel.ts` ni `useDock.ts`.
- **Copiar** en TODOS los mensajes (`Mensajes.tsx`): el del usuario («Copiar mensaje»; acciones visibles con hover, con foco de teclado y siempre en pantallas sin hover) y el del asistente («Copiar respuesta», siempre visible). «Copiado» 2 s. Cada **bloque de código** del Markdown trae su barra con lenguaje y «Copiar» (`Markdown.tsx`, `BloqueCodigo`). Texto seleccionable con el ratón (`select-text` explícito en burbujas, Markdown y error; comprobado con selección real en el navegador). No había ningún `user-select`/`inert` que lo impidiera: lo que fallaba era sólo la falta de botones.
- **Editar / volver a un mensaje**: en cada mensaje del usuario. Quita ESE mensaje y todo lo posterior de la vista y de la conversación guardada, y devuelve el texto al campo (enfocado, cursor al final). Si hay un stream en curso lo detiene primero. Lógica pura en `acciones.ts` (`reescribir`), orquestación en `useAsistente.editar`. Servidor: `DELETE /api/ai-chat/conversaciones/:id/mensajes/:mensajeId` (`revertirDesde`, transaccional, sólo dueño, 404 ajenos, idempotente, conserva la conversación vacía).
- **Regenerar** (último mensaje del asistente) y **«Reintentar»** de los errores son lo mismo: `regenerar` = borrar desde el último mensaje del usuario (servidor y vista) y reenviar su texto con los mismos ajustes → la respuesta vieja se REEMPLAZA, no se duplica (antes «Reintentar» dejaba filas de usuario repetidas en la base). **«Reintentar con Auto»** (error de modelo fijo) manda ese turno con `modelo` Auto sin tocar el ajuste guardado; **«Usar Auto siempre»** sí lo cambia (y desaparece si Auto ya es el ajuste).
- **Teclado**: ↑ en el campo vacío recupera el último mensaje enviado (sólo rellena el campo; NO borra nada de la conversación — para eso está «Editar»); **Esc detiene el stream** (si no hay stream, Esc cierra el panel como antes); foco al campo tras Editar/Regenerar/Reintentar; todo con `aria-label`; objetivos de 44 px (también «Renombrar» y «Borrar» del historial, que eran de 40).
- **Conversaciones** (`Conversaciones.tsx`): renombrar inline (lápiz; Enter guarda, Esc cancela sin cerrar el panel, clic fuera guarda; valida igual que el servidor), **buscar por título** (filtro en cliente sobre las 20 cargadas, sin tildes ni mayúsculas) y **exportar a Markdown** (botón de la cabecera, descarga local; `exportarMarkdown`/`nombreArchivoDe`, sin métricas ni ids, fecha de Lima). Servidor: `PATCH /api/ai-chat/conversaciones/:id` (`{ titulo }` 1–80, sin `<` `>` ni control; sólo dueño).
- **Errores útiles**: el error del modelo fijo dice el NOMBRE del catálogo («El modelo GPT OSS Safeguard 20B no respondió; prueba con Auto.»), con fallback a la cola del id (`qwen3.8-27b`) si el catálogo no trae nombre (`nombreAmigableDeModelo`). Se cambiaron 3 aserciones de `tests/asistente.test.ts` que esperaban el id crudo. El superadmin sigue viendo modelo y latencia bajo cada respuesta (métricas, como antes); nadie más ve ids.
- **SSE `meta` trae `mensaje_id`** (id del mensaje del usuario guardado): sin eso el panel no sabría desde qué fila borrar en el servidor. `Preparado.mensajeId` en `turno.ts`.
- **Carrera cubierta**: al editar en pleno stream, el servidor aún puede estar guardando el parcial cancelado. `revertirDesde` y `guardarMensajeAsistente` bloquean la fila de la conversación (`FOR UPDATE`) y la segunda no guarda si su pregunta ya no existe → nunca queda una respuesta huérfana (la comprobación de la UI mostró el problema real antes de arreglarlo).

**Decisiones / divergencias del brief:**
- **Auditoría: NO se audita** revertir ni renombrar, aunque el brief decía «audita». `docs/SEGURIDAD.md` y una prueba existente (`el contenido no va a la auditoría…`) exigen que todo `/api/ai-chat/*` quede fuera: el título es texto del usuario y «borrar desde un mensaje» revela su estructura. Si Miguel quiere un registro, hay que decidir antes qué metadatos (p. ej. sólo `cantidad` borrada, sin título) y cambiar esa política a propósito.
- **Límite por rol:** revertir/renombrar sólo pasan por el límite general de la API (`api`, 300/15 min por IP), igual que `DELETE /conversaciones/:id`; el límite de 20/15 min es del envío de mensajes (cuesta dinero). No hay límite distinto por rol en el resto de `ai-chat`.
- `acciones.ts` y no `mensajes.ts`: en macOS chocaba con `Mensajes.tsx` por mayúsculas.
- `tests/tsconfig.json` ahora incluye `DOM` en `lib` (las pruebas renderizan componentes con `react-dom/server`; sin eso `tsc -p tests/tsconfig.json` no compilaba `src/ui`).

**Verificación (números reales):** `npx tsc -b` 0 errores; `npx tsc -p tests/tsconfig.json --noEmit` 0; `npm run build` OK; `npm test` **451 pruebas, 451 pasan, 0 fallan** (base `house_test_mensajes`; 28 son nuevas — 10 de API en `asistente.test.ts` y 18 de lógica pura y marcado en `asistente-mensajes.test.ts` — y las otras 423 ya existían, por diferencia). Mutaciones: 22 mutaciones (revertir `>=`→`>`, sin filtro de dueño, título con HTML, sin tope de 80, sin lock, sin guardia de huérfanos, id crudo en el error, `mensaje_id` fuera, reescribir desde el siguiente, regenerar el primero, búsqueda con tildes, regenerar en cualquier respuesta, exportar vacíos, burbuja `select-none`, sin botón Editar, sin copiar código, sin visibilidad táctil, objetivo 36 px, fecha UTC…): **22 atrapadas, 0 sobrevivientes**. Navegador (Chromium con Playwright contra un backend de desarrollo con IA falsa, base `house_test_mensajes_dev`, admin `ana.lopez@gestionurbana.com` y superadmin): copiar usuario/asistente/código con el portapapeles real, selección con ratón, Editar (borra desde ahí en vista Y servidor, texto al campo enfocado), reescribir y reenviar, Regenerar (no duplica), ↑, Esc (parcial se conserva, 2.º Esc cierra), Editar en pleno stream (sin huérfanos), error con modelo fijo → «Reintentar con Auto» (ajuste guardado intacto) y «Usar Auto siempre», exportar (archivo y contenido), buscar, renombrar (Enter/Esc/vacío/HTML), móvil 390 px (acciones visibles sin hover, todo ≥ 44 px, sin scroll horizontal).

**NO verificado (honesto):** respuestas reales de proveedores (sin keys: todo fue con IA falsa; los formatos SSE reales los cubren las pruebas previas, no esta sesión); lector de pantalla real (sólo `aria-label`/roles por prueba); Safari/Firefox (sólo Chromium) y teclado táctil real del celular (se emuló viewport/táctil); `navigator.clipboard` en `http` no seguro (en producción es https; si falla se avisa con un toast); descarga del `.md` en navegadores móviles (Safari iOS la trata distinto); la carrera guardar/revertir se prueba 30 veces en bucle con `Promise.all` (determinista por el lock, pero no hay forma de forzar el entrelazado exacto).

**Qué más falta frente a MW (anotado, NO construido):** leer en voz alta y adjuntos (excluidos por el brief); **selección múltiple de mensajes** para quitarlos de la vista (`useSeleccionDeMensajes`); **ramas/versiones de una respuesta** (ver la respuesta anterior tras regenerar: aquí se reemplaza); **fijar/archivar conversaciones** y **carpetas**; **buscar dentro del contenido** de las conversaciones (hoy sólo por título y sólo las últimas 20; hace falta un endpoint con `ILIKE` filtrado por dueño); **paginar el historial** (hoy tope de 20); **compartir un enlace** de una conversación; **atajos globales** (p. ej. Ctrl+Shift+O nueva conversación); **dictado por voz**; **pulgar arriba/abajo** en una respuesta (feedback al superadmin); **indicador de «editado»** y **deshacer** tras Editar (hoy el borrado es definitivo; el texto queda en el campo y en el borrador). Baratas que quedaron fuera por no estar pedidas: copiar la conversación completa al portapapeles, «Editar» sobre mensajes de conversaciones abiertas del historial ya funciona (usa el id guardado).

**Gotchas:** (1) borrar desde un mensaje es **definitivo** en el servidor; si falla la red el panel NO cambia la vista (muestra un aviso). (2) Un mensaje cuyo `meta` nunca llegó (se abortó antes) no tiene `idServidor`: editarlo sólo cambia la vista y la fila pudo quedar en el servidor (se limpia sola a los 90 días o editando uno anterior). (3) El historial para el modelo ya une preguntas repetidas (`unirSeguidos`), así que conversaciones viejas con «Reintentar» duplicado siguen funcionando. (4) Para probar la UI sin keys: servidor con `instalarIA` (ver `tests/helpers/ia.ts`) + `CORS_ORIGIN=http://localhost:<puerto de Vite>` (el proxy de Vite cambia el `Host` y `origenPermitido` rechaza con 403 si no); el script y la config temporal de Vite eran desechables y no se commitean.

**Próximo paso sugerido:** que Miguel pruebe en su navegador con una clave real; decidir si quiere auditoría de metadatos (ver Decisiones) y cuáles de las faltantes (selección múltiple, buscar en contenido, ramas de respuesta) valen la pena.

---

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/asistente-inline`

**Qué se hizo:** el panel del asistente deja de ser un overlay y pasa a ser una columna acoplada (inline) con el estilo de los paneles de My Workspace. Pedido de Miguel: «que el panel de IA sea inline y no overlay, y que tenga el estilo de los paneles de MW». **Sólo frontend** (el backend y los selectores ya hechos no se tocaron; sólo se reubicaron).
- **Inline (>= lg):** `Shell.tsx` es ahora `lg:flex`: columna de contenido (`min-w-0 flex-1`) + `<Assistant>` como `aside sticky h-dvh` a la derecha. El contenido se reduce (medido a 1440: 1152 → 800 px), sin sombra ni velo, `border-l border-line`. Abrir/cerrar anima el ancho (200 ms, `transition-[width]`; el interior mantiene su ancho fijo para que el texto no se reacomode); `prefers-reduced-motion` lo anula con la regla global. Cerrado: ancho 0 + `inert` (sale del orden de tabulación). Sigue montado, así que la conversación no se pierde al navegar ni al cerrar.
- **Redimensionable:** `asistente/AsaDeAncho.tsx` (separador `role="separator"` en el borde izquierdo): arrastre, ← → (16 px; Mayús 64), Inicio/Fin, doble clic restablece. 20–40 rem; por defecto 24 rem. El tope baja en pantallas justas (`acotarAncho`: deja ≥ 480 px al contenido; a 1024 el panel queda en 20 rem). Se guarda por usuario en `localStorage` (`house:asistente:ancho:<id>`, con try/catch).
- **Abierto/cerrado por usuario** (`house:asistente:abierto:<id>`): en escritorio se recuerda al recargar y NO roba el foco al cargar; en el celular la vista es pasajera y no pisa la preferencia de escritorio. Lógica pura en `asistente/panel.ts`, hooks en `asistente/useDock.ts` (`useEscritorio`, `usePanelAbierto`, `useAnchoPanel`).
- **Móvil/tablet (< lg):** vista propia `fixed inset-0` (sin velo) con «Volver» en la cabecera, foco atrapado, contenido de atrás `inert`, y el alto sigue al teclado (`visualViewport`).
- **Estilo MW:** `asistente/CabeceraAsistente.tsx` — cabecera de 44 px esmerilada (`bg-surface/70 backdrop-blur-md`), título, chip «Auto · Equilibrado» (abre el `AjustesMenu` de siempre: modelo, creatividad, esfuerzo; ya NO está en el compositor), historial, nueva conversación, cerrar. El hilo sube por detrás de la cabecera (`-mt-11` + `mask-image` que desvanece 1 rem) y termina limpio sobre el pie. `Compositor.tsx`: pie sólido sin blur, textarea que crece (hasta 6 líneas), Enter envía / Mayús+Enter salto, botón enviar/detener de 44 px, contador `n/4000` discreto (aviso a partir del 90 %). `Mensajes.tsx`: centrado (`max-w-2xl`), burbuja del usuario a la derecha, respuesta sin caja, `PuntosPensando` (tres puntos), copiar de 44 px. Estado vacío con saludo + sugerencias en lista.
- **Accesibilidad:** `role="complementary"` con nombre «Asistente de House»; el hilo es `aria-live="polite"` con `aria-busy` mientras transmite (el lector espera a que termine la respuesta en vez de leer cada fragmento; se quitó el `status` sr-only aparte para no duplicar); foco al campo al abrir y de vuelta a quien abrió al cerrar; Esc cierra sólo con el foco dentro del panel (y el menú de ajustes lo frena antes); objetivos ≥ 44 px (medidos en móvil); contraste de los pares nuevos AA (ink/brand-soft 14,6 claro · 11,6 oscuro; warn/surface 6,2 · 9,9; muted/bg 5,6 · 7,7).
- `Markdown.tsx`: separación entre bloques (`[&>*+*]:mt-2`; una lista seguida de un párrafo quedaba pegada). `DESIGN.md`: patrón nuevo «Panel lateral inline».

**Verificación (números reales):** `npx tsc -b` limpio; `npx tsc -p tests/tsconfig.json --noEmit` limpio; `npm run build` OK; `eslint src/app` sin salida; `npm test` contra `house_test_asistente_inline`: **421 pass / 0 fail** (incluye 4 pruebas nuevas de `panel.ts`: acotado de ancho, guardado por usuario, abierto/cerrado, localStorage bloqueado). Navegador (Chromium headless con Playwright, backend en 4010 y Vite en 5180 con BD propia; respuesta del modelo simulada con `route` porque no hay claves de IA): 1440 claro y oscuro, 1024 claro, 390 claro y oscuro.

**NO verificado (honesto):**
- Respuestas reales de un modelo (sólo SSE simulado; sin claves). El estado de error real («No pude responder…») sí se vio.
- Safari/iOS y Firefox; teclado virtual real (la lógica de `visualViewport` se conserva pero no se probó en un teléfono). El `mask-image`/`backdrop-blur` sólo se vio en Chromium.
- Lector de pantalla real (VoiceOver/NVDA): `aria-live` + `aria-busy` está razonado, no escuchado.
- `prefers-reduced-motion` no se emuló en el navegador (se apoya en la regla global de `index.css`).
- Arrastre táctil del borde (el asa es sólo `lg`, donde casi no hay táctil).
- Los otros 5 roles (sólo se probó superadmin en el navegador; los residentes no ven selector de modelo: el chip muestra sólo la creatividad).

**Gotchas / pendientes:**
- A 1024–1279 px con el panel abierto el contenido queda en ~450 px y varias pantallas (StatStrip, tarjetas de `Dashboard`) se ven apretadas: sus puntos de quiebre son por viewport, no por contenedor. Arreglo real = container queries en esas páginas (trabajo aparte; no se tocó `src/pages`).
- Las métricas «modelo · 1,2 s» siguen visibles sólo para superadmin (decisión previa; no se cambió).
- El Shell ahora envuelve cabecera + `<main>` en un `div`; si otra rama toca `Shell.tsx` habrá que reconciliar.

---

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/asistente`

**Qué se hizo:** el chat de IA deja de depender de modelos fijos y de un solo intento: descubre y depreca modelos solo, responde en streaming con conversaciones guardadas, usa datos verificados de la cuenta, y no se queda sin IA aunque caigan los proveedores. Pedido de Miguel: «corrige y mejora el chat de IA, revisa cómo lo hicimos en My Workspace» (en producción respondía «No pude responder: El servicio de IA no pudo responder»: Gemini 404, Groq 404 y OpenRouter 402 porque los modelos por defecto ya no existían o eran de pago).
- **Esquema (aditivo, al final de cada bloque):** `ModeloIA`, `SyncModelosIA`, `ConversacionIA`, `MensajeIA` (con `modo`), `EstadoIA`; en `ClaveIntegracion`: `reserva` y `aviso_modelo`. `db push` sólo contra `house_test_asistente`.
- **Catálogo vivo** (`services/modelos/`: `sync.ts`, `seleccion.ts`, `retiro.ts`; `lib/modelosIA.ts`, `lib/modelosMalos.ts`): `GET /models` por clave; nuevo → `activo`, ausente → `deprecado` con fecha (nunca se borra), reaparecido → `activo`; lista vacía o error del proveedor no deprecan nada. Clasificador por nombre, filtro de no‑chat, `elegirModeloAuto` con preferencias por proveedor y categoría según esfuerzo/largo del mensaje. Se dispara al guardar/habilitar una clave, en «Probar», en «Sincronizar ahora» y cada 6 h con `pg_try_advisory_xact_lock` (`MODELOS_SYNC`).
- **Motor** (`services/asistente/motor.ts`, `proveedor.ts`): la unidad de rotación es la ruta (clave, modelo). 404 de modelo = vale para el PROVEEDOR 10 min (memoria) y deprecado en la base al instante; 402 de OpenRouter con un modelo de pago prueba un `:free`; 400 por parámetro no soportado se reintenta una vez sin opcionales; tope de rutas distintas (6; `LLAVERO_MAX_INTENTOS`) y de tiempo (25 s; `LLAVERO_TOPE_MS`); la reserva (`ClaveIntegracion.reserva`) va al final con su propio margen. Streaming SSE (Gemini `:streamGenerateContent?alt=sse` y `stream: true`), cancelación del cliente corta la llamada al proveedor.
- **Chat y conversaciones** (`routes/aiChat.ts`, `services/asistente/turno.ts`, `conversaciones.ts`): `POST /api/ai-chat` (compatible + `conversacion_id`), `POST /api/ai-chat/stream`, `GET /opciones`, `GET/DELETE /conversaciones[/:id]`. El historial lo arma el servidor (10 turnos, ~6000 caracteres). Parámetros `modelo|preset|parametros|esfuerzo` con zod; la regla por rol se aplica en el servidor (sólo admin/superadmin eligen modelo y esfuerzo y pasan de 1024 tokens). Métricas por mensaje (proveedor, modelo, latencia, tokens). Retención 90 días (`ASISTENTE_LIMPIEZA`). **`/api/ai-chat/*` quedó fuera de la auditoría** (`middleware/audit.ts`): el contenido sólo lo ve su dueño.
- **Contexto y prompt** (`services/asistente/contexto.ts`, `lib/rutasApp.ts`, `src/config/ai-system-prompt.txt`): bloque «DATOS VERIFICADOS» armado por código con los scopes de las APIs; prompt reescrito con las rutas reales (una prueba las compara con `App.tsx`). Contingencia sin IA con los mismos datos cuando ninguna ruta responde (`modo: 'contingencia'`).
- **Resiliencia**: «Probar» ejercita el chat de verdad (`prueba.ts`); recuperación de claves rechazadas (`recuperacion.ts`: cada 6 h y en el sync, separación de 5 h y 8 reintentos); canary (`canary.ts`: cada 30 min, máx. 50/día, `ASISTENTE_CANARY`); salud y alertas (`salud.ts`: `GET /api/llavero` → `salud`, aviso `ia_caida`/`ia_restablecida` al superadmin). **Tocó avisos de forma aditiva**: `TIPOS` + 2 plantillas, `RefAviso` `{ entidad: 'ia' }` y 2 etiquetas en `pages/admin/Avisos.tsx`.
- **Frontend** (`src/app/Assistant.tsx`, `src/app/asistente/`): streaming con «Detener», «Pensando…», «Reintentar», nueva conversación y selector de las últimas 20 con «Borrar» confirmado, «Copiar», chips por rol, borrador conservado, foco y Esc, `role="dialog"` modal sólo en móvil, scroll que no pelea, Markdown seguro (sólo rutas internas y `https`), errores por causa, métricas sólo para el superadmin, menú «Ajustes» (Modelo / Creatividad con «A medida» / Esfuerzo) guardado por usuario. Llavero (`pages/superadmin/_parts/llavero/`): banner de salud, modelo en uso, «Cambiar modelo», «Sincronizar ahora», reserva, «Cambios recientes» y «Consultas recientes». La lógica pura está en `src/app/asistente/*.ts` y se prueba con `node:test`.
- **Docs**: `docs/SEGURIDAD.md` (rotación nueva, catálogo vivo, resiliencia, sección «Asistente de IA»), `docs/API-CONTRATO.md` (sección nueva), `.env.example`.

**Próximos pasos:**
- **Revisar el panel y el Llavero en un navegador real (no hubo)**, sobre todo en el celular: teclado, foco, menú «Ajustes», modo oscuro y el `visualViewport`.
- Probar con las claves REALES de producción (sólo se probó con `fetch` falso): respuestas de cada proveedor, el stream real de Gemini/Groq/OpenRouter, que `gemini-flash-latest` y `openai/gpt-oss-120b` aguanten el `thinkingConfig`/`reasoning_effort`, y que el sync clasifique bien los ~469 modelos de OpenRouter.
- Tras desplegar: `MODELOS_SYNC`, `ASISTENTE_CANARY` y `ASISTENTE_LIMPIEZA` quedan activas solas en producción; pulsar «Sincronizar ahora» en cada clave y «Probar» para ver el modelo que elige el Auto.
- Decidir si se marca alguna clave de OpenRouter con saldo como **reserva**.

**Decisiones:**
- Mensajes cortos (< 60 caracteres) o esfuerzo bajo prefieren un modelo rápido/equilibrado en Auto (pedido); por eso con «Hola» el Auto de Groq elige `qwen` y no `gpt-oss-120b`. La lista de preferencia sólo manda dentro de la categoría pedida y el resto queda de respaldo.
- Un 400 que persiste sin opcionales ya NO corta la consulta (antes «es culpa de la petición»): se prueba la siguiente ruta sin castigar la clave. Gemma vía Gemini, p. ej., rechaza `systemInstruction` con 400.
- **Canary**: el pedido decía «una consulta por proveedor cada 30 min» y «máx. ~50 al día»; con 3+ proveedores no caben las dos. Cada pasada revisa a los proveedores más rezagados (rotando) y el presupuesto reparte 50/día en las 48 pasadas.
- Si no hay NINGUNA clave (ni `GEMINI_API_KEY`), `POST /api/ai-chat` sigue dando 500 «no está configurada» (no contingencia): es un problema de configuración, no una caída.
- La salud en pantalla sigue en rojo, aunque venza el enfriamiento, hasta que una consulta real o el canary confirmen la recuperación.
- Los tokens de «pensar/razonar» se suman al tope de salida (si no, la respuesta llegaba vacía o cortada con `maxTokens` 1024).
- El título de la conversación son las primeras 8 palabras del primer mensaje; un «Reintentar» repite la pregunta y el historial no la duplica.

**Gotchas:**
- `prisma generate` actualizó el cliente compartido del checkout principal (tablas/campos nuevos; nada se quitó).
- Las pruebas usan `tests/helpers/ia.ts` (proveedores falsos: lista de modelos, chat, SSE manual) y el reloj `cooldownDeps.ahora`; `tests/helpers/env.ts` apaga `MODELOS_SYNC`, `ASISTENTE_CANARY` y `ASISTENTE_LIMPIEZA`.
- Las pruebas viejas de rotación se ajustaron a lo que cambió a propósito: `conversacion_id` en la respuesta, contingencia en lugar de 503/429, 400 con reintento, tope de 6 rutas, «Probar» con dos llamadas.
- El canary, la recuperación y las alertas viven en proceso: con varias réplicas el estado de memoria (enfriamientos, modelos malos, presupuesto) es por réplica; el de la base (salud, catálogo) se comparte.
- Sin `LLAVERO_ENC_KEY` nada de esto corre (el llavero responde 503), y los avisos de «IA sin servicio» salen por correo/WhatsApp sólo si el superadmin tiene esos canales activos.

---

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/evaluacion-ia`

**Qué se hizo:** el residente sube la captura de su pago y la IA (visión) la lee; el código la contrasta con lo que debía pagarse. Además, avisos al residente al validar o rechazar. La IA AYUDA: las decisiones salen de comparaciones por código, nunca del texto del modelo.
- **Esquema (aditivo, al final de cada bloque):** modelo `EvaluacionComprobante` (1 por pago, Cascade), `ComplejoHabitacional.validacion_automatica_ia` (false), `Pago.validado_por_ia` (false). `db push` sólo contra `house_test_ia`; `prisma generate` actualizó el cliente compartido del checkout principal (campos nuevos, nada se quitó).
- **Backend:** `lib/lecturaComprobante.ts` (prompt + esquema zod estricto + limpieza), `services/contraste.ts` (funciones puras: monto, fecha, destino, nombre, duplicados, veredicto y confianza), `services/evaluacion.ts` (cadena del llavero filtrada a visión, tope de 3 claves, toma atómica, reintento a los 60 s, auto-validación), `services/validacionPago.ts` (cierre atómico compartido por la validación manual y la de la IA + `avisarResultado`), `lib/evaluacionVista.ts` (vista completa vs. simple del residente). `proveedoresIA.ts`: `vision`, `modeloVision`, `visionPdf`. Rutas nuevas: `POST/GET /api/pagos/:id/evaluacion` (límite por usuario `limiters.evaluacion`).
- **Avisos:** `RefAviso` admite `{ entidad: 'pago', id }` y `encolarAviso` recibe `opts.motivo` (la plantilla `pago_rechazado` lo muestra). Fue el único cambio en `services/avisos/`: el pedido exigía el motivo y evitar que un 2.º rechazo del MISMO cargo quedara tapado por la unicidad (usuario, canal, tipo, ref).
- **Frontend:** `pages/shared/evaluacion.tsx` (panel, insignias, hooks de seguimiento), `ValidarPagoModal` (panel «Evaluación automática» + «Volver a evaluar»), columna «Revisión IA» en Pagos › Por validar, `PagarModal` (aviso de privacidad, botón de cámara, paso «Pago registrado» con «Evaluando tu comprobante…» ≤ 30 s), `PagosResidente` (estado e insignia «Validado automáticamente»), `ValidacionAutomaticaIA` en Medios de pago (sólo admin; confirma al activar).
- **Pruebas:** `tests/evaluacion-ia.test.ts` (62). Suite completa: 295 en verde. Mutaciones (copia a scratchpad y `cp`): 32 aplicadas; 29 en rojo. Sin detectar y por qué: `!duplicado` en la auto-validación (redundante: un duplicado ya da `no_coincide`), enfriar el respaldo de entorno tras un 401 y `skipDuplicates` de la cola (su error se traga en `avisarResultado`; la idempotencia la cubre `tests/avisos.test.ts`).
- **Docs:** `SEGURIDAD.md` (sección «Evaluación de comprobantes con IA»: qué se envía, a quién, qué se guarda) y `API-CONTRATO.md`.

**Próximos pasos:**
- Probar con un proveedor REAL y capturas reales de Yape, Plin y bancos (sólo se probó con `fetch` falso): afinar el prompt, confirmar que los modelos por defecto (`gemini-2.5-flash`, `gpt-4o-mini`, `openai/gpt-4o-mini`, `mistral-small-latest`) siguen vigentes y medir costo y latencia.
- Revisar las pantallas en el navegador (no hubo): panel de evaluación en el modal, columna «Revisión IA», paso «Pago registrado» y la cámara en móvil, interruptor en Medios de pago.
- Decidir con la administración el proveedor de IA de producción (la imagen sale hacia él; ver `SEGURIDAD.md`) y cuándo activar `validacion_automatica_ia`.

**Decisiones:**
- Estado «evaluando» = `estado: 'pendiente'`. Durante el reintento sigue `pendiente` con `error = 'Reintento programado'` (el residente sigue viendo «evaluando»).
- `resumen` y `alertas` los arma el código; el texto del modelo jamás se guarda. `moneda` nula → el monto queda en `null` (revisar), no en falso.
- Los duplicados (archivo y n.º de operación) se buscan sólo dentro de la empresa.
- `GET /api/me/*` y `formatearPago` son «residente» por omisión (a prueba de olvidos): lo completo se pide con `'completa'`.

**Gotchas:**
- La evaluación corre en el proceso (no hay cola persistente): si el contenedor se reinicia a medias, queda `pendiente` y se retoma con «Volver a evaluar» a los 3 min.
- Las pruebas esperan la IA con `esperarEvaluaciones()`; las que usan compuertas las abren solas en `afterEach`.
- `fechaCorta('YYYY-MM-DD')` cae un día antes en Lima (se interpreta UTC): la fecha detectada se muestra con `T12:00:00`.
- `tests/helpers/env.ts` ya acepta `TEST_DATABASE_URL`; esta rama usó `house_test_ia`.

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/calidad`

**Qué se hizo:** mejoras media y baja pendientes: accesibilidad del kit de UI y pruebas end-to-end del flujo de dinero. Sin cambios de backend, de esquema ni de páginas.
- **Kit de UI (`src/ui/*`, compatible hacia atrás):** `IconButton` 40 px de objetivo táctil sin agrandar filas (`h-10 w-10 -m-0.5`); `Tabs` WAI-ARIA completo (+ `idBase`, `label`, `TabPanel`); `DataTable` con filas clicables operables por teclado que ignoran eventos de controles internos; `ocultarEtiqueta` en `Field/Input/Select/Textarea/SearchBox` y error en región `aria-live`; `ProgressBar` nuevo (exportado, **ninguna pantalla migrada**); `Modal` con `aria-labelledby`, foco inicial al primer control y retorno del foco; `Toast` con `status` (avisos) y `alert` (errores). Lógica pura en `src/ui/a11y.ts`.
- **Contraste:** `scripts/contraste.mjs` (OKLCH → sRGB → WCAG). Los 32 pares texto/fondo pasan 4.5:1 en claro y oscuro; no se tocó ningún token. Detalle, pendientes y lo no verificado en `docs/ACCESIBILIDAD.md`.
- **Pruebas:** `tests/accesibilidad.test.ts` (lógica pura + contraste) y `tests/flujo-dinero.test.ts` (UN recorrido narrativo con Marta —administradora—, Rosa/Luis/Jorge/Carmen —vecinos— y actores de otra empresa: emitir → pagar con comprobante → validar → rechazar y repagar → morosidad con días de atraso → efectivo manual → invariantes, aislamiento por unidad y por empresa, auditoría sin archivos, IA con `fetch` falso).

**Próximos pasos:**
- Migrar las pantallas al kit nuevo (reemplazar `[&_label]:sr-only` por `ocultarEtiqueta` en `Pagos.tsx`, `Recibos.tsx`, `EmitirReciboModal.tsx`; `ProgresoCobro` → `ProgressBar`; `Tabs` con `idBase`/`TabPanel` donde haya paneles). Lo hace quien toque páginas.
- Revisar en navegador: altura de filas con `IconButton`, foco visible de fila, foco del `Modal`. Probar con un lector de pantalla.
- Decisión de diseño pendiente: el borde de los campos (`line`/`surface` ≈ 1.3:1) no llega a 3:1 (WCAG 1.4.11); ver `docs/ACCESIBILIDAD.md`.

**Decisiones:**
- `IconButton` usa margen negativo y no `relative` + `before:`: `Shell` le pasa `absolute` y Tailwind ordena `relative` después, lo rompería.
- Las filas de `DataTable` conservan el rol `row` (con `tabIndex` y teclado) en lugar de `role="button"`, que rompe la semántica de tabla.
- El «reloj» del test de dinero se mueve corrigiendo `fecha_vencimiento` del recibo por la API (el backend no tiene reloj inyectable en las rutas).

**Gotchas:**
- Los montos Decimal de los cargos salen sin ceros de relleno (`"180.5"`) pero con dos decimales en dashboard y reportes (`"180.50"`): compara en céntimos.
- Un pago manual (`POST /api/pagos`) sobre un cargo de OTRA empresa responde **422** (referencia inválida), no 404; los GET/PATCH/DELETE sí dan 404. Está así en el contrato actual y el test lo fija.
- La auditoría de un recibo se guarda con `entidad: 'recibo'` (singular); la de pagos, `entidad: 'pago'`.
- Los tests del recorrido dependen del orden (una sola historia); no los corras con `--test-name-pattern` aislado.

## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/medios-pago`

**Qué se hizo:** medios de pago por block (cuenta bancaria, Yape/Plin con QR) y cargo de junta directiva. Sin pasarela: el vecino paga por fuera y registra el comprobante.
- Esquema (aditivo, al final de cada bloque): `Usuario.cargo_junta`, `Usuario.estructura_id` (+ relación `JuntaEstructura`), modelo `MedioPago` (FK Cascade a `ComplejoHabitacional`/`Estructura`).
- Backend: `lib/junta.ts` (`ambitoJunta`, `puedeGestionar`, `filtroAmbito`; sólo presidente/tesorero), `scopeMediosPago` y `scopePagosJunta` en `lib/scope.ts`, `services/mediosPago.ts` (catálogo de bancos, zod por tipo, límites del QR), `routes/mediosPago.ts` (`/api/medios-pago`, `/ambitos`, QR crudo, `/api/me/medios-pago`). `crud.ts` suma `readAlso` (lectura extra acotada por `scope`); `pagos.ts` lo usa para que la junta LEA los pagos de su ámbito; `comprobantes.ts` deja ver el comprobante y validar/rechazar a la junta del ámbito (no el propio pago). `AuthUser`, login y `/me` suman `cargo_junta` y `estructura_id`. `usuarios.ts` valida/asigna el cargo y revoca sesiones.
- Frontend: `/admin/medios-pago` (`pages/admin/MediosPago.tsx` + `_parts/medios/`), grupo «Junta» en la navegación (`navPara(user)` en `app/nav.ts`; `RequireJunta` en `auth/guards.tsx`; `auth/junta.ts`) con `/junta/medios-pago` y `/junta/pagos` que reusan `MediosPago` y `Pagos` (`Pagos` oculta «Registrar pago» a la junta); «Cargo en la junta» y columna «Cargo» en Usuarios; `PagarModal` ahora empieza en «Cómo pagar» (`ComoPagar.tsx`) y luego «Ya pagué: registrar comprobante».
- Pruebas: `tests/medios-pago.test.ts` (32). Se ajustó el `deepEqual` del usuario de login en `tests/seguridad.test.ts` (campos nuevos). Suite completa: 216 en verde. 15 mutaciones comprobadas en rojo.
- Docs: `API-CONTRATO.md` y `SEGURIDAD.md` (sección «Medios de pago y junta directiva»).

**Próximos pasos:**
- Revisar las pantallas en el navegador (no hubo): tabla y modal de medios de pago, «Cómo pagar» en móvil (QR de 224 px, botones de 40 px), grupo «Junta», selects de cargo en Usuarios.
- Integrar con `main`; en el despliegue `prisma db push` agrega las 2 columnas y la tabla (aditivo, sin pérdida de datos).
- Asignar cargos desde Usuarios (p. ej. presidente de un block) para probar el flujo completo.
- Idea: aviso al residente cuando la junta valida/rechaza (`encolarAviso` ya existe; `validacion` aún no lo llama).

**Decisiones:** «block» = `Estructura` por igualdad directa con `Unidad.estructura_id` (sin anidados). La junta no valida su propio pago. El residente no recibe el DNI/RUC del titular. `GET /api/me/medios-pago` devuelve un array plano. `GET /api/medios-pago/ambitos` existe porque la junta no puede leer `/api/estructuras`. El QR usa `bg-white` (único fondo fijo): un QR oscuro sobre fondo oscuro no se escanea.

**Gotchas:**
- Las pruebas comparten `house_test` con otras sesiones: dos suites a la vez se vacían la base entre sí (falsos rojos). Usa una propia: `TEST_DATABASE_URL=postgresql://postgres:house@localhost:5433/house_test_<tema>` (el nombre debe contener `house_test`) y `prisma db push` contra ella.
- NO corras `prisma format`: reformatea todo `schema.prisma` y ensucia el diff.
- Un presidente con block ve el QR/medios de su block, no los de «todo el condominio» (sólo una junta sin block los gestiona); los vecinos ven ambos.

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
## 2026-10-23 — Claude Code (Sonnet 5.5) — rama `feat/avisos`

**Qué se hizo:** avisos de recibos y vencimientos por correo (Resend) y WhatsApp (Evolution API).
- Esquema (aditivo, al final de cada bloque): `Usuario.aviso_email` (default `true`), `Usuario.aviso_whatsapp` (default `false`), `Usuario.notificaciones`, modelo `Notificacion` con `@@unique([usuario_id, canal, tipo, ref_entidad, ref_id])`.
- Backend `src/server/services/avisos/`: `celular.ts` (normaliza a `51` + 9 dígitos), `plantillas.ts` (5 tipos, español de Perú con tuteo), `canales.ts` (adaptadores con `fetch`, reloj y `env` inyectables; sin variables ⇒ `omitida` «Canal no configurado»), `cola.ts` (`encolarAviso`, `encolarReciboEmitido`, `encolarRecordatorios`, `procesarCola`), `planificador.ts` (cada 15 min, `AVISOS_PLANIFICADOR=on|off`, por defecto solo en producción; se inicia desde `src/server.ts`, nunca desde `createApp`).
- API: `GET /api/notificaciones` (+ `/resumen`, `/canales`), `POST /api/notificaciones/:id/reenviar` (auditado), `GET|PUT /api/me/avisos` (router propio `routes/avisosPersonales.ts`, montado ANTES de `/me`: **no se tocó `me.ts`**). `GET /api/auth/me` suma `aviso_email` y `aviso_whatsapp`. `POST /api/recibos` encola `recibo_emitido` tras la transacción; un fallo allí se registra y no deshace la emisión.
- **Para la sesión de comprobantes:** llama `encolarAviso('pago_validado' | 'pago_rechazado', usuarioId, { entidad: 'cargo', id: <ReciboConceptoUnidad.id> })` (import desde `src/server/services/avisos`). Es idempotente y devuelve cuántas notificaciones creó. Hazlo después de confirmar la transacción y con `try/catch`; opcional `procesarPronto()` para enviar sin esperar al ciclo. No se modificó `pagos.ts`.
- Frontend: `/admin/avisos` (`pages/admin/Avisos.tsx` + `_parts/avisos/Canales.tsx`; ruta lazy en `App.tsx`, entrada «Avisos» con `BellIcon` en `nav.ts` para admin y superadmin) y sección «Avisos» del Perfil (`pages/shared/_parts/AvisosPerfil.tsx`; **un único punto de inserción**: `<AvisosPerfil />` al final del grid de `Perfil.tsx`). No hay componente de interruptor en `src/ui`: el `role="switch"` es local a `AvisosPerfil.tsx`.
- Pruebas: `tests/avisos.test.ts` (25; sin red, `fetch` y reloj inyectados). 18 mutaciones comprobadas en rojo (preferencias, `en_revision`, ventana de emisión, backoff, `skipDuplicates`, arrendamiento, fuga del mensaje de error, canal no configurado, fijos como celular, bloqueo del planificador, tenant y estado en reenviar, cuerpo en el listado, scope del listado, fallo que deshace la emisión, celular obligatorio para WhatsApp, `auth/me`, enlace en plantilla).
- Docs: `docs/SEGURIDAD.md` (sección «Avisos»), `docs/API-CONTRATO.md`, `.env.example`, README.

**Cómo verificar:** `npm test` (131) · `npx tsc -b` · `npx tsc -p tests/tsconfig.json --noEmit` · `npm run build`. Las pruebas necesitan `house_test` con el esquema nuevo: `DATABASE_URL=postgresql://postgres:house@localhost:5433/house_test npx prisma db push`.

**Próximos pasos**
- Definir en Coolify `RESEND_API_KEY`, `MAIL_FROM` (dominio verificado en Resend, SPF/DKIM), `EVOLUTION_URL`, `EVOLUTION_INSTANCE`, `EVOLUTION_APIKEY`. Sin ellas todo queda `omitida` (se ve en `/admin/avisos` › Canales) y «Reenviar» lo recupera después.
- Conectar `pago_validado`/`pago_rechazado` desde comprobantes (arriba).
- Enlace de baja en los correos y límite de envíos por usuario (hoy la baja es desde el Perfil).

**Decisiones y gotchas**
- **Todos los usuarios existentes quedan con `aviso_email = true`**: al configurar Resend empezarán a recibir avisos. Los recibos con vencimiento en los próximos 3 días (y los vencidos hace ≤ 3 días) recibirán su recordatorio en el primer ciclo.
- Bloqueo del planificador con `pg_try_advisory_xact_lock` en una transacción (no el de sesión que pedía el brief: con el pool de Prisma toma y suelta en conexiones distintas). Cada notificación se «arrienda» (se corre `programada_para` 5 min) antes de enviar, así dos procesos no la mandan dos veces; por eso puede procesarse en caliente tras emitir (`procesarPronto`, solo con planificador activo).
- `por_vencer` cubre faltan ≤ 3 días y excluye recibos emitidos hoy (ya se avisó al emitir); `vencido` recupera hasta 3 días atrás por si el proceso estuvo caído. Sin duplicados por el `@@unique`.
- `GET /api/notificaciones/canales` devuelve `{configurado, faltan:[NOMBRES de variables]}` (no solo booleanos) para que la pantalla diga qué variable falta; nunca valores.
- **`prisma generate` y `node_modules` compartido**: el cliente de Prisma vive en el checkout principal y lo comparten las 3 sesiones; cada `generate` pisa el de las otras (cada rama tiene su esquema). Si `tsc` o las pruebas dicen que no existe `notificacion` / `aviso_email`, corre `npx prisma generate` y repite. Al integrar las ramas habrá que fusionar `schema.prisma` (modelos al final del bloque) y regenerar.
- Con varias réplicas y el planificador activo en todas, el bloqueo asesor deja trabajar a una sola.

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
