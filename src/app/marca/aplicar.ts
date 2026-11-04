// Aplica la marca de la empresa a la página: variables CSS del tema (claro y oscuro), título de la pestaña y favicon. Todo es reversible: al cerrar sesión
// vuelve el verde de Torre.
import { cssDeMarca, esHexColor, type MarcaUsuario } from '../../lib/marca';

const ID_ESTILO = 'marca-empresa';
let tituloOriginal: string | null = null;
let iconosOriginales: { el: HTMLLinkElement; href: string; type: string | null }[] | null = null;

/** Todos los íconos de la pestaña (SVG y PNG de 16 y 32): si se cambia sólo uno, el navegador puede quedarse con otro de Torre. */
const iconosDeLaPagina = (): HTMLLinkElement[] => [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];

/** Pone la marca activa: color del tema, «<nombre> · con Torre» en la pestaña y el logo como favicon. */
export function aplicarMarca(marca: MarcaUsuario): void {
  let estilo = document.getElementById(ID_ESTILO) as HTMLStyleElement | null;
  if (marca.color && esHexColor(marca.color)) {
    if (!estilo) { estilo = document.createElement('style'); estilo.id = ID_ESTILO; document.head.appendChild(estilo); }
    estilo.textContent = cssDeMarca(marca.color).css;
  } else estilo?.remove();

  if (tituloOriginal === null) tituloOriginal = document.title;
  document.title = `${marca.nombre} · con Torre`;

  const iconos = iconosDeLaPagina();
  if (iconos.length && marca.logo_url) {
    if (!iconosOriginales) iconosOriginales = iconos.map((el) => ({ el, href: el.getAttribute('href') ?? '', type: el.getAttribute('type') }));
    for (const el of iconos) {
      el.removeAttribute('type'); // el logo es JPG, PNG o WebP: el navegador lo reconoce por su contenido
      el.setAttribute('href', marca.logo_url);
    }
  } else restaurarIcono();
}

function restaurarIcono() {
  for (const o of iconosOriginales ?? []) {
    o.el.setAttribute('href', o.href);
    if (o.type) o.el.setAttribute('type', o.type);
  }
  iconosOriginales = null;
}

/** Vuelve a Torre: sin hoja de estilos de marca, con el título y el ícono de siempre. */
export function quitarMarca(): void {
  document.getElementById(ID_ESTILO)?.remove();
  if (tituloOriginal !== null) { document.title = tituloOriginal; tituloOriginal = null; }
  restaurarIcono();
}
