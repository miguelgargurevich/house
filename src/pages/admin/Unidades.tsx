import { useState } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { Button, PageHeader } from '../../ui';
import { ListaDeUnidades } from './_parts/unidades/ListaDeUnidades';
import type { FilaUnidad } from './_parts/unidades/tipos';

export default function Unidades() {
  const [editando, setEditando] = useState<FilaUnidad | 'nuevo' | null>(null);
  return (
    <>
      <PageHeader
        title="Unidades"
        description="Departamentos, casas, locales, estacionamientos y depósitos, con su torre, propietario e inquilino."
        actions={<Button icon={<PlusIcon className="h-4 w-4" />} onClick={() => setEditando('nuevo')}>Nueva unidad</Button>}
      />
      <ListaDeUnidades editando={editando} onEditando={setEditando} />
    </>
  );
}
