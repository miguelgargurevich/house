// Tanda 1 · `estado_de_pago`: en qué quedó el pago de un mantenimiento (por validar, validado o rechazado y por qué), si tiene voucher y, si la IA lo
// leyó, qué leyó y qué concluyó. Mismo alcance que las APIs de pagos: el residente sólo los suyos, la junta los de su ámbito, la administración los de su
// empresa. El residente ve la evaluación simple (`estadoParaResidente`); quien valida ve la completa (`vistaGestion`). Nunca el contenido del archivo.
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { estadoParaResidente, selectEvaluacion, vistaGestion, type EstadoResidente } from '../lib/evaluacionVista';
import { ambitoJunta } from '../lib/junta';
import { scopePagosJunta } from '../lib/scope';
import type { AuthUser } from '../middleware/auth';
import { soloPrincipales } from '../services/mantenimiento';
import { z } from '../validation';
import { alcanceGestion } from './gestion';
import { cortar, dato, defineHerramienta, fechaDia, idPositivo, instante, monto, nombreCorto, paginacion, pagina, periodoDe, periodoSchema, respuesta, textoCorto } from './base';
import { unidadesPropias } from './residente';

const ESTADOS_PAGO = ['por_validar', 'validado', 'rechazado'] as const;

const TEXTO_ESTADO_RESIDENTE: Record<EstadoResidente, string> = {
  evaluando: 'La IA todavía está leyendo el comprobante.',
  revisado: 'La IA vio el comprobante en orden; la decisión final la toma una persona.',
  necesita_revision: 'Una persona debe revisar el comprobante.',
  no_disponible: 'La lectura automática no estuvo disponible; lo revisa una persona.',
};

/** Pagos que esta persona puede mirar y con qué vista de la evaluación (`gestion` = la completa, `residente` = la simple). */
function alcancePagos(u: AuthUser): { donde: Prisma.PagoWhereInput; vista: 'gestion' | 'residente'; alcance: string } {
  if (u.rol === 'superadmin' || u.rol === 'admin') return { donde: alcanceGestion(u).pagos, vista: 'gestion', alcance: u.rol === 'superadmin' ? 'toda la plataforma' : 'tu empresa' };
  const propios: Prisma.PagoWhereInput = { reciboConceptoUnidad: { unidad: unidadesPropias(u) } }; // 403 si no es residente
  if (ambitoJunta(u)) return { donde: { OR: [scopePagosJunta(u), propios] }, vista: 'gestion', alcance: 'tu ámbito de junta' };
  return { donde: propios, vista: 'residente', alcance: 'tus unidades' };
}

const selectEstado = {
  id: true, monto: true, fecha_pago: true, metodo_pago: true, estado_validacion: true, motivo_rechazo: true, validado_por_ia: true, grupo: true,
  usuario: { select: { nombre: true } },
  comprobante: { select: { id: true } }, // sólo para saber si existe: nunca `datos`
  evaluacion: { select: selectEvaluacion },
  reciboConceptoUnidad: { select: { unidad: { select: { codigo: true, complejo: { select: { nombre: true } }, estructura: { select: { nombre: true } } } }, reciboConcepto: { select: { recibo: { select: { mes: true, anio: true } } } } } },
} satisfies Prisma.PagoSelect;

export const estadoDePago = defineHerramienta({
  nombre: 'estado_de_pago',
  descripcion:
    'En qué quedó el pago de un mantenimiento: estado (por_validar = en revisión, validado, rechazado, con el motivo si lo rechazaron), si tiene voucher (comprobante) y, si la IA lo evaluó, qué leyó (monto, fecha, medio, destinatario, últimos dígitos del destino) y su veredicto, confianza y motivo. ' +
    'Úsala para «¿ya validaron mi pago de octubre?», «¿por qué rechazaron el pago de la B01-804?» o «¿qué leyó la IA del voucher?». Cada fila es el pago del mantenimiento completo (el monto es el total del grupo). ' +
    'El residente sólo ve sus pagos y un estado simple de la IA; la junta, los de su ámbito; la administración, los de su empresa. Nunca devuelve el archivo del voucher. Ejemplo: {"unidad":"B01-804","periodo":"2026-10"}.',
  entrada: z.strictObject({
    unidad: textoCorto(30).optional().describe('Código de la unidad (departamento).'),
    periodo: periodoSchema.optional().describe('Mes del recibo, AAAA-MM.'),
    estado: z.enum(ESTADOS_PAGO).optional(),
    condominio_id: idPositivo.optional().describe('Filtra por condominio (id de `condominios_y_blocks`).'),
    estructura_id: idPositivo.optional().describe('Filtra por block (id de `condominios_y_blocks`).'),
    ...paginacion,
  }),
  roles: ['admin', 'superadmin', 'propietario', 'inquilino'],
  junta: true,
  solo_lectura: true,
  async ejecutar(u, e) {
    const al = alcancePagos(u);
    const p = pagina(e);
    const unidadFiltro: Prisma.UnidadWhereInput = {
      ...(e.unidad ? { codigo: { equals: e.unidad, mode: 'insensitive' } } : {}),
      ...(e.condominio_id ? { complejo_id: e.condominio_id } : {}),
      ...(e.estructura_id ? { estructura_id: e.estructura_id } : {}),
    };
    const filas = await prisma.pago.findMany({
      where: {
        AND: [
          al.donde, soloPrincipales,
          e.estado ? { estado_validacion: e.estado } : {},
          Object.keys(unidadFiltro).length ? { reciboConceptoUnidad: { unidad: unidadFiltro } } : {},
          e.periodo ? { reciboConceptoUnidad: { reciboConcepto: { recibo: { anio: Number(e.periodo.slice(0, 4)), mes: Number(e.periodo.slice(5, 7)) } } } } : {},
        ],
      },
      orderBy: [{ fecha_pago: 'desc' }, { id: 'desc' }],
      skip: p.skip,
      take: p.take,
      select: selectEstado,
    });
    const c = cortar(filas, p);
    // El pago de un mantenimiento son varios `Pago` (uno por concepto) con el mismo `grupo`: el monto que se muestra es el total del grupo.
    const grupos = [...new Set(c.filas.map((x) => x.grupo).filter((g): g is string => g != null))];
    const sumas = grupos.length ? await prisma.pago.groupBy({ by: ['grupo'], where: { grupo: { in: grupos } }, _sum: { monto: true } }) : [];
    const totalDe = new Map(sumas.map((s) => [s.grupo, s._sum.monto]));
    const gestion = al.vista === 'gestion';
    return respuesta({
      alcance: al.alcance,
      filas: c.filas.map((x) => {
        const rcu = x.reciboConceptoUnidad;
        const base = {
          id: x.id,
          unidad: dato(rcu?.unidad?.codigo, 30),
          block: dato(rcu?.unidad?.estructura?.nombre),
          periodo: periodoDe(rcu?.reciboConcepto?.recibo?.anio, rcu?.reciboConcepto?.recibo?.mes),
          monto: monto(x.grupo != null ? totalDe.get(x.grupo) ?? x.monto : x.monto),
          fecha_pago: instante(x.fecha_pago),
          fecha_dia: fechaDia(x.fecha_pago),
          metodo: dato(x.metodo_pago, 30),
          estado: x.estado_validacion,
          motivo_rechazo: x.estado_validacion === 'rechazado' ? dato(x.motivo_rechazo, 200) : null,
          tiene_voucher: x.comprobante != null,
          validado_automaticamente_por_ia: x.validado_por_ia,
        };
        if (!gestion) {
          const simple = estadoParaResidente(x.evaluacion);
          return { ...base, evaluacion_ia: simple ? { estado: simple, significado: TEXTO_ESTADO_RESIDENTE[simple] } : null };
        }
        const v = vistaGestion(x.evaluacion);
        return {
          ...base,
          condominio: dato(rcu?.unidad?.complejo?.nombre),
          registrado_por: nombreCorto(x.usuario?.nombre),
          evaluacion_ia: v && {
            estado: v.estado, veredicto: dato(v.veredicto, 30), confianza_porcentaje: v.confianza_porcentaje, motivo: dato(v.motivo, 200),
            alertas: v.alertas.map((a) => dato(a, 160)), coincide: v.coincide, error: dato(v.error, 160),
            // Lo que LEYÓ el modelo del comprobante: texto no confiable, acotado como cualquier otro dato de la base.
            leyo: v.leyo && {
              monto: v.leyo.monto == null ? null : monto(v.leyo.monto), moneda: dato(v.leyo.moneda, 5), fecha: dato(v.leyo.fecha, 10), medio: dato(v.leyo.medio, 20), estado_operacion: dato(v.leyo.estado_operacion, 20),
              destinatario: dato(v.leyo.destinatario, 80), destino_termina_en: v.leyo.destino_termina_en, numero_operacion: dato(v.leyo.numero_operacion, 40),
            },
          },
        };
      }),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
      nota: c.filas.length === 0 ? 'No hay pagos registrados con ese filtro (si falta el comprobante, el pago aún no se registró).' : null,
    });
  },
});

export const HERRAMIENTAS_PAGO = [estadoDePago];
