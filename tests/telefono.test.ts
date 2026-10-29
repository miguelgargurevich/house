// Teléfonos de cualquier país: el esquema del servidor, el celular de WhatsApp, el enmascarado de los vínculos y el número extranjero que
// llega por el webhook. Sin base de datos: todo es puro.
import './helpers/env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { telefonoSchema } from '../src/server/validation';
import { formatearCelular, normalizarCelular } from '../src/server/services/avisos/celular';
import { interpretarWebhook } from '../src/server/services/canales/entrante';
import { mascara } from '../src/server/services/canales/vinculos';
import { formatearTelefono, parsearCelular, parsearTelefono } from '../src/lib/telefono';

const MENSAJE = 'Teléfono inválido para el país elegido';

describe('telefonoSchema: cualquier país, guardado en formato internacional', () => {
  it('acepta un número válido de Perú, Chile, México, España y EE. UU. y lo guarda normalizado', () => {
    const casos: [string, string][] = [
      ['+51 987 654 321', '+51 987 654 321'],
      ['+56 9 6123 4567', '+56 9 6123 4567'],
      ['+52 55 1234 5678', '+52 55 1234 5678'],
      ['+34 612 345 678', '+34 612 34 56 78'],
      ['+1 415 555 2671', '+1 415 555 2671'],
    ];
    for (const [entrada, guardado] of casos) {
      const r = telefonoSchema.safeParse(entrada);
      assert.equal(r.success, true, entrada);
      assert.equal(r.data, guardado, entrada);
    }
  });

  it('sin «+» se asume Perú (datos viejos y clientes que no mandan el país)', () => {
    assert.equal(telefonoSchema.parse('987 654 321'), '+51 987 654 321');
    assert.equal(telefonoSchema.parse('51987654321'), '+51 987 654 321');
    assert.equal(telefonoSchema.parse('(01) 234-5678'), '+51 1 2345678'); // un fijo de Lima también vale para un teléfono
    // Sin «+» el formulario y el esquema siguen leyendo Perú: un número chileno sin «+» no pasa.
    assert.equal(telefonoSchema.safeParse('56961234567').success, false);
  });

  it('vacío, null y ausente siguen siendo válidos: el teléfono es opcional', () => {
    assert.equal(telefonoSchema.parse(''), null);
    assert.equal(telefonoSchema.parse(null), null);
    assert.equal(telefonoSchema.parse(undefined), undefined);
    assert.equal(telefonoSchema.parse('   '), null);
  });

  it('rechaza lo que no es un número válido, con el mensaje del país', () => {
    for (const mal of ['abc', '98765432a', '12345', '+1 555 555 5555', '+51 9876', '887654321', '+999 123456']) {
      const r = telefonoSchema.safeParse(mal);
      assert.equal(r.success, false, mal);
      assert.equal(r.error?.issues[0]?.message, MENSAJE, mal);
    }
  });
});

describe('celular de WhatsApp: cualquier país, E.164 sin «+»', () => {
  it('normaliza celulares de varios países sin «+»', () => {
    assert.equal(normalizarCelular('+56 9 6123 4567'), '56961234567');
    assert.equal(normalizarCelular('+52 55 1234 5678'), '525512345678');
    assert.equal(normalizarCelular('+34 612 345 678'), '34612345678');
    assert.equal(normalizarCelular('+1 415 555 2671'), '14155552671');
  });

  it('acepta E.164 sin «+» (lo que guardan los vínculos y responde el bot): 56961234567 es Chile', () => {
    assert.equal(normalizarCelular('56961234567'), '56961234567');
    assert.equal(normalizarCelular('14155552671'), '14155552671');
    assert.equal(normalizarCelular('0056961234567'), '56961234567');
  });

  it('no rompe los vínculos peruanos: 51987654321 sigue siendo el mismo', () => {
    for (const ok of ['987654321', '987 654 321', '+51 987 654 321', '51987654321', '0051987654321', '(+51) 987-654-321']) {
      assert.equal(normalizarCelular(ok), '51987654321', ok);
    }
  });

  it('un fijo no sirve para WhatsApp, aunque sea válido', () => {
    assert.equal(normalizarCelular('+51 1 234 5678'), null); // Lima
    assert.equal(normalizarCelular('+34 91 123 45 67'), null); // Madrid
  });

  it('formatearCelular usa el formato internacional del país', () => {
    assert.equal(formatearCelular('51987654321'), '+51 987 654 321');
    assert.equal(formatearCelular('56961234567'), '+56 9 6123 4567');
    assert.equal(formatearCelular('34612345678'), '+34 612 34 56 78');
  });
});

describe('número extranjero que llega por el webhook de WhatsApp', () => {
  const mensaje = (remoteJid: string) => ({ event: 'messages.upsert', data: { key: { remoteJid, fromMe: false, id: 'MSG-1' }, message: { conversation: 'hola' } } });

  it('un JID de otro país se identifica con sus dígitos (no se lee como peruano)', () => {
    const [e] = interpretarWebhook(mensaje('14155552671@s.whatsapp.net'));
    assert.equal(e?.numero, '14155552671');
    const [c] = interpretarWebhook(mensaje('56961234567@s.whatsapp.net'));
    assert.equal(c?.numero, '56961234567');
  });

  it('un celular con número corto (Malvinas: 8 dígitos en total) también se identifica: el «+» lo hace internacional', () => {
    const [m] = interpretarWebhook(mensaje('50051234@s.whatsapp.net'));
    assert.equal(m?.numero, '50051234');
  });

  it('un JID peruano sigue igual', () => {
    const [p] = interpretarWebhook(mensaje('51987654321:12@s.whatsapp.net'));
    assert.equal(p?.numero, '51987654321');
  });

  it('un JID que no es un celular válido se ignora', () => {
    assert.deepEqual(interpretarWebhook(mensaje('15555555555@s.whatsapp.net')), []);
  });
});

describe('vínculos: el enmascarado muestra el prefijo de su país', () => {
  it('Perú sigue como antes y otros países muestran su propio prefijo', () => {
    assert.equal(mascara('51987654321'), '+51 ••• ••• 321');
    assert.equal(mascara('14155552671'), '+1 ••• ••• 671');
    assert.equal(mascara('56961234567'), '+56 ••• ••• 567');
    assert.equal(mascara('51987654321', 'telegram'), 'Telegram ••• 321');
  });
});

describe('lib/telefono: el criterio que comparten formulario y servidor', () => {
  it('parsearTelefono y parsearCelular distinguen móvil de fijo', () => {
    assert.ok(parsearTelefono('+51 1 234 5678'));
    assert.equal(parsearCelular('+51 1 234 5678'), null);
    assert.ok(parsearCelular('+51 987 654 321'));
    assert.equal(formatearTelefono('987654321'), '+51 987 654 321');
  });
});
