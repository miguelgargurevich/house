import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Input, useToast } from '../../../../ui';
import { TC_MAX, TC_MIN, textoDelOrigen, textoDelValor, tipoCambioEscritoValido, tipoCambioParaApi, type TipoCambioDatos } from './tipoCambioTexto';

export type { TipoCambioDatos };

/**
 * Tipo de cambio PEN/USD: con él los países que no son Perú pagan en dólares (el precio en soles ÷ este valor). Automático: se lee solo cada 24 h de una
 * fuente pública. Manual: lo fija el superadmin y la lectura diaria no lo pisa hasta que vuelva a automático.
 */
export function TipoCambio({ c, onGuardado }: { c: TipoCambioDatos; onGuardado: () => void }) {
  const toast = useToast();
  const [valor, setValor] = useState(c.tipo_cambio_usd ? String(Number(c.tipo_cambio_usd)) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'fijar' | 'auto' | null>(null);
  useEffect(() => { setValor(c.tipo_cambio_usd ? String(Number(c.tipo_cambio_usd)) : ''); }, [c.tipo_cambio_usd]);
  const hay = c.tipo_cambio_usd !== null;
  async function enviar(json: { tipo_cambio: string } | { automatico: true }, modo: 'fijar' | 'auto') {
    setBusy(modo); setError(null);
    try {
      await api('/api/comercial/tipo-cambio', { method: 'PUT', json });
      toast.ok(modo === 'fijar' ? 'Tipo de cambio fijado a mano' : 'Tipo de cambio automático, actualizado ahora');
      onGuardado();
    } catch (e) { setError(errorText(e)); } finally { setBusy(null); }
  }
  return (
    <Card>
      <CardHeader title="Tipo de cambio" description="Todos los países menos Perú pagan en dólares (US$): el precio en soles ÷ este tipo de cambio, redondeado a 2 decimales. Lo ya cobrado no cambia. Sin tipo de cambio, esos países ven «Consúltanos»." />
      <CardBody className="space-y-4">
        {error && <Alert tone="bad">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="num text-2xl font-semibold" data-testid="tipo-cambio-valor">{textoDelValor(c)}</p>
          {hay && <Badge tone={c.tipo_cambio_manual ? 'warn' : 'ok'}>{c.tipo_cambio_manual ? 'Manual' : 'Automático'}</Badge>}
        </div>
        <p className="text-sm text-muted">{textoDelOrigen(c)}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Input label="Fijar a mano (soles por 1 US$)" inputMode="decimal" value={valor} onChange={e => setValor(e.target.value)} error={valor.trim() && !tipoCambioEscritoValido(valor) ? `Entre ${TC_MIN} y ${TC_MAX}` : undefined} hint="Pasa a manual: no se actualiza solo." className="w-64" />
          <Button loading={busy === 'fijar'} disabled={!valor.trim() || !tipoCambioEscritoValido(valor) || busy !== null || (c.tipo_cambio_manual && Number(tipoCambioParaApi(valor)) === Number(c.tipo_cambio_usd))} onClick={() => void enviar({ tipo_cambio: tipoCambioParaApi(valor) }, 'fijar')}>Fijar a mano</Button>
          <Button variant="secondary" loading={busy === 'auto'} disabled={busy !== null} onClick={() => void enviar({ automatico: true }, 'auto')}>{c.tipo_cambio_manual || !hay ? 'Volver a automático' : 'Actualizar ahora'}</Button>
        </div>
      </CardBody>
    </Card>
  );
}
