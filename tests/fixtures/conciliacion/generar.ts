// Genera los extractos SINTÉTICOS de las pruebas de conciliación (un banco por archivo, más uno raro). Todo es inventado: nombres, números de cuenta
// y operaciones no existen. Se corre una vez y los archivos se commitean:  npx tsx tests/fixtures/conciliacion/generar.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const serial = (y: number, m: number, d: number) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);

/** Los mismos movimientos en todos los bancos (abonos y cargos), cada banco los escribe a su manera. */
const MOVS = [
  { dia: 5, desc: 'TRANSF DE DEMO UNO', monto: 150, op: '100234' },
  { dia: 6, desc: 'TRANSF DE DEMO DOS', monto: 150, op: '100235' },
  { dia: 6, desc: 'PAGO LUZ DEMO', monto: -80, op: '100236' },
  { dia: 7, desc: 'DEPOSITO VENTANILLA DEMO', monto: 1234.56, op: '100301' },
  { dia: 8, desc: 'COMISION MANTENIMIENTO', monto: -45.5, op: '' },
  { dia: 9, desc: 'INTERESES GANADOS', monto: 3, op: '' },
  { dia: 12, desc: 'TRANSF DE DEMO TRES', monto: 150, op: '100410' },
];
const dd = (d: number) => String(d).padStart(2, '0');
const miles = (n: number) => Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const europeo = (n: number) => miles(n).replace(/,/g, '_').replace('.', ',').replace(/_/g, '.');

function libro(filas: unknown[][], nombre: string, tipo: XLSX.BookType) {
  const ws = XLSX.utils.aoa_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
  fs.writeFileSync(path.join(aqui, nombre), XLSX.write(wb, { type: 'buffer', bookType: tipo }));
}

// BCP (.xlsx): título arriba, un solo «Monto» con signo, fechas dd/mm/aaaa como texto.
libro([
  ['Consulta de movimientos'], ['Cuenta: 000-0000000-0-00 (DEMO)  Moneda: SOLES'], [],
  ['Fecha', 'Fecha valuta', 'Descripción operación', 'Monto', 'Saldo', 'Sucursal - agencia', 'Operación - Número', 'Operación - Hora', 'Usuario', 'UTC', 'Referencia2'],
  ...MOVS.map((m) => [`${dd(m.dia)}/10/2026`, `${dd(m.dia)}/10/2026`, m.desc, m.monto, 5000, '000-DEMO', m.op, '10:30', '', '', '']),
], 'bcp.xlsx', 'xlsx');

// Interbank (.csv, coma, UTF-8): Cargo y Abono separados, montos entre comillas con miles.
const csvIbk = [
  'Estado de cuenta DEMO', 'Cuenta: 000-0000000000 (inventada)', '',
  '"Fecha","Fecha de proceso","Nro. de operación","Movimiento","Descripción","Canal","Cargo","Abono","Saldo contable"',
  ...MOVS.map((m) => `"${dd(m.dia)}/10/2026","${dd(m.dia)}/10/2026","${m.op}","TRANSFERENCIA","${m.desc}","BANCA POR INTERNET","${m.monto < 0 ? miles(m.monto) : ''}","${m.monto > 0 ? miles(m.monto) : ''}","5,000.00"`),
].join('\r\n');
fs.writeFileSync(path.join(aqui, 'interbank.csv'), csvIbk, 'utf8');

// BBVA (.xls): «Importe» con signo (negativos entre paréntesis o con «-»), fechas dd-mm-aa.
libro([
  ['BBVA - Movimientos DEMO'], [],
  ['F. Operación', 'F. Valor', 'Código', 'N° Doc.', 'Concepto', 'Importe', 'Oficina'],
  ...MOVS.map((m, i) => [`${dd(m.dia)}-10-26`, `${dd(m.dia)}-10-26`, '1001', m.op, m.desc, m.monto < 0 ? (i % 2 ? `(${miles(m.monto)})` : `-${miles(m.monto)}`) : miles(m.monto), '0001']),
], 'bbva.xls', 'biff8');

// Scotiabank (.xlsx): fechas como serial de Excel, montos «S/ 1,234.56».
libro([
  ['Scotiabank - Estado de cuenta DEMO'],
  ['Fecha', 'Descripción', 'Nro Operación', 'Cargo', 'Abono', 'Saldo'],
  ...MOVS.map((m) => [serial(2026, 10, m.dia), m.desc, m.op, m.monto < 0 ? `S/ ${miles(m.monto)}` : '', m.monto > 0 ? `S/ ${miles(m.monto)}` : '', 'S/ 5,000.00']),
], 'scotiabank.xlsx', 'xlsx');

// BanBif (.csv, punto y coma, ANSI/Latin-1): glosa con tildes, montos «1.234,56».
const csvBif = [
  'BanBif;Movimientos DEMO;;;;;', '',
  'Fecha Operación;Fecha Valor;Glosa;Nro. Operación;Cargos;Abonos;Saldo',
  ...MOVS.map((m) => `${dd(m.dia)}/10/2026;${dd(m.dia)}/10/2026;${m.desc.replace('DEPOSITO', 'DEPÓSITO')};${m.op};${m.monto < 0 ? europeo(m.monto) : ''};${m.monto > 0 ? europeo(m.monto) : ''};5.000,00`),
].join('\r\n');
fs.writeFileSync(path.join(aqui, 'banbif.csv'), Buffer.from(csvBif, 'latin1'));

// «Raro» (.xlsx): encabezados que ningún sinónimo reconoce, fechas mezcladas (ISO, serial y texto) y columnas en otro orden.
libro([
  ['Cuándo', 'Qué pasó', 'Plata que entró', 'Plata que salió', 'Clave'],
  ...MOVS.map((m, i) => [i % 3 === 0 ? `2026/10/${dd(m.dia)}` : i % 3 === 1 ? serial(2026, 10, m.dia) : `${dd(m.dia)}.10.2026`, m.desc, m.monto > 0 ? m.monto : '', m.monto < 0 ? -m.monto : '', m.op]),
], 'raro.xlsx', 'xlsx');

console.log('Extractos sintéticos escritos en', aqui);
