// Lectura de un stream SSE (`event:` + `data:` JSON separados por línea en blanco), sin React: acepta fragmentos partidos en cualquier punto.
export interface EventoSse { evento: string; datos: unknown }

export class AcumuladorSse {
  private buf = '';
  /** Agrega un fragmento y devuelve los eventos que ya quedaron completos. */
  empujar(trozo: string): EventoSse[] {
    this.buf += trozo.replace(/\r\n/g, '\n');
    const salida: EventoSse[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const bloque = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const ev = parsearBloque(bloque);
      if (ev) salida.push(ev);
    }
    return salida;
  }
  /** Lo que haya quedado sin terminar al cerrarse la conexión. */
  terminar(): EventoSse[] {
    const resto = this.buf.trim();
    this.buf = '';
    const ev = resto ? parsearBloque(resto) : null;
    return ev ? [ev] : [];
  }
}

function parsearBloque(bloque: string): EventoSse | null {
  let evento = 'message';
  const datos: string[] = [];
  for (const linea of bloque.split('\n')) {
    if (linea.startsWith(':')) continue; // comentario / latido
    if (linea.startsWith('event:')) evento = linea.slice(6).trim();
    else if (linea.startsWith('data:')) datos.push(linea.slice(5).replace(/^ /, ''));
  }
  if (!datos.length) return null;
  try { return { evento, datos: JSON.parse(datos.join('\n')) }; } catch { return null; }
}

/** Convierte un `ReadableStream` de bytes en eventos SSE. */
export async function* leerSse(body: ReadableStream<Uint8Array>): AsyncGenerator<EventoSse, void, void> {
  const lector = body.getReader();
  const dec = new TextDecoder();
  const acc = new AcumuladorSse();
  try {
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      yield* acc.empujar(dec.decode(value, { stream: true }));
    }
    yield* acc.terminar();
  } finally {
    await lector.cancel().catch(() => undefined);
  }
}
