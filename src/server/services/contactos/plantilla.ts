/**
 * Plantilla de contactos (`GET /api/contactos/plantilla.xlsx`): una fila por unidad activa del condominio, ordenada por block y departamento, ya llena con lo que
 * Torre tiene. Los correos de relleno (`…@sin-correo.invalid`) salen VACÍOS: nunca se le muestra al administrador (ni se vuelve a subir) un correo que no existe.
 */
import XLSX from 'xlsx';
import { prisma } from '../../db';
import { numeroDeTorre, normalizarTexto } from '../../lib/excelRecibos';
import { correoSinBuzon } from '../invitaciones';

export const ENCABEZADOS = ['Block', 'Dpto', 'Propietario', 'Correo propietario', 'Celular propietario', 'Inquilino', 'Correo inquilino', 'Celular inquilino'] as const;

/** «B01-101» → «101»: el último tramo del código (es lo que `codigoEncajaConDpto` compara al subir). */
export const dptoDeCodigo = (codigo: string | null): string => normalizarTexto(codigo).split(/[^A-Za-z0-9]+/).filter(Boolean).pop() ?? '';

/** El correo real o vacío: el de relleno no sale. */
const correoVisible = (email: string | null | undefined): string => (email && !correoSinBuzon(email) ? email : '');

const INSTRUCCIONES = [
  'Cómo cargar los contactos de los vecinos',
  '',
  '1. Llena, en la hoja «Contactos», el correo y el celular de cada propietario. Si el departamento tiene inquilino, escribe también su nombre, correo y celular.',
  '2. No cambies las columnas Block y Dpto: con ellas Torre reconoce cada departamento. Puedes borrar las filas que no vas a llenar.',
  '3. Los nombres sirven para comprobar que el correo es de la persona correcta: si el nombre del Excel no se parece al registrado en Torre, esa fila no se carga y se te avisa. Los nombres no se cambian desde aquí.',
  '4. Celular: 9 dígitos (987 654 321) o con el código de país (+56 9 6123 4567). Correo: uno por persona. Una misma persona con varios departamentos usa el mismo correo en cada uno.',
  '5. Súbelo en Residentes › Subir contactos. Torre te muestra primero un resumen y los problemas fila por fila, sin guardar nada. Recién con «Guardar contactos» se guarda.',
  '6. Las invitaciones por correo no salen todas de golpe: quedan en cola y salen en tandas diarias para que ningún correo rebote.',
  '',
  'Lo que NO hace esta carga: no cambia propietarios ni nombres, no borra a nadie, no toca recibos ni pagos, y nunca vincula una cuenta de otra empresa o de personal.',
];

/** Sólo lo que la plantilla necesita de cada unidad (los datos de contacto salen tal cual los tiene Torre). */
interface UnidadFila {
  codigo: string;
  estructura: { nombre: string | null } | null;
  propietario: { nombre: string; email: string; telefono: string | null } | null;
  inquilino: { nombre: string; email: string; telefono: string | null } | null;
}

/** Orden de la plantilla: por número de block (los que no tienen número, al final por nombre), luego por departamento (numérico primero) y código. */
export function ordenarUnidades<T extends { codigo: string; estructura: { nombre: string | null } | null }>(unidades: T[]): T[] {
  const clave = (u: T) => {
    const bloque = u.estructura?.nombre ?? '';
    const n = numeroDeTorre(bloque);
    const d = dptoDeCodigo(u.codigo);
    return { n: n ?? Number.MAX_SAFE_INTEGER, bloque, num: /^\d+$/.test(d) ? Number(d) : Number.MAX_SAFE_INTEGER, d };
  };
  return [...unidades].sort((a, b) => {
    const x = clave(a), y = clave(b);
    return x.n - y.n || x.bloque.localeCompare(y.bloque, 'es', { numeric: true }) || x.num - y.num || x.d.localeCompare(y.d, 'es', { numeric: true }) || a.codigo.localeCompare(b.codigo, 'es', { numeric: true });
  });
}

/** El libro: hoja «Contactos» (datos) y hoja «Instrucciones». */
export function libroDeContactos(unidades: UnidadFila[]): Buffer {
  const filas: string[][] = [[...ENCABEZADOS]];
  for (const u of ordenarUnidades(unidades)) {
    filas.push([
      u.estructura?.nombre ?? '',
      dptoDeCodigo(u.codigo),
      u.propietario?.nombre ?? '',
      correoVisible(u.propietario?.email),
      u.propietario?.telefono ?? '',
      u.inquilino?.nombre ?? '',
      correoVisible(u.inquilino?.email),
      u.inquilino?.telefono ?? '',
    ]);
  }
  const hoja = XLSX.utils.aoa_to_sheet(filas);
  hoja['!cols'] = [{ wch: 10 }, { wch: 8 }, { wch: 34 }, { wch: 32 }, { wch: 20 }, { wch: 34 }, { wch: 32 }, { wch: 20 }];
  hoja['!freeze'] = { xSplit: 0, ySplit: 1 } as never;
  const ayuda = XLSX.utils.aoa_to_sheet(INSTRUCCIONES.map((t) => [t]));
  ayuda['!cols'] = [{ wch: 130 }];
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, 'Contactos');
  XLSX.utils.book_append_sheet(libro, ayuda, 'Instrucciones');
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Las unidades ACTIVAS del condominio con su propietario e inquilino, listas para `libroDeContactos`. */
export async function unidadesParaPlantilla(complejoId: number): Promise<UnidadFila[]> {
  return prisma.unidad.findMany({
    where: { complejo_id: complejoId, estado: 'activa' },
    select: {
      codigo: true,
      estructura: { select: { nombre: true } },
      propietario: { select: { nombre: true, email: true, telefono: true } },
      inquilino: { select: { nombre: true, email: true, telefono: true } },
    },
  });
}

/** Nombre del archivo: sin tildes ni signos («contactos-condominio-los-libertadores.xlsx»). */
export function nombreArchivoPlantilla(condominio: string): string {
  const base = condominio.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `contactos-${base || 'condominio'}.xlsx`;
}
