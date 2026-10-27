# Reglas de cobranza

Tres reglas que Miguel pidió el 26-oct-2026 («la fecha de pago se calcula del voucher; la fecha de corte es el día de vencimiento del recibo, como el Excel; avisos por correo y WhatsApp 2 días antes y el mismo día si no subió el voucher; la mora es de S/ 20 en el recibo del mes siguiente»). El código vive en `src/server/services/fechaVoucher.ts`, `services/avisos/cola.ts` y `services/mora.ts`.

## 1. La fecha de pago es la del voucher

- La IA lee el voucher (`services/evaluacion.ts`, igual si lo sube el residente o la administración). Si lee una fecha con un comprobante legible, de una operación no pendiente ni fallida, `Pago.fecha_pago` de **todo el grupo del mantenimiento** pasa a esa fecha (se guarda al mediodía UTC del día leído, para que cualquier zona horaria muestre el mismo día). Si el mantenimiento ya estaba validado, la fecha de pago de sus cargos se actualiza igual.
- No se aplica y el pago queda **para revisar** si la fecha leída es **futura** (después de hoy en Lima) o **anterior a la emisión del recibo − 60 días**. La validación automática de la IA tampoco lo valida solo.
- Si no la lee (o no hay IA / clave), queda la fecha declarada por quien registró el pago. `Pago.fecha_origen` lo deja a la vista de quien valida: `declarada` (aún sin evaluar o sin voucher), `voucher`, `no_leida`, `invalida` (leída pero futura o muy antigua) y `manual` (la corrigió una persona con `PATCH /api/pagos/:id`; ninguna evaluación posterior la pisa).
- `Pago.fecha_declarada` guarda la fecha declarada al aplicar la del voucher: si un voucher posterior no se puede leer, se restaura.
- Auditoría: acción `fecha_pago_voucher` sobre el pago, con `{origen, anterior, nueva}` (días `AAAA-MM-DD` en Lima; `motivo` y `leida` si no se aplicó).
- Pantallas: el detalle del pago (`ValidarPagoModal`) muestra «Fecha del voucher» o «Fecha del pago» con su origen, y una advertencia si no se leyó o no se aplicó; el historial del mantenimiento lo dice al pasar el cursor.

## 2. Recordatorios: exactamente dos por recibo y unidad sin voucher

- `por_vencer`: **2 días antes** del vencimiento. `vence_hoy`: **el día del vencimiento**. Cada uno por correo y por WhatsApp, y sólo a quien tenga ese canal activo **con un correo o un celular real**: sin correo/celular el aviso no sale (en Los Libertadores los 32 propietarios del Block 1 tienen correo PROVISIONAL, así que hoy no les llega nada; hay que cargar sus datos reales).
- Sólo a las unidades **sin voucher**: si el cargo está `en_revision` (subió voucher) o `pagado`, no se manda. Un pago rechazado devuelve el cargo a `pendiente` (los recordatorios pendientes todavía pueden salir, pero nunca se repite uno ya enviado).
- `vencido` sigue como estaba (venció ayer, hasta 3 días atrás). Un recibo emitido el mismo día no recibe recordatorios ese día: ya se avisó al emitirlo. Un recibo emitido a 2 días o menos de vencer sólo recibe `vence_hoy`.
- «Hoy» y «faltan 2 días» son del calendario de Lima (`America/Lima`, UTC−5 sin horario de verano): a las 00:00:00 de Lima ya cuenta el día nuevo; a las 23:59:59 del día anterior, no.
- Repetir el planificador (cada 15 min) no duplica: una fila por usuario, canal, tipo y recibo. Los textos dicen el departamento y la torre, piden subir el voucher y avisan de la mora del condominio (si es 0, no la mencionan).

## 3. Mora de S/ 20 en el recibo siguiente

- **Monto por condominio**: `ComplejoHabitacional.mora_monto` (Decimal, 20.00 por defecto, 0 = sin mora). La administración lo edita en la ficha del condominio (`PATCH /api/complejos/:id { mora_monto }`; la junta no).
- **Quién pagó tarde**: al crear el recibo de un mes (Excel o `POST /api/recibos`) se mira el recibo **del mes anterior de la MISMA torre**. Una unidad pagó tarde si, al día de vencimiento de ese recibo (inclusive, hora de Lima), **no tiene pagos con `fecha_pago` (la del voucher) ≤ vencimiento que cubran el saldo de cada cargo**. Cuentan los pagos validados y por validar; el rechazado no; un pago parcial no cubre. Una unidad sin cargos en ese recibo no debe nada. Un cargo `pagado` sin ningún `Pago` (dato anterior al flujo de pagos) cuenta por la fecha del propio cargo.
- Si el recibo anterior **aún no venció** (hoy ≤ su vencimiento en Lima) no se evalúa a nadie y la respuesta lo avisa en `advertencias`. Sin recibo anterior de esa torre (primer recibo, o un mes sin recibo) no hay mora. Otra torre u otro condominio nunca cuentan.
- **Qué se crea**: si el Excel trae la columna de multa («MULTA PAGO FUERA DE FECHA…», cualquier concepto con «multa» o «mora» en el nombre) con un monto **> 0** para la unidad, **se respeta** (no se duplica). Si trae 0 o vacío y la unidad pagó tarde, el sistema pone el monto de mora en esa misma columna; si el Excel no tiene la columna (o es una emisión manual), crea el concepto «Multa por pago fuera de fecha» (recargo) en el recibo. La línea lleva el motivo en `observaciones`: «Pago fuera de fecha del recibo de setiembre de 2026». En una emisión manual, si quien emite ya incluye una multa con monto > 0, no se agrega mora encima.
- **Idempotente**: la mora se calcula al crear el recibo; reimportar el mismo Excel reemplaza el recibo (borra sus cargos) y recalcula, así que nunca suma dos moras (y un recibo que ya tiene pagos no se reemplaza: 409). Además `crearLineaDeMora` no vuelve a agregarla a una unidad que ya la tiene con el mismo motivo.
- **Respuesta** (`POST /api/recibos/excel` y `POST /api/recibos`): `mora: {monto: '20.00', cantidad, departamentos: [{recibo_id, torre, unidad_id, codigo}], mensaje: 'Se agregó mora de S/ 20 a N departamentos: B.1-103, …' | null}`. La ventana de subida del Excel muestra el mensaje.
- **El residente** ve en su recibo la línea de mora con su motivo (`conceptos[].motivo` de `GET /api/me/mantenimientos/:reciboId/:unidadId`).

## No cubre

- No hay pasarela de pago ni se mueve dinero: la mora es un cargo más del recibo.
- Un recibo emitido ANTES de esta regla no se recalcula; la mora sólo entra al crear (o reemplazar) el recibo del mes siguiente.
