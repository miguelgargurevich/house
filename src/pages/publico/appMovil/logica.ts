// Decisiones de /app que no son texto: qué bloques pintar. Sin React, para probarlas con `node:test`.
import { dentroDeLaApp } from '../../../app/instalar';

export interface AndroidPublico { url: string; version: string | null }

/** ¿Se ofrece el botón de descarga del APK? Sólo si la configuración trae el APK y la página no corre dentro de la app de Torre (ya está instalada). */
export function ofreceDescarga(android: AndroidPublico | null | undefined, userAgent: string): boolean {
  return !!android && !dentroDeLaApp(userAgent);
}

/** Dentro de la app no hay bloques de descarga ni de instalación: sólo el texto «Ya estás usando la app». */
export function muestraBloques(userAgent: string): boolean {
  return !dentroDeLaApp(userAgent);
}
