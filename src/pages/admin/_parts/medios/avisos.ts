/**
 * Avisos del formulario de medios de pago (lógica pura, sin React ni red). NUNCA bloquean el guardado: el servidor sólo exige
 * 6 a 25 caracteres de cuenta y 20 dígitos de CCI; el largo habitual por banco y el código del banco en el CCI sólo avisan.
 * Los datos de cada entidad vienen del catálogo del servidor (`GET /api/medios-pago/catalogo`), la única fuente.
 */
export interface ReglasEntidad {
  nombre: string;
  /** Largo habitual (en dígitos) del número de cuenta; `null` = sin aviso. */
  largo_ahorros: number | null;
  largo_corriente: number | null;
  /** Los 3 primeros dígitos del CCI de la entidad; `null` = sin aviso. */
  codigo_cci: string | null;
}

const soloDigitos = (s: string) => s.replace(/\D/g, '');

/** «BCP suele usar 14 dígitos en cuentas de ahorros: revisa el número.» `null` si coincide, si falta el número o si la entidad no tiene un largo conocido. */
export function avisoLargoCuenta(entidad: ReglasEntidad | null | undefined, tipoCuenta: string, numero: string): string | null {
  if (!entidad) return null;
  const digitos = soloDigitos(numero).length;
  if (digitos === 0) return null;
  const ahorros = tipoCuenta !== 'corriente';
  const esperado = ahorros ? entidad.largo_ahorros : entidad.largo_corriente;
  if (esperado == null || digitos === esperado) return null;
  const igual = entidad.largo_ahorros === entidad.largo_corriente;
  const donde = igual ? '' : ahorros ? ' en cuentas de ahorros' : ' en cuentas corrientes';
  return `${entidad.nombre} suele usar ${esperado} dígitos${donde}: revisa el número (escribiste ${digitos}).`;
}

/**
 * Aviso si el CCI no empieza con el código del banco elegido. Sólo se evalúa con un CCI completo (20 dígitos): el largo ya lo valida el formulario.
 * `entidades` (opcional) permite decir a qué otro banco corresponde el código que se escribió.
 */
export function avisoCci(entidad: ReglasEntidad | null | undefined, cci: string, entidades: readonly ReglasEntidad[] = []): string | null {
  if (!entidad?.codigo_cci) return null;
  const d = soloDigitos(cci);
  if (d.length !== 20 || d.startsWith(entidad.codigo_cci)) return null;
  const otra = entidades.find(x => x.codigo_cci === d.slice(0, 3));
  return `Este CCI empieza con ${d.slice(0, 3)}${otra ? ` (${otra.nombre})` : ''} y el código de ${entidad.nombre} es ${entidad.codigo_cci}: revisa que sea de esa cuenta.`;
}
