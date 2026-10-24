// Etapa 3 · herramientas de la plataforma (sólo superadmin). Sin claves, sin correos, sin teléfonos.
import { prisma } from '../db';
import { cooldownDeps } from '../lib/cooldown';
import { proveedorPorId } from '../lib/proveedoresIA';
import { PRESUPUESTO_DIARIO, consumoDelDia } from '../services/asistente/canary';
import { saludActual } from '../services/asistente/salud';
import { z } from '../validation';
import { cortar, dato, defineHerramienta, fechaDia, instante, nombreCorto, paginacion, pagina, respuesta, textoCorto } from './base';

const SUPERADMIN = ['superadmin'] as const;

export const empresas = defineHerramienta({
  nombre: 'empresas',
  descripcion: 'Empresas administradoras de la plataforma con sus conteos (condominios, unidades, usuarios) y estado. Úsala para «¿cuántas empresas hay?» o «¿qué empresa tiene más unidades?». Sin RUC ni datos de contacto. Ejemplo: {}.',
  entrada: z.strictObject({ ...paginacion }),
  roles: SUPERADMIN,
  solo_lectura: true,
  async ejecutar(_u, e) {
    const p = pagina(e);
    const [filas, total] = await Promise.all([
      prisma.empresaAdministradora.findMany({
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }], skip: p.skip, take: p.take,
        select: { id: true, nombre: true, estado: true, _count: { select: { complejos: true, unidades: true, usuarios: true } } },
      }),
      prisma.empresaAdministradora.count(),
    ]);
    const c = cortar(filas, p);
    return respuesta({
      total,
      filas: c.filas.map((x) => ({ id: x.id, nombre: dato(x.nombre), estado: dato(x.estado, 20), condominios: x._count.complejos, unidades: x._count.unidades, usuarios: x._count.usuarios })),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
    });
  },
});

export const saludDeLaIa = defineHerramienta({
  nombre: 'salud_de_la_ia',
  descripcion: 'Estado de la IA del asistente: si responde, qué rutas (proveedor + modelo) están sanas, enfriando o rechazadas, cuántos modelos hay activos y deprecados por proveedor y cuánto del presupuesto diario del canary se usó. Sin claves. Úsala para «¿por qué el asistente está lento o caído?». Ejemplo: {}.',
  entrada: z.strictObject({}),
  roles: SUPERADMIN,
  solo_lectura: true,
  async ejecutar() {
    const [salud, modelos, claves] = await Promise.all([
      saludActual(),
      prisma.modeloIA.groupBy({ by: ['clave_id', 'estado'], _count: { _all: true } }),
      prisma.claveIntegracion.findMany({ select: { id: true, proveedor: true } }),
    ]);
    const proveedorDe = new Map(claves.map((c) => [c.id, c.proveedor]));
    const por = new Map<string, { activos: number; deprecados: number; nuevos: number }>();
    for (const m of modelos) {
      const prov = proveedorDe.get(m.clave_id);
      if (!prov) continue;
      const x = por.get(prov) ?? { activos: 0, deprecados: 0, nuevos: 0 };
      if (m.estado === 'deprecado') x.deprecados += m._count._all;
      else if (m.estado === 'nuevo') x.nuevos += m._count._all;
      else x.activos += m._count._all;
      por.set(prov, x);
    }
    return respuesta({
      configurada: salud.configurada,
      sana: salud.ok,
      caida_desde: instante(salud.desde ? new Date(salud.desde) : null),
      motivo: dato(salud.motivo, 200),
      rutas: salud.rutas.map((r) => ({ proveedor: proveedorPorId(r.proveedor)?.nombre ?? dato(r.proveedor, 40), modelo: dato(r.modelo, 80), estado: r.estado, hasta: instante(r.hasta ? new Date(r.hasta) : null), reserva: r.reserva })),
      modelos_por_proveedor: [...por.entries()].map(([proveedor, v]) => ({ proveedor: proveedorPorId(proveedor)?.nombre ?? dato(proveedor, 40), ...v })),
      canary: { consultas_hoy: consumoDelDia(cooldownDeps.ahora()), presupuesto_diario: PRESUPUESTO_DIARIO },
    });
  },
});

export const auditoriaReciente = defineHerramienta({
  nombre: 'auditoria_reciente',
  descripcion: 'Últimos movimientos de la auditoría: quién (nombre), qué acción, sobre qué entidad y cuándo; las consultas por herramientas también quedan (entidad «herramienta»). Sin correos, IP ni el contenido de los cambios. Úsala para «¿qué pasó hoy?». Ejemplo: {"entidad":"pagos","dias":2}.',
  entrada: z.strictObject({ entidad: textoCorto(60).optional(), accion: textoCorto(30).optional(), dias: z.number().int().min(1).max(90).default(7), ...paginacion }),
  roles: SUPERADMIN,
  solo_lectura: true,
  async ejecutar(_u, e) {
    const p = pagina(e);
    const desde = new Date(cooldownDeps.ahora() - e.dias * 86_400_000);
    const filas = await prisma.auditoria.findMany({
      where: { created_at: { gte: desde }, ...(e.entidad ? { entidad: e.entidad } : {}), ...(e.accion ? { accion: e.accion } : {}) },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }], skip: p.skip, take: p.take,
      select: { id: true, accion: true, entidad: true, entidad_id: true, created_at: true, detalle: true, usuario: { select: { nombre: true, rol: true } } },
    });
    const c = cortar(filas, p);
    return respuesta({
      desde: fechaDia(desde),
      filas: c.filas.map((a) => {
        // Del detalle sólo sale lo que escribe el propio catálogo de herramientas (nombre y origen), jamás el cuerpo de una mutación.
        const d = a.entidad === 'herramienta' && a.detalle && typeof a.detalle === 'object' && !Array.isArray(a.detalle) ? (a.detalle as Record<string, unknown>) : null;
        return {
          id: a.id, fecha: instante(a.created_at), usuario: nombreCorto(a.usuario?.nombre), rol: dato(a.usuario?.rol, 20), accion: dato(a.accion, 30), entidad: dato(a.entidad, 60), entidad_id: a.entidad_id,
          ...(d ? { herramienta: dato(typeof d.herramienta === 'string' ? d.herramienta : null, 40), origen: dato(typeof d.origen === 'string' ? d.origen : null, 12) } : {}),
        };
      }),
      hay_mas: c.hay_mas,
      siguiente_cursor: c.siguiente_cursor,
    });
  },
});

export const HERRAMIENTAS_SUPERADMIN = [empresas, saludDeLaIa, auditoriaReciente];
