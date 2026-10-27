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
    assert.match(fuente('src/pages/publico/Precios.tsx'), /<table className="w-full text-sm sm:min-w-\[34rem\]">/);
  });

  it('la ficha de la empresa no queda «cargando» si no tiene fecha de inicio', () => {
    assert.match(fuente('src/pages/superadmin/EmpresaDetalle.tsx'), /value: e \? \(e\.fecha_inicio \? fechaCorta\(e\.fecha_inicio\) : '—'\) : <Skeleton/);
  });
});
