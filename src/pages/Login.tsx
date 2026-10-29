import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { BellAlertIcon, CheckCircleIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
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

      {/* Escena del producto en vez de adorno: un recibo, un recordatorio y el avance del cobro, como se ven dentro de House. */}
      <aside className="relative hidden overflow-hidden bg-escena text-on-escena lg:flex lg:flex-col lg:justify-center lg:px-14 lg:py-16 xl:px-20" aria-hidden="true">
        <p className="max-w-md text-balance text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">Cobra a tiempo y que cada vecino sepa qué debe.</p>
        <p className="mt-3 max-w-md text-pretty text-base opacity-85">Recibos por concepto, pagos validados y recordatorios por WhatsApp, en un solo lugar.</p>

        <div className="relative mt-12 h-[23rem] w-full max-w-xl">
          <EscenaRecibo />
          <EscenaAviso />
          <EscenaCobro />
        </div>
      </aside>
    </div>
  );
}

/** Entrada de la escena: un leve ascenso al cargar, escalonado, desde visible (nunca depende de la animación para verse); sin movimiento si el sistema lo pide. */
const entra = 'motion-safe:animate-[sube-corto_700ms_cubic-bezier(0.22,1,0.36,1)_both]';

/** El recibo del vecino: el mantenimiento del mes desglosado por concepto, ya pagado. Montos de ejemplo. */
function EscenaRecibo() {
  const conceptos: [string, string][] = [['Servicio de seguridad', '70.00'], ['Agua del departamento', '50.93'], ['Servicio de limpieza', '35.00'], ['Luz de áreas comunes', '16.10'], ['Contingencia del block', '10.00']];
  return (
    <div className={`absolute left-0 top-0 w-[19.5rem] rounded-xl bg-escena-tarjeta p-5 text-ink shadow-[0_24px_48px_-16px_oklch(0.2_0.05_180/0.45)] ${entra}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Mantenimiento de octubre</p>
          <p className="text-xs text-muted">B01-804 · Block 1</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok"><CheckCircleIcon className="h-3.5 w-3.5" />Pagado</span>
      </div>
      <ul className="mt-4 space-y-1.5 text-xs">
        {conceptos.map(([c, m]) => (
          <li key={c} className="flex justify-between gap-4"><span className="text-muted">{c}</span><span className="num">S/ {m}</span></li>
        ))}
      </ul>
      <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
        <span className="text-xs text-muted">Total</span>
        <span className="num text-lg font-semibold">S/ 182.03</span>
      </div>
    </div>
  );
}

/** El recordatorio que le llega al vecino antes del vencimiento. */
function EscenaAviso() {
  return (
    <div className={`absolute right-0 top-10 w-60 rounded-xl bg-escena-tarjeta p-4 text-ink shadow-[0_18px_40px_-14px_oklch(0.2_0.05_180/0.4)] [animation-delay:180ms] ${entra}`}>
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand"><BellAlertIcon className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-xs font-semibold">Recordatorio por WhatsApp</p>
          <p className="mt-0.5 text-xs leading-snug text-muted">Tu mantenimiento de noviembre vence el 10. Págalo desde House en un minuto.</p>
        </div>
      </div>
    </div>
  );
}

/** Lo que ve la administradora: cuánto del block ya pagó. */
function EscenaCobro() {
  return (
    <div className={`absolute bottom-0 right-6 w-72 rounded-xl bg-escena-tarjeta p-4 text-ink shadow-[0_18px_40px_-14px_oklch(0.2_0.05_180/0.4)] [animation-delay:360ms] ${entra}`}>
      <div className="flex items-baseline justify-between">
        <p className="text-xs font-semibold">Cobranza de octubre · Block 1</p>
        <p className="num text-sm font-semibold text-brand">92 %</p>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface2"><div className="h-full w-[92%] rounded-full bg-brand" /></div>
      <p className="mt-2 text-xs text-muted"><span className="num">29</span> de <span className="num">32</span> departamentos al día</p>
    </div>
  );
}
