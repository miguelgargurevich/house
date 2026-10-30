// Gratis incluye un condominio, en pantalla: «Nuevo condominio» no abre el formulario cuando la administradora ya tiene uno en Gratis; muestra el motivo y el camino a Mi plan.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

describe('pantallas del límite de Gratis', () => {
  it('Condominios pregunta al servidor antes de abrir el formulario y, si no puede, muestra el motivo con el enlace a Mi plan', () => {
    const f = fuente('src/pages/admin/Complejos.tsx');
    assert.match(f, /'\/api\/comercial\/puede-agregar-condominio'/);
    assert.match(f, /to="\/admin\/mi-plan"/);
    // El formulario sólo se abre desde `nuevoCondominio`, que corta antes si no puede.
    assert.equal((f.match(/setNuevo\(true\)/g) ?? []).length, 1);
    assert.match(f, /if \(puede\.data && !puede\.data\.puede\) return setMotivo\(true\);/);
    assert.equal((f.match(/onClick=\{nuevoCondominio\}/g) ?? []).length, 2, 'el botón de la cabecera y el de la lista vacía');
  });

  it('Mi plan muestra el motivo cuando no se puede agregar otro condominio', () => {
    const f = fuente('src/pages/admin/MiPlan.tsx');
    assert.match(f, /puede_agregar_condominio: \{ puede: boolean; motivo: string \| null \}/);
    assert.match(f, /!data\.puede_agregar_condominio\.puede && data\.puede_agregar_condominio\.motivo/);
  });
});
