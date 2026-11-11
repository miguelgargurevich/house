// Contacto, WhatsApp, Libro de Reclamaciones, 404 y bandeja del superadmin (pantallas). El repo no monta React en un navegador: la lógica va en funciones puras
// y el cableado se fija leyendo la fuente; lo que se puede pintar sin red se pinta con `renderToStaticMarkup`.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, it } from 'node:test';
import { esRutaDeLaApp, PREFIJOS_APP } from '../src/pages/publico/rutasApp';
import { PREFIJOS_PRIVADOS, esDesconocida } from '../src/server/seo/rutas';
import { RUTAS_POR_ROL } from '../src/server/lib/rutasApp';
import { textoPlazo, tonoPlazo } from '../src/pages/superadmin/_parts/contactos/tipos';
import { WhatsappFlotante } from '../src/pages/publico/WhatsappFlotante';
import { CONTACTO, LIBRO, NO_ENCONTRADA } from '../src/pages/publico/contacto/textos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const MARCO = f('src/pages/publico/Marco.tsx');
const APP = f('src/App.tsx');
const CONTACTO_TSX = f('src/pages/publico/Contacto.tsx');
const LIBRO_TSX = f('src/pages/publico/LibroReclamaciones.tsx');
const pintar = (el: unknown) => renderToStaticMarkup(createElement(MemoryRouter, null, el as never));

describe('botón flotante de WhatsApp', () => {
  it('es un enlace redondo de 56 px, verde oficial con el logo en blanco, abajo a la derecha, con el texto accesible «Escríbenos por WhatsApp»', () => {
    const html = pintar(createElement(WhatsappFlotante, { enlace: 'https://wa.me/51900000000?text=Hola' }));
    assert.match(html, /aria-label="Escríbenos por WhatsApp"/);
    assert.match(html, /href="https:\/\/wa\.me\/51900000000\?text=Hola"/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer"/);
    for (const clase of ['fixed', 'bottom-4', 'right-4', 'h-14', 'w-14', 'rounded-full', 'bg-\\[#25D366\\]', 'text-white', 'shadow']) assert.match(html, new RegExp(`class="[^"]*${clase}`), clase);
    assert.match(html, /<svg[^>]*viewBox="0 0 24 24"[^>]*aria-hidden="true"/);
    assert.match(html, /<path d="M17\.472 14\.382/, 'el trazo del logo oficial, inline');
  });

  it('el ícono es un componente propio sin imágenes remotas ni librerías, y es la única excepción a los Heroicons', () => {
    const icono = f('src/ui/IconoWhatsapp.tsx');
    assert.match(icono, /export function IconoWhatsapp/);
    assert.doesNotMatch(icono, /https?:\/\/(?!www\.w3\.org)/);
    assert.doesNotMatch(icono, /<img/);
  });

  it('el marco lo pinta sólo si la configuración trae el número (enlace de catalogo.redes.whatsapp) y la app con sesión no lo usa', () => {
    assert.match(MARCO, /\{redes\?\.whatsapp && !sinWhatsapp && <WhatsappFlotante enlace=\{redes\.whatsapp\.enlace\} \/>\}/);
    for (const archivo of ['src/app/Shell.tsx', 'src/auth/guards.tsx']) assert.doesNotMatch(f(archivo), /WhatsappFlotante|publico\/Marco/, archivo);
  });

  it('el pie deja espacio para que el botón no tape sus enlaces en el celular, y se oculta al imprimir', () => {
    assert.match(MARCO, /pb-24 pt-3[^"]*sm:pb-8/);
    assert.match(f('src/pages/publico/WhatsappFlotante.tsx'), /print:hidden/);
  });
});

describe('pie de las páginas públicas', () => {
  it('lleva razón social, RUC, domicilio y correo (de los datos legales), WhatsApp, Instagram y Facebook (de la configuración)', () => {
    for (const trozo of ['datos?.razon_social', 'datos?.ruc', 'datos?.domicilio', 'datos?.correo', 'redes?.whatsapp', 'redes?.instagram', 'redes?.facebook']) assert.ok(MARCO.includes(trozo), trozo);
    assert.match(MARCO, /target="_blank" rel="noopener noreferrer"/);
  });

  it('enlaza Contacto, Privacidad, Términos y «Libro de Reclamaciones» con su ícono de libro (Heroicons)', () => {
    assert.match(MARCO, /<Link to="\/contacto" className=\{vinculo\}>Contacto<\/Link>/);
    assert.match(MARCO, /<Link to="\/libro-de-reclamaciones"[^>]*><BookOpenIcon[^>]*\/> Libro de Reclamaciones<\/Link>/);
    assert.match(MARCO, /import \{[^}]*BookOpenIcon[^}]*\} from '@heroicons\/react\/24\/outline'/);
    assert.match(MARCO, /<Link to="\/app"[^>]*><DevicePhoneMobileIcon[^>]*\/> \{APP_MOVIL\.nombre\}<\/Link>/, 'enlace «App para el celular» en el pie');
  });

  it('ningún dato de contacto está escrito en el marco: ni número, ni correo, ni direcciones de redes', () => {
    assert.doesNotMatch(MARCO, /wa\.me|@torrecondominios|instagram\.com|facebook\.com/);
  });
});

describe('/contacto', () => {
  it('pide nombre, correo, celular, condominio, departamentos, si administra varios condominios y mensaje, y el botón dice «Enviar»', () => {
    for (const etiqueta of ['Tu nombre', 'Correo electrónico', 'Celular (opcional)', 'Nombre del condominio (opcional)', 'Número de departamentos (opcional)', '¿Administras varios condominios?', 'Mensaje']) assert.ok(CONTACTO_TSX.includes(etiqueta), etiqueta);
    assert.match(CONTACTO_TSX, />Enviar<\/Button>/);
  });

  it('envía a POST /api/publico/contacto con el campo trampa oculto y marca el tema demo con ?tema=demo', () => {
    assert.match(CONTACTO_TSX, /'\/api\/publico\/contacto'/);
    assert.match(CONTACTO_TSX, /sitio_web: señuelo/);
    assert.match(CONTACTO_TSX, /aria-hidden="true" className="absolute -left-\[9999px\]/);
    assert.match(CONTACTO_TSX, /params\.get\('tema'\) === 'demo'/);
    assert.match(CONTACTO_TSX, /tema: demo \? 'demo' : eliminar \? 'eliminar_cuenta' : 'consulta'/);
  });

  it('muestra al lado WhatsApp, correo y redes, todos de la configuración', () => {
    for (const trozo of ['redes?.whatsapp', 'datos?.correo', 'redes?.instagram', 'redes?.facebook']) assert.ok(CONTACTO_TSX.includes(trozo), trozo);
    assert.doesNotMatch(CONTACTO_TSX, /wa\.me|instagram\.com|facebook\.com/);
  });

  it('la confirmación es la del servidor: «Recibimos tu mensaje. Te escribimos en menos de 1 día hábil.»', () => {
    assert.equal(CONTACTO.exito, 'Recibimos tu mensaje. Te escribimos en menos de 1 día hábil.');
    assert.match(CONTACTO_TSX, /setListo\(r\.mensaje\)/);
  });

  it('la portada y el plan Administradora de Precios llevan «Solicita una demo» a /contacto?tema=demo', () => {
    assert.equal(CONTACTO.cta_demo, 'Solicita una demo');
    assert.equal(CONTACTO.enlace_demo, '/contacto?tema=demo');
    assert.equal((f('src/pages/publico/Portada.tsx').match(/to=\{CONTACTO\.enlace_demo\}/g) ?? []).length, 2, 'en el hero y en el cierre');
    const planes = f('src/pages/publico/precios/Planes.tsx');
    assert.match(planes, /<Nivel plan=\{adm\}[\s\S]*to=\{CONTACTO\.enlace_demo\}[\s\S]*\{CONTACTO\.cta_demo\}/);
  });
});

describe('/libro-de-reclamaciones', () => {
  it('tiene los campos de la hoja: consumidor, documento, domicilio, correo, teléfono, menor de edad con apoderado, bien contratado, monto, tipo, detalle y pedido', () => {
    for (const etiqueta of ['Nombre completo', 'Tipo de documento', 'Número de documento', 'Domicilio', 'Correo electrónico', 'Teléfono (opcional)', 'El consumidor es menor de edad', 'Nombre del padre, madre o apoderado', 'Es un', 'Monto reclamado en soles (opcional)', 'Detalle', 'Pedido del consumidor']) assert.ok(LIBRO_TSX.includes(etiqueta), etiqueta);
    for (const t of ['dni', 'ce', 'pasaporte', 'ruc']) assert.ok(LIBRO_TSX.includes(`['${t}'`), t);
  });

  it('explica reclamo y queja, la base legal (Ley 29571 y DS 011-2011-PCM), el plazo de 15 días hábiles y la vía INDECOPI', () => {
    assert.match(LIBRO.base_legal, /Ley N\.º 29571/);
    assert.match(LIBRO.base_legal, /D\.S\. N\.º 011-2011-PCM/);
    assert.match(LIBRO.reclamo, /relacionada con los productos o servicios/);
    assert.match(LIBRO.queja, /malestar o descontento respecto a la atención al público/);
    assert.match(LIBRO.plazo, /15 días hábiles/);
    assert.match(LIBRO.indecopi, /INDECOPI/);
    assert.match(LIBRO_TSX, /LIBRO\.reclamo/);
    assert.match(LIBRO_TSX, /LIBRO\[t\]/);
  });

  it('los datos del proveedor salen de la configuración legal, el envío exige aceptar la respuesta por correo y la constancia muestra el número', () => {
    for (const trozo of ['datos.razon_social', 'datos.ruc', 'datos.domicilio']) assert.ok(LIBRO_TSX.includes(trozo), trozo);
    assert.match(LIBRO_TSX, /acepta_respuesta_correo: f\.acepta/);
    assert.match(LIBRO_TSX, /Acepto que la respuesta a mi reclamación se envíe a mi correo electrónico/);
    assert.match(LIBRO_TSX, /disabled=\{!completo\}/);
    assert.match(LIBRO_TSX, /'\/api\/publico\/reclamaciones'/);
    assert.match(LIBRO_TSX, /\{c\.correlativo\}/);
    assert.match(LIBRO_TSX, /sitio_web: señuelo/);
  });
});

describe('404 público y rutas de la app', () => {
  it('«No encontramos esta página» con enlaces a inicio, precios y contacto', () => {
    // (La pantalla usa el marco y `api.ts`, que sólo cargan bajo Vite: se fija leyendo la fuente.)
    const p = f('src/pages/publico/NoEncontrada.tsx');
    assert.equal(NO_ENCONTRADA.h1, 'No encontramos esta página');
    assert.match(p, /\{NO_ENCONTRADA\.h1\}/);
    for (const to of ['"/"', '"/precios"', '"/contacto"']) assert.ok(p.includes(`<Link to=${to}`), to);
    assert.match(p, /meta\.content = 'noindex, nofollow'/);
  });

  it('sin sesión, una dirección desconocida muestra el 404 y una de la app sigue llevando al login; con sesión, a su inicio como siempre', () => {
    assert.match(APP, /esRutaDeLaApp\(pathname\) \? <Navigate to="\/login" replace \/> : <NoEncontrada \/>/);
    assert.match(APP, /return <Navigate to=\{HOME\[user\.rol\]\} replace \/>;/);
    assert.match(APP, /<Route path="\*" element=\{<Landing \/>\} \/>/);
  });

  it('esRutaDeLaApp reconoce las áreas privadas y los enlaces de un solo uso; no /blog, /contacto ni nada público', () => {
    for (const r of ['/admin', '/admin/dashboard', '/admin/una/ruta/que/no/existe', '/superadmin/contactos', '/propietario/inicio', '/junta/pagos', '/perfil', '/verificar-correo', '/invitacion', '/ADMIN/x', '/admin/']) assert.equal(esRutaDeLaApp(r), true, r);
    for (const r of ['/blog', '/contacto', '/libro-de-reclamaciones', '/administracion', '/adminx', '/ruta-que-no-existe', '/precios']) assert.equal(esRutaDeLaApp(r), false, r);
  });

  it('el cliente y el servidor reconocen las mismas rutas privadas (si una lista cambia, la otra también)', () => {
    assert.deepEqual([...PREFIJOS_APP].sort(), PREFIJOS_PRIVADOS.filter(p => p !== '/api/').sort());
    for (const r of ['/blog', '/ruta-que-no-existe', '/contacto-viejo']) assert.equal(esDesconocida(r), true, r);
    for (const r of ['/', '/precios', '/contacto', '/libro-de-reclamaciones', '/login', '/admin/dashboard', '/admin/zzz', '/superadmin/contactos']) assert.equal(esDesconocida(r), false, r);
  });

  it('las rutas públicas nuevas están fuera de la sesión (antes de RequireAuth)', () => {
    const antes = APP.slice(0, APP.indexOf('<Route element={<RequireAuth />}>'));
    assert.match(antes, /path="\/contacto"/);
    assert.match(antes, /path="\/libro-de-reclamaciones"/);
  });
});

describe('superadmin: Contactos y reclamaciones', () => {
  it('la pantalla está en el menú «Plataforma», en la ruta /superadmin/contactos (sólo superadmin) y en la lista de rutas del asistente', () => {
    assert.match(f('src/app/nav.ts'), /to: '\/superadmin\/contactos', label: 'Contactos y reclamaciones'/);
    const rutaSuper = APP.slice(APP.indexOf('<Route element={<RequireRole roles={[\'superadmin\']} />}>'));
    assert.match(rutaSuper.slice(0, rutaSuper.indexOf('</Route>')), /path="\/superadmin\/contactos"/);
    assert.ok(RUTAS_POR_ROL.superadmin.includes('/superadmin/contactos'));
    assert.ok(!RUTAS_POR_ROL.admin.includes('/superadmin/contactos'));
  });

  it('lista mensajes y hojas con sus modales: atender con nota; responder con fecha y nota', () => {
    const p = f('src/pages/superadmin/Contactos.tsx');
    assert.match(p, /'\/api\/comercial\/contactos'/);
    assert.match(p, /'\/api\/comercial\/reclamaciones'/);
    assert.match(f('src/pages/superadmin/_parts/contactos/ModalContacto.tsx'), /method: 'PATCH', json: \{ estado, nota \}/);
    assert.match(f('src/pages/superadmin/_parts/contactos/ModalReclamacion.tsx'), /\{ estado, fecha, nota \}/);
  });

  it('el plazo se lee en días hábiles y en rojo si venció', () => {
    const base = { estado: 'pendiente' as const };
    assert.equal(textoPlazo({ ...base, dias_habiles_restantes: 15 }), 'Faltan 15 días hábiles');
    assert.equal(textoPlazo({ ...base, dias_habiles_restantes: 1 }), 'Faltan 1 día hábil');
    assert.equal(textoPlazo({ ...base, dias_habiles_restantes: 0 }), 'Vence hoy');
    assert.equal(textoPlazo({ ...base, dias_habiles_restantes: -1 }), 'Venció hace 1 día hábil');
    assert.equal(textoPlazo({ ...base, dias_habiles_restantes: -4 }), 'Venció hace 4 días hábiles');
    assert.equal(textoPlazo({ estado: 'respondida', dias_habiles_restantes: null }), 'Respondida');
    assert.equal(tonoPlazo({ ...base, dias_habiles_restantes: -1, vencida: true }), 'bad');
    assert.equal(tonoPlazo({ ...base, dias_habiles_restantes: 2, vencida: false }), 'warn');
    assert.equal(tonoPlazo({ ...base, dias_habiles_restantes: 10, vencida: false }), 'neutral');
    assert.equal(tonoPlazo({ estado: 'respondida', dias_habiles_restantes: null, vencida: false }), 'ok');
  });

  it('Precios edita WhatsApp, su mensaje y Facebook junto a Instagram, con su ayuda', () => {
    const p = f('src/pages/superadmin/_parts/suscripciones/Precios.tsx');
    for (const k of ['whatsapp_contacto', 'whatsapp_mensaje', 'url_facebook']) { assert.ok(p.includes(`'${k}'`), k); assert.ok(p.includes(`${k}: (f.${k} ?? '').trim() || null`), `${k} se envía`); }
    assert.match(p, /<Input label="WhatsApp de contacto"[^>]*hint="Celular con código de país/);
    assert.match(p, /<Input label="Facebook de Torre"[^>]*hint=/);
  });
});

describe('manual y contrato', () => {
  const MANUAL = JSON.parse(f('docs/manual/manual-house.json')) as { kicker: string; secciones: { titulo: string; etiqueta?: string }[] };
  it('el manual (versión 15) trae «Contactos y reclamaciones de la web» tras «Entrar como otra persona», sólo para el superadmin', () => {
    const n = (t: string) => MANUAL.secciones.findIndex(x => x.titulo === t);
    assert.equal(n('Contactos y reclamaciones de la web'), n('Entrar como otra persona (soporte)') + 1);
    assert.match(MANUAL.secciones[n('Contactos y reclamaciones de la web')].etiqueta ?? '', /^Superadmin/);
    const t = JSON.stringify(MANUAL.secciones[n('Contactos y reclamaciones de la web')]);
    for (const frase of ['15 días hábiles', 'feriados', 'rojo', 'Marcar como respondida', 'Contacto y redes de la web pública']) assert.ok(t.includes(frase), frase);
    assert.match(MANUAL.kicker, /\(16\)$/);
  });
  it('API-CONTRATO.md documenta los endpoints nuevos', () => {
    const doc = f('docs/API-CONTRATO.md');
    for (const frase of ['POST /api/publico/contacto', 'POST /api/publico/reclamaciones', 'GET /contactos', 'GET /reclamaciones', 'whatsapp_contacto', 'url_facebook', '15 días **hábiles**', 'No descuenta feriados', '404 real']) assert.ok(doc.includes(frase), frase);
  });
});

describe('sin emojis ni números de contacto en las pantallas nuevas', () => {
  const nuevos = [
    'src/pages/publico/Contacto.tsx', 'src/pages/publico/LibroReclamaciones.tsx', 'src/pages/publico/NoEncontrada.tsx', 'src/pages/publico/WhatsappFlotante.tsx', 'src/pages/publico/Marco.tsx',
    'src/pages/publico/contacto/textos.ts', 'src/ui/IconoWhatsapp.tsx', 'src/pages/superadmin/Contactos.tsx',
    ...readdirSync('src/pages/superadmin/_parts/contactos').map(n => join('src/pages/superadmin/_parts/contactos', n)).filter(n => statSync(n).isFile()),
  ];
  it('ninguno lleva emojis', () => { for (const a of nuevos) assert.equal(/\p{Extended_Pictographic}/u.test(f(a)), false, a); });
});
