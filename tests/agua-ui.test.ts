// Pantallas de lecturas de agua y de datos del recibo: el repo no pinta pantallas en las pruebas, así que se fija con la fuente lo que importa
// (dónde está cada cosa, a qué ruta habla y los topes del cliente). El comportamiento de la API lo cubren agua-lecturas y recibo-datos.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const f = (ruta: string) => readFileSync(`src/pages/${ruta}`, 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

describe('lecturas de agua en la pantalla del periodo', () => {
  const periodo = f('admin/PeriodoRecibo.tsx');
  const agua = f('admin/_parts/agua/AguaRecibo.tsx');

  it('el periodo tiene la pestaña «Agua y datos del recibo» con la tabla de lecturas', () => {
    assert.match(periodo, /Agua y datos del recibo/);
    assert.match(periodo, /<AguaRecibo reciboId=\{reciboId\}/);
  });

  it('la tabla habla con la API de lecturas: lista, guardar por lotes, Excel/CSV, plantilla, quitar y foto', () => {
    assert.match(agua, /`\/api\/recibos\/\$\{reciboId\}\/agua`/);
    assert.match(agua, /method: 'PUT', json: \{ lecturas:/);
    assert.match(agua, /\/agua\/excel/);
    assert.match(agua, /\/agua\/plantilla/);
    assert.match(agua, /\/agua\/\$\{quitar\.unidad\.id\}`, \{ method: 'DELETE'/);
    assert.match(agua, /TAM_LOTE = 500/, 'el servidor acepta hasta 500 por vez');
    assert.match(f('admin/_parts/agua/FotoContometroModal.tsx'), /\/agua\/\$\{unidadId\}\/foto/);
  });

  it('la lectura anterior sale precargada, el factor se pone una vez para la torre y el cruce con el recibo sólo avisa', () => {
    assert.match(agua, /f\.anterior\?\.lectura/);
    assert.match(agua, /Aplicar a todas las filas/);
    assert.match(agua, /avisoAgua\(/);
    assert.match(agua, /no cambia ningún monto/);
  });

  it('la fecha de corte y el correo del block se editan junto a las lecturas', () => {
    const datos = f('admin/_parts/agua/DatosRecibo.tsx');
    assert.match(datos, /\/api\/recibos\/\$\{reciboId\}\/datos/);
    assert.match(datos, /fecha_corte_agua/);
    assert.match(datos, /\/api\/estructuras\/\$\{recibo\.estructura\.id\}\/correo-vouchers/);
  });
});

describe('datos del recibo en las fichas', () => {
  it('condominio: notas de pago, contacto de la administración y foto de cabecera', () => {
    const modal = f('admin/_parts/condominio/ModalDeComplejo.tsx');
    for (const c of ['notas_pago', 'admin_nombre', 'admin_celular', 'admin_correo']) assert.match(modal, new RegExp(c), c);
    const ficha = f('admin/CondominioDetalle.tsx');
    assert.match(ficha, /<ImagenEditable titulo="Foto de cabecera"[^>]*ruta=\{`\/api\/complejos\/\$\{c\.id\}\/cabecera`\}/);
  });
  it('torre: correo para enviar vouchers', () => {
    const torres = f('admin/_parts/condominio/TorresDelCondominio.tsx');
    assert.match(torres, /correo_vouchers: v\.correo_vouchers\.trim\(\) \|\| null/);
    assert.match(torres, /Correo del block para vouchers/);
  });
  it('ficha de la empresa (superadmin): logo', () => {
    assert.match(f('superadmin/EmpresaDetalle.tsx'), /<ImagenEditable titulo="Logo de la empresa"[^>]*ruta=\{`\/api\/empresas\/\$\{e\.id\}\/logo`\}/);
  });

  it('Mi empresa: logo', () => {
    assert.match(f('admin/Configuracion.tsx'), /<ImagenEditable titulo="Logo de la empresa"[^>]*ruta=\{`\/api\/empresas\/\$\{data\.id\}\/logo`\}/);
  });
  it('las imágenes se validan en el cliente con el mismo tope y tipos que el servidor (2 MB, JPG/PNG/WebP)', () => {
    const img = f('shared/_parts/imagenes.ts');
    assert.match(img, /MAX_IMAGEN = 2 \* 1024 \* 1024/);
    assert.match(img, /TIPOS_IMAGEN = \['image\/png', 'image\/jpeg', 'image\/webp'\]/);
    assert.match(f('admin/_parts/condominio/ImagenEditable.tsx'), /errorDeImagen\(f\)/);
  });
});

describe('junta: lecturas de agua de su torre', () => {
  it('hay ruta /junta/agua dentro de RequireJunta y la pantalla de pagos de la junta enlaza a ella', () => {
    const junta = app.slice(app.indexOf('<RequireJunta />'), app.indexOf('<RequireRole roles={[\'propietario\']}'));
    assert.match(junta, /path="\/junta\/agua" element=\{<JuntaAgua \/>\}/);
    assert.match(f('admin/Pagos.tsx'), /junta && <Link to="\/junta\/agua"/);
    assert.match(f('junta/Agua.tsx'), /<AguaRecibo key=\{reciboId\} reciboId=\{reciboId\}/);
  });
});

describe('vista del residente', () => {
  it('el detalle muestra el consumo de agua, la fecha de corte, la deuda acumulada y el contacto; «Cómo pagar» lleva las notas', () => {
    const det = f('residente/_parts/DetalleMantenimientoModal.tsx');
    assert.match(det, /<ConsumoAgua agua=\{d\.agua\}/);
    assert.match(det, /d\.fecha_corte_agua/);
    assert.match(det, /d\.deuda_acumulada/);
    assert.match(det, /d\.total_general/);
    assert.match(det, /Contacto de la administración/);
    assert.match(f('residente/_parts/ComoPagar.tsx'), /Notas de pago/);
    assert.match(f('residente/_parts/PagarModal.tsx'), /notas=\{d\?\.condominio\?\.notas_pago/);
  });
});
