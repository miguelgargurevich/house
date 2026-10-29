// Comunicados, Proveedores y Avisos de la junta: pruebas de FUENTE de la UI (regex sobre el .tsx) y de las listas de rutas/menú.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { NAV, navPara } from '../src/app/nav';
import { RUTAS_JUNTA, RUTAS_POR_ROL, rutaPermitida } from '../src/server/lib/rutasApp';
import { TIPOS } from '../src/server/services/avisos/plantillas';
import { textoPublicado } from '../src/pages/admin/_parts/comunicados/tipos';
import { alcanceDe, origenLabel } from '../src/pages/residente/_parts/comunicados/tipos';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const ADMIN = 'src/pages/admin/';
const RES = 'src/pages/residente/_parts/';
const app = f('src/App.tsx');
/** El bloque de rutas (`<Route element={…}>` … `</Route>`) que arranca en `apertura`. */
const bloque = (apertura: string) => {
  const i = app.indexOf(apertura);
  assert.ok(i >= 0, `no está ${apertura}`);
  return app.slice(i, app.indexOf('</Route>', i));
};
const items = (r: Parameters<typeof navPara>[0]) => navPara(r).flatMap((g) => g.items.map((i) => i.to));
const usuario = (rol: 'propietario' | 'inquilino' | 'admin', cargo_junta: 'presidente' | 'tesorero' | 'secretario' | 'vocal' | null = null) => ({ rol, cargo_junta, complejo_id: 1 }) as const;

describe('comunicados: el cuerpo es TEXTO, nunca HTML', () => {
  const archivos = [`${RES}comunicados/ComunicadoItem.tsx`, `${RES}ComunicadosResidente.tsx`, `${RES}ComunicadosInicio.tsx`, `${ADMIN}Comunicados.tsx`, `${ADMIN}_parts/comunicados/ComunicadoModal.tsx`, 'src/pages/propietario/Comunicados.tsx', 'src/pages/inquilino/Comunicados.tsx'];

  it('ningún archivo de comunicados inyecta HTML', () => {
    for (const a of archivos) assert.doesNotMatch(f(a), /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/, a);
  });

  it('el residente lee el cuerpo como texto, con sus saltos de línea (whitespace-pre-line) y que no se salga del 375 px', () => {
    const s = f(`${RES}comunicados/ComunicadoItem.tsx`);
    assert.match(s, /<p className=\{`[^`]*whitespace-pre-line[^`]*break-words[^`]*`\}>\{c\.cuerpo\}<\/p>/);
    assert.match(s, /<h3 className="[^"]*break-words[^"]*">\{c\.titulo\}<\/h3>/);
  });

  it('el Inicio recorta el texto (line-clamp-3) y la lista completa lo muestra entero', () => {
    const s = f(`${RES}comunicados/ComunicadoItem.tsx`);
    assert.match(s, /compacto \? 'line-clamp-3' : ''/);
    assert.match(f(`${RES}ComunicadosInicio.tsx`), /<ComunicadoItem key=\{c\.id\} c=\{c\} compacto \/>/);
    assert.doesNotMatch(f(`${RES}ComunicadosResidente.tsx`), /compacto/);
  });

  it('la gestión muestra el texto en una línea recortada (sin HTML) y el aviso del alcance también cabe en el celular', () => {
    const s = f(`${ADMIN}Comunicados.tsx`);
    assert.match(s, /<p className="truncate text-xs text-muted">\{c\.cuerpo\.replace\(/);
    assert.match(s, /sm:hidden">\{alcanceLabel\(c\)\} · \{fechaCorta\(c\.created_at\)\}/);
  });
});

describe('comunicados: menú y rutas', () => {
  it('los residentes tienen «Comunicados» en su menú, con la ruta de su rol', () => {
    assert.ok(items(usuario('propietario')).includes('/propietario/comunicados'));
    assert.ok(items(usuario('inquilino')).includes('/inquilino/comunicados'));
    assert.ok(!items(usuario('propietario')).includes('/inquilino/comunicados'));
    for (const rol of ['propietario', 'inquilino'] as const) {
      const it = NAV[rol].flatMap((g) => g.items).find((i) => i.label === 'Comunicados');
      assert.ok(it, rol);
    }
  });

  it('el admin y el superadmin lo tienen en Operación, justo después de Avisos', () => {
    for (const rol of ['admin', 'superadmin'] as const) {
      const operacion = NAV[rol].find((g) => g.label === 'Operación')!;
      const rutas = operacion.items.map((i) => i.to);
      assert.equal(rutas[rutas.indexOf('/admin/avisos') + 1], '/admin/comunicados', rol);
    }
  });

  it('el grupo Junta (presidente y tesorero): Medios de pago, Pagos por validar, Lecturas de agua, Comunicados, Proveedores, Avisos; secretario y vocal no lo tienen', () => {
    for (const cargo of ['presidente', 'tesorero'] as const) {
      const junta = navPara(usuario('propietario', cargo)).find((g) => g.label === 'Junta')!;
      assert.deepEqual(junta.items.map((i) => i.label), ['Medios de pago', 'Pagos por validar', 'Lecturas de agua', 'Comunicados', 'Proveedores', 'Avisos']);
      assert.deepEqual(junta.items.map((i) => i.to), ['/junta/medios-pago', '/junta/pagos', '/junta/agua', '/junta/comunicados', '/junta/proveedores', '/junta/avisos']);
    }
    for (const cargo of ['secretario', 'vocal', null] as const) {
      assert.ok(!navPara(usuario('propietario', cargo)).some((g) => g.label === 'Junta'), String(cargo));
      assert.ok(!items(usuario('propietario', cargo)).some((r) => r.startsWith('/junta/')), String(cargo));
    }
  });

  it('RUTAS_POR_ROL y RUTAS_JUNTA al día; el asistente sólo conoce /junta/* a la junta', () => {
    assert.ok(RUTAS_POR_ROL.propietario.includes('/propietario/comunicados'));
    assert.ok(RUTAS_POR_ROL.inquilino.includes('/inquilino/comunicados'));
    assert.ok(RUTAS_POR_ROL.admin.includes('/admin/comunicados') && RUTAS_POR_ROL.superadmin.includes('/admin/comunicados'));
    for (const r of ['/junta/comunicados', '/junta/proveedores', '/junta/avisos']) {
      assert.ok((RUTAS_JUNTA as readonly string[]).includes(r), r);
      const presi = { rol: 'propietario' as const, cargo_junta: 'presidente', complejo_id: 1, estructura_id: null, id: 1, email: 'x', empresa_id: null };
      assert.equal(rutaPermitida(presi, r), r);
      assert.equal(rutaPermitida({ ...presi, cargo_junta: 'secretario' }, r), null);
      assert.equal(rutaPermitida({ ...presi, rol: 'inquilino', cargo_junta: null }, r), null);
    }
  });

  it('App.tsx: cada ruta nueva está dentro de la guarda correcta', () => {
    const junta = bloque('<Route element={<RequireJunta />}>');
    assert.match(junta, /path="\/junta\/comunicados" element=\{<AdminComunicados \/>\}/);
    assert.match(junta, /path="\/junta\/proveedores" element=\{<AdminProveedores \/>\}/);
    assert.match(junta, /path="\/junta\/avisos" element=\{<AdminAvisos \/>\}/);
    assert.match(bloque("<Route element={<RequireRole roles={['superadmin','admin']} />}>"), /path="\/admin\/comunicados" element=\{<AdminComunicados \/>\}/);
    assert.match(bloque("<Route element={<RequireRole roles={['propietario']} />}>"), /path="\/propietario\/comunicados" element=\{<PropietarioComunicados \/>\}/);
    assert.match(bloque("<Route element={<RequireRole roles={['inquilino']} />}>"), /path="\/inquilino\/comunicados" element=\{<InquilinoComunicados \/>\}/);
  });

  it('cada pantalla nueva del menú existe como ruta en App.tsx', () => {
    for (const to of ['/admin/comunicados', '/propietario/comunicados', '/inquilino/comunicados', '/junta/comunicados', '/junta/proveedores', '/junta/avisos']) assert.ok(app.includes(`path="${to}"`), to);
  });
});

describe('comunicados: pantalla de gestión (administración y junta)', () => {
  const s = f(`${ADMIN}Comunicados.tsx`);
  const m = f(`${ADMIN}_parts/comunicados/ComunicadoModal.tsx`);

  it('lista con título, alcance, fecha, fijado y enviado por; archiva con ConfirmDialog', () => {
    for (const col of ["key: 'titulo'", "key: 'alcance'", "key: 'fecha'", "key: 'autor'", "key: 'acciones'"]) assert.ok(s.includes(col), col);
    assert.match(s, /aria-label="Fijado"/);
    assert.match(s, /header: 'Enviado por'/);
    assert.match(s, /<ConfirmDialog[\s\S]*onConfirm=\{confirmarArchivar\}[\s\S]*title="Archivar comunicado"/);
    assert.match(s, /\/api\/comunicados\/\$\{archivar\.id\}\/archivar/);
    assert.match(s, /archivados: pestana === 'archivados' \? 'true' : undefined/);
  });

  it('en el celular las columnas secundarias se esconden', () => {
    assert.match(s, /key: 'alcance'[^\n]*hideBelow: 'sm'/);
    assert.match(s, /key: 'fecha'[^\n]*hideBelow: 'md'/);
    assert.match(s, /key: 'autor'[^\n]*hideBelow: 'lg'/);
  });

  it('la misma pantalla sirve a la junta: sale de /api/comunicados/ambitos y no pide /api/complejos', () => {
    assert.match(f(`${ADMIN}_parts/comunicados/useAmbitos.ts`), /useResource<Ambitos>\('\/api\/comunicados\/ambitos'\)/);
    assert.doesNotMatch(s + m, /\/api\/complejos|\/api\/estructuras/);
    assert.match(s, /const esJunta = user\?\.rol === 'propietario'/);
  });

  it('el modal: condominio, alcance, título, mensaje y «Fijar arriba»; las casillas de envío SÓLO al crear', () => {
    for (const t of ['label="Condominio"', 'label="Para quién"', 'label="Título"', 'label="Mensaje"', 'label="Fijar arriba"']) assert.ok(m.includes(t), t);
    assert.match(m, /\{nuevo && \(\s*<fieldset[\s\S]*label="Enviar por correo"[\s\S]*label="Enviar por WhatsApp"[\s\S]*<\/fieldset>\s*\)\}/);
    assert.match(m, /maxLength=\{TOPE_TITULO\}/);
    assert.match(m, /maxLength=\{TOPE_CUERPO\}/);
    // Editar sólo manda título, mensaje y fijado: nunca las casillas de envío ni el alcance.
    assert.match(m, /method: 'PUT', json: \{ titulo: v\.titulo, cuerpo: v\.cuerpo, fijado: v\.fijado \}/);
  });

  it('la junta de un block no elige «todo el condominio»: el alcance va bloqueado en su block (`fijo`)', () => {
    assert.match(m, /disabled=\{ambitos\.fijo\}/);
    assert.match(m, /\{!ambitos\.fijo && <option value="">Todo el condominio<\/option>\}/);
    assert.match(m, /ambitos\.fijo \? String\(bloques\[0\]\?\.id \?\? ''\)/);
  });

  it('al publicar el aviso dice cuántos avisos se encolaron', () => {
    assert.match(m, /toast\.ok\(textoPublicado\(r\)\)/);
    assert.equal(textoPublicado({ avisos_encolados: 4, enviar_correo: true, enviar_whatsapp: false }), 'Comunicado publicado. Se encolaron 4 avisos por correo.');
    assert.equal(textoPublicado({ avisos_encolados: 1, enviar_correo: true, enviar_whatsapp: true }), 'Comunicado publicado. Se encolaron 1 aviso por correo y WhatsApp.');
    assert.equal(textoPublicado({ avisos_encolados: 2, enviar_correo: false, enviar_whatsapp: true }), 'Comunicado publicado. Se encolaron 2 avisos por WhatsApp.');
    assert.match(textoPublicado({ avisos_encolados: 0, enviar_correo: true, enviar_whatsapp: false }), /no se envió ningún aviso/);
    assert.equal(textoPublicado({ avisos_encolados: 0, enviar_correo: false, enviar_whatsapp: false }), 'Comunicado publicado');
  });

  it('el formulario cabe en 375 px (una columna) y tiene estado vacío amable', () => {
    assert.match(m, /className="grid gap-4 sm:grid-cols-2"/);
    assert.match(s, /title: hayFiltros \? 'No hay comunicados con estos filtros' : pestana === 'archivados' \? 'No hay comunicados archivados' : 'Aún no hay comunicados'/);
    assert.match(s, /Publica el primero para avisar a tus vecinos/);
  });
});

describe('comunicados: lo que ve el residente', () => {
  it('lista completa y tarjeta del Inicio salen de /api/me/comunicados; el Inicio trae 3 y enlaza a la lista del rol', () => {
    assert.match(f(`${RES}ComunicadosResidente.tsx`), /useList<ComunicadoResidente>\('\/api\/me\/comunicados', \{ pageSize: 10 \}\)/);
    const inicio = f(`${RES}ComunicadosInicio.tsx`);
    assert.match(inicio, /useList<ComunicadoResidente>\('\/api\/me\/comunicados', \{ pageSize: 3 \}\)/);
    assert.match(inicio, /<Link to=\{`\$\{base\}\/comunicados`\}/);
    assert.match(inicio, /title="Comunicados"/);
    assert.match(f(`${RES}InicioResidente.tsx`), /<ComunicadosInicio base=\{base\} \/>/);
  });

  it('las páginas de propietario e inquilino reusan la misma lista; hay estado vacío amable y paginación', () => {
    for (const r of ['src/pages/propietario/Comunicados.tsx', 'src/pages/inquilino/Comunicados.tsx']) assert.match(f(r), /<ComunicadosResidente \/>/);
    const lista = f(`${RES}ComunicadosResidente.tsx`);
    assert.match(lista, /title="Aún no hay comunicados"/);
    assert.match(lista, /<Pager page=\{list\.page\}/);
    assert.match(f(`${RES}ComunicadosInicio.tsx`), /Aún no hay comunicados/);
  });

  it('la tarjeta del Inicio no depende de que cargue el resumen de deuda', () => {
    // Va DESPUÉS del bloque condicional del resumen (`)}`), no dentro: si el resumen falla, los comunicados igual se ven.
    assert.match(f(`${RES}InicioResidente.tsx`), /\)\}\s*<div className="mt-6"><ComunicadosInicio base=\{base\} \/><\/div>/);
  });

  it('textos: alcance y de quién', () => {
    assert.equal(alcanceDe({ estructura: { id: 2, nombre: 'Block 2' }, complejo: { id: 1, nombre: 'Los Libertadores' } }), 'Block 2');
    assert.equal(alcanceDe({ estructura: null, complejo: { id: 1, nombre: 'Los Libertadores' } }), 'Todo Los Libertadores');
    assert.equal(origenLabel('junta'), 'Junta directiva');
    assert.equal(origenLabel('administracion'), 'Administración');
  });
});

describe('junta: Proveedores y Avisos', () => {
  const prov = f(`${ADMIN}Proveedores.tsx`);
  const avisos = f(`${ADMIN}Avisos.tsx`);

  it('Proveedores: la junta no pide condominios, no los elige ni los manda; el compartido es de sólo lectura y no se elimina', () => {
    assert.match(prov, /const esJunta = user\?\.rol === 'propietario'/);
    assert.match(prov, /useResource<Page<Opt>>\(esJunta \? null : '\/api\/complejos\?pageSize=100'\)/);
    assert.match(prov, /\.\.\.\(esJunta \? \{\} : \{ complejo_ids: atiende \}\)/);
    assert.match(prov, /\{!esJunta && <fieldset className="sm:col-span-2">/);
    assert.match(prov, /esJunta && p\.compartido \? \(\s*<span title="[^"]*sólo la administración puede cambiarlo"><Badge>Sólo lectura<\/Badge><\/span>/);
    assert.match(prov, /\{!esJunta && <IconButton label=\{`Eliminar /);
    assert.match(prov, /También atiende a otros condominios/);
  });

  it('Avisos: la junta no ve la tarjeta de canales ni los filtros de condominio, y el comunicado muestra su título', () => {
    assert.match(avisos, /\{!esJunta && <Canales \/>\}/);
    assert.match(avisos, /oculto=\{esJunta\}/);
    assert.match(avisos, /a\.contexto\?\.comunicado && <span[^>]*>\{a\.contexto\.comunicado\.titulo\}<\/span>/);
    assert.match(avisos, /comunicado: 'Comunicado'/);
  });

  it('Avisos: todos los tipos de aviso del servidor tienen su etiqueta en la pantalla', () => {
    for (const t of TIPOS) assert.match(avisos, new RegExp(`\\b${t}: '`), t);
  });
});
