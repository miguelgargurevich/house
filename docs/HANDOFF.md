# HANDOFF — house

Registro entre agentes de código (Claude Code, OpenCode, Cline…). Una entrada por sesión significativa, la más reciente arriba. Actualiza secciones; no reescribas la historia ajena.

---

## 2026-10-28 — Claude Code (Sonnet 5.5) — Oferta «Gratis con límite o Pro con todo»

**Pedido de Miguel (textual):** «Me parece que el plan gratis no debe de incluir servicios con WhatsApp o IA, porque finalmente podrías tener para administrar un edificio de 20 departamentos o menos, y usando IA o WhatsApp, y te sale 20, menos de 25 soles al mes, y es muy poquito. O sea, la oferta debería ser o gratis con un límite, y luego el siguiente plan ya es el Pro, que ya contiene todo, pues, ¿no?» → «Gratis hasta 20 departamentos», «Mínimo de Pro S/ 59 al mes», «Administradora con el mismo mínimo por condominio». Rama `feat/planes-gratis-pro` (sobre origin/main f06e69d). **Sin push.**

- **Modelo (aditivo):** `PlanComercial.unidades_maximas Int?` (Gratis = 20) y `unidades_minimas Int?` (Pro y Administradora = 20). Nada de variables de entorno: se editan en Suscripciones › Precios (`PUT /api/comercial/planes/:clave`).
- **Capacidades:** `CAPACIDADES` = los 3 módulos + `mora_automatica` + `reportes` (`catalogo.ts`). Pro, Administradora y Cortesía las traen; Gratis ninguna. **Cortesía las trae SIEMPRE en el código** (`estado.ts`), aunque la fila `cortesia` de la base todavía no liste las nuevas: Los Libertadores no cambia ni antes de correr el script.
- **Cálculo:** `max(unidades, mínimo) × precio`, IGV una vez (`calculo.ts`: `unidades_cobradas`, `minimo_aplicado`). Pro 10 deptos = 59.00; 100 = 295.00; Administradora 10 = 47.20. El mínimo es del plan: un módulo suelto heredado se cobra por las unidades reales.
- **Módulos sueltos:** ya no se piden (`POST …/solicitud` sólo `{ plan }`) ni se cotizan (`/api/publico/cotizar` ignora `modulos`; el catálogo público manda los módulos sin precio). Una suscripción que ya los tenía los conserva hasta que cambie de plan (PATCH de plan o pago del plan solicitado los vacía; nunca se borran filas).
- **Puertas nuevas:** mora automática (`montoDeMoraAplicable` en `services/mora.ts`, usado al emitir y al importar el Excel y en los recordatorios de `avisos/cola.ts`: en Gratis el monto aplicado es 0, el recibo se emite igual) y reportes (`GET /api/reportes/morosidad` → 403 `MODULO_NO_ACTIVO` `modulo: 'reportes'`; un admin sólo ve los condominios con la capacidad; superadmin siempre).
- **Límite de Gratis:** `exigirCupoDeUnidades` (`modulos.ts`) en `POST /api/unidades` y al mover una unidad a otro condominio → 403 `LIMITE_UNIDADES` «El plan Gratis llega hasta 20 departamentos; pasa a Pro desde Mi plan». Cuenta TODAS las unidades del condominio (igual que lo que se factura). Un plan vencido pasado la gracia cuenta como Gratis. Nada se borra ni se esconde. **El Excel de recibos NO crea unidades** (sólo salta filas sin unidad): no hay límite que poner ahí.
- **Script para producción:** `npx tsx scripts/oferta-gratis-pro.ts --seco` (muestra) y sin `--seco` (aplica). Idempotente; pone tope/mínimos, capacidades de cada plan y los textos/viñetas; NO toca precios ni suscripciones. Probado sólo en bases locales.
- **Frontend:** /precios (calculadora sin casillas de módulos, aviso de tope y de mínimo, «Lo que trae Pro», comparativa Gratis vs Pro, FAQ con el tope y el mínimo tomados del catálogo), Mi plan (sin módulos sueltos, «Pasar a Pro», alerta de tope), Suscripciones › Precios (tope y mínimo editables), `AvisoModulo` «Disponible en el plan Pro» con enlace a Mi plan, Morosidad con ese aviso en vez de un error, y el modal de unidades explica el límite. `useList` expone `errorCode`.
- **Tests:** `tests/oferta-gratis-pro.test.ts` (backend: cálculo, API pública, topes editables, puertas, cortesía intacta, reportes, mora, límite, script) y `tests/oferta-ui.test.ts`; se ajustaron `comercial-api`, `comercial-modelo`, `comercial-registro`, `precios-publico`, `movil-ui`.
- **Para correr en producción tras desplegar (orquestador, con OK de Miguel):** 1) deploy (el `db push` agrega las 2 columnas); 2) `npx tsx scripts/oferta-gratis-pro.ts --seco` y luego sin `--seco` contra la base de producción; 3) comprobar en /precios y que Los Libertadores siga en cortesía con mora y reportes. Hasta correr el script, Pro/Administradora no traen mora ni reportes (no hay clientes de pago hoy; Cortesía sí los trae por código).
- **Gotchas:** (1) `prisma generate` con `node_modules` enlazado escribe en el cliente del checkout principal (sólo agrega 2 campos nullable); (2) la validación del tope usa `prisma.unidad.count` por condominio (una consulta, sin caché); (3) el CSV de «Exportar» en Morosidad se arma en el navegador con lo que ya cargó: el 403 del reporte lo cubre porque sin reporte no hay filas; (4) el mensaje de evaluación sin IA sigue diciendo «Disponible con el módulo…» (`MOTIVO_SIN_MODULO`, lo reconoce el frontend por su texto).
- **No verificado:** el script contra una copia de producción; Mi plan y Suscripciones con datos reales de Los Libertadores (448 unidades); el flujo de pago de Pro de punta a punta con un pago real.

---

## 2026-10-28 — Claude Code (Sonnet 5.5) — Rediseño de la página pública /precios

- **Qué se hizo** (sólo frontend público; nada de `src/server`, prisma ni admin): `Precios.tsx` ahora compone `precios/Recibo.tsx` (la calculadora como «recibo de House»: departamentos con − / + y atajos 20·50·100·250, plan Gratis/Pro/Administradora, módulos, total al mes y al año), `Planes.tsx` (Pro como campo de color entero; Gratis y Administradora debajo), `Modulos.tsx` (cada módulo con un fragmento de su interfaz de ejemplo, precio y botón «Sumar a mi recibo»), `Comparativa.tsx` (la tabla de antes, con la columna Pro en otro tono y sin líneas), `Preguntas.tsx` (texto corrido, sólo lo que House hace hoy) y un cierre con llamada a la acción. En escritorio el recibo queda fijo (sticky) mientras se leen planes y módulos; en el celular va justo después de la cabecera.
- **Dirección de arte** (skill `design-taste-frontend`, dirección «split stage» con `--keep palette,type`): tokens, Figtree y radios del proyecto; sin gradientes, sombras ni líneas finas en la página (tonos de superficie en su lugar). `Aparece.tsx` = entrada por scroll (sólo opacidad y desplazamiento; si no hay `IntersectionObserver` todo queda visible); `.sube` / `.sube-corto` en `index.css`.
- **Registro cerrado**: antes la página ignoraba `registro_abierto` y siempre ofrecía «Crear cuenta» (que fallaba con 503). Ahora, con `registro_abierto=false`, la cabecera, los planes y el cierre ofrecen «Ingresar» y la página dice que el registro está cerrado. `Marco` muestra «Crear cuenta» sólo con el dato en `true` (mientras llega, no lo muestra). `catalogo.ts` hace una sola petición a `/api/publico/planes` para el marco y la página. `Marco` ganó la prop `completo` (contenido de borde a borde, sin líneas en cabecera/pie).
- **Precios**: ninguno escrito en el código; planes y módulos salen del catálogo y los totales de `/api/publico/cotizar` (test de fuente lo vigila). Datos de ejemplo en los fragmentos (S/ 350.00, B01-804) son ilustrativos y no son precios del catálogo.
- **Tests**: nuevo `tests/precios-publico.test.ts` (renderiza Planes/Modulos/Comparativa con un catálogo de precios inventados + guardas de fuente); `tests/movil-ui.test.ts` apunta ahora a `precios/Comparativa.tsx` (mismo sentido: la tabla no fuerza ancho mínimo en el celular).
- **Gotchas**: (1) `Recibo.tsx` no se puede renderizar en un test: arrastra `src/api.ts`, que usa `import.meta.env` (sólo existe bajo Vite); por eso su test es de fuente. (2) Con Gratis + módulos el servidor cotiza bien (`plan=gratis&modulos=…`). (3) En `lint.mjs` de la skill queda un FAIL «hairline» en `Marco.tsx` (`border-b`/`border-t` de las otras pantallas públicas: Registro, Verificar correo); en `/precios` no se aplican (`completo`). (4) Dos tests de backend (`integraciones`, `resiliencia`) fallaron una vez por timeout con la Mac cargada; solos y en la segunda corrida completa pasan.
- **Pendiente / decisiones para Miguel**: no hay fotografías ni video (la skill pide ≥ 4 imágenes: no se pusieron fotos de stock a propósito, para no mostrar condominios que no son clientes; hay fragmentos de la interfaz en HTML). Si la portada (`Portada.tsx`) queda desentonada, alinearla es un cambio chico (no se tocó). Los textos de las preguntas frecuentes se pueden afinar; verifica «Transferencia, Yape o Plin» contra lo que cargues en Suscripciones › Precios y pagos.

## 2026-10-27 — Claude Code (Opus 5.5) — Integración del recibo como el impreso + ajustes

- Integré los 3 commits de Sonnet (lecturas de agua, datos del recibo, deuda acumulada, recibo imprimible). Revisado: alcance de rutas de agua (recibo accesible + unidad del recibo), deuda con consulta parametrizada (sólo meses anteriores).
- Agregué «Lecturas de agua» al menú de la junta (`nav.ts`; Sonnet no podía tocarlo) y fondo blanco al imprimir (`index.css`: el fondo gris de la página salía bajo el recibo con «gráficos de fondo»).
- Comparado con el PDF de VRANY (B01-804, octubre) en local: mismo orden y montos. Diferencia conocida: con factor 4.93 el agua calcula S/ 70.61 y VRANY imprime 70.63 (usa más decimales en el factor); queda bajo la alerta de S/ 0.05.
- Datos que carga Miguel en producción: cuenta BCP real y CCI (Medios de pago), correo del block (ficha de la torre), notas de pago y contacto de administración (ficha del condominio), foto de cabecera y logo, y las lecturas de cada mes (Recibo › Agua o la plantilla).
- Suite 1625/1625, tipos y build en verde.

## 2026-10-27 — Claude Code (Sonnet 5.5) — Recibo impreso como la primera cara del impreso de VRANY + lecturas de agua

**Pedido de Miguel (textual):** «ya llego el recibo impreso del mes actual mira como mandan la primera cara, la segunda cara es el excel que ya revisamos , con eso puedes completar los datos que faltan ademas hay otros datos que debes considedar revisa» → «Agua + recibo como el impreso». Referencia: `.claude/worktrees/recibo-impreso-referencia.pdf` (B01-804, octubre 2026). Rama `feat/recibo-impreso` (sobre origin/main 2307f7f), tres commits: modelo y backend · pantallas · recibo imprimible. **Sin push.**

- **Lecturas de agua** (`LecturaAgua`, único `unidad_id + recibo_id`): consumo = actual − anterior (3 decimales), monto = m³ × factor (2 decimales, half-up) con `Decimal`; validaciones (actual ≥ anterior, factor > 0, fechas en orden). Carga a mano (tabla editable en el periodo → pestaña «Agua y datos del recibo»), por Excel/CSV con plantilla descargable (trae los deptos con la lectura y fecha anteriores ya puestas), y foto del contómetro (≤ 2 MB). La anterior se precarga con la actual del mes previo; el factor se pone una vez para la torre. Cruce con «AGUA DPTO.»: aviso si difiere > S/ 0.05; **no cambia montos ni cargos**. Admin y junta del block (la junta, sólo su block, también en un recibo general sin torre). `docs/EXCEL-RECIBOS.md` tiene el formato.
- **Datos del recibo en la base:** `Recibo.fecha_corte_agua`; `Estructura.correo_vouchers` («correo del block»); condominio: `notas_pago` (vacías: las escribe el admin), contacto de administración (nombre/celular/correo) y foto de cabecera; empresa: logo. Imágenes en la tabla aparte `ImagenRecibo` (así ningún CRUD arrastra bytes) con endpoint autenticado y alcance (los residentes del condominio las ven). Pantallas: ficha del condominio (Datos), torre (modal), Mi empresa (logo), periodo (corte y correo).
- **Deuda acumulada** (`lib/mantenimientos.ts › deudaAcumulada`): saldo de periodos ANTERIORES de la unidad (no cuenta el mes en curso ni lo que está en revisión); se calcula al mostrar. **Saldo a favor: no existe en el modelo** (el pago es siempre el saldo exacto), así que sólo hay deuda. `total_general` = total + deuda; `docs/COBRANZA.md` §4.
- **Recibo imprimible rehecho** (`ReciboImprimible.tsx`): mismo orden que el impreso (foto + condominio + dirección, año/mes/emisión, propietario/block/dpto, tabla con bordes con la multa en 0.00, total mantenimiento, deuda, total, lectura de contómetro + detalle del consumo, banner del banco, caja de cuenta del block con correo, vencimiento y corte de agua, notas, contacto, logo). Hoja blanca fija (también en modo oscuro). Un bloque sin dato se omite sin dejar huecos. Verificado en Chromium: A4 → 1 página; 375 px sin desborde. El banner «CANCELAR ÚNICAMENTE EN AGENTES {BANCO}…» se arma con el banco de la cuenta de la torre (no es texto cargado a mano).
- **Residente:** el detalle trae consumo de agua (foto ampliable), corte, deuda acumulada, total general y contacto; las notas de pago y el correo del block salen junto a «Cómo pagar». **Asistente:** `mis_recibos` agrega `consumo_agua` y `fecha_corte_agua` (sólo su unidad); el prompt y `RUTAS_JUNTA` conocen `/junta/agua`.
- **Junta:** pantalla `/junta/agua` (reusa la del admin). **Falta el ítem de menú**: `src/app/nav.ts` estaba fuera de «Permitidos»; por ahora se llega desde un botón en «Pagos por validar». Siguiente paso: añadir `{ to: '/junta/agua', label: 'Lecturas de agua' }` al grupo `JUNTA` de `nav.ts`.
- **Pruebas:** suite completa 1625/1625 (+68 sobre 1557); `tests/agua-lecturas.test.ts`, `recibo-datos.test.ts`, `recibo-impreso-ui.test.ts` (renderiza el componente de verdad), `agua-ui.test.ts`; se ajustaron `impresion-recibo`, `torre-ui` (y `medios-avisos` sigue igual) al recibo nuevo. 26 mutaciones (alcance, cálculo, deuda, imágenes, recibo) todas en rojo.
- **Gotchas:** (1) un CSV se lee con `raw: true` (si no, SheetJS interpreta «10/09/2026» a la americana); (2) en zod 4 el `superRefine` corre aunque un campo ya haya fallado: hay que protegerlo; (3) `sr-only` es `absolute`: dentro de un `overflow-x-auto` sin `relative` ensancha toda la página; (4) para probar el front en otro puerto el backend necesita `CORS_ORIGIN=http://localhost:<puerto>` (si no, 403 «el origen no coincide»); (5) `vaciarBase` ya limpia las tablas nuevas (TRUNCATE … CASCADE); (6) `prisma format` reordena todo `schema.prisma`: no lo corras si quieres un diff chico.
- **No verificado:** impresión en papel o con «Gráficos de fondo» desactivado en otro navegador; modo oscuro del recibo (diseñado fijo en blanco, sin captura); el esquema sólo se aplicó en `house_test_rec` (producción hace `db push` al arrancar: todo es aditivo); el Excel real de lecturas de VRANY (no hay ejemplo: la plantilla es nuestra); fotos reales de celular de ~2 MB; rendimiento con las 448 unidades de Los Libertadores; Safari/Firefox en los campos de fecha.

---

## 2026-10-27 — Claude Code (Opus 5.5) — Revisión de la vista móvil de toda la app

**Pedido de Miguel (textual):** «revisa el modo vista mobile de toda la aplicacion»

- Barrido con Playwright a 375×812 (claro y oscuro) de 48 pantallas: público, superadmin, admin, propietario, inquilino y junta (no hay cuentas de prueba de mantenimiento/seguridad/limpieza/jardinería). Ninguna desbordaba la página ni tenía errores de consola; los problemas estaban DENTRO de tarjetas y tablas (recortados por su `overflow`), y se vieron en las capturas.
- Arreglos: «Pagar mantenimiento» se cortaba en la tarjeta del residente (inicio y Mis recibos) → botones en su propia fila en el celular; `DataTable` con `px-3` en el celular (`sm:px-5` igual que antes); columnas de acción ocultas en el celular con la fila tocable (Empresas, Auditoría, mantenimientos del recibo); Tipo oculto en Condominios; titular bajo el medio en Medios de pago; textos largos que bajan de línea (Conceptos, Auditoría, Recibos); plan bajo el condominio y botones apilados en Suscripciones; comparativa de precios sin ancho mínimo; «Crear cuenta» sin partirse; ficha de empresa que quedaba «cargando» sin fecha de inicio.
- Queda con desplazamiento lateral (aceptable): barras de pestañas largas (Mantenimiento, Suscripciones, Avisos, ficha del condominio) y una columna de íconos de acción en Conceptos/Pagos (≤ 24 px).
- Prueba `tests/movil-ui.test.ts`. Suite 1551/1551 (+5), tipos y build en verde.
- Gotcha: el login local tiene tope de 10 intentos/15 min por IP (en memoria): para barridos, un login por rol y reiniciar el backend entre corridas.

- Después («crea una cuenta de prueba y revisa esas pantallas»): `.claude/cuentas-prueba-local.ts` (sólo base local) crea también mantenimiento, limpieza, jardinería y seguridad de VRANY, con una tarea de ejemplo cada uno de los de tareas. Barrido de sus 12 pantallas: sin desbordes ni errores. Arreglos: `StatStrip` deja bajar de línea los textos (el nombre del condominio en el Inicio de Seguridad salía cortado) y en Unidades de Seguridad el residente baja de línea (cortaba la columna Estado). Suite 1557/1557.

## 2026-10-27 — Claude Code (Opus 5.5) — Página «Canales e integraciones» (superadmin)

**Pedido de Miguel (textual):** «tambien debenmos separar la seccion de telegram y ocr de la pagina de llaveros de IA quiza debe tener una seccion junto con wasap» → «Sí: arma la página «Canales e integraciones» con WhatsApp, Telegram y OCR cuando integres el comercial.»

- Nueva `src/pages/superadmin/Integraciones.tsx` (`/superadmin/integraciones`, menú Plataforma): **WhatsApp** (servidor Evolution listo o qué variable falta; por administradora: número vinculado, si el bot recibe mensajes —webhook registrado— y cuántas personas lo vincularon), **Bot de Telegram** y **OCR de comprobantes** (los mismos componentes `TelegramSeccion`/`OcrSeccion`, que salieron del Llavero). El Llavero de IA queda con proveedores, gateways y dominios permitidos.
- API: `GET /api/llavero/whatsapp` (sólo superadmin; sin nombre de instancia, token ni contactos). Prueba `tests/integraciones.test.ts`.
- Asistente: `rutasApp.ts` y `ai-system-prompt.txt` conocen la ruta nueva. Pruebas de pantalla/menú actualizadas a la nueva ubicación.
- Suite 1551/1551, tipos y build en verde. Revisado en navegador (escritorio y 375 px, sin desborde).
- **Ojo (comercial v1):** la página de precios dice que «Mora automática» y «Reportes y exportes» son sólo de Pro, pero el código no los limita: hoy funcionan también en Gratis. Decidir con Miguel si se limitan o se corrige la tabla.

- Después, a pedido de Miguel («el wasap esta en 2 menus… no deberia estar todo en un solo lugar?»): el superadmin ya no tiene «WhatsApp» (QR) en Operación; esa pantalla es de cada administradora (usa SU empresa; al superadmin no le servía). El superadmin ve WhatsApp sólo en «Canales e integraciones». Prueba en `tests/torres-fichas-ui.test.ts`.

## 2026-10-27 — Claude Code (Sonnet 5.5, delegado) — Comercial v1: planes, módulos por condominio, registro público y cobro manual

**Pedido de Miguel (textual):** «revisa el proyecto de invoice, busca la seccion comercial para que los usuarios se registren .. algo de eso cree y podemos reutilizar para la parte comercial "Comercial Planes, módulos por condominio, página de precios, cobro de la suscripción"» → «Primera versión con cobro manual (transferencia/Yape y la activación la hago yo); el cobro con tarjeta después.»

**Qué se hizo**
- **Modelo** (aditivo): `ModuloComercial`, `PlanComercial`, `SuscripcionCondominio`, `PagoSuscripcion`, `ConfiguracionComercial` (fila única), `TokenVerificacionCorreo` y `Usuario.correo_verificado` (default `true`). Seed idempotente que SOLO crea lo que falta (no pisa precios editados): módulos IA vouchers S/ 1,00 · WhatsApp S/ 1,00 · Asistente S/ 0,50 (BASE); planes gratis 0 · pro 2,50 · administradora 2,00 · cortesía 0 (oculto). IGV 18 %, gracia 7 días, aviso 5 días antes. `SuscripcionCondominio` y el cobro con tarjeta: `proveedor_pago`/`proveedor_ref` quedan reservados, sin implementar.
- **Puerta por módulo** (`services/comercial/modulos.ts`, una consulta + caché de 30 s invalidable): IA de vouchers (`evaluacion.ts`: sin módulo no se llama a IA ni a OCR; queda `no_disponible` con motivo; pedirla a mano → 403), avisos por WhatsApp (`avisos/cola.ts`: `omitida` «Plan sin WhatsApp», el correo sigue; Telegram «Plan sin asistente»), asistente web y bots (`prepararTurno` + `atenderMensaje`: «Tu condominio no tiene el asistente activo…»). Vencida pasada la gracia = Gratis; **no se borra ni bloquea ningún dato**.
- **Registro público** `/registro` → una transacción (empresa + admin + condominio Gratis + contrato + token), correo de verificación obligatorio, sin enumerar correos, límites por IP y por correo, señuelo. Detalle en `SEGURIDAD.md`.
- **Pantallas**: portada `/`, `/precios` (calculadora y tabla; todo precio sale de la API), `/registro`, `/verificar-correo`, Login con «reenviar enlace», **Mi plan** (admin), **Suscripciones** (superadmin: lista, registrar pago, plan/módulos, historial, precios y datos de pago), avisos «Disponible con el módulo X» en el panel de evaluación, Avisos › Canales y el chat de IA.
- **Vencimientos** en el ciclo del planificador de avisos (cada 15 min, sólo si `AVISOS_PLANIFICADOR`/producción): correo N días antes, al vencer (con los días de gracia) y al apagarse; idempotente por periodo (`aviso_*_para`).
- **Migración a cortesía**: al arrancar el servidor, UNA vez (marca `ConfiguracionComercial.migracion_cortesia_at`), los condominios que ya existen pasan a plan `cortesia` con todos los módulos y sin vencimiento → producción se comporta igual que hoy. Manual y en seco: `npx tsx scripts/migrar-comercial.ts --seco` (sin `--seco` aplica).
- **Pruebas**: +108 (modelo, registro, puertas, API, pantallas). Helper `tests/helpers/app.ts`: `sembrar()` deja los dos condominios en cortesía (como producción) y `darCortesia(...ids)`; `vaciarBase()` re-siembra el catálogo; la caché va en 0 en pruebas.

**Cómo activar un pago (Miguel)**
1. El cliente pide un plan/módulos en **Mi plan** → te llega un correo (a `correo_superadmin`) con el monto y la referencia `HOUSE-<id>-<AAAAMM>`; en Suscripciones aparece primero como «Solicitada».
2. Cuando llega su transferencia/Yape: **Suscripciones › Registrar pago** (monto con IGV, fecha, medio, N.º de operación, periodo cubierto). Eso activa lo solicitado y extiende `vigente_hasta` hasta el fin del periodo. Una misma operación no se puede registrar dos veces.
3. Sin solicitud previa: **Plan** (cambia plan/módulos, con vigencia) y luego Registrar pago. «Vigente hasta» vacío = no vence.
- Renovar: Registrar pago con el periodo siguiente (se suma al vencimiento actual, nunca lo acorta). Vencida: 7 días de gracia con los módulos encendidos; después se apagan y un pago los vuelve a encender.

**Cómo cambiar precios**: Suscripciones › «Precios y pagos». Precio BASE (sin IGV) por módulo y por plan; al lado se ve lo que verá el público. IGV, días de gracia, aviso, correo de avisos, URL pública y datos de pago en la misma pestaña. Todo en la base (nada en variables de entorno); cambia al instante la página pública y Mi plan.

**POR CONFIRMAR con Miguel (no los inventé)**
- **IGV 18 %** como tasa vigente y que los precios publicados sean base × 1,18 (S/ 1,18 · 1,18 · 0,59 · Pro 2,95 · Administradora 2,36). Editable en Precios y pagos.
- **Datos bancarios / Yape reales**: la configuración se crea VACÍA de datos de pago (Mi plan avisa «aún no hay datos»). Cárgalos antes de abrir el registro. Lo mismo con `correo_superadmin` (sin él no llegan los avisos de registros ni solicitudes). `url_publica` arranca en `https://house.gargurevich.dev`: confírmala.
- **Plan Administradora**: hoy es S/ 2,00 fijo por depto con los tres módulos; el «descuento por volumen» (tramos) NO está modelado.
- El correo depende de Resend (`RESEND_API_KEY`/`MAIL_FROM`, ya en producción). Sin ellos el registro crea la cuenta pero nadie puede verificar el correo.

**Decisiones / gotchas**
- Un condominio **sin fila de suscripción es Gratis**: los condominios que se creen DESPUÉS del despliegue (por el superadmin o el admin) NACEN sin módulos de pago; si quieres que sean cortesía, ponlos en Suscripciones › Plan. El registro público les crea su fila Gratis.
- `ContratoAdministracion` NO se reutilizó (es administradora↔condominio, no la suscripción a House).
- Solicitar no activa nada; sólo registrar un pago (o el cambio manual del superadmin) lo hace.
- El asistente se evalúa por persona: basta UN condominio con el módulo entre los suyos (administradora con varios); superadmin siempre. Un admin sin empresa ni condominio ya no puede usar el asistente (se ajustó un caso de `asistente.test.ts`).
- `voucher` del pago de suscripción: sólo `voucher_ref` (texto libre: nombre/ID del comprobante); no se sube archivo en esta versión.
- Con varias réplicas, un cambio de plan puede tardar hasta 30 s en verse en las otras (caché por proceso).
- Probar la app compilada DENTRO de `.claude/worktrees/…`: `res.sendFile` devuelve 404 por la carpeta con punto en la ruta (pasa con cualquier ruta SPA, no sólo las nuevas); en producción (`/app/dist`) no ocurre. Para ver `dist/` en local, sírvelo desde una carpeta sin punto.
- Pendiente (siguiente fase): cobro con tarjeta (Culqi o Mercado Pago) sobre `proveedor_pago`/`proveedor_ref`; subir el voucher del pago; tramos de descuento por volumen; CAPTCHA si hay abuso del registro.

---

## 2026-10-27 — Claude Code (Opus 5.5) — Alerta de secretos de GitHub en la prueba de Telegram

- GitHub avisó «Telegram Bot Token» en `tests/bot-telegram.test.ts` (commit 7949052). **Falso positivo**: era el token de ejemplo de la documentación de Telegram; el token real del bot está sólo cifrado en producción.
- Los tokens falsos de la prueba ahora se arman en tiempo de ejecución (no hay literal con forma de token). 57/57 en verde.
- Próximo paso (Miguel): cerrar la alerta en GitHub como «Used in tests».
- Gotcha: en pruebas, nunca escribir literales con forma de token real (`\d+:AA…`, `sk-…`, etc.); armarlos al vuelo.

## 2026-10-27 — Claude Code (Opus 5.5) — Cuatro detalles de pantalla tras la revisión en navegador

**Pedido de Miguel (textual):** «Sí: arregla los cuatro detalles después de integrar Telegram.»

- **Avisos › Canales**: WhatsApp ya no dice «Configurado» sólo porque el servidor tiene Evolution; si la empresa del admin no tiene número vinculado (`whatsapp_instance`), `/api/notificaciones/canales` devuelve `sinNumero: true` y la tarjeta dice «Sin número» con enlace a `/admin/whatsapp`. Prueba en `tests/avisos.test.ts` (mutación en rojo).
- **Dominios permitidos**: si se pega una URL completa, la pantalla se queda con el dominio (`soloDominio`); el servidor valida igual que antes.
- **Modal de gateway**: el ejemplo del modelo de visión es `nvidia/nemotron-3.5-super-vl-120b-a12b`.
- **Interruptor** (`catalogo/Interruptor.tsx`): `aria-label` con su etiqueta (antes los lectores leían «on»). `Badge` ya no parte el texto en dos líneas (`whitespace-nowrap`).
- Revisado en navegador (local, escritorio y 375 px): Llavero (dominios, gateway con prioridad 0 para comprobantes, OCR, bot de Telegram), condominio (mora S/ 20), detalle de pago, Mi perfil, Avisos. Suite 1431/1431 (una corrida previa tuvo 1 falla intermitente que no se repitió).

## 2026-10-27 — Claude Code (Sonnet 5.5, delegado) — Bot de Telegram: asistente + voucher por foto (Fase C)

**Pedido de Miguel (textual):** «planea el bot de WhatsApp primero (asistente + voucher por foto), Telegram después» → (WhatsApp ya integrado) «hazlo» (arrancar Telegram). Regla obligatoria: «nada de variables de entorno todo en BD». Rama `feat/bot-telegram` (worktree sobre `origin/main` 280e012); **sin push** (lo sube la sesión principal con OK de Miguel).

**Qué se hizo**
- **Refactor mínimo de la capa común** (`services/canales/`): `transporte.ts` define `Transporte { canal, identificador, empresaId | null, responder(texto), descargarMedio(medio) }` y `MensajeEntrante`. `entrante.ts` gana `atenderMensaje(transporte, mensaje)` (todo lo común: límites, vínculo, código, comandos, voucher, asistente); `procesarEntrante(instancia, empresaId, e)` de WhatsApp queda como un envoltorio fino (Evolution: `responder` + `getBase64FromMediaMessage`) con la MISMA firma. `voucher.ts` ya no sabe de Evolution (`bajarArchivo` usa el transporte; acepta base64 o bytes) y el canal va a la observación/auditoría del pago. Los textos del bot salen de `mensajes(canal)`.
- **Esquema** (aditivo): tabla `ConfiguracionTelegram` (fila única id = 1: `token_enc`, `ultimos4`, `bot_usuario`, `bot_nombre`, `habilitado`, `secreto_hash`, `webhook_url`, `webhook_registrado_at`).
- **Llavero**: sección «Bot de Telegram» (`TelegramSeccion.tsx`) y `/api/llavero/telegram` (PUT guardar+probar+activar, POST `/probar`, PATCH activar/pausar, DELETE quitar). Sólo superadmin, auditado sin el token. Al guardar/activar: `getMe` + `setWebhook` a `<ENLACE_APP>/api/canales/telegram` con `secret_token` aleatorio (sólo su hash en la base), `allowed_updates: ['message']`, `drop_pending_updates`. Al pausar/quitar: `deleteWebhook`.
- **Webhook** `POST /api/canales/telegram` (`routes/canalesWebhook.ts › canalesTelegramRouter`, montado antes del JSON global): secreto en tiempo constante antes de leer el cuerpo (64 kB), ignora no-privados/bots/ediciones/canales, idempotente por `update_id` (`MensajeCanal` con `instancia='telegram'`), 200 rápido y cola por chat.
- **Vinculación**: `chat.id` privado; `/start <código>` o código a secas; Mi perfil (`TelegramPerfil.tsx`) muestra el código y el enlace `https://t.me/<bot>?start=<código>`. Bot GLOBAL: la empresa del vínculo sale de la persona del código (`intentarVincular` acepta `empresaId: null`). Sin vínculo sólo «Vincula tu Telegram desde Mi perfil en House».
- **Asistente y voucher**: mismas herramientas, permisos, límites y conversación por vínculo que WhatsApp. Respuestas en TEXTO PLANO sin `parse_mode` (`aTextoPlano`), ≤ 4.000. Foto (mayor resolución) o documento: tope 2 MB por `file_size` del mensaje, luego `getFile`, y corte durante la descarga (`telegram.ts › leerConTope`).
- **Avisos** (`avisos/cola.ts`): `pago_validado`/`pago_rechazado` también por Telegram al chat vinculado (`Notificacion.canal = 'telegram'`).
- **Docs**: `SEGURIDAD.md › Bot de Telegram`, `API-CONTRATO.md` (webhook, Llavero, `/api/me/canales`).

**Pasos para Miguel (producción)**
1. En Telegram, abre **@BotFather** → `/newbot` → nombre y @usuario (termina en `bot`) → copia el **token** (`123456789:AA…`).
2. Desplegar (el arranque corre `prisma db push` sin `--accept-data-loss`; sólo se añade una tabla). **No hay variables nuevas** (usa `LLAVERO_ENC_KEY`, que ya está).
3. Entra a House como superadmin → **Llavero** → sección **«Bot de Telegram»** → «Configurar bot» → pega el token → «Guardar y probar». Debe aparecer `@tu_bot` y el estado «En uso». Eso ya registró el webhook (puedes usar «Probar» para repetir `getMe`, «Pausar»/«Activar», «Quitar»).
4. Cada persona entra a **Mi perfil** → «Asistente por Telegram» → «Vincular Telegram» → toca el enlace (abre el bot con el código ya puesto) y pulsa «Iniciar». También sirve escribirle el código de 6 dígitos al bot.
5. Prueba sugerida con tu cuenta: `/menu`, «¿cuánto debo?», una foto de voucher (con varios pendientes pregunta «¿Cuál pagaste?»), y `/desvincular`.

**Decisiones**
- **Token en tabla propia** (no en `ClaveIntegracion`): ésta es una lista de claves de proveedores de IA con rotación, modelos, reserva y prueba por chat; el bot es una sola fila con ciclo de vida distinto (webhook), igual que `ConfiguracionOcr`. Mismo cifrado (`secretBox`, AAD `telegram:bot`).
- **Secreto del webhook sólo hasheado** y rotado en cada activación (no depende de `LLAVERO_ENC_KEY` para validar; no se puede recuperar).
- **Empresa de un residente con unidades en varias empresas**: la de menor id (no hay selector; es la limitación honesta del bot global).
- **Texto plano** en vez de HTML de Telegram: cero superficie de inyección de etiquetas (se aceptaba cualquiera de las dos).
- **Aviso por Telegram a todo vínculo vigente** (como WhatsApp: vincular es la aceptación), no sólo si el voucher se mandó por Telegram: el pago no guarda por qué canal llegó. Fácil de afinar usando la observación del pago.
- Cubo de fallos de vinculación GLOBAL más holgado (300/15 min) para Telegram: sin empresa conocida, un cubo de 30 dejaría que unas pocas cuentas bloqueen a todos.
- `tests/bot-whatsapp.test.ts`: UNA expectativa cambió (la que decía «Telegram todavía no → 422» ahora es 409: Telegram existe pero sin bot activo). El resto, intacto.

**Gotchas**
- `Notificacion.canal` ya es texto libre, pero la pantalla `/admin/avisos` (`src/pages/admin/Avisos.tsx`, fuera del alcance de esta tarea) tiene el tipo `'email' | 'whatsapp'`, su filtro no ofrece Telegram y la celda «Canal» saldría vacía para esas filas. Pendiente de una tarea de frontend.
- Las pruebas del webhook de Telegram usan `esperarCanales()` (exportado por `routes/canalesWebhook.ts`) y esperan la auditoría con `esperar(...)` (`registrarAuditoria` se llama sin `await`).
- `getMe`, `setWebhook`, `getFile` y la descarga están probados SÓLO contra un Telegram falso; falta la prueba con el bot real.
- Quitar el bot no revoca los vínculos de las personas (quedan, mudos).

**Próximos pasos**
- Probar con el bot real (paso 5 de arriba) y revisar `getWebhookInfo` si algo no llega.
- Mostrar «Telegram» en `/admin/avisos` (tipo, filtro y etiqueta).
- Selector de empresa para residentes con unidades en varias administradoras (si aparece el caso).
- Límites y cola por chat siguen en memoria del proceso (si hay varias réplicas, pasarlos a la base).

---

## 2026-10-27 — Claude Code (Opus 5.5) — OCR como app propia de Coolify

**Pedido de Miguel (textual):** «Pasa el ocr a su propia app en coolify y sigue con el bot de wasap».

- App Coolify **house-ocr** (uuid `m07uar2fuca4qp4pqbgrowwf`, proyecto House › production): repo `miguelgargurevich/house`, rama `main`, build pack Dockerfile, base `/ocr-service`, puerto 5050, **sin dominio**, alias de red `house-ocr` (`custom_network_aliases`), env `OCR_API_KEY` (la misma de antes) y `WEB_CONCURRENCY`. Cada push a main la puede redesplegar.
- House no cambió: `ConfiguracionOcr` apunta a `http://house-ocr:5050`, que ahora resuelve al contenedor de Coolify. Probado desde el contenedor de House: lectura del voucher de B01-804 en 0,7 s.
- El contenedor viejo `house-ocr` (docker suelto, imagen `house-ocr:1`, carpeta `/opt/house-ocr`) quedó **apagado, sin reinicio automático y sin borrar** por si hay que volver atrás. Borrarlo cuando se confirme.
- Bot de WhatsApp: GRUPO VRANY aún no tiene instancia; Miguel conseguirá un número exclusivo para el bot (WhatsApp Business) y lo vincula por QR en House. No usar su número personal: su instancia entrega los mensajes a My Workspace y Evolution admite un solo webhook por instancia.

## 2026-10-27 — Claude Code (Sonnet 5.5, delegado) — Bot de WhatsApp: asistente + voucher por foto (Fases A y B)

**Pedido de Miguel (textual):** «tambien quiero un bot en telegram o donde sea para que ... haga lo del asistente» → «Sí: planea el bot de WhatsApp primero (asistente + voucher por foto), Telegram después» → «Pasa el ocr a su propia app en coolify y sigue con el bot de wasap». Rama `feat/bot-whatsapp` (worktree sobre `origin/main` 0bf8b12); **sin push** (lo sube la sesión principal con OK de Miguel). Telegram NO está: queda para otra tarea (la capa común ya es genérica por `canal`).

**Qué se hizo**
- **Esquema** (aditivo; 5 tablas nuevas, nada existente cambia): `CanalVinculado` (único vigente por número y por persona+canal con columnas `clave_vigente`/`clave_usuario` que quedan en null al revocar), `CodigoVinculacion` (hash, 10 min, `intentos`), `CanalWebhook` (hash del secreto por empresa), `MensajeCanal` (idempotencia por id de mensaje) y `CanalPendiente` (voucher a la espera de «¿cuál pagaste?», 15 min).
- **`services/canales/`**: `vinculos.ts` (código y verificación), `identidad.ts` (arma el `AuthUser` desde la base y comprueba la empresa), `conversar.ts` (`conversarPorCanal`: mismo `prepararTurno`/`ejecutarTurno`, ajustes por rol y tope de 20 consultas/15 min que la web), `formato.ts` (markdown → WhatsApp), `entrante.ts` (interpreta el webhook y atiende cada mensaje), `voucher.ts`, `webhook.ts` (autenticación y registro del webhook), `evolution.ts` (cliente; `webhook/set`, `getBase64FromMediaMessage`, `fetchInstances`, partir en ≤ 4.000), `limites.ts`, `deps.ts` (inyectables para pruebas).
- **API**: `/api/me/canales` (listar, generar código, desvincular) y `POST /api/canales/whatsapp/:instancia` (webhook, montado antes del JSON global). Ver `docs/API-CONTRATO.md` y `docs/SEGURIDAD.md › Bot de WhatsApp`.
- **`routes/whatsapp.ts`**: `/sync` y `/status` (con la sesión `open`) registran el webhook (idempotente, campo `webhook` en la respuesta; un fallo no impide vincular); `/disconnect` lo borra.
- **Avisos** (`avisos/cola.ts`): quien tiene vínculo recibe `pago_validado`/`pago_rechazado` por WhatsApp en el número VERIFICADO (aunque no tenga teléfono ni avisos activos); para los demás avisos por WhatsApp se usa el número verificado en lugar de `Usuario.telefono`.
- **Pantalla**: «Asistente por WhatsApp» en Mi perfil (`_parts/CanalesPerfil.tsx` + `canalesFormato.ts`): botón «Vincular WhatsApp», código con cuenta regresiva, número del edificio, estado y «Desvincular». En `/admin/whatsapp` una línea avisa que los vecinos ya pueden vincularse.
- **Limpieza**: la tarea horaria existente (`asistente/planificador.ts`) borra también mensajes de canal de más de 7 días y vouchers pendientes vencidos.

**Cómo activarlo en producción (GRUPO VRANY)**
1. Desplegar (el arranque corre `prisma db push` sin `--accept-data-loss`; todo es aditivo). No hay variables nuevas.
2. El admin de VRANY entra a `/admin/whatsapp`, «Sincronizar» y escanea el QR (hoy `whatsapp_instance` es null). **El webhook se registra solo**: en `/sync` (apenas se crea la instancia) y en `/status` cuando la sesión pasa a `open` (la pantalla ya consulta el estado). Si Evolution rechaza el registro, la respuesta trae `webhook: "error"`: basta volver a abrir la pantalla (o «Sincronizar») para reintentar.
3. Cada vecino/personal entra a Mi perfil › «Vincular WhatsApp», genera el código y lo manda por WhatsApp AL NÚMERO DEL EDIFICIO desde el celular que quiere vincular. Desde ahí puede preguntar y mandar la foto o el PDF del voucher.
4. Qué pasa con el webhook: el secreto se genera al registrar (32 bytes), se manda a Evolution en la cabecera `x-house-secret` y en House sólo queda su hash. No se puede ver ni recuperar; para rotarlo, desconectar y volver a sincronizar. Sin webhook registrado (o tras desconectar) Evolution recibe 401 y el bot no responde.
5. Comprobación recomendada tras activar: con el celular de Miguel vincular, mandar «menu», una pregunta («¿cuánto debo?») y un voucher de prueba; revisar en Evolution que el webhook figure con el evento `MESSAGES_UPSERT`.

**Decisiones**
- Secreto del webhook: cabecera (no en la URL, para que no quede en los logs de acceso) y sólo hash (no cifrado con el Llavero: no hace falta recuperarlo y no depende de `LLAVERO_ENC_KEY`). La URL pública es `ENLACE_APP` (la de los avisos), no se deduce de la petición (un `Host` falso no podría apuntar el webhook a otro lado).
- Sólo celulares peruanos (51 + 9 dígitos): es lo que ya normaliza `normalizarCelular` y lo que sabe enviar `enviarWhatsapp`.
- Vincular se considera la aceptación de recibir por WhatsApp el resultado de sus vouchers (`pago_validado`/`pago_rechazado`) aunque `aviso_whatsapp` esté apagado. Fácil de cambiar en `encolarAviso` si Miguel prefiere respetar siempre la preferencia.
- Junta (presidente/tesorero) y administración: el voucher por WhatsApp responde «regístralo desde House» (v1, como pidió Miguel). Vocal y secretario sí pueden mandar el suyo (no gestionan pagos).
- La consulta del bot se audita como `{ origen: 'whatsapp' }` sin texto (como la web, el contenido de la conversación no se audita). La auditoría de las herramientas sigue con `origen: asistente` porque `src/server/tools` queda fuera de lo permitido en esta tarea.
- Método de pago del voucher por WhatsApp: `transferencia` por omisión (el bot no pregunta; la IA lee el real del comprobante).

**Gotchas**
- Los tests del bot (`tests/bot-whatsapp.test.ts`) reemplazan `globalThis.fetch` sólo para `https://evo.pruebas.test`, la IA con `instalarIA` y los relojes con `canalesDeps.ahora`/`cooldownDeps.ahora`; el webhook procesa en segundo plano, así que usan `esperarCanales()` (exportado por `routes/canalesWebhook.ts`).
- `tests/whatsapp.test.ts` cambió: ahora entre `instance/create` y `instance/connect` hay una llamada `webhook/set`, y `status` abierto devuelve el campo `webhook`.
- No ejecutes `prisma format`: reordena todo el `schema.prisma` (se añadieron las tablas a mano, sin tocar lo existente).
- La suite completa tuvo, en dos corridas con la Mac cargada (load 6–8), un fallo distinto cada una (`torre-visible` cancelada; un 500 en `llavero`); ambos archivos pasan solos 3/3 y la tercera corrida completa fue 1370/1370. Parece flakiness bajo carga, no del bot (no se pudo comparar contra la base sin esta rama).

**Próximos pasos**
- Probar contra la Evolution REAL: formato de `webhook/set` con `headers`, de `getBase64FromMediaMessage` y de `fetchInstances` (no verificados contra la v2.3.7 instalada; si el número del edificio no sale, la pantalla muestra «número de WhatsApp de tu administración»).
- Telegram sobre la misma capa (`CanalVinculado.canal`, `conversarPorCanal(…, 'telegram')`).
- Límites en memoria del proceso: si algún día hay varias réplicas, pasarlos a la base.
- Decidir con Miguel si junta/administración deben poder mandar vouchers por WhatsApp (v2).

---

## 2026-10-27 — Claude Code (Haiku 5.5, delegado) — Dashboard IA primero en la lectura de comprobantes (`prioridad_vision`)

**Pedido de Miguel (textual):** «Sí, pon Dashboard IA primero en la rotación de visión y deja Gemini como respaldo.» Rama `feat/prioridad-vision` (worktree sobre `origin/main` 177a3a6); **sin push** (lo sube la sesión principal con OK de Miguel).

**Qué se hizo**
- **Esquema** (aditivo, nullable): `GatewayIA.prioridad_vision Int?`. `null` = usa `prioridad`.
- **`lib/proveedoresIA.ts`**: `ProveedorIA.prioridadVision?` (sólo gateways). **`lib/gateways.ts`**: `proveedorDeGateway` lo llena con `prioridad_vision`; el catálogo no lo tiene.
- **`services/evaluacion.ts › ordenarParaVision`** (sólo la lectura de comprobantes): ordena por `prioridadVision ?? prioridad` manteniendo los grupos de la cadena (normales libres, normales enfriadas, reserva libres, reserva enfriadas); a igualdad, el orden de la cadena. Sin `prioridad_vision` en ninguna clave, el orden es el de siempre.
- **API** (`routes/llavero.ts`, `lib/gatewaysAdmin.ts`): `prioridad_vision` opcional, entero 0–99 o null, en crear y editar. Listado (`gatewaysDatos.ts`) lo devuelve.
- **Pantalla** (`GatewayModal.tsx`): campo «Prioridad para leer comprobantes (opcional; menor = primero)», visible sólo con «Lee imágenes (visión)» activo.

**Verificado**
- `tests/evaluacion-ia.test.ts`: 5 pruebas nuevas (gateway con `prioridad_vision = 0` va antes que Gemini y Gemini responde si falla; sano → sólo gateway; null → como antes; reserva al final aunque el número sea menor; el chat no cambia).
- `tests/gateways-llavero.test.ts`: rango 0–99, null, 422 fuera de rango, edición.
- `tests/gateways-ui.test.ts`: el modal pide el campo y lo manda como `prioridad_vision`.
- Mutaciones (en rojo y restauradas con `cmp`): ignorar `prioridadVision` → 2 pruebas fallan; quitar el grupo de reserva → 1 prueba falla.

**Próximos pasos**
- Tras subir el cambio al servidor (`db push` con columna nullable): el Dashboard IA en producción sigue con `prioridad_vision` null hasta que Miguel lo fije en la pantalla. Para el orden pedido: `prioridad_vision = 0` en «Dashboard IA».

**Decisiones**
- El campo del modal se muestra sólo con visión activa (un gateway sin visión nunca lee comprobantes).
- La auditoría de `editar` no incluye `prioridad_vision` (igual que hoy con `prioridad`): el PATCH ya queda en `Auditoria`.

**Gotchas**
- `gatewayAjusteSchema` acepta `null` para limpiar; `undefined` no toca el campo.
- El gateway «Dashboard IA» persiste entre pruebas de `evaluacion-ia` (sólo se vacían las claves): la suite resetea `prioridad_vision` en su bloque.

## 2026-10-27 — Claude Code (Sonnet 5.5, delegado) — Llavero de gateways propios, dominios permitidos y OCR en la base (anti-SSRF)

**Pedido de Miguel (textual):** «hay dond registrar el gw? en house?» → «seria mejor construir un llavero de gateways no crees o gregarlo al que ya existe .. otra seccion que opinas» → (misma pantalla, sección «Gateways propios») «si hazlo» → «nada de variables de entorno todo en BD asi como las llaves de IA y sus proveedores». Rama `feat/llavero-gateways` (sobre `origin/main` f5c3f99); **sin push**. Precisión del orquestador sobre el OCR: el servicio ya corre como `house-ocr` en la red interna de Coolify (`http://house-ocr:5050`, sin dominio público) → sólo destinos internos de una lista fija EN EL CÓDIGO, o un https público con las barreras de los gateways.

**Qué se hizo**
- **Esquema** (aditivo; `db push` sin `--accept-data-loss` corre en producción): `GatewayIA`, `DominioGatewayPermitido`, `ConfiguracionOcr`, y `ClaveIntegracion.gateway_id` (FK, cascada). Se dejó `@@unique([proveedor, etiqueta])` intacto: cambiarlo hacía fallar `db push` en el contenedor; por eso la etiqueta de una clave de gateway se guarda como `g<id>:<etiqueta>` (la API la devuelve sin el prefijo).
- **Resolución única de proveedor** (`lib/gateways.ts › proveedorDeFila`): catálogo por id, o un `ProveedorIA` `openai-compatible` construido desde su `GatewayIA` (`id: 'gateway'`, `gatewayId`). Rotación, evaluación, asistente, sync de modelos, «Probar», canary, recuperación, salud y la vista del Llavero pasan por ella. **Una sola salida de red**: `services/llavero.ts › fetchProveedor`.
- **Anti-SSRF** (`lib/gateways.ts`, `lib/gatewaysDatos.ts`): barrera 1 = URL (https, sin credenciales, 443, sin IP literal, host EXACTO de `DominioGatewayPermitido`); barrera 2, la de fondo = en CADA llamada se resuelve el host y se rechaza si ALGUNA IP no es pública (10/8, 127/8, 169.254/16, 100.64/10, ULA, ::1, `::ffff:` interna, 6to4, Teredo…); `fetchFijado` conecta a la IP ya validada (lookup fijo, sin re-resolver; TLS y Host siguen siendo del dominio), nunca sigue redirecciones y respeta el `signal`. Quitar un dominio, pausar el gateway o alterar su URL en la base: sale de la cadena Y cualquier llamada pendiente se bloquea sin petición (falla cerrado); la pantalla lo dice.
- **Sólo superadmin**, auditado sin claves (`gateway-ia`, `dominio-gateway`, `ocr-config`, `clave-ia`). Rutas nuevas en `/api/llavero`: `POST|PATCH|DELETE /gateways`, `POST|DELETE /dominios`, `PUT /gateway` (clave de un gateway), `PUT|PATCH|DELETE /ocr`; `GET /` suma `gateways`, `dominios_permitidos`, `ocr` (ver `docs/API-CONTRATO.md`).
- **OCR a la base** (`ConfiguracionOcr`): `interno` (destino de `OCR_DESTINOS_INTERNOS`, hoy sólo `house-ocr`) o `publico` (mismas barreras que un gateway). `http://otro-servicio:5432` y `http://postgres:5432` se rechazan (prueba). Clave cifrada (AAD `clave:ocr:comprobantes`). `migrarOcrDesdeEnv` corre al arrancar (`src/server.ts`): si la base no tiene fila y hay `OCR_BASE_URL`, la migra UNA vez y el código deja de leer esas variables.
- **Migración del `dashboardia` fijo**: `npx tsx scripts/migrar-gateway-dashboardia.ts [--seco]` (idempotente, transaccional; re-cifra las claves porque la AAD cambia; conserva estado/reserva/modelo). La entrada ya no está en el catálogo.
- **Pantalla Llavero**: «Gateways propios» bajo «Proveedores» (lista con dominio, visión sí/no, estado; Agregar/Editar/Pausar/Quitar; las claves de cada gateway con el MISMO componente `GrupoProveedor`), «Dominios permitidos» y «OCR de comprobantes».

**Qué se verificó:** suite completa en verde, tipos, build y 54 mutaciones sobre las barreras (todas en rojo; ver el resumen del commit). El script de migración se corrió contra `house_test_gw` (seco, real, repetido).

**Próximos pasos (los hace la sesión principal con OK de Miguel)**
1. **En el MISMO despliegue** correr `npx tsx scripts/migrar-gateway-dashboardia.ts --seco` y luego sin `--seco` dentro del contenedor (si no, las claves `dashboardia` quedan sin uso: el id ya no existe en el catálogo).
2. Cargar en el Llavero el dominio `omniroute.gargurevich.dev` y registrar OmniRoute si se quiere (no se agregó nada por defecto salvo `api.dashboardia.gargurevich.dev`).
3. En producción, el OCR `http://house-ocr:5050` se migra solo desde `OCR_BASE_URL` al primer arranque; después se pueden quitar `OCR_BASE_URL` y `OCR_API_KEY` de Coolify (la clave real no la tocó nadie en esta sesión).
4. No se probó la pantalla en un navegador.

**Decisiones y gotchas**
- Se tocaron archivos fuera de `Permitidos:` porque la resolución de proveedor los exigía (cambios mínimos): `src/server.ts` (migración del OCR al arrancar), `routes/aiChat.ts` (nombre del gateway), `services/asistente/{prueba,canary,recuperacion,salud,vistaLlavero}.ts` (cargar `gateway` y resolver con `proveedorDeFila`), `tests/helpers/app.ts` (el TRUNCATE incluye las tablas nuevas) y `tests/helpers/gateways.ts` (nuevo).
- Un OCR/gateway PÚBLICO que pase a apuntar a la red interna se bloquea (por diseño). El OCR interno NO pasa por DNS: es una red de confianza con lista fija en el código.
- Un `https` público en `OCR_BASE_URL` se agrega a la lista de dominios al migrarlo (lo puso el operador); un destino `http` ajeno no se migra (`url_no_valida`, queda en el log).
- «Quitar» el OCR deja la fila vacía y pausada (no se borra) para que el entorno no la resucite en el siguiente arranque.
- Aceptado/pendiente: `lib/modelosMalos.ts` indexa por `proveedor` = `gateway` (un modelo malo en un gateway lo es 10 min para todos); la evaluación guarda `proveedor: 'gateway'`, no el nombre; el canary agrupa todas las claves de gateway como un solo «proveedor».
- Las pruebas que registran gateways usan `tests/helpers/gateways.ts` (`dnsFalso()` inyecta el resolver; nunca DNS real). Cualquier prueba nueva de IA que use un gateway debe llamarlo en `before`.

---

## 2026-10-27 — Claude Code (Sonnet 5.5, delegado) — La fecha del voucher sólo se aplica si el comprobante coincide, y la IA lee el periodo del mensaje

**Pedido de Miguel (textual):** «Sí: que la fecha del voucher solo se aplique si la IA no marca que no coincide, que la IA también lea el periodo del mensaje, y restaura la fecha del pago de B01-804.» Rama `fix/fecha-y-periodo` (sobre `origin/main` f5c3f99); **sin push**.

**Qué se hizo**
- `services/fechaVoucher.ts`: `decidirFechaEvaluada` (nueva; `decidirFecha` no cambió). Con veredicto `no_coincide`, o con el mensaje nombrando otro mes que el recibo, la fecha NO se aplica: queda la declarada y `fecha_origen = 'no_leida'` con su motivo (queda en la auditoría `fecha_pago_voucher`). `ilegible` ya salía `no_leida`. `manual` sigue sin pisarse. `evaluacion.ts` la llama con el veredicto y el periodo del recibo.
- `lib/lecturaComprobante.ts`: campo opcional `mensaje` (`texto` limpio, máx. 120, vacío → null) y su línea en el prompt. Opcional para que lo ya guardado y las respuestas de modelos que no lo mandan sigan validando.
- `services/contraste.ts`: la detección de mes ahora vive aquí (`mesDelMensaje`, `alertaDePeriodo`, `MESES`…) y la comparten la IA y el OCR (`ocrVoucher.ts` la re-exporta; su alerta no cambió). Reconoce nombres, abreviaturas, `AAAA-MM` y `MM/AAAA` (una fecha completa no cuenta). `Esperado.periodo` es opcional; con mes distinto: alerta «El mensaje del comprobante dice «Setiembre», pero el recibo es de octubre de 2026» y el veredicto no puede ser `coincide` (queda `revisar`, o `no_coincide` si ya había otro motivo). No hay veredictos nuevos ni campo nuevo en `coincidencias`.
- `lib/proveedoresIA.ts`: `modeloVision` de `dashboardia` → `nvidia/nemotron-3.5-super-vl-120b-a12b` (el gateway no publica `qwen3-vl-flash`).
- Pantalla: `EvaluacionPanel` ya pintaba «Mensaje del voucher» desde `extraido.mensaje`; ahora llega también de la IA (sólo se ajustó el comentario del tipo). El residente sigue viendo sólo el estado.
- Docs: `COBRANZA.md` §1, `SEGURIDAD.md` (modelo del gateway), `API-CONTRATO.md` (`extraido.mensaje`).
- Pruebas nuevas: `tests/fecha-periodo.test.ts` (29: esquema, detección de mes, contraste, decisión pura y el caso real de punta a punta con IA falsa). `evaluacion-rapida.test.ts` ajustado al modelo nuevo.

**Pendiente / ya hecho por la sesión principal**
- La fecha de B01-804 la restauró a mano la sesión principal (`fecha_origen = 'manual'`) antes de esta rama; aquí NO se tocó ningún dato de producción. Tras desplegar, un voucher como ése ya no cambia la fecha solo.
- Los pagos ya evaluados no se reevalúan solos: si hay otros con la fecha cambiada por un `no_coincide`, se corrigen a mano (`PATCH /api/pagos/:id` → `manual`) o reevaluando.

**Decisiones / gotchas**
- Se compara sólo el MES (no el año) del mensaje con el del recibo; si el mensaje nombra varios meses cuenta el primero (más cauto: ante la duda queda `revisar`).
- `vistaGestion` (asistente) NO expone `mensaje`: es texto de terceros y no se amplió lo que ve el modelo del asistente.
- `EvaluacionPanel` no se puede montar en node (`api.ts` usa `import.meta.env`): su prueba lee el código fuente, como las demás de pantalla.
- Otra sesión (`feat/llavero-gateways`) toca `proveedoresIA.ts` y cómo `evaluacion.ts` resuelve el proveedor: aquí sólo cambió la línea de `dashboardia` y las de `contrastar`/`decision`.

## 2026-10-27 — Claude Code (Opus 5.5, orquestador) — Script para probar el correo de avisos

**Pedido de Miguel:** probar el envío con la clave de Resend y el remitente de producción → «guarda el script así no lo volvemos a crear».

**Qué se hizo**
- `scripts/probar-correo.ts <destinatario>`: manda UN correo de prueba con `enviarCorreo` (la misma función de los avisos) y la config real (`RESEND_API_KEY`, `MAIL_FROM`). Imprime la respuesta del canal, nunca la clave.
- Probado en producción el 27-oct (dentro del contenedor): Resend respondió `ok`, remitente `house@gargurevich.dev`.

**Gotchas**
- Correrlo DENTRO del contenedor de la app (`docker exec -w /app <contenedor> npx tsx scripts/probar-correo.ts …`): así la clave no sale del servidor.
- tsx sin `"type":"module"`: nada de `await` de nivel superior (por eso el `void (async () => …)()`).

## 2026-10-27 — Claude Code (Sonnet 5.5, delegado) — Evaluación rápida del comprobante: modelo de visión correcto, fallar rápido, reintento persistido, aviso en pantalla, gateway Dashboard IA y OCR propio

**Pedido de Miguel (textual):** «(captura: Detalle del pago B01-804, «Evaluación automática · Evaluando… · Leyendo el comprobante…») la ia se qued apensando mucho tiempo.. revisa, quiza tambien podemos usar el ocr que monte en el vps revisa» → «Sí: arma el arreglo de la evaluación (modelo de visión correcto, fallar rápido, reintento que sobreviva al deploy, aviso en pantalla y el gateway Qwen-VL como respaldo) · «tengo un ocr que hice para el proyecto de portal de delarers, revisa»». Rama `fix/evaluacion-rapida` (sobre `origin/main` 7dd0f98); **sin push**.

**Qué se hizo**
- **Modelo de visión por clave** (`services/evaluacion.ts`, `modeloDeVision`): el modelo fijado en la clave se usa SÓLO si `ModeloIA.vision === true` para esa clave o es una familia conocida; si el catálogo dice `false`, o no se sabe, `proveedor.modeloVision`. Era el 404 de producción (clave 13 de OpenRouter con nemotron de texto).
- **Fallar rápido**: `evaluacionDeps.topeLlamadaMs` = 20 s (antes 45) y `topeIntentoMs` = 60 s para toda la rotación; agotado, no se prueba otra clave. `MAX_INTENTOS_IA` 3 → 4 para que, con dos claves de Gemini caídas, todavía se llegue al gateway.
- **Reintento persistido**: columna `EvaluacionComprobante.reintentar_at` (+ índice). `barrerEvaluaciones()` toma las vencidas con un UPDATE atómico (sin doble ejecución entre réplicas/barridos) y retoma las «pendientes» sin dueño > 5 min (con intentos < 2) o las pasa a `error`. Corre desde `asistente/planificador.ts` (a los 10 s de arrancar y cada minuto; `EVALUACION_BARRIDO=off` lo apaga; en `NODE_ENV=test` no arranca solo). El `setTimeout` quedó sólo como acelerador.
- **Aviso en pantalla** (`pages/shared/evaluacion.tsx` + lógica pura nueva `pages/shared/esperaEvaluacion.ts`): a los 20 s «La IA está tardando más de lo normal; puedes validarlo tú» (admin/junta) / «Lo revisará una persona si la IA no responde» (residente); a los 3 min el cliente deja de consultar y muestra el estado; en `error`/`no_disponible`/sin respuesta el botón dice «Reintentar» (reusa `POST /api/pagos/:id/evaluacion`).
- **Gateway Dashboard IA**: proveedor `dashboardia` en `PROVEEDORES_IA` (prioridad 2; las demás se corrieron +1, mismo orden relativo). **Sin clave**: Miguel la agrega en el Llavero. Acepta `content` como string (con o sin ```json) o lista de partes.
- **OCR propio**: `ocr-service/` (copia del del portal de dealers + imágenes JPG/PNG/WebP; probado de verdad con Flask test client + Tesseract) y `services/ocrVoucher.ts` (cliente + lector de reglas BCP/Interbank/BBVA/Scotiabank/Yape/Plin). Sólo corre si la IA ya no dará lectura y hay `OCR_BASE_URL`. `proveedor: 'ocr'`, confianza ≤ 0,6, nunca valida solo, no aplica la fecha, alerta p. ej. mes distinto del recibo.
- Docs: `docs/SEGURIDAD.md` (sección de evaluación), `docs/API-CONTRATO.md`, `.env.example`, `ocr-service/README.md`. Pruebas: `tests/evaluacion-rapida.test.ts` (nueva) y un ajuste en `tests/evaluacion-ia.test.ts` (tope de 4 claves).

**Próximos pasos (de la sesión principal / Miguel)**
1. `npx prisma db push` en producción (columna nueva nullable `reintentar_at`).
2. Desplegar `ocr-service/` en Coolify (puerto 5050) con `OCR_API_KEY`, y en House `OCR_BASE_URL` + `OCR_API_KEY`. Sin eso el OCR no se usa (todo lo demás sí).
3. Agregar la clave del gateway `dashboardia` en el Llavero (y revisar que su `urlParaConseguirKey` sea el panel correcto).
4. Cambiar en la clave 13 de OpenRouter el modelo fijado por uno con visión o dejarlo en Auto (ahora ya no se usa para imágenes, pero sigue siendo su modelo de chat).

**Decisiones**
- El OCR entra sólo al final (tras agotar el reintento de la IA): una IA que falla por 503 merece un segundo intento antes de bajar a una lectura menos fiable.
- Fechas leídas por OCR NO se aplican al pago (confianza baja); la lógica de `fechaVoucher.ts` no se tocó.
- `esperaEvaluacion.ts` es un archivo nuevo (la lógica pura se prueba de verdad, como `faseVoucher.ts`); el repo no pinta componentes.

**Gotchas**
- Las claves del gateway también entran en la cadena del **chat** del asistente (es un proveedor más, prioridad 2): si no se quiere, márcala «reserva» en el Llavero (va al final también para visión).
- El texto OCR de los vouchers de prueba es el de Tesseract real sobre una captura SINTÉTICA del caso del BCP; los demás bancos son textos escritos a mano según su formato conocido: falta contrastarlos con capturas reales.
- Los barridos toman TODA evaluación vencida: las pruebas vacían `EvaluacionComprobante` en `beforeEach` por eso.

## 2026-10-27 — Claude Code (Sonnet 5.5, delegado) — Reglas de cobranza: fecha del voucher, recordatorios 2 días antes y el día, mora de S/ 20 en el recibo siguiente

**Pedido de Miguel (textual):** «la fecha de pago se calcula del voucher de pago, la fecha de corte de pago es hasta el 5 de cada mes, deben haber avisos al correo y wasap como alertas que se acerca la fecha de pago si no subió el voucher aún, 2 días antes y el mismo día 1 aviso. la mora es de 20 soles» · decisiones: corte = «El 2, como el Excel» (día de vencimiento del recibo), mora «En el recibo del mes siguiente». Rama `feat/reglas-cobranza` (sobre `origin/main` 8002435); **sin push**. Reglas completas en `docs/COBRANZA.md` (doc nueva).

**Qué se hizo**
- **Fecha = voucher** (`services/fechaVoucher.ts`, enganchado en `evaluacion.ts`): la lectura de la IA fija `Pago.fecha_pago` de TODO el grupo (y la fecha de los cargos ya pagados) si el comprobante es legible, la operación no está pendiente/fallida y la fecha no es futura ni anterior a la emisión − 60 días. Si no se lee → queda la declarada y `fecha_origen = 'no_leida'`; si es futura/muy antigua → `'invalida'`, no se aplica y la validación automática NO valida el pago. `PATCH /api/pagos/:id { fecha_pago }` la deja `'manual'` (nadie la pisa). Auditoría `fecha_pago_voucher {origen, anterior, nueva}`. Esquema: `Pago.fecha_origen` (default `declarada`) y `Pago.fecha_declarada`.
- **Recordatorios** (`services/avisos/cola.ts`, `plantillas.ts`): `por_vencer` exactamente a 2 días (antes ≤ 3) y tipo nuevo `vence_hoy` el día del vencimiento, correo y WhatsApp, sólo si el cargo sigue `pendiente` (sin voucher). Día de Lima. Los textos dicen dpto. y torre, piden el voucher y avisan de la mora (si `mora_monto` > 0).
- **Mora** (`services/mora.ts`, usada por `routes/recibos.ts` en el Excel y en `POST /api/recibos`): al crear el recibo de un mes se mira el del mes anterior de la MISMA torre; «pagó tarde» = al cierre del día de vencimiento (inclusive, Lima) sin pagos (validados o por validar, no rechazados) con `fecha_pago` ≤ vencimiento que cubran cada cargo. Multa del Excel > 0 se respeta; 0/vacía + tarde → S/ 20 en esa columna; sin columna → concepto «Multa por pago fuera de fecha» (recargo), con el motivo en `observaciones`. `ComplejoHabitacional.mora_monto` (Decimal, default 20.00; editable en la ficha del condominio, 0 = sin mora). Respuesta con `mora {monto, cantidad, departamentos, mensaje}`.
- **Pantallas mínimas**: detalle del pago (fecha del voucher + origen + advertencia si no se leyó/no se aplicó), recibo del residente (motivo bajo la línea de mora), ficha del condominio (mora editable), ventana del Excel (mensaje de la mora), lista de avisos (`vence_hoy`).
- **Pruebas**: `tests/reglas-cobranza.test.ts` (44) con IA falsa y reloj inyectado (`evaluacionDeps.ahora`, `moraDeps.ahora`, `encolarRecordatorios(ahora)`); se ajustaron `avisos.test.ts` (2 → días exactos y vence_hoy), `recibos-excel.test.ts` (campo `mora`) y `evaluacion-ia.test.ts` (paginación: la fecha del voucher ordena por detrás de pagos con hora).

**Decisiones**
- `por_vencer` es EXACTAMENTE a 2 días, sin recuperación: un recibo emitido a 2 días o menos de vencer sólo recibe `vence_hoy` (ya recibió el «recibo emitido»). Si el planificador cayera un día entero, ese aviso se pierde.
- «Sin voucher» = cargo `pendiente` (la regla de siempre: `en_revision` y `pagado` no reciben). Un residente que registró el pago pero aún no subió el archivo ya está `en_revision` y no recibe recordatorios.
- La mora sólo se evalúa si hoy (Lima) es posterior al vencimiento del recibo anterior; si no, se avisa en `advertencias` y no se agrega nada (reimportar después sí la agrega). Se aplica a toda unidad presente en el Excel (aunque todos sus montos sean 0).
- Un cargo `pagado` sin ningún `Pago` (dato anterior al flujo de pagos) cuenta por la fecha del propio cargo; sin fecha, beneficio de la duda (no es mora).
- La fecha del voucher se guarda al mediodía UTC del día leído (la medianoche UTC se vería un día antes en Lima).

**Gotchas (importante antes de subir el Excel de noviembre)**
- **Los 32 propietarios del Block 1 de Los Libertadores tienen correo PROVISIONAL: hoy no les llega ningún aviso** (ni estos). Hay que cargar correos/celulares reales. No se tocó.
- Al desplegar, `mora_monto` queda en 20.00 en TODOS los condominios (default) y la mora se aplicará sola al crear el siguiente recibo de cada torre. El de octubre del Block 1 (vence el 2-nov) ya existe: la mora entra con el recibo de noviembre.
- «Pagó tarde» usa `Pago.fecha_pago`. Los pagos anteriores al despliegue (y los que la administración registra sin voucher) tienen la fecha DECLARADA (por defecto, el momento del registro): si la administración registró hoy el pago de alguien que pagó a tiempo, saldría «tarde». Antes de subir noviembre conviene revisar los pagos de octubre del Block 1: corregir la fecha (`PATCH /api/pagos/:id`, queda `manual`) o adjuntar el voucher y/o repetir la evaluación (`POST /api/pagos/:id/evaluacion`), que ahora aplica la fecha leída.
- Reemplazar un recibo desde Excel que ya tiene pagos sigue dando 409: si hubiera que corregir la mora, se corrige con la fecha de los pagos y se reimporta ANTES de que haya pagos en el recibo nuevo.
- `agregarMora` devuelve las unidades aunque ya las tuviera (el guard de idempotencia evita duplicar, pero el mensaje repetiría la lista).
- Al desplegar, `prisma db push` agrega 3 columnas con default (`fecha_origen`, `fecha_declarada` nullable, `mora_monto`): sin pérdida de datos.

**Próximos pasos:** (1) OK de Miguel y push; (2) cargar correos/celulares reales del Block 1; (3) revisar las fechas de los pagos de octubre antes del Excel de noviembre; (4) probar en el navegador el detalle del pago, la ficha del condominio y la ventana del Excel (el repo no pinta componentes).

**No verificado**
- Ninguna pantalla se probó en navegador (sólo pruebas de la fuente y de `textoFechaPago`/`resumenSubida`). La IA real y el envío real de correo/WhatsApp no se ejecutaron (todo con `fetch`/reloj inyectados); el planificador de producción no se corrió. No se probó contra la base `house` ni producción.
- Mutaciones: ver el resumen de la sesión (todas las probadas en rojo; M6 y M13 por una sola barrera son equivalentes porque hay una segunda barrera).

---

## 2026-10-26 — Claude Code (Sonnet 5.5, delegado) — Asistente, tanda 1: junta y residentes, estado del pago, contacto de la administración, proveedores

**Pedido de Miguel:** captura del asistente: «quiénes son la junta» → «No tengo registrada la lista de los miembros de la junta»; «hay residentes con cargo» → «No tengo registrada esa información… pantalla de Personas» · «qué otras herramientas consideras que puedan faltar» → «sí dale» (tanda 1: junta y residentes, estado del pago/voucher, contacto de la administración, proveedores). Rama `feat/asistente-tanda1` (sobre `origin/main` 741b731); **sin push**. Última entrada previa: el recibo por torre (abajo).

**Qué se hizo** (solo backend del asistente, sin frontend ni esquema; catálogo 22 → 26 herramientas)
- **`junta_y_residentes`** (`tools/personas.ts`): admin/superadmin (su empresa / plataforma), junta presidente-tesorero (SU block) y residentes. La junta de un block = cargos de ese block + cargos de todo el condominio (`estructura_id` null). El residente (también secretario/vocal) recibe SOLO la junta de sus blocks (unidades + block de su perfil) con cargo y nombre, sin departamento y con `filas: []` + nota de privacidad; no hay argumento que le abra la lista de vecinos.
- **`estado_de_pago`** (`tools/estadoPago.ts`): pagos principales del mantenimiento (monto = total del grupo), estado, motivo del rechazo, `tiene_voucher` (nunca el archivo) y la evaluación de la IA. `lib/evaluacionVista.ts` gana `vistaGestion` (admin/junta: veredicto, confianza, alertas, lo que leyó con solo 3–4 últimos dígitos del destino); el residente sigue con `estadoParaResidente` (estado simple).
- **`contacto_administracion`** y **`proveedores`** (`tools/institucional.ts`): contacto de EMPRESAS. La excepción a la salida segura es un tipo, `ContactoInstitucional` (`tools/base.ts`; constructor privado, fábricas `deEmpresa`/`deProveedor`), que `depurar(valor, cuenta, herramienta)` respeta solo si la herramienta está en `HERRAMIENTAS_CON_CONTACTO_INSTITUCIONAL` (esas dos); en otra se omite. Correo/teléfono se validan por forma. Una prueba exige que las fábricas solo se usen en `institucional.ts`.
- **Enlaces y textos**: `lib/rutasApp.ts` → `dondeVer(rol, seccion)` (residentes → Condominios › ficha › pestaña Residentes; personal → Mi empresa › pestaña Personal / Empresas › ficha; proveedores → Operación › Proveedores). `src/config/ai-system-prompt.txt` ya no dice «Personas», explica las herramientas nuevas y ajusta la regla 2 de privacidad (conserva la frase «otras personas ni de otras unidades»).
- **Respaldo sin herramientas** (`services/asistente/respaldo.ts`): reglas por palabras clave para las 4 nuevas (las preguntas de Miguel funcionan también con un modelo sin tool-calling).
- Docs: `docs/HERRAMIENTAS.md` (Etapa 4 + «Contacto institucional») y `docs/SEGURIDAD.md` («Datos de contacto que el asistente puede dar»).
- Pruebas: `tests/herramientas-tanda1.test.ts` (47) + ajustes de cuentas en `herramientas.test.ts`, `mcp.test.ts`, `asistente-herramientas.test.ts` (residente 5→8 herramientas, admin 14→18, superadmin 17→21) y `hallazgosProhibidos` del helper (admite `contacto` institucional).

**Decisiones**
- «Junta» con permisos = presidente/tesorero (`esJunta`, como en todo el repo). Secretario y vocal son residentes comunes: ven la junta, no a los vecinos.
- «Para todos los roles» en `contacto_administracion` = admin, superadmin, propietario, inquilino y junta. Mantenimiento/seguridad/limpieza/jardinería siguen SIN herramientas (hay pruebas que lo exigen y el brief dice que mantenimiento no las tiene).
- Proveedores para la junta: solo los enlazados a SU condominio (`ProveedorComplejo`) cuya empresa lo administra hoy (si no hay enlace, no se muestra).
- El residente ve la evaluación de la IA en versión simple (como la pantalla); la administración y la junta, la completa.
- Se tocó `src/config/ai-system-prompt.txt`, que no estaba en «Permitidos» literal, porque el punto 5 del brief pide ajustar el prompt.

**Gotchas**
- Los residentes sin ninguna unidad no salen en `filas` de `junta_y_residentes` (sí en `junta` si tienen cargo).
- La regex de correos de `depurar` también se come el paréntesis pegado al correo («(a@b.pe)» → «[correo omitido])»); es el comportamiento previo.
- `nombreCorto` con 3 palabras devuelve las 2 primeras («Presidente de B» → «Presidente de»): cuidado al elegir nombres de fixtures.
- Las pruebas de `estado_de_pago` siembran evaluaciones a mano (`EvaluacionComprobante`); no corren IA.

**Próximos pasos:** (1) OK de Miguel y push; (2) probar con un modelo real que admita herramientas las 4 preguntas de la captura; (3) tanda 2 si Miguel la pide.

---

## 2026-10-26 — Claude Code (Haiku 5.5, delegado) — Adjuntar el comprobante desde el detalle de un pago ya registrado

**Pedido de Miguel:** «como o donde se adjunta el comprobante?» (el detalle de un pago validado decía «Este pago no tiene comprobante adjunto.») → «Sí, agrega el botón «Adjuntar comprobante» en el detalle del pago, con el análisis de IA». Rama `feat/adjuntar-comprobante` (worktree `.claude/worktrees/adjuntar-comprobante`); **sin push**.

**Qué se hizo**
- `ValidarPagoModal.tsx`: sin comprobante y con rol admin/superadmin, botón «Adjuntar comprobante» (JPG/PNG/WebP/PDF, 2 MB; se valida en el cliente con `errorDeArchivo`). Usa `subirComprobante` (el mismo `POST /api/pagos/:id/comprobante`, sin cambios en el servidor). Tras subir muestra el voucher y el panel «Evaluación automática», y sigue a la IA sin pedir otra evaluación.
- Texto según el estado: pago ya validado → «el voucher queda como respaldo y la IA solo informa lo que leyó»; por validar → la IA puede validarlo solo o dejarlo en revisión. Si la IA lo valida mientras la pantalla sigue abierta, el estado mostrado pasa a validado y se oculta Validar/Rechazar.
- `evaluacion.tsx`: el hook `useEvaluacionCompleta` expone `seguir()` (espera la evaluación que ya inició el servidor) y reinicia `validadoPorIA` al cambiar de pago (antes podía arrastrar la marca del pago anterior).
- `comprobantes.ts`: `subirComprobante` dice «No tienes permiso para adjuntar el comprobante a este pago.» ante 403/404. Sólo ahí: `registrarPagoConVoucher` y la descarga no cambian. Efecto colateral: el residente que intenta adjuntar a un pago ajeno ve este texto en vez de «Pago no encontrado».
- Pruebas: `tests/adjuntar-comprobante.test.ts` (API, 5: admin a pago VALIDADO → 201 y sigue validado con evaluación; a pago por validar → 201 y no se valida sola; 415; otra empresa / residente ajeno / junta de otro block → 404 sin guardar; el residente sigue adjuntando a su pago). `tests/adjuntar-comprobante-ui.test.ts` (fuente, 6). Mutación: `puedeAdjuntar = true` → 1 rojo (la regla de quién ve el botón); restaurado y en verde.

**Decisiones**
- Sin backend nuevo ni esquema. La administración sube a cualquier pago de su alcance (`scopePagosEscritura`); el residente y la junta sólo a los pagos que registraron ellos (regla existente, sin cambios).
- Adjuntar a un pago validado NO cambia su estado: lo dice la pantalla y lo prueba la API.

**Próximos pasos**
- Miguel debe probarlo en el navegador (el repo no pinta componentes): botón visible para admin, texto del estado y la evaluación al terminar.

**No verificado**
- No se probó en navegador. La IA real no se ejecutó: en las pruebas su `fetch` falla a propósito (no hay red), así que el camino «la IA valida sola» sólo se ve en el hook/fuente, no de extremo a extremo.

---

## 2026-10-26 — Claude Code (Sonnet 5.5, delegado) — Un recibo por torre (modelo, Excel, emisión, alcance de la junta, torre visible en toda la app, «setiembre»)

**Pedido de Miguel:** «en recibos tengo el recibo de octubre pero debe ser por block (Torre) porque cuando entro esos son los vecinos del block .. así cada block tiene su propio recibo» · «igual acá cómo sé de qué Block es el recibo?» · «en recibos igual considera en toda la aplicación y revisa cuántos más hay así». Rama `feat/recibo-por-torre` (sobre `origin/main` 2058a68); **sin push** (lo sube la sesión principal con OK de Miguel). Última entrada previa: el administrador adjunta el voucher (abajo).

**Qué se hizo** (la auditoría completa con archivo:línea está en `../auditoria-recibo-por-torre.md`: 63 sin torre, 10 meses como número, 22 «un recibo por mes»; todo cubierto, ver «No aplicó»)
- **Modelo**: `Recibo.estructura_id Int?` (+ relación e índice `(complejo, estructura, mes, año)`). `null` = condominio sin torres, recibo general o recibo viejo que mezcla torres. **Sin `@@unique` a propósito**: (1) Postgres no compara NULL con NULL, no cubriría los recibos sin torre; (2) un `@@unique` nuevo hace que `prisma db push` exija `--accept-data-loss` y el contenedor arranca con `db push` a secas (`Dockerfile`: abortaría). Columna y índice nuevos son aditivos: el `db push` sobre una base con datos pasó sin warnings.
- **Unicidad** `services/reciboUnico.ts`: candado de transacción (`pg_advisory_xact_lock(complejo, anio*100+mes)`) + comprobación en la MISMA transacción, en emisión, Excel y edición de mes/año. Un recibo SIN torre que ya cobra a unidades de esa torre también es choque (409): evita cobrar dos veces mientras no se corre la migración.
- **Migración** `scripts/migrar-recibos-por-torre.ts [--seco]` (idempotente): asigna la torre a cada recibo sin torre cuyos cargos son TODOS de una misma torre (y reescribe la descripción automática «Mantenimiento de 10 de 2026» → «Mantenimiento de octubre de 2026 · Block 1»); los que mezclan torres, sin cargos, de condominios sin torres o duplicados sólo se informan.
- **Excel** (`POST /api/recibos/excel`): agrupa filas por torre y crea/reemplaza UN recibo por torre en una sola transacción; el Excel del Block 2 ya no toca el del Block 1 (ni lo reemplaza ni lo bloquea con su 409). «Ya tiene pagos» es por recibo de torre y el mensaje dice la torre. Respuesta: `recibo_id` (el primero) + `recibos[]`.
- **Emitir recibo** (`POST /api/recibos`): `estructura_id` elige la torre; sin él, «todas las torres» = un recibo por torre (+ uno sin torre si quedan unidades sin torre); condominio sin torres: uno solo, `estructura_id` null. Duplicado → 409 con la torre y no se crea ninguno.
- **Alcance**: la junta de un block sólo ve los recibos de SU block (404 a otra torre) + los recibos sin torre del condominio (su lista de departamentos ya se acota a sus unidades). `lib/junta.ts#filtroReciboAmbito` lo usan las rutas y las herramientas del asistente. `validarRefs` de cargos: la unidad debe ser de la torre del recibo (422). `/periodos`: últimos 24 MESES completos.
- **Torre visible/filtrable (A)**: API (recibos, cargos, pagos, panel `por_torre`, morosidad con `complejo`+`resumen`, notificaciones con `contexto`, `/me/unidades`, avisos con departamento+torre y firma del condominio, herramientas y contexto del asistente con `block` y filtros `estructura_id`/`condominio_id`) y pantallas (Recibos, Emitir, Subir Excel, Periodo, Pagos, Validar, Registrar pago, Recibo imprimible con cuentas del block separadas de las del condominio, Morosidad, Panel, Avisos, residente). Componentes nuevos: `SelectoresUbicacion.tsx`, `torres.ts` (puro), `useTorres.ts`.
- **Meses (B)**: UNA ayuda en el servidor (`src/server/lib/periodo.ts`) y UNA en el frontend (`src/ui/format.ts#periodo/tituloRecibo`); «setiembre» en todas las salidas; el lector del Excel acepta «septiembre» y «setiembre». `numeroMantenimiento` NO cambió. `periodoDe` del asistente → «octubre de 2026» (la ENTRADA `periodo` sigue siendo AAAA-MM).
- **Periodo con recibos por torre**: un recibo de torre va directo a sus departamentos (sin selector ni vista agrupada); un recibo viejo multi-torre sigue agrupado.
- Docs: `API-CONTRATO.md` (sección «Un recibo por torre») y `EXCEL-RECIBOS.md`.
- Pruebas: `tests/recibo-por-torre.test.ts` (26: Excel por torre, el caso real con el Excel de `docs/ejemplos`, emisión, unicidad con concurrencia, junta, migración), `tests/torre-visible.test.ts` (19, API + asistente + avisos) y `tests/torre-ui.test.ts` (21, ayudas puras + fuente). 19 mutaciones, todas en rojo.

**Próximos pasos (Opus, al desplegar)**
1. Tras el deploy (el arranque hace `prisma db push`, que sólo añade la columna y el índice): `npx tsx scripts/migrar-recibos-por-torre.ts --seco` en producción y, si dice lo esperado (el recibo de octubre 2026 de Los Libertadores → «Block 1», 286 cargos), sin `--seco`. **Mientras no se corra, el Excel del Block 1 de octubre responde 409 («recibo sin torre que cobra a unidades del Block 1»)** — a propósito; el del Block 2 sí pasa.
2. Miguel debe probar en el navegador: filtros Torre/Condominio, Emitir con «todas las torres», Subir Excel de dos blocks, el periodo de un recibo de torre, el recibo imprimible (cuentas del block vs del condominio) y el panel por torre. El repo no pinta componentes: las pantallas se probaron por tsc/build y pruebas de fuente.
3. Opcional: un índice parcial `CREATE UNIQUE INDEX … WHERE estructura_id IS NULL` a mano (no lo crea `db push`); el código ya lo impone.

**Decisiones**
- Sin torre elegida en un condominio CON torres = «todas las torres» (compatible con quien no manda `estructura_id`); la UI lo pone explícito.
- La junta de un block ve también los recibos sin torre (generales/viejos) del condominio: la lista de departamentos ya está acotada a sus unidades, y así un recibo viejo no migrado no «desaparece» para ella.
- `recibos_emitidos` del panel = periodos (condominio+mes+año); el conteo bruto sigue en `recibos_total`.
- El `format` de las notificaciones ahora agrega `contexto`; el cuerpo sigue sin viajar en el listado.

**No aplicó / no se hizo**
- No se tocó `prisma/seed*.ts` (los recibos sembrados quedan sin torre; el seed no rompió). `src/api.ts` no estaba permitido: `useList` no expone campos extra, por eso las cifras de Morosidad usan un `useResource` aparte.
- No se probó en navegador ni contra producción; la migración se probó sólo contra bases de prueba locales (`house_test_torre`).

**Gotchas**
- Dos pruebas de otros módulos (voucher-admin con la IA falsa, y «GET /api/llavero») fallaron UNA vez cada una, en corridas completas distintas, por esperas de ~5 s con el equipo ocupado; pasaron solas y en la corrida siguiente. La línea base (antes de tocar nada) fue 900/900.
- El script de migración recorre TODA la base (también otros condominios): en pruebas filtra por los ids propios.
- El recibo de seed de octubre (sin torre) ya no lo reemplaza el Excel de una torre: `recibos-excel.test.ts` mira sólo el recibo de la torre B.1.
- `/api/estructuras` es sólo de admin: `SelectoresUbicacion` tiene `oculto` (pasa `null` a `useResource`) para que la junta, que usa la pantalla de Pagos, no la pida.

---

## 2026-10-26 — Claude Code (Sonnet 5.5) — El administrador adjunta el voucher al registrar el pago y la IA lo revisa

**Pedido de Miguel:** «…o como administrador subir el voucher de pago» → «Sí, arregla las tres» (esta parte: que el ADMINISTRADOR suba el voucher y la IA lo analice; «al subirlo debería analizarlo con IA, si está ok marcarlo como pagado o enviado»). Rama `feat/voucher-admin` (sobre `adb0bc0`); sin push (lo sube la sesión principal con OK de Miguel). Última entrada previa: medios de pago ampliados (entidades, moneda, cuenta recaudadora).

**Qué se hizo**
- **Backend** (`routes/recibos.ts`, `services/mantenimiento.ts`): `POST /api/recibos/:id/mantenimientos/:unidadId/pagos` acepta también `multipart/form-data` con el archivo en el campo `voucher` (JPG/PNG/WebP/PDF, 2 MB). Con voucher el pago nace `por_validar` (cargos `en_revision`, mismo reparto de siempre), el archivo se guarda en el pago principal DENTRO de la transacción de `pagarMantenimiento` (parámetro nuevo `comprobante`) y se dispara `iniciarEvaluacion(pago, 'subida')`: la MISMA IA del residente, con sus mismas condiciones de autovalidación (no se tocó `evaluacion.ts`). Sin voucher (JSON o formulario sin archivo) todo igual: validado de inmediato. La respuesta suma `estado` (`validado|por_validar`) y `con_voucher`.
- **Atomicidad (decisión)**: UNA sola petición. El archivo se verifica (415 tipo, 422 vacío/grande/bytes que no son del tipo/dos archivos) ANTES de crear nada y se persiste en la transacción: no existe el pago `por_validar` huérfano. Se descartó «crear el pago y luego subir» (dos pasos, hay que revertir o reintentar). El departamento se autoriza antes de leer el archivo (404 sin descargarlo).
- **Auditoría**: `crear` del pago con `con_voucher: true`, `subir_comprobante` (nombre, tipo, tamaño, sha256 — igual que la subida normal), `evaluar_comprobante`/`validar` de la IA; nunca el contenido.
- **Frontend** (`FormPagoMantenimiento.tsx`, `SeguimientoVoucher.tsx`, `faseVoucher.ts`, `shared/comprobantes.ts#registrarPagoConVoucher`): campo «Adjuntar voucher (opcional)» con las reglas del residente (`errorDeArchivo`); con archivo manda el multipart y muestra «Pago registrado: la IA lo está revisando…», consulta el detalle del departamento cada 3 s (máx. ~2 min) y termina en «pagado (validado automáticamente por la IA)» o «queda en revisión» con el motivo + `EvaluacionPanel` + `ComprobanteVista` reutilizados. Pagos en revisión se validan o rechazan con el `ValidarPagoModal` de siempre (sin cambios).
- Docs: `API-CONTRATO.md` (pago con voucher) y `SEGURIDAD.md` (qué se guarda/audita y un riesgo conocido, abajo).
- Pruebas nuevas: `tests/voucher-admin.test.ts` (17, backend con IA falsa) y `tests/voucher-admin-ui.test.ts` (16: lógica de fases real + estructura por fuente).

**Próximos pasos / decisiones**
- Miguel debe probar en el navegador: registrar un pago con un voucher real (el repo no pinta componentes; las pruebas de pantalla son de lógica y de fuente).
- `src/pages/admin/_parts/cobranza/RegistrarPagoModal.tsx` (fuera de este alcance) usa el mismo formulario: con voucher el formulario se queda en el resultado hasta «Listo» y recién ahí llama a su `onRegistrado` (que cierra el modal y refresca). Si el usuario cierra con la X antes, la lista no se refresca: arreglo de una línea pasando `onPagoCreado={onSaved}` en ese archivo. `MantenimientoAdminModal` ya lo pasa.
- Sin voucher el pago sigue validado al instante; no hay opción de «registrar sin validar» a propósito.

**Gotchas**
- El seguimiento vive DENTRO del formulario: `useResource.reload()` pone `loading` y el modal reemplaza el cuerpo por skeletons (desmontaría el seguimiento); por eso el modal no recarga hasta «Listo».
- La IA guarda su lectura y valida un instante después: cuando ve «coincide» con el pago aún por validar, la pantalla espera una 2.ª lectura antes de decir «en revisión» (`faseVoucher`).
- multer 2: `defParamCharset: 'utf8'` para que los nombres con ñ/tildes lleguen sanos; archivo nuevo del módulo puro se llama `faseVoucher.ts` (no `seguimientoVoucher.ts`: chocaba con `SeguimientoVoucher.tsx` en macOS, que no distingue mayúsculas).
- Una junta que registra sin `usuario_id` deja el pago sin «dueño» y la regla «no validas tu propio pago» no lo atrapa (ya era así con el pago validado al instante); documentado en `SEGURIDAD.md`.
- El alcance de escritura tiene dos capas redundantes (`reciboAccesible(…, escritura)` y `unidadesDe`): la administradora anterior sólo falla la prueba si se quitan las dos.

---

## 2026-10-26 — Claude Code (Haiku 5.5, delegado) — Imprimir el recibo y el comprobante: sólo el recibo, completo, desde la página 1

**Pedido de Miguel:** «imprimir recibo de mantenimiento…» → «Sí, arregla las tres» (esta sesión: IMPRIMIR el recibo). Rama `fix/impresion-recibo` (worktree `.claude/worktrees/impresion-recibo`); sin push (lo sube la sesión principal con OK de Miguel).

**Qué se hizo**
- **Causa** (Safari, captura de Miguel): `visibility:hidden` dejaba el hueco de todo lo demás (página 1 en blanco) y el recibo vivía dentro del modal con alto máximo y scroll, así que salía cortado. Lo mismo en el comprobante del residente.
- `src/pages/shared/mantenimiento/ZonaImprimible.tsx` (nuevo): monta lo imprimible con un portal al final de `<body>`, fuera de `#root`.
- `ReciboImprimible.tsx`: el recibo es `ReciboArticulo` (un componente); se muestra en el modal y se repite en la zona de impresión. Se quitó su `<style>`.
- `PagosResidente.tsx`: `comprobante(p)` igual: modal y zona. Se quitó su `<style>`.
- `src/index.css` (bloque «Impresión»): en pantalla `#zona-imprimible` oculta; en `@media print`, `body > *:not(#zona-imprimible) { display:none !important }`, la zona con alto y scroll libres, `tr { break-inside: avoid }`, encabezado y pie de tabla repetidos, `@page A4 portrait` con 16 mm.
- `tests/impresion-recibo.test.ts` (12 pruebas, de fuente): `display:none` (no `visibility`), zona sin `max-height`/`overflow`/posición fija, filas que no se parten, A4, zona en `<body>`, recibo y comprobante completos dentro de la zona.

**Verificación**
- `TEST_DATABASE_URL=…/house_test_impresion npm test`: 852 pruebas, 852 pasan, 0 fallan.
- `npx tsc -b`, `npx tsc -p tests/tsconfig.json --noEmit`: exit 0. `npm run build`: «✓ built».
- Mutaciones (archivo copiado al scratchpad, verificado con `cmp`, devuelto con `cp`): `visibility:hidden` en vez de `display:none` → rojo; alto/scroll en la zona → rojo; quitar `break-inside` de las filas → rojo; quitar la zona del recibo en `ReciboImprimible.tsx` → rojo. Todas restauradas.
- Chromium headless (binario ya en la caché de Playwright, `--print-to-pdf`, sin instalar nada) sobre una página de prueba con el CSS compilado y 60 conceptos: **2 páginas A4**; la página 1 tiene cabecera, conceptos y total; la página 2 sigue la tabla con el pie y «Dónde pagar»; «Menú de la app» no sale.

**No verificado**
- Safari (donde falló) y el modal real de la app: la prueba de pantalla fue con una página de prueba, no con la app levantada. Miguel debe imprimir un recibo largo desde Safari.
- El paquete `playwright` no está en el repo: no se instaló.

**Decisiones y gotchas**
- El recibo está dos veces en el DOM (modal en pantalla y zona oculta para imprimir). Sólo la zona lleva `id="zona-imprimible"`, así que el id es único.
- `ZonaImprimible` vive en `shared/mantenimiento/` porque esa carpeta era la permitida para esta sesión; si otros usos la necesitan, moverla a `src/ui/`.
- Los `print:hidden` que quedan en el modal del residente no hacen nada ya: el modal no se imprime, sólo la zona.

---

## 2026-10-26 — Claude Code (Haiku 5.5) — Tipo de unidad: al editar ya no sale vacío

**Pedido de Miguel:** «en editar unidad el tipo está vacío, debió marcar departamento» → «Sí, arregla las tres» (esta sesión: el TIPO de unidad). Rama `fix/tipo-unidad` (worktree `.claude/worktrees/tipo-unidad`, sobre `adb0bc0`); sin push (lo sube la sesión principal con OK de Miguel).

**Causa:** el formulario usaba `Departamento`, `Depósito`… con mayúscula, pero la base guarda `departamento` (minúscula, como el seed). Al editar, el `<select>` no encontraba el valor y quedaba vacío.

**Qué se hizo**
- `src/pages/admin/_parts/unidades/tipoUnidad.ts` (nuevo, módulo puro): `TIPOS_UNIDAD` canónico (`departamento`, `casa`, `local`, `estacionamiento`, `deposito`) con etiquetas («Depósito»), `normalizarTipoUnidad` y `etiquetaTipoUnidad`.
- `ModalDeUnidad.tsx`: al editar normaliza el tipo antes de preseleccionarlo; alta nace con `departamento`; si llega un tipo viejo fuera de la lista, aparece como opción para no dejar el select vacío.
- `ListaDeUnidades.tsx`: columna y línea del móvil muestran la etiqueta.
- `src/server/routes/unidades.ts`: `tipo` pasa por normalización (minúscula, sin tilde, recorte) y `z.enum`; fuera de la lista → 422 `campos.tipo` «Tipo inválido (departamento, casa, …)». Sin cambios de esquema ni migración de datos.
- `catalogo/opciones.ts`: se quitó el `TIPOS_UNIDAD` viejo (su único consumidor era el modal).

**Verificación**
- `npm test` (base `house_test_tipo`): 855 pruebas, 855 pasan, 0 fallan. `npx tsc -b`, `npx tsc -p tests/tsconfig.json --noEmit` y `npm run build`: exit 0.
- Pruebas nuevas: `tests/unidades-tipo.test.ts` (HTTP: «Departamento», «Depósito», «  CASA », edición, «Oficina» y «Bodega» → 422) y `tests/unidades-tipo-ui.test.ts` (módulo puro + fuente del formulario y de la lista).
- Mutaciones (archivo copiado al scratchpad, restaurado con `cp` + `cmp`), todas en rojo: quitar la normalización del servidor (4 fallos); normalizar como identidad (1 fallo); el modal sin `normalizarTipoUnidad` al editar (1 fallo).

**Próximos pasos / gotchas**
- No hay migración: las unidades viejas siguen guardadas con su capitalización y la lista las muestra bien vía `etiquetaTipoUnidad`. Si una unidad vieja tiene un tipo fuera de la lista (p. ej. «Oficina»), al guardarla sin cambiar el tipo el servidor responderá 422: la administradora debe elegir uno de la lista.
- Las otras dos sesiones (impresión de recibo y voucher de pago) no se tocaron.

---

## 2026-10-26 — Claude Code (Sonnet 5.5) — Medios de pago ampliados: más entidades, moneda, avisos de formato y cuenta recaudadora

**Pedido de Miguel:** «considera otros bancos y otros formatos de cuenta» → «Sí, constrúyelo con la propuesta completa: más entidades con «Otro» con nombre, moneda, formatos por banco como aviso, CCI con código de banco y la cuenta recaudadora». Rama `feat/medios-ampliados` (sobre `322538b`); sin push (lo sube la sesión principal con OK de Miguel).

**Qué se hizo**
- **Esquema** (`prisma/schema.prisma`, sólo columnas nuevas con default o nullable): `MedioPago.banco_otro`, `moneda` (`PEN` por defecto), `servicio`, `codigo_pago`, `codigo_instruccion`. `tipo` ahora admite `recaudacion`. Prod aplica `db push` al arrancar: las filas existentes quedan en soles y sin nombre de «Otro».
- **Servicio** (`services/mediosPago.ts`): `ENTIDADES` (29: 16 bancos, 10 cajas municipales, 2 financieras y «Otro»; con `grupo`, largos habituales y `codigo_cci`) es la ÚNICA fuente; `GET /api/medios-pago/catalogo` la sirve al formulario (el duplicado `BANCOS` del frontend se eliminó). Reglas: número de cuenta 6–25 (dígitos y guiones, ≥ 6 dígitos); CCI sigue en 20 dígitos exactos; `Otro` exige `banco_otro` (≤ 60) al crear y al editar (422 `campos.banco_otro`; un medio viejo se LEE igual como «Otra entidad»); `moneda` `PEN|USD` (omitida al editar = se conserva); recaudación = entidad + `servicio` (≤ 80) + `codigo_pago` (`departamento|dni|otro`) + `codigo_instruccion` (≤ 120, obligatoria con `otro`); sin número, CCI ni celular.
- **Vecino** (`GET /api/me/medios-pago`, detalle del mantenimiento/recibo, asistente y herramientas `medios_para_pagar`/`medios_de_pago`): `entidad` real, `moneda`/`moneda_nombre`, `servicio` e `instruccion` («Paga desde Pago de servicios en BCP → <servicio>, con el código: B01-804»; la arma el CÓDIGO con el código real de la unidad). Textos de la junta limpios (`limpiarTexto`/`dato`) antes de ir al modelo.
- **Auditoría**: recaudación guarda `{tipo, complejo_id, estructura_id, entidad, servicio}`; el resto, `ultimos4` como siempre.
- **IA de comprobantes** (`contraste.ts`): una recaudación se compara por el nombre del servicio (o el titular), nunca por la entidad sola; si no coincide el destino queda «no comparable» (`null`) con una alerta, el veredicto es `revisar`: no valida solo ni rechaza.
- **Frontend**: `avisos.ts` (lógica pura: `avisoLargoCuenta`, `avisoCci`; sólo avisan, nunca bloquean); `MedioFormModal.tsx` (entidades en `<optgroup>`, nombre si «Otro», moneda, avisos, formulario de recaudación; sin QR para recaudación); `ComoPagar.tsx` y `ReciboImprimible.tsx` muestran entidad real, moneda e instrucción.
- Docs: `API-CONTRATO.md` y `SEGURIDAD.md`.

**Verificación**
- `npm test` (base `house_test`): 836 pruebas, 836 pasan, 0 fallan. `npx tsc -b`, `npx tsc -p tests/tsconfig.json --noEmit` y `npm run build`: exit 0; eslint de los archivos tocados limpio.
- 21 mutaciones (archivo copiado al scratchpad y devuelto con `cp` + `cmp`), todas en rojo: regex de cuenta, «Otro» sin nombre, código de unidad fijo, instrucción de `otro`, moneda pisada al editar, servicio opcional, CCI de 19, nombre real, auditoría de recaudación, código ausente en el vecino y en el recibo, contraste (no comparable / siempre coincide), herramientas y asistente (sin instrucción / sin moneda / sin nombre real), avisos de largo y de CCI, pantalla del vecino, y scope del medio (otro ámbito edita).

**Próximos pasos / decisiones**
- `src/pages/admin/MediosPago.tsx` (la LISTA de la administradora): RESUELTO en una sesión posterior (Haiku 5.5). La segunda línea de la fila usa `m.entidad` + moneda («Soles»/«Dólares») en cuentas bancarias, `entidad · servicio` con ícono `ReceiptPercentIcon` en recaudaciones, y Yape/Plin siguen con «Con/Sin código QR». Prueba: `tests/medios-lista.test.ts`. `datoPrincipal` (tipos.ts) ya devolvía el servicio en la columna «Cuenta o celular».
- Miguel debe probar el formulario y «Cómo pagar» en el navegador (las pruebas de pantalla son de fuente: fijan estructura y textos, no pintan).
- Con una cuenta recaudadora activa, un comprobante cuyo destino no coincide queda «no comparable» aunque haya otras cuentas (no se rechaza): decisión para no dar por distinto un comprobante de «Pago de servicios» que no trae el nombre del servicio.
- `moneda` sólo aplica a `banco`; yape/plin/recaudación se guardan en `PEN`. Nada se convierte: si el recibo es en soles y la cuenta en dólares, el vecino ve el aviso en «Cómo pagar».

**Gotchas**
- El código de `departamento` sale de la unidad del cargo (vecino y recibo); en el asistente, de la primera unidad del vecino que cae en el ámbito del medio; en `medios_de_pago` (gestión) no hay unidad y se lee «el código de tu departamento».
- Las pruebas de `medios-pago.test.ts` que usan a `prop2` tras las de «cargo en la junta» deben iniciar sesión de nuevo (esas pruebas cierran su sesión).

---

## 2026-10-26 — Claude Code (Haiku 5.5) — Mostrar las advertencias del Excel en la ventana de subida

**Pedido de Miguel:** «hazlo así (mostrar las advertencias del Excel en la ventana de subida)». Rama `feat/avisos-excel` (sobre `faedbfe`), sólo frontend; sin push (lo sube la sesión principal con OK de Miguel).

**Qué se hizo**
- `src/pages/admin/_parts/cobranza/resumenExcel.ts` (nuevo, puro): `resumenSubida(r)` → título («Recibo de Octubre 2026 cargado»), línea de conteo («32 departamentos cargados · 1 fila saltada», singular/plural, la de filas se omite si son 0) y `advertencias` (lista vacía si la respuesta no las trae).
- `SubirExcelModal.tsx`: el tipo del resultado es `ResultadoExcel` (con `advertencias?`). Con advertencias: un `Alert tone="warn"` con «Revisa estas filas (N)» y la lista (scroll, `max-h-48`). Sin ellas: el resumen en verde de siempre. Los errores (p. ej. el 409 de recibo con pagos) siguen por `errorText` en el aviso rojo.
- `tests/resumen-excel.test.ts` (nuevo): 11 pruebas (función pura + prueba de fuente del modal).

**Verificación**
- `npm test` con `TEST_DATABASE_URL=…/house_test_avisos`: 795 pruebas, 795 pasan, 0 fallan.
- `npx tsc -b`, `npx tsc -p tests/tsconfig.json --noEmit`, `npm run build`: exit 0.
- Mutaciones (archivo copiado al scratchpad y devuelto con `cp`): quitar la pluralización → 2 rojas; quitar el `map` de la lista → 1 roja; quitar el uso de `resumenSubida` → 1 roja. Restaurados e idénticos (`cmp`).

**Próximos pasos**
- Miguel revisa en el navegador con un Excel real (`docs/ejemplos/block-1-octubre.xlsx`): la prueba de fuente no pinta nada, sólo fija el texto y la estructura.
- Push: lo hace la sesión principal con OK de Miguel.

**Decisiones**
- Las advertencias van en `Alert tone="warn"` (aviso), no en rojo: el recibo sí se creó; son filas a revisar.
- La función pura vive fuera del `.tsx` para poder probarla con `node:test` sin React.

**Gotchas**
- El backend limita a 100 textos y el último puede ser «… y N advertencias más»: se muestra tal cual.

---

## 2026-10-26 — Claude Code (Sonnet 5.5) — No crear cargos de S/ 0.00 al subir el Excel

**Pedido de Miguel:** «hazlo así (no crear cargos de S/ 0.00 al subir el Excel)». Rama `fix/cargos-cero` (sin push; Opus integra).

**Qué se hizo**
- `POST /api/recibos/excel` (`src/server/routes/recibos.ts`): si el monto redondeado es 0.00 (o la celda está vacía) no se crea el `ReciboConceptoUnidad`. El `ReciboConcepto` se mantiene; la suma contra `TOTAL MANT` no cambia. Excel real: 352 celdas → 286 cargos, ninguno en 0.
- Pruebas en `tests/recibos-excel.test.ts` (ajustadas las cuentas y un bloque nuevo «sin cargos en S/ 0.00»: 11 conceptos, detalle de B01-804 con total 272.15, todas las unidades pagan → recibo `pagado`). Docs: `docs/EXCEL-RECIBOS.md`.

**Revisado (sin cambios necesarios):** `lib/mantenimientos.ts`, `services/mantenimiento.ts` (el detalle se arma desde los cargos que existen: omite el concepto en 0; una unidad sin ningún cargo da 404 «Mantenimiento», no 500), `totalesPorRecibo`/`conTotales` (por monto), `tools/gestion.ts` y `residente.ts` (cuentan cargos existentes; mejoran sin ceros). No encontré código del backend que arme un recibo impreso.

**Decisiones / gotchas**
- Una unidad con TODO en 0 queda sin mantenimiento (no aparece en la lista del periodo). Es lo coherente con «nada que cobrar».
- Nota: el detalle del recibo (`conceptos`) sigue listando los 11 conceptos; el frontend no se tocó.

**Próximos pasos / sin tocar a propósito**
- `POST /api/recibos` (emitir a mano, `recibos.ts` ~l.139) crea un cargo por unidad con `c.monto` aunque sea 0: mismo problema, otro flujo.
- Los cargos en 0 ya existentes en la base siguen ahí; si Miguel quiere limpiarlos, hace falta un script aparte (sólo pendientes sin pagos).
- No revisé el frontend (¿asume un cargo por concepto en el recibo impreso o en la vista del residente?).

---

## 2026-10-26 — Claude Code (Sonnet 5.5) — Migrar xlsx a 0.20.3 y leer el Excel real de la administradora

**Pedido de Miguel:** migrar `xlsx` (2 avisos altos) y el problema que encontró Sonnet: `docs/ejemplos/block-1-octubre.xlsx` se rechazaba con 422. Rama `fix/migrar-xlsx` (sin push; Opus integra con cherry-pick).

**Qué se hizo**
- `fix(seguridad): xlsx 0.20.3 desde el CDN de SheetJS`: `package.json` + lock. `npm audit --omit=dev` → 0 vulnerabilidades. El test de caracterización pasó sin cambiar expectativas.
- `fix(seguridad)`: `requireRole('admin')` antes de multer en `POST /api/recibos/excel`; un archivo de más de 10 MB da 422 (antes `MulterError` → 500).
- `fix(recibos): leer el Excel real…`: lector puro en `src/server/lib/excelRecibos.ts` (mes en celda siguiente, año del título/vencimiento, vencimiento como texto o fecha de Excel, encabezado de conceptos en dos filas, nombres normalizados, torre por número, redondeo a 2 decimales, validación contra `TOTAL MANT` ±S/ 0.05). La ruta devuelve `advertencias`. Formato en `docs/EXCEL-RECIBOS.md`.

**Próximos pasos / requiere decisión de Miguel**
- Recibo repetido (mismo condominio/mes/año): RESUELTO en `fix(recibos): no reemplazar desde Excel un recibo que ya tiene pagos` — 409 si algún cargo tiene `Pago` o `estado_pago` ≠ `pendiente`; sin pagos se reemplaza como antes. Un 409 puede haber creado antes `Concepto`s nuevos de la empresa (se crean fuera de la transacción); no afecta recibos.
- Montos 0 o celdas vacías generan cargo en 0 (como siempre): 352 cargos para el archivo real, 66 en cero.
- Frontend: el modal de subida no muestra `advertencias` (no se tocó).
- `Dockerfile`: hace `npm ci` (sin cambios); ahora necesita red hacia `cdn.sheetjs.com` en el build. No se probó el build de Docker.

**Gotchas**
- El `node_modules` del worktree es propio; nunca correr npm en `~/Projectos/house`.
- Una fecha de Excel se toma por su día calendario local (`getFullYear/getMonth/getDate`); probado con TZ Lima, Tokio, Auckland y Honolulu.

---

## 2026-10-26 — Claude Code (Sonnet 5.5) — Seguridad: hallazgos bajos B-3 a B-6

**Pedido de Miguel:** arreglar WhatsApp (mensaje de Evolution + sin timeout), bloqueo de login por cuenta, política de contraseñas y `login_fallido` con el correo tecleado. Rama `fix/seguridad-bajos` (sin push).

**Qué se hizo (un commit por hallazgo, cada uno con su test; mutaciones en rojo)**
- **B-3** `routes/whatsapp.ts`: `AbortSignal.timeout(10 s)` en toda llamada a Evolution; 504 «no respondió a tiempo» / 502 «no hay conexión» / 502 «respondió con error N»; el texto del proveedor sólo al log. Tests en `tests/whatsapp.test.ts`.
- **B-4** `middleware/rateLimit.ts` (`BloqueoCuenta`, reloj inyectable `ahora`, opción `loginCuenta`) + `routes/auth.ts`: 10 fallos/15 min por correo desde cualquier IP → 429 con el mismo mensaje. Éxito limpia la cuenta. Tests: `tests/seguridad-login.test.ts`.
- **B-5** `validation.ts` (`passwordSchema`: letra+número, lista de `lib/contrasenasComunes.ts`) y comparación con el correo en `routes/usuarios.ts` y `routes/me.ts`. Sólo al crear/cambiar. Tests: `tests/seguridad-contrasenas.test.ts`.
- **B-6** `login_fallido`: cuenta real → `usuario_id`/`entidad_id`, sin `detalle`; inexistente → `{ email_enmascarado: 'm***@dominio' }`. Se ajustó la aserción de `tests/negocio.test.ts` (esperaba `{ email }`).
- Docs: `docs/SEGURIDAD.md` (fila 4, Sesiones, Avisos) y informe marcado B-3..B-6 resueltos.

**Verificación:** `npm test` 743/743 (726 + 17 nuevos), `npx tsc -b`, `npx tsc -p tests/tsconfig.json --noEmit` y `npm run build` en verde.

**Próximos pasos / decisiones**
- El frontend no cambió: los formularios de contraseña sólo avisan de la longitud; el 422 del backend trae el mensaje nuevo (letra y número / común / igual al correo). Valorar mostrar la regla en el formulario.
- Al editar un usuario SIN mandar el correo no se compara la contraseña con el correo guardado (zod no lo tiene a mano).
- El bloqueo por cuenta vive en memoria del proceso (se reinicia con el servidor; con varias réplicas cada una cuenta aparte). Permite que un tercero bloquee un correo 15 min a propósito (riesgo aceptado, anotado en SEGURIDAD.md).
- B-1/B-2/B-7 siguen abiertos (B-1/B-2 en la sesión `fix/migrar-xlsx`).

**Gotchas**
- `tests/helpers/env.ts` lee **`TEST_DATABASE_URL`** (por defecto `house_test`), NO `DATABASE_URL`: para usar otra base de pruebas hay que exportar `TEST_DATABASE_URL`. Mis primeras corridas fueron por error contra `house_test` (ver el resumen de la sesión).
- Si `node_modules` es un symlink al checkout principal y alguien reinstala allí, puede quedar a medias (faltó `@prisma/client`); este worktree usa su propio `npm ci` + `npx prisma generate`.

---

## 2026-10-26 — Claude Code (Sonnet 5.5) — Auditoría de seguridad completa del repo

**Pedido de Miguel:** «pasale la skill de seguridad pinea sonnet para hacerlo» (revisión estilo `/security-review` sobre todo el repo, rama `chore/auditoria-seguridad`).

**Qué se hizo (sin push)**
- Informe: `docs/seguridad/auditoria-2026-10-26.md` (hallazgos, revisado sin hallazgos, lo no revisado). Sin Altos; **3 Medios confirmados con test y corregidos** (un commit cada uno):
  - `7fe0691` `GET/PUT /api/empresas` devolvía `whatsapp_token` → `omit` en `routes/empresas.ts`. Test: `tests/seguridad-whatsapp-token.test.ts`.
  - `508afbd` la administradora anterior podía subir/reemplazar comprobantes (alcance de lectura) → `cargarPagoASubir` con `scopePagosEscritura` en `routes/comprobantes.ts`. Test: `tests/seguridad-comprobante-escritura.test.ts`.
  - `36befae` `PUT /api/usuarios/:id` con `unidad_id`/cambio de rol soltaba unidades de otra administradora → `scopeUnidades(user)` en `routes/usuarios.ts`. Test: `tests/seguridad-unidad-residente.test.ts`.
- `docs/SEGURIDAD.md`: puntero al informe y la regla de escritura al subir comprobantes.

**Verificación:** `npm test` 720/720 al empezar → 726/726 al terminar (+6 tests); cada test nuevo falla al revertir su arreglo (mutación hecha copiando el archivo a /tmp y devolviéndolo con `cp`). `npx tsc -b`, `npx tsc -p tests/tsconfig.json --noEmit` y `npm run build` en verde.

**Próximos pasos / requiere decisión de Miguel**
- `xlsx@0.18.5` (2 avisos altos, sin parche en npm; sólo lo usa `POST /api/recibos/excel`): migrar a `exceljs` o al paquete del CDN de SheetJS. No se tocó la dependencia.
- Bajos sin arreglar (ver informe): multer antes de `requireRole` en `/api/recibos/excel`, mensajes del proveedor y falta de timeout en `routes/whatsapp.ts`, sin bloqueo por cuenta en el login, política de contraseñas, correo tecleado en `login_fallido`.
- Un residente con unidades en dos administradoras es editable por ambas (consecuencia del modelo «residente sin empresa»): decisión de producto.

**Gotchas:** `crudRouter` devuelve la fila completa del modelo: cualquier columna con credenciales (`whatsapp_token`) exige `omit`. `cargador()` en `comprobantes.ts` recibe el alcance como parámetro: subir y validar usan alcance de ESCRITURA, ver usa el de lectura.

---

## 2026-10-25 — OpenCode (MiniMax M3.1) — El menú sin «Personas» y las acciones dentro de la ficha de datos

**Pedido de Miguel** (sobre la entrega anterior): «quita la sección personas porque residentes ya está dentro de condominios y personal dentro de empresas; sólo faltaría ubicar a proveedores en otro menu»; «hay mucho espacio entre resumen, empresa y condominio en el menu»; «en la página de empresas y condominio, deja sólo el ver ficha, los otros botones quítalos de la lista, y los editar que faltan ponlos dentro de las fichas de datos».

**Qué se hizo (sin push)**

- **Menú (`src/app/nav.ts`):** se elimina el grupo **Personas** (los residentes ya están en la ficha del condominio y el personal en la de la empresa) y **Proveedores** pasa al grupo **Operación** (al final). **Resumen · Empresas · Condominios** quedan en **un solo grupo sin rótulo**: antes cada uno era un grupo aparte y el `space-y-5` de la barra dejaba huecos entre ellos; ahora van juntos, separados por los 2 px de siempre.
  - Superadmin: Resumen · Empresas · Condominios · **Cobranza** · **Operación** (Unidades, Mantenimiento, Conceptos, Avisos, WhatsApp, Proveedores) · **Plataforma**.
  - Admin: Resumen · Condominios · **Cobranza** · **Operación** · **Cuenta**.
  - Las rutas `/admin/residentes` y `/admin/personal` **siguen existiendo** (quedan fuera del menú): no se rompe ningún enlace guardado.
- **Listas con sólo «Ver ficha»:** `src/pages/admin/Complejos.tsx` y `src/pages/superadmin/Empresas.tsx` pierden los botones de fila (contratos, editar, eliminar). En la lista de condominios quedan el enlace a la ficha y el alta del encabezado; en la de empresas, lo mismo.
- **Las acciones viven en la pestaña Datos de su ficha:**
  - `src/pages/admin/CondominioDetalle.tsx`: **Contratos · Editar · Eliminar** dentro de la tarjeta de Datos (ya no en el encabezado). El borrado pide confirmación y, al terminar, vuelve a la lista.
  - `src/pages/superadmin/EmpresaDetalle.tsx`: **Editar · Eliminar** dentro de Datos.
- **`src/pages/superadmin/_parts/ModalDeEmpresa.tsx` (nuevo):** el formulario de la empresa (que estaba embebido en la lista) pasa a un componente compartido, como ya se hizo con `ModalDeComplejo`. La lista lo usa para el alta; la ficha, para editar.

**Verificación (números reales)**
- `npm test` → **720/720** en verde (714 antes: +6 de `tests/torres-fichas-ui.test.ts`).
- `npx tsc -b`, `npx tsc -p tests/tsconfig.json --noEmit` y `npm run build` en verde; `eslint` sin errores en los archivos tocados (los ~1300 del repo son **preexistentes**).
- **Mutaciones comprobadas** (se rompe el código y la prueba correspondiente se pone roja): volver a meter el grupo Personas en el menú (2 pruebas en rojo), volver a poner el botón de editar en la fila de la lista de condominios (1 en rojo), sacar el botón Editar de la pestaña Datos de la ficha del condominio (1 en rojo).

**Próximos pasos**
1. Mirarlo en el navegador: el menú sin huecos, la lista con sólo «Ver ficha» y las acciones dentro de Datos.
2. Decidir si las pantallas sueltas `/admin/residentes` y `/admin/personal` se borran o se dejan como acceso directo.

**Gotchas**
- La barra lateral separa los grupos con `space-y-5` (`src/app/Shell.tsx`): dos ítems que van juntos tienen que **compartir grupo**; sin rótulo no hay separación visual extra.
- `createRoles: []` y `deleteRoles: []` en `src/server/routes/empresas.ts` **no** significan «nadie»: `requireRole()` deja pasar siempre al superadmin (`src/server/crud.ts`). Por eso el alta y el borrado de empresas son del superadmin y los del admin dan 403.
- Borrar una empresa con condominios da 409 (P2003: «La operación viola una relación con otros registros»): el mensaje lo arma `src/server/middleware/error.ts`.

---

## 2026-10-25 — OpenCode (MiniMax M3.1) — Menú por objeto de trabajo, ficha del condominio y de la empresa, y las torres de punta a punta

**Pedido de Miguel:** reorganizar la app (menú, fichas y torres) en **una sola entrega**: el menú ordenado por objeto de trabajo, la ficha de cada entidad con pestañas, y el hueco de las torres (que existen en el modelo y no se podían dar de alta ni asignar). Diseño pactado y escrito en `docs/superpowers/specs/2026-10-25-reorganizacion-app-torres-drill-down-design.md`.

**Qué se hizo (sin push)**

- **Menú (`src/app/nav.ts`):** cada grupo es un objeto de trabajo. Admin: Resumen · Condominios (sueltos) · Cobranza (Recibos, Pagos, Medios de pago, Morosidad) · Operación (Unidades, Mantenimiento, Conceptos, Avisos, WhatsApp) · Personas · Cuenta. Superadmin: además Empresas suelta arriba y **Plataforma al final** (Usuarios del sistema, Auditoría, Llavero de IA). Las pantallas de personas siguen en el menú: son la vista transversal.
- **Ficha del condominio (`src/pages/admin/CondominioDetalle.tsx`, ruta `/admin/condominios/:id`):** pestañas **Datos · Torres · Unidades · Residentes · Recibos**; la pestaña viva va en `?vista=` (se puede compartir y sobrevive al F5). Encabezado con nombre, tipo, dirección, administradora y contadores de unidades y torres; acciones Editar y Contratos. Cada pestaña reutiliza el componente que ya existía (TorresDelCondominio, ListaDeUnidades, PersonasLista, ListaDeRecibos).
- **Ficha de la empresa (`src/pages/superadmin/EmpresaDetalle.tsx`, ruta `/superadmin/empresas/:id`):** pestañas **Datos · Personal · Condominios**. «Mi empresa» del admin (`/admin/configuracion`) gana la pestaña **Personal** con el mismo componente.
- **Torres (el hueco que se cierra):** `src/pages/admin/_parts/condominio/TorresDelCondominio.tsx` da de alta la torre con su **cantidad de pisos** (0–60), la edita (agrega pisos, no borra los que ya tienen unidades), la borra y ofrece **«asignar las unidades que no tienen torre»** (mueve sólo las del condominio y dice cuántas). `src/pages/admin/_parts/condominio/ModalDeComplejo.tsx` (nuevo) extrae el alta/edición del condominio, que antes estaba dentro de la lista.
- **Torres planas, con la frontera explícita:** la UI no ofrece «torre padre» y `POST/PUT /api/estructuras` rechaza `padre_id` («House trabaja con torres planas»). El motor entero (ámbito de la junta, resumen por torre, Excel) agrupa por torre directa; una torre anidada sería un dato que la app no sabría representar.
- **Baja protegida:** `DELETE /api/estructuras/:id` devuelve 422 si la torre tiene unidades **o** usuarios de junta asignados. Si se borrara la torre de un presidente, su `estructura_id` quedaría nulo y su alcance se ampliaría **en silencio** a todo el condominio (`filtroAmbito`).
- **Unidades de punta a punta:** `GET /api/unidades` ahora trae `include.estructura` y acepta el filtro `estructura_id`; la lista tiene columna **Torre** y filtro «Filtrar por torre»; el modal tiene selects dependientes condominio → torre → piso (al cambiar de condominio se limpian torre y piso; al cambiar de torre, el piso) y manda `estructura_id`/`piso_id`.
- **Backend:** `src/server/routes/estructuras.ts` (cantidad_pisos con la torre y sus pisos en una transacción, pisoagregado al editar, baja protegida, `POST /:id/asignar-unidades`), `src/server/routes/unidades.ts` (include + filtro), `src/server/routes/complejos.ts` (filtro `empresa_id`), `src/server/lib/rutasApp.ts` (las dos rutas nuevas las conoce el asistente).
- **Vocabulario:** la UI dice **torre**, no block: `nombreBlock` → `nombreTorre`, «Filtrar por torre», «Todas las torres», «Torre de la junta» (con la ayuda «Sin torre, la junta alcanza todo el condominio»), medios de pago, morosidad, periodo de recibo y pagos. El modelo sigue siendo `Estructura` y la columna `estructura_id`: no se toca el esquema.

**Verificación (números reales)**
- `npm test` → **714/714** en verde (666 antes: +21 de `tests/unidades-torres.test.ts` y +27 de `tests/torres-fichas-ui.test.ts`).
- `npx tsc -b`, `npx tsc -p tests/tsconfig.json --noEmit` y `npm run build` en verde; `eslint` sin errores en los archivos tocados (quedan 2 errores **preexistentes** en `PersonasLista.tsx` por `react-refresh/only-export-components`: exporta `departamentos` y `ubicacion`).
- **Mutaciones comprobadas** (se rompe el código y la prueba correspondiente se pone roja): quitar el `include.estructura`; quitar el filtro `estructura_id`; permitir `padre_id`; quitar la guarda de borrado por unidades; renombrar el grupo Plataforma; no escribir la pestaña en la URL; no mandar `estructura_id` en el modal.

**Próximos pasos**
1. Revisar en navegador las dos fichas y el menú nuevo (sobre todo en móvil: la barra de pestañas se desborda).
2. Probar el alta de torres en producción: las Torres 1–8 vinieron del seed y hay unidades cargadas sin torre; la acción «asignar las unidades que no tienen torre» las recoge.
3. Decidir si la ficha de empresa del superadmin necesita también la pestaña Condominios con su propio resumen (hoy es una tabla con enlace a la ficha del condominio).

**Gotchas**
- `tests/tsconfig.json` tuvo que incluir `../src/vite-env.d.ts`: el test de fuente del menú importa `src/app/nav.ts`, que (por los tipos de `AuthContext`) arrastra `src/api.ts`, y sin los tipos de Vite `import.meta.env` no compila.
- La junta de una torre no puede leer `/api/unidades` (el scope la rechaza): para comprobar que su alcance NO se amplía al borrar una torre hay que mirar `GET /api/medios-pago/ambitos` (`fijo: true` y la estructura de su torre).
- `z.never()` y `validarRefs` rechazan `padre_id` los dos: quitar sólo el esquema no cambia lo observable (mutación equivalente); el test de fuente sí lo detecta.
- Las pruebas comparten `house_test` y se vacían en cada archivo: un test que deja unidades con torre hace fallar a otro que cuenta las que están sin torre (hay que dejar el estado explícito).
- `PersonasLista` sin encabezado (`sinEncabezado`) ahora muestra su propia barra con el alta: en las pestañas de las fichas hace falta, si no no había forma de crear desde ahí.

---

## 2026-10-25 — OpenCode (MiniMax M3.1) — Llavero de IA: proveedores plegados por defecto + iconos de marca

**Pedido de Miguel:** en la página del Llavero de IA, que los cards de los proveedores estén colapsados por defecto y se puedan expandir/contraer, y poner los iconos oficiales de los proveedores (que ya están en el proyecto My Workspace / dashboardia-llm).

**Qué se hizo (sin push)**
- **Iconos de marca:** `src/ui/proveedoresIcono.ts` (mapa slug → logo/color/monograma, sin React, testeable) y `src/ui/IconoProveedor.tsx` (el componente). Portado de `apps/frontend/app/components/common/ProviderIcon.tsx` de My Workspace: logo real para Gemini, OpenAI, NVIDIA y Ollama; monograma con el color oficial de la marca para Groq, OpenRouter, DeepSeek, Mistral, Cerebras, Cohere y SambaNova; gris con iniciales para LLM7 y Kilo (la librería no trae su logo). Se agregó `react-icons@5.7.0` (la misma versión que fija My Workspace); antes el repo sólo usaba `@heroicons/react`.
- **Plegado por defecto:** `GrupoProveedor` arranca con `useState(false)`: la cabecera (logo, nombre, descripción, resumen y chevron) siempre visible; las filas de claves quedan en `hidden` hasta que se despliega. Botón con `aria-expanded`/`aria-controls` (patrón disclosure) y el chevron gira 180° al abrir. «Agregar clave» queda FUERA del botón que pliega: agregar una clave no pliega ni despliega el grupo.
- **Resumen de claves:** `resumenClaves()` en `_parts/llavero/tipos.ts` («Sin clave guardada.», «2 claves · 1 pausada · 1 de reserva»), visible aunque el grupo esté plegado.
- **«Cómo se usan»:** los proveedores del orden llevan su icono.

**Verificación**
- `npm test` → 666 en verde (652 antes + 14 de `tests/llavero-ui.test.ts`).
- `npx tsc -b`, `npx tsc -p tests/tsconfig.json --noEmit` y `npm run build` en verde; `eslint` sin errores en los archivos tocados (el repo arrastra deuda de lint previa: 1319 errores en otros archivos).
- **Mutación:** `useState(false)→useState(true)`, `hidden={!abierto}→hidden={false}` y quitar `rotate-180` ponen rojos los tres tests correspondientes; se restauró el código.
- **HTML real (SSR con `renderToStaticMarkup`):** `aria-expanded="false"`, `aria-controls="llavero-claves-gemini"`, `<ul … hidden>`, SVG del logo presente y «Agregar otra clave» después del cierre del botón que pliega.

**Próximos pasos**
1. Revisar en navegador (claro y oscuro, móvil) el plegado y el tamaño de los iconos.
2. Decidir si el estado de plegado debe conservarse entre recargas (hoy se reinicia en cada visita).
3. Si se quiere el logo real de LLM7 o Kilo, hace falta un SVG propio: la librería no lo trae.

**Gotchas**
- La primera corrida de `npm test` falló en `tests/personas.test.ts` (500 al crear un condominio y la lista de herramientas del asistente) y las corridas siguientes pasaron 666/666: el estado de `house_test` cambia entre sesiones; si vuelve a fallar, aplicar el esquema con `DATABASE_URL=…house_test npx prisma db push` y repetir.
- El repo no tiene `testing-library`: el comportamiento de UI se fija con tests de fuente (`tests/llavero-ui.test.ts`) y con SSR manual; `tsx` fuera del repo compila JSX clásico, hay que pasar `--tsconfig tsconfig.app.json`.
- `react-icons` entra al chunk del Llavero (~19,7 kB sin comprimir en el build de Vite); Vite lo elimina por árbol.

---

## 2026-10-25 — Claude Code (Haiku 4.5 + OpenCode/Minimax) — Sincronización de WhatsApp por administradora + «Usuarios del sistema» + departamento editable

**Pedido de Miguel:** que el administrador sincronice su propio número para enviar mensajes a través de su cuenta vinculada, escaneando el QR generado por Evolution API. Además: «Usuarios globales» debía mostrar sólo las cuentas del sistema, y el departamento de un residente salía vacío y no se podía cambiar.

**Qué se hizo (sin push)**
- **Esquema ADITIVO:** `EmpresaAdministradora.whatsapp_instance` (nombre de la instancia) y `EmpresaAdministradora.whatsapp_token` (token aleatorio por instancia, generado en el servidor; nunca sale por la API). Se aplicó con `prisma db push` a `house` y `house_test`.
- **Backend:** `src/server/routes/whatsapp.ts` con `POST /sync` (crea la instancia `house_empresa_<id>` si falta, la guarda y devuelve el QR en base64), `GET /status` (`connected` + estado de Evolution) y `DELETE /disconnect` (logout y desvincula). Admin y superadmin; sin empresa → 400; sin `EVOLUTION_URL` → 503; la instancia se resuelve siempre por `usuario.empresa_id` (nada de instancia global).
- **Envío por la instancia de cada administradora:** `src/server/services/avisos/canales.ts` ya no usa `EVOLUTION_INSTANCE`; `cola.ts` resuelve la administradora del recibo/cargo/pago (`resolveInstance`) y, sin instancia, el aviso queda `omitida` con «Sincronización de WhatsApp no configurada para la administradora».
- **Frontend:** página `/admin/whatsapp` (QR + polling) usando el helper `api()` — el `fetch` suelto que se había escrito rompía el CSRF (403 «Falta o no coincide el token CSRF»). Ruta en `App.tsx`, ítem en `nav.ts` y ruta conocida por el asistente (`src/server/lib/rutasApp.ts`).
- **Usuarios del sistema:** `/superadmin/usuarios` ahora es sólo superadmins (antes mezclaba residentes y personal en pestañas); el ítem del menú se renombró a «Usuarios del sistema».
- **Departamento de un residente:** `PUT /api/usuarios/:id` acepta `unidad_id` (así se edita): el update del usuario suelta el departamento anterior y toma el nuevo en transacción (`CrudOptions.update` nuevo en `src/server/crud.ts`); `unidad_id: null` lo deja sin departamento y cambiar de rol (propietario ↔ inquilino) mueve el mismo departamento.
- **Limpieza:** fuera los `console.log` de depuración del chequeo de origen (`src/server/services/sesiones.ts`).

**Verificación**
- `npm test` → 652 pruebas en verde (antes 648: se actualizaron los de avisos al modelo por administradora y se agregaron `tests/whatsapp.test.ts` y dos casos de departamento en `tests/personas.test.ts`).
- `npx tsc -b`, `npx tsc -p tests/tsconfig.json --noEmit` y `npm run build` en verde; `eslint` sin errores en los archivos tocados (el repo arrastra deuda de lint previa).
- **Mutación:** quitar la asignación del nuevo departamento (`tx.unidad.update`) pone rojo el test del cambio de departamento; se restauró el código. Otra mutación (quitar el filtro `id: {not: unidad_id}`) resultó EQUIVALENTE: no cambia lo observable.

**Próximos pasos**
1. Probar el flujo completo de escaneo con un número real (Evolution API v1 del VPS) y verificar la recepción del mensaje.
2. Webhook de Evolution por instancia (el `whatsapp_token` ya está guardado para eso): mensajes entrantes y estado de la sesión.
3. `npm run seed:libertadores` en la base local para tener el condominio y ver la pantalla con datos reales.

**Gotchas**
- La vinculación depende de la Evolution API (`EVOLUTION_URL`, `EVOLUTION_APIKEY`) y de su versión: las rutas usadas son de la v1 (`/instance/create`, `/instance/connect/{instancia}`, `/instance/connectionState/{instancia}`, `/instance/logout/{instancia}`).
- En el frontend toda mutación debe ir por `api()` (cookie + `X-CSRF-Token`); un `fetch` suelto devuelve 403.
- La instancia se llama `house_empresa_<id>`; si Evolution responde «already exists» se sigue con ella y se guarda en la administradora.
- `EVOLUTION_INSTANCE` ya no existe: el token de cada instancia se genera y se guarda en la base.

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

## 2026-10-28 — Claude Code (Opus 5.5) — CCI con guiones, «block» en medios de pago, pago parcial oculto, datos del recibo de octubre

**Pedido de Miguel:** «el cci esta bien pero sale validacion en el campo, los medios de pago son por bloc, oculta lo de pagos parciales no existe por ahora el concepto en este condominio, subes los datos del recibo de octubre…»

- **CCI:** el formulario y el servidor aceptan guiones y espacios (`002-19411395382707392`) y guardan sólo los 20 dígitos.
- **Medios de pago:** `/api/medios-pago/ambitos` devuelve el `tipo` de cada estructura; si todas son `block`, la pantalla y el formulario dicen «block» en vez de «torre» (`palabraEstructura` en `_parts/medios/tipos.ts`).
- **Pago parcial de un concepto:** oculto en el detalle del mantenimiento (`PAGO_PARCIAL_CONCEPTO = false`); el endpoint sigue.
- **Producción (con auditoría):** se comprobó que el recibo 1 ya es octubre (los 32 dptos. cuadran con el Excel de octubre en total y agua). Se cargaron: emisión 27-10-2026, corte de agua 10-11-2026, notas de pago, contacto de administración (Melina Loayza), correo del block y la lectura de agua de B01-804 (1416.574 → 1430.897, factor 4.9315 → S/ 70.63, igual al impreso).
- **Pendiente de Miguel:** cuenta BCP y CCI reales, foto de cabecera, logo, lecturas de los otros 31 dptos. y la foto del contómetro.

## 2026-10-28 — Claude Code (Opus 5.5) — Logo de la empresa desde la ficha del superadmin

**Pedido de Miguel:** «Sí, agrégalo» (subir el logo de la empresa desde su cuenta de superadmin).

- `superadmin/EmpresaDetalle.tsx`, pestaña Datos: sección «Recibo impreso» con `ImagenEditable` (mismo componente que «Mi empresa»). El backend ya lo permitía (`requireRole` deja pasar al superadmin y `scopeEmpresas` le da todas); se añadió la prueba de API en `tests/recibo-datos.test.ts`.
