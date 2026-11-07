import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Marco } from './Marco';
import { NO_ENCONTRADA } from './contacto/textos';

const boton = 'inline-flex h-12 items-center justify-center whitespace-nowrap rounded px-6 text-base font-semibold transition-colors duration-150 active:scale-[0.98]';

/** Una dirección pública que no existe. El servidor ya responde 404 con `noindex`; aquí, además, la propia pantalla se marca `noindex` (navegación sin recargar). */
export default function NoEncontrada() {
  useEffect(() => {
    const anterior = document.title;
    document.title = 'No encontramos esta página | Torre';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { document.title = anterior; meta.remove(); };
  }, []);
  return (
    <Marco ancho="max-w-3xl">
      <section aria-labelledby="no-encontrada-titulo" className="py-8 text-center sm:py-16">
        <h1 id="no-encontrada-titulo" className="text-3xl font-semibold sm:text-4xl">{NO_ENCONTRADA.h1}</h1>
        <p className="mx-auto mt-4 max-w-md text-base text-muted">{NO_ENCONTRADA.bajada}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/" className={`${boton} bg-brand text-on-brand hover:bg-brand-hover`}>Ir al inicio</Link>
          <Link to="/precios" className={`${boton} bg-surface2 hover:bg-line`}>Ver precios</Link>
          <Link to="/contacto" className={`${boton} bg-surface2 hover:bg-line`}>Contacto</Link>
        </div>
      </section>
    </Marco>
  );
}
