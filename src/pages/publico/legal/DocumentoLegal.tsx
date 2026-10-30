import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Marco } from '../Marco';
import { VERSION_LEGAL } from './version';
import type { Seccion } from './piezas';

/** Página legal: título, versión, índice de secciones y el texto. Lectura cómoda a 375 px y en modo oscuro (sólo tokens). */
export function DocumentoLegal({ titulo, intro, secciones }: { titulo: string; intro: ReactNode; secciones: Seccion[] }) {
  return (
    <Marco ancho="max-w-3xl">
      <article className="min-w-0">
        <h1 className="text-2xl font-semibold sm:text-3xl">{titulo}</h1>
        <p className="mt-2 text-xs text-muted">Versión: <span className="num">{VERSION_LEGAL}</span> · Borrador sujeto a revisión legal</p>
        {intro && <div className="mt-6 space-y-3 text-sm leading-relaxed">{intro}</div>}

        <nav aria-label="Contenido" className="mt-8 rounded-lg border border-line bg-surface2 p-4 text-sm">
          <p className="font-medium">Contenido</p>
          <ol className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {secciones.map(s => (
              <li key={s.id}><a href={`#${s.id}`} className="text-brand underline-offset-2 hover:underline">{s.titulo}</a></li>
            ))}
          </ol>
        </nav>

        {secciones.map(s => (
          <section key={s.id} id={s.id} className="scroll-mt-20 mt-8 border-t border-line pt-6">
            <h2 className="text-lg font-semibold">{s.titulo}</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">{s.cuerpo}</div>
          </section>
        ))}

        <p className="mt-10 border-t border-line pt-6 text-sm"><Link to="/" className="font-medium text-brand underline">Volver al inicio</Link></p>
      </article>
    </Marco>
  );
}
