// Aplica la marca de la empresa a la página: variables CSS del tema (claro y oscuro), título de la pestaña y favicon. Todo es reversible: al cerrar sesión
// vuelve el verde de Torre.
import { cssDeMarca, esHexColor, type MarcaUsuario } from '../../lib/marca';

const ID_ESTILO = 'marca-empresa';
let tituloOriginal: string | null = null;
let iconoOriginal: { href: string; type: string | null } | null = null;

const iconoDeLaPagina = (): HTMLLinkElement | null => document.querySelector<HTMLLinkElement>('link[rel~="icon"]');

/** Pone la marca activa: color del tema, «<nombre> · con Torre» en la pestaña y el logo como favicon. */
export function aplicarMarca(marca: MarcaUsuario): void {
  let estilo = document.getElementById(ID_ESTILO) as HTMLStyleElement | null;
  if (marca.color && esHexColor(marca.color)) {
    if (!estilo) { estilo = document.createElement('style'); estilo.id = ID_ESTILO; document.head.appendChild(estilo); }
    estilo.textContent = cssDeMarca(marca.color).css;
  } else estilo?.remove();

  if (tituloOriginal === null) tituloOriginal = document.title;
  document.title = `${marca.nombre} · con Torre`;

  const icono = iconoDeLaPagina();
  if (icono && marca.logo_url) {
    if (!iconoOriginal) iconoOriginal = { href: icono.getAttribute('href') ?? '', type: icono.getAttribute('type') };
    icono.removeAttribute('type'); // el logo es JPG, PNG o WebP: el navegador lo reconoce por su contenido
    icono.setAttribute('href', marca.logo_url);
  } else restaurarIcono();
}

function restaurarIcono() {
  const icono = iconoDeLaPagina();
  if (icono && iconoOriginal) {
    icono.setAttribute('href', iconoOriginal.href);
    if (iconoOriginal.type) icono.setAttribute('type', iconoOriginal.type);
  }
  iconoOriginal = null;
}

/** Vuelve a Torre: sin hoja de estilos de marca, con el título y el ícono de siempre. */
export function quitarMarca(): void {
  document.getElementById(ID_ESTILO)?.remove();
  if (tituloOriginal !== null) { document.title = tituloOriginal; tituloOriginal = null; }
  restaurarIcono();
}
