// Redes y WhatsApp de contacto de Torre: todo sale de `ConfiguracionComercial` (Superadmin › Precios). Ningún número ni dirección vive en el código.
import type { ConfiguracionComercial } from '@prisma/client';

export interface RedesPublicas {
  instagram: string | null;
  facebook: string | null;
  /** null = sin número cargado: no se muestra ningún botón ni enlace de WhatsApp. */
  whatsapp: { numero: string; enlace: string } | null;
}

/** `https://wa.me/<número>?text=<mensaje codificado>`; sin mensaje, sin `?text`. */
export function enlaceWhatsapp(numero: string, mensaje: string | null | undefined): string {
  const texto = (mensaje ?? '').trim();
  return `https://wa.me/${numero}${texto ? `?text=${encodeURIComponent(texto)}` : ''}`;
}

export function redesPublicas(cfg: Pick<ConfiguracionComercial, 'url_instagram' | 'url_facebook' | 'whatsapp_contacto' | 'whatsapp_mensaje'>): RedesPublicas {
  const numero = (cfg.whatsapp_contacto ?? '').replace(/\D/g, '');
  return {
    instagram: cfg.url_instagram?.trim() || null,
    facebook: cfg.url_facebook?.trim() || null,
    whatsapp: numero ? { numero, enlace: enlaceWhatsapp(numero, cfg.whatsapp_mensaje) } : null,
  };
}
