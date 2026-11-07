# Simulación de mercado: 3 empresas, 9 condominios y 5 juntas de vecinos

Fecha: 4-nov-2026 · Base local `house_mercado` (nunca `house` ni producción) · Rama `feat/simulacion-mercado` · Código del servidor: `origin/main` en `82344aa`, sin cambios.

**Resultado en una línea:** 19 633 comprobaciones, 0 fallas. No se encontró ninguna fuga ni escritura entre clientes. Lo que sí salió son observaciones menores (sección 6), una de pantalla (el resumen de una empresa con varios condominios repite «Block 2», «Block 6» sin decir de qué condominio) y un reporte que ya está cerca de 1 s.

> **Nota sobre las cifras.** Los números de este informe salen de la pasada completa que dio 19 633 de 19 633 (sin fallas). Después de ella se afinó el recorrido (cuerpos válidos para dos ataques que habían salido «débiles» —`PUT` de medio de pago y `POST` de junta—, reconocer como rechazo fuerte el 422 «un block no se cambia de condominio», y archivar el comunicado de prueba en vez de dejarlo publicado). Esa versión afinada **no pudo repetirse completa**: la Mac se saturó con procesos del sistema (carga > 140) y la pasada se cayó con `fetch failed` y tiempos ×3 (esa corrida no vale ni como medición ni como resultado). Por eso: (a) los tiempos de la sección 6 son los de la pasada limpia, (b) en la sección 3, 280 de los 322 rechazos «débiles» eran estas dos formas con cuerpo inválido y rechazos explícitos de Torre («un block no se cambia de condominio», «el block no existe en ese condominio»); con el recorrido afinado deberían pasar a «fuertes», pero eso **no está verificado**. Vuelve a correr `separacion` con la Mac tranquila para confirmarlo. Un intento posterior (5 de nov, carga 115–340) volvió a caerse con `fetch failed` en `separacion` y con un tiempo de espera en el navegador; su único hallazgo útil: el `PUT /api/medios-pago/:id` con un `complejo_id` ajeno responde 200 y **no lo aplica** (el código dice «el ámbito no se cambia: se ignoran complejo_id y estructura_id» y en la base ningún medio de pago cambió de condominio ni de block); la «falla» que marcó el recorrido era del recorrido (esa ruta no tiene GET por id para releer), ya corregido para comprobarlo en la base. Es otro caso de la observación S1.

## 1. Cómo volver a correrlo

```bash
# Una vez: crear la base y su esquema (no toca `house`)
docker exec house-pg psql -U postgres -c "CREATE DATABASE house_mercado"
DATABASE_URL=postgresql://postgres:house@localhost:5433/house_mercado npx prisma db push --skip-generate

# Sembrar (≈ 2 min; borra y recrea todo en house_mercado; las contraseñas de prueba van a un archivo FUERA del repo)
DATABASE_URL=postgresql://postgres:house@localhost:5433/house_mercado CREDENCIALES_JSON=$HOME/house-mercado-credenciales.json npm run seed:mercado

# Backend aislado en el puerto 4110 (sin correo ni WhatsApp; NO copia la base). Para el navegador hace falta `npm run build` antes.
HOUSE_REPO=$PWD bash scripts/e2e/levantar.sh 4110 house_mercado

# Recorrido completo (≈ 5 min). Fases sueltas: separacion, herramientas, tipos, planes, rendimiento, mensajeria, navegador
CREDENCIALES_JSON=$HOME/house-mercado-credenciales.json node scripts/e2e/flujos-mercado.mjs
```

- El seed **sólo corre** si `DATABASE_URL` apunta a `localhost/house_mercado`; en otro caso aborta sin tocar nada.
- `levantar.sh` ahora acepta `house_mercado` (siempre con `--sin-copiar`: jamás la vuelve a copiar desde `house`) y `HOUSE_REPO=<carpeta>` para servir el código de un worktree.
- La fase `tipos` **escribe** (emite el recibo de noviembre de una junta, paga, valida): es de una sola vez; para repetirla, vuelve a sembrar. `separacion` no debe cambiar nada.
- El inicio de sesión se limita a 10 intentos por cuenta y por IP cada 15 minutos: si corres el recorrido dos veces seguidas con el mismo backend, reinícialo (`levantar.sh`).
- Resultado completo con evidencia: `scripts/e2e/resultados/mercado.json` (generado, no se commitea). Capturas: `scripts/e2e/capturas/mercado-*.png`.

## 2. El mercado simulado

Todo inventado: nombres generados con semilla fija, correos `.example`, celulares `900 000 000 – 900 999 999`, RUC ficticios. Estructura con Prisma; **recibos y pagos salen de la API real** (emisión por block con su mora automática, pago del mantenimiento por la administración o la junta, vouchers por validar, rechazos), así que los datos son los que produce Torre.

| Cliente | Tipo | Condominio | Blocks | Dptos | Plan (estado) |
|---|---|---|---:|---:|---|
| A · Administradora Andina Predial SAC | Empresa | Residencial Los Cedros | 14 | 448 | Administradora (activa) |
| | | Condominio Parque Jazmines | 6 | 120 | Administradora |
| | | Conjunto Las Orquídeas | 2 | 24 | Administradora |
| | | Torre Mirador del Sur | 1 torre | 60 | Administradora |
| B · Gestión Inmobiliaria Pacífico EIRL | Empresa | Residencial Santa Rosa de Lima | 8 | 192 | Administradora |
| | | Condominio Los Pinos | 3 | 48 | Administradora |
| | | Edificio Plaza Norte | 1 | 40 | Administradora (por vencer en 3 días) |
| C · Servicios Vecinales Cumbre SAC | Empresa | Condominio Villa Hermosa | 5 | 50 | Pro |
| | | Edificio Alameda 18 | 1 | 18 | Pro |
| J1 · Junta de Propietarios Edificio Los Álamos | Junta | Edificio Los Álamos | 1 | 8 | Gratis, con 45 días de plazo; junta única |
| J2 · Junta Vecinal Residencial San Felipe | Junta | Edificio San Felipe | 1 | 12 | Gratis **vencido** (solo lectura desde el 12-oct); junta de block |
| J3 · Junta de Propietarios Torre Colonial | Junta | Torre Colonial | 1 torre | 20 | Básico; junta única |
| J4 · Junta Directiva Edificio Las Gaviotas | Junta | Edificio Las Gaviotas | 1 | 32 | Pro; junta de block |
| J5 · Asociación de Propietarios Edificio Miraflores 48 | Junta | Edificio Miraflores 48 | 1 torre | 48 | Pro **de prueba** (18 días); junta única |
| **Total** | 3 empresas + 5 juntas | **14 condominios** | **46** | **1 120** | |

Usuarios: 1 272 en total. Propietarios 1 120 (uno por departamento), inquilinos 126, administradores 11 (A 3, B 2, C 1, una cuenta por junta), personal 14 (seguridad 7, mantenimiento 4, limpieza 1, jardinería 1; uno de cada rol por empresa grande), superadmin 1.

Por cada condominio: juntas con presidente, tesorero y secretario (22 de block + 2 centrales en A; 12 + 1 en B; 5 + 1 en C; 1 de block en J2 y J4, y una de todo el condominio en J1, J3, J5), conceptos de mantenimiento (cuota, seguridad, limpieza, agua y luz de áreas comunes, fondo de reserva y, donde aplica, aporte a la central y ascensores), medios de pago (37), 6 meses de recibos (mayo–octubre de 2026: 276 recibos, uno por block y mes; 44 459 cargos; S/ 1 301 930 emitidos), pagos (40 562 en total), 27 comunicados, 20 reservas en 5 salones, y en la Empresa A **19 grupos de WhatsApp** asignados (Los Cedros 11 de 14 blocks, Jazmines 6 de 6, Orquídeas 1 de 2, Torre Mirador 1 del condominio) con la instancia de WhatsApp **ficticia** `simulacion-andina`: no se conectó nada real.

Mezcla de pagos al cierre de octubre (unidades por meses de atraso): 818 al día (73 %), 189 con 1 mes (17 %), 113 con 2 a 5 meses (10 %). Hay 43 pagos por validar con voucher y 45 rechazados, al menos 2 y 1 por cliente. La mora automática salió sola donde el plan la trae (Pro y Administradora: A 459 líneas, B 201, C 41, J4 36, J5 42; Gratis y Básico: 0).

Auditoría de coherencia sobre lo que dejó la API (SQL): 0 cargos pagados sin pago validado, 0 cargos en revisión sin pago por validar, 0 pagos validados sobre cargos no pagados, 0 cargos pagados con suma distinta de su monto, 0 cargos cuya unidad no es del block de su recibo, 0 pagos hechos por alguien ajeno a la unidad.

## 3. Separación entre clientes (lo más importante)

**Resultado: 19 416 comprobaciones, 0 fallas.** La base no cambió ni un dato (huella por tabla de 22 tablas, antes y después).

Cómo se probó: 8 clientes × cuentas de cada tipo (administración de cada uno de los 8, tesorero de cada junta, un vecino de cada cliente, personal de A, B y J5) contra los **otros 7** clientes, con ids reales de cada uno sacados de la base.

| Qué | Intentos | Resultado |
|---|---:|---|
| Ids ajenos directos: 44 formas de GET (complejo, block, piso, unidad, personas, usuario, recibo y su consolidado/Excel/impresión, mantenimientos, cargo, pago, comprobante, evaluación, comunicado, concepto, QR, junta, cierres, morosidad, rendición y su Excel, dashboard, cobertura de WhatsApp, uso del plan…) y 56 de PUT/PATCH/DELETE/POST (editar, borrar, anular, validar, rechazar, dar conformidad, pagar, quitar multa, archivar, solicitar plan, cambiar suscripción, registrar pago de suscripción, crear colgando de un condominio/block/unidad/concepto ajeno…) | ≈ 17 200 (18 991 con las de la fila siguiente) | **Todos rechazados.** La administración recibe **404** (igual que un id inexistente: no se puede averiguar qué existe en otro cliente); la junta, el vecino y el personal reciben 403/404 según el rol. Las altas con una referencia ajena responden 422 «no existe o no tienes acceso». 18 669 son rechazos «fuertes» (403/404 o 422 que nombra la referencia ajena); 322 son otros 4xx (casi todos J2 en solo lectura, 409). |
| Contenedor propio + referencia ajena: mover una unidad/usuario/recibo/comunicado/concepto a otro cliente, asignar un propietario o miembro de junta ajeno, departamentos ajenos en un comunicado, `rol: superadmin`, importar un Excel de recibos a un condominio ajeno | 22 formas × 56 pares = 1 274 | Rechazadas (422/403/404) o, en 5 formas (`empresa_id`/`complejo_id` en un PUT propio), el servidor respondía 200 pero **ignoraba el campo**: se volvió a leer el recurso y quedó idéntico (sección 9, S1; **ya resuelta**: ahora esas formas responden 422 `CAMPO_DE_AMBITO`). |
| Listados: todas las páginas de recibos, pagos, unidades, usuarios, comunicados, conceptos, blocks, pisos, recibo-conceptos, cargos, condominios, reservas y empresas de cada administración (57 384 filas revisadas) | 310 | **Ninguna fila ajena.** Vecinos: sólo sus unidades y cargos. |
| Búsqueda (`q=`) con el correo/nombre de alguien de otro cliente, «Mantenimiento», «B01», «Corte» | 40 | Sólo filas propias. |
| Totales: dashboard y morosidad de cada administración | 16 | Sólo blocks y unidades propios; en Gratis/Básico la morosidad responde 403 de plan. |
| Mismo cliente, otro block: el tesorero de un block de Los Cedros contra recibos, mantenimientos, cierre y pagos de otro block; un vecino contra la unidad de otro vecino del mismo condominio (ver y pagar) | 8 | 403/404. |
| Excel propio sí baja; Excel ajeno no | 2 + incluidos arriba | OK |
| «Entrar como» (sólo superadmin): administración, tesoreros, vecinos y personal; y la administración sobre alguien de su propia empresa | 23 | 403 siempre. |
| Sesión: sin cookie, cookie inventada, escritura sin CSRF, con el CSRF de otra sesión, cookie en la URL | 5 | 401/403. |
| Superadmin | 3 | Ve los 14 condominios, las 8 empresas y las 14 suscripciones; la administración no entra a suscripciones, catálogo, auditoría ni bandeja de contacto. |
| Controles positivos (para que un 404 no pueda ser una ruta mal escrita) | 8 | Cada ruta probada con recursos **propios** responde 200 (o 403 de plan, o 404 de recurso que ese cliente no tiene); 7 PUT propios con valores iguales responden 200, así que los cuerpos de ataque son válidos. |

**Asistente/IA (capa de herramientas).** No hay modelo de IA en local, así que no se probó una respuesta del chat. Sí se probaron **las mismas herramientas que usa la IA** por `/mcp` con token de API: 7 cuentas (administración de A, B y J4, tesoreros de J4 y A, vecinos de A y J4), 112 herramientas × variantes (sin argumentos, con el nombre de un condominio ajeno, con ids ajenos, con un código de departamento que **sólo existe en otro cliente**), 298 llamadas: **0 respuestas con datos de otro cliente** (se buscó el nombre de cada condominio y empresa ajenos y los dominios de correo ajenos). Control: 65 respuestas sí traen datos propios y `buscar_unidad`/`detalle_unidad` encuentran `B01-101` en lo propio.

## 4. Cada tipo de cliente funciona (41 comprobaciones, 0 fallas)

- **Empresa grande (A):** el selector lista sus 4 condominios; dashboard de cada uno; morosidad de Los Cedros cuadra con la base (110 unidades con cargos vencidos, API y SQL); cierre del mes lista los 14 blocks; cierre de un block, cierre central y aportes de los blocks abren; consolidado del recibo abre; el segundo administrador de A ve lo mismo; el personal de seguridad no ve pagos ni recibos (403).
- **Junta de 1 block (J4, Pro):** la cuenta de la junta emite el recibo de noviembre (204 cargos para 32 departamentos, 1 línea de mora, 729 ms); el tesorero da la conformidad de un pago por validar y la cuenta de la junta lo valida; el tesorero ve el mantenimiento de su block y abre el cierre de su block. J1, J3 y J5 salen como «junta única»; J4 no.
- **Vecino (J4):** ve sus 7 mantenimientos (5 abiertos) y paga con voucher: queda por validar. En el navegador, a 390 px, ve «Deuda total S/ 960.00».
- **Solo lectura (J2, Gratis vencido):** ve dashboard, recibos, pagos, unidades y cierre; **no** puede emitir recibos, registrar pagos, publicar comunicados, crear unidades ni áreas, ni validar pagos (409 `SOLO_LECTURA`, como dice el contrato); el vecino de J2 ve sus recibos y no paga (409 con el mensaje «Habla con tu administración»); el superadmin no queda bloqueado. En pantalla sale la franja «solo lectura desde el 12 de octubre de 2026… Torre Básico desde S/ 40».

## 5. Planes y facturación (81 comprobaciones, 0 fallas)

**Puertas por plan** (según lo que trae cada plan): Pro y Administradora pueden todo; Gratis, Gratis vencido y Básico quedan bloqueados en IA de vouchers (403), asistente (403 `MODULO_NO_ACTIVO`), avisos por WhatsApp (`sin_modulo_whatsapp` y `whatsapp_plan` en la ficha), reportes de morosidad y rendición (403) y conciliación bancaria (403). Pro de prueba (J5) tiene todo mientras dura. La mora automática aparece sólo donde el plan la trae. Administradora (A) puede agregar otro condominio; Gratis (J1) con su condominio ya creado, no.

**Cuánto cobraría Torre al mes** (Mi plan, con los precios vigentes: Básico S/ 2.00, Pro S/ 3.00, Administradora S/ 2.50 por departamento, mínimo 20 por condominio, IGV 18 %; cada total coincide con una fórmula independiente y con lo que ve el superadmin en Suscripciones):

| Cliente | Condominio | Plan | Dptos cobrados | Base | Total mensual (con IGV) |
|---|---|---|---:|---:|---:|
| A | Los Cedros | Administradora | 448 | 1 120.00 | S/ 1 321.60 |
| A | Parque Jazmines | Administradora | 120 | 300.00 | S/ 354.00 |
| A | Torre Mirador del Sur | Administradora | 60 | 150.00 | S/ 177.00 |
| A | Las Orquídeas | Administradora | 24 | 60.00 | S/ 70.80 |
| **A** | | | **652** | **1 630.00** | **S/ 1 923.40** |
| B | Santa Rosa de Lima | Administradora | 192 | 480.00 | S/ 566.40 |
| B | Los Pinos | Administradora | 48 | 120.00 | S/ 141.60 |
| B | Plaza Norte | Administradora | 40 | 100.00 | S/ 118.00 |
| **B** | | | **280** | **700.00** | **S/ 826.00** |
| C | Villa Hermosa | Pro | 50 | 150.00 | S/ 177.00 |
| C | Alameda 18 (18 dptos: se cobra el mínimo de 20) | Pro | 20 | 60.00 | S/ 70.80 |
| **C** | | | **70** | **210.00** | **S/ 247.80** |
| J1 | Los Álamos | Gratis | 8 | 0.00 | S/ 0.00 |
| J2 | San Felipe | Gratis vencido | 12 | 0.00 | S/ 0.00 (en solo lectura hasta que pase a un plan de pago) |
| J3 | Torre Colonial | Básico | 20 | 40.00 | S/ 47.20 |
| J4 | Las Gaviotas | Pro | 32 | 96.00 | S/ 113.28 |
| J5 | Miraflores 48 (Pro de prueba) | Pro | 48 | 144.00 | S/ 169.92 (cotización del plan; hoy no se cobra por la prueba) |
| **Total** | | | | **S/ 2 820.00** | **S/ 3 327.60 al mes** (S/ 39 931.20 al año) |

Hoy, sin contar la prueba de J5, Torre facturaría S/ 3 157.68 al mes con IGV. Peso de cada cliente: A 58 %, B 25 %, C 7 %, las juntas de pago (J3, J4, J5) 10 %.

## 6. Rendimiento con volumen

1 120 departamentos, 276 recibos, 44 459 cargos y 40 562 pagos. Tiempos medidos por la API (4 pedidos seguidos; frío / mediana / máximo, en ms). **Nada pasa de 1,5 s.**

| Pantalla o endpoint | Frío | Mediana | Máx. | Tamaño |
|---|---:|---:|---:|---:|
| Rendición de Los Cedros (reporte de cobranza del mes) | 963 | 1 036 | 1 076 | 48 KB |
| Rendición en Excel (Los Cedros) | 1 052 | 1 044 | 1 071 | 80 KB |
| Dashboard de la Empresa A (4 condominios) | 221 | 201 | 221 | 7 KB |
| Dashboard de Los Cedros (448 dptos) | 182 | 164 | 182 | 4 KB |
| Dashboard global del superadmin | 254 | 248 | 254 | 12 KB |
| Contador de WhatsApp con `evitados` (A, 19 recibos con grupo) | 126 | 126 | 134 | 1 KB |
| Morosidad de la Empresa A (652 dptos) | 67 | 63 | 68 | 28 KB |
| Morosidad de Los Cedros | 58 | 56 | 58 | 27 KB |
| Listado de pagos, página 1 (50) | 36 | 31 | 36 | 85 KB |
| Listado de pagos, página profunda (a 3/4 del total) | 32 | 31 | 32 | 65 KB |
| Cargos, página 1 | 31 | 30 | 32 | 48 KB |
| Consolidado del recibo | 33 | 32 | 33 | 15 KB |
| Cierre del mes (14 blocks) | 29 | 26 | 29 | 4 KB |
| Cierre central de Los Cedros | 27 | 27 | 28 | 3 KB |
| Recibos del mes de octubre (Los Cedros) | 10 | 9 | 12 | 9 KB |
| Mantenimientos de un recibo (32 dptos) | 13 | 12 | 13 | 8 KB |
| Mi plan (3 condominios + uso del mes) | 12 | 11 | 12 | 11 KB |
| Usuarios, unidades (búsqueda «B05»), vecino: Mis mantenimientos, Mis grupos, suscripciones del superadmin | 5 – 21 | | 21 | |

30 pedidos simultáneos de 10 cuentas distintas (dashboard, periodos y `me`): 514 ms en total, el más lento 511 ms, 0 errores 5xx.

## 7. Mensajería inteligente

- **Empresa A (con grupos):** 19 grupos en uso; «Este mes»: 19 mensajes a grupos, **423 mensajes evitados**, 19 enviados. Coincide con un cálculo independiente en SQL (vecinos que habrían recibido el recibo por WhatsApp directo menos el mensaje al grupo, por cada recibo avisado a grupos). La cobertura de Los Cedros dice «11 de 14 blocks con grupo; faltan los blocks 12, 13 y 14». «Mis grupos» de A sólo trae grupos de A; la Empresa B (sin número ni grupos) no ve ninguno.
- **Juntas sin grupos (J4 con el módulo, J1 sin él):** grupos 0, evitados 0, mensajes a grupos 0: no inventa nada.
- El contador es **del mes en curso**: los envíos a grupos se sembraron con la hora de la siembra (se avisó el recibo de octubre a los grupos). Si corres el recorrido en otro mes, vuelve a sembrar.
- Con la emisión de noviembre de J4 (sin grupo de WhatsApp para su block) la respuesta trae la advertencia «El Block 1 no tiene grupo… le llegará por WhatsApp directo a cada departamento»: es lo que dice el diseño.

## 8. Navegador (4 sesiones, un Chromium a la vez; 7 comprobaciones, 0 fallas)

Administradora de A (dashboard y morosidad: ve Los Cedros y **ninguno** de los edificios de otros clientes, sin errores de JS ni 5xx), junta vencida J2 (franja de solo lectura), vecino de J4 a 390 px (ve su deuda en S/) y tesorero de J4 (entra a su panel de junta). Capturas en `scripts/e2e/capturas/mercado-*.png`.

## 9. Problemas y observaciones, en orden de prioridad

**Seguridad: ninguna brecha.** Estas son observaciones para decidir, no fallas:

1. ~~**S1 (bajo): los PUT/POST aceptan y callan campos de empresa/condominio.**~~ **RESUELTA (5-nov-2026, rama `fix/campos-estrictos`).** Un campo de ámbito (`empresa_id`, `complejo_id`, `estructura_id`) que el endpoint no acepta ya responde **422** con `code: 'CAMPO_DE_AMBITO'` en vez de 200/201 callado: `PUT` de `unidades`, `usuarios`, `comunicados`, `conceptos`, `recibos`, `medios-pago` (y `proveedores`, `complejos`, `areas-comunes`, `juntas`), y `POST /api/conceptos` con `empresa_id` ajeno (ya no lo crea en la empresa de quien llama). Si el campo llega con el MISMO valor que el recurso ya tiene, se acepta (200, no cambia nada); con otro, 422 y el recurso intacto. La regla es central en `crudRouter` (`src/server/lib/ambito.ts`) para todo esquema que no declare el campo. Detalle en `docs/API-CONTRATO.md` («Campos de ámbito estrictos»). El recorrido (`scripts/e2e/flujos-mercado.mjs`) ahora espera 422 `CAMPO_DE_AMBITO` en esas 7 formas (**rechazo fuerte**; cualquier 2xx es falla). Pendiente: volver a correr `separacion` con la Mac tranquila para confirmarlo contra la base `house_mercado`.
2. ~~**S2 (bajo): `POST /api/ai-chat` responde 500 «La IA no está configurada en el servidor»** cuando falta la clave.~~ **RESUELTA (5-nov-2026).** Ahora es **503** con el mismo mensaje y `code: 'IA_NO_CONFIGURADA'` (también en `/stream`, como JSON previo al stream). La pantalla del asistente reconoce 503 y 500 con ese texto («El asistente todavía no está configurado»).
3. **S3 (informativo): el inicio de sesión se corta a 10 intentos por cuenta cada 15 minutos**, también los correctos. Está bien para producción, pero hace que una corrida automática repetida dé 429 hasta reiniciar o esperar.

**Pantalla / funcionalidad**

4. **F1 (medio, UX): el resumen de una empresa con varios condominios repite nombres de block.** Con «Todos los condominios», «% cobrado por block» muestra «Block 2» tres veces y «Block 6» dos, sin decir de qué condominio es cada uno (captura `mercado-admin-a-dashboard.png`; la API sí trae el condominio en `por_torre[].complejo`). Con las 3 empresas y varios blocks iguales a «Block 1…14» es ambiguo.
   **Hecho (2026-11-05):** cuando las torres son de más de un condominio, el rótulo lleva el condominio («Block 2 · Los Pinos»), con la misma regla que el selector (`rotuloTorre` en `cobranza/torres.ts`); con un solo condominio queda como antes. La barra usa una columna más angosta sólo en ese caso, con el nombre truncado y su texto completo en `title`. Prueba: `tests/dashboard-rotulo-torres.test.ts`. Pendiente: mirarla a 375 px en navegador.

**Rendimiento**

5. **R1 (medio, vigilar): la rendición de un condominio de 448 departamentos tarda ≈ 1,0 s** (y su Excel ≈ 1,05 s). Es lo más lento medido y el único cerca del 1,5 s; el resto de las pantallas pesadas responde en menos de 0,35 s. Con un condominio de 1 000+ departamentos o más meses de historia puede pasar del límite. `mes.evitados` del contador de WhatsApp hace unas consultas por recibo (126 ms con 19 recibos): conviene cachearlo si una empresa tiene cientos de blocks con grupo (ya anotado en el HANDOFF de mensajería).
   **Hecho (2026-11-05):** la causa era el cobrado previo: una consulta en serie por block (15 en Los Cedros, ≈ 20 ms cada una). Ahora son las mismas 15 sumas, lanzadas en paralelo (`Promise.all`). Los JSON de la rendición (Los Cedros oct y sep, un block, Santa Rosa) salen **idénticos byte a byte** antes y después. Medido por HTTP sobre una copia desechable de `house_mercado` (5 pasadas, mediana): JSON de Los Cedros **0,49 s → 0,32 s**; Excel **0,50 s → 0,32 s**; Santa Rosa (192 dptos) 0,27 s → 0,18 s. A nivel de servicio: 534 ms → 317 ms. Los 1,0 s de esta tabla no se reprodujeron en esta sesión (el código de partida tarda ≈ 0,5 s aquí): la mejora relativa es la que cuenta. Prueba de forma: `tests/rendicion-rendimiento.test.ts`. No hizo falta índice nuevo.

**Datos / simulación**

6. J1 y J2 (8 y 12 departamentos) quedan con pocos vecinos «de muestra» (sin moroso o sin vecino al día según el azar); no afecta a las pruebas (el recorrido lo tolera).

## 10. Lo que NO se verificó

- **IA con modelo real** (respuestas del chat, lectura de vouchers por IA, validación automática): en local no hay claves. Sólo se verificó la capa de herramientas por `/mcp` y que el plan abre o cierra la puerta.
- **Envíos reales** de correo y WhatsApp, Evolution, bots de WhatsApp y Telegram y sus webhooks (`/api/canales/*`). La instancia `simulacion-andina` es ficticia.
- **Prueba de mutación del servidor** (quitar un filtro de empresa y ver que el recorrido lo detecta): `src/**` está fuera de lo permitido. Lo que respalda la sensibilidad de la prueba son los controles positivos (las mismas rutas con ids propios responden 200) y que cualquier 2xx sobre un id ajeno se marca falla.
- **Vencimiento real de planes con el reloj** (por vencer → gracia → vencida), cobro con tarjeta y registro público de una junta nueva (se sembraron los estados, no se recorrió el alta).
- **Carga masiva por Excel propia** (sólo se probó que a un condominio ajeno se rechaza) y **contactos por Excel**, notificaciones, proveedores y tareas (vacíos en la simulación), archivos QR y logos entre clientes (el QR ajeno da 404; no hay QR propios en la siembra).
- **Concurrencia real** (cientos de usuarios a la vez): sólo 30 pedidos simultáneos. **Un cliente de más de 1 120 departamentos** o años de historia.
- **Navegador**: 4 recorridos, no cada pantalla ni cada rol; sólo el vecino a 390 px.

## 11. Decisiones de la siembra (por si las preguntas)

- Una junta independiente es una **empresa con una cuenta `admin` y un condominio de 1 block** (como la crea el registro público: «Administradora o junta»); sus presidente, tesorero y secretario son propietarios con cargo. La mitad de los pagos de las juntas los registra su tesorero, para recorrer también ese camino.
- Los planes se crean **antes** de facturar (la mora automática depende de Pro) y el plazo vencido de J2 se aplica **después** (con el plazo vencido no se podría emitir). Los avisos que dejó la emisión en cola (correo y WhatsApp) se **borran** al terminar: nada puede salir por accidente.
- El seed usa el `prisma` y `createApp()` del servidor, en proceso y con correo, WhatsApp, IA y planificador apagados por entorno.
