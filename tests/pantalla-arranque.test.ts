// Pantalla de arranque animada de la app de iOS/Android: está en el HTML inicial, sólo se ve dentro de la app (user agent TorreApp/),
// respeta «reducir movimiento», empalma con el splash nativo, se quita al montar la app y tiene red de seguridad de 8 s.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const fuente = (ruta: string) => readFileSync(ruta, 'utf8');
const html = fuente('index.html');
const script = fuente('public/arranque-app.js');

type Opciones = { conPuente?: boolean };

/** Ejecuta public/arranque-app.js con un DOM y una ventana falsos. Los temporizadores y cuadros se guardan para dispararlos a mano. */
function correr(enApp: boolean, { conPuente = true }: Opciones = {}) {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const frames: Array<() => void> = [];
  const clases = new Set<string>(enApp ? ['en-app'] : []);
  const estado = { removido: false, hide: 0, argsHide: null as unknown[] | null };
  const el = {
    classList: { add: (c: string) => { clases.add(c); }, contains: (c: string) => clases.has(c) },
    parentNode: { removeChild: () => { estado.removido = true; } },
  };
  const ventana: Record<string, any> = {
    requestAnimationFrame: (f: () => void) => { frames.push(f); },
  };
  if (conPuente) {
    ventana.Capacitor = {
      nativePromise: (...args: unknown[]) => { estado.hide++; estado.argsHide = args; return Promise.resolve(); },
    };
  }
  const sandbox = {
    window: ventana,
    document: {
      getElementById: (id: string) => (id === 'arranque-app' ? el : null),
      documentElement: { classList: { contains: (c: string) => clases.has(c) } },
    },
    setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; },
  };
  vm.runInNewContext(script, sandbox);
  const dibujarCuadros = () => { while (frames.length) frames.shift()!(); };
  const disparar = (ms: number) => { for (const t of timers.filter((x) => x.ms === ms)) t.fn(); };
  return { ventana, estado, timers, clases, dibujarCuadros, disparar };
}

describe('pantalla de arranque en el HTML inicial', () => {
  it('está antes de #root, con su CSS en línea y el script clásico antes del bundle de la app', () => {
    const marcado = html.indexOf('id="arranque-app"');
    assert.ok(marcado > 0 && marcado < html.indexOf('id="root"'), 'el marcado va antes de #root');
    assert.ok(html.indexOf('<style>') < html.indexOf('</head>'), 'el CSS va en línea en el <head>');
    assert.ok(html.indexOf('src="/arranque-app.js"') < html.indexOf('src="/src/main.tsx"'), 'el script de arranque va antes del bundle');
  });

  it('se oculta en el navegador y sólo se ve con html.en-app (la clase que pone theme-init.js antes de pintar)', () => {
    assert.match(html, /#arranque-app \{ display: none; \}/);
    assert.match(html, /html\.en-app #arranque-app \{[^}]*display: flex/);
    assert.match(fuente('public/theme-init.js'), /\\bTorreApp\\\//, 'theme-init.js detecta TorreApp/ antes de pintar');
  });

  it('respeta «reducir movimiento»: sin giro, rebote ni parpadeo; sólo un fundido', () => {
    assert.match(html, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.arr-entra[\s\S]*?\.arr-respira[\s\S]*?\.arr-ventana[\s\S]*?\.arr-luz[\s\S]*?\.arr-puerta[\s\S]*?animation: none; \}/);
    assert.match(html, /#arranque-app svg \{[^}]*animation: arr-fundido/);
  });

  it('anima sólo transform y opacity (60 fps): ningún @keyframes toca tamaño, posición ni trazo', () => {
    const keyframes = html.slice(html.indexOf('@keyframes'), html.indexOf('@media (prefers-reduced-motion'));
    assert.ok(keyframes.includes('@keyframes arr-entra'), 'se leyó el bloque de keyframes');
    assert.doesNotMatch(keyframes, /\b(width|height|top|left|right|bottom|margin|stroke[-\w]*|d)\s*:/);
  });

  it('dibuja el mismo edificio que el ícono de Torre (sin baldosa, como el splash nativo)', () => {
    const icono = fuente('src/ui/IconoTorre.tsx');
    assert.ok(icono.includes('torre: { x: 10, y: 5.5, width: 12, height: 21, rx: 1.6 }'));
    assert.ok(icono.includes('puerta: { x: 14.6, y: 21.6, width: 2.8, height: 4.9 }'));
    for (const t of ['<rect x="10" y="5.5" width="12" height="21" rx="1.6"', '<rect x="14.6" y="21.6" width="2.8" height="4.9"', 'x="16.8" y="18.1" width="2.2"']) {
      assert.ok(html.includes(t), t);
    }
    assert.equal((html.match(/class="arr-ventana"/g) ?? []).length, 6, 'seis ventanas, como el ícono');
  });

  it('el fondo es el verde del splash nativo (#0f766e) y la configuración nativa lo mantiene igual', () => {
    assert.match(html, /background: #0f766e;/);
    assert.match(fuente('mobile/capacitor.config.ts'), /backgroundColor: '#0f766e'/);
  });

  it('el splash nativo tiene su red de seguridad: se oculta solo a los 3 s como máximo', () => {
    const cap = fuente('mobile/capacitor.config.ts');
    assert.match(cap, /launchAutoHide: true,/);
    const ms = Number(/launchShowDuration: (\d+)/.exec(cap)?.[1]);
    assert.ok(ms > 0 && ms <= 3000, `launchShowDuration = ${ms}`);
  });
});

describe('public/arranque-app.js (comportamiento, con un DOM falso)', () => {
  it('en el navegador retira el marcado en seguida y no toca el puente ni programa temporizadores', () => {
    const r = correr(false);
    assert.equal(r.estado.removido, true);
    assert.equal(r.estado.hide, 0);
    assert.equal(r.timers.length, 0);
  });

  it('en la app no retira nada al cargar y, tras dos cuadros, oculta el splash nativo una sola vez con el puente de Capacitor', () => {
    const r = correr(true);
    assert.equal(r.estado.removido, false);
    r.dibujarCuadros();
    assert.equal(r.estado.hide, 1);
    // Los argumentos llegan desde el contexto vm (otro realm): se comparan como texto.
    assert.equal(JSON.stringify(r.estado.argsHide), '["SplashScreen","hide",{}]');
  });

  it('sin puente de Capacitor no falla: la pantalla sigue su curso (el temporizador nativo oculta el splash)', () => {
    const r = correr(true, { conPuente: false });
    assert.doesNotThrow(() => r.dibujarCuadros());
    r.ventana.torreArranque.quitar();
    r.disparar(260);
    assert.equal(r.estado.removido, true);
  });

  it('quitar() la despide con la clase salir (fundido de 250 ms, sin clics) y la retira; llamarla de nuevo no hace nada', () => {
    const r = correr(true);
    r.ventana.torreArranque.quitar();
    assert.ok(r.clases.has('salir'));
    assert.equal(r.estado.removido, false, 'se retira después del fundido');
    r.disparar(260);
    assert.equal(r.estado.removido, true);
    const antes = r.timers.length;
    r.ventana.torreArranque.quitar();
    assert.equal(r.timers.length, antes, 'segunda llamada sin efecto');
  });

  it('red de seguridad: a los 8 s se quita aunque la app nunca llame a quitar()', () => {
    const r = correr(true);
    assert.ok(r.timers.some((t) => t.ms === 8000), 'hay un temporizador de 8 s');
    r.disparar(8000);
    assert.ok(r.clases.has('salir'));
    r.disparar(260);
    assert.equal(r.estado.removido, true);
  });
});

describe('se quita al montar la app', () => {
  it('App llama a quitarPantallaDeArranque en un useEffect al montar, y ese módulo usa torreArranque.quitar()', () => {
    const app = fuente('src/App.tsx');
    assert.match(app, /import \{ quitarPantallaDeArranque \} from '\.\/app\/pantallaDeArranque';/);
    assert.match(app, /useEffect\(\(\) => \{\s*quitarPantallaDeArranque\(\);\s*\}, \[\]\);/);
    assert.match(fuente('src/app/pantallaDeArranque.ts'), /\.torreArranque;\s*pantalla\?\.quitar\(\);/);
  });
});
