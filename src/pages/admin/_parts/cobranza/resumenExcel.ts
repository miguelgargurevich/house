// Lo que la ventana de subida del Excel muestra tras crear el recibo: título, línea de conteo y advertencias.
// Respuestas viejas del backend no traen `advertencias`: se devuelve lista vacía para no romper.

export interface ResultadoExcel {
  recibo_id: number;
  mes: number;
  anio: number;
  unidades_procesadas: number;
  filas_saltadas: number;
  conceptos: number;
  advertencias?: string[];
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function resumenSubida(r: ResultadoExcel) {
  const partes = [plural(r.unidades_procesadas, 'departamento cargado', 'departamentos cargados')];
  if (r.filas_saltadas > 0) partes.push(plural(r.filas_saltadas, 'fila saltada', 'filas saltadas'));
  return {
    titulo: `Recibo de ${MESES[r.mes - 1] ?? r.mes} ${r.anio} cargado`,
    linea: partes.join(' · '),
    advertencias: r.advertencias ?? [],
  };
}
