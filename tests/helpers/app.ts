import './env';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcrypt';
import { createApp, type AppOptions } from '../../src/server/app';
import { prisma } from '../../src/server/db';
import { hoyLima } from '../../src/server/lib/fechas';
import { sembrarCatalogoComercial } from '../../src/server/services/comercial/catalogo';
import { comercialDeps, invalidarComercial } from '../../src/server/services/comercial/modulos';

// Sin caché en las pruebas: las filas se escriben directo en la base y los ids se reinician en cada `vaciarBase`.
comercialDeps.ttlMs = 0;

export { prisma };
export const PASSWORD = 'Passw0rd!123';

export async function iniciar(opts: AppOptions = {}) {
  const server = createApp(opts).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, cerrar: () => new Promise<void>((r) => server.close(() => r())) };
}

export interface Respuesta {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  texto: string;
  headers: Headers;
}

/** «Sesión» de prueba: `<valor de la cookie>.<token CSRF>` (ambos son base64url, sin puntos). `llamar` la convierte en cookie + X-CSRF-Token. */
export const credenciales = (cookie: string, csrf: string) => `${cookie}.${csrf}`;
const separar = (t: string) => {
  const i = t.indexOf('.');
  return i < 0 ? { cookie: t, csrf: '' } : { cookie: t.slice(0, i), csrf: t.slice(i + 1) };
};

/** Cabeceras (cookie + CSRF) de una sesión de `login()`, para peticiones crudas que `llamar` no cubre (cuerpos binarios). */
export function cabecerasDeSesion(token?: string | null): Record<string, string> {
  if (!token) return {};
  const s = separar(token);
  return { cookie: `house_sesion=${s.cookie}`, ...(s.csrf ? { 'x-csrf-token': s.csrf } : {}) };
}

/** `token` es lo que devuelve `login()`; `headers` puede pisar la cookie o el CSRF para probar fallos. */
export async function llamar(base: string, metodo: string, ruta: string, token?: string | null, cuerpo?: unknown, headers: Record<string, string> = {}): Promise<Respuesta> {
  const s = token ? separar(token) : null;
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: {
      ...(cuerpo !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(s ? { cookie: `house_sesion=${s.cookie}`, ...(s.csrf ? { 'x-csrf-token': s.csrf } : {}) } : {}),
      ...headers,
    },
    body: cuerpo === undefined ? undefined : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let body: unknown = null;
  try {
    body = JSON.parse(texto);
  } catch {
    /* no es JSON */
  }
  return { status: r.status, body, texto, headers: r.headers };
}

/** Valor de la cookie `house_sesion` en el Set-Cookie de una respuesta. */
export const cookieDe = (r: Respuesta) => /house_sesion=([^;]+)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';

export async function login(base: string, email: string, password = PASSWORD): Promise<string> {
  const r = await llamar(base, 'POST', '/api/auth/login', null, { email, password });
  if (r.status !== 200) throw new Error(`login de ${email} falló con ${r.status}`);
  return credenciales(cookieDe(r), r.body.csrf);
}

export async function vaciarBase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "PagoSuscripcion","SuscripcionCondominio","TokenVerificacionCorreo","Auditoria","EstadoIA","ClaveIntegracion","GatewayIA","DominioGatewayPermitido","ConfiguracionOcr","ConfiguracionTelegram","Pago","ReciboConceptoUnidad","ReciboConcepto","Recibo","Concepto","TareaMantenimiento","Unidad","Piso","Estructura","Usuario","ComplejoHabitacional","EmpresaAdministradora" RESTART IDENTITY CASCADE`,
  );
  // Planes, módulos y configuración (no se vacían con el resto): se dejan como el seed los crea.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "ModuloComercial","PlanComercial","ConfiguracionComercial"`);
  await sembrarCatalogoComercial(prisma);
  invalidarComercial();
}

/** Condominios en «cortesía» (todos los módulos, sin vencimiento): como están hoy los de producción. */
export async function darCortesia(...complejoIds: number[]) {
  await prisma.suscripcionCondominio.createMany({ data: complejoIds.map((complejo_id) => ({ complejo_id, plan_clave: 'cortesia', modulos: ['ia_vouchers', 'whatsapp_avisos', 'asistente'], estado: 'activa' })), skipDuplicates: true });
  invalidarComercial();
}

const DIA = 86_400_000;

/** Datos mínimos y deterministas: dos empresas, sus usuarios, unidades, cargos vencidos y pendientes. */
export async function sembrar() {
  await vaciarBase();
  const hash = await bcrypt.hash(PASSWORD, 4);
  const usuario = (nombre: string, email: string, rol: string, extra: Record<string, unknown> = {}) =>
    prisma.usuario.create({ data: { nombre, email, rol, password_hash: hash, ...extra } });

  const empresaA = await prisma.empresaAdministradora.create({ data: { nombre: 'Empresa A' } });
  const empresaB = await prisma.empresaAdministradora.create({ data: { nombre: 'Empresa B' } });
  const complejoA = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo A', tipo: 'Edificio', empresa_id: empresaA.id } });
  const complejoB = await prisma.complejoHabitacional.create({ data: { nombre: 'Complejo B', tipo: 'Edificio', empresa_id: empresaB.id } });
  await darCortesia(complejoA.id, complejoB.id);

  const superadmin = await usuario('Super', 'super@test.pe', 'superadmin');
  const adminA = await usuario('Admin A', 'admin.a@test.pe', 'admin', { empresa_id: empresaA.id });
  const adminB = await usuario('Admin B', 'admin.b@test.pe', 'admin', { empresa_id: empresaB.id });
  const adminSinEmpresa = await usuario('Admin Huérfano', 'admin.huerfano@test.pe', 'admin');
  const propietario1 = await usuario('Propietario 1', 'prop1@test.pe', 'propietario', { empresa_id: empresaA.id, complejo_id: complejoA.id });
  const propietario2 = await usuario('Propietario 2', 'prop2@test.pe', 'propietario', { empresa_id: empresaA.id, complejo_id: complejoA.id });
  const propietarioB = await usuario('Propietario B', 'propb@test.pe', 'propietario', { empresa_id: empresaB.id, complejo_id: complejoB.id });
  const inquilino1 = await usuario('Inquilino 1', 'inq1@test.pe', 'inquilino', { empresa_id: empresaA.id, complejo_id: complejoA.id });
  const mantenimientoA = await usuario('Mantenimiento A', 'mtto.a@test.pe', 'mantenimiento', { empresa_id: empresaA.id, complejo_id: complejoA.id });
  const mantenimientoA2 = await usuario('Mantenimiento A2', 'mtto.a2@test.pe', 'mantenimiento', { empresa_id: empresaA.id, complejo_id: complejoA.id });
  const seguridadA = await usuario('Seguridad A', 'seg.a@test.pe', 'seguridad', { empresa_id: empresaA.id, complejo_id: complejoA.id });

  const unidad = (codigo: string, complejo: { id: number; empresa_id: number | null }, propietario_id: number, extra: Record<string, unknown> = {}) =>
    prisma.unidad.create({ data: { codigo, tipo: 'Departamento', complejo_id: complejo.id, empresa_id: complejo.empresa_id, propietario_id, estado: 'activa', ...extra } });
  const unidadA1 = await unidad('A-101', complejoA, propietario1.id, { inquilino_id: inquilino1.id });
  const unidadA2 = await unidad('A-102', complejoA, propietario2.id);
  const unidadB1 = await unidad('B-101', complejoB, propietarioB.id);

  const conceptoA = await prisma.concepto.create({ data: { nombre: 'Mantenimiento', empresa_id: empresaA.id, tipo_monto: 'fijo' } });
  const conceptoB = await prisma.concepto.create({ data: { nombre: 'Agua B', empresa_id: empresaB.id, tipo_monto: 'fijo' } });

  // Vencimientos como fecha (00:00 UTC) relativa al día de hoy en Lima, igual que los que cargaría el frontend.
  const ahora = hoyLima().getTime();
  const recibo = (empresa_id: number, complejo_id: number, mes: number, vence: number) =>
    prisma.recibo.create({ data: { empresa_id, complejo_id, mes, anio: 2026, fecha_emision: new Date(ahora - 60 * DIA), fecha_vencimiento: new Date(vence), estado: 'emitido', descripcion: `Recibo ${mes}` } });
  const reciboVencidoA = await recibo(empresaA.id, complejoA.id, 8, ahora - 30 * DIA);
  const reciboFuturoA = await recibo(empresaA.id, complejoA.id, 10, ahora + 30 * DIA);
  const reciboB = await recibo(empresaB.id, complejoB.id, 8, ahora - 30 * DIA);

  const rc = (recibo_id: number, concepto_id: number, monto: number) => prisma.reciboConcepto.create({ data: { recibo_id, concepto_id, monto, orden: 1 } });
  const rcVencidoA = await rc(reciboVencidoA.id, conceptoA.id, 150);
  const rcFuturoA = await rc(reciboFuturoA.id, conceptoA.id, 200);
  const rcB = await rc(reciboB.id, conceptoB.id, 90);

  const cargo = (recibo_concepto_id: number, unidad_id: number, monto: number, extra: Record<string, unknown> = {}) =>
    prisma.reciboConceptoUnidad.create({ data: { recibo_concepto_id, unidad_id, monto, estado_pago: 'pendiente', ...extra } });
  const cargoVencidoA1 = await cargo(rcVencidoA.id, unidadA1.id, 150);
  const cargoFuturoA1 = await cargo(rcFuturoA.id, unidadA1.id, 200);
  const cargoA2 = await cargo(rcVencidoA.id, unidadA2.id, 150);
  const cargoB1 = await cargo(rcB.id, unidadB1.id, 90);

  const tareaA = await prisma.tareaMantenimiento.create({ data: { titulo: 'Reparar ascensor', estado: 'pendiente', unidad_id: unidadA1.id, asignado_id: mantenimientoA.id, creado_por_id: adminA.id } });
  const tareaOtra = await prisma.tareaMantenimiento.create({ data: { titulo: 'Pintar pasillo', estado: 'pendiente', unidad_id: unidadA2.id, asignado_id: mantenimientoA2.id, creado_por_id: adminA.id } });
  const tareaB = await prisma.tareaMantenimiento.create({ data: { titulo: 'Tarea de B', estado: 'pendiente', unidad_id: unidadB1.id, creado_por_id: adminB.id } });

  return {
    empresaA, empresaB, complejoA, complejoB,
    superadmin, adminA, adminB, adminSinEmpresa, propietario1, propietario2, propietarioB, inquilino1, mantenimientoA, mantenimientoA2, seguridadA,
    unidadA1, unidadA2, unidadB1, conceptoA, conceptoB, reciboVencidoA, reciboFuturoA, reciboB,
    cargoVencidoA1, cargoFuturoA1, cargoA2, cargoB1, tareaA, tareaOtra, tareaB,
  };
}
export type Datos = Awaited<ReturnType<typeof sembrar>>;

/** Espera (hasta 3 s) a que se cumpla una condición asíncrona; la auditoría se escribe tras responder. */
export async function esperar<T>(fn: () => Promise<T | null | undefined | false>, ms = 3000): Promise<T> {
  const fin = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > fin) throw new Error('Tiempo de espera agotado');
    await new Promise((r) => setTimeout(r, 25));
  }
}
