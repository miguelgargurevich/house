/**
 * ¿Pantalla táctil (celular o tablet)? Sólo ahí `capture` abre la cámara; en una computadora el navegador lo ignora y abre el selector de
 * archivos, igual que el campo de arriba, así que el botón de la cámara no se muestra.
 */
export const esTactil = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

/** «Enviar pago» sólo con un voucher válido elegido y sin un envío en curso: el voucher es obligatorio. */
export const puedeEnviar = (archivo: File | null, enviando: boolean) => archivo !== null && !enviando;

export const FORM_PAGO = 'form-pago';
