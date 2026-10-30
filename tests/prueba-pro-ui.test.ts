// Prueba de Pro, en pantalla: el superadmin fija los días; Mi plan y el Resumen dicen cuánto le queda al condominio, con el enlace a Mi plan.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { diasDePrueba } from '../src/pages/admin/_parts/plan/diasDePrueba';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

describe('texto de los días de prueba', () => {
  it('cuenta en días y dice «termina hoy» al llegar a cero', () => {
    assert.equal(diasDePrueba(12), 'te quedan 12 días');
    assert.equal(diasDePrueba(1), 'te quedan 1 día');
    assert.equal(diasDePrueba(0), 'termina hoy');
    assert.equal(diasDePrueba(null), 'termina hoy');
  });
});

describe('pantallas de la prueba', () => {
  it('el superadmin fija los días de prueba (0 a 90) en la configuración de precios', () => {
    const f = fuente('src/pages/superadmin/_parts/suscripciones/Precios.tsx');
    assert.match(f, /dias_prueba_pro: number;/);
    assert.match(f, /label="Días de prueba de Pro al registrarse" type="number" min=\{0\} max=\{90\}/);
    assert.match(f, /dias_prueba_pro: Number\(f\.dias_prueba_pro\)/);
  });

  it('Mi plan marca la prueba con su banda y no avisa de «vence» a quien está en prueba', () => {
    const f = fuente('src/pages/admin/MiPlan.tsx');
    assert.match(f, /Prueba de Pro · \{diasDePrueba\(c\.dias_para_vencer\)\}/);
    assert.match(f, /if \(c\.en_prueba\) return null;/);
  });

  it('el Resumen muestra la banda de la prueba con el enlace a Mi plan, y la pone bajo el encabezado', () => {
    const banda = fuente('src/pages/admin/_parts/plan/BandaPlan.tsx');
    assert.match(banda, /to="\/admin\/mi-plan"/);
    assert.match(banda, /useCondominio\(\)/);
    const resumen = fuente('src/pages/admin/Dashboard.tsx');
    assert.match(resumen, /import \{ BandaPlan \} from '\.\/_parts\/plan\/BandaPlan';/);
    assert.match(resumen, /<PageHeader[\s\S]*<BandaPlan \/>/);
  });
});
