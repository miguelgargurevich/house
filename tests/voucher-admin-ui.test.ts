// Pantalla «Registrar pago» con voucher: la lógica de las fases se prueba de verdad (módulo puro); la estructura de los
// componentes se fija con la fuente (el repo no tiene testing-library: no pinta).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { INTERVALO_SEGUIMIENTO_MS, MAX_CONSULTAS_SEGUIMIENTO, faseVoucher, motivoEnRevision, sigueRevisando, type PagoSeguimiento } from '../src/pages/admin/_parts/mantenimientos/faseVoucher';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const DIR = 'src/pages/admin/_parts/mantenimientos';

const pago = (p: Partial<PagoSeguimiento> = {}): PagoSeguimiento => ({ estado_validacion: 'por_validar', validado_por_ia: false, motivo_rechazo: null, evaluacion: { estado: 'pendiente' }, ...p });

describe('fases del seguimiento del voucher', () => {
  it('sin pago todavía o con la evaluación pendiente: «revisando» (y hay que seguir consultando)', () => {
    assert.equal(faseVoucher(null, 0), 'revisando');
    assert.equal(faseVoucher(pago(), 0), 'revisando');
    assert.equal(faseVoucher(pago({ evaluacion: null }), 0), 'revisando');
    assert.equal(sigueRevisando(faseVoucher(pago(), 0)), true);
  });

  it('validado (por la IA o a mano): «pagado» y se deja de consultar', () => {
    assert.equal(faseVoucher(pago({ estado_validacion: 'validado', validado_por_ia: true, evaluacion: { estado: 'completada', veredicto: 'coincide' } }), 0), 'pagado');
    assert.equal(sigueRevisando('pagado'), false);
  });

  it('rechazado: «rechazado»', () => {
    assert.equal(faseVoucher(pago({ estado_validacion: 'rechazado', motivo_rechazo: 'No es el monto' }), 0), 'rechazado');
  });

  it('la IA terminó sin coincidir, sin poder leer o con error: «en revisión» de inmediato (no valida sola)', () => {
    for (const ev of [
      { estado: 'completada', veredicto: 'no_coincide' }, { estado: 'completada', veredicto: 'revisar' }, { estado: 'completada', veredicto: 'ilegible' },
      { estado: 'no_disponible' }, { estado: 'error' },
    ]) assert.equal(faseVoucher(pago({ evaluacion: ev }), 0), 'en_revision', JSON.stringify(ev));
    assert.equal(sigueRevisando('en_revision'), false);
  });

  it('la IA vio «coincide» pero el pago sigue por validar: espera una segunda lectura (puede estar validando) y luego dice «en revisión»', () => {
    const p = pago({ evaluacion: { estado: 'completada', veredicto: 'coincide' } });
    assert.equal(faseVoucher(p, 1), 'revisando');
    assert.equal(faseVoucher(p, 2), 'en_revision');
  });

  it('se acabó el tiempo: «en revisión» aunque la IA no haya terminado', () => {
    assert.equal(faseVoucher(pago(), 0, true), 'en_revision');
    assert.equal(faseVoucher(null, 0, true), 'en_revision');
    assert.equal(faseVoucher(pago({ evaluacion: { estado: 'completada', veredicto: 'coincide' } }), 0, true), 'en_revision');
  });
});

describe('ritmo de la consulta', () => {
  it('cada 3 s y como máximo 40 veces (~2 min)', () => {
    assert.equal(INTERVALO_SEGUIMIENTO_MS, 3000);
    assert.equal(MAX_CONSULTAS_SEGUIMIENTO, 40);
  });
});

describe('motivo de la revisión: sólo lo que dijo la evaluación', () => {
  it('no disponible / error: el motivo del servidor; completada: el resumen; coincide sin validar: lo explica', () => {
    assert.equal(motivoEnRevision(pago({ evaluacion: { estado: 'no_disponible', error: 'Configura una clave de Gemini' } })), 'Configura una clave de Gemini');
    assert.match(motivoEnRevision(pago({ evaluacion: { estado: 'error', error: 'La respuesta de la IA no se pudo validar' } })), /No se pudo evaluar el voucher: La respuesta de la IA no se pudo validar\./);
    assert.equal(motivoEnRevision(pago({ evaluacion: { estado: 'completada', veredicto: 'no_coincide', resumen: 'El monto no coincide.' } })), 'El monto no coincide.');
    assert.match(motivoEnRevision(pago({ evaluacion: { estado: 'completada', veredicto: 'coincide', resumen: 'Todo bien' } })), /no lo validó sola/);
    assert.match(motivoEnRevision(pago(), true), /tardando más de lo normal/);
  });
});

describe('formulario «Registrar pago» del administrador', () => {
  const form = fuente(`${DIR}/FormPagoMantenimiento.tsx`);

  it('ofrece «Adjuntar voucher (opcional)» con las mismas reglas de archivo que el residente', () => {
    assert.match(form, /label="Adjuntar voucher \(opcional\)"/);
    assert.match(form, /type="file"/);
    assert.match(form, /accept=\{ACCEPT_COMPROBANTE\}/);
    assert.match(form, /errorDeArchivo\(f\)/);
    assert.match(form, /import \{[^}]*\bACCEPT_COMPROBANTE\b[^}]*\} from '..\/..\/..\/shared\/comprobantes'/);
  });

  it('con archivo manda UNA petición multipart; sin archivo, el JSON de siempre', () => {
    assert.match(form, /if \(archivo\) \{[\s\S]*registrarPagoConVoucher<ResultadoPagoMantenimiento>\(ruta,/);
    assert.match(form, /await api\(ruta, \{ method: 'POST', json: \{ metodo_pago: v\.metodo_pago/);
    const finDelVoucher = form.indexOf('return;\n      }');
    assert.ok(finDelVoucher > 0 && !form.slice(finDelVoucher).includes('registrarPagoConVoucher'), 'sin archivo no se usa el multipart');
    assert.equal(form.split('registrarPagoConVoucher<').length - 1, 1, 'una sola llamada al multipart');
  });

  it('si falla con voucher avisa que no se registró nada (se puede reintentar) y no muestra el seguimiento', () => {
    assert.match(form, /No se registró ningún pago: corrige y vuelve a intentar\./);
    assert.match(form, /if \(resultado\) return <SeguimientoVoucher /);
    assert.ok(form.indexOf('setResultado(r)') > form.indexOf('registrarPagoConVoucher'), 'el resultado sólo se fija tras la respuesta del servidor');
  });

  it('con voucher se queda en el resultado hasta «Listo» (onRegistrado) y avisa de inmediato con onPagoCreado', () => {
    assert.match(form, /onListo=\{onRegistrado\}/);
    assert.match(form, /onPagoCreado\?\.\(\)/);
    assert.match(fuente(`${DIR}/MantenimientoAdminModal.tsx`), /<FormPagoMantenimiento [^>]*onRegistrado=\{tras\} onPagoCreado=\{onCambio\} \/>/);
  });

  it('el campo del archivo se llama «voucher», igual que en el servidor', () => {
    assert.match(fuente('src/pages/shared/comprobantes.ts'), /fd\.append\('voucher', archivo, archivo\.name\)/);
    assert.match(fuente('src/server/routes/recibos.ts'), /subirVoucher\.single\('voucher'\)/);
  });

  it('el multipart no fija Content-Type (el navegador pone el boundary) y lleva la cabecera CSRF', () => {
    const f = fuente('src/pages/shared/comprobantes.ts');
    const fn = f.slice(f.indexOf('export async function registrarPagoConVoucher'), f.indexOf('export async function descargarComprobante'));
    assert.match(fn, /\.\.\.csrfHeader\(\)/);
    assert.ok(!/Content-Type/i.test(fn.replace(/Sin Content-Type/g, '')), 'no debe fijar Content-Type');
  });
});

describe('seguimiento: «la IA lo está revisando» y luego el estado', () => {
  const seg = fuente(`${DIR}/SeguimientoVoucher.tsx`);

  it('muestra los mensajes de cada fase y reusa el panel de evaluación y la vista del comprobante', () => {
    assert.match(seg, /Pago registrado: la IA lo está revisando…/);
    assert.match(seg, /validado automáticamente por la IA: el mantenimiento quedó pagado\./);
    assert.match(seg, /Pago registrado: queda en revisión\. \{motivoEnRevision\(pago, agotado\)\}/);
    assert.match(seg, /<EvaluacionPanel /);
    assert.match(seg, /<ComprobanteVista pagoId=\{pagoId\}/);
  });

  it('consulta el detalle del departamento cada 3 s y se detiene al salir de «revisando»', () => {
    assert.match(seg, /api<DetalleMantenimiento>\(`\/api\/recibos\/\$\{reciboId\}\/mantenimientos\/\$\{unidadId\}`\)/);
    assert.match(seg, /if \(!revisando\) return;/);
    assert.match(seg, /setInterval\(/);
    assert.match(seg, /clearInterval\(t\)/);
  });
});
