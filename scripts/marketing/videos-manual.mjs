// Videos del manual de usuario de Torre: un video corto (15–40 s) por opción del menú de cada rol, grabado con Playwright sobre la app LOCAL
// (seed de Los Libertadores; ningún dato real). Aquí vive TODO el contenido: título, voz, lo que se ve y las acciones de cada escena.
//
//  · `node scripts/marketing/grabar-video.mjs m-admin-recibos escritorio` carga este módulo (para los videos «m-…») y graba sus escenas.
//  · `node scripts/marketing/videos-manual.mjs --lista`    → docs/marketing/manual-videos.json (opción del menú → video, con duración si ya está montado)
//  · `node scripts/marketing/videos-manual.mjs --guiones`  → docs/marketing/guiones-manual.md (tablas «En pantalla | Voz»)
//  · `node scripts/marketing/videos-manual.mjs --voz`      → .claude/videos/voz-manual.json (texto de cada voz: video, escena, texto)
//  · `node scripts/marketing/videos-manual.mjs --preparar` → crea (si faltan) las tareas de prueba de mantenimiento y limpieza (datos de prueba, base LOCAL)
//  · `node scripts/marketing/videos-manual.mjs --pendientes` → imprime los videos que aún no tienen su mp4, uno por línea (`--todos`: todos los ids; `--voz-falta <id>`: escenas sin voz)
// Reglas: tuteo, neutro en género, frases cortas, sin precios; las acciones nunca envían, publican ni guardan: sólo señalan (`soloSenalar`).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Cuentas de prueba LOCALES (las del botón de desarrollo del login; nunca de producción). */
export const CUENTAS_MANUAL = {
  admin: ['ana.lopez@administradorademo.example', 'admin1234'],
  propietario: ['javier.castro@prop.example', 'prop1234'],
  inquilino: ['valentina.ruiz@inq.example', 'inq1234'],
  mantenimiento: ['maria.fernandez@administradorademo.example', 'mtto1234'],
  seguridad: ['pedro.sanchez@administradorademo.example', 'seg1234'],
  limpieza: ['limpieza@prueba.house', 'pers1234'],
  tesorero: ['patricia.alarcon.9@prueba.house', 'prop1234'], // tesorera del Block 1
  central: ['gustavo.cruz.4@prueba.house', 'prop1234'], // tesorero de la Junta central
};

const noop = async () => {};
/** Utilidades de grabación que `grabar-video.mjs` le pasa; para generar listas y guiones basta con estas vacías. */
const UTIL_NULAS = { APP: '', formato: 'escritorio', ir: noop, tocar: noop, desplazar: noop, asentar: noop, pulsar: noop, pausa: noop, octubre: noop };

/** Catálogo: id del video → { rol, titulo, descripcion, escenas: [{ rol, url, pantalla, voz, accion, antes? }] }. */
export function catalogo(u = UTIL_NULAS) {
  const { ir, tocar, desplazar, asentar, pulsar, pausa, octubre } = u;
  const senalar = (p, loc) => tocar(p, loc, { soloSenalar: true });
  const tab = (p, nombre) => pulsar(p, p.getByRole('tab', { name: nombre }));
  const btn = (p, nombre) => p.getByRole('button', { name: nombre });
  const fila = (p) => p.locator('tbody tr');
  const mirar = (ms = 700) => pausa(ms);
  /** Mueve el cursor a un punto de la pantalla (para que el desplazamiento caiga sobre un panel). */
  const sobre = (p, x, y) => ir(p, x, y, 500);
  /** Diálogo abierto (Nuevo comunicado, Enviar recordatorio…). */
  const dlg = (p) => p.getByRole('dialog');
  /** Abre «Nuevo comunicado» y escribe el título (no se publica). */
  const nuevoComunicado = async (p, titulo = 'Corte de agua el sábado de 9 a 13 h') => { await pulsar(p, btn(p, /nuevo comunicado/i)); await tocar(p, dlg(p).getByLabel(/^título/i)); await p.keyboard.type(titulo, { delay: 28 }); await mirar(300); };
  /** Baja dentro del diálogo: el cursor va sobre él, así el desplazamiento no mueve la página ni saca el título de cuadro. */
  const bajarEnDialogo = async (p, px, ms = 1200) => { await sobre(p, 800, 470); await desplazar(p, px, ms); };
  /** Marca dos morosos con su casilla (sólo se marcan; no se envía nada). */
  const marcarDos = async (p) => { await tocar(p, p.getByRole('checkbox', { name: /marcar la unidad/i }).nth(0)); await mirar(300); await tocar(p, p.getByRole('checkbox', { name: /marcar la unidad/i }).nth(1)); await mirar(400); };

  const V = {};
  const video = (id, rol, titulo, descripcion, escenas) => { V[id] = { rol, titulo, descripcion, escenas: escenas.map((e) => ({ rol, ...e })) }; };

  // ===================================================================== ADMINISTRADORA
  video('m-admin-resumen', 'admin', 'Resumen', 'Tu cobranza de un vistazo: lo cobrado, lo que falta, las unidades morosas y el avance de cada block.', [
    { url: '/admin/dashboard', pantalla: 'Resumen: tarjetas de cobrado, por cobrar, unidades morosas y tareas abiertas',
      voz: 'El Resumen es tu punto de partida: cuánto cobraste este mes, cuánto falta por cobrar, cuántas unidades están morosas y cuántas tareas siguen abiertas.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Por cobrar').first()); await mirar(900); await senalar(p, p.getByText('Unidades morosas').first()); } },
    { url: '/admin/dashboard', pantalla: 'Se baja a «Emitido vs. cobrado» y «% cobrado por block»; se señala el selector de blocks',
      voz: 'Más abajo comparas lo emitido con lo cobrado de los últimos meses y ves el avance de cobro de cada block. Con el selector de arriba, filtras uno solo.',
      accion: async (p) => { await mirar(500); await desplazar(p, 420, 1800); await mirar(800); await desplazar(p, -420, 1000); await senalar(p, p.getByRole('combobox').first()); } },
  ]);

  video('m-admin-condominios', 'admin', 'Condominios', 'La lista de condominios que administras y la ficha de cada uno: blocks, unidades, residentes y recibos.', [
    { url: '/admin/complejos', pantalla: 'Condominios: la lista con dirección, empresa y unidades; se señala «Nuevo condominio»',
      voz: 'Aquí están los condominios que administras, con su dirección y su número de unidades. Con Nuevo condominio registras uno más.',
      accion: async (p) => { await mirar(); await senalar(p, p.locator('tbody tr').first()); await mirar(700); await senalar(p, btn(p, /nuevo condominio/i)); } },
    { url: '/admin/complejos', pantalla: 'Ver ficha → pestaña Residentes',
      voz: 'Entra a la ficha de un condominio para ver sus blocks, sus unidades, sus residentes y sus recibos, y elegir qué avisos salen también por WhatsApp.',
      accion: async (p) => { await tocar(p, p.getByRole('link', { name: /ver ficha/i }).or(btn(p, /ver ficha/i))); await asentar(p); await p.getByRole('tab', { name: /residentes/i }).first().waitFor({ timeout: 15000 }); await mirar(400); await desplazar(p, 320, 1000); await desplazar(p, -320, 600); await tab(p, /blocks/i); await mirar(400); await tab(p, /residentes/i); await mirar(900); } },
  ]);

  video('m-admin-recibos', 'admin', 'Recibos', 'Emite el mantenimiento de cada mes, o sube el Excel del block. El aviso de cada recibo va al grupo de WhatsApp de su block y, por correo, a cada vecino.', [
    { url: '/admin/recibos', pantalla: 'Recibos: lista por periodo con el avance de cobro; se señalan «Emitir recibo» y «Subir Excel»',
      voz: 'Cada mes emites el recibo de mantenimiento, o subes el Excel del block. Al emitir, Torre te dice si algún block no tiene grupo de WhatsApp.',
      accion: async (p) => { await mirar(); await senalar(p, btn(p, /emitir recibo/i)); await mirar(500); await senalar(p, btn(p, /^subir excel/i)); await mirar(500); await senalar(p, fila(p).first()); } },
    { url: '/admin/recibos/26', pantalla: 'Recibo de octubre del Block 1: se señala «Avisar a los vecinos»',
      voz: 'Cada block tiene su recibo. Abre el de tu block y avisa a los vecinos desde ahí.',
      accion: async (p) => { await mirar(600); await senalar(p, btn(p, /avisar a los vecinos/i)); await mirar(700); } },
    { url: '/admin/recibos/26', pantalla: 'Avisar a los vecinos: cuántos reciben por correo y el aviso al grupo del block (no se envía)',
      voz: 'Torre cuenta a cuántos vecinos llega por correo, y el aviso va al grupo de WhatsApp del block: un solo mensaje para todos. Nada sale hasta que lo envíes.',
      accion: async (p) => { await tocar(p, btn(p, /avisar a los vecinos/i)); await asentar(p); await mirar(600); await senalar(p, dlg(p).getByText(/el aviso va al grupo de WhatsApp/i).first()); await mirar(900); await tocar(p, dlg(p).getByRole('button', { name: /^cerrar$/i })); await mirar(500); } },
    { url: '/admin/recibos', pantalla: 'Periodo → pestaña «Consolidado del block»',
      voz: 'Y en Consolidado del block tienes el resumen del block, listo para imprimir.',
      accion: async (p) => { await tocar(p, fila(p)); await asentar(p); await tab(p, /consolidado del block/i); await mirar(500); await desplazar(p, 300, 1800); } },
  ]);

  video('m-admin-pagos', 'admin', 'Pagos', 'Revisa los pagos que registran los vecinos, valida o rechaza cada uno y registra los que recibes tú.', [
    { url: '/admin/pagos', pantalla: 'Pagos: pestañas «Por validar», «Validados» y «Rechazados»',
      voz: 'Aquí llegan los pagos que registran los vecinos, con su método, su monto y su estado. Empiezas por los que están por validar.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByRole('tab', { name: /por validar/i })); await mirar(600); await senalar(p, fila(p).first()); } },
    { url: '/admin/pagos', pantalla: 'Revisar: voucher, evaluación automática y conformidad del tesorero (no se valida)',
      voz: 'Toca Revisar para ver el voucher, la evaluación automática y la conformidad del tesorero. Luego validas o rechazas el pago.',
      accion: async (p) => { await tocar(p, btn(p, /^revisar$/i)); await asentar(p); await mirar(900); await senalar(p, p.getByText('Evaluación automática').first()); await mirar(500); await desplazar(p, 300, 1500); } },
    { url: '/admin/pagos', pantalla: 'Se señala «Registrar pago»',
      voz: 'Y si recibes un pago por transferencia, Yape, Plin, efectivo o tarjeta, lo registras tú con Registrar pago.',
      accion: async (p) => { await mirar(500); await senalar(p, btn(p, /registrar pago/i)); await mirar(900); } },
  ]);

  video('m-admin-conciliacion', 'admin', 'Conciliación', 'Cruza el extracto del banco con los pagos registrados para saber qué dinero llegó de verdad.', [
    { url: '/admin/conciliacion', pantalla: 'Conciliación bancaria: la cuenta y «Subir extracto»',
      voz: 'Sube el extracto de la cuenta del condominio y Torre cruza cada abono con los pagos registrados. Así ves qué dinero llegó de verdad al banco.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByRole('combobox').first()); await mirar(500); await senalar(p, btn(p, /subir extracto/i)); } },
    { url: '/admin/conciliacion', pantalla: 'Las tarjetas: conciliados, por revisar, abonos sin voucher y vouchers sin abono',
      voz: 'Arriba ves cuántos abonos están conciliados, cuáles faltan por revisar y cuántos vouchers no tienen abono en el banco.',
      accion: async (p) => { await mirar(500); await senalar(p, p.getByText('Conciliados').first()); await mirar(500); await senalar(p, p.getByText('Vouchers sin abono').first()); await desplazar(p, 200, 1000); } },
    { url: '/admin/conciliacion', pantalla: 'Pestañas «Abonos sin voucher» y «Conciliados»',
      voz: 'Con las pestañas filtras por estado: abonos sin voucher, conciliados, salidas y más.',
      accion: async (p) => { await mirar(200); await tab(p, /abonos sin voucher/i); await mirar(350); await tab(p, /^conciliados/i); await mirar(350); await tab(p, /^salidas/i); } },
  ]);

  video('m-admin-medios-pago', 'admin', 'Medios de pago', 'Define dónde pagan los vecinos de cada block y activa la validación automática con IA.', [
    { url: '/admin/medios-pago', pantalla: 'Medios de pago: la validación automática y las tarjetas de cada block',
      voz: 'Aquí defines dónde pagan los vecinos de cada block: Yape, Plin o una cuenta bancaria, con su titular. También lo puede mantener la junta.',
      accion: async (p) => { await mirar(); await desplazar(p, 520, 2200); await mirar(500); } },
    { url: '/admin/medios-pago', pantalla: 'Se señalan el interruptor de validación automática y «Agregar medio de pago»',
      voz: 'Arriba puedes activar la validación automática con inteligencia artificial: lee el comprobante y lo compara con lo que se debía.',
      accion: async (p) => { await mirar(500); await senalar(p, p.getByText('Validación automática con IA').first()); await mirar(700); await senalar(p, p.getByLabel(/validar automáticamente/i).first()); await mirar(700); await senalar(p, btn(p, /agregar medio de pago/i)); } },
  ]);

  video('m-admin-agua', 'admin', 'Lecturas de agua', 'Carga la lectura del contómetro de cada departamento para que el agua salga en su recibo.', [
    { url: '/admin/agua', pantalla: 'Lecturas de agua: block, recibo, fecha de corte y tabla de departamentos',
      voz: 'Aquí cargas la lectura del contómetro de cada departamento: la anterior, la actual y el factor por metro cúbico. Sale en el recibo de cada vecino.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Factor').first()); await mirar(500); await desplazar(p, 260, 1500); } },
    { url: '/admin/agua', pantalla: 'Se señalan «Descargar plantilla» y «Subir Excel o CSV»',
      voz: 'Escribe las lecturas a mano o súbelas con la plantilla de Excel, y Torre calcula el consumo y el monto de cada departamento.',
      accion: async (p) => { await mirar(400); await senalar(p, btn(p, /descargar plantilla/i)); await mirar(500); await senalar(p, btn(p, /subir excel o csv/i)); await mirar(500); await desplazar(p, 220, 1200); } },
  ]);

  video('m-admin-morosidad', 'admin', 'Morosidad', 'Quién debe, cuánto y desde cuándo. Marcas a los morosos y les envías un recordatorio, por correo o por WhatsApp.', [
    { url: '/admin/morosidad', pantalla: 'Morosidad: deuda vencida, unidades morosas, mayor atraso y la lista',
      voz: 'La morosidad, ordenada de mayor a menor deuda: cuánto se debe, cuántas unidades están morosas y cuál es el mayor atraso.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Deuda vencida').first()); await mirar(600); await senalar(p, p.getByText('Mayor atraso').first()); await mirar(500); await desplazar(p, 200, 1000); } },
    { url: '/admin/morosidad', pantalla: 'Casillas por fila: se marcan dos departamentos; se señalan «Marcar todos los de esta página» y «Enviar recordatorio»',
      voz: 'Marca a los morosos a quienes quieres recordar, uno por uno, o todos los de esta página de una vez.',
      accion: async (p) => { await mirar(300); await marcarDos(p); await senalar(p, p.getByText('Marcar todos los de esta página').first()); await mirar(500); await senalar(p, btn(p, /enviar recordatorio/i)); await mirar(500); } },
    { url: '/admin/morosidad', pantalla: 'Enviar recordatorio: por correo (WhatsApp apagado) y a cuántos llega; no se envía nada',
      voz: 'Al enviar recordatorio eliges por dónde: por correo, o también por WhatsApp. Antes ves cuántos lo recibirán. Esto es personal: va directo a cada responsable, no a un grupo.',
      accion: async (p) => { await mirar(300); await marcarDos(p); await tocar(p, btn(p, /enviar recordatorio/i)); await asentar(p); await mirar(600); await senalar(p, dlg(p).getByText('Recibirán el recordatorio').first()); await mirar(700); await senalar(p, dlg(p).getByText('Por correo', { exact: true }).first()); await mirar(800); } },
    { url: '/admin/morosidad', pantalla: 'Así lo recibe cada responsable: su nombre y lo que debe su departamento (no se envía)',
      voz: 'Cada responsable recibe sólo lo que debe su departamento, con su nombre. A cada departamento se le recuerda una vez al día.',
      accion: async (p) => { await mirar(300); await marcarDos(p); await tocar(p, btn(p, /enviar recordatorio/i)); await asentar(p); await mirar(400); await senalar(p, dlg(p).getByText('Así lo recibe cada responsable').first()); await mirar(500); await bajarEnDialogo(p, 260, 1000); } },
    { url: '/admin/morosidad', pantalla: 'Se señala «Enviar a N departamentos» y se pulsa «Cancelar» (no se envía)',
      voz: 'El botón de enviar dice a cuántos llega. Si no quieres enviar, cancela: nada sale hasta que pulses Enviar.',
      accion: async (p) => { await mirar(300); await marcarDos(p); await tocar(p, btn(p, /enviar recordatorio/i)); await asentar(p); await mirar(400); await senalar(p, dlg(p).getByRole('button', { name: /^enviar a /i }).first()); await mirar(800); await tocar(p, dlg(p).getByRole('button', { name: /^cancelar$/i })); await asentar(p); await mirar(500); } },
  ]);

  video('m-admin-cierres', 'admin', 'Cierres del mes', 'Al cerrar el mes, cada junta paga a la administración, a la Junta central y a los servicios; aquí ves el estado de todos los blocks.', [
    { url: '/admin/cierres', pantalla: 'Cierres del mes: octubre, tarjetas por block con pagos registrados y facturado',
      voz: 'Al cerrar el mes, cada junta de block paga a la empresa administradora, a la Junta central y a los servicios, con su voucher y su conformidad.',
      accion: async (p) => { await octubre(p); await mirar(600); await senalar(p, p.getByText('Block 1').first()); } },
    { url: '/admin/cierres', pantalla: 'Se abre el Block 1 de octubre y se baja por sus pagos',
      voz: 'Abre un block para ver cuánto facturó, qué ya se pagó y cuánto sobra para el fondo de ahorros.',
      accion: async (p) => { await octubre(p); await tocar(p, p.getByText('Block 1').first()); await asentar(p); await mirar(600); await desplazar(p, 380, 2200); } },
    { url: '/admin/cierres', pantalla: 'Pestañas «Pagos a la administradora» y «Cuentas de destino»',
      voz: 'En las otras pestañas ves los pagos a la administradora, los aportes a la Junta central y las cuentas de destino.',
      accion: async (p) => { await octubre(p); await tab(p, /pagos a la administradora/i); await mirar(900); await tab(p, /aportes a la junta central/i); await mirar(900); await tab(p, /cuentas de destino/i); await mirar(700); } },
  ]);

  video('m-admin-rendicion', 'admin', 'Rendición del mes', 'El informe del mes para la junta o la asamblea: lo cobrado, lo pagado, el saldo, los fondos y la morosidad.', [
    { url: '/admin/rendicion', pantalla: 'Rendición del mes (octubre, condominio completo): cobrado, egresos, saldo y % cobrado',
      voz: 'La rendición del mes es el informe para la junta o la asamblea: lo cobrado, lo pagado, el saldo, los fondos y la morosidad.',
      accion: async (p) => { await octubre(p); await mirar(700); await senalar(p, p.getByText('Cobrado del mes').first()); await mirar(500); await desplazar(p, 300, 1500); } },
    { url: '/admin/rendicion', pantalla: 'Se señalan «Descargar Excel» e «Imprimir / PDF» y se recorren las secciones',
      voz: 'Elige el mes y el block, o el condominio completo, y recórrela por secciones. La bajas a Excel o la imprimes en PDF.',
      accion: async (p) => { await octubre(p); await senalar(p, btn(p, /descargar excel/i)); await mirar(500); await senalar(p, btn(p, /imprimir/i)); await mirar(400); await desplazar(p, 700, 3200); } },
  ]);

  video('m-admin-unidades', 'admin', 'Unidades', 'Todas las unidades con su block, propietario, inquilino y estado; las personas de cada departamento y su estado de cuenta.', [
    { url: '/admin/unidades', pantalla: 'Unidades: lista con block, propietario, inquilino y estado; buscador y filtros',
      voz: 'Todas las unidades del condominio con su block, su propietario, su inquilino y su estado. Busca por código o filtra por block.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByPlaceholder(/buscar por código/i)); await mirar(500); await desplazar(p, 240, 1400); } },
    { url: '/admin/unidades', pantalla: 'Personas del departamento (quién tiene usuario en Torre) y estado de cuenta de la unidad',
      voz: 'En cada fila abres las personas del departamento, con quién tiene usuario en Torre, o su estado de cuenta, y editas la unidad.',
      accion: async (p) => { await mirar(300); await tocar(p, btn(p, /personas del departamento b01-101/i)); await asentar(p); await mirar(1800); await p.keyboard.press('Escape'); await mirar(400); await tocar(p, btn(p, /estado de cuenta de la unidad b01-101/i)); await asentar(p); await mirar(800); } },
  ]);

  video('m-admin-mantenimiento', 'admin', 'Mantenimiento', 'Registra las tareas de reparación y cuidado y encárgalas a tu personal o a un proveedor.', [
    { url: '/admin/mantenimientos', pantalla: 'Mantenimiento: tareas con unidad, asignado, estado y fecha; se señala «Nueva tarea»',
      voz: 'Aquí registras las tareas de reparación y cuidado del condominio, y a quién se las encargas: a tu personal o a un proveedor.',
      accion: async (p) => { await mirar(); await senalar(p, btn(p, /nueva tarea/i)); await mirar(600); await desplazar(p, 200, 1200); } },
    { url: '/admin/mantenimientos', pantalla: 'Pestañas «Pendientes», «En progreso» y «Completadas»',
      voz: 'Cada tarea pasa de pendiente a en progreso y a completada. Con las pestañas ves cada grupo. Usa el buscador para encontrar una tarea por su título.',
      accion: async (p) => { await mirar(300); await tab(p, /^pendientes/i); await mirar(900); await tab(p, /en progreso/i); await mirar(900); await tab(p, /^completadas/i); await mirar(700); } },
  ]);

  video('m-admin-conceptos', 'admin', 'Conceptos', 'Lo que se cobra en cada recibo: mantenimiento, agua, luz de áreas comunes y recargo por mora.', [
    { url: '/admin/conceptos', pantalla: 'Conceptos: lista con descripción, tipo de monto, destino al cerrar el mes y estado',
      voz: 'Los conceptos son lo que se cobra en cada recibo: el mantenimiento, el agua, la luz de las áreas comunes y el recargo por mora.',
      accion: async (p) => { await mirar(); await senalar(p, fila(p).first()); await mirar(600); await desplazar(p, 220, 1400); } },
    { url: '/admin/conceptos', pantalla: 'Se señalan el tipo de monto, el destino al cerrar el mes y el interruptor de activo',
      voz: 'Cada concepto es fijo o variable, y tiene su destino al cerrar el mes. Con el interruptor lo activas o lo desactivas.',
      accion: async (p) => { await mirar(300); await senalar(p, p.getByText('Destino al cerrar el mes').first()); await mirar(700); await senalar(p, p.getByRole('switch').first().or(p.getByText('Activo').first())); await mirar(600); await senalar(p, btn(p, /nuevo concepto/i)); } },
  ]);

  video('m-admin-comunicados', 'admin', 'Comunicados', 'Los avisos para tus vecinos: eliges para quién es, a qué grupos de WhatsApp sale y qué queda en la junta.', [
    { url: '/admin/comunicados', pantalla: 'Comunicados: los publicados, con para quién, fecha y quién los envió',
      voz: 'Los comunicados son los avisos para tus vecinos: cortes, reuniones y trabajos. Ves para quién es cada uno y quién lo envió.',
      accion: async (p) => { await mirar(); await senalar(p, fila(p).first()); await mirar(600); await desplazar(p, 160, 1000); } },
    { url: '/admin/comunicados', pantalla: 'Nuevo comunicado: «Para quién» en «Departamentos elegidos», con la lista de casillas (no se publica)',
      voz: 'Toca Nuevo comunicado y elige para quién es. Si eliges departamentos, marcas uno por uno quién lo recibe.',
      accion: async (p) => { await nuevoComunicado(p); await sobre(p, 820, 300); await mirar(300); await dlg(p).locator('select').first().selectOption({ label: 'Departamentos elegidos' }); await asentar(p); await mirar(400); await senalar(p, dlg(p).getByPlaceholder(/buscar por código/i)); await mirar(400); await tocar(p, dlg(p).getByRole('checkbox').first()); await mirar(800); } },
    { url: '/admin/comunicados', pantalla: 'Título y mensaje; más abajo, «A las juntas del condominio» viene desmarcado (no se publica)',
      voz: 'Escribe el título y el mensaje. A las juntas sale desmarcado: márcalo sólo si es urgente, porque el grupo de WhatsApp ya lo recibe.',
      accion: async (p) => { await nuevoComunicado(p); await bajarEnDialogo(p, 380, 1000); await senalar(p, dlg(p).getByText('A las juntas del condominio').first()); await mirar(900); } },
    { url: '/admin/comunicados', pantalla: 'A los grupos de WhatsApp: los del alcance vienen marcados (no se publica)',
      voz: 'Lo general va al grupo de WhatsApp: un solo mensaje para todos. Por eso el grupo del block viene marcado. Lo personal va directo, a cada vecino.',
      accion: async (p) => { await nuevoComunicado(p); await bajarEnDialogo(p, 1200, 1800); await senalar(p, dlg(p).getByText('Vecinos Block 1 · Libertadores').first()); await mirar(900); } },
    { url: '/admin/comunicados', pantalla: 'Pestaña «Notificaciones»: qué salió por correo y por WhatsApp',
      voz: 'En Notificaciones ves qué salió por correo y por WhatsApp, y qué hay que reintentar.',
      accion: async (p) => { await tab(p, /notificaciones/i); await p.getByText('Si un canal no está configurado').first().waitFor({ timeout: 4000 }).catch(() => {}); await asentar(p); await mirar(600); await desplazar(p, 200, 1200); } },
  ]);

  video('m-admin-areas-comunes', 'admin', 'Áreas comunes', 'Define qué áreas pueden reservar los vecinos y atiende sus reservas.', [
    { url: '/admin/areas-comunes', pantalla: 'Áreas comunes › Reservas: las pendientes de aprobar',
      voz: 'Defines qué áreas pueden reservar tus vecinos, como el salón, la parrilla o la piscina, y atiendes sus reservas.',
      accion: async (p) => { await mirar(); await senalar(p, fila(p).first()); await mirar(600); } },
    { url: '/admin/areas-comunes', pantalla: 'Se señala aprobar una reserva y se abre la pestaña «Áreas»',
      voz: 'En Reservas apruebas, rechazas o cancelas cada solicitud. En Áreas administras las áreas disponibles. Cada área tiene su horario y sus reglas.',
      accion: async (p) => { await mirar(300); await senalar(p, p.getByRole('button', { name: /^aprobar la reserva/i }).first()); await mirar(800); await tab(p, /^áreas/i); await mirar(900); await senalar(p, btn(p, /nueva área/i)); } },
  ]);

  video('m-admin-juntas', 'admin', 'Juntas directivas', 'La junta de cada block: sus miembros, su correo y la cuenta donde pagan los vecinos; registra una nueva gestión cuando cambie.', [
    { url: '/admin/juntas', pantalla: 'Juntas directivas: la tarjeta de cada block con miembros, correo y cuenta de pago',
      voz: 'Cada block tiene su junta directiva: sus miembros, su correo y la cuenta donde pagan los vecinos.',
      accion: async (p) => { await mirar(); await desplazar(p, 360, 2200); await mirar(400); } },
    { url: '/admin/juntas', pantalla: 'Se abre «Nueva gestión» (no se guarda); se señala «Historial»',
      voz: 'Cuando cambia la junta, usa Nueva gestión: los permisos pasan solos, y la gestión anterior queda en el historial. Cada cambio queda registrado con su fecha de inicio.',
      accion: async (p) => { await mirar(300); await tocar(p, btn(p, /nueva gestión/i)); await asentar(p); await mirar(1800); } },
  ]);

  video('m-admin-whatsapp', 'admin', 'WhatsApp', 'Mira que tu número esté conectado, cuántos mensajes salen, qué blocks tienen grupo y qué avisos salen también por WhatsApp.', [
    { url: '/admin/whatsapp', pantalla: 'WhatsApp: «WhatsApp vinculado correctamente» (el botón para desvincular no se pulsa)',
      voz: 'Tu número de WhatsApp ya está vinculado. Desde aquí salen los avisos que marques para WhatsApp, con pausas entre envíos y un tope diario.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('WhatsApp vinculado correctamente').first()); await mirar(700); } },
    { url: '/admin/whatsapp', pantalla: 'Contador: enviados hoy contra el tope, en cola, enviados por tipo y el mes por condominio',
      voz: 'El contador muestra lo que salió hoy contra el tope diario, lo que espera en cola, y por tipo: recibos, vencidos o comunicados.',
      accion: async (p) => { await mirar(300); await desplazar(p, 520, 1400); await asentar(p); await senalar(p, p.getByText('Enviados hoy').first()); await mirar(600); await senalar(p, p.getByText('En cola', { exact: true }).first()); await mirar(600); await senalar(p, p.getByText('Enviados por tipo').first()); await mirar(700); await senalar(p, p.getByText('Este mes, por condominio').first()); await mirar(600); } },
    { url: '/admin/whatsapp', pantalla: 'Mis grupos: «Grupos de blocks» y «Falta: Block 14», con el filtro «Sólo los que uso»',
      voz: 'En Mis grupos Torre cuenta cuántos blocks tienen su grupo, y te dice cuál falta. Así ningún block se queda sin aviso.',
      accion: async (p) => { await desplazar(p, 900, 1000); await asentar(p); await senalar(p, p.getByText(/grupos de blocks/i).first()); await mirar(700); await senalar(p, p.getByText(/^falta:/i).first()); await mirar(700); await senalar(p, p.getByLabel('Sólo los que uso')); await mirar(500); } },
    { url: '/admin/condominios/4', pantalla: 'Ficha del condominio › Avisos por WhatsApp: «Recibo del mes» y «Venció» (no se guarda)',
      voz: 'En la ficha del condominio eliges qué avisos salen también por WhatsApp. Lo general, como el recibo, va al grupo de cada block. Lo personal, como un vencido, va directo al vecino.',
      accion: async (p) => { await p.getByRole('heading', { name: 'Avisos por WhatsApp' }).scrollIntoViewIfNeeded().catch(() => {}); await asentar(p); await pausa(400); await senalar(p, p.locator('label', { hasText: 'Recibo del mes' }).first()); await mirar(700); await senalar(p, p.locator('label', { hasText: 'Venció' }).first()); await mirar(700); } },
  ]);

  video('m-admin-proveedores', 'admin', 'Proveedores', 'Las fichas de los proveedores externos: ascensores, gasfitería, pintura; elige cuáles ven los vecinos.', [
    { url: '/admin/proveedores', pantalla: 'Proveedores: lista con rubro, contacto, condominios que atiende, visibilidad y estado',
      voz: 'Aquí guardas a los proveedores externos de tu condominio: ascensores, gasfitería, pintura. Son fichas de contacto; ellos no inician sesión.',
      accion: async (p) => { await mirar(); await senalar(p, fila(p).first()); await mirar(600); await desplazar(p, 220, 1400); } },
    { url: '/admin/proveedores', pantalla: 'Se señalan los filtros y la columna «Vecinos» (lo ven / no lo ven)',
      voz: 'Decides cuáles ven tus vecinos, y filtras por rubro o por estado. Si un proveedor ya no sirve, márcalo como inactivo.',
      accion: async (p) => { await mirar(300); await senalar(p, p.getByText('Filtrar por rubro').first()); await mirar(600); await senalar(p, p.getByText('Vecinos').first()); await mirar(700); await senalar(p, btn(p, /nuevo proveedor/i)); } },
  ]);

  video('m-admin-mi-empresa', 'admin', 'Mi empresa', 'Los datos de tu administradora y las cuentas de tu equipo.', [
    { url: '/admin/configuracion', pantalla: 'Mi empresa › Datos: razón social, RUC, contacto y logo del recibo',
      voz: 'Mi empresa reúne los datos de tu administradora tal como salen en los recibos y comunicados: razón social, RUC, contacto y logo.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Razón social').first()); await mirar(600); await desplazar(p, 260, 1400); } },
    { url: '/admin/configuracion', pantalla: 'Pestaña «Personal»: las cuentas del equipo',
      voz: 'En la pestaña Personal creas las cuentas de tu equipo, como seguridad o mantenimiento, y cada persona ve sólo lo de su rol.',
      accion: async (p) => { await mirar(500); await tab(p, /^personal/i); await mirar(900); await desplazar(p, 160, 1200); } },
  ]);

  // «Tu marca» es una sección de Mi empresa › Datos (plan Pro o Administradora; la empresa de prueba está en Cortesía). Nada de esta escena se guarda.
  video('m-admin-marca', 'admin', 'Tu marca', 'El logo, el nombre comercial y el color de tu administradora: así se ven Torre y sus recibos para tus vecinos.', [
    { url: '/admin/configuracion', pantalla: 'Mi empresa › Datos, sección «Tu marca»: logo, nombre comercial, color y vista previa',
      voz: 'Tu marca es el logo, el nombre comercial y el color de tu administradora. Salen en el menú de la app, en el recibo y en los correos de tus vecinos.',
      accion: async (p) => { await mirar(500); await desplazar(p, 700, 1800); await senalar(p, p.getByRole('heading', { name: 'Tu marca' })); await mirar(600); } },
    { url: '/admin/configuracion', pantalla: 'Se escribe un nombre comercial de prueba y la vista previa lo muestra (no se guarda)',
      voz: 'Escribe el nombre comercial con el que te presentas. Si lo dejas vacío, se usa tu razón social. La vista previa cambia al instante.',
      accion: async (p) => { await desplazar(p, 700, 1000); await tocar(p, p.getByLabel('Nombre comercial')); await p.keyboard.type('Demo Condominios', { delay: 35 }); await mirar(800); await senalar(p, p.getByText('Así se verá').first()); await mirar(600); } },
    { url: '/admin/configuracion', pantalla: 'Se escribe un color de prueba (#1d4ed8) y la vista previa cambia (no se guarda)',
      voz: 'Elige el color con el selector o escribe su código, por ejemplo 1d4ed8. Así se verá tu marca en la app.',
      accion: async (p) => { await desplazar(p, 700, 1000); await tocar(p, p.getByLabel('Código del color')); await p.keyboard.type('#1d4ed8', { delay: 60 }); await p.keyboard.press('Tab'); await mirar(900); } },
    { url: '/admin/configuracion', pantalla: 'Se pulsa «Guardar mi marca» y, en el menú, «Resumen»: el nombre y el color ya salen en la app',
      voz: 'Guarda tu marca y Torre la aplica en toda la app. En el menú ya aparecen tu nombre y tu color.',
      accion: async (p) => { await desplazar(p, 700, 1000); await tocar(p, p.getByLabel('Nombre comercial')); await p.getByLabel('Nombre comercial').fill(''); await p.keyboard.type('Demo Condominios', { delay: 35 }); await mirar(300); await tocar(p, p.getByLabel('Código del color')); await p.keyboard.type('#1d4ed8', { delay: 40 }); await p.keyboard.press('Tab'); await mirar(500); await tocar(p, btn(p, /guardar mi marca/i)); await asentar(p); await mirar(600); await tocar(p, p.getByRole('link', { name: 'Resumen' }).first()); await asentar(p); await pausa(800); await senalar(p, p.getByText('Demo Condominios').first()); await mirar(900); } },
    { url: '/admin/configuracion', pantalla: 'De vuelta en Mi empresa: se quita el nombre, se pulsa «Volver al verde de Torre» y se guarda',
      voz: 'Para volver al verde de Torre, pulsa Volver al verde de Torre y guarda. Torre vuelve a verse como siempre.',
      accion: async (p) => { await desplazar(p, 700, 1000); await tocar(p, p.getByLabel('Nombre comercial')); await mirar(300); await p.getByLabel('Nombre comercial').fill(''); await mirar(400); await tocar(p, btn(p, /volver al verde de torre/i)); await mirar(500); await tocar(p, btn(p, /guardar mi marca/i)); await asentar(p); await mirar(900); } },
  ]);

  video('m-admin-mi-plan', 'admin', 'Mi plan', 'El plan de cada condominio, hasta cuándo está vigente, qué incluye y cuánto llevas usando.', [
    { url: '/admin/mi-plan', pantalla: 'Mi plan: el condominio, su plan, su vigencia y lo que incluye',
      voz: 'Mi plan muestra el plan de cada condominio, hasta cuándo está vigente y todo lo que incluye.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Vigente hasta').first()); await mirar(700); await senalar(p, p.getByText(/Lo que tienes activo/i).first()); await mirar(500); } },
    { url: '/admin/mi-plan', pantalla: 'Se señala el uso del mes y el botón «Ver pagos»',
      voz: 'También ves cuánto llevas usando este mes, y con Ver pagos revisas los pagos de tu plan. Revísalo cuando quieras para saber qué tienes activo en cada uno de tus condominios.',
      accion: async (p) => { await mirar(400); await senalar(p, p.getByText(/Este mes/i).first()); await mirar(700); await senalar(p, btn(p, /ver pagos/i)); await mirar(500); } },
  ]);

  // ===================================================================== PROPIETARIO (el inquilino comparte estos videos)
  video('m-propietario-inicio', 'propietario', 'Inicio', 'Lo que debes, tu próximo vencimiento y lo que has pagado este año.', [
    { url: '/propietario/inicio', pantalla: 'Inicio: deuda total, próximo vencimiento y pagado este año',
      voz: 'Tu Inicio resume lo que debes, cuándo vence tu próximo pago y cuánto has pagado este año.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Deuda total').first()); await mirar(700); await senalar(p, p.getByText('Pagado este año').first()); } },
    { url: '/propietario/inicio', pantalla: 'Mantenimientos por pagar y comunicados recientes',
      voz: 'Debajo ves los mantenimientos por pagar, con su botón para pagar, y los últimos comunicados de tu condominio. Revisa tu Inicio antes de cada vencimiento para no atrasarte.',
      accion: async (p) => { await mirar(500); await senalar(p, btn(p, /pagar mantenimiento/i)); await mirar(600); await desplazar(p, 300, 1600); } },
  ]);

  video('m-propietario-unidades', 'propietario', 'Mis unidades', 'Los departamentos, estacionamientos y depósitos que están a tu nombre.', [
    { url: '/propietario/unidades', pantalla: 'Mis unidades: la tarjeta de la unidad con su block y su estado',
      voz: 'Mis unidades muestra los departamentos, estacionamientos y depósitos que están a tu nombre, con su block y su estado.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText(/Departamento ·/i).first()); await mirar(700); } },
    { url: '/propietario/unidades', pantalla: 'Se señala el inquilino de la unidad',
      voz: 'Y si alquilas la unidad, aquí ves quién es tu inquilino. Si no hay nadie, dice Sin inquilino. Si algún dato no es correcto, avísale a tu administración.',
      accion: async (p) => { await mirar(400); await senalar(p, p.getByText(/inquilino/i).first()); await mirar(800); } },
  ]);

  video('m-propietario-recibos', 'propietario', 'Mis recibos', 'El mantenimiento de cada mes de tu departamento, con todos sus conceptos, y cómo pagarlo.', [
    { url: '/propietario/cargos', pantalla: 'Mis recibos: pestañas «Por pagar», «Vencidos», «En revisión» y «Pagados»',
      voz: 'Mis recibos reúne el mantenimiento de cada mes de tu departamento, separado en por pagar, vencidos, en revisión y pagados.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByRole('tab', { name: /por pagar/i })); await mirar(600); await senalar(p, p.getByRole('tab', { name: /vencidos/i })); await mirar(500); await senalar(p, p.getByRole('tab', { name: /pagados/i })); } },
    { url: '/propietario/cargos', pantalla: 'Ver detalle: el recibo concepto por concepto',
      voz: 'Toca Ver detalle para ver cada concepto del recibo y los pagos que ya registraste.',
      accion: async (p) => { await tocar(p, btn(p, /ver detalle/i)); await asentar(p); await mirar(800); await desplazar(p, 260, 1600); } },
    { url: '/propietario/cargos', pantalla: 'Pagar mantenimiento (no se envía)',
      voz: 'Con Pagar mantenimiento sigues los pasos y subes tu voucher. El pago queda en revisión hasta que lo validen.',
      accion: async (p) => { await tocar(p, btn(p, /pagar mantenimiento/i)); await asentar(p); await mirar(800); await desplazar(p, 260, 1600); } },
  ]);

  video('m-propietario-historial', 'propietario', 'Mi historial', 'Cómo evolucionan tus pagos: por mes, por concepto, el agua y tu puntualidad.', [
    { url: '/propietario/pagos', pantalla: 'Mi historial › Resumen: pagado, promedio, deuda de hoy, puntualidad y gráfico mensual',
      voz: 'Mi historial muestra cómo evolucionan tus pagos: cuánto pagas cada mes, tu promedio, tu deuda de hoy y tu puntualidad.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Puntualidad').first()); await mirar(600); await desplazar(p, 260, 1600); } },
    { url: '/propietario/pagos', pantalla: 'Pestañas «Por concepto» y «Puntualidad»; se señala «Estado de cuenta»',
      voz: 'Cambia de pestaña para verlo por concepto, acumulado, agua o puntualidad, y baja tu estado de cuenta. También puedes bajarlo a Excel.',
      accion: async (p) => { await mirar(300); await tab(p, /por concepto/i); await mirar(1000); await tab(p, /^puntualidad/i); await mirar(900); await senalar(p, btn(p, /estado de cuenta/i)); } },
  ]);

  video('m-propietario-junta', 'propietario', 'Mi junta', 'Quiénes forman la junta de tu block y la Junta central, y a dónde pagar.', [
    { url: '/propietario/junta', pantalla: 'Mi junta: la junta del block y la Junta central con sus miembros',
      voz: 'Mi junta te dice quiénes forman la junta de tu block y la Junta central, con su presidente y su tesorero.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Quiénes la forman').first()); await mirar(700); await desplazar(p, 260, 1500); } },
    { url: '/propietario/junta', pantalla: 'Dónde pagas: se señalan los botones para copiar la cuenta',
      voz: 'Y en Dónde pagas ves la cuenta o el Yape de cada junta, que copias con un toque. Así sabes siempre a quién escribir y adónde hacer tu pago.',
      accion: async (p) => { await mirar(300); await p.getByText('Dónde pagas').first().scrollIntoViewIfNeeded(); await mirar(500); await senalar(p, p.getByRole('button', { name: /^copiar/i }).first()); await mirar(700); } },
  ]);

  video('m-propietario-proveedores', 'propietario', 'Proveedores', 'Los servicios de confianza que tu administración comparte contigo.', [
    { url: '/propietario/proveedores', pantalla: 'Proveedores: fichas por rubro (ascensores, gasfitería, electricidad…)',
      voz: 'Proveedores reúne los servicios de confianza que tu administración comparte contigo: ascensores, gasfitería, electricidad y más. Están ordenados por rubro.',
      accion: async (p) => { await mirar(); await desplazar(p, 320, 2200); } },
    { url: '/propietario/proveedores', pantalla: 'Se señalan los botones Llamar, WhatsApp y Escribir de una ficha (no se pulsan)',
      voz: 'Cada ficha tiene su contacto y botones para llamar, escribir por WhatsApp o enviar un correo.',
      accion: async (p) => { await mirar(300); await senalar(p, p.getByRole('link', { name: /^llamar/i }).or(btn(p, /^llamar/i)).first()); await mirar(600); await senalar(p, p.getByRole('link', { name: /^whatsapp/i }).or(btn(p, /^whatsapp/i)).first()); await mirar(600); await senalar(p, p.getByRole('link', { name: /^escribir/i }).or(btn(p, /^escribir/i)).first()); } },
  ]);

  video('m-propietario-comunicados', 'propietario', 'Comunicados', 'Lo que la administración y la junta anuncian a tu condominio.', [
    { url: '/propietario/comunicados', pantalla: 'Comunicados: lista con etiqueta de quién lo publicó, fecha y mensaje',
      voz: 'Aquí aparecen los comunicados que la administración y la junta anuncian a tu condominio: cortes, reuniones, trabajos y avisos importantes.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Corte de agua el sábado 31 de octubre').first()); await mirar(700); } },
    { url: '/propietario/comunicados', pantalla: 'Se señala el comunicado fijado y se baja por la lista',
      voz: 'Los más importantes quedan fijados arriba, y cada uno dice quién lo publicó y cuándo. Revísalos seguido para no perderte nada.',
      accion: async (p) => { await mirar(300); await senalar(p, p.getByText('Fijado').first()); await mirar(700); await desplazar(p, 220, 1400); } },
  ]);

  video('m-propietario-reservas', 'propietario', 'Reservas', 'Reserva el salón, la parrilla u otra área común viendo qué horarios están libres.', [
    { url: '/propietario/reservas', pantalla: 'Reservas: «Reservar un área» y «Mis reservas»',
      voz: 'Reservas te deja pedir el salón, la parrilla u otra área común de tu condominio, viendo qué horarios están libres.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Reservar un área').first()); await mirar(600); await senalar(p, p.getByText('Mis reservas').first()); } },
    { url: '/propietario/reservas', pantalla: 'Se elige «Zona de parrillas» y un día: salen los horarios del día (no se reserva)',
      voz: 'Elige el área y el día, mira los horarios libres y reserva. Tus reservas quedan a la derecha, y puedes cancelar las que aún no empiezan.',
      accion: async (p) => { await mirar(300); await p.getByLabel('Área').selectOption({ label: 'Zona de parrillas' }).catch(() => {}); await p.getByLabel('Día', { exact: true }).fill('2026-11-14').catch(() => {}); await asentar(p); await mirar(500); await desplazar(p, 260, 1400); } },
  ]);

  // ===================================================================== JUNTA (tesorera del Block 1; Junta central para los dos últimos)
  video('m-junta-mi-junta', 'tesorero', 'Mi junta', 'Los miembros de tu junta, su correo y la cuenta donde pagan tus vecinos.', [
    { url: '/junta/mi-junta', pantalla: 'Mi junta: la junta del Block 1 con sus miembros y su cuenta',
      voz: 'Mi junta muestra a los miembros de tu junta, su correo y la cuenta donde pagan tus vecinos.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Miembros').first()); await mirar(600); await desplazar(p, 220, 1400); } },
    { url: '/junta/mi-junta', pantalla: 'Se señalan «Editar» y «Agregar cuenta»',
      voz: 'Puedes editar el correo y la cuenta. Los miembros y las gestiones nuevas las registra la administración. Mantenlos actualizados para que tus vecinos sepan a quién escribir.',
      accion: async (p) => { await mirar(300); await senalar(p, btn(p, /^editar$/i).first()); await mirar(700); await senalar(p, btn(p, /agregar cuenta/i)); await mirar(500); } },
  ]);

  video('m-junta-medios-pago', 'tesorero', 'Medios de pago', 'Las cuentas y los Yape o Plin donde pagan los vecinos de tu block.', [
    { url: '/junta/medios-pago', pantalla: 'Medios de pago: la tarjeta del Block 1 con su junta y su cuenta',
      voz: 'Aquí mantienes al día las cuentas y los Yape o Plin donde pagan los vecinos de tu block.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Donde pagan los vecinos').first()); await mirar(700); } },
    { url: '/junta/medios-pago', pantalla: 'Se señalan el interruptor de la cuenta y «Agregar medio de pago»',
      voz: 'Agrega un medio de pago, edítalo o desactívalo cuando cambie, y los vecinos siempre ven el correcto. Revisa que el titular y el número sean los de tu junta.',
      accion: async (p) => { await mirar(300); await senalar(p, p.getByRole('switch').first().or(p.getByLabel(/activo/i).first())); await mirar(700); await senalar(p, btn(p, /agregar medio de pago/i)); await mirar(500); } },
  ]);

  video('m-junta-pagos', 'tesorero', 'Pagos por validar', 'Confirma que el dinero llegó a la cuenta de la junta; la administración valida cada pago.', [
    { url: '/junta/pagos', pantalla: 'Pagos: los de los vecinos del block, con voucher y estado',
      voz: 'Aquí ves los comprobantes que suben los vecinos de tu block. Como tesorero, confirmas que el dinero llegó a la cuenta de la junta.',
      accion: async (p) => { await mirar(); await senalar(p, fila(p).first()); await mirar(700); } },
    { url: '/junta/pagos', pantalla: 'Revisar: voucher y conformidad del tesorero (no se confirma)',
      voz: 'Abre Revisar para ver el voucher y registrar tu conformidad. Después, la administración valida el pago. Así el dinero que llega a la cuenta queda respaldado por tu conformidad.',
      accion: async (p) => { await tocar(p, btn(p, /^revisar$/i)); await asentar(p); await mirar(900); await desplazar(p, 300, 1500); } },
  ]);

  video('m-junta-cierre', 'tesorero', 'Cierre del mes', 'Al cerrar el mes, registras lo que paga tu junta a la administración, a la Junta central y a los servicios.', [
    { url: '/junta/cierre', pantalla: 'Cierre del mes (octubre): facturado, cobrado y pagado por la junta',
      voz: 'Al cerrar el mes, la junta paga a la empresa administradora, a la Junta central y a los servicios, con el voucher de cada pago.',
      accion: async (p) => { await octubre(p); await mirar(600); await senalar(p, p.getByText(/Facturado a los vecinos/i).first()); } },
    { url: '/junta/cierre', pantalla: 'Se señalan «Registrar pago» y «Ver voucher» (no se pulsan)',
      voz: 'Cada tarjeta muestra lo facturado, lo cobrado y lo pagado, con su botón para registrar el pago. El cierre se hace hacia el día cinco del mes siguiente.',
      accion: async (p) => { await octubre(p); await senalar(p, btn(p, /registrar pago/i)); await mirar(700); await desplazar(p, 260, 1500); } },
  ]);

  // La Rendición del mes de la junta no se puede grabar: en local responde «Tu usuario no tiene una empresa asignada» (problema conocido, ver docs/HANDOFF.md).

  video('m-junta-comunicados', 'tesorero', 'Comunicados', 'Avisa a los vecinos de tu block: el grupo del block recibe un solo mensaje, y la junta sólo si es urgente.', [
    { url: '/junta/comunicados', pantalla: 'Comunicados de la junta, con destinatarios y fecha',
      voz: 'Aquí escribes anuncios para los vecinos de tu block y ves cuáles ya publicaste. Cada uno muestra para quién es, su fecha y quién lo envió.',
      accion: async (p) => { await mirar(); await senalar(p, fila(p).first()); await mirar(700); } },
    { url: '/junta/comunicados', pantalla: 'Nuevo comunicado: «Para quién» fijo en tu block, título y mensaje (no se publica)',
      voz: 'Toca Nuevo comunicado. Como junta publicas para tu block: escribe el título y el mensaje.',
      accion: async (p) => { await nuevoComunicado(p, 'Reunión de la junta el jueves a las 19:30'); await senalar(p, dlg(p).locator('select').first()); await mirar(700); } },
    { url: '/junta/comunicados', pantalla: 'Más abajo: «A la junta del block» desmarcado y el grupo de tu block marcado (no se publica)',
      voz: 'Lo general va al grupo de tu block, un solo mensaje para todos, y viene marcado. A la junta, o a cada vecino, sólo si es urgente.',
      accion: async (p) => { await nuevoComunicado(p, 'Reunión de la junta el jueves a las 19:30'); await bajarEnDialogo(p, 1000, 1600); await senalar(p, dlg(p).getByText('Vecinos Block 1 · Libertadores').first()); await mirar(900); } },
    { url: '/junta/comunicados', pantalla: 'Lista de comunicados publicados: se señala el primero (no se publica nada)',
      voz: 'Al publicar, el comunicado aparece en la app de los vecinos de tu block, y el grupo recibe el aviso.',
      accion: async (p) => { await mirar(400); await senalar(p, fila(p).first()); await mirar(900); } },
  ]);

  video('m-junta-proveedores', 'tesorero', 'Proveedores', 'Los servicios externos de tu condominio: agrega y edita los que atienden sólo a tu condominio.', [
    { url: '/junta/proveedores', pantalla: 'Proveedores: lista con rubro, contacto, condominios y estado',
      voz: 'Aquí ves los servicios externos de tu condominio: ascensores, gasfitería, pintura. Puedes agregar y editar los que atienden sólo a tu condominio.',
      accion: async (p) => { await mirar(); await senalar(p, btn(p, /nuevo proveedor/i)); await mirar(600); await desplazar(p, 220, 1400); } },
    { url: '/junta/proveedores', pantalla: 'Se señalan los filtros por rubro y estado',
      voz: 'Los que también atienden a otros condominios los gestiona la administración, y aquí los ves de sólo lectura.',
      accion: async (p) => { await mirar(300); await senalar(p, p.getByText('Filtrar por rubro').first()); await mirar(600); await senalar(p, p.getByText('Vecinos').first()); await mirar(500); } },
  ]);

  video('m-junta-aportes', 'central', 'Aportes de los blocks', 'Lo que cada block transfirió a la cuenta de la Junta central al cerrar el mes, con la conformidad del tesorero central.', [
    { url: '/junta/aportes', pantalla: 'Aportes de los blocks (octubre): facturado, registrado y con conformidad',
      voz: 'Aportes de los blocks muestra lo que cada block transfirió a la cuenta de la Junta central al cerrar el mes.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText(/Facturado a los blocks/i).first()); await mirar(700); await desplazar(p, 220, 1200); } },
    { url: '/junta/aportes', pantalla: 'Se señalan «Ver voucher» y la conformidad del tesorero central',
      voz: 'El tesorero central confirma que el dinero llegó, y puedes ver el voucher de cada aporte. Cada aporte muestra cuándo se pagó y quién lo registró.',
      accion: async (p) => { await mirar(300); await senalar(p, p.getByText(/Conformidad de/i).first()); await mirar(700); await senalar(p, btn(p, /ver voucher/i)); await mirar(500); } },
  ]);

  video('m-junta-cierre-central', 'central', 'Cierre de la Junta central', 'Lo que entra y sale de la cuenta de la Junta central y su fondo de ahorros.', [
    { url: '/junta/cierre-central', pantalla: 'Cierre de la Junta central (octubre): ingresos, egresos y saldo del mes',
      voz: 'Aquí ves lo que entra y sale de la cuenta de la Junta central: los aportes de los blocks, el alquiler de estacionamientos, los servicios y los proveedores.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Ingresos del mes').first()); await mirar(600); await senalar(p, p.getByText('Saldo del mes').first()); } },
    { url: '/junta/cierre-central', pantalla: 'Fondo de ahorros y se señalan «Registrar ingreso» y «Registrar egreso»',
      voz: 'Y el fondo de ahorros de la Junta central, con su saldo acumulado. Lo ves mes a mes, para llevar las cuentas claras.',
      accion: async (p) => { await mirar(300); await senalar(p, p.getByText('Fondo de ahorros de la Junta central').first()); await mirar(700); await desplazar(p, 360, 1800); } },
  ]);

  // ===================================================================== PERSONAL
  video('m-mantenimiento-inicio', 'mantenimiento', 'Inicio de mantenimiento', 'Tus tareas pendientes, en progreso y completadas de un vistazo.', [
    { url: '/mantenimiento/inicio', pantalla: 'Inicio: pendientes, en progreso y completadas',
      voz: 'Tu Inicio muestra de un vistazo cuántas tareas tienes pendientes, cuántas están en progreso y cuántas ya completaste.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Pendientes').first()); await mirar(500); await senalar(p, p.getByText('Completadas').first()); } },
    { url: '/mantenimiento/inicio', pantalla: 'Tareas recientes y «Ver todas»',
      voz: 'Debajo ves las últimas tareas que siguen abiertas, y con Ver todas vas a tu lista completa. Así sabes por dónde empezar.',
      accion: async (p) => { await mirar(400); await senalar(p, p.getByText('Tareas recientes').first()); await mirar(600); await senalar(p, p.getByRole('link', { name: /ver todas/i }).or(btn(p, /ver todas/i)).first()); } },
  ]);

  video('m-mantenimiento-tareas', 'mantenimiento', 'Mis tareas (mantenimiento)', 'Los trabajos que te asignó la administración y su avance.', [
    { url: '/mantenimiento/tareas', pantalla: 'Mis tareas: pestañas «Pendientes», «En progreso» y «Completadas»',
      voz: 'Mis tareas reúne los trabajos que te asignó la administración, separados en pendientes, en progreso y completadas.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByRole('tab', { name: /pendientes/i })); await mirar(700); await senalar(p, p.getByRole('tab', { name: /en progreso/i })); } },
    { url: '/mantenimiento/tareas', pantalla: 'Se pasa por las pestañas y se señala el botón de avance de una tarea (no se pulsa)',
      voz: 'Cuando empiezas un trabajo lo marcas en progreso, y cuando terminas, lo marcas como completado. Así la administración ve tu avance.',
      accion: async (p) => { await mirar(300); await tab(p, /en progreso/i); await mirar(900); await tab(p, /^completadas/i); await mirar(900); await tab(p, /^pendientes/i); await mirar(500); await senalar(p, btn(p, /iniciar|completar/i).first()); } },
  ]);

  video('m-seguridad-inicio', 'seguridad', 'Inicio de seguridad', 'El condominio que tienes asignado y el acceso rápido a las unidades.', [
    { url: '/seguridad/inicio', pantalla: 'Inicio: condominio asignado y número de unidades',
      voz: 'Tu Inicio muestra el condominio que tienes asignado y cuántas unidades tiene. Es tu punto de partida cada vez que entras.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Condominio asignado').first()); await mirar(800); } },
    { url: '/seguridad/inicio', pantalla: 'Consultar unidades → «Ir a Unidades»',
      voz: 'Desde aquí vas directo a Unidades, para saber a quién visitan antes de autorizar el ingreso. En Unidades sólo puedes consultar, no modificar nada.',
      accion: async (p) => { await mirar(300); await tocar(p, p.getByRole('link', { name: /ir a unidades/i }).or(btn(p, /ir a unidades/i)).first()); await asentar(p); await mirar(800); } },
  ]);

  video('m-seguridad-unidades', 'seguridad', 'Unidades (seguridad)', 'Consulta el propietario y el inquilino de cada unidad antes de autorizar una visita.', [
    { url: '/seguridad/unidades', pantalla: 'Unidades: propietario, inquilino y estado de cada unidad (sólo lectura)',
      voz: 'En Unidades consultas el propietario y el inquilino de cada departamento antes de autorizar una visita. Es de sólo lectura.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Inquilino').first()); await mirar(700); await desplazar(p, 220, 1200); } },
    { url: '/seguridad/unidades', pantalla: 'Se busca una unidad por su código',
      voz: 'Escribe el código de la unidad y encuentras al instante a quién visitan. Así autorizas cada ingreso con la información correcta, sin llamar a nadie.',
      accion: async (p) => { await tocar(p, p.getByPlaceholder(/buscar por código/i)); await p.keyboard.type('B01-102', { delay: 90 }); await mirar(1500); } },
  ]);

  video('m-limpieza-inicio', 'limpieza', 'Inicio de limpieza y jardinería', 'Tu trabajo de limpieza o jardinería de un vistazo.', [
    { url: '/limpieza/inicio', pantalla: 'Inicio: pendientes, en progreso y completadas',
      voz: 'Tu Inicio muestra tu trabajo de un vistazo: cuántas tareas tienes pendientes, en progreso y completadas.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Pendientes').first()); await mirar(500); await senalar(p, p.getByText('En progreso').first()); } },
    { url: '/limpieza/inicio', pantalla: 'Tareas recientes y «Ver todas»',
      voz: 'Debajo ves las últimas tareas que siguen abiertas, y con Ver todas vas a tu lista completa. Revísalo al empezar tu turno para saber por dónde comenzar.',
      accion: async (p) => { await mirar(400); await senalar(p, p.getByText('Tareas recientes').first()); await mirar(600); await senalar(p, p.getByRole('link', { name: /ver todas/i }).or(btn(p, /ver todas/i)).first()); } },
  ]);

  video('m-limpieza-tareas', 'limpieza', 'Mis tareas (limpieza y jardinería)', 'Los trabajos que te asignó la administración y su avance.', [
    { url: '/limpieza/tareas', pantalla: 'Mis tareas: pestañas «Pendientes», «En progreso» y «Completadas»',
      voz: 'Mis tareas reúne los trabajos que te asignó la administración, separados en pendientes, en progreso y completadas.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByRole('tab', { name: /pendientes/i })); await mirar(700); await senalar(p, p.getByRole('tab', { name: /en progreso/i })); } },
    { url: '/limpieza/tareas', pantalla: 'Se pasa por las pestañas y se señala el botón de avance de una tarea (no se pulsa)',
      voz: 'Cuando empiezas un trabajo lo marcas en progreso, y cuando terminas, lo marcas como completado. Así la administración ve tu avance.',
      accion: async (p) => { await mirar(300); await tab(p, /en progreso/i); await mirar(900); await tab(p, /^completadas/i); await mirar(900); await tab(p, /^pendientes/i); await mirar(500); await senalar(p, btn(p, /iniciar|completar/i).first()); } },
  ]);

  // ===================================================================== TODOS
  video('m-perfil', 'propietario', 'Mi perfil', 'Tus datos, tu contraseña, tus sesiones abiertas y tu celular para recibir avisos.', [
    { url: '/perfil', pantalla: 'Mi perfil: datos personales y contraseña',
      voz: 'En Mi perfil cambias tu nombre y tu contraseña. Tu correo y tu rol los gestiona tu administración.',
      accion: async (p) => { await mirar(); await senalar(p, p.getByText('Datos personales').first()); await mirar(700); await senalar(p, p.getByText('Contraseña', { exact: true }).first()); } },
    { url: '/perfil', pantalla: 'Se baja a «Sesiones activas» y «Celular y avisos»',
      voz: 'Más abajo ves los dispositivos donde tienes la sesión abierta, y en Celular y avisos registras tu celular para recibir los avisos.',
      accion: async (p) => { await mirar(400); await desplazar(p, 420, 2000); await mirar(500); await desplazar(p, 420, 1800); } },
  ]);

  // Formato celular (9:16). El aviso «Ten Torre en tu celular» sale sólo dentro de la app, en pantallas chicas y sin instalar (src/app/InstalarApp.tsx).
  // En Android el evento `beforeinstallprompt` no llega solo en el navegador de prueba: se despacha en la página, igual que lo haría Chrome.
  // iPhone: el aviso sale sin evento, sólo con el userAgent de Safari en iPhone.
  const avisoAndroid = (p) => p.evaluate(() => {
    const e = new Event('beforeinstallprompt');
    e.prompt = async () => {};
    e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    dispatchEvent(e);
  });
  video('m-todos-instalar', 'propietario', 'Ten Torre en tu celular', 'Cómo agregar Torre a la pantalla de inicio de tu celular: en Android, con el aviso Instalar Torre, y en iPhone, desde Safari.', [
    { rol: null, url: '/login', pantalla: 'Inicio de sesión en el celular',
      voz: 'Torre también funciona en tu celular. Puedes agregarla a tu pantalla de inicio y abrirla como una app, sin la barra del navegador.',
      accion: async (p) => { await mirar(500); await senalar(p, p.getByText('Ingresa a tu cuenta').first()); await mirar(700); } },
    { url: '/propietario/inicio', pantalla: 'Android: aparece el aviso «Ten Torre en tu celular» y se señala «Instalar Torre»',
      voz: 'En Android, el aviso Instalar Torre aparece arriba. Tócalo: tu celular te pide confirmar y Torre queda en tu pantalla de inicio.',
      accion: async (p) => { await avisoAndroid(p); await pausa(700); await senalar(p, btn(p, /instalar torre/i)); await mirar(800); } },
    { url: '/propietario/inicio', pantalla: 'Android: se señala «Ahora no», que quita el aviso de ese celular',
      voz: 'Si no quieres instalarla ahora, toca Ahora no. Ese aviso no vuelve a salir en este celular.',
      accion: async (p) => { await avisoAndroid(p); await pausa(700); await mirar(400); await senalar(p, p.getByRole('button', { name: /ahora no/i })); await mirar(800); } },
    { ua: UA_IPHONE, url: '/propietario/inicio', pantalla: 'iPhone (Safari): el aviso explica «Compartir» y «Agregar a inicio»; se señala el texto',
      voz: 'En iPhone, Torre se instala desde Safari. Toca el botón Compartir, y luego Agregar a inicio. Torre queda con su ícono, como cualquier app.',
      accion: async (p) => { await mirar(600); await senalar(p, p.getByText(/agregar a inicio/i).first()); await mirar(900); } },
  ]);

  V['m-todos-instalar'].formato = 'celular';

  return V;
}

/** Safari en iPhone: el aviso de «Agregar a inicio» sale sólo con este navegador (sin evento de instalación). */
export const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

/** Menú de cada rol → video. `comparte`: la opción usa el video de otro rol (misma pantalla). */
export const MENU = [
  // Primera de la lista: no es una opción de menú de un rol, sino cómo tener Torre en el celular (formato 9:16).
  { id: 'todos.instalar', rol: 'todos', menu: 'Ten Torre en tu celular', ruta: '/login', video: 'm-todos-instalar', formato: 'celular' },
  ...[
    ['Resumen', '/admin/dashboard', 'm-admin-resumen'], ['Condominios', '/admin/complejos', 'm-admin-condominios'], ['Recibos', '/admin/recibos', 'm-admin-recibos'],
    ['Pagos', '/admin/pagos', 'm-admin-pagos'], ['Conciliación', '/admin/conciliacion', 'm-admin-conciliacion'], ['Medios de pago', '/admin/medios-pago', 'm-admin-medios-pago'],
    ['Lecturas de agua', '/admin/agua', 'm-admin-agua'], ['Morosidad', '/admin/morosidad', 'm-admin-morosidad'], ['Cierres del mes', '/admin/cierres', 'm-admin-cierres'],
    ['Rendición del mes', '/admin/rendicion', 'm-admin-rendicion'], ['Unidades', '/admin/unidades', 'm-admin-unidades'], ['Mantenimiento', '/admin/mantenimientos', 'm-admin-mantenimiento'],
    ['Conceptos', '/admin/conceptos', 'm-admin-conceptos'], ['Comunicados', '/admin/comunicados', 'm-admin-comunicados'], ['Áreas comunes', '/admin/areas-comunes', 'm-admin-areas-comunes'],
    ['Juntas directivas', '/admin/juntas', 'm-admin-juntas'], ['WhatsApp', '/admin/whatsapp', 'm-admin-whatsapp'], ['Proveedores', '/admin/proveedores', 'm-admin-proveedores'],
    ['Mi empresa', '/admin/configuracion', 'm-admin-mi-empresa'], ['Tu marca (en Mi empresa)', '/admin/configuracion', 'm-admin-marca'], ['Mi plan', '/admin/mi-plan', 'm-admin-mi-plan'],
  ].map(([menu, ruta, video]) => ({ rol: 'admin', menu, ruta, video })),
  ...[
    ['Inicio', 'inicio', 'm-propietario-inicio'], ['Mis unidades', 'unidades', 'm-propietario-unidades'], ['Mis recibos', 'cargos', 'm-propietario-recibos'],
    ['Mi historial', 'pagos', 'm-propietario-historial'], ['Mi junta', 'junta', 'm-propietario-junta'], ['Proveedores', 'proveedores', 'm-propietario-proveedores'],
    ['Comunicados', 'comunicados', 'm-propietario-comunicados'], ['Reservas', 'reservas', 'm-propietario-reservas'],
  ].map(([menu, tramo, video]) => ({ rol: 'propietario', menu, ruta: `/propietario/${tramo}`, video })),
  // El inquilino ve las mismas pantallas (sin «Mis unidades»): comparte los videos del propietario.
  ...[
    ['Inicio', 'inicio', 'm-propietario-inicio'], ['Mis recibos', 'cargos', 'm-propietario-recibos'], ['Mi historial', 'pagos', 'm-propietario-historial'],
    ['Mi junta', 'junta', 'm-propietario-junta'], ['Proveedores', 'proveedores', 'm-propietario-proveedores'], ['Comunicados', 'comunicados', 'm-propietario-comunicados'],
    ['Reservas', 'reservas', 'm-propietario-reservas'],
  ].map(([menu, tramo, video]) => ({ rol: 'inquilino', menu, ruta: `/inquilino/${tramo}`, video, comparte: 'propietario' })),
  ...[
    ['Mi junta', '/junta/mi-junta', 'm-junta-mi-junta'], ['Medios de pago', '/junta/medios-pago', 'm-junta-medios-pago'], ['Pagos por validar', '/junta/pagos', 'm-junta-pagos'],
    ['Cierre del mes', '/junta/cierre', 'm-junta-cierre'], ['Comunicados', '/junta/comunicados', 'm-junta-comunicados'], ['Proveedores', '/junta/proveedores', 'm-junta-proveedores'],
  ].map(([menu, ruta, video]) => ({ rol: 'junta', menu, ruta, video })),
  // No se pudo grabar: la pantalla de la junta responde «Tu usuario no tiene una empresa asignada» (ver HANDOFF). Mientras tanto, el video de la administración muestra el mismo informe.
  { rol: 'junta', menu: 'Rendición del mes', ruta: '/junta/rendicion', video: null, video_alterno: 'm-admin-rendicion', nota: 'La pantalla de la junta falla en local («Tu usuario no tiene una empresa asignada»); no se grabó. El video de la administración muestra el mismo informe.' },
  { rol: 'junta_central', menu: 'Aportes de los blocks', ruta: '/junta/aportes', video: 'm-junta-aportes' },
  { rol: 'junta_central', menu: 'Cierre de la Junta central', ruta: '/junta/cierre-central', video: 'm-junta-cierre-central' },
  { rol: 'mantenimiento', menu: 'Inicio', ruta: '/mantenimiento/inicio', video: 'm-mantenimiento-inicio' },
  { rol: 'mantenimiento', menu: 'Mis tareas', ruta: '/mantenimiento/tareas', video: 'm-mantenimiento-tareas' },
  { rol: 'seguridad', menu: 'Inicio', ruta: '/seguridad/inicio', video: 'm-seguridad-inicio' },
  { rol: 'seguridad', menu: 'Unidades', ruta: '/seguridad/unidades', video: 'm-seguridad-unidades' },
  { rol: 'limpieza', menu: 'Inicio', ruta: '/limpieza/inicio', video: 'm-limpieza-inicio' },
  { rol: 'limpieza', menu: 'Mis tareas', ruta: '/limpieza/tareas', video: 'm-limpieza-tareas' },
  { rol: 'jardineria', menu: 'Inicio', ruta: '/jardineria/inicio', video: 'm-limpieza-inicio', comparte: 'limpieza' },
  { rol: 'jardineria', menu: 'Mis tareas', ruta: '/jardineria/tareas', video: 'm-limpieza-tareas', comparte: 'limpieza' },
  ...['admin', 'propietario', 'inquilino', 'junta', 'mantenimiento', 'seguridad', 'limpieza', 'jardineria'].map((rol) => ({ rol, menu: 'Mi perfil', ruta: '/perfil', video: 'm-perfil', ...(rol === 'propietario' ? {} : { comparte: 'propietario' }) })),
];

/** Escenas listas para `grabar-video.mjs` (necesita las utilidades de grabación). */
export function escenasManual(util) {
  const cat = catalogo(util);
  return Object.fromEntries(Object.entries(cat).map(([id, v]) => [id, v.escenas]));
}

// ---------------------------------------------------------------- Herramientas de línea de comandos
const RAIZ = process.cwd();
/** Formato de un video: «escritorio» (16:9) salvo los que lo declaran (p. ej. «celular», 9:16). */
const formatoDe = (id) => catalogo()[id]?.formato ?? 'escritorio';
const mp4 = (id) => join(RAIZ, '.claude/videos', id, `torre-${id}-${formatoDe(id)}.mp4`);
const duracionDe = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const ETIQUETA_ROL = { todos: 'Todos', admin: 'Administradora', propietario: 'Propietario', inquilino: 'Inquilino', junta: 'Junta (tesorero o presidente de un block)', junta_central: 'Junta central', mantenimiento: 'Mantenimiento', seguridad: 'Seguridad', limpieza: 'Limpieza', jardineria: 'Jardinería' };

function escribirLista() {
  const cat = catalogo();
  const lista = MENU.map((m) => {
    const id = m.video ?? m.video_alterno;
    const v = id ? cat[id] : null;
    const f = m.video ? mp4(m.video) : null;
    const enlistado = { id: m.id ?? `${m.rol}.${m.menu.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`, rol: m.rol, rol_nombre: ETIQUETA_ROL[m.rol], menu: m.menu, ruta: m.ruta, video: m.video, titulo: v?.titulo ?? m.menu, descripcion: v?.descripcion ?? '' };
    if (m.video && formatoDe(m.video) !== 'escritorio') enlistado.formato = formatoDe(m.video);
    if (m.comparte) enlistado.comparte_con = m.comparte;
    if (m.video_alterno) enlistado.video_alterno = m.video_alterno;
    if (m.nota) enlistado.nota = m.nota;
    if (f && existsSync(f)) { enlistado.archivo = `.claude/videos/${m.video}/torre-${m.video}-${formatoDe(m.video)}.mp4`; enlistado.duracion_s = Math.round(duracionDe(f) * 10) / 10; }
    return enlistado;
  });
  mkdirSync(join(RAIZ, 'docs/marketing'), { recursive: true });
  writeFileSync(join(RAIZ, 'docs/marketing/manual-videos.json'), JSON.stringify(lista, null, 2) + '\n');
  console.log(`docs/marketing/manual-videos.json: ${lista.length} opciones de menú, ${new Set(lista.map((x) => x.video).filter(Boolean)).size} videos`);
}

function escribirGuiones() {
  const cat = catalogo();
  const dur = (id) => (existsSync(mp4(id)) ? ` · ${duracionDe(mp4(id)).toFixed(1).replace('.', ',')} s` : '');
  const out = [
    '# Guiones de los videos del manual de Torre',
    '',
    `Un video corto (15–40 s) por opción del menú de cada rol, en **escritorio (16:9)**; «Ten Torre en tu celular» va en **celular (9:16)**. ${Object.keys(cat).length} videos distintos; los que comparten pantalla se reusan`,
    '(el inquilino usa los del propietario, jardinería los de limpieza, «Mi perfil» es uno solo). Se generan con `scripts/marketing/videos-manual.mjs --guiones`',
    '(este archivo se regenera; el texto vive en ese módulo). Voz «Dora» de My Workspace (`ef_dora`); método en `docs/marketing/guiones-videos.md` y `docs/manual/README.md`.',
    '',
    'Reglas: tuteo, neutro en género, frases cortas, sin precios, explican PARA QUÉ sirve la opción y cómo se usa lo principal. Sin cierre de marca.',
    'Ninguna escena envía, publica ni guarda: lo que podría hacerlo sólo se señala.',
    '',
    '---',
    '',
  ];
  for (const [id, v] of Object.entries(cat)) {
    out.push(`## \`${id}\` — ${v.titulo} (${ETIQUETA_ROL[v.rol === 'tesorero' ? 'junta' : v.rol === 'central' ? 'junta_central' : v.rol]})${dur(id)}`, '', v.descripcion, '', '| # | En pantalla | Voz |', '|---|---|---|');
    v.escenas.forEach((e, i) => out.push(`| ${i + 1} | ${e.pantalla} | ${e.voz} |`));
    out.push('');
  }
  writeFileSync(join(RAIZ, 'docs/marketing/guiones-manual.md'), out.join('\n'));
  console.log(`docs/marketing/guiones-manual.md: ${Object.keys(cat).length} videos`);
}

function escribirVoz() {
  const cat = catalogo();
  const voces = Object.entries(cat).flatMap(([id, v]) => v.escenas.map((e, i) => ({ video: id, escena: i + 1, texto: e.voz })));
  mkdirSync(join(RAIZ, '.claude/videos'), { recursive: true });
  writeFileSync(join(RAIZ, '.claude/videos/voz-manual.json'), JSON.stringify(voces, null, 1));
  console.log(`.claude/videos/voz-manual.json: ${voces.length} voces`);
}

/** Tareas de prueba para que «Mis tareas» de mantenimiento y limpieza no salgan vacías (base LOCAL; se crean sólo si faltan). */
async function preparar() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { request } = require(process.env.PLAYWRIGHT ?? '/opt/homebrew/lib/node_modules/playwright');
  const APP = process.env.APP_URL ?? 'http://localhost:5173';
  const api = await request.newContext({ baseURL: APP });
  const [email, password] = CUENTAS_MANUAL.admin;
  const r = await api.post('/api/auth/login', { data: { email, password } });
  if (!r.ok()) throw new Error(`login admin: ${r.status()}`);
  const csrf = (await (await api.get('/api/auth/me')).json()).csrf;
  const h = { 'x-csrf-token': csrf, origin: APP };
  const idDe = async (correo) => ((await (await api.get(`/api/usuarios?pageSize=10&q=${encodeURIComponent(correo)}`)).json()).items ?? []).find((u) => u.email === correo)?.id;
  const maria = await idDe('maria.fernandez@administradorademo.example'), lucia = await idDe('limpieza@prueba.house');
  const TAREAS = [
    [maria, 'Revisar la bomba de agua del cuarto de máquinas', 'Escuchar el ruido y revisar la presión.', 'pendiente'],
    [maria, 'Cambiar las luminarias del pasillo del piso 3', 'Reponer las que están apagadas.', 'en_progreso'],
    [lucia, 'Limpieza del hall y las escaleras del Block 1', 'Barrer, trapear y desinfectar las barandas.', 'pendiente'],
    [lucia, 'Lavado de la cisterna', 'Coordinar el corte de agua con la administración.', 'en_progreso'],
  ];
  const existentes = (await (await api.get('/api/tareas?pageSize=100')).json()).items ?? [];
  for (const [asignado_id, titulo, descripcion, estado] of TAREAS) {
    if (!asignado_id) { console.warn('  sin usuario para', titulo); continue; }
    if (existentes.some((t) => t.titulo === titulo)) { console.log('  ya existe:', titulo); continue; }
    const c = await api.post('/api/tareas', { headers: h, data: { titulo, descripcion, estado, asignado_id } });
    console.log(c.ok() ? '  creada:' : `  FALLÓ (${c.status()}):`, titulo);
  }
  // Grupos de WhatsApp para «Mis grupos» y los comunicados: lo mismo que `prepararGrupos` de capturas-manual.mjs. Pide la lista al Evolution FALSO
  // (sólo si el backend local apunta a él); si no responde, avisa y sigue.
  try {
    let d = await (await api.get('/api/whatsapp/grupos')).json();
    if (!d.grupos?.length) d = await (await api.post('/api/whatsapp/grupos/sincronizar', { headers: h })).json();
    const cond = d.condominios?.[0];
    const bloque = (n) => cond?.estructuras?.find((e) => e.nombre === `Block ${n}`)?.id;
    const b1 = bloque(1);
    // Blocks 1 a 13 con grupo de su block (el 14 queda SIN grupo, para que «Grupos de blocks» diga 13 de 14 y el aviso de cobertura se vea).
    const DE_BLOCKS = Array.from({ length: 13 }, (_, i) => [`Vecinos Block ${i + 1} · Libertadores`, { destino: 'block', estructura_id: bloque(i + 1) }]);
    const QUIERO = [...DE_BLOCKS, ['Junta Block 1', { destino: 'junta_block', estructura_id: b1 }], ['Grupo personal 30', { destino: 'condominio', complejo_id: cond?.id }]];
    for (const [nombre, dest] of QUIERO) {
      const g = d.grupos?.find((x) => x.nombre === nombre);
      if (!g || g.en_uso) continue;
      const r = await api.put(`/api/whatsapp/grupos/${g.id}`, { headers: h, data: { en_uso: true, ...dest } });
      console.log(r.ok() ? '  grupo en uso:' : `  FALLÓ grupo (${r.status()}):`, nombre);
    }
  } catch (e) { console.warn('  AVISO grupos de WhatsApp:', e.message.split('\n')[0]); }
  await api.dispose();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = process.argv[2];
  if (arg === '--lista') escribirLista();
  else if (arg === '--guiones') escribirGuiones();
  else if (arg === '--voz') escribirVoz();
  else if (arg === '--preparar') await preparar();
  else if (arg === '--todos') console.log(Object.keys(catalogo()).join('\n'));
  else if (arg === '--formato') console.log(formatoDe(process.argv[3])); // escritorio | celular (lo usa grabar-manual.sh)
  else if (arg === '--voz-falta') { // escenas de un video a las que les falta su voz (.wav)
    const id = process.argv[3]; const n = catalogo()[id]?.escenas.length ?? 0;
    console.log(Array.from({ length: n }, (_, i) => i + 1).filter((i) => !existsSync(join(RAIZ, '.claude/videos', id, 'voz', `e${i}.wav`))).join(' '));
  }
  else if (arg === '--pendientes') console.log(Object.keys(catalogo()).filter((id) => !existsSync(mp4(id))).join('\n'));
  else { console.error('Uso: videos-manual.mjs --lista | --guiones | --voz | --preparar | --pendientes | --todos | --voz-falta <id>'); process.exit(1); }
}
