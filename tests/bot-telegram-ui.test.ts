// «Vincular Telegram» en Mi perfil y «Bot de Telegram» en el Llavero: la lógica pura se prueba de verdad; la estructura de la pantalla se fija con la fuente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { estadoCanales, estadoTelegram, type CanalesMe } from '../src/pages/shared/_parts/canalesFormato';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const empresa = { id: 1, nombre: 'Empresa A' };
const datos = (p: Partial<CanalesMe> = {}): CanalesMe => ({ vinculos: [], codigo_vigente: null, destinos: [], telegram: { disponible: true, bot_usuario: 'house_bot' }, ...p });

describe('estado de «Vincular Telegram»', () => {
  it('oculto sin datos, sin bot activo o sin empresa; «listo» con bot; «vinculado» con vínculo de Telegram', () => {
    assert.equal(estadoTelegram(null), 'oculto');
    assert.equal(estadoTelegram(datos({ telegram: { disponible: false, bot_usuario: null } })), 'oculto');
    assert.equal(estadoTelegram(datos({ telegram: undefined })), 'oculto', 'servidor viejo sin el campo');
    assert.equal(estadoTelegram(datos()), 'listo');
    assert.equal(estadoTelegram(datos({ vinculos: [{ id: 1, canal: 'telegram', identificador: 'Telegram ••• 001', verificado_at: '2026-10-27T00:00:00Z', empresa }] })), 'vinculado');
  });
  it('un vínculo de Telegram no cuenta como WhatsApp (y al revés)', () => {
    const tg = { id: 1, canal: 'telegram', identificador: 'Telegram ••• 001', verificado_at: '2026-10-27T00:00:00Z', empresa };
    assert.notEqual(estadoCanales(datos({ vinculos: [tg], destinos: [{ empresa, disponible: true, numero: null }] })), 'vinculado');
    const wa = { ...tg, canal: 'whatsapp' };
    assert.equal(estadoTelegram(datos({ vinculos: [wa] })), 'listo');
  });
});

describe('estructura de las pantallas', () => {
  it('Mi perfil: usa `api()` con los endpoints de Telegram, el enlace del bot abre en pestaña nueva sin referrer y el botón dice «Vincular Telegram»', () => {
    const p = fuente('src/pages/shared/_parts/TelegramPerfil.tsx');
    assert.match(p, /api<CanalesMe>\('\/api\/me\/canales'\)/);
    assert.match(p, /\/api\/me\/canales\/telegram\/codigo/);
    assert.match(p, /`\/api\/me\/canales\/\$\{vinculo\.id\}`, \{ method: 'DELETE' \}/);
    assert.match(p, /Vincular Telegram/);
    assert.match(p, /rel="noopener noreferrer"/);
    assert.doesNotMatch(p, /\bfetch\(/);
    assert.match(fuente('src/pages/shared/Perfil.tsx'), /<TelegramPerfil \/>/);
  });
  it('Llavero: sección «Bot de Telegram» con token de contraseña, Probar, Pausar/Activar y Quitar; sin `fetch` directo', () => {
    const s = fuente('src/pages/superadmin/_parts/llavero/TelegramSeccion.tsx');
    assert.match(s, /Bot de Telegram/);
    assert.match(s, /type="password"/);
    assert.match(s, /\/api\/llavero\/telegram\/probar/);
    assert.match(s, /method: 'PUT'/);
    assert.match(s, /method: 'PATCH'/);
    assert.match(s, /method: 'DELETE'/);
    assert.match(s, /Quitar/);
    assert.doesNotMatch(s, /\bfetch\(/);
    assert.doesNotMatch(s, /token_enc|secreto/, 'la pantalla no maneja secretos del servidor');
    assert.match(fuente('src/pages/superadmin/Integraciones.tsx'), /<TelegramSeccion\b/);
    assert.doesNotMatch(fuente('src/pages/superadmin/Llavero.tsx'), /<TelegramSeccion\b/);
  });
});
