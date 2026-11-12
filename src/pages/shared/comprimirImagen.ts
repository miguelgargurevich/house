// Achica en el navegador las fotos que pasan del tope (una foto de cámara de iPhone pesa 2,5–6 MB y el servidor acepta 2 MB).
// Sin variables de entorno ni `api.ts`: la parte pura se prueba en Node (tests/comprimir-imagen.test.ts).
// El servidor no cambia: recibe siempre el archivo ya achicado, y si el navegador no puede achicarlo, el original (y la validación dice por qué).

export const LADO_VOUCHER = 2000;
/** Pasos para bajar el lado cuando la calidad no basta; el último es el mínimo general (1280). El QR baja hasta 1000. */
const LADOS_BAJADA = [1600, 1280, 1000];
const LADO_MIN_GENERAL = 1280;
const CALIDADES = [0.85, 0.75, 0.65, 0.55];
const CALIDAD_BAJADA = 0.55;

export type Formato = 'image/jpeg' | 'image/png';
export type Codificador = (fuente: unknown, ancho: number, alto: number, formato: Formato, calidad: number) => Promise<Blob | null>;

export interface OpcionesCompresion {
  /** Tamaño máximo del resultado en bytes. */
  tope: number;
  /** Lado mayor de partida (2000 para vouchers). */
  ladoMax?: number;
  /** No bajar de este lado mayor (QR: 1000). */
  ladoMin?: number;
  /** JPEG por defecto; PNG para logos y QR con transparencia (la calidad no aplica y sólo se baja el lado). */
  formato?: Formato;
  /** Codificador (canvas → Blob); se inyecta en las pruebas. */
  codificar?: Codificador;
}

const HEIC = ['image/heic', 'image/heif'];
const COMPRIMIBLES = ['image/jpeg', 'image/png', 'image/webp'];

/** Escala proporcional para que el lado mayor quepa en `ladoMax`. Nunca agranda. */
export function medidasDestino(ancho: number, alto: number, ladoMax: number): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto);
  if (mayor <= ladoMax) return { ancho, alto };
  const f = ladoMax / mayor;
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)) };
}

/** ¿Hay que intentar achicarlo? PDF nunca; HEIC/HEIF siempre (el servidor no los acepta); JPG/PNG/WebP sólo si pasan el tope. */
export function necesitaComprimir(file: Pick<File, 'type' | 'size'>, tope: number): boolean {
  if (HEIC.includes(file.type)) return true;
  if (!COMPRIMIBLES.includes(file.type)) return false;
  return file.size > tope;
}

/** Pasos (lado, calidad) en orden: primero bajar la calidad al lado de partida; luego bajar el lado. */
export function pasos(ladoOriginal: number, ladoMax: number, ladoMin: number, formato: Formato): Array<{ lado: number; calidad: number }> {
  const inicio = Math.min(ladoMax, ladoOriginal);
  const calidades = formato === 'image/png' ? [1] : CALIDADES;
  const lista = calidades.map(calidad => ({ lado: inicio, calidad }));
  for (const lado of LADOS_BAJADA) {
    if (lado < inicio && lado >= ladoMin) lista.push({ lado, calidad: formato === 'image/png' ? 1 : CALIDAD_BAJADA });
  }
  return lista;
}

/** El bucle de calidad y lado: devuelve la primera codificación que entra en el tope, o `null` si ninguna entra. */
export async function achicarHasta(
  fuente: unknown,
  original: { ancho: number; alto: number },
  opciones: OpcionesCompresion & { codificar: Codificador },
): Promise<{ blob: Blob; ancho: number; alto: number } | null> {
  const formato = opciones.formato ?? 'image/jpeg';
  const ladoMax = opciones.ladoMax ?? LADO_VOUCHER;
  const ladoMin = opciones.ladoMin ?? LADO_MIN_GENERAL;
  const ladoOriginal = Math.max(original.ancho, original.alto);
  for (const { lado, calidad } of pasos(ladoOriginal, ladoMax, ladoMin, formato)) {
    const { ancho, alto } = medidasDestino(original.ancho, original.alto, lado);
    const blob = await opciones.codificar(fuente, ancho, alto, formato, calidad);
    if (blob && blob.size <= opciones.tope) return { blob, ancho, alto };
  }
  return null;
}

/** Nombre con extensión acorde al formato: «voucher.heic» → «voucher.jpg». */
function nombreNuevo(nombre: string, formato: Formato): string {
  const base = nombre.replace(/\.[^./\\]+$/, '') || 'imagen';
  return `${base}${formato === 'image/png' ? '.png' : '.jpg'}`;
}

interface Decodificada { ancho: number; alto: number; fuente: unknown; liberar: () => void }

/** Decodifica con `createImageBitmap` (respeta la orientación de la foto); si no puede, con un <img>. */
async function decodificar(archivo: Blob): Promise<Decodificada> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(archivo, { imageOrientation: 'from-image' });
      return { ancho: bmp.width, alto: bmp.height, fuente: bmp, liberar: () => bmp.close() };
    } catch {
      // Sigue con el <img>.
    }
  }
  const url = URL.createObjectURL(archivo);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { ancho: img.naturalWidth, alto: img.naturalHeight, fuente: img, liberar: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/** Codifica con un canvas reducido. El JPEG no tiene transparencia: se pinta fondo blanco antes (si no, lo transparente sale negro). */
const codificarEnCanvas: Codificador = (fuente, ancho, alto, formato, calidad) => {
  if (typeof document === 'undefined') return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = ancho;
  canvas.height = alto;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  if (formato === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ancho, alto);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fuente as CanvasImageSource, 0, 0, ancho, alto);
  return new Promise<Blob | null>(resolver => {
    canvas.toBlob(b => {
      // Libera la memoria del canvas (en iPhone el límite es estricto).
      canvas.width = 0;
      canvas.height = 0;
      resolver(b);
    }, formato, calidad);
  });
};

/**
 * Devuelve un archivo que cabe en el tope: el mismo si ya cabía, uno nuevo `image/jpeg` (o `image/png`, si el original era PNG y se pide) si se pudo achicar.
 * Si el navegador no puede decodificarlo (p. ej. HEIC en Chrome de escritorio) o no logra bajar del tope, devuelve el original: la validación de siempre dice qué pasa.
 */
export async function comprimirImagen(archivo: File, opciones: OpcionesCompresion): Promise<File> {
  if (!necesitaComprimir(archivo, opciones.tope)) return archivo;
  const formato: Formato = opciones.formato ?? 'image/jpeg';
  let decodificada: Decodificada;
  try {
    decodificada = await decodificar(archivo);
  } catch {
    return archivo;
  }
  try {
    const salida = await achicarHasta(decodificada.fuente, { ancho: decodificada.ancho, alto: decodificada.alto }, {
      ...opciones,
      formato,
      codificar: opciones.codificar ?? codificarEnCanvas,
    });
    if (!salida) return archivo;
    return new File([salida.blob], nombreNuevo(archivo.name, formato), { type: formato, lastModified: Date.now() });
  } catch {
    return archivo;
  } finally {
    decodificada.liberar();
  }
}
