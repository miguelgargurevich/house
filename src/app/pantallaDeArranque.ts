/**
 * Quita la pantalla de arranque de la app de iOS/Android (index.html, #arranque-app; public/arranque-app.js) cuando la app ya pintó su
 * primera pantalla. Lo llama App al montar. Dentro del navegador no hay nada que quitar (el script ya retiró el marcado). Idempotente.
 */
type PantallaDeArranque = { quitar: () => void };

export function quitarPantallaDeArranque(): void {
  const pantalla = (window as Window & { torreArranque?: PantallaDeArranque }).torreArranque;
  pantalla?.quitar();
}
