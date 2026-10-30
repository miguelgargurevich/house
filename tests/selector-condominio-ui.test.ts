// Selector de condominio de la barra superior. El repo no pinta componentes: la lógica pura se prueba importándola y las pantallas con
// pruebas de fuente (qué le piden a la API, qué dejaron de tener y a quién se muestra el selector).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, describe, it } from 'node:test';
import { elegidoValido, guardar, leerGuardado, rutaUsaCondominio } from '../src/app/condominio';

const f = (ruta: string) => readFileSync(ruta, 'utf8');
const ADMIN = 'src/pages/admin/';
const PARTS = 'src/pages/admin/_parts/';

/** `localStorage` de mentira (el repo corre sus pruebas en Node, sin navegador). */
function almacenamiento(inicial: Record<string, string> = {}, falla = false) {
  const datos = new Map(Object.entries(inicial));
  const propio = {
    getItem: (k: string) => { if (falla) throw new Error('bloqueado'); return datos.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (falla) throw new Error('bloqueado'); datos.set(k, v); },
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = propio;
  return datos;
}
afterEach(() => { delete (globalThis as unknown as { localStorage?: unknown }).localStorage; });

describe('rutaUsaCondominio: en qué pantallas rige el condominio de la barra', () => {
  it('las pantallas de administración que se filtran por condominio', () => {
    for (const r of ['/admin/dashboard', '/admin/recibos', '/admin/pagos', '/admin/medios-pago', '/admin/morosidad', '/admin/unidades', '/admin/mantenimientos', '/admin/comunicados', '/admin/avisos', '/admin/juntas', '/admin/residentes', '/admin/personal', '/admin/proveedores']) {
      assert.equal(rutaUsaCondominio(r), true, r);
    }
    assert.equal(rutaUsaCondominio('/admin/pagos/'), true, 'una barra final no cambia la pantalla');
  });

  it('no en las que no tienen condominio o ya son de uno concreto (Conceptos, fichas, un recibo abierto, la empresa y el plan)', () => {
    for (const r of ['/admin/conceptos', '/admin/recibos/12', '/admin/complejos', '/admin/condominios/3', '/admin/configuracion', '/admin/mi-plan', '/admin/whatsapp']) {
      assert.equal(rutaUsaCondominio(r), false, r);
    }
  });

  it('ni en las de plataforma, junta, residentes, personal ni el perfil: ahí no hay selector ni filtro', () => {
    for (const r of ['/superadmin/dashboard', '/superadmin/empresas/2', '/superadmin/usuarios', '/junta/pagos', '/junta/medios-pago', '/junta/mi-junta', '/propietario/inicio', '/inquilino/cargos', '/mantenimiento/tareas', '/perfil', '/', '/admin']) {
      assert.equal(rutaUsaCondominio(r), false, r);
    }
  });
});

describe('elegidoValido: nunca un condominio que el usuario no alcance', () => {
  const c = (...ids: number[]) => ids.map(id => ({ id }));

  it('con un solo condominio, ése (su nombre queda fijo), pidiera lo que pidiera', () => {
    assert.equal(elegidoValido(null, c(7)), 7);
    assert.equal(elegidoValido(99, c(7)), 7);
    assert.equal(elegidoValido(7, c(7)), 7);
  });

  it('con varios, lo elegido si está en su alcance; «Todos» sigue siendo «Todos»', () => {
    assert.equal(elegidoValido(2, c(1, 2, 3)), 2);
    assert.equal(elegidoValido(null, c(1, 2, 3)), null);
  });

  it('lo guardado que ya no está en su alcance (lo borraron, o dejó de administrarlo) vuelve a «Todos»', () => {
    assert.equal(elegidoValido(9, c(1, 2, 3)), null);
    assert.equal(elegidoValido(1, c()), null);
    assert.equal(elegidoValido(null, c()), null);
  });
});

describe('lo elegido se recuerda por usuario en localStorage, sin romper si no hay almacenamiento', () => {
  it('guarda y lee un condominio y «Todos», cada usuario lo suyo', () => {
    const datos = almacenamiento();
    guardar(5, 12);
    guardar(6, null);
    assert.equal(datos.get('house.condominio.5'), '12');
    assert.equal(datos.get('house.condominio.6'), 'todos');
    assert.equal(leerGuardado(5), 12);
    assert.equal(leerGuardado(6), null, '«todos» se lee como null');
    assert.equal(leerGuardado(7), undefined, 'quien nunca eligió no hereda lo de otro');
  });

  it('un valor corrupto se ignora (no un NaN ni un id inventado)', () => {
    almacenamiento({ 'house.condominio.1': 'abc', 'house.condominio.2': '-4', 'house.condominio.3': '1.5', 'house.condominio.4': '' });
    for (const u of [1, 2, 3, 4]) assert.equal(leerGuardado(u), undefined, `usuario ${u}`);
  });

  it('sin almacenamiento (modo privado, sitio bloqueado, pruebas) ni lee ni guarda con error', () => {
    almacenamiento({}, true);
    assert.equal(leerGuardado(1), undefined);
    assert.doesNotThrow(() => guardar(1, 3));
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    assert.equal(leerGuardado(1), undefined, 'ni siquiera existe localStorage');
    assert.doesNotThrow(() => guardar(1, null));
  });
});

describe('la barra superior: el selector sólo para la administración y en un lugar que cabe', () => {
  const shell = f('src/app/Shell.tsx');
  const proveedor = f('src/app/CondominioProvider.tsx');
  const selector = f('src/app/SelectorCondominio.tsx');

  it('el Shell lo monta con la sesión (`key` = usuario: no hereda lo de otro) y lo pinta en escritorio y, aparte, en el celular', () => {
    assert.match(shell, /<CondominioProvider key=\{user\?\.id \?\? 0\}>/);
    assert.equal((shell.match(/<SelectorCondominio \/>/g) ?? []).length, 2, 'una vez en la barra (lg) y otra en su fila del celular');
    assert.match(shell, /hidden min-w-0 lg:block/);
    assert.match(shell, /px-4 pb-2 empty:hidden lg:hidden/, 'en el celular baja a su fila y no deja hueco si no hay selector');
  });

  it('sólo admin y superadmin lo tienen: la junta, los residentes y el personal no', () => {
    assert.match(proveedor, /const activo = user\?\.rol === 'admin' \|\| user\?\.rol === 'superadmin';/);
    assert.match(proveedor, /useResource<\{ items: CondominioOpcion\[\] \}>\(activo \? '\/api\/complejos\/selector' : null\)/, 'sin selector no se pide ni la lista');
  });

  it('el filtro rige sólo en las pantallas que lo usan y vale «Todos» (cadena vacía) fuera de ellas', () => {
    assert.match(proveedor, /const aplica = activo && rutaUsaCondominio\(pathname\)/);
    assert.match(proveedor, /complejo: aplica && elegido !== null \? String\(elegido\) : ''/);
  });

  it('lo guardado se valida contra el alcance del usuario antes de usarlo y se corrige lo guardado', () => {
    assert.match(proveedor, /const elegido = cargado \? elegidoValido\(pedido, condominios\) : pedido/);
    assert.match(proveedor, /guardar\(usuarioId, elegido\)/);
  });

  it('el selector: con uno solo su nombre fijo (sin desplegable), con varios «Todos» + cada uno, agrupado por empresa; accesible', () => {
    assert.match(selector, /condominios\.length === 1/);
    assert.match(selector, /Condominio: /, 'el nombre fijo dice qué es para el lector de pantalla');
    assert.match(selector, /<option value="">Todos los condominios<\/option>/);
    assert.match(selector, /<optgroup key=\{g\.empresa\} label=\{g\.empresa\}>/);
    assert.match(selector, /<label htmlFor=\{id\} className="sr-only">Condominio<\/label>/);
    assert.match(selector, /useId\(\)/, 'se pinta dos veces: un id por copia');
    assert.match(selector, /truncate/, 'en 375 px el nombre largo se corta');
    assert.match(selector, /if \(!aplica\) return null/);
  });
});

describe('las pantallas usan el condominio de la barra y se quitaron su filtro propio', () => {
  const pasan = (ruta: string, ...trozos: RegExp[]) => { const s = f(ruta); assert.match(s, /useCondominio/, ruta); for (const t of trozos) assert.match(s, t, ruta); };

  it('Resumen, Recibos, Pagos y Morosidad: el condominio sale de la barra y el block se reinicia al cambiar de condominio', () => {
    pasan(`${ADMIN}Dashboard.tsx`, /useTorreElegida/, /filtros\.set\('complejo_id', complejo\)/);
    pasan(`${ADMIN}Recibos.tsx`, /useTorreElegida/, /complejo_id: String\(complejoId \?\? complejo\) \|\| undefined/);
    pasan(`${ADMIN}Pagos.tsx`, /useTorreElegida/, /complejo_id: complejo \|\| undefined/);
    pasan(`${ADMIN}Morosidad.tsx`, /useTorreElegida/, /complejo_id: complejo \|\| undefined/, /\$\{complejo \? `&complejo_id=\$\{complejo\}` : ''\}/);
  });

  it('Medios de pago, Juntas, Unidades, Mantenimiento, Comunicados y Envíos, Proveedores y Personas', () => {
    pasan(`${ADMIN}MediosPago.tsx`, /complejo_id: complejo \|\| undefined/, /const complejo = elegido \|\| \(complejos\.length === 1/);
    pasan(`${ADMIN}Juntas.tsx`, /\/api\/juntas\$\{complejo \? `\?complejo_id=\$\{complejo\}` : ''\}/);
    pasan(`${PARTS}unidades/ListaDeUnidades.tsx`, /const complejo = complejoId \? String\(complejoId\) : elegido/, /complejo_id: complejo \|\| undefined/);
    pasan(`${ADMIN}Mantenimientos.tsx`, /complejo_id: complejo \|\| undefined/);
    pasan(`${PARTS}comunicados/ComunicadosTab.tsx`, /complejo_id: complejo \|\| undefined/, /const complejo = elegido \|\|/);
    pasan(`${PARTS}avisos/EnviosTab.tsx`, /complejo_id: complejo \|\| undefined, estructura_id: torre \|\| undefined \} \}\)/, /resumen\?\$\{query\(\{[^}]*complejo_id: complejo \|\| undefined, estructura_id: torre \|\| undefined/);
    pasan(`${ADMIN}Proveedores.tsx`, /complejo_id: filtroComplejo/);
    pasan(`${PARTS}personas/PersonasLista.tsx`, /const filtroComplejo = complejoId \? String\(complejoId\) : condominioBarra/);
  });

  it('ninguna pantalla conserva su propio selector de condominio: «Todos los condominios» sólo existe en la barra', () => {
    const rutas = [
      'Dashboard', 'Recibos', 'Pagos', 'Morosidad', 'MediosPago', 'Juntas', 'Mantenimientos', 'Proveedores', 'Unidades',
    ].map(n => `${ADMIN}${n}.tsx`).concat([
      `${PARTS}unidades/ListaDeUnidades.tsx`, `${PARTS}comunicados/ComunicadosTab.tsx`, `${PARTS}avisos/EnviosTab.tsx`, `${PARTS}personas/PersonasLista.tsx`, `${PARTS}cobranza/SelectoresUbicacion.tsx`,
    ]);
    for (const r of rutas) {
      const s = f(r);
      assert.doesNotMatch(s, /Filtrar por condominio/, r);
      assert.doesNotMatch(s, /<option value="">Todos los condominios<\/option>/, r);
    }
    assert.match(f('src/app/SelectorCondominio.tsx'), /<option value="">Todos los condominios<\/option>/);
  });

  it('el filtro de block lista sólo los del condominio elegido y con «Todos» (y varios) se oculta: nunca mezcla «Block 1» de dos condominios', () => {
    const s = f(`${PARTS}cobranza/SelectoresUbicacion.tsx`);
    assert.match(s, /const sinCondominio = !complejo && varios/);
    assert.match(s, /useTorres\(complejo \|\| null, !oculto && !sinCondominio\)/);
    assert.match(s, /if \(opciones\.length === 0\) return null/);
    assert.doesNotMatch(s, /onComplejo|\/api\/complejos/, 'ya no pide ni elige condominios');
    assert.match(f(`${PARTS}unidades/ListaDeUnidades.tsx`), /\{complejo !== '' && \(\s*<FiltroSelect label="Filtrar por torre"/);
    assert.match(f(`${PARTS}personas/PersonasLista.tsx`), /\{filtroComplejo !== '' && \(\s*<Select label="Filtrar por torre"/);
    assert.match(f(`${ADMIN}MediosPago.tsx`), /!ambitos\.data\?\.fijo && complejo !== ''/);
  });

  it('el block elegido se descarta en el mismo render al cambiar de condominio (no sale una consulta con el block del otro)', () => {
    const s = f('src/app/condominio.ts');
    assert.match(s, /const torre = guardada\.complejo === complejo \? guardada\.torre : ''/);
    for (const r of [`${ADMIN}Dashboard.tsx`, `${ADMIN}Recibos.tsx`, `${ADMIN}Pagos.tsx`, `${ADMIN}Morosidad.tsx`, `${ADMIN}MediosPago.tsx`, `${PARTS}unidades/ListaDeUnidades.tsx`, `${PARTS}comunicados/ComunicadosTab.tsx`, `${PARTS}avisos/EnviosTab.tsx`, `${PARTS}personas/PersonasLista.tsx`]) {
      assert.match(f(r), /useTorreElegida\(\)/, r);
      assert.doesNotMatch(f(r), /const \[(torre|filtroTorre), set\w+\] = useState\(''\)/, r);
    }
  });

  it('las cifras de la barra de envíos siguen al condominio y al block (la API de resumen los acepta)', () => {
    const s = f('src/server/routes/notificaciones.ts');
    assert.match(s, /estructura_id: idSchema\.optional\(\), complejo_id: idSchema\.optional\(\) \}\), req\.query\);/);
    assert.match(s, /filtroEnvios\(f\), filtroUbicacion\(f\)\] \}, _count/);
  });
});

describe('crear algo toma por defecto el condominio elegido; sin condominio se pide elegirlo con un aviso claro', () => {
  it('Emitir recibo y Subir Excel: parten del condominio de la barra y avisan que un recibo es de UN condominio', () => {
    const emitir = f(`${PARTS}cobranza/EmitirReciboModal.tsx`);
    assert.match(emitir, /complejo_id: condominioElegido,/);
    assert.match(emitir, /hint=\{condominioElegido \? undefined : 'Un recibo es de un solo condominio: elige para cuál lo emites\.'\}/);
    assert.match(emitir, /error=\{errors\.complejo_id && 'Elige un condominio'\}/, 'sin condominio no emite: dice qué falta');
    const excel = f(`${PARTS}cobranza/SubirExcelModal.tsx`);
    assert.match(excel, /useState\(complejo\)/);
    assert.match(excel, /disabled=\{!archivo \|\| !complejoId\}/);
  });

  it('Unidad nueva, residente o personal nuevo y proveedor nuevo nacen en el condominio de la barra (el superadmin elige antes la empresa)', () => {
    assert.match(f(`${PARTS}unidades/ModalDeUnidad.tsx`), /complejo_id: complejoId \? String\(complejoId\) : condominioElegido/);
    assert.match(f(`${PARTS}personas/PersonasLista.tsx`), /complejo_id: complejoId \? String\(complejoId\) : esSuper \? '' : condominioBarra/);
    assert.match(f(`${ADMIN}Proveedores.tsx`), /filtroComplejo && !esSuper \? \[Number\(filtroComplejo\)\] : \[\]/);
  });

  it('Registrar pago ofrece sólo los periodos del condominio elegido; la tarea nueva, sólo sus unidades', () => {
    assert.match(f(`${PARTS}cobranza/RegistrarPagoModal.tsx`), /\/api\/recibos\/periodos\$\{complejo \? `\?complejo_id=\$\{complejo\}` : ''\}/);
    assert.match(f(`${PARTS}cobranza/TareaModal.tsx`), /\/api\/unidades\?pageSize=100\$\{complejo \? `&complejo_id=\$\{complejo\}` : ''\}/);
  });

  it('un condominio nuevo, editado o borrado actualiza el selector sin recargar la página', () => {
    assert.match(f(`${PARTS}condominio/ModalDeComplejo.tsx`), /recargarSelector\(\);\s*onGuardado\(\);/);
    assert.match(f(`${ADMIN}CondominioDetalle.tsx`), /toast\.ok\('Condominio eliminado'\);\s*recargarSelector\(\);/);
  });
});

describe('DESIGN.md y el contrato de la API documentan el patrón', () => {
  it('DESIGN.md describe el selector de condominio', () => {
    const s = f('DESIGN.md');
    assert.match(s, /## Patrón: selector de condominio/);
    assert.match(s, /Todos los condominios/);
  });

  it('API-CONTRATO.md documenta /api/complejos/selector y el complejo_id de tareas, periodos y resumen de envíos', () => {
    const s = f('docs/API-CONTRATO.md');
    assert.match(s, /GET \/api\/complejos\/selector/);
    assert.match(s, /\/api\/tareas[^\n]*complejo_id/);
    assert.match(s, /\/api\/recibos\/periodos[^\n]*complejo_id/);
    assert.match(s, /\/api\/notificaciones\/resumen[^\n]*complejo_id/);
  });
});
