// El color del texto de la barra de estado del teléfono (hora, señal, batería) dentro de la app de Torre (13-nov). Desde que la app va a
// pantalla completa (mobile/capacitor.config.ts, contentInset 'never'), esa barra queda ENCIMA del techo de la web (src/index.css), que
// toma el fondo del tema: en oscuro, con el texto negro de iOS no se leería la hora. Se elige por el brillo REAL del techo y se vuelve a
// mirar cuando cambia el tema (clase `dark` del <html>). PURO salvo `aplicarALaBarraDeEstado` y `seguirAlTema`.

/** 'DARK' = texto CLARO (para fondos oscuros) y 'LIGHT' = texto oscuro: así los nombra el plugin StatusBar de Capacitor. */
export type EstiloDeLaBarra = 'DARK' | 'LIGHT';

/** Brillo de 0 a 1 de un color calculado por el navegador: «rgb(…)»/«rgba(…)» (luminancia WCAG) u «oklch(L …)» (su L). Si no, null. */
export function brillo(color: string | null | undefined): number | null {
  const c = String(color || '').trim();
  const ok = /^oklch\(\s*([\d.]+)(%?)/i.exec(c);
  if (ok) { const l = Number(ok[1]); return ok[2] ? l / 100 : l; }
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(c);
  if (!m) return null;
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(Number(m[1])) + 0.7152 * lin(Number(m[2])) + 0.0722 * lin(Number(m[3]));
}

/** Texto claro sobre fondo oscuro, oscuro sobre claro. Sin un color legible, null (se deja el del sistema). */
export function estiloParaElFondo(color: string | null | undefined): EstiloDeLaBarra | null {
  const b = brillo(color);
  if (b === null) return null;
  // oklch(L) es perceptual (0.5 ≈ gris medio); la luminancia WCAG no (gris medio ≈ 0.2). Los dos fondos del tema quedan lejos del corte.
  const corte = /^oklch/i.test(String(color).trim()) ? 0.6 : 0.4;
  return b < corte ? 'DARK' : 'LIGHT';
}

type StatusBar = { setStyle(o: { style: EstiloDeLaBarra }): Promise<unknown> };
type CapacitorGlobal = { isNativePlatform?: () => boolean; isPluginAvailable?: (n: string) => boolean; Plugins?: { StatusBar?: StatusBar } };

/** Lo aplica si la página corre dentro de la app y la app trae el plugin (una instalada antes no lo trae: entonces no hace nada). */
export function aplicarALaBarraDeEstado(estilo: EstiloDeLaBarra | null): void {
  if (!estilo || typeof window === 'undefined') return;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap?.isNativePlatform?.() || !cap.isPluginAvailable?.('StatusBar')) return;
  cap.Plugins?.StatusBar?.setStyle({ style: estilo }).catch(() => undefined);
}

/** Dentro de la app: aplica el estilo según el fondo del <body> (el del techo) al cargar y cada vez que cambia el tema. */
export function seguirAlTema(): void {
  if (typeof document === 'undefined' || !document.documentElement.classList.contains('en-app')) return;
  const aplicar = () => aplicarALaBarraDeEstado(estiloParaElFondo(getComputedStyle(document.body).backgroundColor));
  aplicar();
  new MutationObserver(() => window.requestAnimationFrame(aplicar))
    .observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
}
