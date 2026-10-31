// Pantallas de la oferta «Gratis con límite o Pro con todo»: Mi plan, Suscripciones › Precios, el aviso «Disponible en el plan Pro» y el tope de
// unidades. El repo no tiene testing-library: se fijan con pruebas de fuente (como las demás pantallas con dependencias de Vite).
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const fuente = (r: string) => readFileSync(r, 'utf8');

describe('Mi plan: ya no ofrece módulos sueltos', () => {
  it('el modal pide sólo un plan (sin casillas de módulos) y manda `{ plan }`', () => {
    const m = fuente('src/pages/admin/_parts/plan/ModalSolicitud.tsx');
    assert.doesNotMatch(m, /type="checkbox"|modulos/);
    assert.match(m, /json: \{ plan \}/);
    assert.match(m, /mínimo \{p\.unidades_minimas\} departamentos/);
    assert.match(m, /minimo_aplicado/);
  });

  it('la tarjeta del condominio dice «Elegir un plan», muestra el tope de Gratis y avisa al llegar o pasarlo', () => {
    const m = fuente('src/pages/admin/MiPlan.tsx');
    assert.match(m, /'Elegir un plan'/);
    assert.doesNotMatch(m, /Solicitar módulo|Solicitar otro módulo/);
    assert.match(m, /c\.unidades_maximas != null && c\.unidades_facturables >= c\.unidades_maximas/);
    assert.match(m, /no se oculta ni se borra ninguno/);
    assert.match(m, /c\.cotizacion\.minimo_aplicado/);
    assert.match(m, /se respetan hasta que cambies de plan/, 'los módulos sueltos heredados se explican');
  });
});

describe('Suscripciones (superadmin)', () => {
  it('Precios edita el tope y el mínimo de departamentos y los manda como número o null', () => {
    const m = fuente('src/pages/superadmin/_parts/suscripciones/Precios.tsx');
    assert.match(m, /Máximo de departamentos por condominio/);
    assert.match(m, /Mínimo de departamentos que se cobran/);
    assert.match(m, /unidades_maximas: maximo\.trim\(\) \? Number\(maximo\) : null/);
    assert.match(m, /unidades_minimas: minimo\.trim\(\) \? Number\(minimo\) : null/);
  });

  it('el modal de la suscripción no manda `modulos`: al cambiar de plan los sueltos heredados se vacían en el servidor', () => {
    const m = fuente('src/pages/superadmin/_parts/suscripciones/ModalSuscripcion.tsx');
    assert.doesNotMatch(m, /type="checkbox"/);
    assert.match(m, /json: \{ plan_clave: plan, vigente_hasta/);
    assert.doesNotMatch(m, /json: \{[^}]*modulos/);
  });
});

describe('«Disponible en el plan Pro» en vez de un error', () => {
  it('AvisoModulo habla del plan Pro y manda a Mi plan', () => {
    const m = fuente('src/pages/shared/_parts/AvisoModulo.tsx');
    assert.match(m, /Disponible en el plan Pro/);
    assert.match(m, /\/admin\/mi-plan/);
  });

  it('useList expone el código del error y Morosidad muestra el aviso con MODULO_NO_ACTIVO (no un error ni la tabla)', () => {
    assert.match(fuente('src/api.ts'), /errorCode: e instanceof ApiError|setErrorCode\(e instanceof ApiError \? e\.code : undefined\)/);
    assert.match(fuente('src/api.ts'), /loading, error, errorCode, reload: load/);
    const m = fuente('src/pages/admin/Morosidad.tsx');
    assert.match(m, /list\.errorCode === 'MODULO_NO_ACTIVO'/);
    assert.match(m, /<AvisoModulo modulo="reportes" \/>/);
  });

  it('crear una unidad por encima del tope explica el límite en el modal, con enlace a Mi plan', () => {
    const m = fuente('src/pages/admin/_parts/unidades/ModalDeUnidad.tsx');
    assert.match(m, /e\.code === 'LIMITE_UNIDADES'/);
    assert.match(m, /to="\/admin\/mi-plan"/);
  });

  it('las claves de capacidad nuevas tienen nombre en la interfaz', () => {
    const m = fuente('src/pages/shared/_parts/comercial.ts');
    assert.match(m, /mora_automatica: 'Mora automática'/);
    assert.match(m, /reportes: 'Reportes y exportes'/);
  });
});
