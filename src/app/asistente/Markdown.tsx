import { Children, isValidElement, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { CheckIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import ReactMarkdown from 'react-markdown';
import { clasificarEnlace } from './enlaces';

interface Props {
  texto: string;
  /** Navega dentro de la app (el router, sin recargar). */
  onNavegar: (ruta: string) => void;
  /** Copia al portapapeles (el panel avisa si falla); resuelve `true` si copió. */
  onCopiar: (texto: string) => Promise<boolean>;
}

/** Texto plano de lo que renderizó react-markdown dentro de un bloque de código. */
export function textoDe(nodo: ReactNode): string {
  if (typeof nodo === 'string' || typeof nodo === 'number') return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join('');
  if (isValidElement(nodo)) return textoDe((nodo as ReactElement<{ children?: ReactNode }>).props.children);
  return '';
}

/** Bloque de código con su barra: lenguaje a la izquierda y «Copiar» (2 s en «Copiado») a la derecha. */
function BloqueCodigo({ children, onCopiar }: { children?: ReactNode; onCopiar: (t: string) => Promise<boolean> }) {
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(temporizador.current), []);
  const hijo = Children.toArray(children)[0];
  const clase = isValidElement(hijo) ? String((hijo as ReactElement<{ className?: string }>).props.className ?? '') : '';
  const lenguaje = /language-([\w-]+)/.exec(clase)?.[1] ?? 'código';
  const texto = textoDe(children).replace(/\n$/, '');
  return (
    <div className="overflow-hidden rounded bg-surface2">
      <div className="flex items-center justify-between border-b border-line pl-3 text-xs text-muted">
        <span>{lenguaje}</span>
        <button
          type="button"
          onClick={() => { void onCopiar(texto).then((ok) => { if (ok) { setCopiado(true); clearTimeout(temporizador.current); temporizador.current = setTimeout(() => setCopiado(false), 2000); } }); }}
          aria-label={copiado ? 'Copiado' : 'Copiar código'}
          className="inline-flex h-11 items-center gap-1.5 px-3 font-medium transition-colors duration-150 hover:bg-line/40 hover:text-ink"
        >
          {copiado ? <CheckIcon className="h-4 w-4 text-ok" aria-hidden="true" /> : <ClipboardDocumentIcon className="h-4 w-4" aria-hidden="true" />}
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 [&>code]:!bg-transparent [&>code]:!p-0">{children}</pre>
    </div>
  );
}

const sinModificadores = (e: MouseEvent) => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

/**
 * Markdown SEGURO de las respuestas: sin HTML crudo, sin imágenes y con enlaces filtrados (`enlaces.ts`): las rutas internas navegan
 * con el router; los `https` abren en otra pestaña con `rel="noopener noreferrer"`; cualquier otro esquema se descarta y queda el texto.
 */
export function Markdown({ texto, onNavegar, onCopiar }: Props) {
  const titulo = ({ children }: { children?: ReactNode }) => <p className="font-semibold">{children}</p>;
  return (
    <div className="select-text break-words text-sm [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-surface2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_li]:mt-1 [&_ol]:ml-5 [&_ol]:list-decimal [&>*+*]:mt-2 [&_strong]:font-semibold [&_ul]:ml-5 [&_ul]:list-disc">
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
          pre: ({ children }) => <BloqueCodigo onCopiar={onCopiar}>{children}</BloqueCodigo>,
          h1: titulo, h2: titulo, h3: titulo, h4: titulo, h5: titulo, h6: titulo,
        }}
      >
        {texto}
      </ReactMarkdown>
    </div>
  );
}
