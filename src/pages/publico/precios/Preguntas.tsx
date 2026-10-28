import { Aparece } from '../Aparece';
import type { Catalogo } from '../catalogo';

/** Respuestas cortas a lo que más preguntan; sólo lo que House hace hoy (cobro manual, sin pasarela ni contrato). Los topes salen del catálogo. */
function preguntas(cat: Catalogo): { p: string; r: string }[] {
  const tope = cat.planes.find(x => x.clave === 'gratis')?.unidades_maximas;
  const minimo = cat.planes.find(x => x.clave === 'pro')?.unidades_minimas;
  return [
    { p: '¿Cómo se paga?', r: 'Por transferencia, Yape o Plin. Desde «Mi plan» ves el monto y la referencia de tu pago; cuando lo confirmamos, activamos tu plan.' },
    { p: '¿Cómo paso a Pro?', r: 'Desde «Mi plan» lo pides por condominio. No se activa nada hasta confirmar el pago, así que no hay cobros por sorpresa. Pro trae todo: ya no hay módulos sueltos.' },
    { p: '¿El precio incluye IGV?', r: 'Sí. Todos los precios de esta página ya lo incluyen: lo que ves es lo que pagas.' },
    { p: '¿Hay permanencia o contrato?', r: 'No. No te atamos a un plazo mínimo.' },
    { p: '¿Hasta cuántos departamentos es gratis?', r: tope != null ? `Gratis llega hasta ${tope} departamentos por condominio, con recibos, cobranza, portal del vecino, vouchers validados a mano y avisos por correo. Con más departamentos, o si quieres IA, WhatsApp, asistente, mora automática y reportes, pasas a Pro.` : 'El plan Gratis no tiene tope de departamentos; la IA, WhatsApp, el asistente, la mora automática y los reportes son de Pro.' },
    { p: '¿Hay un mínimo en Pro?', r: minimo != null ? `Sí: Pro y Administradora cobran como mínimo ${minimo} departamentos por condominio. Si tu condominio tiene menos, pagas ese mínimo; si tiene más, pagas por los que tengas.` : 'No hay un mínimo de departamentos: pagas por los que tengas.' },
  ];
}

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
