import { Link } from 'react-router-dom';
import { PlusIcon } from '@heroicons/react/24/outline';
import { PORTADA, cierrePrecios, preguntasPortada } from '../../lib/seo/textos';
import { Aparece } from './Aparece';
import { CONTACTO } from './contacto/textos';
import { useCatalogo } from './catalogo';
import { Marco } from './Marco';
import { Fachada, TECHO, Techito } from './portada/Fachada';
import { Juntas } from './portada/Juntas';
import { MensajeriaInteligente } from './portada/MensajeriaInteligente';
import { Pasos } from './portada/Pasos';
import { PreciosVivos } from './portada/PreciosVivos';

const boton = 'inline-flex h-12 items-center justify-center whitespace-nowrap rounded px-6 text-base font-semibold transition-colors duration-150 active:scale-[0.98]';
const titulo = 'text-[clamp(2rem,4.4vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.03em]';
const sube = (n: number) => ({ animationDelay: `${n * 80}ms` });

/**
 * Portada (landing) para quien llega sin sesión. Un solo motivo, la fachada del logo con una ventana por departamento: enorme en el hero,
 * de máscara en cada captura y de viñeta en las listas. Las capturas son de la app con los datos de prueba del seed.
 * Los textos viven en `lib/seo/textos` (los comparte el HTML estático que ven los buscadores).
 */
export default function Portada() {
  const { data: cat } = useCatalogo();
  const abierto = cat?.registro_abierto !== false;
  const cierre = cierrePrecios(abierto);
  const faq = preguntasPortada(cat ?? null);

  return (
    <Marco completo ancho="max-w-6xl">
      {/* Hero: el título sobre el fondo limpio y la fachada enorme, recortada por la derecha (en celular, por abajo). */}
      <section className="relative min-h-[calc(100svh-4rem)] overflow-hidden">
        <Fachada className="absolute left-1/2 top-[60svh] w-[min(130vw,46rem)] -translate-x-1/2 lg:left-auto lg:right-[-6vw] lg:top-[4%] lg:h-[118%] lg:w-auto lg:translate-x-0" />
        <div className="relative mx-auto w-full max-w-6xl px-4 pt-[12svh] sm:px-6 lg:flex lg:min-h-[calc(100svh-4rem)] lg:items-center lg:pt-0">
          <div className="lg:max-w-[56%]">
            <h1 style={sube(0)} className="sube max-w-[11em] text-[clamp(2.6rem,11vw,5.25rem)] font-semibold leading-[0.98] tracking-[-0.035em] lg:text-[clamp(3rem,5.4vw,5.25rem)]">{PORTADA.h1}</h1>
            <p style={sube(1)} className="sube mt-6 max-w-[34rem] text-base leading-relaxed sm:text-xl">{PORTADA.bajada}</p>
            <div style={sube(2)} className="sube mt-8 flex flex-wrap gap-3">
              {abierto && <Link to="/registro" className={`${boton} bg-brand text-on-brand hover:bg-brand-hover`}>{PORTADA.botones.registro}</Link>}
              <Link to="/precios" className={`${boton} bg-surface2 hover:bg-line`}>{PORTADA.botones.precios}</Link>
              <Link to={CONTACTO.enlace_demo} className={`${boton} border border-line hover:bg-surface2`}>{CONTACTO.cta_demo}</Link>
            </div>
          </div>
        </div>
      </section>

      {/* Qué hace: una frase con pedacitos de la interfaz entre las palabras. */}
      <section aria-labelledby="enunciado-titulo" className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 lg:py-36">
        <h2 id="enunciado-titulo" className="sr-only">{PORTADA.enunciado.titulo}</h2>
        <Aparece como="p" className="max-w-[30em] text-[clamp(1.5rem,2.6vw,2.25rem)] font-medium leading-[1.3] tracking-[-0.015em]">
          {PORTADA.enunciado.tramos.map((t, i) => (
            <span key={t.ficha}>
              {i > 0 && ' '}{t.texto}{' '}
              <span className="whitespace-nowrap"><span data-ui aria-hidden="true" className="relative top-[-0.08em] inline-flex h-[1.15em] items-center gap-[0.3em] whitespace-nowrap rounded-full bg-brand-soft px-[0.5em] align-middle text-[0.62em] font-semibold text-brand">
                <span className="h-[0.45em] w-[0.45em] rounded-full bg-brand" />{t.ficha}
              </span>{i === PORTADA.enunciado.tramos.length - 1 && PORTADA.enunciado.cierre}</span>
            </span>
          ))}
        </Aparece>
      </section>

      <Pasos />
      <Juntas />
      <MensajeriaInteligente />

      {/* Una pantalla para cada quien: cada rol con su captura, recortada con el techo de la fachada. */}
      <section aria-labelledby="roles-titulo" className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 lg:py-36">
        <Aparece>
          <h2 id="roles-titulo" className={titulo}>{PORTADA.roles.titulo}</h2>
          <p className="mt-6 max-w-[36rem] text-lg leading-relaxed">{PORTADA.roles.bajada}</p>
        </Aparece>
        <ul className="mt-16 space-y-20 lg:space-y-28">
          {PORTADA.roles.lista.map((r, i) => (
            <li key={r.nombre} className="grid items-center gap-8 lg:grid-cols-12">
              <Aparece className={i % 2 ? 'lg:order-2 lg:col-span-4 lg:col-start-9' : 'lg:col-span-4'}>
                <h3 className="flex items-center gap-3 text-[clamp(1.5rem,2.6vw,2.25rem)] font-semibold leading-tight tracking-[-0.02em]"><Techito className="h-[0.55em] w-[0.55em] text-brand" />{r.nombre}</h3>
                <p className="mt-4 text-lg leading-relaxed">{r.texto}</p>
              </Aparece>
              <Aparece retraso={90} className={i % 2 ? 'lg:order-1 lg:col-span-8' : 'lg:col-span-8 lg:col-start-5'}>
                <div className="flex justify-center bg-brand-soft px-5 pt-10 sm:px-10 sm:pt-14" style={{ clipPath: TECHO }}>
                  <img src={r.imagen} alt={r.alt} loading="lazy" width={r.celular ? 600 : 1600} height={r.celular ? 1298 : 1000}
                    className={r.celular ? 'h-auto w-[62%] max-w-[18rem]' : 'h-auto w-full'} />
                </div>
              </Aparece>
            </li>
          ))}
        </ul>
      </section>

      {cat && <div className="bg-surface2"><PreciosVivos cat={cat} abierto={abierto} /></div>}

      {/* Preguntas: el título se queda mientras pasa la lista; una abierta a la vez. */}
      <section aria-labelledby="faq-titulo" className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-24 sm:px-6 lg:grid-cols-12 lg:py-36">
        <h2 id="faq-titulo" className={`${titulo} lg:sticky lg:top-24 lg:col-span-5 lg:self-start`}>{PORTADA.preguntas.titulo}</h2>
        <div className="space-y-2 lg:col-span-7">
          {faq.map(({ p, r }) => (
            <details key={p} name="faq-portada" className="group rounded-lg bg-surface2 transition-colors duration-200 open:bg-brand open:text-on-brand">
              <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-lg font-medium sm:px-6 [&::-webkit-details-marker]:hidden">
                {p}<PlusIcon className="h-5 w-5 shrink-0 transition-transform duration-200 group-open:rotate-45" aria-hidden="true" />
              </summary>
              <p className="max-w-[52ch] px-5 pb-6 text-base leading-relaxed sm:px-6 sm:text-lg">{r}</p>
            </details>
          ))}
        </div>
      </section>

      <section aria-labelledby="cierre-titulo" className="relative overflow-hidden bg-brand text-on-brand">
        <Aparece className="relative mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <h2 id="cierre-titulo" className={`max-w-3xl ${titulo}`}>{cierre.h2}</h2>
          <p className="mt-6 max-w-xl text-lg sm:text-xl">{cierre.texto}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link to={abierto ? '/registro' : '/login'} className={`${boton} bg-on-brand text-brand hover:opacity-90`}>{abierto ? PORTADA.botones.registro : 'Ingresar'}</Link>
            <Link to={CONTACTO.enlace_demo} className={`${boton} border border-on-brand/60 text-on-brand hover:bg-on-brand/10`}>{CONTACTO.cta_demo}</Link>
          </div>
        </Aparece>
      </section>
    </Marco>
  );
}
