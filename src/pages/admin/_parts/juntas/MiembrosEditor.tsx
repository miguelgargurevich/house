import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useResource } from '../../../../api';
import type { CargoJunta } from '../../../../auth/AuthContext';
import { Alert, Button, IconButton, Select, Skeleton } from '../../../../ui';
import { CARGOS, CARGOS_UNICOS, cargoRepetido } from './tipos';
import type { Candidato, FilaMiembro } from './tipos';

interface Props {
  complejoId: number;
  /** null = la junta de todo el condominio. */
  estructuraId: number | null;
  /** «block» o «torre». */
  palabra: string;
  value: FilaMiembro[];
  onChange: (v: FilaMiembro[]) => void;
  /** La junta que se edita: sus miembros no cuentan como «ya está en otra junta». */
  juntaId?: number;
}

/** Cada fila ocupa todo el ancho en el celular: la persona arriba, y el cargo con «Quitar» debajo. */
export function MiembrosEditor({ complejoId, estructuraId, palabra, value, onChange, juntaId }: Props) {
  const q = useResource<{ items: Candidato[] }>(`/api/juntas/candidatos?complejo_id=${complejoId}${estructuraId != null ? `&estructura_id=${estructuraId}` : ''}`);
  const candidatos = q.data?.items ?? [];
  const elegidos = new Set(value.map(f => f.usuario_id));
  const repetido = cargoRepetido(value);

  const cambiar = (i: number, parte: Partial<FilaMiembro>) => onChange(value.map((f, j) => (j === i ? { ...f, ...parte } : f)));

  return (
    <fieldset className="flex flex-col gap-3 sm:col-span-2">
      <legend className="text-sm font-medium">Miembros de la junta</legend>
      <p className="text-xs text-muted">Sólo propietarios {estructuraId != null ? `del ${palabra}` : 'del condominio'}. Un solo presidente, un solo tesorero y un solo secretario; vocales puede haber varios. Presidente y tesorero gestionan los medios de pago y validan los pagos. Secretario y vocal no ganan permisos.</p>
      {q.loading && <Skeleton className="h-10 w-full" />}
      {q.error && <Alert tone="bad">No se pudo cargar la lista de propietarios: {q.error}</Alert>}
      {repetido && <Alert tone="warn">Sólo puede haber un {repetido}.</Alert>}
      <ul className="flex flex-col gap-3">
        {value.map((f, i) => (
          <li key={i} className="flex flex-col gap-2 rounded-lg border border-line p-3 sm:flex-row sm:items-end">
            <Select label={`Persona ${i + 1}`} className="min-w-0 flex-1" value={f.usuario_id} onChange={e => cambiar(i, { usuario_id: e.target.value })}>
              <option value="">Elige un propietario</option>
              {candidatos.map(c => {
                const otra = c.junta_vigente_id != null && c.junta_vigente_id !== juntaId;
                return (
                  <option key={c.id} value={c.id} disabled={(elegidos.has(String(c.id)) && String(c.id) !== f.usuario_id) || otra}>
                    {c.nombre}{c.departamentos.length ? ` · ${c.departamentos.join(', ')}` : ''}{otra ? ' (ya está en otra junta)' : ''}
                  </option>
                );
              })}
            </Select>
            <div className="flex items-end gap-2">
              <Select label={`Cargo de la persona ${i + 1}`} ocultarEtiqueta className="min-w-0 flex-1 sm:w-40 sm:flex-none" value={f.cargo} onChange={e => cambiar(i, { cargo: e.target.value as CargoJunta })}>
                {CARGOS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
              <IconButton label={`Quitar a la persona ${i + 1}`} onClick={() => onChange(value.filter((_, j) => j !== i))}><TrashIcon className="h-4 w-4" /></IconButton>
            </div>
          </li>
        ))}
      </ul>
      <div>
        <Button variant="secondary" size="sm" icon={<PlusIcon className="h-4 w-4" />} onClick={() => onChange([...value, { usuario_id: '', cargo: CARGOS_UNICOS.find(c => !value.some(f => f.cargo === c)) ?? 'vocal' }])}>Agregar miembro</Button>
      </div>
    </fieldset>
  );
}
