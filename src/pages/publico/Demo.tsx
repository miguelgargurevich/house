import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { TARJETAS_DEMO, type RolDemo } from '../../app/demo/roles';
import { URL_DEMO, anotarEntrada, puedeSerDemo, useModoDemo } from '../../app/demo/useDemo';
import { Alert, Button, Skeleton } from '../../ui';
import { Marco } from './Marco';
import { ENTRADA_DEMO, vistaDeDemo } from './demo/logica';

/**
 * `/demo`: elegir un rol y entrar sin registrarse ni contraseña. En la instancia de demo es también la portada. En cualquier otra instancia (torrecondominios.com)
 * sólo explica qué es y lleva a la demo.
 */
export default function Demo() {
  const { demo, cargando, estado } = useModoDemo();
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [entrando, setEntrando] = useState<RolDemo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const vista = vistaDeDemo({ puedeSerDemo: typeof window !== 'undefined' && puedeSerDemo(window.location.hostname), cargando, demo });

  async function entrar(rol: RolDemo) {
    setError(null);
    setEntrando(rol);
    try {
      await api('/api/demo/entrar', { method: 'POST', json: { rol } });
      anotarEntrada(rol);
      await refresh();
      nav(ENTRADA_DEMO[rol], { replace: true });
    } catch (e) {
      setError(errorText(e));
      setEntrando(null);
    }
  }

  return (
    <Marco ancho="max-w-5xl">
      <header className="max-w-2xl">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-sm font-medium text-brand"><SparklesIcon className="h-4 w-4" aria-hidden="true" />Demo de Torre</p>
        <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Prueba Torre con datos de ejemplo</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Elige quién quieres ser y entra: sin registrarte y sin contraseña. Todo lo que ves es de ejemplo, no se envía ningún correo ni mensaje real y los datos se reinician cada noche.
        </p>
      </header>

      {vista === 'cargando' && (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      )}

      {vista === 'sin_demo' && (
        <section className="mt-10 rounded-xl bg-surface2 p-6 sm:p-8" aria-labelledby="demo-aqui">
          <h2 id="demo-aqui" className="text-xl font-semibold tracking-tight">La demo vive en su propia dirección</h2>
          <p className="mt-2 max-w-xl text-muted">Es una copia de Torre con un condominio de ejemplo: entras como administradora, tesorero, vecino y más, sin crear cuenta.</p>
          <a href={URL_DEMO} className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded bg-brand px-5 text-base font-semibold text-on-brand transition-colors duration-150 hover:bg-brand-hover">
            Abrir la demo <ArrowRightIcon className="h-5 w-5" aria-hidden="true" />
          </a>
        </section>
      )}

      {vista === 'tarjetas' && (
        <section className="mt-10" aria-labelledby="entrar-como">
          <h2 id="entrar-como" className="text-xl font-semibold tracking-tight">Entrar como…</h2>
          {estado?.reiniciando && <div className="mt-4"><Alert tone="warn">La demo se está reiniciando; en un minuto estará lista.</Alert></div>}
          {error && <div className="mt-4"><Alert tone="bad">{error}</Alert></div>}
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TARJETAS_DEMO.map((t) => (
              <li key={t.id} className="flex flex-col rounded-xl border border-line bg-surface p-5">
                <h3 className="text-lg font-semibold tracking-tight">{t.titulo}</h3>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-muted">{t.ve}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {t.roles.map((r) => (
                    <Button key={r.clave} loading={entrando === r.clave} disabled={entrando !== null} onClick={() => void entrar(r.clave)} icon={entrando === r.clave ? undefined : <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />}>
                      {t.roles.length > 1 ? r.titulo : 'Entrar'}
                    </Button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-muted">¿Quieres usar Torre con tu condominio? <a href="https://torrecondominios.com/registro" className="font-medium text-brand underline underline-offset-2">Crea tu cuenta gratis</a>: 3 meses sin costo.</p>
        </section>
      )}
    </Marco>
  );
}
