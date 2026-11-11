// Auditoría de coherencia de la demo sembrada: devuelve la lista de problemas (vacía = todo en orden). La corre el seed al terminar y las pruebas.
import { prisma } from '../../db';
import { hoyLima } from '../../lib/fechas';
import { CUENTAS_DEMO, ROLES_DEMO } from './cuentas';

const num = (x: bigint | number) => Number(x);

export async function auditarCoherencia(ahora: Date = new Date()): Promise<string[]> {
  const problemas: string[] = [];
  const cuenta = async (descripcion: string, consulta: Promise<{ n: bigint }[]>, esperado = 0) => {
    const [fila] = await consulta;
    const n = num(fila?.n ?? 0);
    if (n !== esperado) problemas.push(`${descripcion}: ${n} (esperado ${esperado})`);
  };

  // Cobranza: un cargo está «pagado» si y sólo si los pagos validados lo cubren.
  await cuenta('cargos pagados sin pagos validados que los cubran', prisma.$queryRaw`SELECT count(*) AS n FROM "ReciboConceptoUnidad" c WHERE c.estado_pago = 'pagado' AND c.monto > COALESCE((SELECT sum(p.monto) FROM "Pago" p WHERE p.recibo_concepto_unidad_id = c.id AND p.estado_validacion = 'validado'), 0)`);
  await cuenta('cargos cubiertos por pagos validados pero no marcados pagados', prisma.$queryRaw`SELECT count(*) AS n FROM "ReciboConceptoUnidad" c WHERE c.estado_pago <> 'pagado' AND c.monto > 0 AND c.monto <= COALESCE((SELECT sum(p.monto) FROM "Pago" p WHERE p.recibo_concepto_unidad_id = c.id AND p.estado_validacion = 'validado'), 0)`);
  await cuenta('cargos pagados de más', prisma.$queryRaw`SELECT count(*) AS n FROM "ReciboConceptoUnidad" c WHERE c.monto < COALESCE((SELECT sum(p.monto) FROM "Pago" p WHERE p.recibo_concepto_unidad_id = c.id AND p.estado_validacion = 'validado'), 0)`);
  await cuenta('recibos sin cargos', prisma.$queryRaw`SELECT count(*) AS n FROM "Recibo" r WHERE NOT EXISTS (SELECT 1 FROM "ReciboConcepto" rc JOIN "ReciboConceptoUnidad" c ON c.recibo_concepto_id = rc.id WHERE rc.recibo_id = r.id)`);

  // Personas y unidades.
  await cuenta('unidades sin propietario', prisma.$queryRaw`SELECT count(*) AS n FROM "Unidad" WHERE propietario_id IS NULL`);
  await cuenta('unidades de otra empresa que su condominio', prisma.$queryRaw`SELECT count(*) AS n FROM "Unidad" u JOIN "ComplejoHabitacional" c ON c.id = u.complejo_id WHERE u.empresa_id IS DISTINCT FROM c.empresa_id`);
  await cuenta('residentes sin departamento', prisma.$queryRaw`SELECT count(*) AS n FROM "Usuario" u WHERE u.rol IN ('propietario','inquilino') AND NOT EXISTS (SELECT 1 FROM "Unidad" x WHERE x.propietario_id = u.id OR x.inquilino_id = u.id)`);

  // Juntas: presidente, tesorero y secretario, todos propietarios de una unidad de su alcance.
  await cuenta('juntas sin presidente, tesorero y secretario', prisma.$queryRaw`SELECT count(*) AS n FROM "JuntaDirectiva" j WHERE (SELECT count(DISTINCT cargo) FROM "MiembroJunta" m WHERE m.junta_id = j.id AND m.cargo IN ('presidente','tesorero','secretario')) <> 3`);
  await cuenta('miembros de junta que no son propietarios de su alcance', prisma.$queryRaw`SELECT count(*) AS n FROM "MiembroJunta" m JOIN "JuntaDirectiva" j ON j.id = m.junta_id WHERE NOT EXISTS (SELECT 1 FROM "Unidad" u WHERE u.propietario_id = m.usuario_id AND u.complejo_id = j.complejo_id AND (j.estructura_id IS NULL OR u.estructura_id = j.estructura_id))`);

  // Nada real: correos `.example`, celulares 900…, sin avisos pendientes ni sesiones.
  await cuenta('usuarios con correo que no es de ejemplo', prisma.$queryRaw`SELECT count(*) AS n FROM "Usuario" WHERE email NOT LIKE '%.example' AND email NOT LIKE '%@prueba.house' AND rol <> 'superadmin'`);
  await cuenta('usuarios con celular que no es de ejemplo (900…)', prisma.$queryRaw`SELECT count(*) AS n FROM "Usuario" WHERE telefono IS NOT NULL AND telefono !~ '^900[0-9]{6}$' AND rol <> 'superadmin'`);
  await cuenta('proveedores con celular que no es de ejemplo', prisma.$queryRaw`SELECT count(*) AS n FROM "Proveedor" WHERE telefono IS NOT NULL AND telefono !~ '^900[0-9]{6}$'`);
  await cuenta('avisos sin enviar o sesiones sobrantes', prisma.$queryRaw`SELECT ((SELECT count(*) FROM "Notificacion") + (SELECT count(*) FROM "Sesion")) AS n`);
  await cuenta('lecturas de IA que no son de ejemplo', prisma.$queryRaw`SELECT count(*) AS n FROM "EvaluacionComprobante" WHERE proveedor IS DISTINCT FROM 'demo'`);

  // Las cuentas de entrada por rol.
  for (const rol of ROLES_DEMO) {
    const u = await prisma.usuario.findUnique({ where: { email: CUENTAS_DEMO[rol].email }, select: { rol: true, cargo_junta: true, estructura_id: true } });
    if (!u) problemas.push(`falta la cuenta de demo «${rol}»`);
    else if (rol === 'tesorero_block' && (u.cargo_junta !== 'tesorero' || u.estructura_id == null)) problemas.push('el tesorero de block no es tesorero de un block');
    else if (rol === 'presidente_central' && (u.cargo_junta !== 'presidente' || u.estructura_id != null)) problemas.push('el presidente central no es presidente de la junta central');
  }

  // El mes en curso: un recibo por block con cargos por vencer, y meses anteriores con cargos vencidos; de todo un poco en los pagos.
  const hoy = hoyLima(ahora);
  await cuenta('recibos del mes en curso (6 blocks + 1 torre)', prisma.$queryRaw`SELECT count(*) AS n FROM "Recibo" WHERE mes = ${hoy.getUTCMonth() + 1} AND anio = ${hoy.getUTCFullYear()}`, 7);
  const [fila] = await prisma.$queryRaw<{ por_vencer: bigint; vencidos: bigint; por_validar: bigint; rechazados: bigint; validados: bigint }[]>`SELECT
    (SELECT count(*) FROM "ReciboConceptoUnidad" c JOIN "ReciboConcepto" rc ON rc.id = c.recibo_concepto_id JOIN "Recibo" r ON r.id = rc.recibo_id WHERE c.estado_pago = 'pendiente' AND r.fecha_vencimiento >= ${hoy}) AS por_vencer,
    (SELECT count(*) FROM "ReciboConceptoUnidad" c JOIN "ReciboConcepto" rc ON rc.id = c.recibo_concepto_id JOIN "Recibo" r ON r.id = rc.recibo_id WHERE c.estado_pago = 'pendiente' AND r.fecha_vencimiento < ${hoy}) AS vencidos,
    (SELECT count(*) FROM "Pago" WHERE estado_validacion = 'por_validar') AS por_validar,
    (SELECT count(*) FROM "Pago" WHERE estado_validacion = 'rechazado') AS rechazados,
    (SELECT count(*) FROM "Pago" WHERE estado_validacion = 'validado') AS validados`;
  for (const [k, v] of Object.entries(fila ?? {})) if (num(v as bigint) === 0) problemas.push(`la mezcla de pagos no tiene «${k}»`);
  return problemas;
}
