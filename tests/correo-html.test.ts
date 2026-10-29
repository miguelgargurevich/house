// Plantilla del correo HTML: escapa todo lo que llega de fuera, trae el enlace, el texto plano equivalente y los colores del sitio.
import './helpers/env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enviarCorreo, type DepsAvisos } from '../src/server/services/avisos/canales';
import { escaparHtml, plantillaCorreo } from '../src/server/services/avisos/correoHtml';

const base = { titulo: 'Te invitaron a House', parrafos: ['Hola Rosa:', 'Crea tu contraseña para entrar.'], boton: { texto: 'Crear mi contraseña', url: 'https://house.ejemplo.test/invitacion?token=abc_DEF-123' }, pie: 'Si no esperabas este correo, ignóralo.' };

describe('plantillaCorreo', () => {
  it('escapa <script>, comillas y & en título, párrafos, botón y pie', () => {
    const peligro = `<script>alert("x")</script> & 'y'`;
    const { html } = plantillaCorreo({ titulo: peligro, parrafos: [peligro], boton: { texto: peligro, url: 'https://a.test/?a=1&b="2"' }, pie: peligro });
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /alert\("x"\)/);
    assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; &#39;y&#39;/);
    assert.match(html, /href="https:\/\/a\.test\/\?a=1&amp;b=&quot;2&quot;"/);
    assert.equal(escaparHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  });

  it('un enlace con esquema peligroso (javascript:, data:) no llega al href', () => {
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x']) {
      const { html } = plantillaCorreo({ ...base, boton: { texto: 'Ir', url } });
      assert.doesNotMatch(html, /javascript:|data:text|vbscript:/i, url);
      assert.match(html, /href="#"/);
    }
  });

  it('trae el enlace (en el botón y como texto) y el texto plano equivalente', () => {
    const { html, texto } = plantillaCorreo(base);
    assert.match(html, /<a href="https:\/\/house\.ejemplo\.test\/invitacion\?token=abc_DEF-123"[^>]*>Crear mi contraseña<\/a>/);
    assert.equal(html.split('token=abc_DEF-123').length - 1, 3, 'el enlace sale en el botón y, como href y como texto, en el respaldo copiable');
    assert.equal(texto, 'Te invitaron a House\n\nHola Rosa:\n\nCrea tu contraseña para entrar.\n\nCrear mi contraseña: https://house.ejemplo.test/invitacion?token=abc_DEF-123\n\nSi no esperabas este correo, ignóralo.');
    assert.doesNotMatch(texto, /<|&amp;/);
  });

  it('tiene la cara del sitio: colores de marca, logo en celda de color, 560 px, celular y modo oscuro', () => {
    const { html } = plantillaCorreo(base);
    assert.match(html, /#007565/, 'brand claro');
    assert.match(html, /#4bc1ad/, 'brand oscuro');
    assert.match(html, /#f5f9f7/, 'fondo');
    assert.match(html, /<td class="logo"[^>]*>H<\/td>/);
    assert.match(html, />House<\/td>/);
    assert.match(html, /max-width:100%/);
    assert.match(html, /width="560"/);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.match(html, /max-width:600px/);
    assert.match(html, /<meta name="color-scheme" content="light dark">/);
    assert.doesNotMatch(html, /<svg|<script|<link|@import/i, 'nada que los clientes de correo bloqueen');
  });

  it('sin botón ni pie no deja huecos ni enlaces', () => {
    const { html, texto } = plantillaCorreo({ titulo: 'Aviso', parrafos: ['Uno.', 'Dos.'] });
    assert.doesNotMatch(html, /<a /);
    assert.equal(texto, 'Aviso\n\nUno.\n\nDos.');
  });
});

describe('enviarCorreo con html', () => {
  const deps = (cuerpos: Record<string, unknown>[]): DepsAvisos => ({
    ahora: () => new Date(),
    env: { RESEND_API_KEY: 're_falsa', MAIL_FROM: 'House <house@ejemplo.test>' },
    fetch: (async (_u: string | URL | Request, init?: RequestInit) => { cuerpos.push(JSON.parse(String(init?.body))); return new Response('{}', { status: 200 }); }) as typeof fetch,
  });

  it('manda text Y html; sin html el cuerpo es el de siempre (sólo text)', async () => {
    const enviados: Record<string, unknown>[] = [];
    await enviarCorreo(deps(enviados), 'a@ejemplo.test', 'Asunto', 'texto plano', undefined, '<p>hola</p>');
    await enviarCorreo(deps(enviados), 'a@ejemplo.test', 'Asunto', 'texto plano');
    assert.equal(enviados[0]!.text, 'texto plano');
    assert.equal(enviados[0]!.html, '<p>hola</p>');
    assert.equal(enviados[1]!.text, 'texto plano');
    assert.ok(!('html' in enviados[1]!), 'los demás correos siguen mandando sólo texto');
  });
});
