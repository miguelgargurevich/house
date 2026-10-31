// Reservas de áreas comunes: pruebas de la UI sin navegador. Funciones puras (horas libres, zona del condominio, textos), fuente de las pantallas
// (regex sobre el .tsx: celular, modo claro/oscuro, solo lectura, confirmaciones) y menú/rutas de cada rol.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { NAV, navPara } from '../src/app/nav';
import { RUTAS_POR_ROL, rutaPermitida } from '../src/server/lib/rutasApp';
import {
  ESTADO_LABEL, ESTADO_TONO, cuandoDe, diaLargo, esVigente, finesPosibles, hhmmDe, hoyEn, iniciosLibres, minutosAhoraEn, minutosDe, puedeCancelarVecino, reglasDe, sumarDias,
} from '../src/pages/shared/_parts/reservas/tipos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const ADMIN = 'src/pages/admin/_parts/reservas/';
const RES = 'src/pages/residente/_parts/reservas/';
const SHARED = 'src/pages/shared/_parts/reservas/';
const app = f('src/App.tsx');
const bloque = (apertura: string) => {
  const i = app.indexOf(apertura);
  assert.ok(i >= 0, `no está ${apertura}`);
  return app.slice(i, app.indexOf('</Route>', i));
};
const items = (rol: 'admin' | 'superadmin' | 'propietario' | 'inquilino' | 'seguridad' | 'mantenimiento') => NAV[rol].flatMap((g) => g.items.map((i) => i.to));
const ARCHIVOS = [`${ADMIN}PaginaAreasComunes.tsx`, `${ADMIN}ReservasTab.tsx`, `${ADMIN}AreasTab.tsx`, `${ADMIN}AreaModal.tsx`, `${ADMIN}MotivoModal.tsx`, `${RES}ReservasResidente.tsx`, `${RES}NuevaReserva.tsx`, `${RES}MisReservas.tsx`, `${RES}LineaDelDia.tsx`, `${SHARED}EstadoReservaBadge.tsx`, 'src/pages/admin/AreasComunes.tsx', 'src/pages/residente/Reservas.tsx'];

const area = { hora_apertura: '08:00', hora_cierre: '12:00', duracion_max_horas: 2 };

describe('horas libres: lo que ofrece el selector del vecino', () => {
  it('casillas de 30 min dentro del horario, sin pisar lo ocupado', () => {
    assert.deepEqual(iniciosLibres(area, []), ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30']);
    assert.deepEqual(iniciosLibres(area, [{ hora_inicio: '09:00', hora_fin: '10:30' }]), ['08:00', '08:30', '10:30', '11:00', '11:30']);
    assert.deepEqual(iniciosLibres(area, [{ hora_inicio: '08:00', hora_fin: '12:00' }]), [], 'todo ocupado');
  });

  it('hoy no se ofrece lo que ya pasó (`minimo`)', () => {
    assert.deepEqual(iniciosLibres(area, [], 10 * 60), ['10:00', '10:30', '11:00', '11:30']);
    assert.deepEqual(iniciosLibres(area, [], 11 * 60 + 45), []);
  });

  it('un área que cierra a las 24:00 ofrece hasta las 23:30', () => {
    const noche = iniciosLibres({ hora_apertura: '22:00', hora_cierre: '24:00' }, []);
    assert.deepEqual(noche, ['22:00', '22:30', '23:00', '23:30']);
  });

  it('el fin llega hasta la duración máxima, el cierre o el siguiente bloque ocupado (lo que ocurra primero)', () => {
    assert.deepEqual(finesPosibles(area, [], '08:00'), ['08:30', '09:00', '09:30', '10:00'], 'máx. 2 h');
    assert.deepEqual(finesPosibles(area, [], '11:00'), ['11:30', '12:00'], 'el cierre');
    assert.deepEqual(finesPosibles(area, [{ hora_inicio: '09:30', hora_fin: '11:00' }], '08:00'), ['08:30', '09:00', '09:30'], 'el siguiente bloque');
    assert.deepEqual(finesPosibles({ hora_cierre: '24:00', duracion_max_horas: 1 }, [], '23:00'), ['23:30', '24:00']);
  });

  it('minutos ↔ HH:MM', () => {
    assert.equal(minutosDe('24:00'), 1440);
    assert.equal(hhmmDe(570), '09:30');
    assert.equal(hhmmDe(1440), '24:00');
  });
});

describe('día y hora: siempre los de la zona del CONDOMINIO, no los del celular', () => {
  it('«hoy» y la hora actual salen de la zona pedida', () => {
    const ahora = new Date('2026-11-05T03:30:00Z'); // 22:30 del 4-nov en Lima; 12:30 del 5-nov en Tokio
    assert.equal(hoyEn('America/Lima', ahora), '2026-11-04');
    assert.equal(hoyEn('Asia/Tokyo', ahora), '2026-11-05');
    assert.equal(minutosAhoraEn('America/Lima', ahora), 22 * 60 + 30);
    assert.equal(minutosAhoraEn('Asia/Tokyo', ahora), 12 * 60 + 30);
  });

  it('sumar días respeta fin de mes y de año', () => {
    assert.equal(sumarDias('2026-12-30', 3), '2027-01-02');
    assert.equal(sumarDias('2026-02-27', 2), '2026-03-01');
  });

  it('textos: día corto en español, «cuándo» y reglas del área', () => {
    assert.match(diaLargo('2026-11-05'), /5/);
    assert.match(diaLargo('2026-11-05'), /nov/i);
    assert.match(diaLargo('2026-11-05'), /jue/i, 'el 5-nov-2026 es jueves');
    assert.equal(cuandoDe({ dia: '2026-11-05', hora_inicio: '10:00', hora_fin: '12:00' }), `${diaLargo('2026-11-05')} · 10:00–12:00`);
    assert.equal(reglasDe({ hora_apertura: '08:00', hora_cierre: '22:00', duracion_max_horas: 4, dias_anticipacion_max: 30, requiere_aprobacion: true }), 'De 08:00 a 22:00 · hasta 4 horas seguidas · con hasta 30 días de anticipación · la administración debe aprobarla');
    assert.match(reglasDe({ hora_apertura: '08:00', hora_cierre: '22:00', duracion_max_horas: 1, dias_anticipacion_max: 1, requiere_aprobacion: false }), /hasta 1 hora seguida · con hasta 1 día de anticipación · se confirma al instante/);
  });

  it('cada estado tiene su palabra y su tono (rechazada en rojo, pendiente en ámbar…)', () => {
    assert.deepEqual(ESTADO_LABEL, { pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada', cancelada: 'Cancelada' });
    assert.deepEqual(ESTADO_TONO, { pendiente: 'warn', aprobada: 'ok', rechazada: 'bad', cancelada: 'neutral' });
  });

  it('quién puede cancelar: el vecino sólo lo que aún no empezó; la administración, lo que aún no terminó', () => {
    const ahora = new Date('2026-11-05T12:00:00Z');
    const r = (estado: 'pendiente' | 'aprobada' | 'rechazada' | 'cancelada', inicio: string, fin: string) => ({ estado, inicio, fin });
    assert.equal(puedeCancelarVecino(r('aprobada', '2026-11-05T13:00:00Z', '2026-11-05T14:00:00Z'), ahora), true);
    assert.equal(puedeCancelarVecino(r('pendiente', '2026-11-05T13:00:00Z', '2026-11-05T14:00:00Z'), ahora), true);
    assert.equal(puedeCancelarVecino(r('aprobada', '2026-11-05T11:00:00Z', '2026-11-05T14:00:00Z'), ahora), false, 'ya empezó');
    assert.equal(puedeCancelarVecino(r('cancelada', '2026-11-06T13:00:00Z', '2026-11-06T14:00:00Z'), ahora), false);
    assert.equal(puedeCancelarVecino(r('rechazada', '2026-11-06T13:00:00Z', '2026-11-06T14:00:00Z'), ahora), false);
    assert.equal(esVigente(r('aprobada', '2026-11-05T11:00:00Z', '2026-11-05T14:00:00Z'), ahora), true, 'en curso: la administración aún puede cortarla');
    assert.equal(esVigente(r('aprobada', '2026-11-05T09:00:00Z', '2026-11-05T11:00:00Z'), ahora), false, 'ya terminó');
    assert.equal(esVigente(r('rechazada', '2026-11-06T09:00:00Z', '2026-11-06T11:00:00Z'), ahora), false);
  });
});

describe('reservas: menú y rutas', () => {
  it('la administración (y el superadmin) tienen «Áreas comunes» en Operación; los residentes, «Reservas» con la ruta de su rol; el personal, nada', () => {
    for (const rol of ['admin', 'superadmin'] as const) assert.ok(items(rol).includes('/admin/areas-comunes'), rol);
    const oper = NAV.admin.find((g) => g.label === 'Operación')!;
    assert.ok(oper.items.some((i) => i.to === '/admin/areas-comunes' && i.label === 'Áreas comunes'));
    assert.ok(items('propietario').includes('/propietario/reservas') && !items('propietario').includes('/inquilino/reservas'));
    assert.ok(items('inquilino').includes('/inquilino/reservas') && !items('inquilino').includes('/propietario/reservas'));
    for (const rol of ['seguridad', 'mantenimiento'] as const) assert.ok(!items(rol).some((r) => /reservas|areas-comunes/.test(r)), rol);
    for (const rol of ['propietario', 'inquilino'] as const) assert.equal(NAV[rol].flatMap((g) => g.items).find((i) => /reservas/.test(i.to))?.label, 'Reservas');
  });

  it('una junta (propietario con cargo) sigue viendo «Reservas» como vecino', () => {
    const junta = navPara({ rol: 'propietario', cargo_junta: 'presidente', complejo_id: 1, estructura_id: 1 }).flatMap((g) => g.items.map((i) => i.to));
    assert.ok(junta.includes('/propietario/reservas'));
  });

  it('App.tsx: la de la administración va dentro de su guarda con condominio; las de los residentes, cada una en la de su rol', () => {
    assert.match(bloque('<Route element={<RequireRole roles={[\'superadmin\',\'admin\']} />}>'), /path="\/admin\/areas-comunes" element=\{<AdminAreasComunes \/>\}/);
    assert.match(bloque('<Route element={<RequireRole roles={[\'propietario\']} />}>'), /path="\/propietario\/reservas" element=\{<ResidenteReservas \/>\}/);
    assert.match(bloque('<Route element={<RequireRole roles={[\'inquilino\']} />}>'), /path="\/inquilino\/reservas" element=\{<ResidenteReservas \/>\}/);
    assert.match(app, /const AdminAreasComunes = lazy\(\(\) => import\('\.\/pages\/admin\/AreasComunes'\)\)/);
    assert.match(app, /const ResidenteReservas = lazy\(\(\) => import\('\.\/pages\/residente\/Reservas'\)\)/);
  });

  it('el asistente conoce las rutas (rutasApp) y cada rol sólo las suyas', () => {
    assert.ok(RUTAS_POR_ROL.admin.includes('/admin/areas-comunes') && RUTAS_POR_ROL.superadmin.includes('/admin/areas-comunes'));
    assert.ok(RUTAS_POR_ROL.propietario.includes('/propietario/reservas') && !RUTAS_POR_ROL.propietario.includes('/inquilino/reservas'));
    assert.ok(RUTAS_POR_ROL.inquilino.includes('/inquilino/reservas'));
    const u = (rol: 'admin' | 'propietario' | 'inquilino') => ({ rol, cargo_junta: null, complejo_id: null, estructura_id: null, id: 1, email: 'x', empresa_id: null });
    assert.equal(rutaPermitida(u('propietario'), '/propietario/reservas/'), '/propietario/reservas');
    assert.equal(rutaPermitida(u('propietario'), '/admin/areas-comunes'), null);
    assert.equal(rutaPermitida(u('inquilino'), '/propietario/reservas'), null);
    assert.equal(rutaPermitida(u('admin'), '/admin/areas-comunes'), '/admin/areas-comunes');
  });

  it('los envoltorios de página existen y apuntan a su pantalla', () => {
    assert.match(f('src/pages/admin/AreasComunes.tsx'), /<PaginaAreasComunes \/>/);
    assert.match(f('src/pages/residente/Reservas.tsx'), /<ReservasResidente \/>/);
  });
});

describe('reservas: pantallas (fuente)', () => {
  it('ningún archivo inyecta HTML ni usa colores fijos: sólo los del tema (modo claro y oscuro)', () => {
    for (const a of ARCHIVOS) {
      const s = f(a);
      assert.doesNotMatch(s, /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/, a);
      assert.doesNotMatch(s, /\b(?:bg|text|border|ring)-(?:white|black|gray|slate|zinc|neutral|red|green|blue|amber|yellow)\b/, `${a}: color fijo de Tailwind`);
      assert.doesNotMatch(s, /#[0-9a-fA-F]{3,8}\b|rgba?\(|oklch\(/, `${a}: color fijo`);
      assert.doesNotMatch(s, /\bHouse\b/, `${a}: la marca es Torre`);
    }
  });

  it('toda acción que escribe (reservar, aprobar, rechazar, cancelar, crear/editar/desactivar área) va en <Bloqueable>: con solo lectura se desactiva', () => {
    const reservar = f(`${RES}NuevaReserva.tsx`);
    assert.match(reservar, /<Bloqueable>\{b => <Button[^\n]*disabled=\{!listo \|\| b\}[^\n]*>/);
    const mis = f(`${RES}MisReservas.tsx`);
    assert.match(mis, /<Bloqueable>\{b => <Button[^\n]*disabled=\{b\}[^\n]*>Cancelar reserva<\/Button>\}<\/Bloqueable>/);
    const tab = f(`${ADMIN}ReservasTab.tsx`);
    for (const verbo of ['Aprobar', 'Rechazar', 'Cancelar']) assert.match(tab, new RegExp(`<Bloqueable>\\{b => <IconButton label=\\{\`${verbo} la reserva[^\\n]*disabled=\\{b`), verbo);
    const areas = f(`${ADMIN}AreasTab.tsx`);
    assert.match(areas, /<Bloqueable>\{b => <Button[^\n]*disabled=\{!puedeCrear \|\| b\}[^\n]*>Nueva área/);
    assert.match(areas, /<Bloqueable>\{b => <IconButton label=\{`Editar/);
    assert.match(areas, /<Bloqueable>\{b => <IconButton label=\{a\.activa \? `Desactivar/);
  });

  it('lo destructivo pide confirmación: cancelar del vecino y desactivar un área (ConfirmDialog), rechazar y cancelar de la administración (motivo)', () => {
    assert.match(f(`${RES}MisReservas.tsx`), /<ConfirmDialog[\s\S]*danger[\s\S]*confirmLabel="Cancelar reserva"/);
    assert.match(f(`${ADMIN}AreasTab.tsx`), /<ConfirmDialog[\s\S]*danger[\s\S]*confirmLabel="Desactivar"/);
    const tab = f(`${ADMIN}ReservasTab.tsx`);
    assert.match(tab, /obligatorio=\{accion\?\.tipo === 'rechazar'\}/, 'rechazar exige motivo; cancelar no');
    assert.match(f(`${ADMIN}MotivoModal.tsx`), /validate: v => !obligatorio \|\| !!v\.trim\(\)/);
  });

  it('el celular (390 px): nada se desborda — textos largos se parten, listas se apilan y las tablas ocultan columnas', () => {
    const mis = f(`${RES}MisReservas.tsx`);
    assert.match(mis, /flex flex-col gap-2[^"]*sm:flex-row/, 'cada reserva se apila y en pantallas grandes va en fila');
    assert.match(mis, /className="min-w-0"/);
    assert.match(mis, /break-words/);
    assert.match(f(`${RES}ReservasResidente.tsx`), /grid items-start gap-4 lg:grid-cols-2/, 'una columna en celular');
    assert.match(f(`${RES}ReservasResidente.tsx`), /min-w-0/);
    assert.match(f(`${RES}NuevaReserva.tsx`), /grid gap-4 sm:grid-cols-2/);
    assert.match(f(`${RES}NuevaReserva.tsx`), /break-words/);
    const tab = f(`${ADMIN}ReservasTab.tsx`);
    assert.match(tab, /hideBelow: 'sm'/);
    assert.match(tab, /sm:hidden/, 'la fecha se repite dentro de la primera columna cuando la columna de fecha se oculta');
    assert.match(tab, /grid w-full gap-3 sm:grid-cols-2 lg:grid-cols-4/);
    assert.match(f(`${ADMIN}AreasTab.tsx`), /hideBelow: 'md'/);
    assert.match(f(`${ADMIN}AreaModal.tsx`), /grid gap-4 sm:grid-cols-2/);
    assert.match(f(`${ADMIN}PaginaAreasComunes.tsx`), /grid gap-3 sm:grid-cols-2 lg:grid-cols-3/);
  });

  it('la línea del día: la barra es visual (aria-hidden) y lo ocupado también está en texto; usa tokens del tema', () => {
    const s = f(`${RES}LineaDelDia.tsx`);
    assert.match(s, /aria-hidden="true">\s*\{ocupados\.map/);
    assert.match(s, /<ul[^>]*aria-label="Horarios ocupados"/);
    assert.match(s, /Todo el día está libre/);
    for (const token of ['bg-ok-soft', 'bg-brand', 'bg-warn', 'bg-bad', 'border-line']) assert.ok(s.includes(token), token);
  });

  it('el vecino ve horas y días de la zona del condominio (hoyEn con la zona del área), no los del celular', () => {
    const s = f(`${RES}NuevaReserva.tsx`);
    assert.match(s, /hoyEn\(area\.zona_horaria\)/);
    assert.match(s, /minutosAhoraEn\(area\.zona_horaria\)/);
    assert.doesNotMatch(s, /new Date\(\)\.toISOString\(\)|toLocaleDateString|getHours\(\)/);
    assert.match(s, /min=\{hoy \|\| undefined\} max=\{ultimo \|\| undefined\}/, 'el selector de día se acota a hoy…hoy+anticipación');
  });

  it('el pedido manda día y horas de pared (la API los lee en la zona del condominio) y avisa si queda pendiente', () => {
    const s = f(`${RES}NuevaReserva.tsx`);
    assert.match(s, /json: \{ area_id: area\.id, unidad_id: Number\(unidadId\), dia, hora_inicio: inicio, hora_fin: fin \}/);
    assert.match(s, /Pedido enviado: la administración debe aprobarlo/);
    assert.match(s, /void disp\.reload\(\)/, 'tras reservar (o fallar por cruce) se vuelve a pedir la disponibilidad');
  });

  it('las pantallas llaman a rutas que la API tiene', () => {
    const usadas = new Set<string>();
    for (const a of ARCHIVOS) for (const m of f(a).matchAll(/['`](\/api\/(?:areas-comunes|reservas|me\/unidades)[^'`$]*)/g)) usadas.add(m[1]!.replace(/\/$/, ''));
    assert.ok(usadas.has('/api/reservas') && usadas.has('/api/areas-comunes') && usadas.has('/api/me/unidades'));
    const rutas = f('src/server/app.ts');
    assert.match(rutas, /api\.use\('\/areas-comunes', areasComunesRouter\)/);
    assert.match(rutas, /api\.use\('\/reservas', reservasRouter\)/);
  });

  it('el contrato de la API documenta lo agregado', () => {
    const doc = f('docs/API-CONTRATO.md');
    for (const t of ['/api/areas-comunes', '/api/areas-comunes/:id/disponibilidad', '/api/reservas', '/api/reservas/:id/aprobar', '/api/reservas/:id/rechazar', '/api/reservas/:id/cancelar', 'SOLO_LECTURA']) assert.ok(doc.includes(t), t);
  });
});
