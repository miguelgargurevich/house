import { CheckIcon, MinusIcon } from '@heroicons/react/24/outline';
import { dinero } from '../../../ui';
import { Aparece } from '../Aparece';
import type { Catalogo } from '../catalogo';
import { duracionGratis } from '../plazoGratis';

const Si = () => <span className="inline-flex justify-center text-ok"><CheckIcon className="h-5 w-5" aria-hidden="true" /><span className="sr-only">Incluido</span></span>;
const No = () => <span className="inline-flex justify-center text-muted"><MinusIcon className="h-5 w-5" aria-hidden="true" /><span className="sr-only">No incluido</span></span>;

/** Departamentos por condominio: lo que dice el catálogo (tope en Gratis y Básico, sin tope en Pro). */
const topeTexto = (max: number | null | undefined) => (max != null ? `Hasta ${max}` : 'Sin tope');

/** Qué trae cada plan: Gratis (por 3 meses), Básico y Pro (Administradora trae lo de Pro). La columna Pro va en un tono distinto, sin líneas. */
export function Comparativa({ cat }: { cat: Catalogo }) {
  const gratis = cat.planes.find(p => p.clave === 'gratis');
  const basico = cat.planes.find(p => p.clave === 'basico');
  const pro = cat.planes.find(p => p.clave === 'pro');
  const adm = cat.planes.find(p => p.clave === 'administradora');
  const nombresModulo = new Set(cat.modulos.map(m => m.nombre));
  // Lo de Gratis (sin la viñeta del tope: tiene su propia fila) y, de Pro, lo que no es un módulo ni «todo lo de…» (mora automática, reportes…).
  const deGratis = (gratis?.caracteristicas ?? []).filter(c => !/departamentos/i.test(c));
  const extrasPro = (pro?.caracteristicas ?? []).filter(c => !/^todo lo de/i.test(c) && !nombresModulo.has(c) && ![...nombresModulo].some(n => c.toLowerCase().includes(n.toLowerCase())));
  const fila = 'odd:bg-surface2/60';
  const celda = 'px-2 py-3 text-center sm:px-4';
  const celdaPro = `${celda} bg-brand-soft`;
  const cabeza = 'px-2 py-4 text-center align-bottom font-medium sm:px-4';
  const filaNombre = 'px-3 py-3 text-left font-normal sm:px-6';
  return (
    <section aria-labelledby="comparativa-titulo" className="bg-surface2">
      <Aparece className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
        <h2 id="comparativa-titulo" className="text-3xl font-semibold tracking-tight sm:text-4xl">Qué trae cada plan</h2>
        <p className="mt-3 max-w-xl text-lg">Torre Básico y Torre Pro traen todo lo de Torre Gratis, sin plazo. Lo demás —IA, WhatsApp, asistente, mora automática y reportes— es de Torre Pro.</p>
        <div className="mt-8 overflow-hidden rounded-xl bg-surface">
          <div className="relative overflow-x-auto">
            <table className="w-full text-base sm:min-w-[30rem]">
              <caption className="sr-only">Comparación entre Torre Gratis, Torre Básico y Torre Pro</caption>
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-4 text-left align-bottom font-medium text-muted sm:px-6">Función</th>
                  <th scope="col" className={cabeza}><span className="block text-lg font-semibold">{gratis?.nombre ?? 'Torre Gratis'}</span><span className="num block text-sm font-normal text-muted">{dinero(gratis?.precio_por_unidad ?? 0, cat.moneda)}</span></th>
                  {basico && <th scope="col" className={cabeza}><span className="block text-lg font-semibold">{basico.nombre}</span><span className="num block text-sm font-normal text-muted">{basico.precio_por_unidad == null ? 'Consúltanos' : dinero(basico.precio_por_unidad, cat.moneda)}</span></th>}
                  <th scope="col" className={`${cabeza} bg-brand text-on-brand`}><span className="block text-lg font-semibold">{pro?.nombre ?? 'Torre Pro'}</span><span className="num block text-sm font-normal">{pro?.precio_por_unidad == null ? 'Consúltanos' : dinero(pro.precio_por_unidad, cat.moneda)}</span></th>
                </tr>
              </thead>
              <tbody>
                <tr className={fila}><th scope="row" className={filaNombre}>Duración</th><td className={celda}>{cat.dias_gratis ? duracionGratis(cat.dias_gratis) : 'Sin plazo'}</td>{basico && <td className={celda}>Sin plazo</td>}<td className={celdaPro}>Sin plazo</td></tr>
                <tr className={fila}><th scope="row" className={filaNombre}>Departamentos por condominio</th><td className={celda}>{topeTexto(gratis?.unidades_maximas)}</td>{basico && <td className={celda}>{topeTexto(basico.unidades_maximas)}</td>}<td className={celdaPro}>{topeTexto(pro?.unidades_maximas)}</td></tr>
                {deGratis.map(f => (
                  <tr key={f} className={fila}><th scope="row" className={filaNombre}>{f}</th><td className={celda}><Si /></td>{basico && <td className={celda}><Si /></td>}<td className={celdaPro}><Si /></td></tr>
                ))}
                {cat.modulos.map(m => (
                  <tr key={m.clave} className={fila}><th scope="row" className={filaNombre}>{m.nombre}</th><td className={celda}><No /></td>{basico && <td className={celda}><No /></td>}<td className={celdaPro}><Si /></td></tr>
                ))}
                {extrasPro.map(f => (
                  <tr key={f} className={fila}><th scope="row" className={filaNombre}>{f}</th><td className={celda}><No /></td>{basico && <td className={celda}><No /></td>}<td className={celdaPro}><Si /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-5 max-w-2xl text-base">Precios por departamento al mes{Number(cat.impuesto.tasa) > 0 ? `, sin ${cat.impuesto.nombre}` : ''}.{basico?.unidades_minimas != null && basico.unidades_maximas != null && ` ${basico.nombre} cobra como mínimo ${basico.unidades_minimas} departamentos y llega hasta ${basico.unidades_maximas}.`}{pro?.unidades_minimas != null && ` ${pro.nombre} cobra como mínimo ${pro.unidades_minimas} departamentos por condominio.`}{adm && ` ${adm.nombre} trae todo lo de Torre Pro${adm.caracteristicas.length > 1 ? ' más ' + adm.caracteristicas.filter(c => !/^todo lo de/i.test(c)).map(c => c.toLowerCase()).join(' y ') : ''}${adm.precio_por_unidad == null ? ', con precio a consultar en tu país' : `, a ${dinero(adm.precio_por_unidad, cat.moneda)}`}${adm.unidades_minimas != null ? ` con el mismo mínimo de ${adm.unidades_minimas} departamentos por condominio` : ''}.`}</p>
      </Aparece>
    </section>
  );
}
