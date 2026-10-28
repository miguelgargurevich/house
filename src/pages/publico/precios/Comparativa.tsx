import { CheckIcon, MinusIcon } from '@heroicons/react/24/outline';
import { soles } from '../../../ui';
import { Aparece } from '../Aparece';
import type { Catalogo } from '../catalogo';

const Si = () => <span className="inline-flex justify-center text-ok"><CheckIcon className="h-5 w-5" aria-hidden="true" /><span className="sr-only">Incluido</span></span>;
const No = () => <span className="inline-flex justify-center text-muted"><MinusIcon className="h-5 w-5" aria-hidden="true" /><span className="sr-only">No incluido</span></span>;

/** Qué trae cada uno: Gratis, un módulo suelto y Pro. La columna Pro va en un tono distinto, sin líneas. */
export function Comparativa({ cat }: { cat: Catalogo }) {
  const gratis = cat.planes.find(p => p.clave === 'gratis');
  const pro = cat.planes.find(p => p.clave === 'pro');
  const adm = cat.planes.find(p => p.clave === 'administradora');
  const nombresModulo = new Set(cat.modulos.map(m => m.nombre));
  const extrasPro = (pro?.caracteristicas ?? []).filter(c => !/^todo lo de/i.test(c) && !nombresModulo.has(c) && ![...nombresModulo].some(n => c.toLowerCase().includes(n.toLowerCase())));
  const fila = 'odd:bg-surface2/60';
  const celda = 'px-2 py-3 text-center sm:px-4';
  const celdaPro = `${celda} bg-brand-soft`;
  const cabeza = 'px-2 py-4 text-center align-bottom font-medium sm:px-4';
  return (
    <section aria-labelledby="comparativa-titulo" className="bg-surface2">
      <Aparece className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        <h2 id="comparativa-titulo" className="text-3xl font-semibold tracking-tight sm:text-4xl">Qué trae cada uno</h2>
        <p className="mt-3 max-w-xl text-lg">Todo lo de Gratis está en los tres. Los módulos se contratan por condominio; Pro los trae todos.</p>
        <div className="mt-8 overflow-hidden rounded-xl bg-surface">
          <div className="relative overflow-x-auto">
            <table className="w-full text-base sm:min-w-[34rem]">
              <caption className="sr-only">Comparación entre Gratis, cada módulo y Pro</caption>
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-4 text-left align-bottom font-medium text-muted sm:px-6">Función</th>
                  <th scope="col" className={cabeza}><span className="block text-lg font-semibold">Gratis</span><span className="num block text-sm font-normal text-muted">{soles(gratis?.precio_por_unidad ?? 0)}</span></th>
                  <th scope="col" className={cabeza}><span className="block text-lg font-semibold">Módulo suelto</span><span className="block text-sm font-normal text-muted">según módulo</span></th>
                  <th scope="col" className={`${cabeza} bg-brand text-on-brand`}><span className="block text-lg font-semibold">Pro</span><span className="num block text-sm font-normal">{soles(pro?.precio_por_unidad ?? 0)}</span></th>
                </tr>
              </thead>
              <tbody>
                {(gratis?.caracteristicas ?? []).map(f => (
                  <tr key={f} className={fila}><th scope="row" className="px-3 py-3 text-left font-normal sm:px-6">{f}</th><td className={celda}><Si /></td><td className={celda}><Si /></td><td className={celdaPro}><Si /></td></tr>
                ))}
                {cat.modulos.map(m => (
                  <tr key={m.clave} className={fila}>
                    <th scope="row" className="px-3 py-3 text-left font-normal sm:px-6">{m.nombre}</th>
                    <td className={celda}><No /></td>
                    <td className={`${celda} num text-sm`}>{soles(m.precio_por_unidad)}</td>
                    <td className={celdaPro}><Si /></td>
                  </tr>
                ))}
                {extrasPro.map(f => (
                  <tr key={f} className={fila}><th scope="row" className="px-3 py-3 text-left font-normal sm:px-6">{f}</th><td className={celda}><No /></td><td className={celda}><No /></td><td className={celdaPro}><Si /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-5 max-w-2xl text-base">Precios por departamento al mes, IGV incluido.{adm && ` ${adm.nombre} trae todo lo de Pro${adm.caracteristicas.length > 1 ? ' más ' + adm.caracteristicas.filter(c => !/^todo lo de/i.test(c)).map(c => c.toLowerCase()).join(' y ') : ''}, a ${soles(adm.precio_por_unidad)}.`}</p>
      </Aparece>
    </section>
  );
}
