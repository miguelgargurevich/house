import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon, MinusIcon } from '@heroicons/react/24/outline';
import { api, useResource } from '../../api';
import { Alert, Card, CardBody, CardHeader, Input, Skeleton, soles } from '../../ui';
import { Marco } from './Marco';

interface Plan { clave: string; nombre: string; descripcion: string | null; precio_por_unidad: string; modulos_incluidos: string[]; caracteristicas: string[] }
interface Modulo { clave: string; nombre: string; descripcion: string | null; precio_por_unidad: string }
interface Catalogo { planes: Plan[]; modulos: Modulo[]; registro_abierto: boolean }
interface Total { total_mes: string; total_anio: string }

/** Un total por departamento y por mes, ya con IGV: lo calcula el servidor (el frontend no sabe de precios ni de la tasa). */
function useTotal(unidades: number, plan: string | null, modulos: string[], activo: boolean) {
  const [r, setR] = useState<Total | null>(null);
  const [error, setError] = useState(false);
  const clave = `${unidades}|${plan}|${modulos.join(',')}`;
  useEffect(() => {
    if (!activo) { setR(null); return; }
    let vivo = true;
    const t = setTimeout(() => {
      const sp = new URLSearchParams({ unidades: String(unidades) });
      if (plan) sp.set('plan', plan);
      if (modulos.length) sp.set('modulos', modulos.join(','));
      api<Total>(`/api/publico/cotizar?${sp}`).then(x => { if (vivo) { setR(x); setError(false); } }).catch(() => { if (vivo) setError(true); });
    }, 250);
    return () => { vivo = false; clearTimeout(t); };
    // `clave` resume los tres insumos (evita volver a pedir por un arreglo nuevo con el mismo contenido).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, activo]);
  return { r, error };
}

function Linea({ titulo, detalle, total }: { titulo: string; detalle?: string; total: { r: Total | null; error: boolean } | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{titulo}</p>
        {detalle && <p className="text-xs text-muted">{detalle}</p>}
      </div>
      <div className="text-right">
        {total?.error ? <span className="text-xs text-bad">No se pudo calcular</span> : total?.r ? (
          <>
            <p className="num text-lg font-semibold">{soles(total.r.total_mes)}<span className="text-xs font-normal text-muted"> /mes</span></p>
            <p className="num text-xs text-muted">{soles(total.r.total_anio)} al año</p>
          </>
        ) : <Skeleton className="h-6 w-24" />}
      </div>
    </div>
  );
}

function Calculadora({ cat }: { cat: Catalogo }) {
  const [unidades, setUnidades] = useState('100');
  const [elegidos, setElegidos] = useState<string[]>([]);
  const n = Math.min(100_000, Math.max(1, Math.trunc(Number(unidades) || 0)));
  const valido = Number(unidades) >= 1;
  const sueltos = useTotal(n, null, elegidos, valido && elegidos.length > 0);
  const gratis = useTotal(n, 'gratis', [], valido && cat.planes.some(p => p.clave === 'gratis'));
  const pro = useTotal(n, 'pro', [], valido && cat.planes.some(p => p.clave === 'pro'));
  const adm = useTotal(n, 'administradora', [], valido && cat.planes.some(p => p.clave === 'administradora'));
  const alternar = (c: string) => setElegidos(e => (e.includes(c) ? e.filter(x => x !== c) : [...e, c]));
  const planPro = cat.planes.find(p => p.clave === 'pro');
  const planAdm = cat.planes.find(p => p.clave === 'administradora');

  return (
    <Card>
      <CardHeader title="Calcula tu costo" description="Total al mes y al año por condominio, IGV incluido." />
      <CardBody className="space-y-5">
        <Input label="Número de departamentos" type="number" inputMode="numeric" min={1} max={100000} value={unidades} onChange={e => setUnidades(e.target.value)} error={valido ? undefined : 'Escribe al menos 1'} className="max-w-xs" />
        <fieldset>
          <legend className="text-sm font-medium">Módulos (opcionales)</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {cat.modulos.map(m => (
              <label key={m.clave} className="flex cursor-pointer items-start gap-2 rounded border border-line p-3 text-sm transition-colors duration-150 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[oklch(var(--brand))]" checked={elegidos.includes(m.clave)} onChange={() => alternar(m.clave)} />
                <span><span className="block font-medium">{m.nombre}</span><span className="num text-xs text-muted">{soles(m.precio_por_unidad)} por depto al mes</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="divide-y divide-line rounded border border-line px-4" aria-live="polite">
          <Linea titulo="Gratis" detalle="Recibos, cobranza, portal del residente y vouchers manuales" total={gratis} />
          {elegidos.length > 0 && <Linea titulo="Gratis + módulos elegidos" detalle={elegidos.map(c => cat.modulos.find(m => m.clave === c)?.nombre).filter(Boolean).join(' · ')} total={sueltos} />}
          {planPro && <Linea titulo={`Plan ${planPro.nombre}`} detalle="Los tres módulos, mora automática, reportes y exportes" total={pro} />}
          {planAdm && <Linea titulo={`Plan ${planAdm.nombre}`} detalle="Varios condominios en una cuenta, con descuento por volumen" total={adm} />}
        </div>
      </CardBody>
    </Card>
  );
}

const Si = () => <span className="inline-flex justify-center text-ok"><CheckIcon className="h-5 w-5" aria-hidden="true" /><span className="sr-only">Incluido</span></span>;
const No = () => <span className="inline-flex justify-center text-muted"><MinusIcon className="h-5 w-5" aria-hidden="true" /><span className="sr-only">No incluido</span></span>;

function Tabla({ cat }: { cat: Catalogo }) {
  const gratis = cat.planes.find(p => p.clave === 'gratis');
  const pro = cat.planes.find(p => p.clave === 'pro');
  const nombresModulo = new Set(cat.modulos.map(m => m.nombre));
  const extrasPro = (pro?.caracteristicas ?? []).filter(c => !/^todo lo de/i.test(c) && !nombresModulo.has(c) && ![...nombresModulo].some(n => c.toLowerCase().includes(n.toLowerCase())));
  return (
    <Card>
      <CardHeader title="Qué trae cada uno" description="Los módulos se contratan por condominio; Pro los trae todos." />
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <caption className="sr-only">Comparación entre Gratis, cada módulo y Pro</caption>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="px-5 py-3 font-medium">Función</th>
              <th scope="col" className="px-3 py-3 text-center font-medium">Gratis</th>
              <th scope="col" className="px-3 py-3 text-center font-medium">Módulo suelto</th>
              <th scope="col" className="px-3 py-3 text-center font-medium">Pro</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(gratis?.caracteristicas ?? []).map(f => (
              <tr key={f}><th scope="row" className="px-5 py-2.5 text-left font-normal">{f}</th><td className="px-3 text-center"><Si /></td><td className="px-3 text-center"><Si /></td><td className="px-3 text-center"><Si /></td></tr>
            ))}
            {cat.modulos.map(m => (
              <tr key={m.clave}>
                <th scope="row" className="px-5 py-2.5 text-left font-normal">{m.nombre}</th>
                <td className="px-3 text-center"><No /></td>
                <td className="num px-3 text-center text-xs">{soles(m.precio_por_unidad)} <span className="text-muted">/depto/mes</span></td>
                <td className="px-3 text-center"><Si /></td>
              </tr>
            ))}
            {extrasPro.map(f => (
              <tr key={f}><th scope="row" className="px-5 py-2.5 text-left font-normal">{f}</th><td className="px-3 text-center"><No /></td><td className="px-3 text-center"><No /></td><td className="px-3 text-center"><Si /></td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line bg-surface2 font-medium">
              <th scope="row" className="px-5 py-3 text-left">Precio por departamento al mes <span className="text-xs font-normal text-muted">(IGV incluido)</span></th>
              <td className="num px-3 text-center">{soles(gratis?.precio_por_unidad ?? 0)}</td>
              <td className="px-3 text-center text-xs text-muted">según módulo</td>
              <td className="num px-3 text-center">{soles(pro?.precio_por_unidad ?? 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

/** Página de precios pública. Todo precio sale de `/api/publico/planes` y `/api/publico/cotizar`: ninguno vive en este archivo. */
export default function Precios() {
  const { data, loading, error } = useResource<Catalogo>('/api/publico/planes');
  return (
    <Marco>
      <header className="mb-8 text-center">
        <h1 className="text-3xl font-semibold sm:text-4xl">Precios simples, en soles</h1>
        <p className="mx-auto mt-3 max-w-2xl text-muted">Empieza gratis, sin límite de departamentos. Activa módulos sólo en los condominios que los necesiten. Todos los precios incluyen IGV.</p>
        <div className="mt-6"><Link to="/registro" className="rounded bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors duration-150 hover:bg-brand-hover">Crear cuenta gratis</Link></div>
      </header>
      {loading && <div className="space-y-4"><Skeleton className="h-48 w-full" /><Skeleton className="h-64 w-full" /></div>}
      {error && <Alert tone="bad">No pudimos cargar los precios. Recarga la página en un momento.</Alert>}
      {data && (
        <div className="space-y-6">
          <Calculadora cat={data} />
          <Tabla cat={data} />
        </div>
      )}
    </Marco>
  );
}
