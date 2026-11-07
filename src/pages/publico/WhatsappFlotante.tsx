/** @jsxRuntime automatic */
import { IconoWhatsapp } from '../../ui/IconoWhatsapp';

/**
 * Botón redondo de WhatsApp fijo abajo a la derecha de las páginas públicas (no dentro de la app con sesión). El enlace (`wa.me/<número>?text=…`) sale
 * de la configuración (`catalogo.redes.whatsapp.enlace`): sin número cargado no se pinta nada. 56 px con 16 px de margen: en 375 px no tapa el botón
 * principal de ninguna pantalla pública (el pie deja espacio debajo para que tampoco tape sus enlaces).
 */
export function WhatsappFlotante({ enlace }: { enlace: string }) {
  return (
    <a
      href={enlace}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Escríbenos por WhatsApp"
      title="Escríbenos por WhatsApp"
      className="fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_4px_14px_rgba(0,0,0,0.25)] transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#25D366]/50 active:scale-95 motion-reduce:transition-none sm:bottom-6 sm:right-6 print:hidden"
      style={{ bottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <IconoWhatsapp className="h-8 w-8" />
    </a>
  );
}
