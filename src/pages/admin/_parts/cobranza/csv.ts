/** Celda CSV: comillas dobles escapadas y protección contra fórmulas de Excel en los textos. */
function celda(v: string | number): string {
  if (typeof v === 'number') return String(v);
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${seguro.replace(/"/g, '""')}"`;
}

/** Descarga un CSV generado en el navegador (BOM UTF-8 para que Excel respete las tildes). */
export function descargarCSV(nombreArchivo: string, encabezados: string[], filas: (string | number)[][]) {
  const lineas = [encabezados.map(celda).join(','), ...filas.map(f => f.map(celda).join(','))];
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
