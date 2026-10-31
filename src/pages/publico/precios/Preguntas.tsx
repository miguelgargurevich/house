import { dinero } from '../../../ui';
import { Aparece } from '../Aparece';
import type { Catalogo } from '../catalogo';
import { plazoGratisTexto } from '../plazoGratis';

/** Respuestas cortas a lo que más preguntan; sólo lo que House hace hoy (cobro manual, sin pasarela ni contrato). Los topes salen del catálogo. */
function preguntas(cat: Catalogo): { p: string; r: string }[] {
  const tope = cat.planes.find(x => x.clave === 'gratis')?.unidades_maximas;
  const minimo = cat.planes.find(x => x.clave === 'pro')?.unidades_minimas;
  const basico = cat.planes.find(x => x.clave === 'basico');
  const plazo = plazoGratisTexto(cat);
  const imp = Number(cat.impuesto.tasa);
  const nombreImp = cat.impuesto.nombre;
  return [
    { p: '¿Cómo se paga?', r: 'Por transferencia, Yape o Plin. Desde «Mi plan» ves el monto y la referencia de tu pago; cuando lo confirmamos, activamos tu plan.' },
    { p: '¿Cómo paso a un plan de pago?', r: 'Desde «Mi plan» lo pides por condominio. No se activa nada hasta confirmar el pago, así que no hay cobros por sorpresa. Torre Pro trae todo: ya no hay módulos sueltos.' },
    imp > 0
      ? { p: `¿El precio incluye ${nombreImp}?`, r: `No. Los precios de esta página no incluyen ${nombreImp}: se suma al pagar, según el país de tu condominio. La calculadora te muestra también el total con ${nombreImp}.` }
      : { p: '¿El precio incluye impuestos?', r: 'En el país elegido no se suma ningún impuesto al pagar: el precio de esta página es el que pagas.' },
    { p: '¿Hay permanencia o contrato?', r: 'No. No te atamos a un plazo mínimo.' },
    { p: '¿Cuánto dura y hasta cuántos departamentos llega Torre Gratis?', r: `${cat.dias_gratis ? `Torre Gratis dura ${plazo.replace('por ', '')} desde que creas tu cuenta` : 'Torre Gratis no tiene plazo'}${tope != null ? ` y llega hasta ${tope} departamentos por condominio` : ''}, con recibos, cobranza, portal del vecino, vouchers validados a mano y avisos por correo. Si quieres IA, WhatsApp, asistente, mora automática y reportes, pasas a Torre Pro.` },
    ...(cat.dias_gratis ? [{ p: '¿Qué pasa cuando termina el plan Torre Gratis?', r: `El condominio queda en solo lectura: puedes ver todo, pero no registrar recibos, pagos ni comunicados nuevos. No se borra nada, y vuelves a registrar apenas pases a ${basico ? `${basico.nombre} o ` : ''}Torre Pro. Te avisamos al empezar, siete días antes y el día que termina.` }] : []),
    ...(basico && basico.unidades_maximas != null ? [{ p: `¿Qué es ${basico.nombre}?`, r: `Es el plan para edificios chicos que ya terminaron su periodo gratis: lo mismo que Torre Gratis, sin plazo, hasta ${basico.unidades_maximas} departamentos${basico.precio_por_unidad !== null ? `, a ${dinero(basico.precio_por_unidad, cat.moneda)} por departamento al mes${basico.unidades_minimas != null ? ` con un mínimo de ${basico.unidades_minimas} departamentos` : ''}` : ''}. No trae IA, WhatsApp, asistente, mora automática ni reportes: eso es de Torre Pro.` }] : []),
    { p: '¿Hay un mínimo en Torre Pro?', r: minimo != null ? `Sí: Torre Pro y Torre Administradora cobran como mínimo ${minimo} departamentos por condominio. Si tu condominio tiene menos, pagas ese mínimo; si tiene más, pagas por los que tengas.` : 'No hay un mínimo de departamentos: pagas por los que tengas.' },
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
