import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { EnvelopeIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../api';
import { HOME, useAuth } from '../../auth/AuthContext';
import { Alert, Button, Card, CardBody, Input } from '../../ui';
import { Marco } from './Marco';

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

  if (user) return <Navigate to={HOME[user.rol]} replace />;
  const campo = (k: keyof Formulario) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value })) });
  const completo = Object.values(f).every(v => v.trim() !== '');

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
    <Marco ancho="max-w-xl">
      <h1 className="text-2xl font-semibold sm:text-3xl">Crea tu cuenta gratis</h1>
      <p className="mt-1 text-sm text-muted">Sin tarjeta: empiezas en el plan Gratis y pasas a Pro cuando lo necesites. Te enviaremos un enlace para confirmar tu correo.</p>
      <form onSubmit={enviar} className="mt-6 space-y-4" noValidate>
        {error && <Alert tone="bad">{error}</Alert>}
        <Input label="Tu nombre" autoComplete="name" maxLength={120} required {...campo('nombre')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Correo electrónico" type="email" autoComplete="email" maxLength={160} required {...campo('email')} />
          <Input label="Celular" type="tel" autoComplete="tel" inputMode="tel" maxLength={30} required {...campo('celular')} />
        </div>
        <Input label="Contraseña" type="password" autoComplete="new-password" maxLength={72} required hint="Mínimo 8 caracteres, con letras y números." {...campo('password')} />
        <Input label="Nombre de tu administradora o junta" maxLength={160} required {...campo('empresa')} />
        <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
          <Input label="Nombre del condominio" maxLength={160} required {...campo('condominio')} />
          <Input label="N.º de departamentos" type="number" inputMode="numeric" min={1} max={5000} required hint="Aproximado" {...campo('unidades')} />
        </div>
        {/* Señuelo antiabuso: ninguna persona lo ve ni lo llena; un robot sí. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>Sitio web<input type="text" tabIndex={-1} autoComplete="off" value={señuelo} onChange={e => setSeñuelo(e.target.value)} /></label>
        </div>
        <Button type="submit" loading={busy} disabled={!completo} className="w-full">Crear cuenta gratis</Button>
        <p className="text-center text-sm text-muted">¿Ya tienes cuenta? <Link to="/login" className="font-medium text-brand underline">Ingresa</Link></p>
      </form>
    </Marco>
  );
}
