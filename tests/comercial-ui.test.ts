// Pantallas comerciales: la lógica pura se prueba de verdad; la estructura se fija con la fuente (sin precios en el código del frontend).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { errorDeRespuesta } from '../src/app/asistente/errores';
import { esMotivoSinModulo, mensajeSinResultado } from '../src/pages/shared/esperaEvaluacion';
import { ESTADO_UI, MODULO_NOMBRE, aFechaInput, nombreDePlan } from '../src/pages/shared/_parts/comercial';
import { MOTIVO_SIN_MODULO } from '../src/server/services/evaluacion';
import { MENSAJE_SIN_ASISTENTE } from '../src/server/services/comercial/modulos';

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
    assert.equal(nombreDePlan('pro'), 'Pro');
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
    assert.match(precios, /IGV incluido/);
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
});
