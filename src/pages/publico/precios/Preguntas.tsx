import { Aparece } from '../Aparece';
import type { Catalogo } from '../catalogo';
import { preguntas } from '../../../lib/seo/textos';

/** Preguntas frecuentes como texto corrido: la pregunta abre cada párrafo y la respuesta sigue en la misma línea. */
export function Preguntas({ cat }: { cat: Catalogo }) {
  return (
    <section aria-labelledby="preguntas-titulo" className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
        <h2 id="preguntas-titulo" className="text-3xl font-semibold tracking-tight sm:text-4xl lg:col-span-4">Preguntas frecuentes</h2>
        <div className="space-y-5 lg:col-span-8 lg:columns-2 lg:gap-12 lg:space-y-0 [&>p]:lg:mb-6">
          {preguntas(cat).map(({ p, r }, i) => (
            <Aparece como="p" key={p} retraso={(i % 3) * 70} className="break-inside-avoid text-lg leading-relaxed"><strong className="font-semibold">{p}</strong> {r}</Aparece>
          ))}
        </div>
      </div>
    </section>
  );
}
