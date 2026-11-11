// Cliente mínimo de WebDriver (W3C) para el servidor Appium con el driver XCUITest, sin dependencias: sólo `fetch`.
// Lo usa grabar-iphone.mjs para manejar el simulador de iPhone (toques nativos, teclado, WebView de la app).
// Appium se instala FUERA del repo (ver docs/marketing/guiones-videos.md, «Cómo se graba el iPhone»):
//   APPIUM_HOME=<carpeta> npx appium --address 127.0.0.1 --port 4723     (con `appium driver install xcuitest`)

export class SesionIOS {
  constructor(base, id) { this.base = base; this.id = id; }

  static async crear({ base = 'http://127.0.0.1:4723', udid, extra = {} }) {
    const capabilities = {
      alwaysMatch: {
        platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:udid': udid, 'appium:noReset': true,
        'appium:wdaLaunchTimeout': 600000, 'appium:wdaConnectionTimeout': 600000, 'appium:newCommandTimeout': 900,
        // Sin esto el depurador remoto no encuentra el WebView de la app de desarrollo.
        'appium:additionalWebviewBundleIds': ['*'], 'appium:webviewConnectTimeout': 20000,
        'appium:maxTypingFrequency': Number(process.env.TECLEO ?? 1000),
        ...extra,
      },
    };
    const r = await fetch(`${base}/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capabilities }) });
    const j = await r.json();
    if (!j.value?.sessionId) throw new Error(`Appium no abrió la sesión: ${JSON.stringify(j.value).slice(0, 400)}`);
    return new SesionIOS(base, j.value.sessionId);
  }

  async cmd(metodo, ruta, cuerpo) {
    const r = await fetch(`${this.base}/session/${this.id}${ruta}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.value?.error) throw new Error(`${metodo} ${ruta}: ${j.value?.message?.split('\n')[0] ?? r.status}`);
    return j.value;
  }

  /** `mobile: <nombre>` (comandos nativos de XCUITest). */
  mobile(nombre, args = {}) { return this.cmd('POST', '/execute/sync', { script: `mobile: ${nombre}`, args: [args] }); }
  /** JavaScript dentro de la página (sólo con el contexto WEBVIEW activo). */
  js(script, ...args) { return this.cmd('POST', '/execute/sync', { script, args }); }

  contextos() { return this.mobile('getContexts', { waitForWebviewMs: 0 }); }
  async contexto(nombre) { await this.cmd('POST', '/context', { name: nombre }); }
  /** Pasa al WebView de la app (espera a que aparezca) y devuelve su id. */
  async webview(esperaMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < esperaMs) {
      const cs = await this.contextos().catch(() => []);
      const w = cs.find((c) => String(c.id).startsWith('WEBVIEW') && /process-App|torre/i.test(`${c.bundleId ?? ''}`) && !/^about:/.test(c.url ?? ''));
      if (w) { await this.contexto(w.id); this.webId = w.id; return w.id; }
      await new Promise((r) => setTimeout(r, 700));
    }
    throw new Error('No aparece el WebView de la app');
  }
  async nativo() { await this.contexto('NATIVE_APP'); }

  async elemento(usando, valor) {
    const e = await this.cmd('POST', '/element', { using: usando, value: valor });
    return Object.values(e)[0];
  }
  async buscar(usando, valor, ms = 8000) {
    const t0 = Date.now();
    for (;;) {
      try { return await this.elemento(usando, valor); } catch (e) { if (Date.now() - t0 > ms) throw e; await new Promise((r) => setTimeout(r, 400)); }
    }
  }
  rect(el) { return this.cmd('GET', `/element/${el}/rect`); }
  /** Toque nativo en puntos de la pantalla. */
  tocar(x, y) { return this.mobile('tap', { x: Math.round(x), y: Math.round(y) }); }
  /** Teclea en un campo de texto de la pantalla, tecla por tecla (la velocidad la fija `maxTypingFrequency`, teclas por minuto). `tipo`: TextField (correo,
   *  texto), SecureTextField (contraseña) o TextView; el campo ya debe tener el foco (se tocó antes). Deja activo el contexto WebView.
   *  (`mobile: keys` tarda ~0,7 s por tecla; escribir en el elemento nativo es mucho más rápido y se ve igual de real.) */
  async teclear(texto, tipo = 'TextField') {
    await this.nativo();
    try {
      const campo = await this.buscar('-ios predicate string', `type == 'XCUIElementType${tipo}' AND visible == 1`, 4000);
      await this.cmd('POST', `/element/${campo}/value`, { text: texto });
    } finally { if (this.webId) await this.contexto(this.webId); }
  }
  /** Deslizamiento con el dedo (acciones W3C: toca, mueve y levanta, SIN mantener pulsado: `dragFromToForDuration` mantiene antes de arrastrar y sobre un
   *  enlace abre su vista previa). De (x1,y1) a (x2,y2) en `seg` segundos. */
  async arrastrar(x1, y1, x2, y2, seg = 0.8) {
    await this.cmd('POST', '/actions', { actions: [{ type: 'pointer', id: 'dedo', parameters: { pointerType: 'touch' }, actions: [
      { type: 'pointerMove', duration: 0, x: Math.round(x1), y: Math.round(y1) },
      { type: 'pointerDown', button: 0 },
      { type: 'pointerMove', duration: Math.round(seg * 1000), x: Math.round(x2), y: Math.round(y2) },
      { type: 'pointerUp', button: 0 },
    ] }] });
    await this.cmd('DELETE', '/actions').catch(() => {});
  }
  captura() { return this.cmd('GET', '/screenshot'); }
  async cerrar() { try { await fetch(`${this.base}/session/${this.id}`, { method: 'DELETE', signal: AbortSignal.timeout(8000) }); } catch { /* ya cerrada */ } }
}
