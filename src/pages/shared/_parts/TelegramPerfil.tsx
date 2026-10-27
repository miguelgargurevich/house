import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../../../api';
import { Button, Card, CardBody, CardHeader, Skeleton, useToast } from '../../../ui';
import { codigoEnGrupos, estadoTelegram, reloj, segundosRestantes, type CanalesMe, type CodigoGenerado } from './canalesFormato';

const CADA_MS = 4000;

/** «Vincular Telegram» del perfil: genera un código de un solo uso y el enlace que abre el bot con el código ya escrito (`t.me/<bot>?start=<codigo>`). */
export function TelegramPerfil() {
  const toast = useToast();
  const [data, setData] = useState<CanalesMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<CodigoGenerado | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [generando, setGenerando] = useState(false);
  const [quitando, setQuitando] = useState(false);

  const cargar = useCallback(async () => {
    try { setData(await api<CanalesMe>('/api/me/canales')); setError(null); } catch (e) { setError(errorText(e)); }
  }, []);
  useEffect(() => { void cargar(); }, [cargar]);

  const esperando = codigo != null && estadoTelegram(data) === 'listo';
  useEffect(() => {
    if (!esperando) return;
    const reloj1 = setInterval(() => setAhora(Date.now()), 1000);
    const revisar = setInterval(() => void cargar(), CADA_MS);
    return () => { clearInterval(reloj1); clearInterval(revisar); };
  }, [esperando, cargar]);

  const vinculo = data?.vinculos.find((v) => v.canal === 'telegram') ?? null;
  useEffect(() => {
    if (vinculo && codigo) { setCodigo(null); toast.ok('Tu Telegram quedó vinculado'); }
  }, [vinculo, codigo, toast]);

  async function generar() {
    setGenerando(true);
    try {
      const c = await api<CodigoGenerado>('/api/me/canales/telegram/codigo', { method: 'POST', json: {} });
      setCodigo(c);
      setAhora(Date.now());
    } catch (e) { toast.error(errorText(e)); } finally { setGenerando(false); }
  }

  async function desvincular() {
    if (!vinculo) return;
    setQuitando(true);
    try {
      await api(`/api/me/canales/${vinculo.id}`, { method: 'DELETE' });
      toast.ok('Desvinculamos tu Telegram');
      setCodigo(null);
      await cargar();
    } catch (e) { toast.error(errorText(e)); } finally { setQuitando(false); }
  }

  const estado = estadoTelegram(data);
  if (estado === 'oculto' && !error) return data ? null : <Card><CardBody><Skeleton className="h-20 w-full" /></CardBody></Card>;

  const falta = codigo ? segundosRestantes(codigo.expira_at, ahora) : 0;
  const vencido = codigo != null && falta === 0;

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Asistente por Telegram" description="Consulta tus pagos y envía el comprobante de tu mantenimiento por Telegram, desde la cuenta que vincules aquí." />
      <CardBody>
        {error ? <p className="text-sm text-bad">{error}</p> : !data ? <Skeleton className="h-24 w-full" /> : (
          <div className="grid gap-4 lg:max-w-xl">
            {vinculo ? (
              <>
                <p className="text-sm"><span className="font-medium text-ok">Vinculado</span> · <span className="num">{vinculo.identificador}</span> · {vinculo.empresa.nombre}</p>
                <p className="text-xs text-muted">Escríbele al bot{data.telegram?.bot_usuario ? ` @${data.telegram.bot_usuario}` : ''}. También puedes enviar /desvincular desde Telegram.</p>
                <div className="flex justify-end">
                  <Button variant="secondary" loading={quitando} onClick={() => void desvincular()} className="w-full sm:w-auto">Desvincular</Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm"><span className="font-medium text-muted">Sin vincular.</span> Te damos un código de 6 dígitos que vence a los 10 minutos.</p>
                {codigo && !vencido ? (
                  <div className="grid gap-3 rounded-lg border border-line p-4" role="status" aria-live="polite">
                    <p className="text-xs text-muted">Tu código</p>
                    <p className="num text-3xl font-semibold tracking-widest" data-testid="codigo-vinculacion-telegram">{codigoEnGrupos(codigo.codigo)}</p>
                    {codigo.telegram && (
                      <p className="text-sm">
                        Abre el bot y toca «Iniciar»:{' '}
                        <a className="font-medium text-brand underline" href={codigo.telegram.enlace} target="_blank" rel="noopener noreferrer">@{codigo.telegram.bot_usuario}</a>
                        <span className="block text-xs text-muted">O escríbele el código al bot desde tu Telegram.</span>
                      </p>
                    )}
                    <p className="text-xs text-muted">Vence en <span className="num">{reloj(falta)}</span>. Esperando tu mensaje…</p>
                  </div>
                ) : vencido ? (
                  <p className="text-sm text-bad">El código venció. Genera uno nuevo.</p>
                ) : null}
                <div className="flex justify-end">
                  <Button loading={generando} onClick={() => void generar()} className="w-full sm:w-auto">{codigo ? 'Generar otro código' : 'Vincular Telegram'}</Button>
                </div>
              </>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
