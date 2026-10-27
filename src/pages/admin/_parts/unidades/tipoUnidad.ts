/** Tipos de unidad. El valor guardado es la clave en minúscula y sin tilde; la etiqueta es lo que ve la administradora. */
export const TIPOS_UNIDAD = [
  { value: 'departamento', label: 'Departamento' },
  { value: 'casa', label: 'Casa' },
  { value: 'local', label: 'Local' },
  { value: 'estacionamiento', label: 'Estacionamiento' },
  { value: 'deposito', label: 'Depósito' },
] as const;

/** Minúscula y sin tilde: «Depósito» → `deposito`. Las unidades viejas pueden venir así. */
export const normalizarTipoUnidad = (tipo: string) => tipo.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase();

/** Texto para mostrar. Un valor que no está en la lista se muestra tal cual. */
export const etiquetaTipoUnidad = (tipo: string) => TIPOS_UNIDAD.find(t => t.value === normalizarTipoUnidad(tipo))?.label ?? tipo;
