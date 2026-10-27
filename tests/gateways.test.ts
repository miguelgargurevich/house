// Barreras anti-SSRF de los gateways propios (parte pura): URL, dominios, direcciones no públicas, resolución y transporte fijado a la IP.
// Sin base de datos, sin red real ni DNS real: el resolver se inyecta y el transporte se prueba contra un servidor local.
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import {
  GatewayError, OCR_DESTINOS_INTERNOS, esIpBloqueada, etiquetaInterna, etiquetaVisible, fetchFijado, gatewayDeps, gatewayUsable, normalizarDominio,
  proveedorDeFila, resolverDestino, urlDeOcr, validarEntradaOcr, validarUrlDestino,
} from '../src/server/lib/gateways';

const DOMINIOS = new Set(['api.dashboardia.gargurevich.dev', 'omniroute.gargurevich.dev']);
const BASE = 'https://api.dashboardia.gargurevich.dev/v1';

function rechaza(fn: () => unknown, codigo: string, ctx: string) {
  assert.throws(fn, (e: unknown) => e instanceof GatewayError && e.codigo === codigo, `${ctx}: debía rechazarse con «${codigo}»`);
}

describe('validarUrlDestino: la URL base de un gateway', () => {
  it('acepta https, puerto 443 (o vacío) y host exacto de la lista; normaliza (minúsculas, sin barra final, sin 443)', () => {
    assert.deepEqual(validarUrlDestino(BASE, DOMINIOS), { url: BASE, host: 'api.dashboardia.gargurevich.dev' });
    assert.equal(validarUrlDestino('HTTPS://API.Dashboardia.Gargurevich.dev:443/v1/', DOMINIOS).url, BASE);
    assert.equal(validarUrlDestino('https://omniroute.gargurevich.dev', DOMINIOS).url, 'https://omniroute.gargurevich.dev');
    assert.equal(validarUrlDestino('https://api.dashboardia.gargurevich.dev./v1', DOMINIOS).host, 'api.dashboardia.gargurevich.dev', 'el punto final del FQDN');
  });

  it('http (y cualquier otro esquema) → rechazado', () => {
    rechaza(() => validarUrlDestino('http://api.dashboardia.gargurevich.dev/v1', DOMINIOS), 'https_obligatorio', 'http');
    rechaza(() => validarUrlDestino('ftp://api.dashboardia.gargurevich.dev/v1', DOMINIOS), 'https_obligatorio', 'ftp');
    rechaza(() => validarUrlDestino('file:///etc/passwd', DOMINIOS), 'https_obligatorio', 'file');
  });

  it('IP literal (v4, v6, decimal, hexadecimal, con punto final) → rechazada aunque la lista la contuviera', () => {
    const conIp = new Set(['1.2.3.4', '127.0.0.1', '169.254.169.254']);
    for (const u of ['https://1.2.3.4/v1', 'https://127.0.0.1/v1', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/v1', 'https://[2001:db8::1]/v1', 'https://2130706433/v1', 'https://0x7f.1/v1', 'https://127.1/v1', 'https://127.0.0.1./v1']) {
      rechaza(() => validarUrlDestino(u, conIp), 'ip_literal', u);
    }
  });

  it('puerto distinto de 443 → rechazado', () => {
    for (const p of [80, 8080, 8443, 5432, 22]) rechaza(() => validarUrlDestino(`https://api.dashboardia.gargurevich.dev:${p}/v1`, DOMINIOS), 'puerto', `puerto ${p}`);
  });

  it('usuario o contraseña en la URL → rechazados (también el truco user@host)', () => {
    rechaza(() => validarUrlDestino('https://usuario:clave@api.dashboardia.gargurevich.dev/v1', DOMINIOS), 'credenciales', 'user:pass');
    rechaza(() => validarUrlDestino('https://usuario@api.dashboardia.gargurevich.dev/v1', DOMINIOS), 'credenciales', 'user');
    rechaza(() => validarUrlDestino('https://api.dashboardia.gargurevich.dev@evil.example/v1', DOMINIOS), 'credenciales', 'host@evil');
  });

  it('dominio fuera de la lista → rechazado, con un mensaje que lo explica; el host debe ser EXACTO (ni subdominios ni sufijos)', () => {
    assert.throws(() => validarUrlDestino('https://otro.ejemplo.dev/v1', DOMINIOS), (x: unknown) => x instanceof GatewayError && x.codigo === 'dominio_no_permitido' && /otro\.ejemplo\.dev no está en la lista de dominios permitidos/.test(x.message));
    for (const u of ['https://sub.api.dashboardia.gargurevich.dev/v1', 'https://gargurevich.dev/v1', 'https://api.dashboardia.gargurevich.dev.evil.com/v1', 'https://evilapi.dashboardia.gargurevich.dev/v1', 'https://api-dashboardia.gargurevich.dev/v1']) {
      rechaza(() => validarUrlDestino(u, DOMINIOS), 'dominio_no_permitido', u);
    }
  });

  it('la base no admite ?query ni #fragmento; una URL de llamada sí admite ?query', () => {
    rechaza(() => validarUrlDestino(`${BASE}?x=1`, DOMINIOS), 'consulta', 'query');
    rechaza(() => validarUrlDestino(`${BASE}#frag`, DOMINIOS), 'consulta', 'fragmento');
    assert.equal(validarUrlDestino(`${BASE}/chat/completions?alt=sse`, DOMINIOS, { base: false }).url, `${BASE}/chat/completions?alt=sse`);
    rechaza(() => validarUrlDestino(`${BASE}/x#f`, DOMINIOS, { base: false }), 'consulta', 'fragmento en llamada');
  });

  it('basura → url_invalida', () => {
    for (const u of ['', 'no es una url', '//api.dashboardia.gargurevich.dev', 'https://']) rechaza(() => validarUrlDestino(u, DOMINIOS), 'url_invalida', JSON.stringify(u));
    rechaza(() => validarUrlDestino(`https://api.dashboardia.gargurevich.dev/${'a'.repeat(400)}`, DOMINIOS), 'url_invalida', 'demasiado larga');
  });
});

describe('normalizarDominio', () => {
  it('acepta sólo un host exacto con al menos dos etiquetas', () => {
    assert.equal(normalizarDominio('  API.Ejemplo.DEV. '), 'api.ejemplo.dev');
    assert.equal(normalizarDominio('xn--espaol-zwa.es'), 'xn--espaol-zwa.es');
  });
  it('rechaza IP, esquema, ruta, puerto, comodín, una sola etiqueta y vacío', () => {
    for (const d of ['', '   ', '1.2.3.4', '[::1]', 'https://api.ejemplo.dev', 'api.ejemplo.dev/v1', 'api.ejemplo.dev:443', '*.ejemplo.dev', 'localhost', 'a b.dev', '-x.dev', 'x..dev', 'ejemplo.123', 'a'.repeat(260) + '.dev']) {
      rechaza(() => normalizarDominio(d), 'dominio_invalido', JSON.stringify(d));
    }
  });
});

describe('esIpBloqueada: lo que NO es Internet público', () => {
  const BLOQUEADAS = [
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.254', '127.0.0.1', '127.255.255.254', '169.254.169.254', '169.254.0.1',
    '172.16.0.1', '172.31.255.255', '192.0.0.1', '192.0.2.1', '192.168.0.1', '192.168.255.255', '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9',
    '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fd00::1', 'fd00:ec2::254', 'fc00::1', 'fe80::1', 'fe80::1%en0', 'fec0::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe', '::ffff:c0a8:1',
    '64:ff9b::a00:1', '2001:db8::1', '2001::1', '2002:a00:1::1', '100::1', '3fff::1', 'no-es-una-ip', '',
  ];
  const PUBLICAS = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.0.1', '198.17.255.255', '198.20.0.1', '2606:4700:4700::1111', '2a00:1450:4009:81f::200e', '::ffff:8.8.8.8', '::ffff:808:808'];

  for (const ip of BLOQUEADAS) it(`bloquea ${JSON.stringify(ip)}`, () => assert.equal(esIpBloqueada(ip), true));
  for (const ip of PUBLICAS) it(`permite ${ip}`, () => assert.equal(esIpBloqueada(ip), false));
});

describe('resolverDestino: se resuelve en cada llamada y TODAS las direcciones deben ser públicas', () => {
  const original = gatewayDeps.resolver;
  afterEach(() => { gatewayDeps.resolver = original; });
  const dns = (...direcciones: string[]) => { gatewayDeps.resolver = async () => direcciones.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })); };

  it('públicas → devuelve la IP a la que se conectará (prefiere IPv4)', async () => {
    dns('2606:4700:4700::1111', '93.184.216.34');
    assert.deepEqual(await resolverDestino('api.dashboardia.gargurevich.dev'), { host: 'api.dashboardia.gargurevich.dev', ip: '93.184.216.34', family: 4 });
    dns('2606:4700:4700::1111');
    assert.deepEqual(await resolverDestino('h.ejemplo.dev'), { host: 'h.ejemplo.dev', ip: '2606:4700:4700::1111', family: 6 });
  });

  for (const privada of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.5.5', '192.168.1.10', '100.64.0.9', 'fd00::5', '::1', 'fe80::1']) {
    it(`un dominio permitido que resuelve a ${privada} → bloqueado (ip_privada)`, async () => {
      dns(privada);
      await assert.rejects(resolverDestino('api.dashboardia.gargurevich.dev'), (e: unknown) => e instanceof GatewayError && e.codigo === 'ip_privada');
    });
  }

  it('basta UNA dirección no pública entre varias (DNS-rebinding / round-robin con una interna)', async () => {
    dns('93.184.216.34', '8.8.8.8', '10.0.0.7');
    await assert.rejects(resolverDestino('h.ejemplo.dev'), (e: unknown) => e instanceof GatewayError && e.codigo === 'ip_privada');
  });

  it('sin respuesta, error o lista vacía → dns; el mensaje no revela la dirección interna', async () => {
    gatewayDeps.resolver = async () => { throw new Error('ENOTFOUND'); };
    await assert.rejects(resolverDestino('h.ejemplo.dev'), (e: unknown) => e instanceof GatewayError && e.codigo === 'dns');
    dns();
    await assert.rejects(resolverDestino('h.ejemplo.dev'), (e: unknown) => e instanceof GatewayError && e.codigo === 'dns');
    dns('10.9.8.7');
    await assert.rejects(resolverDestino('h.ejemplo.dev'), (e: unknown) => e instanceof GatewayError && !/10\.9\.8\.7/.test(e.message));
  });

  it('se vuelve a resolver en CADA llamada (no se cachea)', async () => {
    let n = 0;
    gatewayDeps.resolver = async () => { n++; return [{ address: n === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }]; };
    await resolverDestino('h.ejemplo.dev');
    await assert.rejects(resolverDestino('h.ejemplo.dev'), (e: unknown) => e instanceof GatewayError && e.codigo === 'ip_privada');
    assert.equal(n, 2);
  });
});

describe('fetchFijado: conecta a la IP ya validada y no sigue redirecciones', () => {
  let servidor: http.Server | undefined;
  afterEach(async () => { await new Promise<void>((r) => (servidor ? servidor.close(() => r()) : r())); servidor = undefined; });
  const levantar = async (manejador: http.RequestListener) => {
    servidor = http.createServer(manejador);
    await new Promise<void>((r) => servidor!.listen(0, '127.0.0.1', r));
    return (servidor.address() as AddressInfo).port;
  };

  it('el dominio NO se resuelve: se conecta a destino.ip aunque el nombre no exista; la cabecera Host sigue siendo el dominio', async () => {
    let visto: { host?: string; metodo?: string; cuerpo: string; auth?: string } | null = null;
    const puerto = await levantar((req, res) => {
      let cuerpo = '';
      req.on('data', (c) => { cuerpo += c; });
      req.on('end', () => { visto = { host: req.headers.host, metodo: req.method, cuerpo, auth: req.headers.authorization }; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
    });
    const r = await fetchFijado(`http://no-existe.gateway-de-prueba.invalid:${puerto}/v1/chat/completions?x=1`, {
      method: 'POST', headers: { Authorization: 'Bearer k-falsa', 'Content-Type': 'application/json' }, body: '{"a":1}', destino: { host: 'no-existe.gateway-de-prueba.invalid', ip: '127.0.0.1', family: 4 },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(visto!.host, `no-existe.gateway-de-prueba.invalid:${puerto}`);
    assert.equal(visto!.metodo, 'POST');
    assert.equal(visto!.cuerpo, '{"a":1}');
    assert.equal(visto!.auth, 'Bearer k-falsa');
  });

  it('sin destino validado no hace nada (nunca cae a resolver por su cuenta)', async () => {
    await assert.rejects(fetchFijado('http://no-existe.gateway-de-prueba.invalid/x', {}), (e: unknown) => e instanceof GatewayError);
  });

  it('una redirección 3xx se devuelve tal cual: NO se sigue', async () => {
    let segunda = 0;
    const puerto = await levantar((req, res) => {
      if (req.url === '/interno') { segunda++; res.end('secreto-interno'); return; }
      res.writeHead(302, { location: '/interno' });
      res.end();
    });
    const r = await fetchFijado(`http://h.invalid:${puerto}/v1`, { redirect: 'manual', destino: { host: 'h.invalid', ip: '127.0.0.1', family: 4 } });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), '/interno');
    assert.equal(segunda, 0);
  });

  it('respeta el tope de tiempo (signal) y la cancelación, con la razón original', async () => {
    const puerto = await levantar(() => { /* no responde */ });
    const destino = { host: 'h.invalid', ip: '127.0.0.1', family: 4 as const };
    await assert.rejects(fetchFijado(`http://h.invalid:${puerto}/lento`, { signal: AbortSignal.timeout(80), destino }), (e: unknown) => e instanceof Error && e.name === 'TimeoutError');
    const c = new AbortController();
    const p = fetchFijado(`http://h.invalid:${puerto}/lento`, { signal: c.signal, destino });
    c.abort(new DOMException('cancelado', 'AbortError'));
    await assert.rejects(p, (e: unknown) => e instanceof Error && e.name === 'AbortError');
    await assert.rejects(fetchFijado(`http://h.invalid:${puerto}/x`, { signal: AbortSignal.abort(), destino }));
  });

  it('un cuerpo FormData (como el del OCR) sale como multipart con su content-type', async () => {
    let tipo = '';
    let largo = 0;
    const puerto = await levantar((req, res) => { tipo = String(req.headers['content-type']); req.on('data', (c) => { largo += c.length; }); req.on('end', () => res.end('{}')); });
    const f = new FormData();
    f.append('file', new Blob(['abc'], { type: 'image/png' }), 'x.png');
    await fetchFijado(`http://h.invalid:${puerto}/api/extract`, { method: 'POST', body: f, destino: { host: 'h.invalid', ip: '127.0.0.1', family: 4 } });
    assert.match(tipo, /^multipart\/form-data; boundary=/);
    assert.ok(largo > 3);
  });
});

describe('proveedorDeFila y gatewayUsable: una sola resolución de proveedor', () => {
  const gw = { id: 7, nombre: 'Dashboard IA', base_url: BASE, modelo_por_defecto: 'qwen3-vl-flash', modelo_vision: 'qwen3-vl-flash', vision: true, prioridad: 2, habilitado: true };

  it('catálogo: por id; gateway: construido desde su fila (openai-compatible, con gatewayId); sin su fila → null', () => {
    assert.equal(proveedorDeFila({ proveedor: 'groq' })!.baseUrl, 'https://api.groq.com/openai/v1');
    assert.equal(proveedorDeFila({ proveedor: 'groq' })!.gatewayId, undefined);
    assert.equal(proveedorDeFila({ proveedor: 'dashboardia' }), null, 'el id retirado del catálogo ya no existe');
    const p = proveedorDeFila({ proveedor: 'gateway', gateway: gw })!;
    assert.deepEqual([p.id, p.nombre, p.tipo, p.baseUrl, p.vision, p.modeloVision, p.prioridad, p.gatewayId], ['gateway', 'Dashboard IA', 'openai-compatible', BASE, true, 'qwen3-vl-flash', 2, 7]);
    assert.equal(proveedorDeFila({ proveedor: 'gateway', gateway: null }), null);
    assert.equal(proveedorDeFila({ proveedor: 'gateway' }), null);
  });

  it('gatewayUsable: habilitado Y su dominio sigue permitido (si no, falla cerrado)', () => {
    assert.equal(gatewayUsable(gw, DOMINIOS), true);
    assert.equal(gatewayUsable({ ...gw, habilitado: false }, DOMINIOS), false);
    assert.equal(gatewayUsable(gw, new Set(['omniroute.gargurevich.dev'])), false, 'el dominio salió de la lista');
    assert.equal(gatewayUsable(gw, new Set()), false);
    assert.equal(gatewayUsable({ ...gw, base_url: 'http://api.dashboardia.gargurevich.dev/v1' }, DOMINIOS), false, 'una URL guardada que ya no cumple');
  });

  it('las etiquetas de gateway llevan su id para no chocar entre gateways', () => {
    assert.equal(etiquetaInterna(7, 'principal'), 'g7:principal');
    assert.equal(etiquetaInterna(null, 'principal'), 'principal');
    assert.equal(etiquetaVisible('g7:principal', 7), 'principal');
    assert.equal(etiquetaVisible('principal', null), 'principal');
    assert.equal(etiquetaVisible('g8:principal', 7), 'g8:principal');
  });
});

describe('OCR: destino interno de lista FIJA en el código, o https público con las mismas barreras', () => {
  it('la lista fija contiene SÓLO house-ocr', () => {
    assert.deepEqual(OCR_DESTINOS_INTERNOS, { 'house-ocr': 'http://house-ocr:5050' });
  });

  it('interno: por omisión house-ocr; acepta exactamente ese URL (también con barra final o mayúsculas)', () => {
    assert.deepEqual(validarEntradaOcr({ modo: 'interno' }, new Set()), { modo: 'interno', destino_interno: 'house-ocr', base_url: null });
    for (const u of ['http://house-ocr:5050', 'http://house-ocr:5050/', ' HTTP://House-OCR:5050 ']) {
      assert.equal(validarEntradaOcr({ modo: 'interno', base_url: u }, new Set()).destino_interno, 'house-ocr', u);
    }
  });

  it('interno: http://otro-servicio:5432 y http://postgres:5432 (y cualquier otro) se RECHAZAN', () => {
    for (const u of ['http://otro-servicio:5432', 'http://postgres:5432', 'http://house-ocr:5432', 'http://house-ocr:5050.evil.com', 'http://house-ocr:5050/../x', 'http://house-ocr', 'http://127.0.0.1:5050', 'http://localhost:5050', 'http://169.254.169.254', 'https://house-ocr:5050', 'http://house-ocr:5050@postgres:5432']) {
      rechaza(() => validarEntradaOcr({ modo: 'interno', base_url: u }, new Set()), 'ocr_destino', u);
    }
  });

  it('público: pasa por las barreras de los gateways (https, 443, sin credenciales ni IP, dominio permitido)', () => {
    const dominios = new Set(['ocr.ejemplo.dev']);
    assert.deepEqual(validarEntradaOcr({ modo: 'publico', base_url: 'https://ocr.ejemplo.dev/' }, dominios), { modo: 'publico', destino_interno: null, base_url: 'https://ocr.ejemplo.dev' });
    rechaza(() => validarEntradaOcr({ modo: 'publico', base_url: 'http://ocr.ejemplo.dev' }, dominios), 'https_obligatorio', 'http');
    rechaza(() => validarEntradaOcr({ modo: 'publico', base_url: 'http://otro-servicio:5432' }, dominios), 'https_obligatorio', 'otro-servicio');
    rechaza(() => validarEntradaOcr({ modo: 'publico', base_url: 'http://postgres:5432' }, dominios), 'https_obligatorio', 'postgres');
    rechaza(() => validarEntradaOcr({ modo: 'publico', base_url: 'https://postgres:5432' }, dominios), 'puerto', 'puerto');
    rechaza(() => validarEntradaOcr({ modo: 'publico', base_url: 'https://10.0.0.5' }, dominios), 'ip_literal', 'ip');
    rechaza(() => validarEntradaOcr({ modo: 'publico', base_url: 'https://otro.ejemplo.dev' }, dominios), 'dominio_no_permitido', 'fuera de la lista');
    rechaza(() => validarEntradaOcr({ modo: 'publico', base_url: 'https://u:p@ocr.ejemplo.dev' }, dominios), 'credenciales', 'credenciales');
    rechaza(() => validarEntradaOcr({ modo: 'publico', base_url: '' }, dominios), 'url_invalida', 'vacío');
  });

  it('urlDeOcr: lo guardado se re-valida al usarlo (destino interno fuera de la lista, dominio retirado, modo raro)', () => {
    assert.deepEqual(urlDeOcr({ modo: 'interno', destino_interno: 'house-ocr', base_url: null }, new Set()), { baseUrl: 'http://house-ocr:5050', interno: true });
    rechaza(() => urlDeOcr({ modo: 'interno', destino_interno: 'postgres', base_url: null }, new Set()), 'ocr_destino', 'interno ajeno');
    rechaza(() => urlDeOcr({ modo: 'interno', destino_interno: null, base_url: 'http://postgres:5432' }, new Set()), 'ocr_destino', 'interno con url');
    assert.deepEqual(urlDeOcr({ modo: 'publico', destino_interno: null, base_url: 'https://ocr.ejemplo.dev' }, new Set(['ocr.ejemplo.dev'])), { baseUrl: 'https://ocr.ejemplo.dev', interno: false });
    rechaza(() => urlDeOcr({ modo: 'publico', destino_interno: null, base_url: 'https://ocr.ejemplo.dev' }, new Set()), 'dominio_no_permitido', 'dominio retirado');
    rechaza(() => urlDeOcr({ modo: 'otro', destino_interno: null, base_url: null }, new Set()), 'ocr_destino', 'modo raro');
  });
});
