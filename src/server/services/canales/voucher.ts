import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { HttpError } from '../../errors';
import { esJunta } from '../../lib/junta';
import { listarMantenimientos } from '../../lib/mantenimientos';
import { periodoTexto } from '../../lib/periodo';
import { registrarAuditoria } from '../../middleware/audit';
import type { AuthUser } from '../../middleware/auth';
import { detectarTipo, MAX_COMPROBANTE, sanearNombre } from '../comprobantes';
import { avisarVoucherEnSegundoPlano } from '../avisos/voucherBlock';
import { iniciarEvaluacion } from '../evaluacion';
import { solesTexto } from '../avisos/plantillas';
import { canalesDeps } from './deps';
import { unidadesDeResidenteEnEmpresa } from './identidad';
import { MedioMuyGrande, type MedioBajado, type MedioEntrante, type Transporte } from './transporte';
import type { CanalBot } from './vinculos';
import { pagarMantenimiento } from '../mantenimiento';

export const MIN_PENDIENTE = 15;
/** Opciones que se ofrecen cuando hay varios mantenimientos pendientes (los más próximos a vencer). */
export const MAX_OPCIONES = 9;

export const MSG = {
  junta: 'Los comprobantes de pago como administración o junta se registran desde House (menú Pagos). Por aquí sólo recibo los de vecinos.',
  sinPendientes: 'No tienes mantenimientos pendientes de pago, así que no necesito ningún comprobante. Si crees que es un error, revisa House › Mis recibos.',
  grande: 'El archivo es muy pesado (máximo 2 MB). Envíame una captura o foto más liviana, o un PDF más pequeño.',
  tipo: 'Sólo puedo leer comprobantes en imagen (JPG, PNG o WebP) o PDF. Envíalo de nuevo en uno de esos formatos.',
  descarga: 'No pude descargar tu archivo. Envíalo de nuevo en un momento.',
  recibido: 'Recibido, lo estamos revisando. Te aviso por aquí apenas esté validado.',
  yaEnRevision: 'Ese mantenimiento ya tiene un pago en revisión o ya fue pagado, así que no registré el comprobante.',
  vencido: 'Ese comprobante venció (esperé tu respuesta 15 minutos). Envíalo de nuevo.',
  cancelado: 'Listo, descarté el comprobante.',
  falloRegistro: 'No pude registrar tu comprobante. Inténtalo de nuevo o súbelo desde House › Mis recibos.',
};

interface Opcion { recibo_id: number; unidad_id: number; etiqueta: string }

/** Mantenimientos por pagar de las unidades del residente EN ESTA EMPRESA (propias; nunca de otra persona), por vencimiento. */
export async function pendientesDe(user: AuthUser, empresaId: number): Promise<Opcion[]> {
  const unidades = await prisma.unidad.findMany({ where: unidadesDeResidenteEnEmpresa(user.id, empresaId), select: { id: true } });
  if (!unidades.length) return [];
  const r = await listarMantenimientos({ unidadIds: unidades.map((u) => u.id), estado: ['pendiente', 'vencido', 'parcial'] }, { page: 1, pageSize: MAX_OPCIONES, orden: { campo: 'vencimiento', dir: 'asc' } });
  return r.items.map((i) => ({ recibo_id: i.recibo_id, unidad_id: i.unidad_id, etiqueta: `${i.unidad.codigo} ${periodoTexto(i.mes, i.anio)} (saldo ${solesTexto(i.saldo)})` }));
}

export interface Archivo { nombre: string; tipo_mime: string; tamano: number; sha256: string; datos: Buffer }

export type { MedioEntrante };

const aBuffer = (b: MedioBajado): Buffer | 'grande' => {
  if ('datos' in b) return b.datos.length > MAX_COMPROBANTE ? 'grande' : b.datos;
  const b64 = b.base64.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  if (Math.floor((b64.length * 3) / 4) > MAX_COMPROBANTE + 3) return 'grande';
  const datos = Buffer.from(b64, 'base64');
  return datos.length > MAX_COMPROBANTE ? 'grande' : datos;
};

/** Baja el medio por el transporte del canal y lo valida como en la web: tipos JPG/PNG/WebP/PDF por los bytes reales y tope de 2 MB. */
async function bajarArchivo(t: Pick<Transporte, 'descargarMedio'>, medio: MedioEntrante): Promise<{ archivo: Archivo } | { error: string }> {
  if (medio.tamano != null && medio.tamano > MAX_COMPROBANTE) return { error: MSG.grande };
  let datos: Buffer | 'grande';
  try {
    datos = aBuffer(await t.descargarMedio(medio));
  } catch (e) {
    return { error: e instanceof MedioMuyGrande ? MSG.grande : MSG.descarga };
  }
  if (datos === 'grande') return { error: MSG.grande };
  if (datos.length === 0) return { error: MSG.descarga };
  const tipo = detectarTipo(datos);
  if (!tipo) return { error: MSG.tipo };
  return { archivo: { nombre: sanearNombre(medio.nombre ?? undefined, tipo), tipo_mime: tipo, tamano: datos.length, sha256: createHash('sha256').update(datos).digest('hex'), datos } };
}

const lista = (ops: Opcion[]) => ops.map((o, i) => `${i + 1}) ${o.etiqueta}`).join('\n');

/** Registra el comprobante como en la web (modo residente) y manda la IA a leerlo. */
const ROTULO: Record<CanalBot, string> = { whatsapp: 'WhatsApp', telegram: 'Telegram' };

async function registrar(canal: CanalBot, user: AuthUser, empresaId: number, op: Opcion, a: Archivo): Promise<string> {
  // El mantenimiento sigue siendo de una unidad de esta persona (puede haber cambiado desde que se ofreció).
  if (!(await prisma.unidad.findFirst({ where: { AND: [{ id: op.unidad_id }, unidadesDeResidenteEnEmpresa(user.id, empresaId)] }, select: { id: true } }))) return MSG.falloRegistro;
  let r;
  try {
    r = await pagarMantenimiento({
      reciboId: op.recibo_id, unidadId: op.unidad_id, usuarioId: user.id, modo: 'residente', metodo_pago: 'transferencia',
      observaciones: `Comprobante enviado por ${ROTULO[canal]}`,
      comprobante: { nombre: a.nombre, tipo_mime: a.tipo_mime, tamano: a.tamano, sha256: a.sha256, datos: a.datos, subidoPorId: user.id },
    });
  } catch (e) {
    if (e instanceof HttpError && e.status === 409) return MSG.yaEnRevision;
    if (e instanceof HttpError && e.status === 404) return MSG.falloRegistro;
    console.error('[canales] no se pudo registrar el comprobante', e instanceof Error ? e.name : 'error');
    return MSG.falloRegistro;
  }
  // Sin número ni contenido: sólo qué se registró y por qué canal.
  void registrarAuditoria({
    usuario_id: user.id, accion: 'crear', entidad: 'pago', entidad_id: r.pago_id,
    detalle: { origen: canal, grupo: r.grupo, total: r.total, cargos: r.cargos, recibo_id: op.recibo_id, unidad_id: op.unidad_id, nombre: a.nombre, tipo_mime: a.tipo_mime, tamano: a.tamano, sha256: a.sha256 } as Prisma.InputJsonValue,
  });
  // La IA lee el voucher en segundo plano (con reintento y OCR de respaldo); si no arranca, el pago queda por validar a mano.
  await iniciarEvaluacion(r.pago_id, 'subida').catch((err) => console.error('[evaluacion] no se pudo iniciar', err instanceof Error ? err.name : 'error'));
  // El voucher también va por correo a la junta del block, en segundo plano.
  avisarVoucherEnSegundoPlano(r.pago_id);
  return MSG.recibido;
}

/** Llegó una imagen o un PDF de un vínculo verificado. Devuelve el texto de respuesta. */
export async function manejarMedio(o: { transporte: Pick<Transporte, 'canal' | 'descargarMedio'>; vinculoId: number; empresaId: number; user: AuthUser; medio: MedioEntrante }): Promise<string> {
  const { user, empresaId } = o;
  if ((user.rol !== 'propietario' && user.rol !== 'inquilino') || esJunta(user)) return MSG.junta;
  const opciones = await pendientesDe(user, empresaId);
  if (opciones.length === 0) return MSG.sinPendientes;
  const bajado = await bajarArchivo(o.transporte, o.medio);
  if ('error' in bajado) return bajado.error;
  if (opciones.length === 1) return registrar(o.transporte.canal, user, empresaId, opciones[0]!, bajado.archivo);
  // Varios: se guarda el archivo (15 min) y se pregunta cuál. Un voucher pendiente por vínculo: el nuevo reemplaza al anterior.
  const a = bajado.archivo;
  await prisma.$transaction([
    prisma.canalPendiente.deleteMany({ where: { vinculo_id: o.vinculoId } }),
    prisma.canalPendiente.create({
      data: { vinculo_id: o.vinculoId, usuario_id: user.id, opciones: opciones as unknown as Prisma.InputJsonValue, nombre: a.nombre, tipo_mime: a.tipo_mime, tamano: a.tamano, sha256: a.sha256, datos: a.datos, expira_at: new Date(canalesDeps.ahora().getTime() + MIN_PENDIENTE * 60_000) },
    }),
  ]);
  return `¿Cuál pagaste? Responde con el número:\n${lista(opciones)}\n\n(o escribe «cancelar»)`;
}

/**
 * ¿El texto responde a un voucher pendiente? Devuelve el texto a enviar, o `null` si no tiene nada que ver (sigue el flujo normal).
 * Un número válido registra el pago con la opción elegida; «cancelar» lo descarta; un número fuera de rango vuelve a preguntar.
 */
export async function manejarRespuestaPendiente(o: { canal: CanalBot; vinculoId: number; empresaId: number; user: AuthUser; texto: string }): Promise<string | null> {
  const t = o.texto.trim().toLowerCase();
  const esNumero = /^\d{1,2}$/.test(t);
  const esCancelar = t === 'cancelar';
  if (!esNumero && !esCancelar) return null;
  const p = await prisma.canalPendiente.findFirst({ where: { vinculo_id: o.vinculoId, usuario_id: o.user.id }, orderBy: { id: 'desc' } });
  if (!p) return null;
  if (p.expira_at <= canalesDeps.ahora()) {
    await prisma.canalPendiente.deleteMany({ where: { vinculo_id: o.vinculoId } });
    return MSG.vencido;
  }
  if (esCancelar) {
    await prisma.canalPendiente.deleteMany({ where: { vinculo_id: o.vinculoId } });
    return MSG.cancelado;
  }
  const ops = p.opciones as unknown as Opcion[];
  const n = Number(t);
  if (n < 1 || n > ops.length) return `Responde con un número del 1 al ${ops.length} (o «cancelar»):\n${lista(ops)}`;
  // El pendiente se gasta una vez: dos «2» seguidos no registran dos pagos.
  const gastado = await prisma.canalPendiente.deleteMany({ where: { id: p.id } });
  if (gastado.count !== 1) return null;
  const archivo: Archivo = { nombre: p.nombre, tipo_mime: p.tipo_mime, tamano: p.tamano, sha256: p.sha256, datos: Buffer.from(p.datos) };
  return registrar(o.canal, o.user, o.empresaId, ops[n - 1]!, archivo);
}
