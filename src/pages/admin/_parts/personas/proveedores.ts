export const RUBROS = [
  { value: 'ascensores', label: 'Ascensores' },
  { value: 'gasfiteria', label: 'Gasfitería' },
  { value: 'electricidad', label: 'Electricidad' },
  { value: 'pintura', label: 'Pintura' },
  { value: 'jardineria', label: 'Jardinería' },
  { value: 'limpieza', label: 'Limpieza' },
  { value: 'seguridad', label: 'Seguridad' },
  { value: 'fumigacion', label: 'Fumigación' },
  { value: 'carpinteria', label: 'Carpintería' },
  { value: 'cerrajeria', label: 'Cerrajería' },
  { value: 'otros', label: 'Otros' },
] as const;

export type Rubro = (typeof RUBROS)[number]['value'];
export const rubroLabel = (r: string) => RUBROS.find(x => x.value === r)?.label ?? r;

export interface Proveedor {
  id: number;
  empresa_id: number;
  razon_social: string;
  ruc: string | null;
  rubro: Rubro;
  contacto_nombre: string | null;
  telefono: string | null;
  email: string | null;
  notas: string | null;
  activo: boolean;
  complejos: { id: number; nombre: string }[];
}
