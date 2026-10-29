import { useEffect, useId, useState } from 'react';
import { api, errorText, useResource } from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { Button, Card, CardBody, CardHeader, Skeleton, TelefonoInput, cx, useToast } from '../../../ui';
import { parsearCelular } from '../../../lib/telefono';

interface Prefs { aviso_email: boolean; aviso_whatsapp: boolean; telefono: string | null }

function Interruptor({ checked, onChange, label, detalle }: { checked: boolean; onChange: (v: boolean) => void; label: string; detalle: string }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={id} className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted">{detalle}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          checked ? 'bg-brand' : 'bg-line',
        )}
      >
        <span aria-hidden="true" className={cx('inline-block h-5 w-5 rounded-full bg-surface shadow-card transition-transform duration-150', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

/**
 * Sección «Avisos» del perfil: cómo quieres recibir recibos, vencimientos y pagos, y TU celular (el único teléfono del perfil: `Usuario.telefono`).
 * Antes «Datos personales» tenía otro campo para el mismo dato y, guardado vacío, borraba el celular de WhatsApp.
 */
export function AvisosPerfil() {
  const toast = useToast();
  const { refresh } = useAuth();
  const { data, loading, error, reload } = useResource<Prefs>('/api/me/avisos');
  const [email, setEmail] = useState(true);
  const [wa, setWa] = useState(false);
  const [celular, setCelular] = useState('');
  const [errCelular, setErrCelular] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEmail(data.aviso_email);
    setWa(data.aviso_whatsapp);
    setCelular(data.telefono ?? '');
  }, [data]);

  async function guardar() {
    const c = celular.trim();
    if (c && !parsearCelular(c)) { setErrCelular('Usa un celular válido para el país elegido.'); return; }
    if (wa && !c) { setErrCelular('Necesitas un celular para recibir WhatsApp.'); return; }
    setErrCelular(undefined);
    setGuardando(true);
    try {
      await api('/api/me/avisos', { method: 'PUT', json: { aviso_email: email, aviso_whatsapp: wa, telefono: c } });
      toast.ok('Preferencias de avisos guardadas');
      void reload();
      void refresh();
    } catch (e) { toast.error(errorText(e)); } finally { setGuardando(false); }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Celular y avisos" description="Te avisamos cuando se emite un recibo, está por vencer o vence, y cuando revisamos tu pago." />
      <CardBody>
        {loading && !data ? <Skeleton className="h-28 w-full" /> : error ? <p className="text-sm text-bad">{error}</p> : (
          <div className="grid gap-5 lg:max-w-xl">
            <Interruptor checked={email} onChange={setEmail} label="Avisos por correo" detalle="Los enviamos al correo con el que ingresas." />
            <Interruptor checked={wa} onChange={setWa} label="Avisos por WhatsApp" detalle="Necesitamos tu celular para escribirte." />
            <TelefonoInput
              label="Tu celular"
              soloCelular
              hint="Para los avisos por WhatsApp y para que la administración te ubique. De cualquier país; sin código se toma como de Perú."
              error={errCelular}
              value={celular}
              onChange={v => { setCelular(v); setErrCelular(undefined); }}
            />
            <div className="flex justify-end">
              <Button loading={guardando} onClick={() => void guardar()} className="w-full sm:w-auto">Guardar</Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
