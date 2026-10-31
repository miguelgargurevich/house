import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircleIcon, ExclamationTriangleIcon, MinusCircleIcon } from '@heroicons/react/24/outline';
import { api, ApiError, errorText } from '../../api';
import { HOME, useAuth } from '../../auth/AuthContext';
import type { Rol } from '../../auth/AuthContext';
import { Alert, Button, Card, CardBody, Input, Spinner } from '../../ui';
import { claveLista, CLAVE_MAX, reglasClave } from './_parts/clave';
import { Logo } from './Marco';

interface DatosInvitacion { nombre: string; email: string; rol: Rol; rol_texto: string; organizacion: string | null }

/** Destino del enlace del correo de invitación: quien lo abre crea su contraseña y entra. El enlace sirve una sola vez. */
export default function Invitacion() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [datos, setDatos] = useState<DatosInvitacion | null>(null);
  const [cargando, setCargando] = useState(Boolean(token));
  const [invalido, setInvalido] = useState(token ? '' : 'El enlace está incompleto. Abre el que te enviamos por correo.');
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pedido = useRef(false);

  // Se pide una sola vez aunque React monte el efecto dos veces.
  useEffect(() => {
    if (!token || pedido.current) return;
    pedido.current = true;
    api<DatosInvitacion>(`/api/auth/invitacion?token=${encodeURIComponent(token)}`)
      .then(setDatos)
      .catch(e => setInvalido(errorText(e)))
      .finally(() => setCargando(false));
  }, [token]);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!claveLista(clave, repetida)) return;
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ user: { rol: Rol } }>('/api/auth/invitacion', { method: 'POST', json: { token, password: clave } });
      await refresh(); // la respuesta ya dejó la sesión en la cookie: se lee igual que al abrir la app
      nav(HOME[r.user.rol], { replace: true });
    } catch (err) {
      // 410: el enlace se gastó o venció mientras escribía; con 422 (contraseña rechazada) puede corregirla y reintentar.
      if (err instanceof ApiError && err.status === 410) { setDatos(null); setInvalido(err.message); } else setError(errorText(err));
    } finally { setBusy(false); }
  }

  const reglas = reglasClave(clave, repetida);
  const donde = datos?.organizacion ? ` de ${datos.organizacion}` : '';

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-bg px-4 py-10 text-ink">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <Card>
          <CardBody>
            {cargando && <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted" role="status"><Spinner />Revisando tu invitación…</p>}

            {!cargando && !datos && (
              <div className="text-center" aria-live="polite">
                <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-warn" aria-hidden="true" />
                <h1 className="mt-3 text-xl font-semibold">Este enlace ya no sirve</h1>
                <p className="mt-2 text-sm text-muted">{invalido}</p>
                <p className="mt-6 text-sm">Si ya creaste tu contraseña, <Link to="/login" className="font-medium text-brand underline">ingresa aquí</Link>.</p>
              </div>
            )}

            {!cargando && datos && (
              <form onSubmit={enviar} noValidate>
                <h1 className="text-2xl font-semibold">Crea tu contraseña</h1>
                <p className="mt-2 text-sm text-muted">
                  Hola, <span className="font-medium text-ink">{datos.nombre}</span>. Te dieron acceso a Torre como {datos.rol_texto}{donde}. Tu cuenta es <span className="font-medium text-ink">{datos.email}</span>.
                </p>

                <div className="mt-6 space-y-4">
                  {error && <Alert tone="bad">{error}</Alert>}
                  <Input label="Contraseña" type="password" autoComplete="new-password" maxLength={CLAVE_MAX} required autoFocus value={clave} onChange={e => setClave(e.target.value)} />
                  <Input label="Repite la contraseña" type="password" autoComplete="new-password" maxLength={CLAVE_MAX} required value={repetida} onChange={e => setRepetida(e.target.value)} />
                  <ul className="space-y-1.5 text-sm" aria-label="Reglas de la contraseña">
                    {reglas.map(r => (
                      <li key={r.texto} className={r.ok ? 'flex items-center gap-2 text-ok' : 'flex items-center gap-2 text-muted'}>
                        {r.ok ? <CheckCircleIcon className="h-4 w-4 shrink-0" aria-hidden="true" /> : <MinusCircleIcon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                        <span>{r.texto}<span className="sr-only">{r.ok ? ': cumplida' : ': pendiente'}</span></span>
                      </li>
                    ))}
                  </ul>
                  <Button type="submit" loading={busy} className="w-full" disabled={!claveLista(clave, repetida)}>Crear contraseña y entrar</Button>
                </div>
                <p className="mt-4 text-xs text-muted">No uses tu correo como contraseña. Este enlace sirve una sola vez.</p>
                <p className="mt-2 text-xs text-muted">Al activar tu cuenta aceptas los <Link to="/terminos" className="font-medium text-brand underline">Términos</Link> y la <Link to="/privacidad" className="font-medium text-brand underline">Política de privacidad</Link>.</p>
              </form>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
