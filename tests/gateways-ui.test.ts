// Llavero: sección «Gateways propios», «Dominios permitidos» y «OCR de comprobantes» (lógica de tipos y cableado de la pantalla).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { avisoDeGateway, clavesDeProveedor, proveedorDeGateway, type Clave, type Gateway, type Proveedor } from '../src/pages/superadmin/_parts/llavero/tipos';

const leer = (ruta: string) => readFileSync(new URL(`../src/pages/superadmin/${ruta}`, import.meta.url), 'utf8');
const gw = (over: Partial<Gateway> = {}): Gateway => ({
  id: 7, nombre: 'Dashboard IA', base_url: 'https://api.dashboardia.gargurevich.dev/v1', dominio: 'api.dashboardia.gargurevich.dev', modelo_por_defecto: 'qwen3-vl-flash',
  modelo_vision: 'qwen3-vl-flash', vision: true, prioridad: 2, habilitado: true, estado: 'ok', claves: 1, ...over,
});
const clave = (over: Partial<Clave>): Clave => ({ id: 1, proveedor: 'groq', gateway_id: null, etiqueta: 'principal', ...over }) as unknown as Clave;

describe('un gateway se ve como proveedor', () => {
  it('su id (gw-<id>) coincide con el del orden de rotación y lleva su gatewayId; dominio y visión en la descripción', () => {
    const p = proveedorDeGateway(gw());
    assert.deepEqual([p.id, p.gatewayId, p.nombre, p.modeloPorDefecto, p.urlParaConseguirKey], ['gw-7', 7, 'Dashboard IA', 'qwen3-vl-flash', '']);
    assert.match(p.descripcion, /api\.dashboardia\.gargurevich\.dev · lee imágenes/);
    assert.match(proveedorDeGateway(gw({ vision: false })).descripcion, /sin visión/);
  });

  it('las claves se reparten por gateway (misma etiqueta «principal» en dos gateways) y no se mezclan con las del catálogo', () => {
    const claves = [clave({ id: 1, proveedor: 'groq' }), clave({ id: 2, proveedor: 'gateway', gateway_id: 7 }), clave({ id: 3, proveedor: 'gateway', gateway_id: 8 })];
    const groq = { id: 'groq', nombre: 'Groq' } as Proveedor;
    assert.deepEqual(clavesDeProveedor(claves, groq).map(c => c.id), [1]);
    assert.deepEqual(clavesDeProveedor(claves, proveedorDeGateway(gw({ id: 7 }))).map(c => c.id), [2]);
    assert.deepEqual(clavesDeProveedor(claves, proveedorDeGateway(gw({ id: 8 }))).map(c => c.id), [3]);
  });
});

describe('aviso de un gateway fuera de servicio', () => {
  it('en servicio no avisa; pausado lo dice; con el dominio fuera de la lista lo dice con el dominio y cómo arreglarlo', () => {
    assert.equal(avisoDeGateway(gw()), null);
    assert.match(avisoDeGateway(gw({ estado: 'pausado' }))!, /Pausado/);
    const a = avisoDeGateway(gw({ estado: 'dominio_no_permitido' }))!;
    assert.match(a, /api\.dashboardia\.gargurevich\.dev ya no está en la lista de dominios permitidos/);
    assert.match(a, /NO se usan/);
    assert.match(a, /«Dominios permitidos»/);
  });
});

describe('cableado de la pantalla', () => {
  const pantalla = leer('Llavero.tsx');
  it('muestra las tres secciones bajo «Proveedores» y reusa el mismo componente de claves para los gateways', () => {
    for (const c of ['GatewaysSeccion', 'DominiosPermitidos', 'OcrSeccion', 'GatewayModal']) assert.match(pantalla, new RegExp(`<${c}\\b`), c);
    assert.match(leer('_parts/llavero/GatewaysSeccion.tsx'), /<GrupoProveedor/);
    assert.match(leer('_parts/llavero/GatewaysSeccion.tsx'), /Gateways propios/);
    assert.match(leer('_parts/llavero/GatewaysSeccion.tsx'), /Agregar gateway/);
    assert.match(leer('_parts/llavero/OcrSeccion.tsx'), /OCR de comprobantes/);
    assert.match(leer('_parts/llavero/DominiosPermitidos.tsx'), /Dominios permitidos/);
  });

  it('la clave de un gateway se guarda con su gateway_id en la ruta fija; la de un proveedor, por su id', () => {
    const modal = leer('_parts/llavero/ClaveModal.tsx');
    assert.match(modal, /proveedor\.gatewayId !== undefined\) await api\('\/api\/llavero\/gateway', \{ method: 'PUT', json: \{ \.\.\.cuerpo, gateway_id: proveedor\.gatewayId \} \}\)/);
    assert.match(modal, /\/api\/llavero\/\$\{proveedor\.id\}/);
  });

  it('un gateway pausado o con el dominio retirado se avisa en la lista, y quitar un dominio advierte qué gateways dejan de usarse', () => {
    assert.match(leer('_parts/llavero/GatewaysSeccion.tsx'), /avisoDeGateway\(g\)/);
    assert.match(leer('_parts/llavero/DominiosPermitidos.tsx'), /dejarán de usarse de inmediato/);
  });

  it('el modal del OCR ofrece interno (lista fija) o público, y no vuelve a mostrar la clave', () => {
    const ocr = leer('_parts/llavero/OcrSeccion.tsx');
    assert.match(ocr, /name="ocr-modo"/);
    assert.match(ocr, /type="password"/);
    assert.match(ocr, /Déjala vacía para conservar/);
    assert.match(ocr, /setClave\(''\)/);
  });
});
