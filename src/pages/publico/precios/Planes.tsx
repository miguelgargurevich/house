import { Link } from 'react-router-dom';
import { CheckIcon } from '@heroicons/react/24/outline';
import { soles } from '../../../ui';
import { Aparece } from '../Aparece';
import type { Catalogo, Plan } from '../catalogo';

const boton = 'inline-flex h-12 items-center justify-center whitespace-nowrap rounded px-6 text-base font-semibold transition-colors duration-150 active:scale-[0.98]';

/** Lo que trae un plan, tal como lo publica el catálogo. */
function Lista({ plan, className, icono = '' }: { plan: Plan; className?: string; icono?: string }) {
  return (
    <ul className={className}>
      {plan.caracteristicas.map(c => (
        <li key={c} className="flex items-start gap-2.5 text-base leading-snug">
          <CheckIcon className={`mt-0.5 h-5 w-5 shrink-0 ${icono}`} aria-hidden="true" />
          <span>{c}</span>
        </li>
      ))}
    </ul>
  );
}

function Precio({ plan, grande }: { plan: Plan; grande?: boolean }) {
  const gratis = Number(plan.precio_por_unidad) === 0;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <span className={`num font-semibold tracking-tight ${grande ? 'text-6xl sm:text-7xl' : 'text-5xl'}`}>{gratis ? 'S/ 0' : soles(plan.precio_por_unidad)}</span>
      <span className="text-base">{gratis ? 'para siempre' : 'por departamento al mes'}</span>
    </p>
  );
}

/** El tope de departamentos (Gratis) o el mínimo que se cobra (Pro y Administradora), tal como los publica el catálogo. */
function Tope({ plan, className = '' }: { plan: Plan; className?: string }) {
  if (plan.unidades_maximas != null) return <p className={`text-base font-medium ${className}`}>Hasta {plan.unidades_maximas} departamentos por condominio.</p>;
  if (plan.unidades_minimas != null) return <p className={`text-base font-medium ${className}`}>Mínimo de {plan.unidades_minimas} departamentos cobrados por condominio{plan.total_minimo_mes ? ` · desde ${soles(plan.total_minimo_mes)} al mes` : ''}.</p>;
  return null;
}

/** Enlace de cada plan: crear la cuenta si el registro está abierto; si no, lo que sí se puede hacer (ingresar). */
function Accion({ abierto, texto, className }: { abierto: boolean; texto: string; className: string }) {
  return abierto
    ? <Link to="/registro" className={className}>{texto}</Link>
    : <Link to="/login" className={className}>Ingresar</Link>;
}

/**
 * Tres planes con peso distinto: Pro es un campo de color entero (el que más conviene a una junta o administradora); Gratis y
 * Administradora, dos paneles claros debajo. Nombres, precios y contenido salen del catálogo.
 */
export function Planes({ cat, onCalcular }: { cat: Catalogo; onCalcular: (clave: string) => void }) {
  const gratis = cat.planes.find(p => p.clave === 'gratis');
  const pro = cat.planes.find(p => p.clave === 'pro');
  const adm = cat.planes.find(p => p.clave === 'administradora');
  const abierto = cat.registro_abierto;
  const calcular = (clave: string, className: string) => (
    <a href="#recibo" onClick={() => onCalcular(clave)} className={className}>Ver mi total</a>
  );
  return (
    <section aria-labelledby="planes-titulo" className="scroll-mt-6">
      <h2 id="planes-titulo" className="text-3xl font-semibold tracking-tight sm:text-4xl">Gratis con límite, o Pro con todo</h2>
      <div className="mt-8 space-y-3">
        {pro && (
          <Aparece como="article" className="rounded-xl bg-brand p-6 text-on-brand sm:p-9">
            <h3 className="text-2xl font-semibold sm:text-3xl">{pro.nombre}</h3>
            {pro.descripcion && <p className="mt-1 text-lg">{pro.descripcion}</p>}
            <div className="mt-8"><Precio plan={pro} grande /></div>
            <Tope plan={pro} className="mt-3" />
            <Lista plan={pro} className="mt-8 grid gap-x-8 gap-y-3 sm:grid-cols-2" />
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Accion abierto={abierto} texto="Empezar con Pro" className={`${boton} bg-on-brand text-brand hover:opacity-90`} />
              {calcular('pro', `${boton} px-3 text-on-brand underline underline-offset-4 hover:opacity-80`)}
            </div>
            <p className="mt-4 text-sm opacity-90">Creas tu cuenta en Gratis y pides Pro desde «Mi plan»; se activa al confirmar tu pago.</p>
          </Aparece>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {gratis && (
            <Aparece como="article" retraso={80} className="flex flex-col rounded-xl bg-surface p-6 sm:p-7">
              <h3 className="text-2xl font-semibold">{gratis.nombre}</h3>
              {gratis.descripcion && <p className="mt-1 text-base text-muted">{gratis.descripcion}</p>}
              <div className="mt-6"><Precio plan={gratis} /></div>
              <Tope plan={gratis} className="mt-2" />
              <Lista plan={gratis} icono="text-brand" className="mt-6 space-y-2.5" />
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-8">
                <Accion abierto={abierto} texto="Crear cuenta gratis" className={`${boton} bg-brand text-on-brand hover:bg-brand-hover`} />
              </div>
            </Aparece>
          )}
          {adm && (
            <Aparece como="article" retraso={80} className="flex flex-col rounded-xl bg-surface p-6 sm:p-7">
              <h3 className="text-2xl font-semibold">{adm.nombre}</h3>
              {adm.descripcion && <p className="mt-1 text-base text-muted">{adm.descripcion}</p>}
              <div className="mt-6"><Precio plan={adm} /></div>
              <Tope plan={adm} className="mt-2" />
              <Lista plan={adm} icono="text-brand" className="mt-6 space-y-2.5" />
              <div className="mt-auto flex flex-wrap items-center gap-3 pt-8">
                {calcular('administradora', `${boton} bg-brand-soft text-brand hover:bg-surface2`)}
              </div>
            </Aparece>
          )}
        </div>
      </div>
    </section>
  );
}
