# Formato de Excel para crear recibos por departamento

La administradora sube un Excel con los cargos de cada departamento y el sistema crea el recibo, los conceptos y los cargos de una sola vez.

## Ejemplo

Ver `docs/ejemplos/block-1-octubre.xlsx` (copia real del archivo de la administradora del condominio).

## Estructura esperada

Las primeras filas son metadatos (se ignoran filas vacías y las que empiezan con `;`):

| Fila | Contenido |
|------|-----------|
| 1 | `;GRUPO VRANY;;MANTENIMIENTO DE OCTUBRE 2026;;...` (título del grupo/condominio) |
| 5 | `;;;MES;Octubre;;VENCIMIENTO:;;02 DE NOVIEMBRE DE 2026;;;;;;;;` |
| 7 | `BLOCK;Dpto.;Apellidos y Nombres;Conceptos por cobrar;;...` |
| 8 | Encabezado de conceptos: `ADMINISTRACION VRANY`, `LUZ AREAS COMUNES DEL CONDOMINIO`, `LUZ COMUN DEL BLOCK`, `AGUA COMUN DEL CONDOMINIO`, `AGUA DPTO.`, `FONDO DE CONTINGENCIA DEL BLOCK`, `FONDO DE CONTINGENCIA DEL CONDOMINIO`, `MANTENIMIENTO DE ASCENSOR`, `MANTENIMIENTO DE CISTERNA`, `OTROS`, `MULTA PAGO FUERA DE FECHA(ULTIMO DIA 2 CADA MES)`, `TOTAL MANT`, `DEUDA ACUMULADA`, `TOTAL` |
| 9+ | Una fila por departamento con los montos de cada concepto |
| Última | `TOTALES` (se ignora) |

## Columnas de datos (por departamento)

1. `BLOCK` — identificador del block (ej. `B.1`)
2. `Dpto.` — número de departamento (ej. `101`)
3. `Apellidos y Nombres` — propietario/inquilino (referencial)
4. Conceptos por cobrar (uno por columna, monto numérico)
5. `TOTAL MANT` — total del mantenimiento (validación opcional)
6. `DEUDA ACUMULADA` — deuda pendiente anterior (referencial)
7. `TOTAL` — total a pagar (referencial)

## Reglas de negocio

- El bloque se busca como estructura de tipo `block` dentro del condominio elegido.
- El departamento se busca como unidad dentro de ese block (código `B.1-101` o buscado por block + número).
- Si el departamento no existe, la fila se salta con advertencia.
- Cada concepto de la cabecera se crea (si no existe) como concepto del condominio/empresa.
- Se crea un `Recibo` por mes/año/vencimiento con todos los conceptos.
- Se crea un `ReciboConceptoUnidad` por cada concepto+departamento con el monto del Excel.
- El estado inicial de cada cargo es `pendiente`.
- Es idempotente: si el recibo (mes+año+condominio) ya existe, se actualizan los cargos en lugar de duplicar.

## Endpoint

`POST /api/recibos/excel` — cuerpo: `multipart/form-data` con campo `archivo` (el `.xlsx`) y `complejo_id`.

Responde con el resumen: cuántos cargos se crearon, cuántas unidades se procesaron, cuántas filas se saltaron.

## Notas

- Los montos pueden tener espacios (ej. ` 2.53 `) y se limpian antes de guardar.
- El separador decimal es punto (`.`).
- Las filas de totales y las vacías se ignoran.
- El archivo se guarda temporalmente y se borra tras procesar.
