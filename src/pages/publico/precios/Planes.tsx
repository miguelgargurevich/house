import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckIcon } from '@heroicons/react/24/outline';
import { cx, dinero } from '../../../ui';
import { Aparece } from '../Aparece';
import type { Catalogo, Plan } from '../catalogo';

const boton = 'inline-flex h-12 w-full items-center justify-center whitespace-nowrap rounded px-6 text-base font-semibold transition-colors duration-150 active:scale-[0.98]';

/** Lo que trae un plan, tal como lo publica el catálogo. */
function Lista({ plan }: { plan: Plan }) {
  return (
    <ul className="space-y-2.5">
      {plan.caracteristicas.map(c => (
        <li key={c} className="flex items-start gap-2.5 text-base leading-snug">
          <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
          <span>{c}</span>
        </li>
      ))}
    </ul>
  );
}

/** «+ IGV» / «+ IVA»: el impuesto del país elegido; sin impuesto (tasa 0) no se menciona. */
const masImpuesto = (cat: Catalogo) => (Number(cat.impuesto.tasa) > 0 ? ` + ${cat.impuesto.nombre}` : '');

/** El precio grande y, debajo, su unidad (por departamento al mes, con el impuesto que diga el país). */
function Precio({ plan, cat, grande }: { plan: Plan; cat: Catalogo; grande?: boolean }) {
  // Un plan de pago sin precio en la moneda del país no se muestra con cifra: «Consúltanos».
  if (plan.precio_por_unidad === null) {
    return (
      <div>
        <p className={`font-semibold tracking-tight ${grande ? 'text-5xl sm:text-6xl' : 'text-4xl sm:text-5xl'}`}>Consúltanos</p>
        <p className="mt-2 text-base text-muted">el precio para tu país</p>
      </div>
    );
  }
  const gratis = Number(plan.precio_por_unidad) === 0;
  return (
    <div>
      <p className={`num font-semibold leading-none tracking-tight ${grande ? 'text-6xl sm:text-7xl' : 'text-5xl'}`}>{dinero(plan.precio_por_unidad, cat.moneda)}</p>
      <p className="mt-2 text-base text-muted">{gratis ? 'para siempre' : `por departamento al mes${masImpuesto(cat)}`}</p>
    </div>
  );
}

/** El tope de departamentos (Gratis) o el mínimo que se cobra (Pro y Administradora), tal como los publica el catálogo. */
function Tope({ plan, cat, className = '' }: { plan: Plan; cat: Catalogo; className?: string }) {
  if (plan.unidades_maximas != null) return <p className={`text-base font-medium ${className}`}>Hasta {plan.unidades_maximas} departamentos por condominio.</p>;
  if (plan.unidades_minimas != null) return <p className={`text-base font-medium ${className}`}>Mínimo de {plan.unidades_minimas} departamentos cobrados por condominio{plan.total_minimo_mes ? ` · desde ${dinero(plan.total_minimo_mes, cat.moneda)} al mes${masImpuesto(cat)}` : ''}.</p>;
  return null;
}

/** Enlace de cada plan: crear la cuenta si el registro está abierto; si no, lo que sí se puede hacer (ingresar). */
function Accion({ abierto, texto, className }: { abierto: boolean; texto: string; className: string }) {
  return abierto
    ? <Link to="/registro" className={className}>{texto}</Link>
    : <Link to="/login" className={className}>Ingresar</Link>;
}

/**
 * Una tarjeta por nivel: nombre, para quién es, precio, tope o mínimo, lo que trae y su botón (abajo, alineado con las demás).
 * La destacada lleva borde de marca y la etiqueta «Más elegido». Todo sale del catálogo.
 */
function Nivel({ plan, cat, destacado = false, retraso = 0, pie }: { plan: Plan; cat: Catalogo; destacado?: boolean; retraso?: number; pie: ReactNode }) {
  return (
    <Aparece como="article" retraso={retraso} className={cx('relative flex flex-col rounded-xl bg-surface p-6 sm:p-7', destacado ? 'border-2 border-brand' : 'border border-line')}>
      {destacado && <span className="absolute -top-3 left-6 rounded-full bg-brand px-3 py-1 text-sm font-semibold text-on-brand">Más elegido</span>}
      <h3 className="text-2xl font-semibold">{plan.nombre}</h3>
      {plan.descripcion && <p className="mt-1 text-base text-muted">{plan.descripcion}</p>}
      <div className="mt-6"><Precio plan={plan} cat={cat} grande={destacado} /></div>
      <Tope plan={plan} cat={cat} className="mt-3" />
      <div className="mt-6 border-t border-line pt-6"><Lista plan={plan} /></div>
      <div className="mt-auto flex flex-col gap-3 pt-8">{pie}</div>
    </Aparece>
  );
}

/**
 * Las tarjetas de nivel: Gratis, Pro (la recomendada, en medio y con borde de marca) y Administradora. Fila en escritorio y
 * apiladas en el celular. Nombres, precios y contenido salen del catálogo; «Ver mi total» lleva a la calculadora con ese plan.
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
      <h2 id="planes-titulo" className="text-center text-3xl font-semibold tracking-tight sm:text-4xl">Gratis con límite, o Pro con todo</h2>
      <div className="mt-10 grid items-stretch gap-5 lg:grid-cols-3 lg:gap-6">
        {gratis && (
          <Nivel plan={gratis} cat={cat} retraso={0} pie={
            <Accion abierto={abierto} texto="Crear cuenta gratis" className={`${boton} bg-surface2 text-ink hover:bg-brand-soft`} />
          } />
        )}
        {pro && (
          <Nivel plan={pro} cat={cat} destacado retraso={80} pie={<>
            <Accion abierto={abierto} texto="Empezar con Pro" className={`${boton} bg-brand text-on-brand hover:bg-brand-hover`} />
            {calcular('pro', 'inline-flex h-11 items-center justify-center text-base font-medium text-brand underline underline-offset-4 hover:text-brand-hover')}
          </>} />
        )}
        {adm && (
          <Nivel plan={adm} cat={cat} retraso={160} pie={
            calcular('administradora', `${boton} bg-surface2 text-ink hover:bg-brand-soft`)
          } />
        )}
      </div>
    </section>
  );
}
