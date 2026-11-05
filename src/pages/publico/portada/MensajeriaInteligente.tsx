/** @jsxRuntime automatic */
import { AdjustmentsHorizontalIcon, ClockIcon, UserGroupIcon } from '@heroicons/react/24/outline';
import { Aparece } from '../Aparece';

/**
 * Los textos de la sección. Viven aquí (y no en `lib/seo/textos`) porque la sección sólo existe en la portada que pinta el navegador.
 * Lo que se promete es menos mensajes, un solo mensaje por block y el número cuidado; nada sobre montos.
 */
export const MENSAJERIA = {
  titulo: 'Mensajería inteligente',
  bajada: 'Lo general, al grupo de cada block; lo personal, directo al vecino. Menos mensajes, nadie silencia a la administración y tu número corre menos riesgo de bloqueo.',
  ejemplo: { directo: 'Directo a cada departamento', grupos: 'Un grupo por block', pie: 'Un condominio de 14 blocks y 448 departamentos: el recibo del mes son 14 mensajes, no 448.' },
  puntos: [
    { icono: UserGroupIcon, titulo: 'Un grupo por block', texto: 'Cada block tiene su grupo de WhatsApp. Su recibo y sus comunicados salen una sola vez, al grupo.' },
    { icono: AdjustmentsHorizontalIcon, titulo: 'Tú eliges qué avisos van por WhatsApp', texto: 'Cada condominio decide qué tipos de aviso salen por WhatsApp y cuáles sólo por correo.' },
    { icono: ClockIcon, titulo: 'Tope diario y pausas', texto: 'Un tope por día para cuidar tu número y pausas entre cada envío.' },
  ],
} as const;

const titulo = 'text-[clamp(2rem,4.4vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.03em]';

/** Cuántos departamentos y blocks tiene el ejemplo: 448 puntos contra 14. Son la misma cuenta que el pie dice con palabras. */
const DEPARTAMENTOS = 448;
const BLOCKS = 14;

/**
 * La sección «Mensajería inteligente» de la portada: el mismo condominio de ejemplo con sus mensajes uno a uno (448 puntos) y con un grupo por block
 * (14 puntos). Los puntos son decorativos; las cifras van escritas en el texto.
 */
export function MensajeriaInteligente() {
  return (
    <section aria-labelledby="mensajeria-titulo" className="mx-auto w-full max-w-6xl px-4 py-24 sm:px-6 lg:py-36">
      <Aparece>
        <h2 id="mensajeria-titulo" className={titulo}>{MENSAJERIA.titulo}</h2>
        <p className="mt-6 max-w-[36rem] text-lg leading-relaxed">{MENSAJERIA.bajada}</p>
      </Aparece>

      <Aparece retraso={90} className="mt-14 grid gap-12 lg:grid-cols-2 lg:gap-16">
        <figure className="min-w-0">
          <figcaption className="flex items-baseline justify-between gap-4">
            <span className="text-sm font-medium text-muted">{MENSAJERIA.ejemplo.directo}</span>
            <span className="num text-3xl font-semibold tracking-[-0.02em]">{DEPARTAMENTOS}</span>
          </figcaption>
          <div aria-hidden="true" className="mt-4 grid grid-cols-[repeat(28,minmax(0,1fr))] gap-[3px]">
            {Array.from({ length: DEPARTAMENTOS }, (_, i) => <span key={i} className="aspect-square rounded-[2px] bg-line" />)}
          </div>
        </figure>

        <figure className="min-w-0">
          <figcaption className="flex items-baseline justify-between gap-4">
            <span className="text-sm font-medium text-muted">{MENSAJERIA.ejemplo.grupos}</span>
            <span className="num text-3xl font-semibold tracking-[-0.02em] text-brand">{BLOCKS}</span>
          </figcaption>
          <div aria-hidden="true" className="mt-4 grid max-w-[16rem] grid-cols-7 gap-3">
            {Array.from({ length: BLOCKS }, (_, i) => <span key={i} className="aspect-square rounded-md bg-brand" />)}
          </div>
        </figure>
      </Aparece>

      <Aparece retraso={120}>
        <p className="mt-8 max-w-[40rem] text-base font-medium leading-relaxed sm:text-lg">{MENSAJERIA.ejemplo.pie}</p>
      </Aparece>

      <ul className="mt-14 grid gap-10 sm:grid-cols-3 sm:gap-8">
        {MENSAJERIA.puntos.map((p, i) => (
          <Aparece como="li" key={p.titulo} retraso={i * 90}>
            <p.icono className="h-7 w-7 text-brand" aria-hidden="true" />
            <h3 className="mt-4 text-lg font-semibold leading-snug">{p.titulo}</h3>
            <p className="mt-2 text-base leading-relaxed text-muted">{p.texto}</p>
          </Aparece>
        ))}
      </ul>
    </section>
  );
}
