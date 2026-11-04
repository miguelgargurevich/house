// Marca de la empresa administradora: qué ve cada usuario según SU empresa. Una empresa tiene marca propia (color y nombre comercial) si AL MENOS
// uno de sus condominios tiene la capacidad `marca_propia`; sin ella se guarda igual pero la app, el recibo y los correos usan el verde de Torre y la
// razón social. El logo va en todos los planes.
import { prisma } from '../../db';
import { unidadesDeUsuario } from '../../lib/scope';
import { paletaDeMarca, esHexColor } from '../../../lib/marca';
import { CAPACIDAD_MARCA } from '../comercial/catalogo';
import { moduloActivo } from '../comercial/modulos';
import { versionImagen } from '../imagenes';
import { urlPublicaDeLogo } from './firma';
import { MARCA_TORRE, type ColoresCorreo, type MarcaCorreo, type MarcaEmpresa } from './tipos';

/** ¿Alguno de los condominios de la empresa tiene `marca_propia` activa (plan vigente, no vencido ni apagado)? */
export async function empresaTieneMarcaPropia(empresaId: number): Promise<boolean> {
  // Sólo se miran los condominios cuyo plan (o módulos comprados) trae la capacidad: evita preguntar uno por uno en una empresa grande.
  const planes = await prisma.planComercial.findMany({ where: { modulos_incluidos: { has: CAPACIDAD_MARCA } }, select: { clave: true } });
  const candidatos = await prisma.suscripcionCondominio.findMany({
    where: { complejo: { empresa_id: empresaId }, OR: [{ plan_clave: { in: planes.map((p) => p.clave) } }, { modulos: { has: CAPACIDAD_MARCA } }] },
    select: { complejo_id: true },
    orderBy: { complejo_id: 'asc' },
  });
  for (const c of candidatos) if (await moduloActivo(c.complejo_id, CAPACIDAD_MARCA)) return true;
  return false;
}

/** Fila de la empresa con lo que hace falta para armar su marca. `null` si no existe. */
async function cargar(empresaId: number) {
  const [empresa, logo] = await Promise.all([
    prisma.empresaAdministradora.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true, nombre_comercial: true, color_marca: true } }),
    prisma.imagenRecibo.findUnique({ where: { empresa_id: empresaId }, select: { updated_at: true } }),
  ]);
  return empresa ? { empresa, logo } : null;
}

/** La marca de una empresa. Sin empresa (superadmin, usuario sin empresa) o inexistente → la de Torre. */
export async function marcaDeEmpresa(empresaId: number | null | undefined): Promise<MarcaEmpresa> {
  if (empresaId == null) return MARCA_TORRE;
  const c = await cargar(empresaId);
  if (!c) return MARCA_TORRE;
  const activa = await empresaTieneMarcaPropia(empresaId);
  const color = activa && esHexColor(c.empresa.color_marca) ? c.empresa.color_marca : null;
  return {
    empresa_id: empresaId,
    razon_social: c.empresa.nombre,
    nombre: activa ? c.empresa.nombre_comercial?.trim() || c.empresa.nombre : c.empresa.nombre,
    logo_url: c.logo ? `/api/empresas/${empresaId}/logo?v=${versionImagen(c.logo.updated_at)}` : null,
    color,
    activa,
  };
}

/**
 * La empresa cuya marca ve esta persona: el personal y la administración, la suya (`empresa_id`); un residente (propietario o inquilino), la del condominio de
 * su departamento — con departamentos en dos empresas, la del primero (el de menor id; el residente no tiene un condominio «activo» elegido); el
 * superadmin no pertenece a ninguna empresa: Torre (`null`).
 */
export async function empresaDeUsuario(u: { id: number; rol: string | null; empresa_id: number | null }): Promise<number | null> {
  if (u.rol === 'superadmin') return null;
  if (u.rol === 'propietario' || u.rol === 'inquilino') {
    const unidad = await prisma.unidad.findFirst({ where: unidadesDeUsuario(u.id), orderBy: { id: 'asc' }, select: { empresa_id: true, complejo: { select: { empresa_id: true } } } });
    return unidad?.complejo?.empresa_id ?? unidad?.empresa_id ?? null;
  }
  return u.empresa_id;
}

export async function marcaDeUsuario(u: { id: number; rol: string | null; empresa_id: number | null }): Promise<MarcaEmpresa> {
  return marcaDeEmpresa(await empresaDeUsuario(u));
}

/** La marca para el marco de un correo; `null` si la empresa no tiene marca propia activa (el correo sale como siempre, con la cara de Torre). */
export async function marcaParaCorreo(empresaId: number | null | undefined): Promise<MarcaCorreo | null> {
  if (empresaId == null) return null;
  const c = await cargar(empresaId);
  if (!c || !(await empresaTieneMarcaPropia(empresaId))) return null;
  const { color_marca, nombre_comercial, nombre } = c.empresa;
  const nombreMarca = nombre_comercial?.trim() || nombre;
  const logoUrl = c.logo ? urlPublicaDeLogo(empresaId, versionImagen(c.logo.updated_at)) : null;
  if (!esHexColor(color_marca)) return { nombre: nombreMarca, logoUrl, claro: null, oscuro: null };
  const p = paletaDeMarca(color_marca);
  const pick = (t: ColoresCorreo): ColoresCorreo => ({ brand: t.brand, onBrand: t.onBrand, brandSoft: t.brandSoft });
  return { nombre: nombreMarca, logoUrl, claro: pick(p.hex.claro), oscuro: pick(p.hex.oscuro) };
}
