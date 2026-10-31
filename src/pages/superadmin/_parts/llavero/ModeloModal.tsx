import { useEffect, useState } from 'react';
import { api, errorText } from '../../../../api';
import { Alert, Button, Modal, Select, Skeleton, useToast } from '../../../../ui';
import type { Clave, ModeloDeClave, Proveedor } from './tipos';

interface Props {
  objetivo: { proveedor: Proveedor; clave: Clave } | null;
  onClose: () => void;
  onGuardado: () => void;
}

const ORDEN = ['razonamiento', 'rapido', 'equilibrado', 'avanzado'];

/** «Cambiar modelo»: los modelos ACTIVOS de esa clave agrupados por categoría, o «Automático». */
export function ModeloModal({ objetivo, onClose, onGuardado }: Props) {
  const toast = useToast();
  const [modelos, setModelos] = useState<ModeloDeClave[] | null>(null);
  const [error, setError] = useState<string>();
  const [valor, setValor] = useState('');
  const [guardando, setGuardando] = useState(false);
  const claveId = objetivo?.clave.id;
  const fijado = objetivo?.clave.modelo ?? '';

  useEffect(() => {
    if (claveId === undefined) return;
    let vivo = true;
    setModelos(null);
    setError(undefined);
    setValor(fijado);
    api<ModeloDeClave[]>(`/api/llavero/${claveId}/modelos`).then(m => { if (vivo) setModelos(m); }).catch(e => { if (vivo) setError(errorText(e)); });
    return () => { vivo = false; };
  }, [claveId, fijado]);

  async function guardar() {
    if (!objetivo) return;
    setGuardando(true);
    try {
      await api(`/api/llavero/${objetivo.clave.id}`, { method: 'PATCH', json: { modelo: valor || null } });
      toast.ok(valor ? `Modelo fijado: ${valor}` : 'Ahora la clave elige el modelo sola');
      onGuardado();
      onClose();
    } catch (e) { setError(errorText(e)); } finally { setGuardando(false); }
  }

  const grupos = ORDEN.map(c => ({ c, lista: (modelos ?? []).filter(m => m.categoria === c) })).filter(g => g.lista.length > 0);
  return (
    <Modal
      open={objetivo !== null}
      onClose={onClose}
      title={`Cambiar modelo de ${objetivo?.proveedor.nombre ?? ''}`}
      description="Sólo se ofrecen los modelos que el proveedor tiene activos para esta clave. En Automático, Torre elige el mejor y prueba otro si falla."
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button loading={guardando} disabled={modelos === null || valor === fijado} onClick={() => void guardar()}>Guardar modelo</Button></>}
    >
      {error && <div className="mb-3"><Alert tone="bad">{error}</Alert></div>}
      {modelos === null && !error ? (
        <div aria-busy="true" aria-label="Cargando modelos"><Skeleton className="h-10 w-full" /></div>
      ) : modelos && modelos.length === 0 ? (
        <Alert tone="info">Todavía no hay modelos descubiertos para esta clave. Toca «Sincronizar ahora» y vuelve a intentar.</Alert>
      ) : modelos ? (
        <Select label="Modelo" value={valor} onChange={e => setValor(e.target.value)} hint={valor ? 'Mientras siga activo, esta clave usa siempre este modelo.' : undefined}>
          <option value="">Automático (recomendado)</option>
          {grupos.map(g => (
            <optgroup key={g.c} label={g.lista[0]!.categoria_nombre}>
              {g.lista.map(m => <option key={m.id} value={m.id}>{m.nombre}{m.gratis ? ' · Gratis' : ''}</option>)}
            </optgroup>
          ))}
        </Select>
      ) : null}
    </Modal>
  );
}
