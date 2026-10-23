import { useEffect, useState } from 'react';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { api, errorText, useResource } from '../../api';
import { Alert, Card, ConfirmDialog, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '../../ui';
import { ClaveModal } from './_parts/llavero/ClaveModal';
import { ComoSeUsan } from './_parts/llavero/ComoSeUsan';
import { GrupoProveedor } from './_parts/llavero/GrupoProveedor';
import type { Clave, DatosLlavero, Proveedor } from './_parts/llavero/tipos';

const REFRESCO_MS = 20_000;

export default function Llavero() {
  const toast = useToast();
  const { data, loading, error, reload } = useResource<DatosLlavero>('/api/llavero');
  const [editando, setEditando] = useState<{ proveedor: Proveedor; existente: Clave | null } | null>(null);
  const [quitar, setQuitar] = useState<{ proveedor: Proveedor; clave: Clave } | null>(null);
  const [probando, setProbando] = useState<number | null>(null);
  const [quitando, setQuitando] = useState(false);

  // Mientras la página está visible se refresca la lista para ver los enfriamientos; no toca modales ni foco.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, REFRESCO_MS);
    return () => clearInterval(t);
  }, [reload]);

  const clavesDe = (p: Proveedor) => data?.claves.filter(c => c.proveedor === p.id) ?? [];
  const nombre = (p: Proveedor, c: Clave) => (clavesDe(p).length > 1 ? `${p.nombre} (${c.etiqueta})` : p.nombre);

  async function probar(p: Proveedor, c: Clave) {
    setProbando(c.id);
    try {
      const r = await api<Clave>(`/api/llavero/${c.id}/probar`, { method: 'POST' });
      if (r.estado === 'ok') toast.ok(`${nombre(p, c)} responde bien`); else toast.error(`${nombre(p, c)}: ${r.estado_detalle ?? 'la prueba falló'}`);
      await reload();
    } catch (e) { toast.error(errorText(e)); } finally { setProbando(null); }
  }

  async function alternar(p: Proveedor, c: Clave, habilitada: boolean) {
    try {
      await api(`/api/llavero/${c.id}`, { method: 'PATCH', json: { habilitada } });
      toast.ok(habilitada ? `${nombre(p, c)} habilitada` : `${nombre(p, c)} en pausa`);
      await reload();
    } catch (e) { toast.error(errorText(e)); }
  }

  async function quitarClave() {
    if (!quitar) return;
    setQuitando(true);
    try {
      await api(`/api/llavero/${quitar.clave.id}`, { method: 'DELETE' });
      toast.ok(`Clave ${quitar.clave.etiqueta} de ${quitar.proveedor.nombre} eliminada`);
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
        ) : data ? (
          <>
            <ComoSeUsan orden={data.orden} proveedores={data.proveedores} />
            <ul className="divide-y divide-line">
              {data.proveedores.map(p => (
                <GrupoProveedor
                  key={p.id}
                  proveedor={p}
                  claves={clavesDe(p)}
                  maxClaves={data.max_claves_por_proveedor}
                  deshabilitado={sinConfigurar}
                  probando={probando}
                  onAgregar={() => setEditando({ proveedor: p, existente: null })}
                  onProbar={c => void probar(p, c)}
                  onCambiar={c => setEditando({ proveedor: p, existente: c })}
                  onAlternar={(c, h) => void alternar(p, c, h)}
                  onQuitar={c => setQuitar({ proveedor: p, clave: c })}
                />
              ))}
            </ul>
          </>
        ) : null}
      </Card>

      <ClaveModal
        proveedor={editando?.proveedor ?? null}
        existente={editando?.existente ?? null}
        etiquetasUsadas={editando ? clavesDe(editando.proveedor).map(c => c.etiqueta) : []}
        onClose={() => setEditando(null)}
        onGuardada={() => void reload()}
      />

      <ConfirmDialog
        open={!!quitar}
        onClose={() => setQuitar(null)}
        onConfirm={quitarClave}
        loading={quitando}
        danger
        title="Quitar clave"
        message={`Se eliminará la clave ${quitar?.clave.etiqueta ?? ''} de ${quitar?.proveedor.nombre ?? 'este proveedor'}. El asistente dejará de usarla y tendrás que volver a pegarla para recuperarla.`}
        confirmLabel="Quitar clave"
      />
    </>
  );
}
