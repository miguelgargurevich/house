// Utilidades de las pruebas de conciliación: cuentas, pagos y extractos sintéticos (todo inventado).
import { cabecerasDeSesion, prisma, type Datos } from './app';

/** Un extracto CSV mínimo (coma) con las columnas que la lectura reconoce sola. `monto` negativo = cargo. */
export function csv(filas: { fecha: string; desc?: string; monto: string | number; op?: string }[]): Buffer {
  const lineas = ['Fecha,Descripción,Monto,Nro. Operación', ...filas.map((f) => `${f.fecha},"${f.desc ?? 'TRANSFERENCIA DEMO'}","${f.monto}",${f.op ?? ''}`)];
  return Buffer.from(lineas.join('\n'), 'utf8');
}

export interface RespuestaSubida { status: number; body: any; texto: string } // eslint-disable-line @typescript-eslint/no-explicit-any

/** Sube un extracto como lo hace la pantalla: multipart con `archivo` (y, si hay, `columnas` como JSON). */
export async function subirExtracto(base: string, token: string, cuentaId: number, bytes: Buffer, nombre = 'extracto.csv', columnas?: unknown): Promise<RespuestaSubida> {
  const fd = new FormData();
  fd.append('archivo', new Blob([new Uint8Array(bytes)]), nombre);
  if (columnas !== undefined) fd.append('columnas', JSON.stringify(columnas));
  const r = await fetch(`${base}/api/conciliacion/cuentas/${cuentaId}/extractos`, { method: 'POST', headers: cabecerasDeSesion(token), body: fd });
  const texto = await r.text();
  let body: unknown = null;
  try { body = JSON.parse(texto); } catch { /* sin JSON */ }
  return { status: r.status, body, texto };
}

/** Cuenta bancaria (medio de pago de tipo banco) de un condominio, con datos inventados. */
export const crearCuenta = (complejoId: number, extra: Record<string, unknown> = {}) =>
  prisma.medioPago.create({ data: { complejo_id: complejoId, tipo: 'banco', banco: 'BCP', numero_cuenta: '000-0000000-0-00', moneda: 'PEN', titular: 'Condominio Demo', ...extra } });

let n = 0;
export interface OpcionesPago {
  monto?: number | string;
  /** Día del pago (AAAA-MM-DD; se guarda a mediodía UTC). */
  fecha?: string;
  estado?: 'por_validar' | 'validado' | 'rechazado';
  referencia?: string | null;
  metodo?: string;
  estructuraId?: number | null;
  complejoId?: number;
  empresaId?: number;
  propietarioId?: number;
}

/** Un pago suelto (con su unidad, recibo y cargo propios). */
export async function crearPago(d: Datos, o: OpcionesPago = {}) {
  n += 1;
  const complejoId = o.complejoId ?? d.complejoA.id;
  const unidad = await prisma.unidad.create({ data: { codigo: `CN-${n}`, tipo: 'Departamento', complejo_id: complejoId, empresa_id: o.empresaId ?? d.empresaA.id, propietario_id: o.propietarioId ?? d.propietario1.id, estado: 'activa', estructura_id: o.estructuraId ?? null } });
  const recibo = await prisma.recibo.create({ data: { empresa_id: o.empresaId ?? d.empresaA.id, complejo_id: complejoId, mes: 10, anio: 2026, fecha_emision: new Date('2026-10-01T00:00:00Z'), fecha_vencimiento: new Date('2026-10-20T00:00:00Z'), estado: 'emitido' } });
  const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto: o.monto ?? 150, orden: 1 } });
  const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto: o.monto ?? 150, estado_pago: 'pendiente' } });
  return prisma.pago.create({
    data: {
      recibo_concepto_unidad_id: cargo.id,
      monto: o.monto ?? 150,
      fecha_pago: new Date(`${o.fecha ?? '2026-10-05'}T12:00:00Z`),
      metodo_pago: o.metodo ?? 'transferencia',
      referencia: o.referencia === undefined ? null : o.referencia,
      estado_validacion: o.estado ?? 'por_validar',
    },
  });
}

/** Un pago del mantenimiento completo: un `Pago` por concepto con el mismo `grupo`; el primero es el principal. Devuelve el principal. */
export async function crearPagoDeGrupo(d: Datos, montos: number[], o: Omit<OpcionesPago, 'monto'> = {}) {
  n += 1;
  const grupo = `grupo-prueba-${n}`;
  const complejoId = o.complejoId ?? d.complejoA.id;
  const unidad = await prisma.unidad.create({ data: { codigo: `CG-${n}`, tipo: 'Departamento', complejo_id: complejoId, empresa_id: o.empresaId ?? d.empresaA.id, propietario_id: o.propietarioId ?? d.propietario1.id, estado: 'activa', estructura_id: o.estructuraId ?? null } });
  const recibo = await prisma.recibo.create({ data: { empresa_id: o.empresaId ?? d.empresaA.id, complejo_id: complejoId, mes: 10, anio: 2026, fecha_emision: new Date('2026-10-01T00:00:00Z'), fecha_vencimiento: new Date('2026-10-20T00:00:00Z'), estado: 'emitido' } });
  let principal = null as Awaited<ReturnType<typeof prisma.pago.create>> | null;
  for (const [i, monto] of montos.entries()) {
    const rc = await prisma.reciboConcepto.create({ data: { recibo_id: recibo.id, concepto_id: d.conceptoA.id, monto, orden: i + 1 } });
    const cargo = await prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id: rc.id, unidad_id: unidad.id, monto, estado_pago: 'pendiente' } });
    const p = await prisma.pago.create({
      data: { recibo_concepto_unidad_id: cargo.id, monto, fecha_pago: new Date(`${o.fecha ?? '2026-10-05'}T12:00:00Z`), metodo_pago: o.metodo ?? 'transferencia', referencia: o.referencia === undefined ? null : o.referencia, estado_validacion: o.estado ?? 'por_validar', grupo, grupo_principal: i === 0 },
    });
    if (i === 0) principal = p;
  }
  return principal!;
}
