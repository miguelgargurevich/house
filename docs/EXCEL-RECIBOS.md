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
5. `TOTAL MANT` — se valida: si la suma de los cargos redondeados de la fila difiere de `TOTAL MANT` en más de **S/ 0.05**, advertencia para ese departamento (el cargo se crea igual).
6. `DEUDA ACUMULADA` y `TOTAL` — referenciales.

Filas sin `BLOCK`/`Dpto.` y la fila `TOTALES` se ignoran (cuentan como «saltadas», sin advertencia).

## Reglas de negocio

- Se crea un `Recibo` por mes/año con el vencimiento y todos los conceptos (monto del concepto en 0; el monto va por unidad).
- Se crea un `ReciboConceptoUnidad` por cada concepto+departamento. **Un monto 0 o una celda vacía también genera cargo en 0** (así fue siempre); un texto no numérico no genera cargo.
- El estado inicial de cada cargo es `pendiente`.
- **Recibo repetido (mismo condominio, mes y año):** no se duplica ni da 409; el endpoint es idempotente y **reemplaza** los conceptos y cargos del recibo existente por los del Excel (y lo deja `emitido`). Requiere decisión de Miguel: al reemplazar se borran también los cargos que ya estuvieran pagados o en revisión.

## Endpoint

`POST /api/recibos/excel` — cuerpo: `multipart/form-data` con campo `archivo` (el `.xlsx`) y `complejo_id`.

Responde 201 con `recibo_id`, `mes`, `anio`, `unidades_procesadas`, `filas_saltadas`, `conceptos` y `advertencias` (lista de textos en español; máximo 100). El frontend aún no muestra las `advertencias`.

Errores: 403 si no eres admin (el rol se revisa antes de recibir el archivo); 422 si falta el archivo o `complejo_id`, el archivo pesa más de 10 MB, no es un Excel válido o no tiene mes/año, fila `BLOCK` ni conceptos.

## Notas

- Los montos pueden tener espacios (ej. ` 2.53 `) y coma decimal (`7,5`); se limpian antes de guardar.
- Se lee con `xlsx` (SheetJS) 0.20.3, desde el CDN de SheetJS (la 0.18.5 de npm tiene avisos de seguridad altos).
- El archivo se procesa en memoria; no se guarda en disco.
