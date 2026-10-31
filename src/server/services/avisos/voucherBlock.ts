/**
 * Aviso del voucher a la junta del block: cuando un VECINO entrega su voucher (el pago del panel, «Adjuntar/Reemplazar comprobante» de un pago suyo
 * o los bots de WhatsApp/Telegram) se manda por correo, con el archivo adjunto, al correo de la junta vigente del block de su departamento (y, si la junta no tiene, al `correo_vouchers` del block).
 * Lo que registra la administración desde su panel no pasa por aquí. Sin correo del block, o sin RESEND_API_KEY/MAIL_FROM, no se envía nada (no es un error).
 *
 * Corre en segundo plano, con el pago ya guardado: nunca frena ni hace fallar la respuesta. Un reintento si Resend falla; el resultado
 * (enviado / omitido / fallo, sin el contenido ni el correo) queda en `Auditoria` con entidad `pago`.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { ZONA_POR_DEFECTO } from '../../../lib/paises';
import { horaEn } from '../../lib/fechas';
import { nombreMes } from '../../lib/periodo';
import { registrarAuditoria } from '../../middleware/audit';
import { correoEfectivo, selectCorreoBlock } from '../juntas';
import { enviarCorreo, type DepsAvisos, type ResultadoEnvio } from './canales';
import { ENLACE_APP, dineroTexto } from './plantillas';

export const ACCION_AVISO_VOUCHER = 'avisar_voucher_block';
type Resultado = 'enviado' | 'omitido' | 'fallo';

/** Inyectables: las pruebas ponen un `fetch` falso (nunca sale nada a la red real) y `esperaReintentoMs: 0`. `env` es el `process.env` vivo (variables que ya existían). */
export const voucherBlockDeps: DepsAvisos & { esperaReintentoMs: number } = {
  fetch: (...a) => fetch(...a),
  ahora: () => new Date(),
  env: process.env,
  esperaReintentoMs: 3000,
};

const METODOS: Record<string, string> = { transferencia: 'Transferencia', yape: 'Yape', plin: 'Plin', efectivo: 'Efectivo', tarjeta: 'Tarjeta' };

/** «28 de octubre de 2026, 14:32» en la hora de la zona del condominio. */
function fechaEnZona(f: Date, zona: string): string {
  const l = horaEn(zona, f);
  const hm = `${String(l.getUTCHours()).padStart(2, '0')}:${String(l.getUTCMinutes()).padStart(2, '0')}`;
  return `${l.getUTCDate()} de ${nombreMes(l.getUTCMonth() + 1)} de ${l.getUTCFullYear()}, ${hm}`;
}

const seleccion = {
  id: true, monto: true, fecha_pago: true, metodo_pago: true, referencia: true, grupo: true, grupo_principal: true,
  usuario: { select: { nombre: true } },
  comprobante: { select: { nombre: true, sha256: true, datos: true } },
  reciboConceptoUnidad: {
    select: {
      unidad: { select: { codigo: true, estructura: { select: { nombre: true, ...selectCorreoBlock } }, propietario: { select: { nombre: true } }, complejo: { select: { nombre: true, moneda: true, zona_horaria: true } } } },
      reciboConcepto: { select: { recibo: { select: { mes: true, anio: true } } } },
    },
  },
} satisfies Prisma.PagoSelect;

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function registrar(pagoId: number, resultado: Resultado, detalle: Record<string, Prisma.InputJsonValue | undefined>) {
  await registrarAuditoria({ accion: ACCION_AVISO_VOUCHER, entidad: 'pago', entidad_id: pagoId, detalle: { resultado, ...detalle } as Prisma.InputJsonValue });
}

/** Manda el voucher del pago (el principal de su grupo) al correo del block. Nunca lanza: lo que falle queda en la auditoría. */
export async function avisarVoucherAlBlock(pagoId: number, deps: typeof voucherBlockDeps = voucherBlockDeps): Promise<void> {
  try {
    let pago = await prisma.pago.findUnique({ where: { id: pagoId }, select: seleccion });
    // El comprobante de un mantenimiento vive en el pago principal de su grupo.
    if (pago?.grupo != null && !pago.grupo_principal) pago = (await prisma.pago.findFirst({ where: { grupo: pago.grupo, grupo_principal: true }, select: seleccion })) ?? pago;
    if (!pago) return;
    const unidad = pago.reciboConceptoUnidad?.unidad;
    const correo = correoEfectivo(unidad?.estructura);
    if (!correo) return void (await registrar(pago.id, 'omitido', { motivo: 'El block no tiene correo para vouchers' }));
    if (!pago.comprobante) return void (await registrar(pago.id, 'omitido', { motivo: 'El pago no tiene voucher' }));
    const { sha256 } = pago.comprobante;

    // Una vez por voucher: si el último aviso de este pago salió bien con el mismo archivo, no se repite.
    const ultimo = await prisma.auditoria.findFirst({ where: { entidad: 'pago', entidad_id: pago.id, accion: ACCION_AVISO_VOUCHER }, orderBy: { id: 'desc' }, select: { detalle: true } });
    const d = ultimo?.detalle as { resultado?: string; sha256?: string } | null | undefined;
    if (d?.resultado === 'enviado' && d.sha256 === sha256) return;

    const recibo = pago.reciboConceptoUnidad?.reciboConcepto?.recibo;
    const total = pago.grupo != null ? (await prisma.pago.aggregate({ where: { grupo: pago.grupo }, _sum: { monto: true } }))._sum.monto ?? pago.monto : pago.monto;
    const monto = dineroTexto(total, unidad?.complejo?.moneda);
    const mes = recibo ? `${nombreMes(recibo.mes)} ${recibo.anio}` : null;
    const block = unidad?.estructura?.nombre ?? null;
    const propietario = unidad?.propietario?.nombre ?? null;
    const asunto = ['Voucher de pago', unidad?.codigo, mes, monto].filter(Boolean).join(' · ');
    const cuerpo = [
      'Hola:',
      '',
      'Un vecino acaba de subir su voucher de pago en Torre. Te lo adjuntamos para que lo tengas a mano.',
      '',
      `Departamento: ${unidad?.codigo ?? '—'}${block ? ` (${block})` : ''}`,
      ...(unidad?.complejo?.nombre ? [`Condominio: ${unidad.complejo.nombre}`] : []),
      ...(propietario ? [`Propietario: ${propietario}`] : []),
      ...(pago.usuario?.nombre && pago.usuario.nombre !== propietario ? [`Pagó: ${pago.usuario.nombre}`] : []),
      ...(mes ? [`Mes: ${mes}`] : []),
      `Monto: ${monto}`,
      `Método: ${(pago.metodo_pago && METODOS[pago.metodo_pago]) ?? pago.metodo_pago ?? '—'}`,
      ...(pago.referencia ? [`N.º de operación: ${pago.referencia}`] : []),
      `Fecha: ${fechaEnZona(pago.fecha_pago, unidad?.complejo?.zona_horaria ?? ZONA_POR_DEFECTO)}`,
      '',
      `El pago queda en revisión y se valida en Torre (${ENLACE_APP}). No hace falta que respondas este correo.`,
    ].join('\n');

    const adjuntos = [{ nombre: pago.comprobante.nombre, datos: Buffer.from(pago.comprobante.datos) }];
    let intentos = 1;
    let r: ResultadoEnvio = await enviarCorreo(deps, correo, asunto, cuerpo, adjuntos);
    if (r.resultado === 'fallo') {
      intentos = 2;
      await esperar(deps.esperaReintentoMs);
      r = await enviarCorreo(deps, correo, asunto, cuerpo, adjuntos);
    }
    if (r.resultado === 'ok') return void (await registrar(pago.id, 'enviado', { sha256, intentos }));
    await registrar(pago.id, r.resultado === 'omitida' ? 'omitido' : 'fallo', { motivo: r.motivo, sha256, intentos });
  } catch (err) {
    // Nunca el mensaje del error: podría traer datos del pago o cabeceras con la clave.
    console.error('[voucher-block] no se pudo avisar al block', err instanceof Error ? err.name : 'error');
    await registrar(pagoId, 'fallo', { motivo: 'Error interno al preparar el correo' }).catch(() => undefined);
  }
}

// ---------- Segundo plano ----------
const enCurso = new Set<Promise<unknown>>();

/** Lanza el aviso sin esperarlo: el pago ya está guardado y su respuesta no depende de esto. */
export function avisarVoucherEnSegundoPlano(pagoId: number): void {
  const p: Promise<unknown> = avisarVoucherAlBlock(pagoId).finally(() => { enCurso.delete(p); });
  enCurso.add(p);
}

/** Gancho de pruebas: espera a que terminen los avisos en curso. */
export async function esperarAvisosVoucher(): Promise<void> {
  while (enCurso.size) await Promise.allSettled([...enCurso]);
}
