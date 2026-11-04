import { prisma } from '../../db';
import { registrarAuditoria } from '../../middleware/audit';
import { normalizarCelular } from '../avisos/celular';
import { comandoDe } from './formato';

/** Lo que se escribe por WhatsApp para dejar de recibir avisos por ese canal (sin mayúsculas, acentos ni espacios alrededor). */
const PALABRAS_BAJA = new Set(['salir', 'baja', 'stop']);

/** Respuesta fija: no dice si el número existe en Torre. */
export const TEXTO_BAJA_WHATSAPP = 'Listo: ya no te enviaremos avisos por WhatsApp. Los seguirás recibiendo por correo. Para volver a activarlos, entra a Torre › Mi perfil.';

/** ¿El texto es una baja? (SALIR, BAJA o STOP, sin distinguir mayúsculas ni acentos). */
export const esBajaWhatsapp = (texto: string): boolean => PALABRAS_BAJA.has(comandoDe(texto));

/** Personas de la empresa: su personal (`empresa_id`), los residentes con alguna unidad suya y las personas de sus departamentos. */
async function idsDeEmpresa(empresaId: number): Promise<number[]> {
  const [personal, unidades, personas] = await Promise.all([
    prisma.usuario.findMany({ where: { empresa_id: empresaId }, select: { id: true } }),
    prisma.unidad.findMany({ where: { OR: [{ empresa_id: empresaId }, { complejo: { empresa_id: empresaId } }] }, select: { propietario_id: true, inquilino_id: true } }),
    // Las personas del departamento (con o sin acceso a Torre) también reciben avisos por su cuenta: la baja las alcanza.
    prisma.personaUnidad.findMany({ where: { empresa_id: empresaId, usuario_id: { not: null } }, select: { usuario_id: true } }),
  ]);
  const ids = new Set(personal.map((u) => u.id));
  for (const u of unidades) for (const id of [u.propietario_id, u.inquilino_id]) if (id != null) ids.add(id);
  for (const p of personas) if (p.usuario_id != null) ids.add(p.usuario_id);
  return [...ids];
}

/**
 * Apaga (`aviso_whatsapp = false`) a las personas de ESA empresa que tienen ese número: la del vínculo vigente y las que lo tienen en su
 * perfil (`telefono`, normalizado). Nunca toca a nadie de otra empresa, tenga o no vínculo. Deja auditoría sin el número. Devuelve cuántas personas son.
 * `numero`: E.164 sin «+» (como lo entrega el webhook). No se loguea ni se guarda en ningún registro.
 */
export async function darDeBajaWhatsapp(empresaId: number, numero: string): Promise<number> {
  const vinculos = await prisma.canalVinculado.findMany({ where: { canal: 'whatsapp', identificador: numero, empresa_id: empresaId, revocado_at: null }, select: { usuario_id: true } });
  const ids = new Set(vinculos.map((v) => v.usuario_id));
  const conTelefono = await prisma.usuario.findMany({ where: { id: { in: await idsDeEmpresa(empresaId) }, telefono: { not: null } }, select: { id: true, telefono: true } });
  for (const u of conTelefono) if (normalizarCelular(u.telefono) === numero) ids.add(u.id);
  if (ids.size) await prisma.usuario.updateMany({ where: { id: { in: [...ids] } }, data: { aviso_whatsapp: false } });
  const autor = ids.size === 1 ? [...ids][0]! : null;
  void registrarAuditoria({ usuario_id: autor, accion: 'baja_whatsapp', entidad: 'usuario', entidad_id: autor, detalle: { personas: ids.size, empresa_id: empresaId } });
  return ids.size;
}
