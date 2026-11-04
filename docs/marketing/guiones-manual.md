# Guiones de los videos del manual de Torre

Un video corto (15–40 s) por opción del menú de cada rol, en **escritorio (16:9)**; «Ten Torre en tu celular» va en **celular (9:16)**. 45 videos distintos; los que comparten pantalla se reusan
(el inquilino usa los del propietario, jardinería los de limpieza, «Mi perfil» es uno solo). Se generan con `scripts/marketing/videos-manual.mjs --guiones`
(este archivo se regenera; el texto vive en ese módulo). Voz «Dora» de My Workspace (`ef_dora`); método en `docs/marketing/guiones-videos.md` y `docs/manual/README.md`.

Reglas: tuteo, neutro en género, frases cortas, sin precios, explican PARA QUÉ sirve la opción y cómo se usa lo principal. Sin cierre de marca.
Ninguna escena envía, publica ni guarda: lo que podría hacerlo sólo se señala.

---

## `m-admin-resumen` — Resumen (Administradora) · 19,0 s

Tu cobranza de un vistazo: lo cobrado, lo que falta, las unidades morosas y el avance de cada block.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Resumen: tarjetas de cobrado, por cobrar, unidades morosas y tareas abiertas | El Resumen es tu punto de partida: cuánto cobraste este mes, cuánto falta por cobrar, cuántas unidades están morosas y cuántas tareas siguen abiertas. |
| 2 | Se baja a «Emitido vs. cobrado» y «% cobrado por block»; se señala el selector de blocks | Más abajo comparas lo emitido con lo cobrado de los últimos meses y ves el avance de cobro de cada block. Con el selector de arriba, filtras uno solo. |

## `m-admin-condominios` — Condominios (Administradora) · 17,2 s

La lista de condominios que administras y la ficha de cada uno: blocks, unidades, residentes y recibos.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Condominios: la lista con dirección, empresa y unidades; se señala «Nuevo condominio» | Aquí están los condominios que administras, con su dirección y su número de unidades. Con Nuevo condominio registras uno más. |
| 2 | Ver ficha → pestaña Residentes | Entra a la ficha de un condominio para ver sus blocks, sus unidades, sus residentes y sus recibos, y elegir qué avisos salen también por WhatsApp. |

## `m-admin-recibos` — Recibos (Administradora) · 28,4 s

Emite el mantenimiento de cada mes, o sube el Excel del block. El aviso de cada recibo va al grupo de WhatsApp de su block y, por correo, a cada vecino.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Recibos: lista por periodo con el avance de cobro; se señalan «Emitir recibo» y «Subir Excel» | Cada mes emites el recibo de mantenimiento, o subes el Excel del block. Al emitir, Torre te dice si algún block no tiene grupo de WhatsApp. |
| 2 | Recibo de octubre del Block 1: se señala «Avisar a los vecinos» | Cada block tiene su recibo. Abre el de tu block y avisa a los vecinos desde ahí. |
| 3 | Avisar a los vecinos: cuántos reciben por correo y el aviso al grupo del block (no se envía) | Torre cuenta a cuántos vecinos llega por correo, y el aviso va al grupo de WhatsApp del block: un solo mensaje para todos. Nada sale hasta que lo envíes. |
| 4 | Periodo → pestaña «Consolidado del block» | Y en Consolidado del block tienes el resumen del block, listo para imprimir. |

## `m-admin-pagos` — Pagos (Administradora) · 23,2 s

Revisa los pagos que registran los vecinos, valida o rechaza cada uno y registra los que recibes tú.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Pagos: pestañas «Por validar», «Validados» y «Rechazados» | Aquí llegan los pagos que registran los vecinos, con su método, su monto y su estado. Empiezas por los que están por validar. |
| 2 | Revisar: voucher, evaluación automática y conformidad del tesorero (no se valida) | Toca Revisar para ver el voucher, la evaluación automática y la conformidad del tesorero. Luego validas o rechazas el pago. |
| 3 | Se señala «Registrar pago» | Y si recibes un pago por transferencia, Yape, Plin, efectivo o tarjeta, lo registras tú con Registrar pago. |

## `m-admin-conciliacion` — Conciliación (Administradora) · 22,2 s

Cruza el extracto del banco con los pagos registrados para saber qué dinero llegó de verdad.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Conciliación bancaria: la cuenta y «Subir extracto» | Sube el extracto de la cuenta del condominio y Torre cruza cada abono con los pagos registrados. Así ves qué dinero llegó de verdad al banco. |
| 2 | Las tarjetas: conciliados, por revisar, abonos sin voucher y vouchers sin abono | Arriba ves cuántos abonos están conciliados, cuáles faltan por revisar y cuántos vouchers no tienen abono en el banco. |
| 3 | Pestañas «Abonos sin voucher» y «Conciliados» | Con las pestañas filtras por estado: abonos sin voucher, conciliados, salidas y más. |

## `m-admin-medios-pago` — Medios de pago (Administradora) · 16,7 s

Define dónde pagan los vecinos de cada block y activa la validación automática con IA.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Medios de pago: la validación automática y las tarjetas de cada block | Aquí defines dónde pagan los vecinos de cada block: Yape, Plin o una cuenta bancaria, con su titular. También lo puede mantener la junta. |
| 2 | Se señalan el interruptor de validación automática y «Agregar medio de pago» | Arriba puedes activar la validación automática con inteligencia artificial: lee el comprobante y lo compara con lo que se debía. |

## `m-admin-agua` — Lecturas de agua (Administradora) · 17,3 s

Carga la lectura del contómetro de cada departamento para que el agua salga en su recibo.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Lecturas de agua: block, recibo, fecha de corte y tabla de departamentos | Aquí cargas la lectura del contómetro de cada departamento: la anterior, la actual y el factor por metro cúbico. Sale en el recibo de cada vecino. |
| 2 | Se señalan «Descargar plantilla» y «Subir Excel o CSV» | Escribe las lecturas a mano o súbelas con la plantilla de Excel, y Torre calcula el consumo y el monto de cada departamento. |

## `m-admin-morosidad` — Morosidad (Administradora) · 40,0 s

Quién debe, cuánto y desde cuándo. Marcas a los morosos y les envías un recordatorio, por correo o por WhatsApp.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Morosidad: deuda vencida, unidades morosas, mayor atraso y la lista | La morosidad, ordenada de mayor a menor deuda: cuánto se debe, cuántas unidades están morosas y cuál es el mayor atraso. |
| 2 | Casillas por fila: se marcan dos departamentos; se señalan «Marcar todos los de esta página» y «Enviar recordatorio» | Marca a los morosos a quienes quieres recordar, uno por uno, o todos los de esta página de una vez. |
| 3 | Enviar recordatorio: por correo (WhatsApp apagado) y a cuántos llega; no se envía nada | Al enviar recordatorio eliges por dónde: por correo, o también por WhatsApp. Antes ves cuántos lo recibirán. Esto es personal: va directo a cada responsable, no a un grupo. |
| 4 | Así lo recibe cada responsable: su nombre y lo que debe su departamento (no se envía) | Cada responsable recibe sólo lo que debe su departamento, con su nombre. A cada departamento se le recuerda una vez al día. |
| 5 | Se señala «Enviar a N departamentos» y se pulsa «Cancelar» (no se envía) | El botón de enviar dice a cuántos llega. Si no quieres enviar, cancela: nada sale hasta que pulses Enviar. |

## `m-admin-cierres` — Cierres del mes (Administradora) · 21,7 s

Al cerrar el mes, cada junta paga a la administración, a la Junta central y a los servicios; aquí ves el estado de todos los blocks.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Cierres del mes: octubre, tarjetas por block con pagos registrados y facturado | Al cerrar el mes, cada junta de block paga a la empresa administradora, a la Junta central y a los servicios, con su voucher y su conformidad. |
| 2 | Se abre el Block 1 de octubre y se baja por sus pagos | Abre un block para ver cuánto facturó, qué ya se pagó y cuánto sobra para el fondo de ahorros. |
| 3 | Pestañas «Pagos a la administradora» y «Cuentas de destino» | En las otras pestañas ves los pagos a la administradora, los aportes a la Junta central y las cuentas de destino. |

## `m-admin-rendicion` — Rendición del mes (Administradora) · 16,1 s

El informe del mes para la junta o la asamblea: lo cobrado, lo pagado, el saldo, los fondos y la morosidad.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Rendición del mes (octubre, condominio completo): cobrado, egresos, saldo y % cobrado | La rendición del mes es el informe para la junta o la asamblea: lo cobrado, lo pagado, el saldo, los fondos y la morosidad. |
| 2 | Se señalan «Descargar Excel» e «Imprimir / PDF» y se recorren las secciones | Elige el mes y el block, o el condominio completo, y recórrela por secciones. La bajas a Excel o la imprimes en PDF. |

## `m-admin-unidades` — Unidades (Administradora) · 15,9 s

Todas las unidades con su block, propietario, inquilino y estado; las personas de cada departamento y su estado de cuenta.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Unidades: lista con block, propietario, inquilino y estado; buscador y filtros | Todas las unidades del condominio con su block, su propietario, su inquilino y su estado. Busca por código o filtra por block. |
| 2 | Personas del departamento (quién tiene usuario en Torre) y estado de cuenta de la unidad | En cada fila abres las personas del departamento, con quién tiene usuario en Torre, o su estado de cuenta, y editas la unidad. |

## `m-admin-mantenimiento` — Mantenimiento (Administradora) · 17,3 s

Registra las tareas de reparación y cuidado y encárgalas a tu personal o a un proveedor.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mantenimiento: tareas con unidad, asignado, estado y fecha; se señala «Nueva tarea» | Aquí registras las tareas de reparación y cuidado del condominio, y a quién se las encargas: a tu personal o a un proveedor. |
| 2 | Pestañas «Pendientes», «En progreso» y «Completadas» | Cada tarea pasa de pendiente a en progreso y a completada. Con las pestañas ves cada grupo. Usa el buscador para encontrar una tarea por su título. |

## `m-admin-conceptos` — Conceptos (Administradora) · 15,9 s

Lo que se cobra en cada recibo: mantenimiento, agua, luz de áreas comunes y recargo por mora.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Conceptos: lista con descripción, tipo de monto, destino al cerrar el mes y estado | Los conceptos son lo que se cobra en cada recibo: el mantenimiento, el agua, la luz de las áreas comunes y el recargo por mora. |
| 2 | Se señalan el tipo de monto, el destino al cerrar el mes y el interruptor de activo | Cada concepto es fijo o variable, y tiene su destino al cerrar el mes. Con el interruptor lo activas o lo desactivas. |

## `m-admin-comunicados` — Comunicados (Administradora) · 38,2 s

Los avisos para tus vecinos: eliges para quién es, a qué grupos de WhatsApp sale y qué queda en la junta.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Comunicados: los publicados, con para quién, fecha y quién los envió | Los comunicados son los avisos para tus vecinos: cortes, reuniones y trabajos. Ves para quién es cada uno y quién lo envió. |
| 2 | Nuevo comunicado: «Para quién» en «Departamentos elegidos», con la lista de casillas (no se publica) | Toca Nuevo comunicado y elige para quién es. Si eliges departamentos, marcas uno por uno quién lo recibe. |
| 3 | Título y mensaje; más abajo, «A las juntas del condominio» viene desmarcado (no se publica) | Escribe el título y el mensaje. A las juntas sale desmarcado: márcalo sólo si es urgente, porque el grupo de WhatsApp ya lo recibe. |
| 4 | A los grupos de WhatsApp: los del alcance vienen marcados (no se publica) | Lo general va al grupo de WhatsApp: un solo mensaje para todos. Por eso el grupo del block viene marcado. Lo personal va directo, a cada vecino. |
| 5 | Pestaña «Notificaciones»: qué salió por correo y por WhatsApp | En Notificaciones ves qué salió por correo y por WhatsApp, y qué hay que reintentar. |

## `m-admin-areas-comunes` — Áreas comunes (Administradora) · 16,9 s

Define qué áreas pueden reservar los vecinos y atiende sus reservas.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Áreas comunes › Reservas: las pendientes de aprobar | Defines qué áreas pueden reservar tus vecinos, como el salón, la parrilla o la piscina, y atiendes sus reservas. |
| 2 | Se señala aprobar una reserva y se abre la pestaña «Áreas» | En Reservas apruebas, rechazas o cancelas cada solicitud. En Áreas administras las áreas disponibles. Cada área tiene su horario y sus reglas. |

## `m-admin-juntas` — Juntas directivas (Administradora) · 17,0 s

La junta de cada block: sus miembros, su correo y la cuenta donde pagan los vecinos; registra una nueva gestión cuando cambie.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Juntas directivas: la tarjeta de cada block con miembros, correo y cuenta de pago | Cada block tiene su junta directiva: sus miembros, su correo y la cuenta donde pagan los vecinos. |
| 2 | Se abre «Nueva gestión» (no se guarda); se señala «Historial» | Cuando cambia la junta, usa Nueva gestión: los permisos pasan solos, y la gestión anterior queda en el historial. Cada cambio queda registrado con su fecha de inicio. |

## `m-admin-whatsapp` — WhatsApp (Administradora) · 34,8 s

Mira que tu número esté conectado, cuántos mensajes salen, qué blocks tienen grupo y qué avisos salen también por WhatsApp.

| # | En pantalla | Voz |
|---|---|---|
| 1 | WhatsApp: «WhatsApp vinculado correctamente» (el botón para desvincular no se pulsa) | Tu número de WhatsApp ya está vinculado. Desde aquí salen los avisos que marques para WhatsApp, con pausas entre envíos y un tope diario. |
| 2 | Contador: enviados hoy contra el tope, en cola, enviados por tipo y el mes por condominio | El contador muestra lo que salió hoy contra el tope diario, lo que espera en cola, y por tipo: recibos, vencidos o comunicados. |
| 3 | Mis grupos: «Grupos de blocks» y «Falta: Block 14», con el filtro «Sólo los que uso» | En Mis grupos Torre cuenta cuántos blocks tienen su grupo, y te dice cuál falta. Así ningún block se queda sin aviso. |
| 4 | Ficha del condominio › Avisos por WhatsApp: «Recibo del mes» y «Venció» (no se guarda) | En la ficha del condominio eliges qué avisos salen también por WhatsApp. Lo general, como el recibo, va al grupo de cada block. Lo personal, como un vencido, va directo al vecino. |

## `m-admin-proveedores` — Proveedores (Administradora) · 17,0 s

Las fichas de los proveedores externos: ascensores, gasfitería, pintura; elige cuáles ven los vecinos.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Proveedores: lista con rubro, contacto, condominios que atiende, visibilidad y estado | Aquí guardas a los proveedores externos de tu condominio: ascensores, gasfitería, pintura. Son fichas de contacto; ellos no inician sesión. |
| 2 | Se señalan los filtros y la columna «Vecinos» (lo ven / no lo ven) | Decides cuáles ven tus vecinos, y filtras por rubro o por estado. Si un proveedor ya no sirve, márcalo como inactivo. |

## `m-admin-mi-empresa` — Mi empresa (Administradora) · 16,2 s

Los datos de tu administradora y las cuentas de tu equipo.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mi empresa › Datos: razón social, RUC, contacto y logo del recibo | Mi empresa reúne los datos de tu administradora tal como salen en los recibos y comunicados: razón social, RUC, contacto y logo. |
| 2 | Pestaña «Personal»: las cuentas del equipo | En la pestaña Personal creas las cuentas de tu equipo, como seguridad o mantenimiento, y cada persona ve sólo lo de su rol. |

## `m-admin-marca` — Tu marca (Administradora) · 38,3 s

El logo, el nombre comercial y el color de tu administradora: así se ven Torre y sus recibos para tus vecinos.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mi empresa › Datos, sección «Tu marca»: logo, nombre comercial, color y vista previa | Tu marca es el logo, el nombre comercial y el color de tu administradora. Salen en el menú de la app, en el recibo y en los correos de tus vecinos. |
| 2 | Se escribe un nombre comercial de prueba y la vista previa lo muestra (no se guarda) | Escribe el nombre comercial con el que te presentas. Si lo dejas vacío, se usa tu razón social. La vista previa cambia al instante. |
| 3 | Se escribe un color de prueba (#1d4ed8) y la vista previa cambia (no se guarda) | Elige el color con el selector o escribe su código, por ejemplo 1d4ed8. Así se verá tu marca en la app. |
| 4 | Se pulsa «Guardar mi marca» y, en el menú, «Resumen»: el nombre y el color ya salen en la app | Guarda tu marca y Torre la aplica en toda la app. En el menú ya aparecen tu nombre y tu color. |
| 5 | De vuelta en Mi empresa: se quita el nombre, se pulsa «Volver al verde de Torre» y se guarda | Para volver al verde de Torre, pulsa Volver al verde de Torre y guarda. Torre vuelve a verse como siempre. |

## `m-admin-mi-plan` — Mi plan (Administradora) · 16,7 s

El plan de cada condominio, hasta cuándo está vigente, qué incluye y cuánto llevas usando.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mi plan: el condominio, su plan, su vigencia y lo que incluye | Mi plan muestra el plan de cada condominio, hasta cuándo está vigente y todo lo que incluye. |
| 2 | Se señala el uso del mes y el botón «Ver pagos» | También ves cuánto llevas usando este mes, y con Ver pagos revisas los pagos de tu plan. Revísalo cuando quieras para saber qué tienes activo en cada uno de tus condominios. |

## `m-propietario-inicio` — Inicio (Propietario) · 16,9 s

Lo que debes, tu próximo vencimiento y lo que has pagado este año.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Inicio: deuda total, próximo vencimiento y pagado este año | Tu Inicio resume lo que debes, cuándo vence tu próximo pago y cuánto has pagado este año. |
| 2 | Mantenimientos por pagar y comunicados recientes | Debajo ves los mantenimientos por pagar, con su botón para pagar, y los últimos comunicados de tu condominio. Revisa tu Inicio antes de cada vencimiento para no atrasarte. |

## `m-propietario-unidades` — Mis unidades (Propietario) · 16,7 s

Los departamentos, estacionamientos y depósitos que están a tu nombre.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mis unidades: la tarjeta de la unidad con su block y su estado | Mis unidades muestra los departamentos, estacionamientos y depósitos que están a tu nombre, con su block y su estado. |
| 2 | Se señala el inquilino de la unidad | Y si alquilas la unidad, aquí ves quién es tu inquilino. Si no hay nadie, dice Sin inquilino. Si algún dato no es correcto, avísale a tu administración. |

## `m-propietario-recibos` — Mis recibos (Propietario) · 20,5 s

El mantenimiento de cada mes de tu departamento, con todos sus conceptos, y cómo pagarlo.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mis recibos: pestañas «Por pagar», «Vencidos», «En revisión» y «Pagados» | Mis recibos reúne el mantenimiento de cada mes de tu departamento, separado en por pagar, vencidos, en revisión y pagados. |
| 2 | Ver detalle: el recibo concepto por concepto | Toca Ver detalle para ver cada concepto del recibo y los pagos que ya registraste. |
| 3 | Pagar mantenimiento (no se envía) | Con Pagar mantenimiento sigues los pasos y subes tu voucher. El pago queda en revisión hasta que lo validen. |

## `m-propietario-historial` — Mi historial (Propietario) · 16,5 s

Cómo evolucionan tus pagos: por mes, por concepto, el agua y tu puntualidad.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mi historial › Resumen: pagado, promedio, deuda de hoy, puntualidad y gráfico mensual | Mi historial muestra cómo evolucionan tus pagos: cuánto pagas cada mes, tu promedio, tu deuda de hoy y tu puntualidad. |
| 2 | Pestañas «Por concepto» y «Puntualidad»; se señala «Estado de cuenta» | Cambia de pestaña para verlo por concepto, acumulado, agua o puntualidad, y baja tu estado de cuenta. También puedes bajarlo a Excel. |

## `m-propietario-junta` — Mi junta (Propietario) · 15,6 s

Quiénes forman la junta de tu block y la Junta central, y a dónde pagar.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mi junta: la junta del block y la Junta central con sus miembros | Mi junta te dice quiénes forman la junta de tu block y la Junta central, con su presidente y su tesorero. |
| 2 | Dónde pagas: se señalan los botones para copiar la cuenta | Y en Dónde pagas ves la cuenta o el Yape de cada junta, que copias con un toque. Así sabes siempre a quién escribir y adónde hacer tu pago. |

## `m-propietario-proveedores` — Proveedores (Propietario) · 16,4 s

Los servicios de confianza que tu administración comparte contigo.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Proveedores: fichas por rubro (ascensores, gasfitería, electricidad…) | Proveedores reúne los servicios de confianza que tu administración comparte contigo: ascensores, gasfitería, electricidad y más. Están ordenados por rubro. |
| 2 | Se señalan los botones Llamar, WhatsApp y Escribir de una ficha (no se pulsan) | Cada ficha tiene su contacto y botones para llamar, escribir por WhatsApp o enviar un correo. |

## `m-propietario-comunicados` — Comunicados (Propietario) · 17,2 s

Lo que la administración y la junta anuncian a tu condominio.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Comunicados: lista con etiqueta de quién lo publicó, fecha y mensaje | Aquí aparecen los comunicados que la administración y la junta anuncian a tu condominio: cortes, reuniones, trabajos y avisos importantes. |
| 2 | Se señala el comunicado fijado y se baja por la lista | Los más importantes quedan fijados arriba, y cada uno dice quién lo publicó y cuándo. Revísalos seguido para no perderte nada. |

## `m-propietario-reservas` — Reservas (Propietario) · 16,2 s

Reserva el salón, la parrilla u otra área común viendo qué horarios están libres.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Reservas: «Reservar un área» y «Mis reservas» | Reservas te deja pedir el salón, la parrilla u otra área común de tu condominio, viendo qué horarios están libres. |
| 2 | Se elige «Zona de parrillas» y un día: salen los horarios del día (no se reserva) | Elige el área y el día, mira los horarios libres y reserva. Tus reservas quedan a la derecha, y puedes cancelar las que aún no empiezan. |

## `m-junta-mi-junta` — Mi junta (Junta (tesorero o presidente de un block)) · 16,9 s

Los miembros de tu junta, su correo y la cuenta donde pagan tus vecinos.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mi junta: la junta del Block 1 con sus miembros y su cuenta | Mi junta muestra a los miembros de tu junta, su correo y la cuenta donde pagan tus vecinos. |
| 2 | Se señalan «Editar» y «Agregar cuenta» | Puedes editar el correo y la cuenta. Los miembros y las gestiones nuevas las registra la administración. Mantenlos actualizados para que tus vecinos sepan a quién escribir. |

## `m-junta-medios-pago` — Medios de pago (Junta (tesorero o presidente de un block)) · 15,7 s

Las cuentas y los Yape o Plin donde pagan los vecinos de tu block.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Medios de pago: la tarjeta del Block 1 con su junta y su cuenta | Aquí mantienes al día las cuentas y los Yape o Plin donde pagan los vecinos de tu block. |
| 2 | Se señalan el interruptor de la cuenta y «Agregar medio de pago» | Agrega un medio de pago, edítalo o desactívalo cuando cambie, y los vecinos siempre ven el correcto. Revisa que el titular y el número sean los de tu junta. |

## `m-junta-pagos` — Pagos por validar (Junta (tesorero o presidente de un block)) · 18,9 s

Confirma que el dinero llegó a la cuenta de la junta; la administración valida cada pago.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Pagos: los de los vecinos del block, con voucher y estado | Aquí ves los comprobantes que suben los vecinos de tu block. Como tesorero, confirmas que el dinero llegó a la cuenta de la junta. |
| 2 | Revisar: voucher y conformidad del tesorero (no se confirma) | Abre Revisar para ver el voucher y registrar tu conformidad. Después, la administración valida el pago. Así el dinero que llega a la cuenta queda respaldado por tu conformidad. |

## `m-junta-cierre` — Cierre del mes (Junta (tesorero o presidente de un block)) · 17,4 s

Al cerrar el mes, registras lo que paga tu junta a la administración, a la Junta central y a los servicios.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Cierre del mes (octubre): facturado, cobrado y pagado por la junta | Al cerrar el mes, la junta paga a la empresa administradora, a la Junta central y a los servicios, con el voucher de cada pago. |
| 2 | Se señalan «Registrar pago» y «Ver voucher» (no se pulsan) | Cada tarjeta muestra lo facturado, lo cobrado y lo pagado, con su botón para registrar el pago. El cierre se hace hacia el día cinco del mes siguiente. |

## `m-junta-comunicados` — Comunicados (Junta (tesorero o presidente de un block)) · 29,3 s

Avisa a los vecinos de tu block: el grupo del block recibe un solo mensaje, y la junta sólo si es urgente.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Comunicados de la junta, con destinatarios y fecha | Aquí escribes anuncios para los vecinos de tu block y ves cuáles ya publicaste. Cada uno muestra para quién es, su fecha y quién lo envió. |
| 2 | Nuevo comunicado: «Para quién» fijo en tu block, título y mensaje (no se publica) | Toca Nuevo comunicado. Como junta publicas para tu block: escribe el título y el mensaje. |
| 3 | Más abajo: «A la junta del block» desmarcado y el grupo de tu block marcado (no se publica) | Lo general va al grupo de tu block, un solo mensaje para todos, y viene marcado. A la junta, o a cada vecino, sólo si es urgente. |
| 4 | Lista de comunicados publicados: se señala el primero (no se publica nada) | Al publicar, el comunicado aparece en la app de los vecinos de tu block, y el grupo recibe el aviso. |

## `m-junta-proveedores` — Proveedores (Junta (tesorero o presidente de un block)) · 16,1 s

Los servicios externos de tu condominio: agrega y edita los que atienden sólo a tu condominio.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Proveedores: lista con rubro, contacto, condominios y estado | Aquí ves los servicios externos de tu condominio: ascensores, gasfitería, pintura. Puedes agregar y editar los que atienden sólo a tu condominio. |
| 2 | Se señalan los filtros por rubro y estado | Los que también atienden a otros condominios los gestiona la administración, y aquí los ves de sólo lectura. |

## `m-junta-aportes` — Aportes de los blocks (Junta central) · 15,9 s

Lo que cada block transfirió a la cuenta de la Junta central al cerrar el mes, con la conformidad del tesorero central.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Aportes de los blocks (octubre): facturado, registrado y con conformidad | Aportes de los blocks muestra lo que cada block transfirió a la cuenta de la Junta central al cerrar el mes. |
| 2 | Se señalan «Ver voucher» y la conformidad del tesorero central | El tesorero central confirma que el dinero llegó, y puedes ver el voucher de cada aporte. Cada aporte muestra cuándo se pagó y quién lo registró. |

## `m-junta-cierre-central` — Cierre de la Junta central (Junta central) · 16,4 s

Lo que entra y sale de la cuenta de la Junta central y su fondo de ahorros.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Cierre de la Junta central (octubre): ingresos, egresos y saldo del mes | Aquí ves lo que entra y sale de la cuenta de la Junta central: los aportes de los blocks, el alquiler de estacionamientos, los servicios y los proveedores. |
| 2 | Fondo de ahorros y se señalan «Registrar ingreso» y «Registrar egreso» | Y el fondo de ahorros de la Junta central, con su saldo acumulado. Lo ves mes a mes, para llevar las cuentas claras. |

## `m-mantenimiento-inicio` — Inicio de mantenimiento (Mantenimiento) · 15,8 s

Tus tareas pendientes, en progreso y completadas de un vistazo.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Inicio: pendientes, en progreso y completadas | Tu Inicio muestra de un vistazo cuántas tareas tienes pendientes, cuántas están en progreso y cuántas ya completaste. |
| 2 | Tareas recientes y «Ver todas» | Debajo ves las últimas tareas que siguen abiertas, y con Ver todas vas a tu lista completa. Así sabes por dónde empezar. |

## `m-mantenimiento-tareas` — Mis tareas (mantenimiento) (Mantenimiento) · 16,1 s

Los trabajos que te asignó la administración y su avance.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mis tareas: pestañas «Pendientes», «En progreso» y «Completadas» | Mis tareas reúne los trabajos que te asignó la administración, separados en pendientes, en progreso y completadas. |
| 2 | Se pasa por las pestañas y se señala el botón de avance de una tarea (no se pulsa) | Cuando empiezas un trabajo lo marcas en progreso, y cuando terminas, lo marcas como completado. Así la administración ve tu avance. |

## `m-seguridad-inicio` — Inicio de seguridad (Seguridad) · 16,9 s

El condominio que tienes asignado y el acceso rápido a las unidades.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Inicio: condominio asignado y número de unidades | Tu Inicio muestra el condominio que tienes asignado y cuántas unidades tiene. Es tu punto de partida cada vez que entras. |
| 2 | Consultar unidades → «Ir a Unidades» | Desde aquí vas directo a Unidades, para saber a quién visitan antes de autorizar el ingreso. En Unidades sólo puedes consultar, no modificar nada. |

## `m-seguridad-unidades` — Unidades (seguridad) (Seguridad) · 17,3 s

Consulta el propietario y el inquilino de cada unidad antes de autorizar una visita.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Unidades: propietario, inquilino y estado de cada unidad (sólo lectura) | En Unidades consultas el propietario y el inquilino de cada departamento antes de autorizar una visita. Es de sólo lectura. |
| 2 | Se busca una unidad por su código | Escribe el código de la unidad y encuentras al instante a quién visitan. Así autorizas cada ingreso con la información correcta, sin llamar a nadie. |

## `m-limpieza-inicio` — Inicio de limpieza y jardinería (Limpieza) · 17,1 s

Tu trabajo de limpieza o jardinería de un vistazo.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Inicio: pendientes, en progreso y completadas | Tu Inicio muestra tu trabajo de un vistazo: cuántas tareas tienes pendientes, en progreso y completadas. |
| 2 | Tareas recientes y «Ver todas» | Debajo ves las últimas tareas que siguen abiertas, y con Ver todas vas a tu lista completa. Revísalo al empezar tu turno para saber por dónde comenzar. |

## `m-limpieza-tareas` — Mis tareas (limpieza y jardinería) (Limpieza) · 16,1 s

Los trabajos que te asignó la administración y su avance.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mis tareas: pestañas «Pendientes», «En progreso» y «Completadas» | Mis tareas reúne los trabajos que te asignó la administración, separados en pendientes, en progreso y completadas. |
| 2 | Se pasa por las pestañas y se señala el botón de avance de una tarea (no se pulsa) | Cuando empiezas un trabajo lo marcas en progreso, y cuando terminas, lo marcas como completado. Así la administración ve tu avance. |

## `m-perfil` — Mi perfil (Propietario) · 15,5 s

Tus datos, tu contraseña, tus sesiones abiertas y tu celular para recibir avisos.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Mi perfil: datos personales y contraseña | En Mi perfil cambias tu nombre y tu contraseña. Tu correo y tu rol los gestiona tu administración. |
| 2 | Se baja a «Sesiones activas» y «Celular y avisos» | Más abajo ves los dispositivos donde tienes la sesión abierta, y en Celular y avisos registras tu celular para recibir los avisos. |

## `m-todos-instalar` — Ten Torre en tu celular (Propietario) · 31,2 s

Cómo agregar Torre a la pantalla de inicio de tu celular: en Android, con el aviso Instalar Torre, y en iPhone, desde Safari.

| # | En pantalla | Voz |
|---|---|---|
| 1 | Inicio de sesión en el celular | Torre también funciona en tu celular. Puedes agregarla a tu pantalla de inicio y abrirla como una app, sin la barra del navegador. |
| 2 | Android: aparece el aviso «Ten Torre en tu celular» y se señala «Instalar Torre» | En Android, el aviso Instalar Torre aparece arriba. Tócalo: tu celular te pide confirmar y Torre queda en tu pantalla de inicio. |
| 3 | Android: se señala «Ahora no», que quita el aviso de ese celular | Si no quieres instalarla ahora, toca Ahora no. Ese aviso no vuelve a salir en este celular. |
| 4 | iPhone (Safari): el aviso explica «Compartir» y «Agregar a inicio»; se señala el texto | En iPhone, Torre se instala desde Safari. Toca el botón Compartir, y luego Agregar a inicio. Torre queda con su ícono, como cualquier app. |
