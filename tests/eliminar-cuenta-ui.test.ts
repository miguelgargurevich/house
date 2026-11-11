// Pantallas de «Eliminar mi cuenta»: la sección al final de Mi perfil, la página pública /eliminar-cuenta (la URL que pide Google Play), el enlace en el pie de
// las páginas públicas y en la Política de privacidad, el tema del formulario de contacto y el manual. (El navegador real se probó aparte: ver el handoff.)
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, it } from 'node:test';
import { TEMAS_CONTACTO } from '../src/server/services/contacto/solicitud';
import { ELIMINAR_CUENTA, FRASE_CONFIRMAR, PERFIL_ELIMINAR } from '../src/pages/publico/eliminarCuenta/textos';
import { textosPrivacidad } from '../src/pages/publico/legal/textos';
import { FRASE_ELIMINAR } from '../src/server/services/cuenta/eliminar';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const APP = f('src/App.tsx');
const MARCO = f('src/pages/publico/Marco.tsx');
const PERFIL = f('src/pages/shared/Perfil.tsx');
const PARTE = f('src/pages/shared/_parts/EliminarCuentaPerfil.tsx');
const PAGINA = f('src/pages/publico/EliminarCuenta.tsx');
const CONTACTO = f('src/pages/publico/Contacto.tsx');
const BANDEJA = f('src/pages/superadmin/Contactos.tsx');
const SEO_PAGINAS = f('src/server/seo/paginas.ts');
const EMOJI = /\p{Extended_Pictographic}/u;

describe('textos: los mismos en la página pública y en Mi perfil', () => {
  it('explican los pasos desde la app y la web, lo que se borra, lo que se conserva y el caso de la administradora única', () => {
    assert.equal(ELIMINAR_CUENTA.titulo, 'Eliminar tu cuenta de Torre');
    const pasos = ELIMINAR_CUENTA.pasos.join(' ');
    assert.match(pasos, /app o en la web/);
    assert.match(pasos, /Mi perfil/);
    assert.match(pasos, /Eliminar mi cuenta/);
    assert.match(pasos, /ELIMINAR/);
    assert.ok(ELIMINAR_CUENTA.se_borra.length >= 3 && ELIMINAR_CUENTA.se_conserva.length >= 2);
    assert.match(ELIMINAR_CUENTA.se_conserva.join(' '), /recibos, pagos, vouchers/);
    assert.match(ELIMINAR_CUENTA.se_conserva.join(' '), /Cuenta eliminada/);
    assert.match(ELIMINAR_CUENTA.unica_titulo, /única administradora/);
    assert.match(ELIMINAR_CUENTA.unica, /otra administradora activa/);
    assert.match(ELIMINAR_CUENTA.unica, /90 días/);
    assert.match(PERFIL_ELIMINAR.unica_alerta, /90 días/);
  });

  it('quien ya no puede entrar va al formulario de contacto con el tema eliminar-cuenta', () => {
    assert.equal(ELIMINAR_CUENTA.enlace_contacto, '/contacto?tema=eliminar-cuenta');
  });

  it('la frase de la pantalla es la que exige el servidor, y ningún texto lleva emojis', () => {
    assert.equal(FRASE_CONFIRMAR, FRASE_ELIMINAR);
    for (const t of [...Object.values(ELIMINAR_CUENTA).flat(), ...Object.values(PERFIL_ELIMINAR)]) assert.doesNotMatch(String(t), EMOJI);
  });
});

describe('página pública /eliminar-cuenta', () => {
  it('está en el enrutador, antes de la sesión (sin iniciar sesión se ve)', () => {
    assert.match(APP, /const EliminarCuenta = lazy\(\(\) => import\('\.\/pages\/publico\/EliminarCuenta'\)\);/);
    assert.match(APP, /<Route path="\/eliminar-cuenta" element=\{<EliminarCuenta \/>\} \/>/);
    assert.ok(APP.indexOf('path="/eliminar-cuenta"') < APP.indexOf('<Route element={<RequireAuth />}>'));
  });

  it('usa el marco público, el título, los pasos, las dos listas, el caso de la administradora única y el enlace a /contacto?tema=eliminar-cuenta', () => {
    assert.match(PAGINA, /<Marco /);
    assert.match(PAGINA, /<h1 [^>]*>\{T\.titulo\}<\/h1>/);
    for (const k of ['pasos', 'se_borra', 'se_conserva', 'unica', 'sin_acceso']) assert.match(PAGINA, new RegExp(`T\\.${k}\\b`), k);
    assert.match(PAGINA, /<Link to=\{T\.enlace_contacto\}/);
    assert.match(PAGINA, /params\.get\('eliminada'\) === '1'/); // el aviso «Tu cuenta fue eliminada»
    assert.match(PAGINA, /T\.eliminada_titulo/);
    assert.match(PAGINA, /to="\/privacidad#derechos"/);
    assert.doesNotMatch(PAGINA, EMOJI);
  });

  it('la página y la sección de Mi perfil usan sólo íconos de Heroicons (sin emojis) y colores del sistema (claro/oscuro)', () => {
    for (const src of [PAGINA, PARTE]) {
      assert.doesNotMatch(src, EMOJI);
      assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, 'sin colores a mano: sólo tokens');
    }
    assert.match(PARTE, /from '@heroicons\/react\/24\/outline'/);
    assert.match(PAGINA, /from '@heroicons\/react\/24\/outline'/);
  });
});

describe('pie de las páginas públicas y política de privacidad', () => {
  it('el pie legal de todas las páginas públicas enlaza «Eliminar mi cuenta» (y el del HTML que ven los buscadores)', () => {
    assert.match(MARCO, /<nav aria-label="Legal"[\s\S]*?<Link to="\/eliminar-cuenta"[^>]*>Eliminar mi cuenta<\/Link>[\s\S]*?<\/nav>/);
    assert.match(SEO_PAGINAS, /<nav aria-label="Legal">[^`]*A\('\/eliminar-cuenta', 'Eliminar mi cuenta'\)/);
  });

  it('la sección «Tus derechos» de la política enlaza /eliminar-cuenta', () => {
    const derechos = textosPrivacidad({ datos: null, cargando: false }).secciones.find((s) => s.id === 'derechos');
    assert.ok(derechos);
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Fragment, null, derechos.cuerpo as never)));
    assert.match(html, /<a [^>]*href="\/eliminar-cuenta"[^>]*>Eliminar tu cuenta de Torre<\/a>/);
    assert.match(html, /Mi perfil/);
  });
});

describe('Mi perfil: sección «Eliminar mi cuenta»', () => {
  it('va al final de Mi perfil, después de los tokens de API', () => {
    assert.match(PERFIL, /import \{ EliminarCuentaPerfil \} from '\.\/_parts\/EliminarCuentaPerfil';/);
    assert.ok(PERFIL.indexOf('<EliminarCuentaPerfil />') > PERFIL.indexOf('<TokensApiPerfil />'));
    assert.ok(PERFIL.indexOf('<EliminarCuentaPerfil />') > PERFIL.indexOf('<SesionesActivas />'));
  });

  it('botón rojo (danger) que abre el diálogo; pide contraseña y la palabra ELIMINAR; el botón de confirmar espera a que estén', () => {
    assert.equal((PARTE.match(/variant="danger"[^\n]*onClick=\{abrir\}/g) ?? []).length, 2); // «Eliminar mi cuenta» y «Solicitar el cierre»: los dos en rojo
    assert.match(PARTE, /<Modal\b/);
    assert.match(PARTE, /type="password"[^>]*autoComplete="current-password"/);
    assert.match(PARTE, /autoCapitalize="characters"/);
    assert.match(PARTE, /const fraseOk = frase\.trim\(\)\.toUpperCase\(\) === FRASE_CONFIRMAR;/);
    assert.match(PARTE, /const listo = clave\.length > 0 && \(solicitud \|\| fraseOk\);/);
    assert.match(PARTE, /disabled=\{!listo\}/);
    assert.match(PARTE, /type="submit" form="form-eliminar-cuenta"/);
    assert.match(PARTE, /\{error && <Alert tone="bad">\{error\}<\/Alert>\}/); // «La contraseña no es correcta», etc.
  });

  it('eliminar llama a POST /api/me/eliminar y recarga la página pública con el aviso (navegar dentro de la app chocaba con el guardián de sesión y acababa en /login)', () => {
    assert.match(PARTE, /api\('\/api\/me\/eliminar', \{ method: 'POST', json: \{ password: clave, confirmacion: frase\.trim\(\) \} \}\);(\s*\/\/[^\n]*)*\s*window\.location\.replace\('\/eliminar-cuenta\?eliminada=1'\);/);
    assert.doesNotMatch(PARTE, /useNavigate|navigate\(|logout\(\)/);
  });

  it('la única administradora ve el motivo y «Solicitar el cierre de mi empresa» (POST /api/me/solicitar-cierre, sólo con contraseña); si ya lo pidió, el aviso', () => {
    assert.match(PARTE, /const solicitud = data\.modo === 'solicitud';/);
    assert.match(PARTE, /api\('\/api\/me\/solicitar-cierre', \{ method: 'POST', json: \{ password: clave \} \}\)/);
    assert.match(PARTE, /data\.solicitud_pendiente\s*\?\s*<Alert tone="info">\{T\.unica_pendiente\}<\/Alert>/);
    assert.match(PARTE, /\{!solicitud && <Input label=\{T\.campo_frase\}/); // pedir el cierre no pide escribir ELIMINAR
    assert.match(PERFIL_ELIMINAR.unica_boton, /Solicitar el cierre de mi empresa/);
  });

  it('el superadmin y quien está «Entrando como» otra persona no ven la sección; si no se pudo leer, no estorba', () => {
    assert.match(PARTE, /if \(user\?\.impersonando \|\| data\?\.modo === 'no_disponible'\) return null;/);
    assert.match(PARTE, /if \(!data\) return null;/);
  });

  it('dice qué se borra y qué se conserva antes de pedir nada, y que el correo queda libre', () => {
    assert.match(PARTE, /ELIMINAR_CUENTA\.se_borra_titulo/);
    assert.match(PARTE, /ELIMINAR_CUENTA\.se_conserva_titulo/);
    assert.match(PARTE, /ELIMINAR_CUENTA\.libre/);
    assert.match(ELIMINAR_CUENTA.libre, /correo queda libre/);
  });

  it('es la misma web dentro de la app (Capacitor): nada de rutas ni textos propios de la app', () => {
    assert.doesNotMatch(PARTE, /Capacitor|capacitor/);
    assert.doesNotMatch(PAGINA, /Capacitor|capacitor/);
  });
});

describe('formulario de contacto y bandeja del superadmin', () => {
  it('/contacto?tema=eliminar-cuenta guarda el tema «eliminar_cuenta» (el que acepta el servidor) y explica para qué es', () => {
    assert.ok((TEMAS_CONTACTO as readonly string[]).includes('eliminar_cuenta'));
    assert.match(CONTACTO, /params\.get\('tema'\) === 'eliminar-cuenta'/);
    assert.match(CONTACTO, /tema: demo \? 'demo' : eliminar \? 'eliminar_cuenta' : 'consulta'/);
    assert.match(CONTACTO, /\{eliminar && <p [^>]*role="note">\{CONTACTO\.eliminar\}<\/p>\}/);
  });

  it('la bandeja rotula las solicitudes de cierre de empresa y de eliminar cuenta', () => {
    assert.match(BANDEJA, /c\.tema === 'cierre_cuenta' \? <Badge tone="warn">Cierre de empresa<\/Badge>/);
    assert.match(BANDEJA, /c\.tema === 'eliminar_cuenta' \? <Badge tone="warn">Eliminar cuenta<\/Badge>/);
  });
});

describe('manual', () => {
  it('Mi perfil › Eliminar mi cuenta está en «Lo que tienen todas las pantallas» y en las preguntas frecuentes', () => {
    const manual = JSON.parse(f('docs/manual/manual-house.json')) as { secciones: { titulo: string; bullets?: string[] }[] };
    const pantallas = manual.secciones.find((s) => s.titulo === 'Lo que tienen todas las pantallas');
    assert.ok(pantallas?.bullets?.some((b) => /Eliminar tu cuenta/.test(b) && /ELIMINAR/.test(b) && /única administradora/.test(b)));
    const faq = manual.secciones.find((s) => s.titulo === 'Preguntas frecuentes');
    assert.ok(faq?.bullets?.some((b) => /¿Cómo elimino mi cuenta\?/.test(b)));
  });
});
