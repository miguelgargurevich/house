import { useState } from 'react';
import type { FormEvent } from 'react';
import { ExclamationTriangleIcon, TrashIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { ELIMINAR_CUENTA, FRASE_CONFIRMAR, PERFIL_ELIMINAR as T } from '../../publico/eliminarCuenta/textos';
import { Alert, Button, Card, CardBody, CardHeader, Input, Modal, Skeleton, useToast } from '../../../ui';

interface Estado { modo: 'inmediata' | 'solicitud' | 'no_disponible'; frase: string; solicitud_pendiente: boolean }

const Lista = ({ titulo, items }: { titulo: string; items: readonly string[] }) => (
  <div>
    <h3 className="text-sm font-medium">{titulo}</h3>
    <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-muted">{items.map(t => <li key={t}>{t}</li>)}</ul>
  </div>
);

/**
 * «Eliminar mi cuenta» al final de Mi perfil (App Store 5.1.1(v) y Google Play). Vecino, personal y administradora con otra administradora activa: se elimina al
 * momento (contraseña + ELIMINAR); la única administradora de su empresa sólo puede pedir el cierre de su empresa; el superadmin no ve la sección.
 * Tras eliminar, recarga la página pública `/eliminar-cuenta?eliminada=1`.
 */
export function EliminarCuentaPerfil() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, loading, reload } = useResource<Estado>('/api/me/eliminacion');
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState('');
  const [frase, setFrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Superadmin (no se elimina desde aquí) y «Entrar como» (la cuenta es de otra persona): no hay nada que ofrecer.
  if (user?.impersonando || data?.modo === 'no_disponible') return null;
  if (loading && !data) return <Card className="lg:col-span-2"><CardBody><Skeleton className="h-24 w-full" /></CardBody></Card>;
  if (!data) return null; // si no se pudo leer, la sección no estorba: el resto del perfil sigue igual

  const solicitud = data.modo === 'solicitud';
  const fraseOk = frase.trim().toUpperCase() === FRASE_CONFIRMAR;
  const listo = clave.length > 0 && (solicitud || fraseOk);

  function abrir() { setClave(''); setFrase(''); setError(null); setAbierto(true); }
  function cerrar() { if (!enviando) setAbierto(false); }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!listo || enviando) return;
    setError(null);
    setEnviando(true);
    try {
      if (solicitud) {
        await api('/api/me/solicitar-cierre', { method: 'POST', json: { password: clave } });
        setAbierto(false);
        toast.ok(T.unica_listo);
        await reload();
      } else {
        await api('/api/me/eliminar', { method: 'POST', json: { password: clave, confirmacion: frase.trim() } });
        // El servidor ya cerró todas las sesiones y borró la cookie. Se recarga la página pública en vez de navegar dentro de la app: al quedar sin sesión, el guardián de
        // «Mi perfil» llevaba a /login antes de llegar (se vio en el navegador), y así el estado del navegador queda limpio.
        window.location.replace('/eliminar-cuenta?eliminada=1');
      }
    } catch (err) { setError(errorText(err)); } finally { setEnviando(false); }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader title={T.titulo} description={T.descripcion} />
      <CardBody className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Lista titulo={ELIMINAR_CUENTA.se_borra_titulo} items={ELIMINAR_CUENTA.se_borra} />
          <Lista titulo={ELIMINAR_CUENTA.se_conserva_titulo} items={ELIMINAR_CUENTA.se_conserva} />
        </div>
        {solicitud ? (
          data.solicitud_pendiente
            ? <Alert tone="info">{T.unica_pendiente}</Alert>
            : <>
                <Alert tone="warn">{T.unica_alerta}</Alert>
                <div className="flex justify-end"><Button variant="danger" icon={<ExclamationTriangleIcon className="h-5 w-5" aria-hidden="true" />} onClick={abrir} className="w-full sm:w-auto">{T.unica_boton}</Button></div>
              </>
        ) : (
          <>
            <p className="text-sm text-muted">{ELIMINAR_CUENTA.libre}</p>
            <div className="flex justify-end"><Button variant="danger" icon={<TrashIcon className="h-5 w-5" aria-hidden="true" />} onClick={abrir} className="w-full sm:w-auto">{T.boton}</Button></div>
          </>
        )}
      </CardBody>

      <Modal
        open={abierto}
        onClose={cerrar}
        title={solicitud ? T.unica_dialogo_titulo : T.dialogo_titulo}
        description={solicitud ? T.unica_dialogo_descripcion : T.dialogo_descripcion}
        footer={
          <>
            <Button variant="secondary" onClick={cerrar} disabled={enviando}>{T.cancelar}</Button>
            <Button variant="danger" type="submit" form="form-eliminar-cuenta" loading={enviando} disabled={!listo}>{solicitud ? T.unica_enviar : T.confirmar}</Button>
          </>
        }
      >
        <form id="form-eliminar-cuenta" onSubmit={enviar} className="grid gap-4" noValidate>
          {error && <Alert tone="bad">{error}</Alert>}
          <Input label={T.campo_clave} type="password" autoComplete="current-password" value={clave} onChange={e => setClave(e.target.value)} maxLength={200} />
          {!solicitud && <Input label={T.campo_frase} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={frase} onChange={e => setFrase(e.target.value)} maxLength={40} />}
        </form>
      </Modal>
    </Card>
  );
}
