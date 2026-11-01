// Genera los extractos SINTÉTICOS de la conciliación v2 (hoja buena en segunda posición, saldo ascendente/descendente/roto). Todo es inventado.
// Escribe SÓLO los archivos nuevos (no toca los de `generar.ts`):  npx tsx tests/fixtures/conciliacion/generar-v2.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const aqui = path.dirname(fileURLToPath(import.meta.url));

// BCP «accountDetail»: el libro trae primero una hoja de resumen y el extracto en la SEGUNDA hoja, con filas de título antes del encabezado, el monto con signo
// (una sola columna), la fecha como texto «dd/mm/aaaa» y glosas tipo «YAPE MANUEL CAV». No trae columna de saldo.
const resumen = XLSX.utils.aoa_to_sheet([
  ['Consulta de movimientos'], ['Cuenta de ahorros DEMO'], [],
  ['Cuenta', 'Titular', 'Moneda'], ['000-0000000-0-00', 'Condominio Demo', 'SOLES'],
]);
const detalle = XLSX.utils.aoa_to_sheet([
  ['Movimientos del 05/10/2026 al 08/10/2026'], [],
  ['Fecha', 'Descripción operación', 'Monto', 'Sucursal - agencia', 'Operación - Número', 'Usuario'],
  ['05/10/2026', 'YAPE MANUEL CAV', 150, '000-DEMO', '100501', ''],
  ['06/10/2026', 'TRAN PEREZ DEMO JUAN', 150, '000-DEMO', '100502', ''],
  ['06/10/2026', 'PAGO LUZ DEMO', -80, '000-DEMO', '100503', ''],
  ['07/10/2026', 'DEPOSITO VENTANILLA DEMO', 1234.56, '000-DEMO', '100504', ''],
  ['08/10/2026', 'COMISION MANTENIMIENTO', -45.5, '000-DEMO', '', ''],
]);
const libro = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(libro, resumen, 'Resumen');
XLSX.utils.book_append_sheet(libro, detalle, 'accountDetail');
fs.writeFileSync(path.join(aqui, 'bcp-detalle.xlsx'), XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }));

// Con columna de saldo. Saldo anterior al primer movimiento: 1000.00. Abonos 1387.56, salidas 125.50, saldo final 2262.06 (= 1000 + 1387.56 − 125.50).
const MOVS = [
  ['05/10/2026', 'TRANSF YAPE MANUEL CAV', '', '150.00', '1150.00'],
  ['06/10/2026', 'PAGO LUZ DEMO', '80.00', '', '1070.00'],
  ['07/10/2026', 'DEPOSITO VENTANILLA DEMO', '', '1234.56', '2304.56'],
  ['08/10/2026', 'COMISION MANTENIMIENTO', '45.50', '', '2259.06'],
  ['09/10/2026', 'INTERESES GANADOS', '', '3.00', '2262.06'],
];
const csv = (filas: string[][]) => ['Fecha;Descripción;Cargo;Abono;Saldo', ...filas.map((f) => f.join(';'))].join('\r\n');
fs.writeFileSync(path.join(aqui, 'saldo-asc.csv'), csv(MOVS), 'utf8');
// El banco a veces ordena del más nuevo al más viejo.
fs.writeFileSync(path.join(aqui, 'saldo-desc.csv'), csv([...MOVS].reverse()), 'utf8');
// Falta el depósito de 1 234.56: entre la fila 3 y la 4 el saldo no cuadra.
fs.writeFileSync(path.join(aqui, 'saldo-roto.csv'), csv(MOVS.filter((_, i) => i !== 2)), 'utf8');

console.log('Extractos sintéticos v2 escritos en', aqui);
