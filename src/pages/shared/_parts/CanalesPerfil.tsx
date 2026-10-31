import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../../../api';
import { Button, Card, CardBody, CardHeader, Skeleton, useToast } from '../../../ui';
import { codigoEnGrupos, destinosActivos, estadoCanales, formatoNumero, reloj, segundosRestantes, type CanalesMe, type CodigoGenerado } from './canalesFormato';

const CADA_MS = 4000;

/** «Vincular WhatsApp» del perfil: genera un código de un solo uso, dice a qué número mandarlo y muestra el estado del vínculo. */
export function CanalesPerfil() {
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

  // Con un código a la vista: reloj de cuenta regresiva y, cada pocos segundos, se revisa si ya se vinculó.
  const esperando = codigo != null && estadoCanales(data) === 'listo';
  useEffect(() => {
    if (!esperando) return;
    const reloj1 = setInterval(() => setAhora(Date.now()), 1000);
    const revisar = setInterval(() => void cargar(), CADA_MS);
    return () => { clearInterval(reloj1); clearInterval(revisar); };
  }, [esperando, cargar]);

  const vinculo = data?.vinculos.find((v) => v.canal === 'whatsapp') ?? null;
  useEffect(() => {
    if (vinculo && codigo) { setCodigo(null); toast.ok('Tu WhatsApp quedó vinculado'); }
  }, [vinculo, codigo, toast]);

  async function generar() {
    setGenerando(true);
    try {
      const c = await api<CodigoGenerado>('/api/me/canales/whatsapp/codigo', { method: 'POST', json: {} });
      setCodigo(c);
      setAhora(Date.now());
    } catch (e) { toast.error(errorText(e)); } finally { setGenerando(false); }
  }

  async function desvincular() {
    if (!vinculo) return;
    setQuitando(true);
    try {
      await api(`/api/me/canales/${vinculo.id}`, { method: 'DELETE' });
      toast.ok('Desvinculamos tu WhatsApp');
      setCodigo(null);
      await cargar();
    } catch (e) { toast.error(errorText(e)); } finally { setQuitando(false); }
  }

  const estado = estadoCanales(data);
  if (estado === 'oculto' && !error) return data ? null : <Card><CardBody><Skeleton className="h-20 w-full" /></CardBody></Card>;

  const destinos = destinosActivos(data?.destinos ?? []);
  const falta = codigo ? segundosRestantes(codigo.expira_at, ahora) : 0;
  const vencido = codigo != null && falta === 0;

  return (
    <Card className="lg:col-span-2">
      <CardHeader title="Asistente por WhatsApp" description="Consulta tus pagos y envía el comprobante de tu mantenimiento por WhatsApp, desde el número que vincules aquí." />
      <CardBody>
        {error ? <p className="text-sm text-bad">{error}</p> : !data ? <Skeleton className="h-24 w-full" /> : (
          <div className="grid gap-4 lg:max-w-xl">
            {vinculo ? (
              <>
                <p className="text-sm">
                  <span className="font-medium text-ok">Vinculado</span> · <span className="num">{vinculo.identificador}</span> · {vinculo.empresa.nombre}
                </p>
                <p className="text-xs text-muted">Escríbele al número de tu administración. Si cambias de celular, desvincula este y vincula el nuevo.</p>
                <div className="flex justify-end">
                  <Button variant="secondary" loading={quitando} onClick={() => void desvincular()} className="w-full sm:w-auto">Desvincular</Button>
                </div>
              </>
            ) : estado === 'sin_whatsapp' ? (
              <p className="text-sm text-muted">Tu administración todavía no activó WhatsApp en Torre. Cuando lo haga podrás vincular tu número aquí.</p>
            ) : (
              <>
                <p className="text-sm"><span className="font-medium text-muted">Sin vincular.</span> Te damos un código de 6 dígitos que vence a los 10 minutos.</p>
                {codigo && !vencido ? (
                  <div className="grid gap-3 rounded-lg border border-line p-4" role="status" aria-live="polite">
                    <p className="text-xs text-muted">Tu código</p>
                    <p className="num text-3xl font-semibold tracking-widest" data-testid="codigo-vinculacion">{codigoEnGrupos(codigo.codigo)}</p>
                    <p className="text-sm">
                      Envíalo por WhatsApp al{' '}
                      {(codigo.destinos.length ? destinosActivos(codigo.destinos) : destinos).map((d) => (
                        <span key={d.empresa.id} className="block">
                          <span className="num font-medium">{d.numero ? formatoNumero(d.numero) : 'número de WhatsApp de tu administración'}</span>
                          {destinos.length > 1 && <span className="text-muted"> ({d.empresa.nombre})</span>}
                        </span>
                      ))}
                    </p>
                    <p className="text-xs text-muted">Debes escribirlo desde el celular que quieres vincular. Vence en <span className="num">{reloj(falta)}</span>. Esperando tu mensaje…</p>
                  </div>
                ) : vencido ? (
                  <p className="text-sm text-bad">El código venció. Genera uno nuevo.</p>
                ) : null}
                <div className="flex justify-end">
                  <Button loading={generando} onClick={() => void generar()} className="w-full sm:w-auto">{codigo ? 'Generar otro código' : 'Vincular WhatsApp'}</Button>
                </div>
              </>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
