// Tarjeta de cierre de marca de los videos de la app (v9, v10): la misma para Android y para iPhone. Una imagen de 6 s, sin toques.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

export const CIERRE_HTML = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0f766e;color:#f0fdfa;font-family:Figtree,system-ui,sans-serif;display:grid;place-items:center}
  .c{text-align:center;padding:0 24px} .m{display:inline-flex;align-items:center;gap:14px;font-size:58px;font-weight:600}
  .l{width:78px;height:78px;border-radius:18px;background:#f0fdfa;display:grid;place-items:center}
  p{font-size:44px;margin:40px 0 0;opacity:.95;line-height:1.25} small{display:block;margin-top:30px;font-size:34px;opacity:.8}
</style><div class="c"><div class="m"><span class="l"><svg viewBox="0 0 32 32" width="50" height="50"><g transform="translate(16 16) scale(1.2) translate(-16 -16)"><rect x="10" y="5.5" width="12" height="21" rx="1.6" fill="none" stroke="#0f766e" stroke-width="2.2"/><g fill="#0f766e"><rect x="13" y="9.5" width="2.2" height="2.2"/><rect x="16.8" y="9.5" width="2.2" height="2.2"/><rect x="13" y="13.8" width="2.2" height="2.2"/><rect x="16.8" y="13.8" width="2.2" height="2.2"/><rect x="13" y="18.1" width="2.2" height="2.2"/><rect x="16.8" y="18.1" width="2.2" height="2.2"/><rect x="14.6" y="21.6" width="2.8" height="4.9"/></g></g></svg></span>Torre</div>
<p>Tu condominio, en orden.</p><small>Descárgala en torrecondominios.com/app</small></div>`;

/** Renderiza la tarjeta en Chromium y la deja como `<salida>/e<n>.mp4` (largoMs + 1 s). Devuelve el recorte (0: la tarjeta empieza en 0). */
export async function crearCierre(salida, n, largoMs) {
  const { chromium } = require(process.env.PLAYWRIGHT ?? '/opt/homebrew/lib/node_modules/playwright');
  const png = join(salida, 'cierre.png');
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, locale: 'es-PE' });
    const p = await ctx.newPage();
    await p.setContent(CIERRE_HTML);
    await p.screenshot({ path: png });
  } finally { await b.close(); }
  const seg = (largoMs + 1000) / 1000;
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', png, '-t', String(seg), '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'medium', '-crf', '20', join(salida, `e${n}.mp4`)]);
  rmSync(png, { force: true });
  return 0;
}
