import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Cifrado autenticado (AES-256-GCM) para secretos en reposo. Formato: "v2:<base64(iv|tag|ciphertext)>".
// La AAD es obligatoria: un valor copiado a otro proveedor/etiqueta no se puede descifrar.
const PREFIJO = 'v2:';
const IV_LEN = 12;
const TAG_LEN = 16;
const SAL = 'house-llavero-v1';
const MIN_SECRETO = 32;

const cache = new Map<string, Buffer>();

export function llaveroConfigurado(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.LLAVERO_ENC_KEY ?? '').length >= MIN_SECRETO;
}

/** Clave de 32 bytes derivada con scrypt (sal fija de la app) desde LLAVERO_ENC_KEY; memoizada por secreto. */
function derivar(env: NodeJS.ProcessEnv): Buffer {
  const secreto = env.LLAVERO_ENC_KEY ?? '';
  if (secreto.length < MIN_SECRETO) throw new Error('LLAVERO_ENC_KEY no está configurada');
  let k = cache.get(secreto);
  if (!k) {
    if (cache.size >= 4) cache.clear();
    k = scryptSync(secreto, SAL, 32);
    cache.set(secreto, k);
  }
  return k;
}

function aadDe(aad: string): Buffer {
  if (!aad) throw new Error('secretBox: la AAD es obligatoria');
  return Buffer.from(aad, 'utf8');
}

export function cifrar(texto: string, aad: string, env: NodeJS.ProcessEnv = process.env): string {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv('aes-256-gcm', derivar(env), iv);
  c.setAAD(aadDe(aad));
  const ct = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return PREFIJO + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

/** Lanza si el valor fue alterado, la clave cambió o la AAD no coincide. */
export function descifrar(valor: string, aad: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!valor.startsWith(PREFIJO)) throw new Error('secretBox: formato desconocido');
  const raw = Buffer.from(valor.slice(PREFIJO.length), 'base64');
  if (raw.length < IV_LEN + TAG_LEN) throw new Error('secretBox: valor truncado');
  const d = createDecipheriv('aes-256-gcm', derivar(env), raw.subarray(0, IV_LEN));
  d.setAAD(aadDe(aad));
  d.setAuthTag(raw.subarray(IV_LEN, IV_LEN + TAG_LEN));
  return Buffer.concat([d.update(raw.subarray(IV_LEN + TAG_LEN)), d.final()]).toString('utf8');
}

export const aadClave = (proveedor: string, etiqueta: string) => `clave:${proveedor}:${etiqueta}`;
