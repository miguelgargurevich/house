import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { CheckIcon, EnvelopeIcon, EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../api';
import { HOME, useAuth } from '../../auth/AuthContext';
import { Alert, Button, Card, CardBody, cx, Input, TelefonoInput } from '../../ui';
import { Marco } from './Marco';
import { PanelRegistro } from './_parts/PanelRegistro';
import { reglasClave } from './_parts/clave';

interface Formulario { nombre: string; email: string; celular: string; password: string; empresa: string; condominio: string; unidades: string }
const VACIO: Formulario = { nombre: '', email: '', celular: '', password: '', empresa: '', condominio: '', unidades: '' };

/** Registro público: crea tu cuenta y tu primer condominio en el plan Gratis. Hay que confirmar el correo antes de entrar. */
export default function Registro() {
  const { user } = useAuth();
  const [f, setF] = useState<Formulario>(VACIO);
  const [señuelo, setSeñuelo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [listo, setListo] = useState<string | null>(null);
  const [verClave, setVerClave] = useState(false);

  if (user) return <Navigate to={HOME[user.rol]} replace />;
  const campo = (k: keyof Formulario) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value })) });
  const completo = Object.values(f).every(v => v.trim() !== '');
  // Las reglas que se ven mientras se escribe (la de repetir la clave no aplica aquí). El servidor sigue decidiendo.
  const reglas = reglasClave(f.password, '').slice(0, 2);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ mensaje: string }>('/api/publico/registro', { method: 'POST', json: { ...f, email: f.email.trim(), unidades: Number(f.unidades), sitio_web: señuelo } });
      setListo(r.mensaje);
    } catch (err) {
      setError(errorText(err));
    } finally { setBusy(false); }
  }

  if (listo) {
    return (
      <Marco ancho="max-w-xl">
        <Card>
          <CardBody className="text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand"><EnvelopeIcon className="h-6 w-6" aria-hidden="true" /></span>
            <h1 className="mt-4 text-xl font-semibold">Revisa tu correo</h1>
            <p className="mt-2 text-sm text-muted" role="status">{listo}</p>
            <p className="mt-6 text-sm"><Link to="/login" className="font-medium text-brand underline">Ir a iniciar sesión</Link></p>
          </CardBody>
        </Card>
      </Marco>
    );
  }

  return (
    <Marco>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-start lg:gap-14">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Crea tu cuenta gratis</h1>
          <p className="mt-1 text-sm text-muted">Sin tarjeta: empiezas en el plan Gratis y pasas a Pro cuando lo necesites. Te enviaremos un enlace para confirmar tu correo.</p>
          <form onSubmit={enviar} className="mt-8 space-y-8" noValidate>
            {error && <Alert tone="bad">{error}</Alert>}

            <Paso n={1} titulo="Tú">
              <Input label="Tu nombre" autoComplete="name" maxLength={120} required {...campo('nombre')} />
              <Input label="Correo electrónico" type="email" autoComplete="email" maxLength={160} required {...campo('email')} />
              <TelefonoInput label="Celular" value={f.celular} onChange={celular => setF(x => ({ ...x, celular }))} required />
              <div className="relative">
                <Input label="Contraseña" type={verClave ? 'text' : 'password'} autoComplete="new-password" maxLength={72} required className="[&_input]:pr-11" {...campo('password')} />
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
              <ul aria-label="Requisitos de la contraseña" className="-mt-2 grid gap-1 text-xs text-muted">
                {reglas.map(r => (
                  <li key={r.texto} className={cx('flex items-center gap-1.5', r.ok && 'text-ok')}>
                    <CheckIcon className={cx('h-4 w-4 shrink-0', !r.ok && 'opacity-40')} aria-hidden="true" />{r.texto}
                  </li>
                ))}
              </ul>
            </Paso>

            <Paso n={2} titulo="Tu condominio">
              <Input label="Nombre de tu administradora o junta" maxLength={160} required {...campo('empresa')} />
              <div className="grid gap-4 sm:grid-cols-[1fr_10.5rem]">
                <Input label="Nombre del condominio" maxLength={160} required {...campo('condominio')} />
                <Input label="N.º de departamentos" type="number" inputMode="numeric" min={1} max={5000} required hint="Aproximado" {...campo('unidades')} />
              </div>
            </Paso>

            {/* Señuelo antiabuso: ninguna persona lo ve ni lo llena; un robot sí. */}
            <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
              <label>Sitio web<input type="text" tabIndex={-1} autoComplete="off" value={señuelo} onChange={e => setSeñuelo(e.target.value)} /></label>
            </div>
            <div className="space-y-4">
              <Button type="submit" loading={busy} disabled={!completo} className="w-full">Crear cuenta gratis</Button>
              <p className="text-center text-sm text-muted">¿Ya tienes cuenta? <Link to="/login" className="font-medium text-brand underline">Ingresa</Link></p>
            </div>
          </form>
        </div>

        <PanelRegistro />
      </div>
    </Marco>
  );
}

/** Un paso del formulario: un `fieldset` con su título corto (el lector de pantalla lo anuncia como grupo). */
function Paso({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4">
      <legend>
        <span className="flex items-center gap-2.5 text-sm font-semibold">
          <span className="num flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs text-brand" aria-hidden="true">{n}</span>
          {titulo}
        </span>
      </legend>
      {children}
    </fieldset>
  );
}
