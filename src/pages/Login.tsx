import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ReceiptPercentIcon, SparklesIcon, BanknotesIcon } from '@heroicons/react/24/outline';
import { HOME, useAuth } from '../auth/AuthContext';
import { Alert, Button, Input } from '../ui';
import { api, ApiError, errorText } from '../api';

const DEMO = [
  ['Superadmin', 'miguel.gargurevich@admin.com', 'admin1234'],
  ['Administradora', 'ana.lopez@gestionurbana.com', 'admin1234'],
  ['Propietario', 'javier.castro@prop.com', 'prop1234'],
  ['Inquilino', 'valentina.ruiz@inq.com', 'inq1234'],
  ['Mantenimiento', 'maria.fernandez@gestionurbana.com', 'mtto1234'],
  ['Seguridad', 'pedro.sanchez@gestionurbana.com', 'seg1234'],
  ['Limpieza', 'limpieza@prueba.house', 'pers1234'],
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
            <Input label="Contraseña" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
            <Button type="submit" loading={busy} className="w-full" disabled={!email || !password}>Ingresar</Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted">¿Primera vez? <Link to="/registro" className="font-medium text-brand underline">Crea tu cuenta gratis</Link> · <Link to="/precios" className="font-medium text-brand underline">Ver precios</Link></p>

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

      <aside className="relative hidden overflow-hidden bg-brand text-on-brand lg:flex lg:items-center lg:justify-center lg:p-16" aria-hidden="true">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full border border-on-brand/15" />
        <div className="absolute -bottom-32 -left-16 h-[28rem] w-[28rem] rounded-full border border-on-brand/15" />
        <div className="relative max-w-md">
          <p className="text-3xl font-semibold leading-tight">Cobra a tiempo y que cada vecino sepa qué debe.</p>
          <ul className="mt-10 space-y-6 text-sm">
            {[
              [ReceiptPercentIcon, 'Recibos por concepto', 'Cuotas, agua, mantenimiento y recargos por unidad, en soles.'],
              [BanknotesIcon, 'Pagos y morosidad', 'Estados claros, comprobantes y seguimiento de lo vencido.'],
              [SparklesIcon, 'Asistente integrado', 'Resuelve dudas sobre recibos y trámites sin llamar a nadie.'],
            ].map(([Icon, t, d]) => {
              const I = Icon as typeof ReceiptPercentIcon;
              return (
                <li key={t as string} className="flex gap-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-on-brand/12"><I className="h-5 w-5" /></span>
                  <span><span className="block font-semibold">{t as string}</span><span className="opacity-80">{d as string}</span></span>
                </li>
              );
            })}
          </ul>
        </div>
      </aside>
    </div>
  );
}
