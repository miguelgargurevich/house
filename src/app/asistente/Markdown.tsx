import type { MouseEvent, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { clasificarEnlace } from './enlaces';

interface Props {
  texto: string;
  /** Navega dentro de la app (el router, sin recargar). */
  onNavegar: (ruta: string) => void;
}

const sinModificadores = (e: MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

/**
 * Markdown SEGURO de las respuestas: sin HTML crudo, sin imágenes y con enlaces filtrados (`enlaces.ts`): las rutas internas navegan
 * con el router; los `https` abren en otra pestaña con `rel="noopener noreferrer"`; cualquier otro esquema se descarta y queda el texto.
 */
export function Markdown({ texto, onNavegar }: Props) {
  const titulo = ({ children }: { children?: ReactNode }) => <p className="font-semibold">{children}</p>;
  return (
    <div className="break-words text-sm [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-surface2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_li]:mt-1 [&_ol]:ml-5 [&_ol]:list-decimal [&_p+*]:mt-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-surface2 [&_pre]:p-3 [&_strong]:font-semibold [&_ul]:ml-5 [&_ul]:list-disc">
      <ReactMarkdown
        skipHtml
        urlTransform={(url) => (clasificarEnlace(url).tipo === 'descartado' ? '' : url)}
        components={{
          a: ({ href, children }) => {
            const e = clasificarEnlace(href);
            if (e.tipo === 'interno') {
              return <a href={e.ruta} onClick={(ev) => { if (sinModificadores(ev)) { ev.preventDefault(); onNavegar(e.ruta); } }}>{children}</a>;
            }
            if (e.tipo === 'externo') return <a href={e.url} target="_blank" rel="noopener noreferrer">{children}</a>;
            return <span>{children}</span>;
          },
          img: () => null,
          h1: titulo, h2: titulo, h3: titulo, h4: titulo, h5: titulo, h6: titulo,
        }}
      >
        {texto}
      </ReactMarkdown>
    </div>
  );
}
