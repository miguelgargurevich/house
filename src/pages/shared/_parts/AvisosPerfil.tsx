import { useEffect, useId, useState } from 'react';
import { api, errorText, useResource } from '../../../api';
import { Button, Card, CardBody, CardHeader, Input, Skeleton, cx, useToast } from '../../../ui';

interface Prefs { aviso_email: boolean; aviso_whatsapp: boolean; telefono: string | null }

/** Celular peruano: 9 dígitos que empiecen con 9, con o sin +51. */
export const celularValido = (v: string) => /^9\d{8}$/.test(v.replace(/[\s\-().]/g, '').replace(/^\+?(00)?51(?=9\d{8}$)/, ''));

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

/** Sección «Avisos» del perfil: cómo quieres recibir recibos, vencimientos y pagos. */
export function AvisosPerfil() {
  const toast = useToast();
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
    if (c && !celularValido(c)) { setErrCelular('Ingresa un celular peruano: 9 dígitos que empiecen con 9.'); return; }
    if (wa && !c) { setErrCelular('Necesitas un celular para recibir WhatsApp.'); return; }
    setErrCelular(undefined);
    setGuardando(true);
    try {
      await api('/api/me/avisos', { method: 'PUT', json: { aviso_email: email, aviso_whatsapp: wa, telefono: c } });
      toast.ok('Preferencias de avisos guardadas');
      void reload();
    } catch (e) { toast.error(errorText(e)); } finally { setGuardando(false); }
  }

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Avisos" description="Te avisamos cuando se emite un recibo, está por vencer o vence, y cuando revisamos tu pago." />
      <CardBody>
        {loading && !data ? <Skeleton className="h-28 w-full" /> : error ? <p className="text-sm text-bad">{error}</p> : (
          <div className="grid gap-5 lg:max-w-xl">
            <Interruptor checked={email} onChange={setEmail} label="Avisos por correo" detalle="Los enviamos al correo con el que ingresas." />
            <Interruptor checked={wa} onChange={setWa} label="Avisos por WhatsApp" detalle="Necesitamos tu celular para escribirte." />
            <Input
              label="Celular para WhatsApp"
              inputMode="tel"
              autoComplete="tel"
              placeholder="987 654 321"
              hint="Celular peruano de 9 dígitos. El prefijo +51 es opcional."
              error={errCelular}
              value={celular}
              onChange={e => { setCelular(e.target.value); setErrCelular(undefined); }}
            />
            <div className="flex justify-end">
              <Button loading={guardando} onClick={() => void guardar()} className="w-full sm:w-auto">Guardar avisos</Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
