import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircleIcon, EnvelopeIcon } from '@heroicons/react/24/outline';
import { Alert, Card, CardBody } from '../../ui';
import { ELIMINAR_CUENTA as T } from './eliminarCuenta/textos';
import { Marco } from './Marco';

const lista = 'mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed';

/**
 * «Eliminar tu cuenta de Torre» (`/eliminar-cuenta`): pública, sin sesión. Es la dirección que Google Play pide para explicar cómo se elimina la cuenta
 * y qué datos se borran o se conservan. Con `?eliminada=1` (a donde lleva Mi perfil tras eliminar) muestra además el aviso «Tu cuenta fue eliminada».
 */
export default function EliminarCuenta() {
  const [params] = useSearchParams();
  const eliminada = params.get('eliminada') === '1';
  useEffect(() => {
    const anterior = document.title;
    document.title = `${T.titulo} | Torre`;
    return () => { document.title = anterior; };
  }, []);
  return (
    <Marco ancho="max-w-3xl">
      <article className="min-w-0">
        {eliminada && (
          <div className="mb-6">
            <Alert tone="ok">
              <p className="flex items-center gap-2 font-medium"><CheckCircleIcon className="h-5 w-5 shrink-0" aria-hidden="true" />{T.eliminada_titulo}</p>
              <p className="mt-1">{T.eliminada}</p>
            </Alert>
          </div>
        )}
        <h1 className="text-2xl font-semibold sm:text-3xl">{T.titulo}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{T.bajada}</p>

        <section aria-labelledby="ec-pasos" className="mt-8">
          <h2 id="ec-pasos" className="text-lg font-semibold">{T.pasos_titulo}</h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed">{T.pasos.map(p => <li key={p}>{p}</li>)}</ol>
        </section>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <section aria-labelledby="ec-borra">
            <Card><CardBody>
              <h2 id="ec-borra" className="text-base font-semibold">{T.se_borra_titulo}</h2>
              <ul className={lista}>{T.se_borra.map(t => <li key={t}>{t}</li>)}</ul>
            </CardBody></Card>
          </section>
          <section aria-labelledby="ec-conserva">
            <Card><CardBody>
              <h2 id="ec-conserva" className="text-base font-semibold">{T.se_conserva_titulo}</h2>
              <ul className={lista}>{T.se_conserva.map(t => <li key={t}>{t}</li>)}</ul>
            </CardBody></Card>
          </section>
        </div>
        <p className="mt-4 text-sm text-muted">{T.libre}</p>
        <p className="mt-2 text-sm text-muted">Más detalle en la <Link to="/privacidad#derechos" className="font-medium text-brand underline">Política de privacidad</Link>.</p>

        <section aria-labelledby="ec-unica" className="mt-8 border-t border-line pt-6">
          <h2 id="ec-unica" className="text-lg font-semibold">{T.unica_titulo}</h2>
          <p className="mt-2 text-sm leading-relaxed">{T.unica}</p>
        </section>

        <section aria-labelledby="ec-sin-acceso" className="mt-8 border-t border-line pt-6">
          <h2 id="ec-sin-acceso" className="text-lg font-semibold">{T.sin_acceso_titulo}</h2>
          <p className="mt-2 text-sm leading-relaxed">{T.sin_acceso}</p>
          <p className="mt-4">
            <Link to={T.enlace_contacto} className="inline-flex h-11 items-center gap-2 rounded bg-brand px-5 text-sm font-semibold text-on-brand transition-colors duration-150 hover:bg-brand-hover">
              <EnvelopeIcon className="h-5 w-5" aria-hidden="true" />{T.sin_acceso_enlace}
            </Link>
          </p>
        </section>
      </article>
    </Marco>
  );
}
