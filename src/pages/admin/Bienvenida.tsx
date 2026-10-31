import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { ApiError, api, errorText } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCondominio } from '../../app/condominio';
import { Alert, Button, Card, CardBody, Input, Skeleton } from '../../ui';
import { IndicadorPasos } from '../publico/_parts/IndicadorPasos';

/**
 * Paso 2 del registro: la administradora que ya confirmó su correo y entró cae aquí mientras no tenga condominios (`RequireCondominio` la manda).
 * Pide el nombre de su administradora o junta, el del condominio y los departamentos (aproximado); el servidor crea el condominio con su prueba
 * y la deja en el Resumen con un mensaje de bienvenida (paso 3: «Listo»).
 */
export default function Bienvenida() {
  const { user } = useAuth();
  const { listo, sinCondominios, recargar } = useCondominio();
  const nav = useNavigate();
  const [f, setF] = useState({ empresa: '', condominio: '', unidades: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Mientras se envía y se recarga la lista, esta pantalla ya no es la destinataria de la redirección «ya tienes condominio»: la navegación al Resumen la hace el envío.
  const enviando = useRef(false);

  if (user?.rol !== 'admin') return <Navigate to="/" replace />;
  if (!listo) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-8 w-56" /><Skeleton className="h-64 w-full" /></div>;
  if (!sinCondominios && !enviando.current) return <Navigate to="/admin/dashboard" replace />;

  const campo = (k: keyof typeof f) => ({ value: f[k], onChange: (e: { target: { value: string } }) => setF(x => ({ ...x, [k]: e.target.value })) });
  const completo = Object.values(f).every(v => v.trim() !== '');

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    enviando.current = true;
    try {
      await api('/api/comercial/primer-condominio', { method: 'POST', json: { empresa: f.empresa, condominio: f.condominio, unidades: Number(f.unidades) } });
      await recargar();
      nav('/admin/dashboard', { replace: true, state: { bienvenida: f.condominio.trim() } });
    } catch (err) {
      // 409: ya tiene un condominio (otra pestaña lo creó): se recarga la lista y la redirección de arriba la lleva al Resumen.
      if (err instanceof ApiError && err.status === 409) { await recargar(); enviando.current = false; return; }
      enviando.current = false;
      setError(errorText(err));
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-xl">
      <IndicadorPasos actual={2} />
      <h1 className="mt-6 text-2xl font-semibold sm:text-3xl">Te damos la bienvenida a Torre</h1>
      <p className="mt-1 text-sm font-medium">Paso 2 de 2: tu condominio</p>
      <p className="mt-1 text-sm text-muted">Tu cuenta ya está lista. Cuéntanos de tu condominio para empezar: sin tarjeta, con Torre Gratis por 3 meses y una prueba de Torre Pro dentro.</p>
      <Card className="mt-6">
        <CardBody>
          <form onSubmit={enviar} className="space-y-4" noValidate>
            {error && <Alert tone="bad">{error}</Alert>}
            <Input label="Nombre de tu administradora o junta" autoComplete="organization" maxLength={160} required {...campo('empresa')} />
            <div className="grid gap-4 sm:grid-cols-[1fr_10.5rem]">
              <Input label="Nombre del condominio" maxLength={160} required {...campo('condominio')} />
              <Input label="N.º de departamentos" type="number" inputMode="numeric" min={1} max={5000} required hint="Aproximado" {...campo('unidades')} />
            </div>
            <Button type="submit" loading={busy} disabled={!completo} className="w-full">Crear mi condominio</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
