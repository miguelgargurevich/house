// Torres y fichas: menú por objeto de trabajo, ficha del condominio y de la empresa, y la torre de punta a punta.
// El repo no tiene testing-library: el comportamiento de UI se fija con tests de fuente (y con el menú, que sí se importa).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { NAV } from '../src/app/nav';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

const ETIQUETAS_OLD = [
  'Filtrar por block', 'Todos los blocks', 'Block de la junta', 'nombreBlock',
  'por block.', 'tu block', 'de su block', 'sin block', 'sin blocks.',
];

describe('menú: cada grupo es un objeto de trabajo y la plataforma va al final', () => {
  it('el superadmin termina en Plataforma, después de Personas', () => {
    const grupos = NAV.superadmin;
    assert.equal(grupos.at(-1)?.label, 'Plataforma');
    const labels = grupos.map(g => g.label ?? null);
    assert.deepEqual(labels, [null, null, null, 'Cobranza', 'Operación', 'Personas', 'Plataforma']);
    assert.deepEqual(grupos.at(-1)?.items.map(i => i.label), ['Usuarios del sistema', 'Auditoría', 'Llavero de IA']);
  });

  it('el admin termina en Cuenta, sin plataforma', () => {
    const grupos = NAV.admin;
    assert.equal(grupos.at(-1)?.label, 'Cuenta');
    assert.deepEqual(grupos.map(g => g.label ?? null), [null, null, 'Cobranza', 'Operación', 'Personas', 'Cuenta']);
    assert.ok(!JSON.stringify(NAV.admin).includes('Plataforma'));
  });

  it('Empresas y Condominios quedan sueltos arriba (la ficha es el camino principal)', () => {
    assert.deepEqual(NAV.superadmin[1]?.items.map(i => i.label), ['Empresas']);
    assert.deepEqual(NAV.superadmin[2]?.items.map(i => i.label), ['Condominios']);
    assert.deepEqual(NAV.admin[1]?.items.map(i => i.label), ['Condominios']);
    assert.equal(NAV.superadmin[1]?.label, undefined, 'no son un grupo: van sin rótulo');
    assert.equal(NAV.superadmin[2]?.label, undefined);
    assert.equal(NAV.admin[1]?.label, undefined);
  });

  it('Cobranza y Operación están en el orden pactado y con sus ítems', () => {
    const admin = NAV.admin;
    const cobranza = admin.find(g => g.label === 'Cobranza');
    const operacion = admin.find(g => g.label === 'Operación');
    assert.deepEqual(cobranza?.items.map(i => i.label), ['Recibos', 'Pagos', 'Medios de pago', 'Morosidad']);
    assert.deepEqual(operacion?.items.map(i => i.label), ['Unidades', 'Mantenimiento', 'Conceptos', 'Avisos', 'WhatsApp']);
    assert.ok(admin.indexOf(cobranza!) < admin.indexOf(operacion!), 'Cobranza antes que Operación');
    assert.deepEqual(admin.find(g => g.label === 'Personas')?.items.map(i => i.label), ['Residentes', 'Personal', 'Proveedores']);
  });

  it('ningún rótulo del menú dice «block»', () => {
    for (const [rol, grupos] of Object.entries(NAV)) {
      for (const g of grupos) {
        for (const i of g.items) assert.ok(!/block/i.test(i.label), `${rol}: «${i.label}»`);
      }
    }
  });
});

describe('ficha del condominio: pestañas dentro de la página', () => {
  const c = fuente('src/pages/admin/CondominioDetalle.tsx');

  it('la pestaña viva vive en la URL (?vista=) para poder compartirla y sobreviva al F5', () => {
    assert.ok(c.includes('useSearchParams'), 'lee la URL');
    assert.ok(c.includes("params.get('vista')"), 'saca la vista de la URL');
    assert.ok(c.includes("setParams(v === 'datos' ? {} : { vista: v })"), 'al cambiar de pestaña escribe la URL');
  });

  it('las cinco pestañas son Datos · Torres · Unidades · Residentes · Recibos', () => {
    for (const id of ['datos', 'torres', 'unidades', 'residentes', 'recibos']) {
      assert.ok(c.includes(`id: '${id}'`), `falta la pestaña ${id}`);
    }
    assert.ok(c.includes('<Tabs value={vista} onChange={irA}'), 'las pestañas están conectadas con la URL');
  });

  it('cada pestaña monta su contenido: torres, unidades, residentes y recibos del condominio', () => {
    assert.ok(c.includes('<TorresDelCondominio complejoId={complejoId} />'), 'la pestaña Torres');
    assert.ok(c.includes('<ListaDeUnidades complejoId={complejoId}'), 'la pestaña Unidades');
    assert.ok(c.includes('<PersonasLista tipo="residente" complejoId={complejoId} sinEncabezado />'), 'la pestaña Residentes');
    assert.ok(c.includes('<ListaDeRecibos complejoId={complejoId} />'), 'la pestaña Recibos');
  });

  it('la ficha enlaza de vuelta a la lista y ofrece editar y contratos', () => {
    assert.ok(c.includes('to="/admin/complejos"'), 'enlace «← Condominios»');
    assert.ok(c.includes('<ContratosModal'), 'historial de contratos');
    assert.ok(c.includes('<ModalDeComplejo'), 'edición');
  });

  it('dentro de la ficha se puede dar de alta lo que corresponde', () => {
    const u = fuente('src/pages/admin/_parts/unidades/ListaDeUnidades.tsx');
    const iFicha = u.indexOf('complejoId && (');
    const iAlta = u.indexOf('Nueva unidad', iFicha);
    assert.ok(iFicha > -1 && iAlta > iFicha, 'la pestaña Unidades ofrece el alta');

    const p = fuente('src/pages/admin/_parts/personas/PersonasLista.tsx');
    const iRama = p.indexOf('sinEncabezado ? (');
    const iElse = p.indexOf(') : (', iRama);
    const iAltaRes = p.indexOf("abrir('nuevo')", iElse);
    assert.ok(iRama > -1 && iElse > iRama && iAltaRes > iElse, 'la lista sin encabezado también ofrece el alta');
  });

  it('la ruta de la ficha existe en App.tsx', () => {
    const app = fuente('src/App.tsx');
    assert.ok(app.includes('path="/admin/condominios/:id"'), 'la ruta de la ficha del condominio');
  });
});

describe('ficha de la empresa: datos, personal y condominios', () => {
  const e = fuente('src/pages/superadmin/EmpresaDetalle.tsx');

  it('las tres pestañas son Datos · Personal · Condominios', () => {
    for (const id of ['datos', 'personal', 'condominios']) {
      assert.ok(e.includes(`id: '${id}'`), `falta la pestaña ${id}`);
    }
    assert.ok(e.includes("params.get('vista')"), 'la pestaña viva vive en la URL');
  });

  it('el personal se filtra por la empresa de la ficha', () => {
    assert.ok(e.includes('<PersonasLista tipo="personal" empresaId={empresaId} sinEncabezado />'));
    assert.ok(e.includes("empresa_id: Number.isInteger(empresaId)"), 'los condominios se piden filtrados por empresa');
  });

  it('la ruta de la ficha existe en App.tsx', () => {
    const app = fuente('src/App.tsx');
    assert.ok(app.includes('path="/superadmin/empresas/:id"'), 'la ruta de la ficha de la empresa');
  });
});

describe('«Mi empresa» del admin: la ficha de su empresa, con su personal', () => {
  const c = fuente('src/pages/admin/Configuracion.tsx');

  it('gana la pestaña Personal con el mismo componente', () => {
    assert.ok(c.includes("id: 'personal'"), 'la pestaña Personal');
    assert.ok(c.includes('<PersonasLista tipo="personal" empresaId={empresaId ?? undefined} sinEncabezado />'), 'el personal de su empresa');
  });
});

describe('unidades: la torre de punta a punta', () => {
  const lista = fuente('src/pages/admin/_parts/unidades/ListaDeUnidades.tsx');
  const modal = fuente('src/pages/admin/_parts/unidades/ModalDeUnidad.tsx');

  it('la lista tiene columna Torre y filtro por torre', () => {
    assert.ok(lista.includes("header: 'Torre'"), 'columna Torre');
    assert.ok(lista.includes('label="Filtrar por torre"'), 'filtro por torre');
    assert.ok(lista.includes('estructura_id: torre || undefined'), 'el filtro se manda como estructura_id');
    assert.ok(lista.includes('<option value="">Todas las torres</option>'));
  });

  it('el filtro por torre depende del condominio elegido', () => {
    const iFiltro = lista.indexOf('label="Filtrar por torre"');
    const iTorres = lista.indexOf('/api/estructuras?complejo_id=');
    assert.ok(iTorres > -1 && iTorres < iFiltro, 'las torres se piden con el condominio');
    assert.ok(lista.includes('const [complejo, setComplejo] = useState(complejoId ? String(complejoId) : \'\')'), 'el condominio puede venir fijo');
  });

  it('el modal manda estructura_id y piso_id', () => {
    assert.ok(modal.includes('estructura_id: idONull(v.estructura_id)'));
    assert.ok(modal.includes('piso_id: idONull(v.piso_id)'));
  });

  it('el modal limpia torre y piso al cambiar de condominio, y el piso al cambiar de torre', () => {
    const iComplejo = modal.indexOf("register('complejo_id'");
    const iLimpiaTorre = modal.indexOf("setValue('estructura_id', '')", iComplejo);
    assert.ok(iLimpiaTorre > iComplejo, 'al cambiar de condominio se limpia la torre');
    assert.ok(modal.includes("setValue('piso_id', '')"), 'también se limpia el piso');
    const iTorre = modal.indexOf("register('estructura_id'");
    const iLimpiaPiso = modal.indexOf("setValue('piso_id', '')", iTorre);
    assert.ok(iLimpiaPiso > iTorre, 'al cambiar de torre se limpia el piso');
  });

  it('el piso sólo se elige con una torre elegida', () => {
    assert.ok(modal.includes('disabled={!torreElegida || pisos.loading}'), 'el piso depende de la torre');
    assert.ok(modal.includes('disabled={!complejoElegido || torres.loading}'), 'la torre depende del condominio');
  });
});

describe('torres: el hueco que se cierra', () => {
  const ui = fuente('src/pages/admin/_parts/condominio/TorresDelCondominio.tsx');
  const api = fuente('src/server/routes/estructuras.ts');

  it('la pantalla da de alta la torre con su cantidad de pisos', () => {
    assert.ok(ui.includes('label="Cantidad de pisos"'));
    assert.ok(ui.includes('cantidad_pisos:'), 'el formulario manda la cantidad de pisos');
    assert.ok(api.includes('cantidad_pisos'), 'la API acepta la cantidad de pisos');
    assert.ok(api.includes('tx.piso.createMany'), 'los pisos se crean con la torre');
  });

  it('la pantalla ofrece asignar las unidades que todavía no tienen torre', () => {
    assert.ok(ui.includes('/asignar-unidades'), 'la acción de asignar');
    assert.ok(ui.includes('asignar-unidades'), 'el endpoint');
  });

  it('la API rechaza las torres anidadas', () => {
    assert.ok(api.includes('House trabaja con torres planas'), 'el mensaje');
    assert.ok(api.includes('z.never'), 'el esquema no admite padre_id');
    assert.ok(api.includes('if (d.padre_id != null) throw invalid(PLANAS'), 'ni al crear ni al editar');
  });

  it('la baja se bloquea si la torre tiene unidades o usuarios de junta', () => {
    assert.ok(api.includes('prisma.unidad.count'), 'cuenta las unidades');
    assert.ok(api.includes('prisma.usuario.count'), 'cuenta los usuarios de junta');
    assert.ok(api.includes('cargo_junta: { not: null }'), 'sólo los que tienen cargo de junta');
  });
});

describe('vocabulario: la UI habla de torre, no de block', () => {
  it('el helper se llama nombreTorre', () => {
    const t = fuente('src/pages/admin/_parts/medios/tipos.ts');
    assert.ok(t.includes('export const nombreTorre ='), 'nombreTorre');
    assert.ok(!t.includes('nombreBlock'), 'nombreBlock ya no existe');
  });

  it('ninguna pantalla usa los rótulos viejos de «block»', () => {
    for (const ruta of [
      'src/pages/admin/MediosPago.tsx',
      'src/pages/admin/Morosidad.tsx',
      'src/pages/admin/_parts/personas/PersonasLista.tsx',
      'src/pages/admin/_parts/medios/MedioFormModal.tsx',
      'src/pages/admin/PeriodoRecibo.tsx',
      'src/pages/admin/Pagos.tsx',
    ]) {
      const s = fuente(ruta);
      for (const viejo of ETIQUETAS_OLD) assert.ok(!s.includes(viejo), `${ruta} todavía dice «${viejo}»`);
    }
  });

  it('la junta se elige por torre y se explica que sin torre alcanza todo el condominio', () => {
    const p = fuente('src/pages/admin/_parts/personas/PersonasLista.tsx');
    assert.ok(p.includes('label="Torre de la junta"'), 'el rótulo');
    assert.ok(p.includes('Sin torre, la junta alcanza todo el condominio.'), 'la ayuda');
  });
});
