import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpenIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { useAuth } from '../../auth/AuthContext';
import { useCatalogo } from '../../pages/publico/catalogo';
import { GuiaDemo } from './GuiaDemo';
import { GUIA } from './guia';
import { rolDeDemoDe } from './roles';
import { URL_TORRE, consumirAbrirGuia, rolGuardado, useCasillas, useModoDemo } from './useDemo';

const enlace = 'whitespace-nowrap font-medium text-brand underline underline-offset-2 hover:no-underline';

/**
 * La franja fija de la demo, arriba de todas las pantallas de la app: dice que los datos son de ejemplo, deja cambiar de rol, crear una cuenta de verdad
 * y escribir por WhatsApp, y abre «Qué probar». En una instancia que no es una demo no pinta nada (ni pide nada).
 */
export function FranjaDemo() {
  const { demo } = useModoDemo();
  return demo ? <FranjaActiva /> : null; // el catálogo (WhatsApp, manual) sólo se pide en una demo
}

function FranjaActiva() {
  const { user } = useAuth();
  const { data: cat } = useCatalogo();
  const rol = user ? rolDeDemoDe(user, rolGuardado()) : null;
  const { marcadas, alternar, limpiar } = useCasillas(rol);
  const [abierta, setAbierta] = useState(false);
  useEffect(() => { if (rol && consumirAbrirGuia()) setAbierta(true); }, [rol]);

  const whatsapp = cat?.redes?.whatsapp?.enlace ?? null;
  const total = rol ? GUIA[rol].length : 0;
  const hechos = rol ? GUIA[rol].filter((p) => marcadas.has(p.id)).length : 0;
  return (
    <>
      <div role="region" aria-label="Estás en la demo de Torre" className="border-b border-brand/25 bg-brand-soft px-4 py-2 text-xs text-ink sm:text-sm lg:px-8">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <InformationCircleIcon className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
            Estás en la demo de Torre: los datos son de ejemplo y se reinician cada noche
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link to="/demo" className={enlace}>Cambiar de rol</Link>
            <a href={`${URL_TORRE}/registro`} target="_blank" rel="noopener noreferrer" className={enlace}>Crear mi cuenta gratis<span className="sr-only"> (se abre en otra pestaña)</span></a>
            {whatsapp && <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={enlace}>Hablar por WhatsApp<span className="sr-only"> (se abre en otra pestaña)</span></a>}
            {rol && (
              <button type="button" onClick={() => setAbierta((a) => !a)} aria-expanded={abierta} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-brand px-2.5 py-0.5 font-medium text-on-brand transition-colors duration-150 hover:bg-brand-hover">
                <BookOpenIcon className="h-4 w-4" aria-hidden="true" />Qué probar · {hechos}/{total}
              </button>
            )}
          </span>
        </p>
      </div>
      {abierta && rol && <GuiaDemo rol={rol} urlManual={cat?.manual ?? null} marcadas={marcadas} onAlternar={alternar} onLimpiar={limpiar} onCerrar={() => setAbierta(false)} />}
    </>
  );
}
