import { Aparece } from '../Aparece';

/** Respuestas cortas a lo que más preguntan; sólo lo que House hace hoy (cobro manual, sin pasarela ni contrato). */
const PREGUNTAS = [
  { p: '¿Cómo se paga?', r: 'Por transferencia, Yape o Plin. Desde «Mi plan» ves el monto y la referencia de tu pago; cuando lo confirmamos, activamos tu plan.' },
  { p: '¿Cómo cambio de plan o sumo un módulo?', r: 'Desde «Mi plan» lo pides por condominio. No se activa nada hasta confirmar el pago, así que no hay cobros por sorpresa.' },
  { p: '¿El precio incluye IGV?', r: 'Sí. Todos los precios de esta página ya lo incluyen: lo que ves es lo que pagas.' },
  { p: '¿Hay permanencia o contrato?', r: 'No. No te atamos a un plazo mínimo.' },
  { p: '¿Hay un límite de departamentos?', r: 'No. El plan Gratis sirve para condominios de cualquier tamaño; el precio de Pro y de los módulos crece con tus departamentos.' },
] as const;

/** Preguntas frecuentes como texto corrido: la pregunta abre cada párrafo y la respuesta sigue en la misma línea. */
export function Preguntas() {
  return (
    <section aria-labelledby="preguntas-titulo" className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
        <h2 id="preguntas-titulo" className="text-3xl font-semibold tracking-tight sm:text-4xl lg:col-span-4">Preguntas frecuentes</h2>
        <div className="space-y-5 lg:col-span-8 lg:columns-2 lg:gap-12 lg:space-y-0 [&>p]:lg:mb-6">
          {PREGUNTAS.map(({ p, r }, i) => (
            <Aparece como="p" key={p} retraso={(i % 3) * 70} className="break-inside-avoid text-lg leading-relaxed"><strong className="font-semibold">{p}</strong> {r}</Aparece>
          ))}
        </div>
      </div>
    </section>
  );
}
