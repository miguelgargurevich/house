// La compresión de fotos en el navegador (src/pages/shared/comprimirImagen.ts): la parte pura y el bucle de calidad/lado
// con un codificador falso. En Node no hay canvas: la decodificación se simula con `createImageBitmap` sólo donde hace falta.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  achicarHasta,
  comprimirImagen,
  medidasDestino,
  necesitaComprimir,
  pasos,
} from '../src/pages/shared/comprimirImagen';
import type { Codificador } from '../src/pages/shared/comprimirImagen';

const MB = 1024 * 1024;
const KB = 1024;

/** Codificador falso: el tamaño sale de las medidas y la calidad (`ancho·alto·calidad / 1000` bytes). Anota cada llamada. */
function falso(llamadas: Array<{ ancho: number; alto: number; formato: string; calidad: number }> = []): Codificador {
  return async (_fuente, ancho, alto, formato, calidad) => {
    llamadas.push({ ancho, alto, formato, calidad });
    return new Blob([new Uint8Array(Math.round((ancho * alto * calidad) / 1000))]);
  };
}

/** Simula la decodificación del navegador (el archivo no importa: lo que se usa son las medidas). */
async function conDecodificador<T>(ancho: number, alto: number, fn: () => Promise<T>): Promise<T> {
  const g = globalThis as { createImageBitmap?: unknown };
  const previo = g.createImageBitmap;
  g.createImageBitmap = async () => ({ width: ancho, height: alto, close() {} });
  try {
    return await fn();
  } finally {
    if (previo === undefined) delete g.createImageBitmap;
    else g.createImageBitmap = previo;
  }
}

describe('medidasDestino: escala proporcional, nunca agranda', () => {
  it('una foto horizontal de 4000×3000 baja a 2000×1500 (misma proporción)', () => {
    assert.deepEqual(medidasDestino(4000, 3000, 2000), { ancho: 2000, alto: 1500 });
  });

  it('una foto vertical (como la toma el iPhone con el celular de pie) baja a 1500×2000', () => {
    assert.deepEqual(medidasDestino(3000, 4000, 2000), { ancho: 1500, alto: 2000 });
  });

  it('nunca agranda: 800×600 con lado 2000 queda igual', () => {
    assert.deepEqual(medidasDestino(800, 600, 2000), { ancho: 800, alto: 600 });
  });

  it('una foto justo en el límite no se toca', () => {
    assert.deepEqual(medidasDestino(2000, 1000, 2000), { ancho: 2000, alto: 1000 });
  });

  it('no baja de 1 px aunque la proporción sea extrema', () => {
    const m = medidasDestino(10000, 3, 1000);
    assert.equal(m.ancho, 1000);
    assert.equal(m.alto, 1);
  });
});

describe('necesitaComprimir: qué archivos se achican', () => {
  it('un PDF NUNCA se toca, aunque pese más del tope', () => {
    assert.equal(necesitaComprimir({ type: 'application/pdf', size: 5 * MB }, 2 * MB), false);
  });

  it('un JPEG que cabe en el tope no se achica; uno que lo pasa, sí', () => {
    assert.equal(necesitaComprimir({ type: 'image/jpeg', size: 1 * MB }, 2 * MB), false);
    assert.equal(necesitaComprimir({ type: 'image/jpeg', size: 3 * MB }, 2 * MB), true);
  });

  it('un PNG o WebP sólo se achica si pasa el tope', () => {
    assert.equal(necesitaComprimir({ type: 'image/png', size: 300 * KB }, 500 * KB), false);
    assert.equal(necesitaComprimir({ type: 'image/png', size: 600 * KB }, 500 * KB), true);
    assert.equal(necesitaComprimir({ type: 'image/webp', size: 3 * MB }, 2 * MB), true);
  });

  it('HEIC y HEIF se achican SIEMPRE (el servidor no los acepta), aunque pesen poco', () => {
    assert.equal(necesitaComprimir({ type: 'image/heic', size: 1 * KB }, 2 * MB), true);
    assert.equal(necesitaComprimir({ type: 'image/heif', size: 1 * KB }, 2 * MB), true);
  });

  it('un tipo que no es imagen ni PDF conocido no se toca', () => {
    assert.equal(necesitaComprimir({ type: 'text/plain', size: 5 * MB }, 2 * MB), false);
  });
});

describe('pasos: primero la calidad, luego el lado', () => {
  it('voucher: calidades 0,85 → 0,75 → 0,65 → 0,55 al lado 2000, y luego 1600 y 1280', () => {
    const lista = pasos(4000, 2000, 1280, 'image/jpeg');
    assert.deepEqual(lista.map(p => p.calidad), [0.85, 0.75, 0.65, 0.55, 0.55, 0.55]);
    assert.deepEqual(lista.map(p => p.lado), [2000, 2000, 2000, 2000, 1600, 1280]);
  });

  it('no baja de 1280 en general: el 1000 sólo aparece si el mínimo lo permite (QR)', () => {
    const general = pasos(4000, 2000, 1280, 'image/jpeg');
    assert.ok(general.every(p => p.lado >= 1280));
    const qr = pasos(4000, 2000, 1000, 'image/png');
    assert.equal(qr[qr.length - 1]!.lado, 1000);
    assert.ok(qr.every(p => p.lado >= 1000));
  });

  it('PNG no tiene calidad: sólo se baja el lado (calidad 1)', () => {
    const lista = pasos(4000, 2000, 1000, 'image/png');
    assert.ok(lista.every(p => p.calidad === 1));
    assert.deepEqual(lista.map(p => p.lado), [2000, 1600, 1280, 1000]);
  });

  it('una foto más chica que el lado de partida no genera pasos de lado que la agranden', () => {
    const lista = pasos(1500, 2000, 1280, 'image/jpeg');
    assert.ok(lista.every(p => p.lado <= 1500), 'ningún paso mide más que la original');
  });
});

describe('achicarHasta: el bucle de calidad y lado con un codificador falso', () => {
  it('baja la calidad hasta entrar en el tope y devuelve esas medidas', async () => {
    const llamadas: Array<{ ancho: number; alto: number; formato: string; calidad: number }> = [];
    // 2000×1500 a 0,85 = 2550 B; a 0,75 = 2250 B; a 0,65 = 1950 B (entra con tope 2000).
    const r = await achicarHasta({}, { ancho: 4000, alto: 3000 }, { tope: 2000, ladoMax: 2000, codificar: falso(llamadas) });
    assert.ok(r);
    assert.equal(r.ancho, 2000);
    assert.equal(r.alto, 1500);
    assert.deepEqual(llamadas.map(l => l.calidad), [0.85, 0.75, 0.65]);
    assert.ok(r.blob.size <= 2000);
  });

  it('si la calidad no basta, baja el lado y entra (1280 × 960 a 0,55)', async () => {
    const llamadas: Array<{ ancho: number; alto: number; formato: string; calidad: number }> = [];
    // Con tope 1000: 2000×1500 a 0,55 = 1650 B (no); 1600×1200 a 0,55 = 1056 B (no); 1280×960 a 0,55 = 676 B (sí).
    const r = await achicarHasta({}, { ancho: 4000, alto: 3000 }, { tope: 1000, ladoMax: 2000, codificar: falso(llamadas) });
    assert.ok(r);
    assert.equal(r.ancho, 1280);
    assert.equal(r.alto, 960);
    assert.equal(llamadas[llamadas.length - 1]!.calidad, 0.55);
    assert.equal(llamadas[llamadas.length - 1]!.ancho, 1280);
  });

  it('si nunca entra devuelve null (el llamador deja el original)', async () => {
    const r = await achicarHasta({}, { ancho: 4000, alto: 3000 }, { tope: 10, ladoMax: 2000, codificar: falso() });
    assert.equal(r, null);
  });

  it('un codificador que no devuelve nada cuenta como «no entra»', async () => {
    const r = await achicarHasta({}, { ancho: 4000, alto: 3000 }, { tope: 2 * MB, ladoMax: 2000, codificar: async () => null });
    assert.equal(r, null);
  });

  it('el QR nunca baja de 1000 px: aunque ningún intento entre, no se prueba un lado menor', async () => {
    const llamadas: Array<{ ancho: number; alto: number; formato: string; calidad: number }> = [];
    const r = await achicarHasta({}, { ancho: 4000, alto: 4000 }, { tope: 10, ladoMax: 2000, ladoMin: 1000, formato: 'image/png', codificar: falso(llamadas) });
    assert.equal(r, null);
    assert.ok(llamadas.length > 0);
    assert.ok(llamadas.every(l => Math.max(l.ancho, l.alto) >= 1000), 'ningún intento baja de 1000 px');
    assert.ok(llamadas.every(l => l.formato === 'image/png'), 'el QR sigue como PNG');
  });

  it('un QR que entra en el primer intento sale con su lado original sin bajar nada', async () => {
    const r = await achicarHasta({}, { ancho: 900, alto: 900 }, { tope: 500 * KB, ladoMax: 2000, ladoMin: 1000, formato: 'image/png', codificar: falso() });
    assert.ok(r);
    assert.equal(r.ancho, 900);
  });
});

describe('comprimirImagen: el archivo que sale', () => {
  it('un archivo que no necesita compresión se devuelve TAL CUAL (mismo objeto)', async () => {
    const original = new File([new Uint8Array(1 * MB)], 'voucher.jpg', { type: 'image/jpeg' });
    const r = await comprimirImagen(original, { tope: 2 * MB, codificar: falso() });
    assert.equal(r, original);
  });

  it('un PDF grande se devuelve igual, sin intentar nada', async () => {
    const original = new File([new Uint8Array(5 * MB)], 'recibo.pdf', { type: 'application/pdf' });
    const llamadas: Array<{ ancho: number; alto: number; formato: string; calidad: number }> = [];
    const r = await comprimirImagen(original, { tope: 2 * MB, codificar: falso(llamadas) });
    assert.equal(r, original);
    assert.equal(llamadas.length, 0);
  });

  it('una foto grande se achica: sale un File image/jpeg con nombre .jpg y dentro del tope', async () => {
    const original = new File([new Uint8Array(4 * MB)], 'IMG_0042.JPG', { type: 'image/jpeg' });
    const r = await conDecodificador(4000, 3000, () => comprimirImagen(original, { tope: 2 * MB, ladoMax: 2000, codificar: falso() }));
    assert.notEqual(r, original);
    assert.ok(r instanceof File);
    assert.equal(r.type, 'image/jpeg');
    assert.equal(r.name, 'IMG_0042.jpg');
    assert.ok(r.size <= 2 * MB);
  });

  it('un HEIC se convierte a JPEG y el nombre pasa a .jpg (el servidor nunca recibe HEIC)', async () => {
    const original = new File([new Uint8Array(3 * KB)], 'voucher.heic', { type: 'image/heic' });
    const r = await conDecodificador(4000, 3000, () => comprimirImagen(original, { tope: 2 * MB, codificar: falso() }));
    assert.equal(r.type, 'image/jpeg');
    assert.equal(r.name, 'voucher.jpg');
  });

  it('si nunca entra en el tope devuelve el original (la validación dirá que no se pudo achicar)', async () => {
    const original = new File([new Uint8Array(4 * MB)], 'grande.jpg', { type: 'image/jpeg' });
    const r = await conDecodificador(4000, 3000, () => comprimirImagen(original, { tope: 10, codificar: falso() }));
    assert.equal(r, original);
  });

  it('si el navegador no puede decodificar el archivo (HEIC en Chrome de escritorio) devuelve el original', async () => {
    // Sin `createImageBitmap` ni <img> en Node: la decodificación falla y se devuelve el original sin codificar nada.
    const original = new File([new Uint8Array(3 * MB)], 'voucher.heic', { type: 'image/heic' });
    const llamadas: Array<{ ancho: number; alto: number; formato: string; calidad: number }> = [];
    const r = await comprimirImagen(original, { tope: 2 * MB, codificar: falso(llamadas) });
    assert.equal(r, original);
    assert.equal(llamadas.length, 0);
  });

  it('un PNG con transparencia que pasa el tope sigue PNG cuando se pide (logo, QR)', async () => {
    const original = new File([new Uint8Array(800 * KB)], 'logo.png', { type: 'image/png' });
    const llamadas: Array<{ ancho: number; alto: number; formato: string; calidad: number }> = [];
    const r = await conDecodificador(2000, 2000, () => comprimirImagen(original, { tope: 500 * KB, ladoMax: 2000, formato: 'image/png', codificar: falso(llamadas) }));
    assert.ok(llamadas.every(l => l.formato === 'image/png'));
    assert.equal(r.type, 'image/png');
    assert.equal(r.name, 'logo.png');
  });
});
