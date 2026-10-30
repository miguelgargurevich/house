/**
 * Pago del mantenimiento de un departamento (todos los cargos de un recibo + unidad con UN pago y UN comprobante).
 *
 * Modelo: el pago se reparte en un `Pago` por cargo con saldo (monto = saldo del cargo, calculado aquí), todos con el mismo
 * `Pago.grupo`. El primero es el `grupo_principal`: lleva el comprobante y la evaluación de la IA (que compara contra el
 * TOTAL del grupo). Validar o rechazar cualquiera actúa sobre el grupo entero (`validacionPago.cerrarPago`).
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { MONEDA_POR_DEFECTO, ZONA_POR_DEFECTO } from '../../lib/paises';
import { conflict, notFound } from '../errors';
import { selectComprobante } from '../lib/cargos';
import { hoyEn } from '../lib/fechas';
import { conTesoreroRegistrado, formatearConformidad } from '../lib/conformidad';
import { conVistaResidente, selectEvaluacion } from '../lib/evaluacionVista';
import { cuentaCargo, deudaAcumulada, estadoMantenimiento, numeroMantenimiento, repartirSaldos, sumarCuentas, tituloMantenimiento, type CuentaMantenimiento, type EstadoMantenimiento } from '../lib/mantenimientos';
import { medioDeUnidades } from '../routes/mediosPago';
import { aguaDeMantenimiento, type AguaDeMantenimiento } from './agua';
import { versionImagen } from './imagenes';
import { correoEfectivo, selectCorreoBlock } from './juntas';
import { camposDePago } from './mediosPago';
import { esConceptoMora } from './mora';

export interface DatosPago {
  metodo_pago: string;
  referencia?: string | null;
  observaciones?: string | null;
  fecha_pago?: Date;
}

/** Archivo de comprobante ya verificado (tipo, bytes y tamaño): se guarda en la MISMA transacción que el pago. */
export interface ComprobanteAdjunto {
  nombre: string;
  tipo_mime: string;
  tamano: number;
  sha256: string;
  datos: Buffer;
  subidoPorId: number;
}

export interface ResultadoPago {
  grupo: string;
  /** Id del pago principal: a él se sube el comprobante (`POST /api/pagos/:id/comprobante`). */
  pago_id: number;
  total: string;
  cargos: number;
}

/** Estados que un cargo ya no admite como «abierto» (para el cierre atómico). */
const cerrados = ['pagado', 'en_revision'];

/**
 * Paga el saldo completo del mantenimiento (recibo + unidad). `por_validar` (residente: espera la junta/admin) o `validado` (lo registra
 * la administración: queda pagado de inmediato). Si la administración adjunta un `comprobante`, el pago nace `por_validar` como el del
 * residente (los cargos quedan en revisión) y el archivo se guarda en el pago principal dentro de la misma transacción: o queda todo
 * o no queda nada. 404 si el mantenimiento no existe; 409 si no queda nada por pagar o alguien lo tomó antes.
 */
export async function pagarMantenimiento(o: { reciboId: number; unidadId: number; usuarioId: number | null; modo: 'residente' | 'administracion'; validadorId?: number; comprobante?: ComprobanteAdjunto } & DatosPago): Promise<ResultadoPago> {
  const porValidar = o.modo === 'residente' || o.comprobante != null;
  return prisma.$transaction(async (tx) => {
    const cargos = await tx.reciboConceptoUnidad.findMany({
      where: { unidad_id: o.unidadId, reciboConcepto: { recibo_id: o.reciboId } },
      select: { id: true, monto: true, estado_pago: true, reciboConcepto: { select: { orden: true } } },
      orderBy: [{ reciboConcepto: { orden: 'asc' } }, { id: 'asc' }],
    });
    if (cargos.length === 0) throw notFound('Mantenimiento');
    const sumas = await tx.pago.groupBy({ by: ['recibo_concepto_unidad_id', 'estado_validacion'], where: { recibo_concepto_unidad_id: { in: cargos.map((c) => c.id) } }, _sum: { monto: true } });
    const suma = (id: number, estado: string) => sumas.find((s) => s.recibo_concepto_unidad_id === id && s.estado_validacion === estado)?._sum.monto ?? 0;
    const reparto = repartirSaldos(cargos.map((c) => ({ id: c.id, monto: c.monto, estado_pago: c.estado_pago, validado: suma(c.id, 'validado'), por_validar: suma(c.id, 'por_validar') })));
    if (reparto.length === 0) {
      const enRevision = cargos.some((c) => c.estado_pago === 'en_revision');
      throw conflict(enRevision ? 'Este mantenimiento ya tiene un pago en revisión' : 'Este mantenimiento ya fue pagado');
    }
    // Cierre atómico: sólo uno de dos pagos simultáneos logra pasar los cargos de abiertos a su nuevo estado.
    const ids = reparto.map((r) => r.cargoId);
    const cerrado = await tx.reciboConceptoUnidad.updateMany({
      where: { id: { in: ids }, OR: [{ estado_pago: null }, { estado_pago: { notIn: cerrados } }] },
      data: porValidar ? { estado_pago: 'en_revision', fecha_pago: null } : { estado_pago: 'pagado', fecha_pago: o.fecha_pago ?? new Date() },
    });
    if (cerrado.count !== ids.length) throw conflict('Este mantenimiento cambió mientras lo pagabas: recarga e inténtalo de nuevo');

    const grupo = randomUUID();
    const validado = !porValidar;
    let principal = 0;
    let total = new Prisma.Decimal(0);
    for (const [i, r] of reparto.entries()) {
      const p = await tx.pago.create({
        data: {
          recibo_concepto_unidad_id: r.cargoId,
          monto: r.monto,
          usuario_id: o.usuarioId,
          metodo_pago: o.metodo_pago,
          referencia: o.referencia ?? null,
          observaciones: o.observaciones ?? null,
          ...(o.fecha_pago ? { fecha_pago: o.fecha_pago } : {}),
          estado_validacion: validado ? 'validado' : 'por_validar',
          ...(validado ? { validado_por_id: o.validadorId ?? null, validado_at: new Date() } : {}),
          grupo,
          grupo_principal: i === 0,
        },
        select: { id: true },
      });
      if (i === 0) {
        principal = p.id;
        if (o.comprobante) {
          const { subidoPorId, ...archivo } = o.comprobante;
          await tx.archivoComprobante.create({ data: { pago_id: p.id, ...archivo, subido_por_id: subidoPorId }, select: { id: true } });
        }
      }
      total = total.plus(r.monto);
    }
    return { grupo, pago_id: principal, total: total.toFixed(2), cargos: reparto.length };
  });
}

// ---------- Detalle ----------
const includeDetalle = {
  cargos: {
    include: {
      reciboConcepto: { select: { orden: true, es_recargo: true, concepto: { select: { id: true, nombre: true } } } },
      pagos: { orderBy: [{ fecha_pago: 'desc' }, { id: 'asc' }] as Prisma.PagoOrderByWithRelationInput[], include: { comprobante: { select: selectComprobante }, evaluacion: { select: selectEvaluacion }, validado_por: { select: { id: true, nombre: true } }, conformidad_por: { select: { id: true, nombre: true } }, usuario: { select: { id: true, nombre: true } } } },
    },
  },
} as const;

export interface DetalleMantenimiento {
  recibo_id: number;
  unidad_id: number;
  numero: string;
  titulo: string;
  mes: number;
  anio: number;
  fecha_emision: Date;
  fecha_vencimiento: Date;
  estado: EstadoMantenimiento;
  /** Moneda del condominio (ISO 4217): todos los montos del mantenimiento van en ella. */
  moneda: string;
  total: string;
  cobrado: string;
  en_revision: string;
  saldo: string;
  /** Fecha de corte del agua (la fija la administración o la junta); `null` si no hay. */
  fecha_corte_agua: Date | null;
  /** Lo que el departamento debe de periodos ANTERIORES (nunca negativo: no hay saldo a favor). Se calcula al mostrar. */
  deuda_acumulada: string;
  /** Total del mantenimiento + deuda acumulada: lo que el impreso llama «TOTAL». */
  total_general: string;
  /** Detalle del consumo de agua (lecturas, m³, factor, monto y foto del contómetro); `null` si no se cargó la lectura. */
  agua: AguaDeMantenimiento | null;
  /** Correo al que se envían los vouchers: el de la junta vigente del block o, si no tiene, el `correo_vouchers` del block. */
  correo_vouchers: string | null;
  /** Nombre del concepto de mora/multa del recibo cuando este departamento no tiene ese cargo (se imprime en 0.00); `null` si no aplica. */
  linea_mora: string | null;
  condominio: { id: number; nombre: string; moneda: string; direccion: string | null; notas_pago: string | null; admin_nombre: string | null; admin_celular: string | null; admin_correo: string | null; cabecera_url: string | null } | null;
  empresa: { id: number; nombre: string; ruc: string | null; direccion: string | null; telefono: string | null; email: string | null; logo_url: string | null } | null;
  unidad: { id: number; codigo: string; estructura: { id: number; nombre: string | null } | null };
  propietario: { id: number; nombre: string } | null;
  inquilino: { id: number; nombre: string } | null;
  conceptos: { cargo_id: number; concepto: string; es_recargo: boolean; monto: string; cobrado: string; en_revision: string; saldo: string; motivo: string | null }[];
  pagos: PagoDeMantenimiento[];
  medios_pago: unknown[];
}

export interface PagoDeMantenimiento {
  /** Pago principal del grupo (o el pago suelto): con este id se ve el comprobante y se valida. */
  id: number;
  grupo: string | null;
  /** `true` = pago antiguo de un solo concepto (sin grupo). */
  suelto: boolean;
  monto: string;
  conceptos: string[];
  metodo_pago: string | null;
  referencia: string | null;
  fecha_pago: Date;
  /** De dónde salió `fecha_pago`: declarada | voucher | no_leida | invalida | manual (ver `services/fechaVoucher.ts`). */
  fecha_origen: string;
  estado_validacion: string;
  motivo_rechazo: string | null;
  validado_por_ia: boolean;
  registrado_por: { id: number; nombre: string } | null;
  comprobante: unknown;
  evaluacion: unknown;
  /** Sólo en la vista de la administración: la conformidad del tesorero y si el block tiene tesorero (`lib/conformidad.ts`). */
  conformidad?: { at: Date; por: { nombre: string } } | null;
  tesorero_registrado?: boolean;
}

/**
 * Detalle completo del mantenimiento (conceptos, pagos agrupados, medios de pago). El alcance lo verifica quien llama con `unidadWhere`
 * (las unidades propias del residente o `scopeUnidades` + recibo de la empresa del admin); si no coincide → 404.
 */
export async function detalleMantenimiento(reciboId: number, unidadId: number, o: { reciboWhere?: Prisma.ReciboWhereInput; unidadWhere?: Prisma.UnidadWhereInput; vista: 'residente' | 'completa' }): Promise<DetalleMantenimiento> {
  const [recibo, unidad] = await Promise.all([
    prisma.recibo.findFirst({
      where: { AND: [{ id: reciboId }, o.reciboWhere ?? {}] },
      include: {
        complejo: { select: { id: true, nombre: true, moneda: true, zona_horaria: true, direccion: true, notas_pago: true, admin_nombre: true, admin_celular: true, admin_correo: true, imagenRecibo: { select: { updated_at: true } } } },
        empresa: { select: { id: true, nombre: true, ruc: true, direccion: true, telefono: true, email: true, imagenRecibo: { select: { updated_at: true } } } },
      },
    }),
    prisma.unidad.findFirst({ where: { AND: [{ id: unidadId }, o.unidadWhere ?? {}] }, include: { estructura: { select: { id: true, nombre: true, ...selectCorreoBlock } }, propietario: { select: { id: true, nombre: true } }, inquilino: { select: { id: true, nombre: true } } } }),
  ]);
  if (!recibo || !unidad) throw notFound('Mantenimiento');
  const conceptosDb = await prisma.reciboConcepto.findMany({ where: { recibo_id: reciboId }, select: { id: true, concepto: { select: { nombre: true } } } });
  if (conceptosDb.length === 0) throw notFound('Mantenimiento');
  const cargos = await prisma.reciboConceptoUnidad.findMany({
    where: { unidad_id: unidadId, recibo_concepto_id: { in: conceptosDb.map((c) => c.id) } },
    include: includeDetalle.cargos.include,
  });
  if (cargos.length === 0) throw notFound('Mantenimiento');
  cargos.sort((a, b) => (a.reciboConcepto?.orden ?? 0) - (b.reciboConcepto?.orden ?? 0) || a.id - b.id);

  const sumaPagos = (c: (typeof cargos)[number], estado: string) => c.pagos.filter((p) => p.estado_validacion === estado).reduce((a, p) => a.plus(p.monto), new Prisma.Decimal(0));
  const cuentas = cargos.map((c) => ({ monto: c.monto, estado_pago: c.estado_pago, validado: sumaPagos(c, 'validado'), por_validar: sumaPagos(c, 'por_validar') }));
  const resumen: CuentaMantenimiento = sumarCuentas(cuentas);

  // Pagos: uno por grupo (el principal lleva el comprobante); los pagos sueltos antiguos se muestran tal cual.
  const porGrupo = new Map<string, { principal?: (typeof cargos)[number]['pagos'][number]; monto: Prisma.Decimal; conceptos: string[]; alguno: (typeof cargos)[number]['pagos'][number] }>();
  const pagos: PagoDeMantenimiento[] = [];
  const tesorero = o.vista === 'completa' ? (await conTesoreroRegistrado([{ unidad: { complejo: unidad.complejo_id != null ? { id: unidad.complejo_id } : null, estructura: unidad.estructura } }]))[0]!.tesorero_registrado : false;
  const dePago = (p: (typeof cargos)[number]['pagos'][number], monto: Prisma.Decimal, conceptos: string[], suelto: boolean): PagoDeMantenimiento => {
    const base = { ...p, evaluacion: p.evaluacion };
    const vista = o.vista === 'completa' ? base : conVistaResidente(base);
    return {
      id: p.id, grupo: p.grupo, suelto, monto: monto.toFixed(2), conceptos, metodo_pago: p.metodo_pago, referencia: p.referencia, fecha_pago: p.fecha_pago, fecha_origen: p.fecha_origen,
      estado_validacion: p.estado_validacion, motivo_rechazo: p.motivo_rechazo, validado_por_ia: p.validado_por_ia,
      registrado_por: p.usuario ?? null, comprobante: p.comprobante, evaluacion: vista.evaluacion,
      ...(o.vista === 'completa' ? { conformidad: formatearConformidad(p), tesorero_registrado: tesorero } : {}),
    };
  };
  for (const c of cargos) {
    const nombre = c.reciboConcepto?.concepto?.nombre ?? 'Concepto';
    for (const p of c.pagos) {
      if (p.grupo == null) {
        pagos.push(dePago(p, p.monto, [nombre], true));
        continue;
      }
      const g = porGrupo.get(p.grupo) ?? { monto: new Prisma.Decimal(0), conceptos: [], alguno: p };
      g.monto = g.monto.plus(p.monto);
      g.conceptos.push(nombre);
      if (p.grupo_principal) g.principal = p;
      porGrupo.set(p.grupo, g);
    }
  }
  for (const g of porGrupo.values()) pagos.push(dePago(g.principal ?? g.alguno, g.monto, g.conceptos, false));
  pagos.sort((a, b) => b.fecha_pago.getTime() - a.fecha_pago.getTime() || b.id - a.id);

  // Los cargos en 0.00 no existen (no son deuda): si el recibo tiene concepto de mora y este departamento no tiene ese cargo, se imprime igual en 0.00.
  const conceptoMora = conceptosDb.find((c) => esConceptoMora(c.concepto?.nombre));
  const tieneMora = conceptoMora != null && cargos.some((c) => c.recibo_concepto_id === conceptoMora.id);
  const deuda = await deudaAcumulada(unidadId, recibo.anio, recibo.mes);
  const fotoBase = o.vista === 'residente' ? `/api/me/mantenimientos/${reciboId}/${unidadId}/agua` : `/api/recibos/${reciboId}/agua/${unidadId}`;
  const agua = await aguaDeMantenimiento(reciboId, unidadId, fotoBase);
  const { imagenRecibo: cabecera, ...complejo } = recibo.complejo ?? ({} as NonNullable<typeof recibo.complejo>);
  const { imagenRecibo: logo, ...empresa } = recibo.empresa ?? ({} as NonNullable<typeof recibo.empresa>);

  const medios = unidad.complejo_id != null
    ? await prisma.medioPago.findMany({ where: { activo: true, ...medioDeUnidades([unidad]) }, orderBy: [{ orden: 'asc' }, { id: 'asc' }], omit: { qr_datos: true, creado_por_id: true, documento_titular: true } })
    : [];
  medios.sort((a, b) => Number(b.estructura_id != null) - Number(a.estructura_id != null));

  return {
    recibo_id: recibo.id,
    unidad_id: unidad.id,
    numero: numeroMantenimiento(recibo.anio, recibo.mes, unidad.codigo),
    titulo: tituloMantenimiento(recibo.anio, recibo.mes, unidad.codigo),
    mes: recibo.mes,
    anio: recibo.anio,
    fecha_emision: recibo.fecha_emision,
    fecha_vencimiento: recibo.fecha_vencimiento,
    estado: estadoMantenimiento(resumen, recibo.fecha_vencimiento, hoyEn(recibo.complejo?.zona_horaria ?? ZONA_POR_DEFECTO)), // el día de hoy en el condominio
    moneda: recibo.complejo?.moneda ?? MONEDA_POR_DEFECTO,
    ...resumen,
    fecha_corte_agua: recibo.fecha_corte_agua,
    deuda_acumulada: deuda,
    total_general: new Prisma.Decimal(resumen.total).plus(deuda).toFixed(2),
    agua,
    correo_vouchers: correoEfectivo(unidad.estructura),
    linea_mora: conceptoMora && !tieneMora ? (conceptoMora.concepto?.nombre ?? 'Mora') : null,
    condominio: recibo.complejo ? { ...complejo, cabecera_url: cabecera ? `/api/complejos/${recibo.complejo.id}/cabecera?v=${versionImagen(cabecera.updated_at)}` : null } : null,
    empresa: recibo.empresa ? { ...empresa, logo_url: logo ? `/api/empresas/${recibo.empresa.id}/logo?v=${versionImagen(logo.updated_at)}` : null } : null,
    unidad: { id: unidad.id, codigo: unidad.codigo, estructura: unidad.estructura ? { id: unidad.estructura.id, nombre: unidad.estructura.nombre } : null },
    propietario: unidad.propietario,
    inquilino: unidad.inquilino,
    conceptos: cargos.map((c, i) => {
      const x = cuentaCargo(cuentas[i]);
      return { cargo_id: c.id, concepto: c.reciboConcepto?.concepto?.nombre ?? 'Concepto', es_recargo: c.reciboConcepto?.es_recargo ?? false, monto: x.total.toFixed(2), cobrado: x.cobrado.toFixed(2), en_revision: x.en_revision.toFixed(2), saldo: x.saldo.toFixed(2), motivo: c.observaciones ?? null };
    }),
    pagos,
    medios_pago: medios.map((m) => ({
      id: m.id, tipo: m.tipo, ambito: m.estructura_id != null ? 'block' : 'condominio', banco: m.banco, tipo_cuenta: m.tipo_cuenta,
      numero_cuenta: m.numero_cuenta, cci: m.cci, titular: m.titular, celular: m.celular, tiene_qr: m.qr_tipo_mime != null,
      ...camposDePago(m, unidad.codigo), // moneda, nombre real de la entidad e instrucción de recaudación con el código de ESTA unidad
    })),
  };
}

// ---------- Pagos agrupados en listas ----------
/** A cada pago con `grupo` le agrega `mantenimiento` (total del grupo, cuántos conceptos, periodo y unidad). Los sueltos quedan igual. */
export async function conResumenDeGrupo<T extends { id: number; grupo: string | null; unidad?: { id: number; codigo: string; estructura?: { id: number; nombre: string | null } | null } | null; recibo?: { id: number; mes: number; anio: number } | null }>(items: T[]) {
  const grupos = [...new Set(items.map((p) => p.grupo).filter((g): g is string => g != null))];
  const sumas = grupos.length ? await prisma.pago.groupBy({ by: ['grupo'], where: { grupo: { in: grupos } }, _sum: { monto: true }, _count: { _all: true } }) : [];
  const porGrupo = new Map(sumas.map((s) => [s.grupo, s]));
  return items.map((p) => {
    const g = p.grupo != null ? porGrupo.get(p.grupo) : undefined;
    if (!g || !p.unidad || !p.recibo) return { ...p, mantenimiento: null };
    return {
      ...p,
      mantenimiento: {
        grupo: p.grupo,
        titulo: tituloMantenimiento(p.recibo.anio, p.recibo.mes, p.unidad.codigo),
        numero: numeroMantenimiento(p.recibo.anio, p.recibo.mes, p.unidad.codigo),
        recibo_id: p.recibo.id,
        unidad_id: p.unidad.id,
        torre: p.unidad.estructura?.nombre ?? null,
        total: new Prisma.Decimal(g._sum.monto ?? 0).toFixed(2),
        conceptos: g._count._all,
      },
    };
  });
}

/** Sólo el pago principal de cada grupo (o los sueltos): una fila por pago del mantenimiento. */
export const soloPrincipales: Prisma.PagoWhereInput = { OR: [{ grupo: null }, { grupo_principal: true }] };
