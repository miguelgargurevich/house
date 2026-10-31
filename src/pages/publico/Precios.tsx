import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon } from '@heroicons/react/24/outline';
import { Alert, Skeleton } from '../../ui';
import { useCatalogo } from './catalogo';
import { plazoGratisTexto } from './plazoGratis';
import { Aparece } from './Aparece';
import { Marco } from './Marco';
import { Comparativa } from './precios/Comparativa';
import { Modulos } from './precios/Modulos';
import { Planes } from './precios/Planes';
import { Preguntas } from './precios/Preguntas';
import { Recibo, type Eleccion } from './precios/Recibo';
import { SelectorPais } from './precios/SelectorPais';
import { monedaDe } from '../../lib/paises';

const boton = 'inline-flex h-12 items-center justify-center whitespace-nowrap rounded px-6 text-base font-semibold transition-colors duration-150 active:scale-[0.98]';

/** Entrada de la cabecera: sube y aparece, una pieza tras otra (sin guion no se esconde nada: la animación sólo mueve). */
const sube = (n: number) => ({ animationDelay: `${n * 80}ms` });

/**
 * Página de precios pública. Todo precio sale de `/api/publico/planes` y `/api/publico/cotizar`: ninguno vive en este archivo.
 * Primero la oferta (el hero corto, las tarjetas de nivel y lo que trae Pro); la calculadora va al final, como una sección propia.
 */
export default function Precios() {
  const { data: cat, loading, error } = useCatalogo();
  const [eleccion, setEleccion] = useState<Eleccion>({ unidades: '100', plan: 'pro' });
  const abierto = cat?.registro_abierto === true;
  // Los hechos salen del catálogo (el tope de Gratis es un dato que edita el superadmin, no una cifra de esta página).
  const tope = cat?.planes.find(p => p.clave === 'gratis')?.unidades_maximas;
  // Moneda e impuesto son los del país elegido (selector): vienen del servidor, no de esta página.
  const impuesto = cat && Number(cat.impuesto.tasa) > 0 ? `Más ${cat.impuesto.nombre}` : 'Sin impuesto adicional';
  const hechos = [cat ? `Precios en ${monedaDe(cat.moneda)?.plural ?? cat.moneda}` : 'Precios por país', impuesto, tope != null ? `Torre Gratis ${plazoGratisTexto(cat!)}, hasta ${tope} departamentos` : cat ? `Torre Gratis ${plazoGratisTexto(cat)}, sin tope de departamentos` : 'Empiezas gratis', 'Sin permanencia'];

  return (
    <Marco completo ancho="max-w-6xl">
      <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-20">
        <header className="mx-auto max-w-3xl text-center">
          <h1 style={sube(0)} className="sube text-[1.8rem] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl">Cobra el mantenimiento sin Excel ni WhatsApp sueltos</h1>
          <p style={sube(1)} className="sube mx-auto mt-6 max-w-xl text-lg leading-relaxed sm:text-xl">Torre emite los recibos, recibe los vouchers y te dice quién debe. Empiezas gratis por 3 meses y después eliges Torre Básico o, cuando necesites todo, Torre Pro.</p>
          {cat && cat.paises.length > 1 && <SelectorPais cat={cat} className="sube mx-auto mt-6 max-w-xs text-left" />}
          <ul style={sube(2)} className="sube mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-base font-medium">
            {/* Con el texto en dos líneas (celular), el check queda pegado al texto y arriba, no suelto a la izquierda. */}
            {hechos.map(h => <li key={h} className="inline-flex max-w-full items-start gap-1.5 text-left"><CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" /><span>{h}</span></li>)}
          </ul>
          <div style={sube(3)} className="sube mt-8 flex flex-wrap items-center justify-center gap-3">
            {abierto
              ? <Link to="/registro" className={`${boton} bg-brand text-on-brand hover:bg-brand-hover`}>Crear cuenta gratis</Link>
              : cat && <Link to="/login" className={`${boton} bg-brand text-on-brand hover:bg-brand-hover`}>Ingresar</Link>}
          </div>
          {cat && !abierto && <p className="mt-4 text-base text-muted">El registro de cuentas nuevas está cerrado por ahora.</p>}
        </header>
        {loading && <div className="mx-auto mt-16 max-w-6xl" aria-hidden="true"><Skeleton className="h-96 w-full" /></div>}
        {error && <div className="mx-auto mt-16 max-w-xl"><Alert tone="bad">No pudimos cargar los precios. Recarga la página en un momento.</Alert></div>}
        {cat && (
          <div className="mt-16 space-y-24 sm:mt-24">
            <Planes cat={cat} onCalcular={clave => setEleccion(e => ({ ...e, plan: clave }))} />
            <div className="mx-auto w-full max-w-5xl"><Modulos cat={cat} onCalcular={clave => setEleccion(e => ({ ...e, plan: clave }))} /></div>
            <div className="mx-auto w-full max-w-4xl"><Recibo cat={cat} eleccion={eleccion} onCambio={setEleccion} /></div>
          </div>
        )}
      </div>
      {cat && <Comparativa cat={cat} />}
      {cat && <Preguntas cat={cat} />}
      {cat && (
        <section aria-labelledby="cierre-titulo" className="bg-brand text-on-brand">
          <Aparece className="mx-auto w-full max-w-5xl px-4 py-20 sm:px-6 sm:py-28">
            <h2 id="cierre-titulo" className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">Tu próximo recibo, desde Torre</h2>
            <p className="mt-6 max-w-xl text-lg sm:text-xl">{abierto ? 'Crea tu cuenta en Torre Gratis, carga tu Excel y emite el recibo del mes.' : 'Si ya tienes cuenta, ingresa y sigue cobrando desde Torre.'}</p>
            <div className="mt-9">
              {abierto
                ? <Link to="/registro" className={`${boton} bg-on-brand text-brand hover:opacity-90`}>Crear cuenta gratis</Link>
                : <Link to="/login" className={`${boton} bg-on-brand text-brand hover:opacity-90`}>Ingresar</Link>}
            </div>
          </Aparece>
        </section>
      )}
    </Marco>
  );
}
