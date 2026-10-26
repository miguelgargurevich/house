import { useState, useEffect } from 'react';
import { api, errorText } from '../../api';
import { Alert, Button, Card } from '../../ui';
import { QrCodeIcon, LinkIcon, TrashIcon } from '@heroicons/react/24/outline';

interface EstadoWhatsapp {
  connected?: boolean;
  status?: string;
  instance?: string;
  qr?: string;
}

export default function WhatsappSync() {
  const [qr, setQr] = useState<string | null>(null);
  const [status, setStatus] = useState<'not_linked' | 'connecting' | 'connected'>('not_linked');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = async () => {
    try {
      const data = await api<EstadoWhatsapp>('/api/whatsapp/status');
      if (data.connected) {
        setStatus('connected');
      } else if (data.status === 'connecting') {
        setStatus('connecting');
      } else {
        setStatus('not_linked');
      }
    } catch (e) {
      console.error('Error checking status', e);
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSync = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<EstadoWhatsapp>('/api/whatsapp/sync', { method: 'POST' });
      setQr(data.qr ?? null);
      setStatus(data.status === 'open' ? 'connected' : 'connecting');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('¿Estás seguro de que deseas desvincular tu número de WhatsApp?')) return;
    setLoading(true);
    setError(null);
    try {
      await api('/api/whatsapp/disconnect', { method: 'DELETE' });
      setQr(null);
      setStatus('not_linked');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Sincronización de WhatsApp</h1>
        <p className="text-slate-500">
          Vincula tu número de teléfono para enviar avisos y resúmenes directamente a los vecinos.
        </p>
      </div>

      <Card className="p-8 text-center">
        <div className="flex justify-center mb-6">
          {status === 'connected' ? (
            <div className="bg-green-100 p-4 rounded-full">
              <LinkIcon className="w-12 h-12 text-green-600" />
            </div>
          ) : qr ? (
            <img src={qr} alt="WhatsApp QR" className="w-64 h-64 border-4 border-white shadow-sm" />
          ) : (
            <div className="bg-slate-100 p-4 rounded-full">
              <QrCodeIcon className="w-12 h-12 text-slate-400" />
            </div>
          )}
        </div>

        <div className="mb-8">
          <p className="text-lg font-medium">
            {status === 'connected'
              ? '✅ WhatsApp vinculado correctamente'
              : status === 'connecting'
                ? 'Esperando escaneo del código QR...'
                : 'Número no vinculado'}
          </p>
          {status === 'connecting' && (
            <p className="text-sm text-slate-500 mt-2">
              Abre WhatsApp en tu teléfono → Ajustes → Dispositivos vinculados → Vincular dispositivo
            </p>
          )}
        </div>

        <div className="flex justify-center gap-4">
          {status === 'connected' ? (
            <Button
              variant="danger"
              onClick={handleDisconnect}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <TrashIcon className="w-4 h-4" />
              Desvincular número
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={handleSync}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <LinkIcon className="w-4 h-4" />
              {loading ? 'Sincronizando...' : 'Sincronizar mi número'}
            </Button>
          )}
        </div>

        {error && (
          <Alert tone="bad">
            {error}
          </Alert>
        )}
      </Card>
    </div>
  );
}
