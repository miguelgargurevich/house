import { useState } from 'react';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../api';
import { Alert, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '../../ui';
import { ClaveModal } from './_parts/llavero/ClaveModal';
import { FilaProveedor } from './_parts/llavero/FilaProveedor';
import type { Clave, DatosLlavero, Proveedor } from './_parts/llavero/tipos';

export default function Llavero() {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<DatosLlavero>('/api/llavero');
  const [editando, setEditando] = useState<Proveedor | null>(null);
  const [quitar, setQuitar] = useState<{ proveedor: Proveedor; clave: Clave } | null>(null);
  const [probando, setProbando] = useState<number | null>(null);
  const [quitando, setQuitando] = useState(false);

  const claveDe = (p: Proveedor) => data?.claves.find(c => c.proveedor === p.id && c.etiqueta === 'principal') ?? data?.claves.find(c => c.proveedor === p.id);

  async function probar(p: Proveedor, c: Clave) {
    setProbando(c.id);
    try {
      const r = await api<Clave>(`/api/llavero/${c.id}/probar`, { method: 'POST' });
      if (r.estado === 'ok') toast.ok(`${p.nombre} responde bien`); else toast.error(`${p.nombre}: ${r.estado_detalle ?? 'la prueba falló'}`);
      await reload();
    } catch (e) { toast.error(errorText(e)); } finally { setProbando(null); }
  }

  async function alternar(p: Proveedor, c: Clave, habilitada: boolean) {
    try {
      await api(`/api/llavero/${c.id}`, { method: 'PATCH', json: { habilitada } });
      toast.ok(habilitada ? `${p.nombre} habilitado` : `${p.nombre} en pausa`);
      await reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  async function quitarClave() {
    if (!quitar) return;
    setQuitando(true);
    try {
      await api(`/api/llavero/${quitar.clave.id}`, { method: 'DELETE' });
      toast.ok(`Clave de ${quitar.proveedor.nombre} eliminada`);
      setQuitar(null);
      await reload();
    } catch (e) { toast.error(errorText(e)); } finally { setQuitando(false); }
  }

  const sinConfigurar = !!data && !data.configurado;

  return (
    <>
      <PageHeader title="Llavero de IA" description="Claves de los proveedores de IA que usa el asistente. Se guardan cifradas; nunca se vuelven a mostrar." />

      {sinConfigurar && (
        <div className="mb-4">
          <Alert tone="warn">
            El llavero no está configurado: falta la variable <code className="num">LLAVERO_ENC_KEY</code> (mínimo 32 caracteres) en el servidor. Mientras tanto no se pueden guardar ni cambiar claves.
          </Alert>
        </div>
      )}
      {data?.configurado && data.claves.length === 0 && (
        <div className="mb-4">
          <Alert tone="info">Aún no hay ninguna clave guardada. Mientras tanto el asistente usa la clave de Gemini del servidor, si existe.</Alert>
        </div>
      )}

      <Card>
        {loading && !data ? (
          <div className="divide-y divide-line" aria-busy="true" aria-label="Cargando proveedores">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex flex-col gap-2 px-5 py-4"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64 max-w-full" /><Skeleton className="h-3 w-48" /></div>
            ))}
          </div>
        ) : error && !data ? (
          <ErrorState message={error} onRetry={() => void reload()} />
        ) : data && data.proveedores.length === 0 ? (
          <EmptyState icon={<LockClosedIcon />} title="No hay proveedores disponibles" description="El servidor no devolvió ningún proveedor de IA." />
        ) : (
          <ul className="divide-y divide-line">
            {data?.proveedores.map(p => {
              const c = claveDe(p);
              return (
                <FilaProveedor
                  key={p.id}
                  proveedor={p}
                  clave={c}
                  deshabilitado={sinConfigurar}
                  probando={!!c && probando === c.id}
                  onAgregar={() => setEditando(p)}
                  onProbar={() => c && void probar(p, c)}
                  onAlternar={h => c && void alternar(p, c, h)}
                  onQuitar={() => c && setQuitar({ proveedor: p, clave: c })}
                />
              );
            })}
          </ul>
        )}
      </Card>

      <ClaveModal proveedor={editando} existente={editando ? claveDe(editando) ?? null : null} onClose={() => setEditando(null)} onGuardada={() => void reload()} />

      <ConfirmDialog
        open={!!quitar}
        onClose={() => setQuitar(null)}
        onConfirm={quitarClave}
        loading={quitando}
        danger
        title="Quitar clave"
        message={`Se eliminará la clave de ${quitar?.proveedor.nombre ?? 'este proveedor'}. El asistente dejará de usarla y tendrás que volver a pegarla para recuperarla.`}
        confirmLabel="Quitar clave"
      />
    </>
  );
}
