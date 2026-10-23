// Debe importarse PRIMERO en cada archivo de pruebas: fija el entorno antes de que se cargue la app.
const URL_PRUEBAS = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:house@localhost:5433/house_test';
if (!/house_test/.test(URL_PRUEBAS)) {
  throw new Error('Las pruebas sólo pueden correr contra una base llamada house_test (nunca contra la base de desarrollo).');
}
process.env.DATABASE_URL = URL_PRUEBAS;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'secreto-de-pruebas-que-supera-los-32-caracteres';
delete process.env.CORS_ORIGIN;
delete process.env.GEMINI_API_KEY;

export const JWT_SECRET_PRUEBAS = process.env.JWT_SECRET;
