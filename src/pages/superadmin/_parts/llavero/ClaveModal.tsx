import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { Button, Input, Modal, useToast } from '../../../../ui';
import { etiquetaSugerida, type Clave, type Proveedor } from './tipos';

interface Props {
  proveedor: Proveedor | null;
  /** Clave que se reemplaza (misma etiqueta); null = clave nueva. */
  existente: Clave | null;
  /** Etiquetas ya usadas por este proveedor, para proponer la siguiente. */
  etiquetasUsadas: string[];
  onClose: () => void;
  onGuardada: () => void;
}

/** La clave vive sólo en el estado de este formulario y se borra al guardar o al cerrar. */
export function ClaveModal({ proveedor, existente, etiquetasUsadas, onClose, onGuardada }: Props) {
  const toast = useToast();
  const [clave, setClave] = useState('');
  const [modelo, setModelo] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [error, setError] = useState<string>();
  const [guardando, setGuardando] = useState(false);
  const [cargadoPara, setCargadoPara] = useState<string | null>(null);

  // Al abrir para otro proveedor o clave se parte de cero (nunca se precarga la clave). Los refrescos de la lista no reinician el formulario.
  const abierto = proveedor ? `${proveedor.id}:${existente?.id ?? 'nueva'}` : null;
  if (abierto !== cargadoPara) {
    setCargadoPara(abierto);
    setClave('');
    setEtiqueta(existente?.etiqueta ?? etiquetaSugerida(etiquetasUsadas));
    setModelo(existente?.modelo ?? '');
    setError(undefined);
  }

  function cerrar() {
    setClave('');
    setError(undefined);
    onClose();
  }

  async function guardar(e?: FormEvent) {
    e?.preventDefault();
    if (!proveedor) return;
    setGuardando(true);
    setError(undefined);
    try {
      await api(`/api/llavero/${proveedor.id}`, { method: 'PUT', json: { clave: clave.trim(), etiqueta: etiqueta.trim().toLowerCase(), modelo: modelo.trim() } });
      setClave('');
      toast.ok(existente ? `Clave de ${proveedor.nombre} actualizada` : `Clave de ${proveedor.nombre} guardada`);
      onGuardada();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      open={proveedor !== null}
      onClose={cerrar}
      title={`${existente ? 'Cambiar' : 'Agregar'} clave de ${proveedor?.nombre ?? ''}`}
      description="Se guarda cifrada y no se vuelve a mostrar."
      footer={<><Button variant="secondary" onClick={cerrar}>Cancelar</Button><Button loading={guardando} disabled={!clave.trim() || !etiqueta.trim()} onClick={() => void guardar()}>Guardar clave</Button></>}
    >
      <form onSubmit={e => void guardar(e)} className="grid gap-4" noValidate>
        <Input
          label="Clave de API"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={clave}
          onChange={e => setClave(e.target.value)}
          error={error}
          hint={existente ? `Reemplaza la clave que termina en ${existente.ultimos4}.` : 'Entre 8 y 400 caracteres, sin espacios.'}
        />
        <Input
          label="Etiqueta"
          autoComplete="off"
          spellCheck={false}
          value={etiqueta}
          onChange={e => setEtiqueta(e.target.value)}
          disabled={!!existente}
          hint="Para distinguir las claves del mismo proveedor. Solo minúsculas, números y guiones."
        />
        <Input
          label="Modelo (opcional)"
          autoComplete="off"
          spellCheck={false}
          value={modelo}
          onChange={e => setModelo(e.target.value)}
          placeholder={proveedor?.modeloPorDefecto}
          hint="Si lo dejas vacío se usa el modelo por defecto."
        />
        {proveedor && (
          <a href={proveedor.urlParaConseguirKey} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-hover">
            Conseguir una clave
            <ArrowTopRightOnSquareIcon className="h-4 w-4" aria-hidden="true" />
          </a>
        )}
      </form>
    </Modal>
  );
}
