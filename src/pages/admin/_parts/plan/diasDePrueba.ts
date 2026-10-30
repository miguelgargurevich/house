/** «te quedan 12 días» / «termina hoy»: los días que le faltan a una prueba de Pro. Sin React ni API: lo prueban las pruebas de Node. */
export const diasDePrueba = (n: number | null): string => {
  if (n == null || n <= 0) return 'termina hoy';
  return `te quedan ${n} ${n === 1 ? 'día' : 'días'}`;
};
