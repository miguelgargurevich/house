// Correo HTML con la cara del sitio. Se arma con TABLAS y estilos en línea (Gmail y Outlook ignoran casi todo lo demás) y los colores son los
// tokens de `src/index.css` convertidos a hex (el correo no entiende oklch). El logo es una celda de color con la «H»: un SVG no se ve en Gmail.
// Todo texto que llega de fuera (nombre, empresa…) se escapa aquí; quien llama pasa texto plano, nunca HTML.

export interface PlantillaCorreo {
  titulo: string;
  /** Texto plano: cada elemento es un párrafo. */
  parrafos: string[];
  boton?: { texto: string; url: string };
  /** Letra chica al final de la tarjeta («Si no esperabas este correo, ignóralo»). */
  pie?: string;
}

/** Tokens del sitio en hex. Claro = `:root`, oscuro = `.dark` de `src/index.css`. */
const C = {
  claro: { fondo: '#f5f9f7', tarjeta: '#ffffff', linea: '#dae2dd', tinta: '#14211d', apagado: '#586762', marca: '#007565', sobreMarca: '#f8fdfc', suave: '#dbf7f0' },
  oscuro: { fondo: '#0b1210', tarjeta: '#131c19', linea: '#2c3532', tinta: '#ebf0ee', apagado: '#9ba8a4', marca: '#4bc1ad', sobreMarca: '#051210', suave: '#07362f' },
};
const FUENTE = "Figtree, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escaparHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Sólo http(s) o una ruta relativa: un `javascript:` o `data:` en el enlace se vuelve `#`. */
const urlSegura = (url: string): string => (/^[a-z][a-z0-9+.-]*:/i.test(url.trim()) && !/^https?:/i.test(url.trim()) ? '#' : url.trim());

/** Una sola línea (sin saltos): el asunto y la vista previa no admiten los del texto. */
const unaLinea = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function plantillaCorreo(p: PlantillaCorreo): { html: string; texto: string } {
  const { claro: L, oscuro: D } = C;
  const titulo = escaparHtml(p.titulo);
  const previa = escaparHtml(unaLinea(p.parrafos[0] ?? p.titulo).slice(0, 140));
  const parrafos = p.parrafos.map((t) => `<p class="tx" style="margin:0 0 16px;font-size:16px;line-height:24px;color:${L.tinta};">${escaparHtml(t)}</p>`).join('');
  const url = p.boton ? escaparHtml(urlSegura(p.boton.url)) : '';
  const boton = p.boton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr><td class="bt" bgcolor="${L.marca}" style="background:${L.marca};border-radius:8px;"><a href="${url}" target="_blank" class="bt-a" style="display:inline-block;padding:13px 26px;font-family:${FUENTE};font-size:16px;line-height:20px;font-weight:600;color:${L.sobreMarca};text-decoration:none;border-radius:8px;">${escaparHtml(p.boton.texto)}</a></td></tr></table>`
      + `<p class="mu" style="margin:0 0 16px;font-size:13px;line-height:20px;color:${L.apagado};">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><a href="${url}" target="_blank" class="enl" style="color:${L.marca};word-break:break-all;">${url}</a></p>`
    : '';
  const pie = p.pie ? `<p class="mu" style="margin:0;padding-top:16px;border-top:1px solid ${L.linea};font-size:13px;line-height:20px;color:${L.apagado};">${escaparHtml(p.pie)}</p>` : '';

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${titulo}</title>
<style>
  @media only screen and (max-width:600px) { .caja { width:100% !important; } .tarjeta { padding:24px 20px !important; } .bt-a { display:block !important; text-align:center !important; } }
  @media (prefers-color-scheme: dark) {
    .fondo { background:${D.fondo} !important; }
    .tarjeta { background:${D.tarjeta} !important; border-color:${D.linea} !important; }
    .tx { color:${D.tinta} !important; }
    .mu { color:${D.apagado} !important; border-color:${D.linea} !important; }
    .logo { background:${D.marca} !important; color:${D.sobreMarca} !important; }
    .bt { background:${D.marca} !important; }
    .bt-a { color:${D.sobreMarca} !important; }
    .enl { color:${D.marca} !important; }
  }
</style>
</head>
<body class="fondo" style="margin:0;padding:0;background:${L.fondo};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px;color:${L.fondo};">${previa}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="fondo" style="background:${L.fondo};">
<tr><td align="center" style="padding:24px 12px;font-family:${FUENTE};">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" class="caja" style="width:560px;max-width:100%;">
    <tr><td style="padding:0 4px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="logo" width="32" height="32" align="center" valign="middle" bgcolor="${L.marca}" style="width:32px;height:32px;background:${L.marca};border-radius:8px;font-family:${FUENTE};font-size:18px;line-height:32px;font-weight:700;color:${L.sobreMarca};">H</td>
        <td class="tx" style="padding-left:10px;font-family:${FUENTE};font-size:20px;line-height:32px;font-weight:600;color:${L.tinta};">House</td>
      </tr></table>
    </td></tr>
    <tr><td class="tarjeta" style="padding:32px;background:${L.tarjeta};border:1px solid ${L.linea};border-radius:12px;font-family:${FUENTE};">
      <h1 class="tx" style="margin:0 0 16px;font-size:24px;line-height:32px;font-weight:600;color:${L.tinta};">${titulo}</h1>
      ${parrafos}${boton}${pie}
    </td></tr>
    <tr><td class="mu" style="padding:16px 4px 0;font-family:${FUENTE};font-size:12px;line-height:18px;color:${L.apagado};">House · Administración de condominios</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const texto = [p.titulo, ...p.parrafos, ...(p.boton ? [`${p.boton.texto}: ${p.boton.url}`] : []), ...(p.pie ? [p.pie] : [])].join('\n\n');
  return { html, texto };
}
