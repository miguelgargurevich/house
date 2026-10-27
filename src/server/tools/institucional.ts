// Tanda 1 · datos de EMPRESAS: la que administra el condominio y los proveedores. Son las ÚNICAS herramientas cuya salida puede llevar correo y teléfono
// (de la empresa, no de personas): lo hacen con `ContactoInstitucional`, que `depurar` respeta sólo para estos dos nombres
// (`HERRAMIENTAS_CON_CONTACTO_INSTITUCIONAL`). Nunca se usa con un `Usuario`: una prueba vigila que estos factories sólo se llamen en este archivo.
import { Prisma } from '@prisma/client';
import { RUBROS_PROVEEDOR } from '../config';
import { prisma } from '../db';
import { ambitoJunta } from '../lib/junta';
import { dondeVer } from '../lib/rutasApp';
import { scopeComplejos, scopeProveedores } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { z } from '../validation';
import { ContactoInstitucional, cortar, dato, defineHerramienta, fechaDia, idPositivo, paginacion, pagina, respuesta, textoCorto } from './base';
import { unidadesPropias } from './residente';

// ---------- contacto_administracion ----------
/** Condominios sobre los que esta persona puede preguntar quién administra: los suyos (por unidades o por su condominio) o, para la administración, los de su empresa. */
async function complejosDe(u: AuthUser): Promise<Prisma.ComplejoHabitacionalWhereInput> {
  if (u.rol === 'superadmin' || u.rol === 'admin') return scopeComplejos(u);
  const unidades = await prisma.unidad.findMany({ where: unidadesPropias(u), distinct: ['complejo_id'], take: 50, select: { complejo_id: true } }); // 403 si no es residente
  const ids = new Set(unidades.map((x) => x.complejo_id).filter((x): x is number => x != null));
  if (u.complejo_id != null) ids.add(u.complejo_id);
  return ids.size ? { id: { in: [...ids] } } : { id: -1 };
}

export const contactoAdministracion = defineHerramienta({
  nombre: 'contacto_administracion',
  descripcion:
    'Quién administra el condominio de la persona que escribe y cómo contactarlo: nombre de la empresa administradora, su correo y teléfono INSTITUCIONALES, su representante y desde cuándo está vigente su contrato. ' +
    'Úsala para «¿quién administra mi condominio?», «¿cuál es el teléfono/correo de la administración?» o «¿a quién le reclamo?». Sólo trae datos de la empresa, nunca de personas. ' +
    'Si el condominio no tiene empresa o el dato no está registrado, dilo y sugiere hablar con la junta. Ejemplo: {}.',
  entrada: z.strictObject({ condominio_id: idPositivo.optional().describe('Si tienes varios condominios, el id del que preguntas (de `condominios_y_blocks`).'), ...paginacion }),
  roles: ['admin', 'superadmin', 'propietario', 'inquilino'],
  solo_lectura: true,
  async ejecutar(u, e) {
    const p = pagina(e);
    const complejos = await prisma.complejoHabitacional.findMany({
      where: { AND: [await complejosDe(u), e.condominio_id ? { id: e.condominio_id } : {}] },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      skip: p.skip,
      take: p.take,
      select: {
        id: true, nombre: true,
        empresa: { select: { nombre: true, email: true, telefono: true, representante_legal: true } },
        contratos: { where: { fecha_fin: null }, orderBy: { fecha_inicio: 'desc' }, take: 1, select: { fecha_inicio: true } },
      },
    });
    const c = cortar(complejos, p);
    return respuesta({
      filas: c.filas.map((x) => ({
        condominio: dato(x.nombre),
        administradora: x.empresa
          ? { nombre: dato(x.empresa.nombre, 120), representante: dato(x.empresa.representante_legal, 120), contacto: ContactoInstitucional.deEmpresa(x.empresa) }
          : null,
        contrato_vigente_desde: fechaDia(x.contratos[0]?.fecha_inicio),
      })),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
      nota: c.filas.length === 0 ? 'No tienes condominios registrados en House; consulta con tu junta.' : null,
    });
  },
});

// ---------- proveedores ----------
/** Administración: los de su empresa. Junta: los de su empresa que atienden SU condominio (y sólo si esa empresa lo administra hoy). */
function proveedoresDe(u: AuthUser): Prisma.ProveedorWhereInput {
  if (u.rol === 'superadmin' || u.rol === 'admin') return scopeProveedores(u);
  const a = ambitoJunta(u);
  if (!a) return { id: -1 };
  return { complejos: { some: { complejo_id: a.complejo_id } }, empresa: { complejos: { some: { id: a.complejo_id } } } };
}

export const proveedores = defineHerramienta({
  nombre: 'proveedores',
  descripcion:
    'Directorio de proveedores del condominio (ascensores, gasfitería, electricidad, pintura, jardinería, limpieza, seguridad, fumigación, carpintería, cerrajería, otros): razón social, rubro, persona de contacto, teléfono y correo DEL PROVEEDOR, condominios que atiende y notas. ' +
    'Úsala para «¿qué gasfitero tenemos?», «¿quién da mantenimiento al ascensor?» o «dame el teléfono del proveedor de fumigación». Sólo administración y junta; por omisión sólo los activos. ' +
    'Ejemplo: {"rubro":"ascensores"}.',
  entrada: z.strictObject({
    rubro: z.enum(RUBROS_PROVEEDOR).optional(),
    texto: textoCorto(60).optional().describe('Parte de la razón social o del nombre del contacto.'),
    condominio_id: idPositivo.optional().describe('Sólo los que atienden este condominio (id de `condominios_y_blocks`).'),
    incluir_inactivos: z.boolean().default(false).describe('true = también los proveedores dados de baja.'),
    ...paginacion,
  }),
  roles: ['admin', 'superadmin'],
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const p = pagina(e);
    const ci = { contains: e.texto ?? '', mode: 'insensitive' as const };
    const filas = await prisma.proveedor.findMany({
      where: {
        AND: [
          proveedoresDe(u),
          e.incluir_inactivos ? {} : { activo: true },
          e.rubro ? { rubro: e.rubro } : {},
          e.condominio_id ? { complejos: { some: { complejo_id: e.condominio_id } } } : {},
          e.texto ? { OR: [{ razon_social: ci }, { contacto_nombre: ci }] } : {},
        ],
      },
      orderBy: [{ rubro: 'asc' }, { razon_social: 'asc' }, { id: 'asc' }],
      skip: p.skip,
      take: p.take,
      select: {
        id: true, razon_social: true, rubro: true, contacto_nombre: true, telefono: true, email: true, notas: true, activo: true,
        empresa: { select: { nombre: true } }, complejos: { select: { complejo: { select: { nombre: true } } } },
      },
    });
    const c = cortar(filas, p);
    return respuesta({
      filas: c.filas.map((x) => ({
        razon_social: dato(x.razon_social, 160),
        rubro: dato(x.rubro, 30),
        activo: x.activo,
        ...(u.rol === 'superadmin' ? { empresa: dato(x.empresa?.nombre) } : {}),
        condominios: x.complejos.map((k) => dato(k.complejo.nombre)).slice(0, 10),
        contacto: ContactoInstitucional.deProveedor(x),
        notas: dato(x.notas, 300),
      })),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
      nota: c.filas.length === 0 ? 'No hay proveedores registrados con ese filtro.' : null,
      ver_en: dondeVer(u.rol, 'proveedores'),
    });
  },
});

export const HERRAMIENTAS_INSTITUCIONAL = [contactoAdministracion, proveedores];
