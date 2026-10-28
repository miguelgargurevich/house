// Vista móvil (375 px): lo que se arregló tras el barrido del 27-oct-2026. Tests de fuente, como el resto de la UI.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');

describe('vista móvil', () => {
  it('la tarjeta del mantenimiento baja los botones a su propia fila en el celular («Pagar mantenimiento» quedaba cortado)', () => {
    const s = fuente('src/pages/residente/_parts/MantenimientoItem.tsx');
    assert.match(s, /flex flex-wrap items-end justify-between/);
    assert.match(s, /flex w-full gap-2 sm:w-auto/);
  });

  it('las tablas usan menos margen en el celular y el normal desde sm', () => {
    const s = fuente('src/ui/DataTable.tsx');
    assert.ok((s.match(/px-3[^']*sm:px-5/g) ?? []).length >= 4, 'cabecera, celdas, esqueleto y pie');
    assert.doesNotMatch(s, /'(whitespace-nowrap )?px-5 py-3/);
  });

  it('las columnas de acción que se esconden en el celular tienen la fila tocable', () => {
    for (const [archivo, columna] of [['src/pages/superadmin/Empresas.tsx', 'ficha'], ['src/pages/superadmin/Auditoria.tsx', 'ver'], ['src/pages/admin/_parts/mantenimientos/MantenimientosLista.tsx', 'acciones']] as const) {
      const s = fuente(archivo);
      assert.match(s, new RegExp(`key: '${columna}'[^\\n]*hideBelow: 'sm'`), `${archivo}: ${columna}`);
      assert.match(s, /onRowClick=/, `${archivo}: fila tocable`);
    }
  });

  it('la comparativa de precios no fuerza un ancho mínimo en el celular', () => {
    assert.match(fuente('src/pages/publico/precios/Comparativa.tsx'), /<table className="w-full text-base sm:min-w-\[30rem\]">/);
  });

  it('seguridad: el nombre del condominio y del residente bajan de línea en vez de cortarse', () => {
    assert.match(fuente('src/ui/PageHeader.tsx'), /<dd className=\{`mt-1 break-words /);
    assert.match(fuente('src/pages/seguridad/Unidades.tsx'), /break-words text-xs text-muted sm:hidden/);
  });

  it('medios de pago: el CCI admite guiones y el condominio de blocks dice «block», no «torre»', () => {
    const form = fuente('src/pages/admin/_parts/medios/MedioFormModal.tsx');
    assert.match(form, /\/\^\\d\{20\}\$\/\.test\(v\.replace\(\/\[\\s-\]\/g, ''\)\)/);
    assert.match(fuente('src/pages/admin/_parts/medios/tipos.ts'), /every\(e => e\.tipo === 'block'\)/);
    assert.match(fuente('src/pages/admin/MediosPago.tsx'), /label=\{`Filtrar por \$\{palabra\.una\}`\}/);
  });

  it('el pago parcial de un concepto queda oculto en el detalle del mantenimiento', () => {
    assert.match(fuente('src/pages/admin/_parts/mantenimientos/MantenimientoAdminModal.tsx'), /const PAGO_PARCIAL_CONCEPTO = false;[\s\S]*puedeRegistrar && PAGO_PARCIAL_CONCEPTO &&/);
  });

  it('mis recibos: la tarjeta recibe el motivo del rechazo («Pagar de nuevo») en la lista y en el inicio', () => {
    for (const archivo of ['src/pages/residente/_parts/CargosResidente.tsx', 'src/pages/residente/_parts/InicioResidente.tsx']) {
      assert.match(fuente(archivo), /<MantenimientoItem [^>]*rechazo=\{m\.motivo_rechazo\}/, archivo);
    }
  });

  it('cómo pagar: el monto que carga no mete un bloque dentro de un párrafo (aviso de React en consola)', () => {
    assert.match(fuente('src/pages/residente/_parts/ComoPagar.tsx'), /<div className="num text-2xl font-semibold">\{saldo !== null \? soles\(saldo\) : <Skeleton/);
  });

  it('la ficha de la empresa no queda «cargando» si no tiene fecha de inicio', () => {
    assert.match(fuente('src/pages/superadmin/EmpresaDetalle.tsx'), /value: e \? \(e\.fecha_inicio \? fechaCorta\(e\.fecha_inicio\) : '—'\) : <Skeleton/);
  });
});
