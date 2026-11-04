/**
 * Plan de la carga de contactos: a partir de las filas del Excel y de lo que Torre ya tiene, calcula QUÉ cambiaría (resumen, problemas por fila y operaciones)
 * sin escribir nunca. La vista previa (sin `confirmar`) y el guardado usan este mismo plan: el guardado lo rehace dentro de su transacción, con el candado
 * del condominio, y lo aplica (`aplicar.ts`). Así lo que se ve es lo que se guarda.
 *
 * Reglas (todas por seguridad entre empresas y entre personas):
 *  - Nunca se cambia un nombre ni quién es el propietario o el inquilino de una unidad que ya lo tiene.
 *  - Un correo que ya es de una cuenta de personal, de superadmin, de OTRA empresa o de una cuenta sin vínculo con este condominio NO se vincula: error de esa fila.
 *  - Un correo real ya cargado sólo cambia con `actualizar`; lo mismo el celular.
 *  - Una misma persona (mismo correo, nombres que se parecen) con varias unidades queda como UN usuario con todas ellas.
 *  - Mismo correo para personas con nombres distintos, o como propietario y como inquilino: error.
 */
import type { Prisma } from '@prisma/client';
import { ROLES_RESIDENTE } from '../../config';
import { buscarEstructura, codigoEncajaConDpto, numeroDeTorre } from '../../lib/excelRecibos';
import { normalizarCelular } from '../avisos/celular';
import { correoSinBuzon } from '../invitaciones';
import type { DatosPersona, FilaContacto, Persona } from './lector';
import { normalizarEncabezado } from './lector';

type Tx = Prisma.TransactionClient;

export interface Problema {
  fila: number;
  /** Código de la unidad («B01-101»); null si la fila no encajó con ninguna. */
  unidad: string | null;
  persona: Persona | null;
  nivel: 'error' | 'aviso';
  mensaje: string;
}

export interface ResumenContactos {
  /** Filas del Excel con departamento. */
  filas: number;
  /** Filas con al menos un error: esas filas (o esa persona de la fila) NO se guardan. */
  filas_con_error: number;
  filas_con_aviso: number;
  /** Personas distintas a las que se les agrega un correo (el de relleno o ninguno → uno real), contando también a los vecinos nuevos con correo. */
  correos_nuevos: number;
  /** Personas a las que se les cambia un correo real por otro (sólo con `actualizar`). */
  correos_cambiados: number;
  celulares_nuevos: number;
  celulares_cambiados: number;
  propietarios_nuevos: number;
  inquilinos_nuevos: number;
  /** Departamentos que pasan a una persona que ya tiene otro departamento (misma persona, mismo correo). */
  unidades_unidas: number;
  /** Departamentos cuyo aviso de cobro cambia de persona porque se les asigna inquilino. */
  cambian_quien_paga: number;
  /** Personas a las que se les podría mandar la invitación al guardar (correo real, sin contraseña, sin invitación vigente ni en cola). */
  invitables: number;
}

type Campo = 'propietario_id' | 'inquilino_id';

interface UsuarioDb {
  id: number;
  nombre: string;
  email: string;
  telefono: string | null;
  rol: string | null;
  empresa_id: number | null;
  complejo_id: number | null;
  password_hash: string | null;
}

/** Una persona tal como quedaría: la de la base (con sus cambios) o una nueva. */
export interface UsuarioVirtual {
  /** Id de la base; null = se crea. */
  id: number | null;
  clave: string;
  nombre: string;
  rol: Persona;
  email: string;
  telefono: string;
  /** Lo que tenía antes (vacío si es nueva). */
  email0: string;
  telefono0: string;
  tieneClave: boolean;
  complejo_id: number | null;
  /** Se le puso correo / celular en este plan (para encender sus avisos). */
  correoPuesto: boolean;
  celularPuesto: boolean;
  /** El correo de relleno de una persona nueva sin correo; se calcula al guardar. */
  sinCorreo: boolean;
  unidadInicial: number;
}

export interface Asignacion {
  unidadId: number;
  campo: Campo;
  /** Quien era (null = nadie) y quien queda. */
  antes: number | null;
  despues: UsuarioVirtual;
}

export interface PlanContactos {
  resumen: ResumenContactos;
  problemas: Problema[];
  usuarios: UsuarioVirtual[];
  asignaciones: Asignacion[];
  /** Ids de la base de las personas que quedan con correo real (para las invitaciones). */
  conCorreo: UsuarioVirtual[];
}

const esResidente = (rol: string | null): rol is Persona => (ROLES_RESIDENTE as readonly string[]).includes(rol ?? '');
const tieneCorreoReal = (email: string) => !!email && !correoSinBuzon(email);

// ---------- Nombres ----------
const PALABRAS_VACIAS = new Set(['del', 'las', 'los', 'sra', 'srta', 'don', 'dona', 'ing', 'lic', 'dra']);
const tokensDeNombre = (n: string) => normalizarEncabezado(n).split(' ').filter((t) => t.length >= 3 && !PALABRAS_VACIAS.has(t));

/** Distancia de edición ≤ 1 (una letra de más, de menos o distinta): tolera un error de tipeo en un apellido largo. */
function aLoSumoUnaLetra(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, dif = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++dif > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return dif + (a.length - i) + (b.length - j) <= 1;
}

/**
 * ¿Pueden ser la misma persona? Comparten al menos un nombre o apellido (sin tildes ni mayúsculas, tolerando una letra mal). Si alguno de los dos no tiene
 * nombre que comparar, no se puede decir que sean distintos.
 */
export function mismaPersona(a: string, b: string): boolean {
  const A = tokensDeNombre(a), B = tokensDeNombre(b);
  if (!A.length || !B.length) return true;
  return A.some((x) => B.some((y) => x === y || (x.length >= 5 && y.length >= 5 && aLoSumoUnaLetra(x, y))));
}

const mismoCelular = (a: string, b: string) => { const x = normalizarCelular(a), y = normalizarCelular(b); return x != null && x === y; };

// ---------- Unidades ----------
interface UnidadDb {
  id: number;
  codigo: string;
  estructura_id: number | null;
  estado: string | null;
  propietario: UsuarioDb | null;
  inquilino: UsuarioDb | null;
}

const SELECT_USUARIO = { id: true, nombre: true, email: true, telefono: true, rol: true, empresa_id: true, complejo_id: true, password_hash: true } as const;

type Resolucion = { unidad: UnidadDb } | { error: string };

function resolverUnidad(f: FilaContacto, estructuras: { id: number; nombre: string | null }[], unidades: UnidadDb[]): Resolucion {
  const activas = unidades.filter((u) => u.estado === 'activa');
  let candidatas = activas;
  let todas = unidades;
  if (estructuras.length) {
    if (!f.block) return { error: 'Falta el block' };
    const numero = numeroDeTorre(f.block);
    let est: { id: number; nombre: string | null } | undefined;
    if (numero != null) {
      const r = buscarEstructura(estructuras, numero);
      if (r.motivo === 'varias') return { error: `Hay varios blocks que coinciden con «${f.block}»` };
      est = r.estructura;
    } else {
      const igual = estructuras.filter((e) => normalizarEncabezado(e.nombre) === normalizarEncabezado(f.block));
      if (igual.length > 1) return { error: `Hay varios blocks que coinciden con «${f.block}»` };
      est = igual[0];
    }
    if (!est) return { error: `El condominio no tiene el block «${f.block}»` };
    candidatas = activas.filter((u) => u.estructura_id === est!.id);
    todas = unidades.filter((u) => u.estructura_id === est!.id);
  }
  if (!f.dpto) return { error: 'Falta el departamento' };
  const coinciden = candidatas.filter((u) => codigoEncajaConDpto(u.codigo, f.dpto));
  if (coinciden.length === 1) return { unidad: coinciden[0]! };
  if (coinciden.length > 1) return { error: `Hay varias unidades que coinciden con el departamento «${f.dpto}»` };
  if (todas.some((u) => u.estado !== 'activa' && codigoEncajaConDpto(u.codigo, f.dpto))) return { error: `El departamento «${f.dpto}» existe pero no está activo` };
  return { error: `El departamento «${f.dpto}» no existe en el condominio` };
}

const MENSAJE_CUENTA_AJENA = 'Ese correo ya está en uso por una cuenta que no se puede vincular a este condominio';
const rotulo = (p: Persona) => (p === 'propietario' ? 'propietario' : 'inquilino');

interface Pedido {
  fila: number;
  unidad: UnidadDb;
  persona: Persona;
  datos: DatosPersona;
}

const tieneDatos = (d: DatosPersona) => !!(d.nombre || d.correo || d.celular);

export interface OpcionesPlan {
  complejoId: number;
  /** Empresa del condominio (null si no tiene). */
  empresaId: number | null;
  actualizar: boolean;
  /** Reloj para saber qué invitaciones siguen vigentes. */
  ahora: Date;
}

/** Calcula el plan. SÓLO LEE (recibe el cliente de una transacción para ver todo en un mismo instante). */
export async function planificarContactos(tx: Tx, filas: FilaContacto[], opts: OpcionesPlan): Promise<PlanContactos> {
  const { complejoId, empresaId, actualizar } = opts;
  const problemas: Problema[] = [];
  const filasConError = new Set<number>();
  const filasConAviso = new Set<number>();
  const marcar = (p: Problema) => { problemas.push(p); (p.nivel === 'error' ? filasConError : filasConAviso).add(p.fila); };

  const estructuras = await tx.estructura.findMany({ where: { complejo_id: complejoId }, select: { id: true, nombre: true } });
  const unidades = (await tx.unidad.findMany({
    where: { complejo_id: complejoId },
    select: { id: true, codigo: true, estructura_id: true, estado: true, propietario: { select: SELECT_USUARIO }, inquilino: { select: SELECT_USUARIO } },
  })) as UnidadDb[];

  // 1.º: cada fila con su unidad y sus personas.
  const pedidos: Pedido[] = [];
  const vistas = new Map<number, number>(); // unidad → fila donde apareció
  const orden = new Map<number, { n: number; d: string }>();
  for (const f of filas) {
    const r = resolverUnidad(f, estructuras, unidades);
    if ('error' in r) { marcar({ fila: f.fila, unidad: null, persona: null, nivel: 'error', mensaje: r.error }); continue; }
    const u = r.unidad;
    if (vistas.has(u.id)) { marcar({ fila: f.fila, unidad: u.codigo, persona: null, nivel: 'error', mensaje: `El departamento está repetido en el Excel (también en la fila ${vistas.get(u.id)})` }); continue; }
    vistas.set(u.id, f.fila);
    orden.set(u.id, { n: numeroDeTorre(f.block) ?? Number.MAX_SAFE_INTEGER, d: f.dpto });
    for (const persona of ['propietario', 'inquilino'] as const) {
      const datos = f[persona];
      for (const e of datos.errores) marcar({ fila: f.fila, unidad: u.codigo, persona, nivel: 'error', mensaje: `${persona === 'propietario' ? 'Propietario' : 'Inquilino'}: ${e}` });
      if (datos.errores.length) continue;
      if (tieneDatos(datos)) pedidos.push({ fila: f.fila, unidad: u, persona, datos });
    }
  }
  // Orden estable: por block y departamento (como la plantilla), propietario antes que inquilino.
  const posicion = (p: Pedido) => orden.get(p.unidad.id)!;
  pedidos.sort((a, b) => posicion(a).n - posicion(b).n || posicion(a).d.localeCompare(posicion(b).d, 'es', { numeric: true }) || a.fila - b.fila || (a.persona === b.persona ? 0 : a.persona === 'propietario' ? -1 : 1));

  // 2.º: las cuentas que ya tienen alguno de los correos del Excel, y con quién están vinculadas.
  const correos = [...new Set(pedidos.map((p) => p.datos.correo).filter(Boolean))];
  const existentes = correos.length ? ((await tx.usuario.findMany({ where: { email: { in: correos } }, select: SELECT_USUARIO })) as UsuarioDb[]) : [];
  const ajenos = new Set<string>(); // correos de cuentas que no se pueden vincular
  if (existentes.length) {
    const ids = existentes.map((e) => e.id);
    const unidadesDe = await tx.unidad.findMany({
      where: { OR: [{ propietario_id: { in: ids } }, { inquilino_id: { in: ids } }] },
      select: { propietario_id: true, inquilino_id: true, complejo_id: true, empresa_id: true, complejo: { select: { empresa_id: true } } },
    });
    const complejosDeUsuario = await tx.complejoHabitacional.findMany({ where: { id: { in: existentes.flatMap((e) => (e.complejo_id == null ? [] : [e.complejo_id])) } }, select: { id: true, empresa_id: true } });
    const empresaDeComplejo = new Map(complejosDeUsuario.map((c) => [c.id, c.empresa_id]));
    for (const q of existentes) {
      // Cada vínculo es (empresa, condominio). Sin empresa en el condominio, vale que todos los vínculos sean con ESTE condominio.
      const vinculos: { empresa: number | null; complejo: number | null }[] = [];
      for (const u of unidadesDe) if (u.propietario_id === q.id || u.inquilino_id === q.id) vinculos.push({ empresa: u.complejo?.empresa_id ?? u.empresa_id, complejo: u.complejo_id });
      if (q.complejo_id != null) vinculos.push({ empresa: empresaDeComplejo.get(q.complejo_id) ?? null, complejo: q.complejo_id });
      const propio = (v: { empresa: number | null; complejo: number | null }) => (empresaId != null ? v.empresa === empresaId : v.complejo === complejoId);
      const ok = esResidente(q.rol) && (q.empresa_id == null || q.empresa_id === empresaId) && vinculos.length > 0 && vinculos.every(propio);
      if (!ok) ajenos.add(q.email.toLowerCase());
    }
  }
  const porCorreoDb = new Map(existentes.map((e) => [e.email.toLowerCase(), e]));

  // 3.º: las personas, una por una, sobre un estado virtual.
  const virtuales = new Map<number, UsuarioVirtual>(); // por id de la base
  const nuevas: UsuarioVirtual[] = [];
  const tocadas = new Set<UsuarioVirtual>();
  const conCorreoFila = new Set<UsuarioVirtual>(); // personas de las filas que traen correo y quedan con uno real (a ellas va la invitación)
  const desdeDb = (q: UsuarioDb, unidadInicial: number): UsuarioVirtual => {
    let v = virtuales.get(q.id);
    if (!v) {
      v = { id: q.id, clave: `u${q.id}`, nombre: q.nombre, rol: q.rol as Persona, email: q.email.toLowerCase(), telefono: q.telefono ?? '', email0: q.email.toLowerCase(), telefono0: q.telefono ?? '', tieneClave: q.password_hash != null, complejo_id: q.complejo_id, correoPuesto: false, celularPuesto: false, sinCorreo: false, unidadInicial };
      virtuales.set(q.id, v);
    }
    return v;
  };
  const porCorreo = new Map<string, UsuarioVirtual>(); // correo → quien lo tendrá
  const asignaciones = new Map<string, Asignacion>();
  const nuevoVirtual = (p: Pedido): UsuarioVirtual => {
    const v: UsuarioVirtual = { id: null, clave: `n${nuevas.length}`, nombre: p.datos.nombre, rol: p.persona, email: '', telefono: '', email0: '', telefono0: '', tieneClave: false, complejo_id: complejoId, correoPuesto: false, celularPuesto: false, sinCorreo: true, unidadInicial: p.unidad.id };
    nuevas.push(v);
    return v;
  };
  const r = { correos_nuevos: 0, correos_cambiados: 0, celulares_nuevos: 0, celulares_cambiados: 0, propietarios_nuevos: 0, inquilinos_nuevos: 0, unidades_unidas: 0, cambian_quien_paga: 0 };

  for (const p of pedidos) {
    const { unidad, persona, datos } = p;
    const campo: Campo = persona === 'propietario' ? 'propietario_id' : 'inquilino_id';
    const actualDb = persona === 'propietario' ? unidad.propietario : unidad.inquilino;
    const aviso = (mensaje: string) => marcar({ fila: p.fila, unidad: unidad.codigo, persona, nivel: 'aviso', mensaje });
    const error = (mensaje: string) => marcar({ fila: p.fila, unidad: unidad.codigo, persona, nivel: 'error', mensaje });
    const etiqueta = persona === 'propietario' ? 'Propietario' : 'Inquilino';

    // La persona que tiene hoy la unidad. Sólo se toca a un residente.
    let actual: UsuarioVirtual | null = null;
    if (actualDb) {
      if (!esResidente(actualDb.rol)) { error(`${etiqueta}: la persona registrada no es un residente; no se puede cargar su contacto desde aquí`); continue; }
      if (actualDb.rol !== persona) { error(`${etiqueta}: la persona registrada en esta unidad es ${actualDb.rol}, no ${rotulo(persona)}`); continue; }
      actual = desdeDb(actualDb, unidad.id);
      if (datos.nombre && !mismaPersona(datos.nombre, actual.nombre)) {
        aviso(`${etiqueta}: el nombre del Excel («${datos.nombre}») no se parece al registrado («${actual.nombre}»); no se cargó su contacto. Los nombres no se cambian desde aquí`);
        continue;
      }
    } else if (!datos.nombre) {
      error(`${etiqueta}: falta el nombre; sin él no se puede crear a la persona`);
      continue;
    }
    const nombreFila = datos.nombre || actual?.nombre || '';

    // Correo.
    let destino: UsuarioVirtual | null = actual; // la persona que queda a cargo de la unidad
    let correoNuevoDe: UsuarioVirtual | null = null; // a quién se le pone el correo (si hay que ponerlo)
    let creaNueva = false;
    const E = datos.correo;
    if (E) {
      if (ajenos.has(E)) { error(`${etiqueta}: ${MENSAJE_CUENTA_AJENA}`); continue; }
      let dueno = porCorreo.get(E) ?? null;
      if (!dueno) {
        const q = porCorreoDb.get(E);
        if (q) { dueno = desdeDb(q, unidad.id); porCorreo.set(E, dueno); }
      }
      if (dueno) {
        if (dueno.rol !== persona) { error(`${etiqueta}: ese correo ya es de ${dueno.rol === 'inquilino' ? 'un inquilino' : 'un propietario'}; una misma cuenta no puede ser las dos cosas`); continue; }
        if (!mismaPersona(nombreFila, dueno.nombre)) { error(`${etiqueta}: el mismo correo aparece para personas distintas («${nombreFila}» y «${dueno.nombre}»)`); continue; }
        if (actual && actual !== dueno) {
          if (tieneCorreoReal(actual.email)) {
            if (!actualizar) { aviso(`${etiqueta}: ya tiene otro correo cargado y ese correo es de otra persona; no se cambió`); continue; }
            error(`${etiqueta}: ese correo ya es de otra persona de la lista; no se puede pasar este departamento a ella`);
            continue;
          }
          // La persona de relleno se junta con la que ya tiene ese correo: el departamento pasa a ella (la de relleno queda sin departamento, con todo su historial).
          destino = dueno;
        } else if (!actual) destino = dueno;
      } else if (!actual) {
        creaNueva = true;
      } else if (!tieneCorreoReal(actual.email)) {
        correoNuevoDe = actual;
      } else if (actual.email !== E) {
        if (!actualizar) { aviso(`${etiqueta}: ya tiene el correo cargado y no se cambió (marca «actualizar los datos ya cargados» para cambiarlo)`); }
        else correoNuevoDe = actual;
      }
    } else if (!actual) {
      creaNueva = true; // sin correo: se crea con el de relleno
    }

    if (creaNueva) destino = nuevoVirtual(p);
    if (!destino) continue;

    // Aplica el correo.
    if (E && (correoNuevoDe ?? (creaNueva ? destino : null))) {
      const v = (correoNuevoDe ?? destino)!;
      const cambia = tieneCorreoReal(v.email0);
      if (v.id != null && v.email0) { porCorreo.delete(v.email0); porCorreoDb.delete(v.email0); }
      v.email = E;
      v.sinCorreo = false;
      v.correoPuesto = true;
      porCorreo.set(E, v);
      tocadas.add(v);
      if (v.id == null || !cambia) r.correos_nuevos++; else r.correos_cambiados++;
    }
    // Aplica el celular a quien queda a cargo.
    if (datos.celular) {
      if (!destino.telefono) { destino.telefono = datos.celular; destino.celularPuesto = true; tocadas.add(destino); r.celulares_nuevos++; }
      else if (mismoCelular(destino.telefono, datos.celular)) { /* ya está */ }
      else if (actualizar) { destino.telefono = datos.celular; destino.celularPuesto = true; tocadas.add(destino); r.celulares_cambiados++; }
      else aviso(`${etiqueta}: ya tiene otro celular cargado y no se cambió (marca «actualizar los datos ya cargados» para cambiarlo)`);
    }

    if (E && tieneCorreoReal(destino.email)) conCorreoFila.add(destino);

    // La unidad.
    const antes = actualDb?.id ?? null;
    if (destino.id !== antes || destino.id == null) {
      asignaciones.set(`${unidad.id}:${campo}`, { unidadId: unidad.id, campo, antes, despues: destino });
      if (destino.id == null) { if (persona === 'propietario') r.propietarios_nuevos++; else r.inquilinos_nuevos++; }
      else if (antes != null) r.unidades_unidas++;
      if (persona === 'inquilino' && antes == null) r.cambian_quien_paga++;
      tocadas.add(destino);
    }
  }

  // Una persona nueva sin correo ni celular cargado nunca debió llegar aquí con datos vacíos, pero si sólo trae nombre se crea igual (con correo de relleno).
  const usuarios = [...new Set([...virtuales.values(), ...nuevas])].filter((v) => tocadas.has(v) || v.id == null);
  const conCorreo = [...conCorreoFila];
  const resumen: ResumenContactos = {
    filas: filas.length,
    filas_con_error: filasConError.size,
    filas_con_aviso: filasConAviso.size,
    ...r,
    invitables: 0,
  };
  return { resumen, problemas, usuarios, asignaciones: [...asignaciones.values()], conCorreo };
}
