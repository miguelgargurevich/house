// Direcciones y decisión de dónde puede haber una demo (sin React ni `api`, para probarlas con `node:test`).

/** Las demos viven en `demo.<dominio>`; en local (desarrollo) también se puede probar. */
export const puedeSerDemo = (host: string): boolean => /^demo\./i.test(host) || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';

export const URL_TORRE = 'https://torrecondominios.com';
export const URL_DEMO = 'https://demo.torrecondominios.com';
