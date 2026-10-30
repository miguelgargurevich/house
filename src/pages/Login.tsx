import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { HOME, useAuth } from '../auth/AuthContext';
import { Alert, Button, Input } from '../ui';
import { api, ApiError, errorText } from '../api';
import PanelLogin from './_login/PanelLogin';

const DEMO = [
  ['Superadmin', 'miguel.gargurevich@admin.com', 'admin1234'],
  ['Administradora', 'ana.lopez@gestionurbana.com', 'admin1234'],
  ['Propietario', 'javier.castro@prop.com', 'prop1234'],
  ['Inquilino', 'valentina.ruiz@inq.com', 'inq1234'],
  ['Mantenimiento', 'maria.fernandez@gestionurbana.com', 'mtto1234'],
  ['Seguridad', 'pedro.sanchez@gestionurbana.com', 'seg1234'],
  ['Limpieza', 'limpieza@prueba.house', 'pers1234'],
  ['Tesorero', 'patricia.alarcon.9@prueba.house', 'prop1234'],
  ['Tesorero central', 'gustavo.cruz.4@prueba.house', 'prop1234'],
] as const;

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sinVerificar, setSinVerificar] = useState(false);
  const [reenviado, setReenviado] = useState(false);
  const [verClave, setVerClave] = useState(false);

  if (user) return <Navigate to={HOME[user.rol]} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSinVerificar(false);
    setReenviado(false);
    setBusy(true);
    try {
      const u = await login(email.trim(), password);
      nav(HOME[u.rol], { replace: true });
    } catch (err) {
      setError(errorText(err));
      setSinVerificar(err instanceof ApiError && err.code === 'CORREO_NO_VERIFICADO');
    } finally { setBusy(false); }
  }

  async function reenviar() {
    try {
      await api('/api/publico/reenviar-verificacion', { method: 'POST', json: { email: email.trim() } });
      setReenviado(true);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 font-semibold tracking-tight">
            <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
              <rect width="32" height="32" rx="8" className="fill-brand" />
              <path d="M9 24V12.5L16 8l7 4.5V24M13.5 24v-5h5v5" fill="none" className="stroke-on-brand" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <span className="text-xl">House</span>
          </div>
          <h1 className="text-2xl font-semibold">Ingresa a tu cuenta</h1>
          <p className="mt-1 text-sm text-muted">Recibos, pagos y mantenimiento de tu condominio.</p>

          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            {error && <Alert tone="bad">{error}</Alert>}
            {sinVerificar && (reenviado
              ? <Alert tone="ok">Listo: si tu cuenta está pendiente, te enviamos un enlace nuevo. Revisa tu correo.</Alert>
              : <Button variant="secondary" className="w-full" onClick={() => void reenviar()}>Reenviarme el enlace de confirmación</Button>)}
            <Input label="Correo electrónico" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
            <div className="relative">
              <Input label="Contraseña" type={verClave ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} className="[&_input]:pr-11" />
              <button
                type="button"
                onClick={() => setVerClave(v => !v)}
                aria-label={verClave ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={verClave}
                className="absolute bottom-0 right-0 flex h-10 w-11 items-center justify-center rounded-r text-muted transition-colors duration-150 hover:text-ink"
              >
                {verClave ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
              </button>
            </div>
            <Button type="submit" loading={busy} className="w-full" disabled={!email || !password}>Ingresar</Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">¿Primera vez? <Link to="/registro" className="font-medium text-brand underline">Crea tu cuenta gratis</Link> · <Link to="/precios" className="font-medium text-brand underline">Ver precios</Link></p>
          <p className="mt-4 text-center text-xs text-muted">Lee nuestros <Link to="/terminos" className="font-medium text-brand underline">Términos</Link> y nuestra <Link to="/privacidad" className="font-medium text-brand underline">Política de privacidad</Link>.</p>

          {import.meta.env.DEV && (
            <div className="mt-8 border-t border-line pt-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Cuentas de prueba (solo desarrollo)</p>
              <div className="flex flex-wrap gap-2">
                {DEMO.map(([n, e, p]) => (
                  <button key={n} type="button" onClick={() => { setEmail(e); setPassword(p); }} className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors duration-150 hover:border-brand hover:text-brand">
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      <PanelLogin />
    </div>
  );
}
