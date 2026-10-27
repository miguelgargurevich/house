# Formato de Excel para crear recibos por departamento

La administradora sube un Excel con los cargos de cada departamento y el sistema crea el recibo, los conceptos y los cargos de una sola vez.

## Ejemplo

Ver `docs/ejemplos/block-1-octubre.xlsx` (copia real del archivo de la administradora del condominio).

## Estructura esperada

Se lee la primera hoja. Las filas vacías se ignoran. El lector (`src/server/lib/excelRecibos.ts`) no depende del número de fila, sino de lo que dice cada celda:

| Fila (del ejemplo) | Contenido | Cómo se lee |
|------|-----------|------|
| 1 | `GRUPO VRANY` · `MANTENIMIENTO DE OCTUBRE 2026` | El año se toma de «OCTUBRE 2026» si el mes no lo trae |
| 2 | `MES` · `Octubre` · `VENCIMIENTO:` · `02 DE NOVIEMBRE DE 2026` | Mes y vencimiento (ver abajo) |
| 3 | `BLOCK` · `Dpto.` · `Apellidos y Nombres` · `Conceptos por cobrar` | Fila de encabezado: su primera celda es `BLOCK` |
| 4 | Nombres de concepto: `ADMINISTRACION VRANY`, `LUZ AREAS COMUNES DEL CONDOMINIO`, …, `TOTAL MANT`, `DEUDA ACUMULADA`, `TOTAL` | Ver «Conceptos» |
| 5+ | Una fila por departamento | Ver «Filas de datos» |
| Última | `TOTALES` | Se ignora |

### Mes, año y vencimiento (sólo se buscan encima de la fila `BLOCK`)

- **Mes:** `MES: Octubre`, `MES;Octubre`, `MES: Octubre 2026`, o `MES` en una celda con el mes en la **siguiente celda no vacía** de la misma fila.
- **Año:** el de la celda del mes (si lo trae); si no, el de un texto «OCTUBRE 2026» (p. ej. el título); si no, el año del vencimiento.
- **Vencimiento:** `VENCIMIENTO:` con la fecha en la misma celda o en la siguiente no vacía, como texto (`02 DE NOVIEMBRE DE 2026`) o como fecha de Excel. Sin vencimiento se usa el día 1 del mes siguiente.
- Sin mes o sin año → 422 «No se encontró el mes y año en el Excel».

### Conceptos

- Si la fila `BLOCK` sólo trae «Conceptos por cobrar» (encabezado en dos filas), los nombres están en la fila **siguiente**; si trae nombres en la misma fila, se usa ésa.
- Cada nombre se normaliza: se recorta y los espacios y saltos de línea se colapsan en un espacio (`FONDO DE ⏎CONTINGENCIA` → `FONDO DE CONTINGENCIA`).
- **No son conceptos:** `TOTAL MANT`, `DEUDA ACUMULADA`, `TOTAL` (sin distinguir mayúsculas). Los conceptos se leen desde la cuarta columna.
- Un nombre repetido se usa una sola vez (advertencia).
- Cada concepto se crea (si no existe) como concepto de la empresa.

### Filas de datos

1. `BLOCK` — la torre se reconoce por su **número**: `B.1`, `B1`, `B-1`, `BLOCK 1`, `Block 1`, `TORRE 1`, `T1` y `1` son la torre 1. Se busca la estructura del condominio cuyo nombre tenga ese mismo número (`Block 1`, `B.1`, …): debe haber **una sola**; si hay varias o ninguna, advertencia y se salta la fila. Si el condominio no tiene estructuras, la unidad se busca sólo por el número de departamento.
2. `Dpto.` — número de departamento (`101` o `"101"`). Se busca la unidad de esa torre cuyo código **termine** en ese número (`B01-101`, `B.1-101`, `101`; `B.1-1101` no). Si no existe (o hay varias), advertencia y se salta la fila.
3. `Apellidos y Nombres` — referencial.
4. Montos de cada concepto. Cada cargo se **redondea a 2 decimales** (half-up) y se guarda como Decimal.
5. `TOTAL MANT` — se valida: si la suma de los cargos redondeados de la fila difiere de `TOTAL MANT` en más de **S/ 0.05**, advertencia para ese departamento (los cargos se crean igual).
6. `DEUDA ACUMULADA` y `TOTAL` — referenciales.

Filas sin `BLOCK`/`Dpto.` y la fila `TOTALES` se ignoran (cuentan como «saltadas», sin advertencia).

## Reglas de negocio

- **Cada torre/block tiene su propio recibo mensual** (26-oct). Las filas del Excel se agrupan por la columna `BLOCK` y se crea o reemplaza **un `Recibo` por torre** (con `estructura_id` y la descripción «Mantenimiento de octubre de 2026 · Block 1»). Un Excel de UNA sola torre sólo toca el recibo de ESA torre; las demás no se tocan. En un condominio SIN torres hay un solo recibo, sin torre.
- Cada recibo lleva el vencimiento y todos los conceptos (monto del concepto en 0; el monto va por unidad).
- Se crea un `ReciboConceptoUnidad` por cada concepto+departamento **con monto mayor a 0**. **Un monto que redondeado da S/ 0.00, o una celda vacía, NO genera cargo** (26-oct: un cargo en 0 nacía «pendiente», nunca se pagaba y ensuciaba avisos y estadísticas); un texto no numérico tampoco. El concepto del recibo (`ReciboConcepto`) se conserva aunque todas sus celdas sean 0, y la validación contra `TOTAL MANT` suma igual. Un departamento con todo en 0 queda sin cargos (no tiene mantenimiento que cobrar). En el Excel de ejemplo: 352 celdas → 286 cargos. Los cargos en 0 que ya existían en la base no se tocan.
- El estado inicial de cada cargo es `pendiente`.
- **Recibo repetido (mismo condominio, TORRE, mes y año):** si ningún cargo del recibo de ESA torre tiene pagos (`Pago`, en cualquier `estado_validacion`) ni un `estado_pago` distinto de `pendiente`, el endpoint **reemplaza** los conceptos y cargos por los del Excel y lo deja `emitido` (sirve para corregir una subida equivocada). Si alguno los tiene, responde **409** `El recibo de octubre de 2026 · Block 1 ya tiene pagos registrados; no se puede reemplazar desde Excel` (con la torre) y no cambia nada. Todo va en UNA transacción con un candado por (condominio, mes, año): si falla una torre del archivo no se crea ninguna, y dos subidas simultáneas del mismo periodo se hacen cola (no hay recibos duplicados).
- **Recibo viejo sin torre:** si ya existe un recibo del mismo mes SIN torre que cobra a unidades de la torre del Excel (un recibo emitido antes de que existiera el recibo por torre), se responde **409** y no se crea el recibo de la torre (se cobraría dos veces). Se arregla corriendo `scripts/migrar-recibos-por-torre.ts`, que le asigna su torre.

## Multa y mora

La columna `MULTA PAGO FUERA DE FECHA(ULTIMO DIA 2 CADA MES)` (cualquier concepto cuyo nombre diga «multa» o «mora») se trata así al crear el recibo de la torre (reglas completas en `docs/COBRANZA.md`):

- Una unidad con monto **> 0** en esa columna: se respeta tal cual (no se le suma mora encima).
- Una unidad con 0 o vacío que **pagó tarde** el recibo del mes anterior de la misma torre: el sistema pone en esa columna el monto de mora del condominio (`mora_monto`, S/ 20 por defecto), con el motivo «Pago fuera de fecha del recibo de setiembre de 2026».
- Sin esa columna en el Excel, la mora entra como el concepto «Multa por pago fuera de fecha» (recargo).
- Reimportar el mismo Excel reemplaza el recibo y recalcula: nunca suma dos moras. La respuesta trae `mora` con la cantidad, la lista de departamentos y el mensaje «Se agregó mora de S/ 20 a N departamentos».

## Endpoint

`POST /api/recibos/excel` — cuerpo: `multipart/form-data` con campo `archivo` (el `.xlsx`) y `complejo_id`.

Responde 201 con `mora` (ver arriba), `recibo_id` (el de la primera torre), `recibos` (`[{recibo_id, estructura_id, torre, accion: 'creado'|'reemplazado', unidades_procesadas}]`, uno por torre del archivo), `mes`, `anio`, `unidades_procesadas` (todas las torres), `filas_saltadas`, `conceptos` y `advertencias` (lista de textos en español; máximo 100). El mes se lee con «setiembre» o «septiembre».

Errores: 403 si no eres admin (el rol se revisa antes de recibir el archivo); 422 si falta el archivo o `complejo_id`, el archivo pesa más de 10 MB, no es un Excel válido o no tiene mes/año, fila `BLOCK` ni conceptos, o (condominio con torres) ninguna fila del archivo es de una torre del condominio.

## Notas

- Los montos pueden tener espacios (ej. ` 2.53 `) y coma decimal (`7,5`); se limpian antes de guardar.
- Se lee con `xlsx` (SheetJS) 0.20.3, desde el CDN de SheetJS (la 0.18.5 de npm tiene avisos de seguridad altos).
- El archivo se procesa en memoria; no se guarda en disco.
