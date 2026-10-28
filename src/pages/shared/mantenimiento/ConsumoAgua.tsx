import { useState } from 'react';
import { MagnifyingGlassPlusIcon } from '@heroicons/react/24/outline';
import { Button, Modal, soles } from '../../../ui';
import { fechaNumerica } from './formato';
import { ImagenRecibo } from './ImagenRecibo';
import type { AguaMantenimiento } from './tipos';

/** Detalle del consumo de agua del departamento: lecturas, m³, factor y monto, con la foto del contómetro (se puede ampliar). */
export function ConsumoAgua({ agua, codigo }: { agua: AguaMantenimiento; codigo: string }) {
  const [ampliada, setAmpliada] = useState(false);
  const datos: [string, string][] = [
    [`Lectura anterior (${fechaNumerica(agua.fecha_anterior)})`, agua.lectura_anterior],
    [`Lectura actual (${fechaNumerica(agua.fecha_actual)})`, agua.lectura_actual],
    ['Consumo', `${agua.consumo_m3} m³`],
    ['Factor', `S/ ${Number(agua.factor)} por m³`],
    ['Consumo en soles', soles(agua.monto)],
  ];
  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      {agua.foto_url && (
        <div className="shrink-0">
          <button type="button" onClick={() => setAmpliada(true)} aria-label="Ampliar la foto del contómetro" className="group relative block overflow-hidden rounded border border-line bg-surface2">
            <ImagenRecibo src={agua.foto_url} alt={`Foto del contómetro del departamento ${codigo}`} className="h-32 w-full object-cover sm:w-44" />
            <span className="absolute bottom-1 right-1 rounded bg-surface/90 p-1 text-muted group-hover:text-ink"><MagnifyingGlassPlusIcon className="h-4 w-4" aria-hidden="true" /></span>
          </button>
        </div>
      )}
      <dl className="grid min-w-0 flex-1 grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
        {datos.map(([k, v]) => (
          <div key={k} className="col-span-2 grid grid-cols-subgrid border-b border-line pb-1.5 last:border-0 last:pb-0">
            <dt className="text-muted">{k}</dt>
            <dd className="num text-right font-medium">{v}</dd>
          </div>
        ))}
      </dl>
      {agua.foto_url && (
        <Modal open={ampliada} onClose={() => setAmpliada(false)} size="lg" title="Foto del contómetro" description={`Departamento ${codigo}`} footer={<Button variant="secondary" onClick={() => setAmpliada(false)}>Cerrar</Button>}>
          <ImagenRecibo src={agua.foto_url} alt={`Foto ampliada del contómetro del departamento ${codigo}`} className="mx-auto max-h-[65vh] w-auto max-w-full object-contain" />
        </Modal>
      )}
    </div>
  );
}
