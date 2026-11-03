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

/** Lo que el Excel creó con `crear_faltantes=true`: blocks (nuevos o con departamentos nuevos), pisos, departamentos y propietarios. */
export interface CreadoDeExcel {
  blocks: { nombre: string; nuevo: boolean; pisos: number; unidades: string[]; propietarios: number }[];
  totales: { blocks: number; pisos: number; unidades: number; propietarios: number };
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
  /** Mora por pago fuera de fecha del mes anterior que se agregó a este recibo; `mensaje` es null si a nadie. */
  mora?: { monto: string; cantidad: number; mensaje: string | null };
  /** Sólo si se crearon blocks o departamentos que faltaban. */
  creado?: CreadoDeExcel;
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

/** «Se crearon 1 block (Block 2), 8 pisos, 32 departamentos y 32 propietarios (sin correo ni acceso).» */
export function textoCreado(c: CreadoDeExcel): string {
  const nuevos = c.blocks.filter(b => b.nuevo).map(b => b.nombre);
  const partes: string[] = [];
  if (nuevos.length) partes.push(`${plural(nuevos.length, 'block', 'blocks')}${nuevos.length <= 4 ? ` (${nuevos.join(', ')})` : ''}`);
  if (c.totales.pisos > 0) partes.push(plural(c.totales.pisos, 'piso', 'pisos'));
  partes.push(plural(c.totales.unidades, 'departamento', 'departamentos'));
  if (c.totales.propietarios > 0) partes.push(`${plural(c.totales.propietarios, 'propietario', 'propietarios')} (sin correo ni acceso)`);
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : partes[0]!;
  return `Se crearon ${lista}.`;
}

export function resumenSubida(r: ResultadoExcel) {
  const partes = [plural(r.unidades_procesadas, 'departamento cargado', 'departamentos cargados')];
  if (r.filas_saltadas > 0) partes.push(plural(r.filas_saltadas, 'fila saltada', 'filas saltadas'));
  const recibos = r.recibos ?? [];
  const sufijo = recibos.length === 1 && recibos[0]!.torre ? ` · ${recibos[0]!.torre}` : '';
  return {
    titulo: recibos.length > 1 ? `Recibos de ${periodo(r.mes, r.anio).toLowerCase()} cargados: uno por block` : `Recibo de ${periodo(r.mes, r.anio).toLowerCase()}${sufijo} cargado`,
    linea: partes.join(' · '),
    /** Un renglón por torre: «Block 1: creado (32 departamentos)». */
    torres: recibos.filter(x => x.torre).map(x => `${x.torre}: ${x.accion === 'creado' ? 'creado' : 'reemplazado'} (${plural(x.unidades_procesadas, 'departamento', 'departamentos')})`),
    advertencias: r.advertencias ?? [],
    /** «Se agregó mora de S/ 20 a 3 departamentos: B01-101, …»; null si no se agregó mora. */
    mora: r.mora?.mensaje ?? null,
    /** Lo que se creó porque faltaba en el condominio; null si no hizo falta crear nada. */
    creado: r.creado ? textoCreado(r.creado) : null,
  };
}
