// Pantallas comerciales: la lógica pura se prueba de verdad; la estructura se fija con la fuente (sin precios en el código del frontend).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { errorDeRespuesta } from '../src/app/asistente/errores';
import { esMotivoSinModulo, mensajeSinResultado } from '../src/pages/shared/esperaEvaluacion';
import { ESTADO_UI, MODULO_NOMBRE, aFechaInput, nombreDePlan } from '../src/pages/shared/_parts/comercial';
import { MOTIVO_SIN_MODULO } from '../src/server/services/evaluacion';
import { MENSAJE_SIN_ASISTENTE } from '../src/server/services/comercial/modulos';
import { TC_MAX, TC_MIN, cuando, textoDelOrigen, textoDelValor, tipoCambioEscritoValido, tipoCambioParaApi } from '../src/pages/superadmin/_parts/suscripciones/tipoCambioTexto';
import { TIPO_CAMBIO_MAX, TIPO_CAMBIO_MIN, tipoCambioValido } from '../src/server/services/comercial/tipoCambio';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

describe('lógica de las pantallas', () => {
  it('el motivo que deja el servidor sin módulo de IA se reconoce (no es un fallo) y no ofrece «reintentar»', () => {
    assert.equal(esMotivoSinModulo(MOTIVO_SIN_MODULO), true);
    assert.equal(esMotivoSinModulo('La IA no pudo leer el comprobante'), false);
    assert.equal(esMotivoSinModulo(null), false);
    assert.match(mensajeSinResultado('no_disponible', 'Sin clave', false) ?? '', /reintentar/);
  });
  it('el 403 del asistente sin módulo se muestra con el texto del servidor y sin reintento', () => {
    const e = errorDeRespuesta(403, MENSAJE_SIN_ASISTENTE);
    assert.equal(e.causa, 'sin_modulo');
    assert.equal(e.mensaje, MENSAJE_SIN_ASISTENTE);
    assert.notEqual(errorDeRespuesta(403, 'Otro motivo').causa, 'sin_modulo');
  });
  it('estados y nombres: cada estado tiene etiqueta; fechas para <input type="date">', () => {
    for (const k of ['gratis', 'solicitada', 'activa', 'por_vencer', 'vencida'] as const) assert.ok(ESTADO_UI[k].label);
    assert.equal(MODULO_NOMBRE.ia_vouchers, 'IA que lee y valida vouchers');
    assert.equal(aFechaInput('2026-11-26T00:00:00.000Z'), '2026-11-26');
    assert.equal(aFechaInput(null), '');
    assert.equal(nombreDePlan('pro'), 'Torre Pro');
  });
});

describe('estructura de las pantallas', () => {
  it('sin precios fijos en el código del frontend: la página de precios y Mi plan sólo leen la API', () => {
    for (const ruta of ['src/pages/publico/Precios.tsx', 'src/pages/publico/Portada.tsx', 'src/pages/admin/MiPlan.tsx', 'src/pages/admin/_parts/plan/ModalSolicitud.tsx', 'src/pages/admin/_parts/plan/ComoPagar.tsx']) {
      const f = fuente(ruta).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.ok(!/S\/\s?\d|['"`]\d+[.,]\d{2}['"`]/.test(f), `${ruta} no debe llevar montos escritos`);
      assert.ok(!/1\.18|0\.18|\* ?1\.1/.test(f), `${ruta} no debe calcular el IGV`);
    }
    const precios = fuente('src/pages/publico/Precios.tsx');
    assert.match(precios, /\/api\/publico\/planes/);
    assert.match(precios, /\/api\/publico\/cotizar/);
    // Los «hechos» de la cabecera viven en `lib/seo/textos` (los comparte el HTML estático para buscadores).
    assert.match(precios + fuente('src/lib/seo/textos.ts'), /Más \$\{cat\.impuesto\.nombre\}/, 'el impuesto es el del país elegido, no un «IGV» fijo');
    assert.doesNotMatch(precios, /IGV incluido/);
  });
  it('rutas públicas y de cuenta: /registro, /precios, /verificar-correo, portada en «/», Mi plan sólo admin y Suscripciones sólo superadmin', () => {
    const app = fuente('src/App.tsx');
    for (const r of ['/registro', '/precios', '/verificar-correo', '/admin/mi-plan', '/superadmin/suscripciones']) assert.ok(app.includes(`path="${r}"`), r);
    assert.match(app, /<Portada \/>/);
    assert.match(app, /RequireRole roles=\{\['admin'\]\}[\s\S]*?\/admin\/mi-plan/);
    const nav = fuente('src/app/nav.ts');
    assert.match(nav, /\/admin\/mi-plan/);
    assert.match(nav, /\/superadmin\/suscripciones/);
  });
  it('registro: señuelo antiabuso oculto y campos con tope de largo; verificación sólo por POST', () => {
    const r = fuente('src/pages/publico/Registro.tsx');
    assert.match(r, /sitio_web/);
    assert.match(r, /aria-hidden="true"/);
    assert.match(r, /tabIndex=\{-1\}/);
    assert.match(r, /maxLength=\{160\}/);
    assert.match(fuente('src/pages/publico/VerificarCorreo.tsx'), /method: 'POST'/);
  });
  it('Login: ofrece reenviar el enlace cuando el servidor dice CORREO_NO_VERIFICADO y enlaza al registro', () => {
    const l = fuente('src/pages/Login.tsx');
    assert.match(l, /CORREO_NO_VERIFICADO/);
    assert.match(l, /reenviar-verificacion/);
    assert.match(l, /to="\/registro"/);
  });
  it('avisos de módulo apagado donde se nota: panel de evaluación y canales de Avisos', () => {
    assert.match(fuente('src/pages/shared/evaluacion.tsx'), /<AvisoModulo modulo="ia_vouchers"/);
    assert.match(fuente('src/pages/admin/_parts/avisos/Canales.tsx'), /<AvisoModulo modulo="whatsapp_avisos"/);
    assert.match(fuente('src/app/asistente/Mensajes.tsx'), /causa !== 'sin_modulo'/);
  });
  it('Suscripciones: «Registrar pago», cambio de plan, historial y edición de precios y datos de pago; «Mi plan» muestra el desglose base + IGV', () => {
    const s = fuente('src/pages/superadmin/Suscripciones.tsx');
    assert.match(s, /Registrar pago/);
    assert.match(s, /Precios y pagos/);
    assert.match(fuente('src/pages/superadmin/_parts/suscripciones/ModalPago.tsx'), /\/pagos`/);
    assert.match(fuente('src/pages/superadmin/_parts/suscripciones/Precios.tsx'), /\/api\/comercial\/configuracion/);
    assert.match(fuente('src/pages/admin/_parts/plan/ComoPagar.tsx'), /IGV/);
  });
  it('impuesto y moneda por país: Mi plan, la solicitud, el pago y el historial usan los del condominio (nada de «IGV» ni «S/» fijos)', () => {
    for (const ruta of ['src/pages/admin/MiPlan.tsx', 'src/pages/admin/_parts/plan/ModalSolicitud.tsx', 'src/pages/admin/_parts/plan/HistorialPagos.tsx', 'src/pages/superadmin/_parts/suscripciones/ModalHistorial.tsx', 'src/pages/superadmin/_parts/suscripciones/ModalPago.tsx']) {
      const f = fuente(ruta).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.match(f, /\bdinero\(/, `${ruta} muestra el dinero con su moneda`);
      assert.doesNotMatch(f, /\bsoles\(|\+ IGV|S\/\s?\d/, `${ruta} no debe llevar soles() ni «+ IGV» fijos`);
    }
    assert.match(fuente('src/pages/admin/MiPlan.tsx'), /c\.impuesto\.nombre/);
    assert.match(fuente('src/pages/admin/MiPlan.tsx'), /precio_consultar/, 'Mi plan avisa «Consúltanos» si el plan no tiene precio en la moneda del país');
    assert.match(fuente('src/pages/admin/_parts/plan/HistorialPagos.tsx'), /p\.impuesto_nombre/, 'el historial muestra el impuesto con que se registró cada pago');
    const m = fuente('src/pages/admin/_parts/plan/ModalSolicitud.tsx');
    assert.match(m, /\/api\/publico\/planes\?pais=/, 'los precios de la solicitud son los del país del condominio');
    assert.match(m, /planes_disponibles/);
    assert.match(m, /Consúltanos/);
  });
  it('Suscripciones › Precios y pagos: «Impuestos y moneda por país» (impuesto, tasa en %, moneda de cobro, abierto) y precios por moneda, contra la API auditada', () => {
    const f = fuente('src/pages/superadmin/_parts/suscripciones/ImpuestosPais.tsx');
    assert.match(f, /Impuestos y moneda por país/);
    assert.match(f, /\/api\/comercial\/impuestos\/\$\{f\.pais\}/);
    assert.match(f, /\/api\/comercial\/planes\/\$\{plan\.clave\}\/precios\/\$\{moneda\}/);
    assert.match(f, /Precios por moneda/);
    assert.match(f, /Consúltanos/);
    const p = fuente('src/pages/superadmin/_parts/suscripciones/Precios.tsx');
    assert.match(p, /<ImpuestosYPrecios /);
    assert.match(p, /impuestos: ImpuestoPais\[\]/);
  });
});

describe('Superadmin › Precios: tarjeta «Tipo de cambio» y precios en dólares al tipo de cambio', () => {
  const auto = { tipo_cambio_usd: '3.7512', tipo_cambio_manual: false, tipo_cambio_at: '2026-10-31T15:00:00.000Z', tipo_cambio_fuente: 'open.er-api.com' };
  const manual = { tipo_cambio_usd: '3.9000', tipo_cambio_manual: true, tipo_cambio_at: '2026-10-31T15:00:00.000Z', tipo_cambio_fuente: 'manual' };
  const vacio = { tipo_cambio_usd: null, tipo_cambio_manual: false, tipo_cambio_at: null, tipo_cambio_fuente: null };

  it('muestra el valor, la fecha (hora de Lima) y si es automático o manual', () => {
    assert.equal(textoDelValor(auto), '1 US$ = S/ 3.7512');
    assert.equal(textoDelValor(manual), '1 US$ = S/ 3.9000');
    assert.equal(textoDelValor(vacio), 'Sin tipo de cambio');
    assert.match(cuando('2026-10-31T15:00:00.000Z'), /31/);
    assert.match(cuando('2026-10-31T15:00:00.000Z'), /10:00/, '15:00 UTC = 10:00 en Lima');
    assert.equal(cuando(null), '—');
    assert.match(textoDelOrigen(auto), /Leído de open\.er-api\.com el .* Se actualiza solo cada 24 horas/);
    assert.match(textoDelOrigen({ ...auto, tipo_cambio_fuente: 'sunat.gob.pe' }), /Leído de sunat\.gob\.pe el .* Se actualiza solo cada 24 horas/, 'la fuente principal (SUNAT) se muestra tal cual');
    assert.match(textoDelOrigen(manual), /Fijado a mano el .* La lectura diaria no lo pisa/);
    assert.match(textoDelOrigen(vacio), /Todavía no se leyó/);
  });

  it('valida lo escrito con el mismo rango que el servidor (2 a 6, punto o coma) y lo manda con punto', () => {
    assert.deepEqual([TC_MIN, TC_MAX], [TIPO_CAMBIO_MIN, TIPO_CAMBIO_MAX], 'el rango de la pantalla es el del servidor');
    for (const ok of ['2', '6', '3.75', '3,75', ' 3.8 ', '3.123456']) { assert.equal(tipoCambioEscritoValido(ok), true, ok); assert.notEqual(tipoCambioValido(tipoCambioParaApi(ok)), null, `el servidor también acepta ${ok}`); }
    for (const mal of ['', 'abc', '1.99', '6.01', '37', '-3', '3.1234567', '3..8']) assert.equal(tipoCambioEscritoValido(mal), false, mal);
    assert.equal(tipoCambioParaApi(' 3,75 '), '3.75');
  });

  it('la tarjeta fija a mano y vuelve a automático contra PUT /api/comercial/tipo-cambio; está en Precios con los datos de la configuración', () => {
    const t = fuente('src/pages/superadmin/_parts/suscripciones/TipoCambio.tsx');
    assert.match(t, /Tipo de cambio/);
    assert.match(t, /api\('\/api\/comercial\/tipo-cambio', \{ method: 'PUT', json \}\)/);
    assert.match(t, /onClick=\{\(\) => void enviar\(\{ automatico: true \}, 'auto'\)\}/, 'el botón de automático manda automatico: true');
    assert.match(t, /onClick=\{\(\) => void enviar\(\{ tipo_cambio: tipoCambioParaApi\(valor\) \}, 'fijar'\)\}/, 'el de fijar manda el valor escrito');
    assert.match(t, /Fijar a mano/);
    assert.match(t, /Volver a automático/);
    assert.match(t, /Actualizar ahora/);
    assert.match(t, /'Manual' : 'Automático'/);
    const p = fuente('src/pages/superadmin/_parts/suscripciones/Precios.tsx');
    assert.match(p, /<TipoCambio c=\{data\.configuracion\} onGuardado=\{reload\} \/>/);
    assert.match(p, /tipo_cambio_usd: string \| null; tipo_cambio_manual: boolean/);
  });

  it('en «Precios por moneda» el dólar sale «al tipo de cambio», sin campos para editarlo; las otras monedas siguen editables', () => {
    const f = fuente('src/pages/superadmin/_parts/suscripciones/ImpuestosPais.tsx');
    assert.match(f, /m === 'USD'\s*\? <PreciosEnDolares /);
    assert.match(f, /: <ul className="divide-y divide-line">\{deCobro\.map\(p => <FilaPrecio /);
    const usd = f.slice(f.indexOf('function PreciosEnDolares'), f.indexOf('function PreciosEnDolares') + 1800).split('\n/**')[0];
    assert.doesNotMatch(usd, /<Input|<Button|api\(/, 'el dólar no se edita');
    assert.match(usd, /Al tipo de cambio/);
    assert.match(usd, /Consúltanos/);
    assert.match(fuente('src/pages/superadmin/_parts/suscripciones/Precios.tsx'), /preciosUsd=\{data\.precios_usd\} tipoCambio=\{data\.configuracion\.tipo_cambio_usd\}/);
  });
});
