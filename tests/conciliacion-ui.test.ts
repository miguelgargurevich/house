// Pantalla de conciliación bancaria y la marca «Conciliado con el banco» en Pagos. El repo no tiene testing-library: se fijan con pruebas de fuente (como
// las demás pantallas con dependencias de Vite). Lo que no se puede ver aquí (390 px, claro/oscuro) se revisa en el navegador y se dice en el handoff.
import './helpers/env';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { letraDeColumna } from '../src/pages/admin/_parts/conciliacion/tipos';
import { RUTAS_POR_ROL } from '../src/server/lib/rutasApp';

const fuente = (r: string) => readFileSync(r, 'utf8');
const PAGINA = fuente('src/pages/admin/Conciliacion.tsx');
const SUBIR = fuente('src/pages/admin/_parts/conciliacion/SubirExtractoModal.tsx');
const MOVIMIENTO = fuente('src/pages/admin/_parts/conciliacion/MovimientoModal.tsx');

describe('ruta y menú', () => {
  it('/admin/conciliacion está en App.tsx, en el menú de cobranza (admin y superadmin) y en las rutas que conoce el asistente', () => {
    assert.match(fuente('src/App.tsx'), /path="\/admin\/conciliacion" element=\{<AdminConciliacion \/>\}/);
    assert.match(fuente('src/App.tsx'), /import\('\.\/pages\/admin\/Conciliacion'\)/);
    assert.match(fuente('src/app/nav.ts'), /\{ to: '\/admin\/conciliacion', label: 'Conciliación'/);
    assert.ok(RUTAS_POR_ROL.admin.includes('/admin/conciliacion'));
    assert.ok(RUTAS_POR_ROL.superadmin.includes('/admin/conciliacion'));
    assert.ok(!RUTAS_POR_ROL.propietario.includes('/admin/conciliacion'));
  });
});

describe('pantalla', () => {
  it('sin la capacidad (403 MODULO_NO_ACTIVO) muestra el aviso «Disponible en el plan Pro», no un error', () => {
    assert.match(PAGINA, /codigo === 'MODULO_NO_ACTIVO'/);
    assert.match(PAGINA, /<AvisoModulo modulo="conciliacion" \/>/);
    assert.match(fuente('src/pages/shared/_parts/comercial.ts'), /conciliacion: 'Conciliación bancaria'/);
    assert.match(fuente('src/pages/shared/_parts/comercial.ts'), /'reportes' \| 'conciliacion'/);
  });
  it('elige condominio y cuenta, y muestra el resumen: conciliados, por revisar, abonos sin voucher y vouchers sin abono', () => {
    for (const t of ['Condominio', 'Cuenta', 'Conciliados', 'Por revisar', 'Abonos sin voucher', 'Vouchers sin abono']) assert.ok(PAGINA.includes(t), t);
    assert.match(PAGINA, /\/api\/conciliacion\/cuentas\?complejo_id=/);
    assert.match(PAGINA, /\$\{base\}\/resumen/);
    assert.match(PAGINA, /\$\{base\}\/movimientos/);
    assert.match(PAGINA, /\$\{base\}\/sin-abono/);
  });
  it('la tabla se filtra por estado con pestañas y las acciones se bloquean en solo lectura', () => {
    for (const e of ["'por_revisar'", "'sin_pago'", "'conciliado'", "'ignorado'", "'sin_abono'"]) assert.ok(PAGINA.includes(e), e);
    assert.match(PAGINA, /<Tabs value=\{pestana\}/);
    assert.match(PAGINA, /<Bloqueable>\{b => <Button icon=\{<ArrowUpTrayIcon/);
  });
  it('celular: contenedores con scroll propio y columnas que se ocultan, sin ancho fijo que desborde la página', () => {
    assert.match(PAGINA, /overflow-x-auto/);
    assert.match(PAGINA, /hideBelow: 'sm'/);
    assert.match(SUBIR, /overflow-x-auto/);
    assert.match(SUBIR, /sm:grid-cols-2/);
    assert.doesNotMatch(PAGINA + SUBIR + MOVIMIENTO, /\bw-\[\d+px\]|min-w-\[\d{3,}px\]/);
  });
  it('subir: .xlsx, .xls y .csv, manda el archivo como multipart y, si no reconoce las columnas, deja elegirlas con las primeras filas', () => {
    assert.match(SUBIR, /accept="\.xlsx,\.xls,\.csv"/);
    assert.match(SUBIR, /fd\.append\('archivo', archivo\)/);
    assert.match(SUBIR, /fd\.append\('columnas', JSON\.stringify/);
    assert.match(SUBIR, /if \(r\.requiere_mapeo\)/);
    assert.match(SUBIR, /Primera fila de datos/);
    assert.match(SUBIR, /lo recordaré para esta cuenta/);
  });
  it('cada abono se vincula con un pago sugerido o buscado, se desvincula o se ignora con motivo', () => {
    assert.match(MOVIMIENTO, /ejecutar\('vincular', \{ pago_id: p\.id \}/);
    assert.match(MOVIMIENTO, /ejecutar\('desvincular'/);
    assert.match(MOVIMIENTO, /ejecutar\('ignorar', \{ motivo: motivo\.trim\(\) \}/);
    assert.match(MOVIMIENTO, /Intereses, transferencia interna/);
    assert.match(MOVIMIENTO, /\/pagos\$\{q\.trim\(\)/);
  });
  it('letras de columna: A, Z, AA', () => {
    assert.deepEqual([0, 1, 25, 26, 27, 51, 52].map(letraDeColumna), ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});

describe('«Conciliado con el banco» en Pagos', () => {
  it('la lista de pagos y el modal de validar muestran la marca con la fecha del abono', () => {
    const marcas = fuente('src/pages/admin/_parts/conciliacion/marcas.ts');
    assert.match(marcas, /\/api\/conciliacion\/pagos\?ids=/);
    assert.match(marcas, /user\?\.rol === 'admin' \|\| user\?\.rol === 'superadmin'/, 'sólo la administración');
    assert.match(marcas, /Conciliado con el banco · abono del/);
    assert.match(fuente('src/pages/admin/Pagos.tsx'), /useMarcasConciliacion\(list\.items\.map\(p => p\.id\)\)/);
    assert.match(fuente('src/pages/admin/Pagos.tsx'), /marcas\[p\.id\] && <Badge tone="ok">/);
    assert.match(fuente('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx'), /useMarcasConciliacion\(pago \? \[pago\.id\] : \[\]\)/);
    assert.match(fuente('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx'), /label: 'Banco'/);
  });
  it('es información: ni la marca ni su hook tocan la validación ni la conformidad', () => {
    const marcas = fuente('src/pages/admin/_parts/conciliacion/marcas.ts');
    assert.doesNotMatch(marcas, /validacion|conformidad|method: 'P(UT|OST)'/);
    const modal = fuente('src/pages/admin/_parts/cobranza/ValidarPagoModal.tsx');
    assert.doesNotMatch(modal, /marcaBanco[^;]*(puedeValidar|faltaCheck|conformidad)/);
  });
});

describe('precios', () => {
  it('la comparativa de /precios nombra la conciliación bancaria entre lo de Torre Pro', () => {
    assert.match(fuente('src/pages/publico/precios/Comparativa.tsx'), /reportes y conciliación bancaria— es de Torre Pro/);
    assert.match(fuente('src/lib/seo/textos.ts'), /reportes y conciliación bancaria/);
  });
});
