import { useState } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { Button, PageHeader } from '../../ui';
import { ListaDeUnidades } from './_parts/unidades/ListaDeUnidades';
import type { FilaUnidad } from './_parts/unidades/tipos';
import { Bloqueable } from '../../app/Bloqueable';

export default function Unidades() {
  const [editando, setEditando] = useState<FilaUnidad | 'nuevo' | null>(null);
  return (
    <>
      <PageHeader
        title="Unidades"
        description="Departamentos, casas, locales, estacionamientos y depósitos, con su torre, propietario e inquilino."
        actions={<Bloqueable>{b => <Button icon={<PlusIcon className="h-4 w-4" />} disabled={b} onClick={() => setEditando('nuevo')}>Nueva unidad</Button>}</Bloqueable>}
      />
      <ListaDeUnidades editando={editando} onEditando={setEditando} />
    </>
  );
}
