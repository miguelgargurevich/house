// Correo HTML con la cara del sitio. Se arma con TABLAS y estilos en línea (Gmail y Outlook ignoran casi todo lo demás) y los colores son los
// tokens de `src/index.css` convertidos a hex (el correo no entiende oklch). El logo es el ícono de Torre (imagen con URL absoluta) sobre una celda
// del color de marca: si el cliente bloquea las imágenes, queda el cuadro de color y el texto «Torre» al lado; un SVG no se ve en Gmail.
// Todo texto que llega de fuera (nombre, empresa, concepto, comunicado…) se escapa aquí; quien llama pasa texto plano, nunca HTML.
import type { MarcaCorreo } from '../marca/tipos';
import { ENLACE_APP } from './plantillas';

export interface FilaResumen {
  etiqueta: string;
  valor: string;
  /** Pinta el valor en rojo (vencido, rechazado). */
  alerta?: boolean;
}

export interface PlantillaCorreo {
  titulo: string;
  /** Texto plano: cada elemento es un párrafo. */
  parrafos: string[];
  /** Nombre del condominio: va bajo el logo, en la cabecera. */
  condominio?: string | null;
  /** Tarjeta con lo importante: una cifra grande (el total) y las filas de datos (departamento, vencimiento…). */
  resumen?: { total?: { etiqueta: string; valor: string; alerta?: boolean }; filas?: FilaResumen[] };
  /** Tabla de conceptos con su monto, completa (nunca se corta con «…»). `total` cierra la tabla. */
  tabla?: { titulo: string; filas: { concepto: string; monto: string }[]; total?: { concepto: string; monto: string } };
  boton?: { texto: string; url: string };
  /** Letra chica al final de la tarjeta («Si no esperabas este correo, ignóralo»). */
  pie?: string;
  /** Líneas del pie del correo, fuera de la tarjeta: quién escribe, por qué lo recibes y cómo dejar de recibirlo. */
  piePagina?: string[];
  /** Texto que algunos clientes muestran junto al asunto; sin él, el primer párrafo. */
  previa?: string;
  /**
   * Marca de la empresa administradora (sólo con la capacidad `marca_propia` activa): la cabecera lleva su logo y nombre, una franja y los acentos van en su color, y el
   * pie dice «Enviado con Torre». Sin ella (o `null`) el correo sale con la cara de Torre, como siempre.
   */
  marca?: MarcaCorreo | null;
}

/** Línea de pie de Torre: con la marca de una empresa se reemplaza por «Enviado con Torre». */
export const PIE_TORRE = 'Torre · Administración de condominios';
export const PIE_ENVIADO_CON_TORRE = 'Enviado con Torre';

/** Tokens del sitio en hex. Claro = `:root`, oscuro = `.dark` de `src/index.css`. `panel` es el fondo de la tarjeta de datos; `alerta`, el rojo `bad`. */
const C = {
  claro: { fondo: '#f5f9f7', tarjeta: '#ffffff', linea: '#dae2dd', tinta: '#14211d', apagado: '#586762', marca: '#007565', sobreMarca: '#f8fdfc', suave: '#dbf7f0', panel: '#eff7f4', alerta: '#b3261e' },
  oscuro: { fondo: '#0b1210', tarjeta: '#131c19', linea: '#2c3532', tinta: '#ebf0ee', apagado: '#9ba8a4', marca: '#4bc1ad', sobreMarca: '#051210', suave: '#07362f', panel: '#1a2723', alerta: '#f28b82' },
};
const FUENTE = "Figtree, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
/** Ancho del correo: 600 px es lo que cabe sin zoom en Outlook de escritorio; en el celular ocupa todo el ancho. */
const ANCHO = 600;
/** Ícono de Torre en el servidor: URL absoluta, porque un correo no puede traer rutas relativas. */
export const LOGO_URL = `${ENLACE_APP}/icon-192.png`;

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escaparHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Texto plano multilínea → HTML seguro: se escapa y los saltos de línea pasan a `<br>`. */
const conSaltos = (s: string): string => escaparHtml(s).replace(/\r?\n/g, '<br>');

/** Sólo http(s) o una ruta relativa: un `javascript:` o `data:` en el enlace se vuelve `#`. */
const urlSegura = (url: string): string => (/^[a-z][a-z0-9+.-]*:/i.test(url.trim()) && !/^https?:/i.test(url.trim()) ? '#' : url.trim());

/** Una sola línea (sin saltos): el asunto y la vista previa no admiten los del texto. */
const unaLinea = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Primera letra del nombre (sin signos), en mayúscula: queda en el cuadrito de color cuando la empresa no subió logo. */
const inicialDe = (nombre: string): string => (/[\p{L}\p{N}]/u.exec(nombre.trim())?.[0] ?? 'T').toUpperCase();

export function plantillaCorreo(p: PlantillaCorreo): { html: string; texto: string } {
  // Con marca, los acentos (botón, cifra, enlaces, cuadro del logo) toman el color de la empresa; si activó la marca sin elegir color, quedan en el verde de Torre.
  const m = p.marca ?? null;
  const L = m?.claro ? { ...C.claro, marca: m.claro.brand, sobreMarca: m.claro.onBrand, suave: m.claro.brandSoft } : C.claro;
  const D = m?.oscuro ? { ...C.oscuro, marca: m.oscuro.brand, sobreMarca: m.oscuro.onBrand, suave: m.oscuro.brandSoft } : C.oscuro;
  const titulo = escaparHtml(p.titulo);
  const previa = escaparHtml(unaLinea(p.previa ?? p.parrafos[0] ?? p.titulo).slice(0, 140));
  const parrafos = p.parrafos.map((t) => `<p class="tx" style="margin:0 0 16px;font-size:16px;line-height:24px;color:${L.tinta};">${conSaltos(t)}</p>`).join('');

  // Tarjeta de datos: la cifra grande y, debajo, una fila por dato (etiqueta apagada a la izquierda, valor a la derecha).
  const total = p.resumen?.total;
  const filas = p.resumen?.filas ?? [];
  const resumen = total || filas.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="pn" bgcolor="${L.panel}" style="margin:4px 0 20px;background:${L.panel};border-radius:10px;"><tr><td style="padding:20px;">`
      + (total ? `<p class="mu" style="margin:0 0 2px;font-size:14px;line-height:20px;color:${L.apagado};">${escaparHtml(total.etiqueta)}</p><p class="${total.alerta ? 'al' : 'tt'}" style="margin:0 0 ${filas.length ? 16 : 0}px;font-size:34px;line-height:40px;font-weight:700;color:${total.alerta ? L.alerta : L.marca};">${escaparHtml(total.valor)}</p>` : '')
      + (filas.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${filas.map((f, i) => `<tr><td class="mu ln" valign="top" style="width:38%;padding:8px 12px 8px 0;${i === 0 && !total ? '' : `border-top:1px solid ${L.linea};`}font-size:14px;line-height:20px;color:${L.apagado};">${escaparHtml(f.etiqueta)}</td><td class="${f.alerta ? 'al' : 'tx'} ln" valign="top" style="padding:8px 0;${i === 0 && !total ? '' : `border-top:1px solid ${L.linea};`}font-size:15px;line-height:20px;font-weight:600;color:${f.alerta ? L.alerta : L.tinta};">${escaparHtml(f.valor)}</td></tr>`).join('')}</table>`
        : '')
      + '</td></tr></table>'
    : '';

  // Tabla de conceptos: nombre a la izquierda (se parte en líneas si es largo, nunca se corta) y monto a la derecha.
  const t = p.tabla;
  const celdaConcepto = (texto: string, negrita: boolean, borde: boolean) => `<td class="tx ln" valign="top" style="padding:10px 12px 10px 0;${borde ? `border-top:1px solid ${L.linea};` : ''}font-size:14px;line-height:20px;${negrita ? 'font-weight:700;' : ''}color:${L.tinta};">${escaparHtml(texto)}</td>`;
  const celdaMonto = (texto: string, negrita: boolean, borde: boolean) => `<td class="tx ln" valign="top" align="right" style="padding:10px 0;${borde ? `border-top:1px solid ${L.linea};` : ''}font-size:14px;line-height:20px;white-space:nowrap;${negrita ? 'font-weight:700;' : ''}color:${L.tinta};">${escaparHtml(texto)}</td>`;
  const tabla = t
    ? `<p class="tx" style="margin:0 0 4px;font-size:16px;line-height:24px;font-weight:600;color:${L.tinta};">${escaparHtml(t.titulo)}</p>`
      + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">`
      + `<tr><td class="mu ln" style="padding:6px 12px 6px 0;border-bottom:1px solid ${L.linea};font-size:12px;line-height:16px;color:${L.apagado};">Concepto</td><td class="mu ln" align="right" style="padding:6px 0;border-bottom:1px solid ${L.linea};font-size:12px;line-height:16px;color:${L.apagado};">Monto</td></tr>`
      + t.filas.map((f, i) => `<tr>${celdaConcepto(f.concepto, false, i > 0)}${celdaMonto(f.monto, false, i > 0)}</tr>`).join('')
      + (t.total ? `<tr>${celdaConcepto(t.total.concepto, true, true)}${celdaMonto(t.total.monto, true, true)}</tr>` : '')
      + '</table>'
    : '';

  const url = p.boton ? escaparHtml(urlSegura(p.boton.url)) : '';
  const boton = p.boton
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;"><tr><td class="bt" bgcolor="${L.marca}" style="background:${L.marca};border-radius:8px;"><a href="${url}" target="_blank" class="bt-a" style="display:inline-block;padding:14px 28px;font-family:${FUENTE};font-size:16px;line-height:20px;font-weight:600;color:${L.sobreMarca};text-decoration:none;border-radius:8px;">${escaparHtml(p.boton.texto)}</a></td></tr></table>`
      + `<p class="mu" style="margin:0 0 16px;font-size:13px;line-height:20px;color:${L.apagado};">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><a href="${url}" target="_blank" class="enl" style="color:${L.marca};word-break:break-all;">${url}</a></p>`
    : '';
  const pie = p.pie ? `<p class="mu ln" style="margin:0;padding-top:16px;border-top:1px solid ${L.linea};font-size:13px;line-height:20px;color:${L.apagado};">${escaparHtml(p.pie)}</p>` : '';

  const condominio = p.condominio?.trim() ? `<p class="mu" style="margin:8px 0 0;font-family:${FUENTE};font-size:14px;line-height:20px;color:${L.apagado};">${escaparHtml(p.condominio.trim())}</p>` : '';
  const lineasPie = m ? [...(p.piePagina ?? []).filter((l) => l !== PIE_TORRE), PIE_ENVIADO_CON_TORRE] : p.piePagina?.length ? p.piePagina : [PIE_TORRE];
  const piePagina = lineasPie
    .map((l, i) => `<p class="mu" style="margin:${i ? 6 : 0}px 0 0;font-size:12px;line-height:18px;color:${L.apagado};">${escaparHtml(l)}</p>`).join('');

  // Cabecera: la de Torre (ícono y palabra) o la de la empresa (su logo, o su inicial en un cuadro de color, y su nombre; con las imágenes bloqueadas queda el nombre).
  const cabecera = m
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`
      + (m.logoUrl
        ? `<td valign="middle" style="padding-right:12px;"><img src="${escaparHtml(m.logoUrl)}" height="40" alt="" style="display:block;height:40px;max-width:160px;width:auto;border:0;border-radius:6px;"></td>`
        : `<td class="logo" width="40" height="40" align="center" valign="middle" bgcolor="${L.marca}" style="width:40px;height:40px;background:${L.marca};border-radius:8px;font-family:${FUENTE};font-size:20px;line-height:40px;font-weight:700;color:${L.sobreMarca};">${escaparHtml(inicialDe(m.nombre))}</td><td width="12" style="width:12px;">&nbsp;</td>`)
      + `<td class="tx" valign="middle" style="font-family:${FUENTE};font-size:20px;line-height:26px;font-weight:600;color:${L.tinta};">${escaparHtml(m.nombre)}</td></tr></table>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td class="logo" width="32" height="32" bgcolor="${L.marca}" style="width:32px;height:32px;background:${L.marca};border-radius:8px;"><img src="${LOGO_URL}" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border:0;border-radius:8px;"></td>
        <td class="tx" style="padding-left:10px;font-family:${FUENTE};font-size:20px;line-height:32px;font-weight:600;color:${L.tinta};">Torre</td>
      </tr></table>`;
  // Franja del color de la marca entre la cabecera y la tarjeta.
  const franja = m ? `\n    <tr><td class="franja" height="6" bgcolor="${L.marca}" style="height:6px;line-height:6px;font-size:0;background:${L.marca};border-radius:12px 12px 0 0;">&nbsp;</td></tr>` : '';

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
    .pn { background:${D.panel} !important; }
    .tx { color:${D.tinta} !important; }
    .mu { color:${D.apagado} !important; border-color:${D.linea} !important; }
    .ln { border-color:${D.linea} !important; }
    .tt { color:${D.marca} !important; }
    .al { color:${D.alerta} !important; }
    .logo { background:${D.marca} !important; }
    .franja { background:${D.marca} !important; }
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
  <table role="presentation" width="${ANCHO}" cellpadding="0" cellspacing="0" border="0" class="caja" style="width:${ANCHO}px;max-width:100%;">
    <tr><td style="padding:0 4px 16px;">
      ${cabecera}${condominio}
    </td></tr>${franja}
    <tr><td class="tarjeta" style="padding:32px;background:${L.tarjeta};border:1px solid ${L.linea};${m ? 'border-top:0;border-radius:0 0 12px 12px;' : 'border-radius:12px;'}font-family:${FUENTE};">
      <h1 class="tx" style="margin:0 0 16px;font-size:24px;line-height:32px;font-weight:600;color:${L.tinta};">${titulo}</h1>
      ${parrafos}${resumen}${tabla}${boton}${pie}
    </td></tr>
    <tr><td style="padding:16px 4px 0;font-family:${FUENTE};">${piePagina}</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  const textoResumen = [
    ...(total ? [`${total.etiqueta}: ${total.valor}`] : []),
    ...filas.map((f) => `${f.etiqueta}: ${f.valor}`),
  ].join('\n');
  const textoTabla = t ? [t.titulo, ...t.filas.map((f) => `- ${f.concepto}: ${f.monto}`), ...(t.total ? [`${t.total.concepto}: ${t.total.monto}`] : [])].join('\n') : '';
  const texto = [p.titulo, ...p.parrafos, ...(textoResumen ? [textoResumen] : []), ...(textoTabla ? [textoTabla] : []), ...(p.boton ? [`${p.boton.texto}: ${p.boton.url}`] : []), ...(p.pie ? [p.pie] : [])].join('\n\n');
  return { html, texto };
}
