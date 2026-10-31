import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../api';
import { Card, CardBody, Spinner } from '../../ui';
import { Marco } from './Marco';

/** Destino del enlace del correo: confirma la cuenta con el token (un solo uso). Se pide una vez aunque React monte el efecto dos veces. */
export default function VerificarCorreo() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [estado, setEstado] = useState<'verificando' | 'ok' | 'error'>(token ? 'verificando' : 'error');
  const [mensaje, setMensaje] = useState(token ? '' : 'El enlace está incompleto. Abre el que te enviamos por correo.');
  const pedido = useRef(false);

  useEffect(() => {
    if (!token || pedido.current) return;
    pedido.current = true;
    api('/api/publico/verificar-correo', { method: 'POST', json: { token } })
      .then(() => setEstado('ok'))
      .catch(e => { setEstado('error'); setMensaje(errorText(e)); });
  }, [token]);

  return (
    <Marco ancho="max-w-xl">
      <Card>
        <CardBody className="text-center" aria-live="polite">
          {estado === 'verificando' && <p className="flex items-center justify-center gap-2 text-sm text-muted" role="status"><Spinner />Confirmando tu correo…</p>}
          {estado === 'ok' && (
            <>
              <CheckCircleIcon className="mx-auto h-12 w-12 text-ok" aria-hidden="true" />
              <h1 className="mt-3 text-xl font-semibold">¡Correo confirmado!</h1>
              <p className="mt-2 text-sm text-muted">Tu cuenta ya está activa. Entra con tu correo y tu contraseña; el paso 2 de 2 es crear tu condominio.</p>
              <Link to="/login" className="mt-6 inline-block rounded bg-brand px-5 py-2.5 text-sm font-semibold text-on-brand transition-colors duration-150 hover:bg-brand-hover">Iniciar sesión</Link>
            </>
          )}
          {estado === 'error' && (
            <>
              <ExclamationTriangleIcon className="mx-auto h-12 w-12 text-warn" aria-hidden="true" />
              <h1 className="mt-3 text-xl font-semibold">No pudimos confirmar tu correo</h1>
              <p className="mt-2 text-sm text-muted">{mensaje}</p>
              <p className="mt-6 text-sm"><Link to="/login" className="font-medium text-brand underline">Ir a iniciar sesión</Link> y pedir otro enlace.</p>
            </>
          )}
        </CardBody>
      </Card>
    </Marco>
  );
}
