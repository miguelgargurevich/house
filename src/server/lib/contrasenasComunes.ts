/** Contraseñas demasiado previsibles (se comparan en minúsculas). Lista corta a propósito: lo habitual que prueba un atacante primero. */
const COMUNES = new Set([
  '12345678', '123456789', '1234567890', '11111111', '00000000', '87654321', '12341234',
  'password', 'password1', 'password123', 'passw0rd', 'contraseña', 'contraseña1', 'contraseña123', 'contrasena', 'contrasena123',
  'qwerty123', 'qwertyuiop', 'abcd1234', 'abc12345', 'iloveyou', 'letmein1',
  'admin123', 'admin1234', 'administrador', 'house123', 'house1234', 'condominio', 'condominio123', 'bienvenido', 'bienvenido1', 'prueba123', 'test1234',
]);

export const esContrasenaComun = (p: string): boolean => COMUNES.has(p.toLowerCase());
