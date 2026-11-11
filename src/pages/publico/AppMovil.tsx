import type { ReactNode } from 'react';
import { ArrowDownTrayIcon, DevicePhoneMobileIcon } from '@heroicons/react/24/outline';
import { useCatalogo } from './catalogo';
import { Marco } from './Marco';
import { APP_MOVIL } from './appMovil/textos';
import { muestraBloques, ofreceDescarga } from './appMovil/logica';

const pasos = (lista: readonly { clausula: string; texto: string }[]) => (
  <ol className="mt-5 space-y-4">
    {lista.map((p, i) => (
      <li key={p.clausula} className="flex gap-3">
        <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand">{i + 1}</span>
        <div>
          <p className="font-medium text-ink">{p.clausula}</p>
          <p className="mt-0.5 text-sm leading-relaxed text-muted">{p.texto}</p>
        </div>
      </li>
    ))}
  </ol>
);

function Tarjeta({ titulo, id, children }: { titulo: string; id: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl bg-surface2 p-6 sm:p-8">
      <h2 id={id} className="flex items-center gap-3 text-xl font-semibold tracking-tight">
        <DevicePhoneMobileIcon className="h-6 w-6 text-brand" aria-hidden="true" />{titulo}
      </h2>
      {children}
    </section>
  );
}

/**
 * «Torre en tu celular» (`/app`): descarga directa del APK de Android (la dirección y la versión vienen de la configuración) y la instalación desde Safari
 * para el iPhone. Dentro de la app de Torre no se ofrece nada de eso: ya está instalada.
 */
export default function AppMovil() {
  const { data: cat } = useCatalogo();
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const android = cat?.app?.android ?? null;
  const descarga = ofreceDescarga(android, userAgent);
  const bloques = muestraBloques(userAgent);
  const a = APP_MOVIL.android;
  const i = APP_MOVIL.iphone;

  return (
    <Marco ancho="max-w-3xl">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{APP_MOVIL.h1}</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">{APP_MOVIL.bajada}</p>
      </header>

      {!bloques ? (
        <p className="mt-10 rounded-xl bg-surface2 p-6 text-lg font-medium">{APP_MOVIL.dentro}</p>
      ) : (
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {descarga && android && (
            <Tarjeta titulo={a.titulo} id="android-titulo">
              {android.version && <p className="mt-2 text-sm text-muted">{a.version(android.version)}</p>}
              <a href={android.url} download className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded bg-brand px-6 text-base font-semibold text-on-brand transition-colors duration-150 hover:bg-brand-hover active:scale-[0.98]">
                <ArrowDownTrayIcon className="h-5 w-5" aria-hidden="true" />{a.boton}
              </a>
              {pasos(a.pasos)}
              <p className="mt-6 rounded-lg bg-surface px-4 py-3 text-sm leading-relaxed text-muted">{a.nota}</p>
            </Tarjeta>
          )}
          <Tarjeta titulo={i.titulo} id="iphone-titulo">
            <p className="mt-2 text-base font-medium">{i.texto}</p>
            {pasos(i.pasos)}
            <p className="mt-6 rounded-lg bg-surface px-4 py-3 text-sm leading-relaxed text-muted">{i.nota}</p>
          </Tarjeta>
        </div>
      )}
    </Marco>
  );
}
