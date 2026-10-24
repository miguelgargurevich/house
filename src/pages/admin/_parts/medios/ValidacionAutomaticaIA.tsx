import { useState } from 'react';
import { api, errorText, useList } from '../../../../api';
import { Alert, Card, CardBody, CardHeader, ConfirmDialog, Skeleton, useToast } from '../../../../ui';
import { Interruptor } from '../catalogo/Interruptor';

interface CondominioIA { id: number; nombre: string; validacion_automatica_ia: boolean }

/** Interruptor de la validación automática por IA, uno por condominio. Sólo lo ve la administración: la junta no lo cambia. */
export function ValidacionAutomaticaIA() {
  const toast = useToast();
  const list = useList<CondominioIA>('/api/complejos', { pageSize: 100 });
  const [encender, setEncender] = useState<CondominioIA | null>(null);
  const [busy, setBusy] = useState(false);

  async function cambiar(c: CondominioIA, valor: boolean) {
    setBusy(true);
    try {
      await api(`/api/complejos/${c.id}`, { method: 'PATCH', json: { validacion_automatica_ia: valor } });
      toast.ok(valor ? 'Validación automática activada.' : 'Validación automática apagada.');
      setEncender(null);
      void list.reload();
    } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); }
  }

  if (!list.loading && !list.error && list.items.length === 0) return null;

  return (
    <Card className="mb-4">
      <CardHeader title="Validación automática con IA" description="La IA lee el comprobante que sube el vecino y lo compara con lo que debía pagar." />
      <CardBody className="space-y-4">
        <p className="text-sm text-muted">
          Cuando está activada, si el comprobante coincide exactamente (monto, destino y fecha, sin archivos ni números de operación repetidos), el pago se valida solo y el vecino recibe su aviso.
          <strong className="font-medium text-ink"> Nunca rechaza un pago por su cuenta</strong>: todo lo dudoso, ilegible o que no coincida queda para que una persona lo revise. Está apagada hasta que la actives, y puedes apagarla cuando quieras.
        </p>
        {list.error && <Alert tone="bad">No se pudo cargar la configuración: {list.error}</Alert>}
        {list.loading && list.items.length === 0 ? <Skeleton className="h-10 w-72" /> : (
          <ul className="space-y-3">
            {list.items.map(c => (
              <li key={c.id}>
                <Interruptor
                  label="Validar automáticamente los pagos que coincidan exactamente"
                  hint={list.items.length > 1 ? c.nombre : undefined}
                  aria-label={`Validar automáticamente los pagos que coincidan exactamente: ${c.nombre}`}
                  checked={c.validacion_automatica_ia}
                  disabled={busy}
                  onChange={e => (e.target.checked ? setEncender(c) : void cambiar(c, false))}
                />
              </li>
            ))}
          </ul>
        )}
      </CardBody>
      <ConfirmDialog
        open={encender !== null}
        onClose={() => setEncender(null)}
        onConfirm={async () => { if (encender) await cambiar(encender, true); }}
        loading={busy}
        title="Activar la validación automática"
        message={`Los pagos de ${encender?.nombre ?? 'este condominio'} cuyo comprobante coincida exactamente se validarán solos y el recibo quedará pagado. Los demás seguirán en «Por validar» para que los revises. Para evaluar comprobantes necesitas una clave de Gemini u OpenAI en el Llavero.`}
        confirmLabel="Activar"
      />
    </Card>
  );
}
