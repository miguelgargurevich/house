// «Vincular WhatsApp» en Mi perfil: la lógica pura se prueba de verdad; la estructura de la pantalla se fija con la fuente (el repo no tiene testing-library).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { codigoEnGrupos, destinosActivos, estadoCanales, formatoNumero, reloj, segundosRestantes, type CanalesMe } from '../src/pages/shared/_parts/canalesFormato';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const empresa = { id: 1, nombre: 'Empresa A' };
const datos = (p: Partial<CanalesMe> = {}): CanalesMe => ({ vinculos: [], codigo_vigente: null, destinos: [{ empresa, disponible: true, numero: '51900000001' }], ...p });

describe('lógica de «Vincular WhatsApp»', () => {
  it('formatea el número del edificio y el código; la cuenta regresiva no baja de 0', () => {
    assert.equal(formatoNumero('51987654321'), '+51 987 654 321');
    assert.equal(formatoNumero('14155550123'), '+1 415 555 0123'); // EE. UU.: formato de su país
    assert.equal(formatoNumero('99999'), '+99999'); // no es un número válido: sólo «+»
    assert.equal(codigoEnGrupos('123456'), '123 456');
    assert.equal(reloj(600), '10:00');
    assert.equal(reloj(65), '1:05');
    const vence = '2026-10-27T12:10:00.000Z';
    assert.equal(segundosRestantes(vence, Date.parse('2026-10-27T12:00:00.000Z')), 600);
    assert.equal(segundosRestantes(vence, Date.parse('2026-10-27T12:30:00.000Z')), 0);
  });

  it('estado: oculto sin empresa, «sin WhatsApp» si la administración no lo activó, listo, o vinculado', () => {
    assert.equal(estadoCanales(null), 'oculto');
    assert.equal(estadoCanales(datos({ destinos: [] })), 'oculto');
    assert.equal(estadoCanales(datos({ destinos: [{ empresa, disponible: false, numero: null }] })), 'sin_whatsapp');
    assert.equal(estadoCanales(datos()), 'listo');
    assert.equal(estadoCanales(datos({ vinculos: [{ id: 1, canal: 'whatsapp', identificador: '+51 ••• ••• 111', verificado_at: '2026-10-27T00:00:00Z', empresa }] })), 'vinculado');
  });

  it('prefiere el destino que informa su número', () => {
    const a = { empresa, disponible: true, numero: null };
    const b = { empresa: { id: 2, nombre: 'B' }, disponible: true, numero: '51900000002' };
    assert.deepEqual(destinosActivos([a, b, { empresa: { id: 3, nombre: 'C' }, disponible: false, numero: null }]).map((d) => d.empresa.id), [2, 1]);
  });
});

describe('estructura de la pantalla', () => {
  const pantalla = fuente('src/pages/shared/_parts/CanalesPerfil.tsx');
  it('usa `api()` (cookie + CSRF) con los tres endpoints y los textos pedidos', () => {
    assert.match(pantalla, /api<CanalesMe>\('\/api\/me\/canales'\)/);
    assert.match(pantalla, /\/api\/me\/canales\/whatsapp\/codigo/);
    assert.match(pantalla, /`\/api\/me\/canales\/\$\{vinculo\.id\}`, \{ method: 'DELETE' \}/);
    assert.match(pantalla, /Vincular WhatsApp/);
    assert.match(pantalla, />Desvincular</);
    assert.match(pantalla, /Vinculado/);
    assert.doesNotMatch(pantalla, /\bfetch\(/);
  });
  it('Mi perfil la muestra', () => {
    assert.match(fuente('src/pages/shared/Perfil.tsx'), /<CanalesPerfil \/>/);
  });
});
