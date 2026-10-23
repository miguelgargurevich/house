export interface Clave {
  id: number;
  proveedor: string;
  etiqueta: string;
  ultimos4: string;
  modelo: string | null;
  habilitada: boolean;
  estado: 'sin_probar' | 'ok' | 'error';
  estado_detalle: string | null;
  probada_at: string | null;
  ultimo_uso_at: string | null;
}

export interface Proveedor {
  id: string;
  nombre: string;
  descripcion: string;
  urlParaConseguirKey: string;
  modeloPorDefecto: string;
}

export interface DatosLlavero {
  configurado: boolean;
  claves: Clave[];
  proveedores: Proveedor[];
}
