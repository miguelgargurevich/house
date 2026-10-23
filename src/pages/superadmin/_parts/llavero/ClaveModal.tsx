import { useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { api, errorText } from '../../../../api';
import { Button, Input, Modal, useToast } from '../../../../ui';
import type { Clave, Proveedor } from './tipos';

interface Props {
  proveedor: Proveedor | null;
  existente: Clave | null;
  onClose: () => void;
  onGuardada: () => void;
}

/** La clave vive sólo en el estado de este formulario y se borra al guardar o al cerrar. */
export function ClaveModal({ proveedor, existente, onClose, onGuardada }: Props) {
  const toast = useToast();
  const [clave, setClave] = useState('');
  const [modelo, setModelo] = useState('');
  const [error, setError] = useState<string>();
  const [guardando, setGuardando] = useState(false);
  const [cargadoPara, setCargadoPara] = useState<string | null>(null);

  // Al abrir para otro proveedor se parte de cero (nunca se precarga la clave).
  if ((proveedor?.id ?? null) !== cargadoPara) {
    setCargadoPara(proveedor?.id ?? null);
    setClave('');
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
      await api(`/api/llavero/${proveedor.id}`, { method: 'PUT', json: { clave: clave.trim(), modelo: modelo.trim() } });
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
      footer={<><Button variant="secondary" onClick={cerrar}>Cancelar</Button><Button loading={guardando} disabled={!clave.trim()} onClick={() => void guardar()}>Guardar clave</Button></>}
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
