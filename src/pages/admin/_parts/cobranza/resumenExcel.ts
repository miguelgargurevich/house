// Lo que la ventana de subida del Excel muestra tras crear los recibos: título, línea de conteo, un renglón por torre y advertencias.
// Respuestas viejas del backend no traen `advertencias` ni `recibos`: se devuelven listas vacías para no romper.
import { periodo } from '../../../../ui/format';

export interface ReciboDeExcel {
  recibo_id: number;
  estructura_id: number | null;
  torre: string | null;
  accion: 'creado' | 'reemplazado';
  unidades_procesadas: number;
}

export interface ResultadoExcel {
  recibo_id: number;
  /** Un recibo por torre: lo que se hizo con cada uno. */
  recibos?: ReciboDeExcel[];
  mes: number;
  anio: number;
  unidades_procesadas: number;
  filas_saltadas: number;
  conceptos: number;
  advertencias?: string[];
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export function resumenSubida(r: ResultadoExcel) {
  const partes = [plural(r.unidades_procesadas, 'departamento cargado', 'departamentos cargados')];
  if (r.filas_saltadas > 0) partes.push(plural(r.filas_saltadas, 'fila saltada', 'filas saltadas'));
  const recibos = r.recibos ?? [];
  const sufijo = recibos.length === 1 && recibos[0]!.torre ? ` · ${recibos[0]!.torre}` : '';
  return {
    titulo: recibos.length > 1 ? `Recibos de ${periodo(r.mes, r.anio).toLowerCase()} cargados: uno por torre` : `Recibo de ${periodo(r.mes, r.anio).toLowerCase()}${sufijo} cargado`,
    linea: partes.join(' · '),
    /** Un renglón por torre: «Block 1: creado (32 departamentos)». */
    torres: recibos.filter(x => x.torre).map(x => `${x.torre}: ${x.accion === 'creado' ? 'creado' : 'reemplazado'} (${plural(x.unidades_procesadas, 'departamento', 'departamentos')})`),
    advertencias: r.advertencias ?? [],
  };
}
